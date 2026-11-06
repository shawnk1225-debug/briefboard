import { useEffect, useState } from 'react'
import { supabaseConfigured } from './data/supabaseBackend'
import { parseRoute, parseShareRoute, useHash } from './lib/route'
import { BoardPage } from './pages/BoardPage'
import { ClipPage } from './pages/ClipPage'
import { AuthGate } from './pages/AuthGate'
import { HomePage } from './pages/HomePage'
import { SharePage } from './pages/SharePage'
import { loadBoards, queue, refreshOpenBoard, startSync, stopSync, useStore } from './store/store'
import { Feedback } from './ui/feedback'
import { SearchDialog } from './ui/SearchDialog'

function Main() {
  const hash = useHash()
  const { boardId, cardId } = parseRoute(hash)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    loadBoards()
      .then(() => setState('ready'))
      .catch((err) => {
        console.error(err)
        setState('failed')
      })
    startSync()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshOpenBoard().catch(console.error)
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!queue.idle) e.preventDefault()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      stopSync()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  // Lets the browser tab name the board you're on.
  const title = useStore((s) => (boardId ? s.boards[boardId]?.title : null))
  useEffect(() => {
    document.title = title ? `${title} · Briefboard` : 'Briefboard'
  }, [title])

  if (state === 'loading') return <div className="center-page muted">Loading…</div>
  if (state === 'failed') {
    return (
      <div className="center-page">
        <h1>Couldn't load your boards</h1>
        <p>Check your connection, then reload the page.</p>
      </div>
    )
  }
  if (hash === '#/clip') return <ClipPage />
  return (
    <>
      {boardId ? <BoardPage key={boardId} boardId={boardId} focusCardId={cardId} /> : <HomePage />}
      <SearchDialog />
    </>
  )
}

export function App() {
  const share = parseShareRoute(useHash())
  // Links work with no login, so they skip the sign-in screen and the team's data entirely.
  if (share) {
    return (
      <>
        <SharePage token={share.token} boardId={share.boardId} cardId={share.cardId} />
        <Feedback />
      </>
    )
  }
  return (
    <>
      {supabaseConfigured ? (
        <AuthGate>
          <Main />
        </AuthGate>
      ) : (
        <Main />
      )}
      <Feedback />
    </>
  )
}
