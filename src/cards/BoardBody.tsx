import { navigate } from '../lib/route'
import { updateBoard, useStore } from '../store/store'
import type { Card } from '../types'

export function BoardBody({ card, selected }: { card: Card; selected: boolean }) {
  const boardId = card.content.boardId!
  const board = useStore((s) => s.boards[boardId])
  return (
    <div className="board-body">
      <button
        className="board-tile"
        data-interactive
        aria-label={`Open board ${board?.title ?? ''}`}
        title="Open board"
        onClick={() => navigate(`/b/${boardId}`)}
      >
        <svg viewBox="0 0 48 40" aria-hidden="true">
          <rect x="3" y="3" width="18" height="34" rx="3" />
          <rect x="25" y="3" width="20" height="15" rx="3" />
          <rect x="25" y="22" width="20" height="15" rx="3" />
        </svg>
      </button>
      {selected ? (
        <input
          data-interactive
          className="board-title"
          aria-label="Board title"
          value={board?.title ?? ''}
          onChange={(e) => updateBoard(boardId, { title: e.target.value })}
        />
      ) : (
        <div className="board-title">{board?.title ?? 'Missing board'}</div>
      )}
    </div>
  )
}
