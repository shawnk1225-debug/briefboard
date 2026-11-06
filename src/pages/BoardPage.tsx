import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { addFiles } from '../canvas/addFiles'
import { Canvas } from '../canvas/Canvas'
import { centerOn, fitToContent, screenToWorld, viewportCenter, zoomCentered, getViewportEl } from '../canvas/geometry'
import { duplicateSelection, useBoardShortcuts } from '../canvas/shortcuts'
import { backend } from '../data/backend'
import { exportMarkdown, exportPdf, exportPng } from '../lib/export'
import { navigate } from '../lib/route'
import { copyBoardTree } from '../store/copy'
import {
  addCard,
  closeBoard,
  createBoard,
  openBoard,
  openCardComments,
  patchContent,
  redo,
  removeCards,
  selectOnly,
  setEditing,
  setTool,
  trashBoard,
  undo,
  updateBoard,
  useStore,
} from '../store/store'
import type { CardType } from '../types'
import { showToast } from '../ui/feedback'
import { CommentsPanel } from '../ui/CommentsPanel'
import { ArrowIcon, BoardIcon, ColumnIcon, DocIcon, FileIcon, HomeIcon, ImageIcon, LinkIcon, MoreIcon, NoteIcon, RedoIcon, SearchIcon, SketchIcon, TableIcon, TodoIcon, UndoIcon } from '../ui/icons'
import { openSearch } from '../ui/SearchDialog'

const COLORS = ['none', 'yellow', 'green', 'blue', 'pink', 'gray'] as const

async function addByType(type: CardType, x: number, y: number) {
  if (type === 'note') {
    setEditing(addCard('note', x - 130, y - 30).id)
  } else if (type === 'todo') {
    addCard('todo', x - 130, y - 60, { title: '', items: [{ id: crypto.randomUUID(), text: '', done: false }] })
  } else if (type === 'link') {
    addCard('link', x - 150, y - 30)
  } else if (type === 'column') {
    addCard('column', x - 150, y - 60, { title: '' })
  } else if (type === 'board') {
    const parentBoardId = useStore.getState().boardId
    const board = await createBoard({ parentBoardId })
    addCard('board', x - 85, y - 60, { boardId: board.id })
  } else if (type === 'table') {
    addCard('table', x - 230, y - 80, { title: '', rows: [['', '', ''], ['', '', ''], ['', '', '']] })
  } else if (type === 'doc') {
    setEditing(addCard('doc', x - 120, y - 60, { title: '' }).id)
  } else if (type === 'sketch') {
    setEditing(addCard('sketch', x - 200, y - 150, { strokes: [] }).id)
  }
}

const TOOLS: { type: CardType; label: string; icon: ReactNode }[] = [
  { type: 'note', label: 'Note', icon: <NoteIcon /> },
  { type: 'board', label: 'Board', icon: <BoardIcon /> },
  { type: 'column', label: 'Column', icon: <ColumnIcon /> },
  { type: 'todo', label: 'To-do', icon: <TodoIcon /> },
  { type: 'link', label: 'Link', icon: <LinkIcon /> },
  { type: 'table', label: 'Table', icon: <TableIcon /> },
  { type: 'doc', label: 'Doc', icon: <DocIcon /> },
  { type: 'sketch', label: 'Sketch', icon: <SketchIcon /> },
]

function ToolButton({ type, label, icon }: { type: CardType; label: string; icon: ReactNode }) {
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null)

  // Click drops the card mid-screen; dragging places it where you let go.
  const onPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startY = e.clientY
    let moved = false
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return
      moved = true
      setGhost({ x: ev.clientX, y: ev.clientY })
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setGhost(null)
      const viewport = getViewportEl()
      if (!viewport) return
      if (!moved) {
        const c = viewportCenter()
        void addByType(type, c.x, c.y)
        return
      }
      const r = viewport.getBoundingClientRect()
      const inside = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom
      const onToolbar = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('.toolbar')
      if (inside && !onToolbar) {
        const p = screenToWorld(ev.clientX, ev.clientY)
        void addByType(type, p.x, p.y)
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <>
      <button
        className="tool"
        title={`${label}: click to add, or drag onto the board`}
        onPointerDown={onPointerDown}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            const c = viewportCenter()
            void addByType(type, c.x, c.y)
          }
        }}
      >
        {icon}
        <span>{label}</span>
      </button>
      {ghost && (
        <div className="tool-ghost" style={{ left: ghost.x, top: ghost.y }}>
          {icon} {label}
        </div>
      )}
    </>
  )
}

function Toolbar() {
  const tool = useStore((s) => s.tool)
  const fileInput = useRef<HTMLInputElement>(null)
  const attachInput = useRef<HTMLInputElement>(null)
  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const c = viewportCenter()
    void addFiles([...(e.target.files ?? [])], c.x - 160, c.y - 120)
    e.target.value = ''
  }
  return (
    <nav className="toolbar" aria-label="Add to board">
      {TOOLS.map((t) => (
        <ToolButton key={t.type} {...t} />
      ))}
      <button className="tool" title="Image: pick a file, or drop or paste one onto the board" onClick={() => fileInput.current?.click()}>
        <ImageIcon />
        <span>Image</span>
      </button>
      <button className="tool" title="File: attach a PDF, doc or video, up to 50 MB" onClick={() => attachInput.current?.click()}>
        <FileIcon />
        <span>File</span>
      </button>
      <button
        className={`tool${tool === 'arrow' ? ' active' : ''}`}
        title="Arrow: drag between two cards"
        aria-pressed={tool === 'arrow'}
        onClick={() => setTool(tool === 'arrow' ? 'select' : 'arrow')}
      >
        <ArrowIcon />
        <span>Arrow</span>
      </button>
      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={onFiles} />
      <input ref={attachInput} type="file" multiple hidden onChange={onFiles} />
    </nav>
  )
}

function SelectionBar() {
  const selected = useStore((s) => s.selected)
  const cards = useStore((s) => s.cards)
  const editing = useStore((s) => s.editingId)
  const ids = Object.keys(selected)
  if (!ids.length || editing) return null
  const colorable = ids.filter((id) => cards[id]?.type === 'note' || cards[id]?.type === 'column')
  return (
    <div className="floating-bar selection-bar">
      <span className="count">{ids.length} selected</span>
      {colorable.length > 0 && (
        <>
          <span className="sep" />
          {COLORS.map((color) => (
            <button
              key={color}
              className="swatch"
              data-color={color}
              title={color === 'none' ? 'No colour' : color}
              aria-label={`Colour: ${color}`}
              onClick={() => colorable.forEach((id) => patchContent(id, { color: color === 'none' ? undefined : color }))}
            />
          ))}
        </>
      )}
      <span className="sep" />
      {ids.length === 1 && cards[ids[0]]?.type !== 'arrow' && (
        <button onClick={() => openCardComments(ids[0])}>Comment</button>
      )}
      <button onClick={duplicateSelection}>Duplicate</button>
      <button className="danger-text" onClick={() => removeCards(ids)}>
        Delete
      </button>
    </div>
  )
}

export function ZoomBar() {
  const zoom = useStore((s) => s.viewport.zoom)
  return (
    <div className="zoom-bar">
      <button aria-label="Zoom out" onClick={() => zoomCentered(zoom / 1.25)}>−</button>
      <button title="Reset to 100%" onClick={() => zoomCentered(1)}>{Math.round(zoom * 100)}%</button>
      <button aria-label="Zoom in" onClick={() => zoomCentered(zoom * 1.25)}>+</button>
      <button onClick={fitToContent}>Fit</button>
    </div>
  )
}

const STATUS_TEXT = { saved: 'Saved', saving: 'Saving…', retrying: 'Not saved yet. Retrying…' }

function BoardMenu({ boardId, title }: { boardId: string; title: string }) {
  const [open, setOpen] = useState(false)
  const run = (action: () => Promise<unknown> | void, failure: string) => async () => {
    setOpen(false)
    try {
      await action()
    } catch (err) {
      console.error(err)
      showToast(failure)
    }
  }
  const board = useStore((s) => s.boards[boardId])
  const requireContent = async (exporter: () => Promise<boolean>) => {
    if (!(await exporter())) showToast('This board is empty, so there is nothing to export yet.')
  }
  return (
    <div className="menu-wrap">
      <button className="icon-btn" aria-label="Board menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <MoreIcon />
      </button>
      {open && (
        <>
          <div className="menu-scrim" onPointerDown={() => setOpen(false)} />
          <div className="menu" role="menu">
            <button role="menuitem" onClick={run(() => requireContent(() => exportPdf(title)), 'PDF export failed.')}>Export as PDF</button>
            <button role="menuitem" onClick={run(() => requireContent(() => exportPng(title)), 'PNG export failed.')}>Export as PNG</button>
            <button role="menuitem" onClick={run(() => exportMarkdown(boardId, title), 'Markdown export failed.')}>Export as Markdown</button>
            <hr />
            {!board?.isTemplate && (
              <button
                role="menuitem"
                onClick={run(async () => {
                  await copyBoardTree(boardId, { parentBoardId: null, isTemplate: true })
                  showToast(`Saved “${title}” as a template. Find it on the home page.`)
                }, 'Could not save the template.')}
              >
                Save as template
              </button>
            )}
            <button
              role="menuitem"
              className="danger-text"
              onClick={run(() => {
                trashBoard(boardId)
                navigate('/')
              }, 'Could not delete the board.')}
            >
              Move to Trash
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function TopBar({ boardId }: { boardId: string }) {
  const boards = useStore((s) => s.boards)
  const syncStatus = useStore((s) => s.syncStatus)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const commentCount = useStore((s) => Object.values(s.comments).filter((c) => !c.resolved).length)
  const board = boards[boardId]

  const crumbs = []
  for (let p = board?.parentBoardId; p && boards[p] && crumbs.length < 20; p = boards[p].parentBoardId) crumbs.unshift(boards[p])

  return (
    <header className="topbar">
      <a className="icon-btn" href="#/" aria-label="All boards" title="All boards">
        <HomeIcon />
      </a>
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((crumb) => (
          <span key={crumb.id}>
            <a href={`#/b/${crumb.id}`}>{crumb.title}</a>
            <i>/</i>
          </span>
        ))}
        <input
          className="title-input"
          aria-label="Board title"
          value={board?.title ?? ''}
          size={Math.max(8, (board?.title.length ?? 8) + 1)}
          onChange={(e) => updateBoard(boardId, { title: e.target.value })}
        />
      </nav>
      <span className={`sync sync-${syncStatus}`} role="status">
        {STATUS_TEXT[syncStatus]}
      </span>
      {backend.mode === 'local' && <span className="pill" title="Connect Supabase to save to the cloud and share with your team">Browser only</span>}
      <div className="topbar-actions">
        <button className="btn comments-btn" onClick={() => openCardComments(null)}>
          Comments{commentCount ? ` (${commentCount})` : ''}
        </button>
        <button className="icon-btn" aria-label="Undo" title="Undo (⌘Z)" disabled={!canUndo} onClick={undo}><UndoIcon /></button>
        <button className="icon-btn" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}><RedoIcon /></button>
        <button className="icon-btn" aria-label="Search" title="Search (⌘K)" onClick={openSearch}><SearchIcon /></button>
        <BoardMenu boardId={boardId} title={board?.title ?? 'board'} />
      </div>
    </header>
  )
}

export function BoardPage({ boardId, focusCardId }: { boardId: string; focusCardId: string | null }) {
  const board = useStore((s) => s.boards[boardId])
  const loading = useStore((s) => s.boardLoading)
  const isEmpty = useStore((s) => Object.keys(s.cards).length === 0)
  useBoardShortcuts()

  useEffect(() => {
    openBoard(boardId).catch((err) => {
      console.error(err)
      showToast("Couldn't load this board. Check your connection and reload.")
    })
    return () => closeBoard()
  }, [boardId])

  // Runs after the cards have rendered, because it measures them.
  useEffect(() => {
    if (loading || !focusCardId || !useStore.getState().cards[focusCardId]) return
    const frame = requestAnimationFrame(() => {
      selectOnly([focusCardId])
      centerOn(focusCardId)
    })
    return () => cancelAnimationFrame(frame)
  }, [loading, focusCardId])

  if (!board) {
    return (
      <div className="center-page">
        <h1>Board not found</h1>
        <p>It may have been permanently deleted.</p>
        <a className="btn primary" href="#/">Back to all boards</a>
      </div>
    )
  }

  return (
    <div className="board-page">
      <TopBar boardId={boardId} />
      {board.deletedAt && (
        <div className="banner">
          This board is in the Trash.
          <button className="btn" onClick={() => updateBoard(boardId, { deletedAt: null })}>Restore</button>
        </div>
      )}
      <div className="board-stage">
        <Canvas />
        <Toolbar />
        <SelectionBar />
        <ZoomBar />
        <CommentsPanel />
        {!loading && isEmpty && (
          <div className="empty-hint">
            <strong>This board is empty</strong>
            Double-click anywhere to write a note, or drop in images and paste links.
          </div>
        )}
      </div>
    </div>
  )
}
