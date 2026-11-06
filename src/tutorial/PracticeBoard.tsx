import { useEffect } from 'react'
import { Canvas } from '../canvas/Canvas'
import { fitToContent } from '../canvas/geometry'
import { useBoardShortcuts } from '../canvas/shortcuts'
import { SelectionBar, Toolbar, ZoomBar } from '../pages/BoardPage'
import { openCardComments, redo, undo, useStore } from '../store/store'
import { CommentsPanel } from '../ui/CommentsPanel'
import { RedoIcon, UndoIcon } from '../ui/icons'

// The real canvas and tools, with nothing behind them: the store keeps all of this in memory.
export function PracticeBoard() {
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const commentCount = useStore((s) => Object.values(s.comments).filter((c) => !c.resolved).length)
  useBoardShortcuts()

  useEffect(() => {
    // Timed rather than per animation frame, so it still runs in a background tab.
    const timer = setTimeout(fitToContent, 60)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="board-page practice">
      <header className="topbar">
        <strong className="share-title">Practice board</strong>
        <span className="pill">Nothing here is saved</span>
        <div className="topbar-actions">
          <button className="btn comments-btn" data-tour="comments" onClick={() => openCardComments(null)}>
            Comments{commentCount ? ` (${commentCount})` : ''}
          </button>
          <button className="icon-btn" aria-label="Undo" disabled={!canUndo} onClick={undo}><UndoIcon /></button>
          <button className="icon-btn" aria-label="Redo" disabled={!canRedo} onClick={redo}><RedoIcon /></button>
        </div>
      </header>
      <div className="board-stage">
        <Canvas />
        <Toolbar />
        <SelectionBar />
        <ZoomBar />
        <CommentsPanel />
      </div>
    </div>
  )
}
