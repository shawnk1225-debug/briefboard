import { useEffect, useRef, useState } from 'react'
import { Canvas } from '../canvas/Canvas'
import { fitToContent, centerOn } from '../canvas/geometry'
import { backend } from '../data/backend'
import { FORMAT_LABELS } from '../lib/boardsView'
import { closeBoard, loadSharedBoard, openCardComments, selectOnly, setEditing, useStore } from '../store/store'
import type { SharedBatch } from '../types'
import { setFullScreen, useFullScreenSync } from '../canvas/fullScreen'
import { CommentsPanel } from '../ui/CommentsPanel'
import { FullScreenButton } from '../ui/FullScreenButton'
import { ZoomBar } from './BoardPage'

const REFRESH_MS = 30000

function Unavailable() {
  return (
    <div className="center-page">
      <h1>This link isn't active</h1>
      <p className="muted">It may have been turned off. Ask the person who sent it for a new one.</p>
    </div>
  )
}

function BatchList({ token, batch }: { token: string; batch: SharedBatch }) {
  const boards = batch.boards.filter((b) => !b.parentBoardId)
  return (
    <div className="share-page">
      <h1>{batch.name}</h1>
      <p className="muted">Shared with you to view and comment.</p>
      {boards.length ? (
        <ul className="share-list">
          {boards.map((board) => (
            <li key={board.id}>
              <a href={`#/s/${token}/b/${board.id}`}>
                <strong>{board.title}</strong>
                {board.format && <span>{FORMAT_LABELS[board.format]}</span>}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p>There are no boards here yet.</p>
      )}
    </div>
  )
}

function SharedBoardView({ token, boardId, cardId, batch }: { token: string; boardId: string; cardId: string | null; batch: SharedBatch }) {
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const stageRef = useRef<HTMLDivElement>(null)
  const fullScreen = useStore((s) => s.fullScreen)
  useFullScreenSync()
  const commentCount = useStore((s) => Object.values(s.comments).filter((c) => !c.resolved).length)
  const title = useStore((s) => s.boards[boardId]?.title)
  const parentId = batch.boards.find((b) => b.id === boardId)?.parentBoardId
  const parent = parentId ? batch.boards.find((b) => b.id === parentId) : undefined

  useEffect(() => {
    let live = true
    backend
      .getSharedBoard(token, boardId)
      .then((data) => {
        if (!live) return
        if (!data) {
          setState('missing')
          return
        }
        loadSharedBoard(data)
        setState('ready')
        // Once the cards have rendered they can be measured.
        setTimeout(() => {
          if (!live) return
          if (cardId) {
            selectOnly([cardId])
            centerOn(cardId)
          } else {
            fitToContent()
          }
        }, 60)
      })
      .catch((err) => {
        console.error(err)
        if (live) setState('missing')
      })

    // Link visitors have no login for live updates, so check for changes every so often.
    const timer = setInterval(() => {
      const { editingId } = useStore.getState()
      if (document.visibilityState !== 'visible' || editingId) return
      backend
        .getSharedBoard(token, boardId)
        .then((data) => {
          if (!live) return
          if (data) loadSharedBoard(data)
          else setState('missing')
        })
        .catch(console.error)
    }, REFRESH_MS)
    return () => {
      live = false
      clearInterval(timer)
      closeBoard()
    }
  }, [token, boardId, cardId])

  // Text stays selectable so editors can copy scripts, but fields can't be changed.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const lock = () => {
      stage.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('.viewport input, .viewport textarea').forEach((field) => {
        if (field instanceof HTMLInputElement && field.type === 'checkbox') field.disabled = true
        else field.readOnly = true
      })
    }
    lock()
    const observer = new MutationObserver(lock)
    observer.observe(stage, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [state])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const s = useStore.getState()
      if (s.editingId) setEditing(null)
      else if (Object.keys(s.selected).length) selectOnly([])
      else if (s.fullScreen) setFullScreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (state === 'missing') return <Unavailable />

  return (
    <div className={`board-page read-only${fullScreen ? ' full' : ''}`}>
      <header className="topbar">
        <div className="topbar-left">
          <nav className="crumbs" aria-label="Breadcrumb">
            <span>
              <a href={`#/s/${token}`}>{batch.name}</a>
              <i>/</i>
            </span>
            {parent && (
              <span>
                <a href={`#/s/${token}/b/${parent.id}`}>{parent.title}</a>
                <i>/</i>
              </span>
            )}
            <strong className="share-title">{title}</strong>
          </nav>
          <span className="pill">View and comment</span>
        </div>
        <div className="topbar-actions">
          <button className="btn comments-btn" onClick={() => openCardComments(null)}>
            Comments{commentCount ? ` (${commentCount})` : ''}
          </button>
          <FullScreenButton />
        </div>
      </header>
      <div className="board-stage" ref={stageRef}>
        <Canvas />
        <ZoomBar />
        <CommentsPanel />
      </div>
    </div>
  )
}

export function SharePage({ token, boardId, cardId }: { token: string; boardId: string | null; cardId: string | null }) {
  const [batch, setBatch] = useState<SharedBatch | null | undefined>(undefined)

  useEffect(() => {
    let live = true
    backend.setShareToken(token)
    useStore.setState({ readOnly: true, shareToken: token, commentsOpen: window.innerWidth > 900 })
    backend
      .getSharedBatch(token)
      .then((result) => {
        if (!live) return
        setBatch(result)
        if (result) {
          useStore.setState({ boards: Object.fromEntries(result.boards.map((b) => [b.id, b])) })
          document.title = `${result.name} · Briefboard`
        }
      })
      .catch((err) => {
        console.error(err)
        if (live) setBatch(null)
      })
    return () => {
      live = false
      backend.setShareToken(null)
      useStore.setState({ readOnly: false, shareToken: null, boards: {}, commentsOpen: false })
    }
  }, [token])

  if (batch === undefined) return <div className="center-page muted">Loading…</div>
  if (batch === null) return <Unavailable />
  if (!boardId) return <BatchList token={token} batch={batch} />
  return <SharedBoardView key={boardId} token={token} boardId={boardId} cardId={cardId} batch={batch} />
}
