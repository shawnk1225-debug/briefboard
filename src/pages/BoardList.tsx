import { folderOptions, folderPath, FORMAT_LABELS, STATUS_LABELS } from '../lib/boardsView'
import { copyBoardTree } from '../store/copy'
import { setPinned, trashBoard, updateBoards, useStore } from '../store/store'
import type { Board, BoardFormat, BoardStatus } from '../types'
import { BoardPreview } from '../ui/BoardPreview'
import { showToast } from '../ui/feedback'

export const guard = (action: () => Promise<unknown>, failure: string) => () => {
  action().catch((err) => {
    console.error(err)
    showToast(failure)
  })
}

function editedLabel(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return 'Today'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

export function PinButton({ board }: { board: Board }) {
  const pinned = useStore((s) => Boolean(s.pins[board.id]))
  const label = `${pinned ? 'Unpin' : 'Pin'} ${board.title}`
  return (
    <button
      className={`pin-btn${pinned ? ' pinned' : ''}`}
      aria-label={label}
      aria-pressed={pinned}
      title={pinned ? 'Unpin' : 'Pin to top'}
      onClick={guard(() => setPinned(board.id, !pinned), "Couldn't update that pin.")}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d="M9 3h6l-1 7 4 4v2h-5l-1 5-1-5H6v-2l4-4z" />
      </svg>
    </button>
  )
}

interface FieldProps {
  board: Board
}

function FolderSelect({ board }: FieldProps) {
  const folders = useStore((s) => s.folders)
  const known = board.folderId && folders[board.folderId] ? board.folderId : ''
  return (
    <select
      aria-label={`Folder for ${board.title}`}
      value={known}
      title={folderPath(folders, board.folderId) || 'Unfiled'}
      onChange={(e) => guard(() => updateBoards([board.id], { folderId: e.target.value || null }), "Couldn't move that board.")()}
    >
      <option value="">Unfiled</option>
      {folderOptions(folders).map((option) => (
        <option key={option.id} value={option.id}>{option.label}</option>
      ))}
    </select>
  )
}

function StatusSelect({ board }: FieldProps) {
  return (
    <select
      aria-label={`Status of ${board.title}`}
      className={board.status ? `status-${board.status}` : ''}
      value={board.status ?? ''}
      onChange={(e) => guard(() => updateBoards([board.id], { status: (e.target.value || null) as BoardStatus | null }), "Couldn't update that status.")()}
    >
      <option value="">No status</option>
      {Object.entries(STATUS_LABELS).map(([value, label]) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </select>
  )
}

function FormatSelect({ board }: FieldProps) {
  return (
    <select
      aria-label={`Format of ${board.title}`}
      value={board.format ?? ''}
      onChange={(e) => guard(() => updateBoards([board.id], { format: (e.target.value || null) as BoardFormat | null }), "Couldn't update that format.")()}
    >
      <option value="">No format</option>
      {Object.entries(FORMAT_LABELS).map(([value, label]) => (
        <option key={value} value={value}>{label}</option>
      ))}
    </select>
  )
}

function RowActions({ board }: FieldProps) {
  return (
    <>
      <button
        onClick={guard(async () => {
          const copy = await copyBoardTree(board.id, { title: `${board.title} copy`, parentBoardId: null, folderId: board.folderId, status: board.status })
          if (copy) showToast(`Created “${copy.title}”.`)
        }, "Couldn't duplicate that board.")}
      >
        Duplicate
      </button>
      <button className="danger-text" onClick={() => trashBoard(board.id)}>Trash</button>
    </>
  )
}

interface ListProps {
  boards: Board[]
  checked: Set<string>
  onCheck: (id: string, on: boolean) => void
  onCheckAll: (on: boolean) => void
}

export function BoardTable({ boards, checked, onCheck, onCheckAll }: ListProps) {
  const allChecked = boards.length > 0 && boards.every((b) => checked.has(b.id))
  return (
    <table className="board-table">
      <thead>
        <tr>
          <th className="col-check">
            <input type="checkbox" aria-label="Select all boards shown" checked={allChecked} onChange={(e) => onCheckAll(e.target.checked)} />
          </th>
          <th className="col-pin"><span className="sr-only">Pinned</span></th>
          <th>Name</th>
          <th className="col-folder">Folder</th>
          <th className="col-status">Status</th>
          <th className="col-format">Format</th>
          <th className="col-edited">Edited</th>
          <th className="col-actions"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {boards.map((board) => (
          <tr key={board.id} className={checked.has(board.id) ? 'checked' : ''}>
            <td className="col-check">
              <input type="checkbox" aria-label={`Select ${board.title}`} checked={checked.has(board.id)} onChange={(e) => onCheck(board.id, e.target.checked)} />
            </td>
            <td className="col-pin"><PinButton board={board} /></td>
            <td className="col-name"><a href={`#/b/${board.id}`}>{board.title}</a></td>
            <td className="col-folder"><FolderSelect board={board} /></td>
            <td className="col-status"><StatusSelect board={board} /></td>
            <td className="col-format"><FormatSelect board={board} /></td>
            <td className="col-edited"><time dateTime={board.updatedAt}>{editedLabel(board.updatedAt)}</time></td>
            <td className="col-actions"><RowActions board={board} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function BoardGrid({ boards, checked, onCheck }: Omit<ListProps, 'onCheckAll'>) {
  return (
    <div className="tiles">
      {boards.map((board) => (
        <article key={board.id} className={`tile${checked.has(board.id) ? ' checked' : ''}`}>
          <div className="tile-top">
            <input type="checkbox" aria-label={`Select ${board.title}`} checked={checked.has(board.id)} onChange={(e) => onCheck(board.id, e.target.checked)} />
            <PinButton board={board} />
          </div>
          <a className="tile-open" href={`#/b/${board.id}`}>
            <BoardPreview boardId={board.id} updatedAt={board.updatedAt} />
            <h3>{board.title}</h3>
            <time dateTime={board.updatedAt}>Edited {editedLabel(board.updatedAt)}</time>
          </a>
          <div className="tile-fields">
            <FolderSelect board={board} />
            <StatusSelect board={board} />
            <FormatSelect board={board} />
          </div>
          <div className="tile-actions"><RowActions board={board} /></div>
        </article>
      ))}
    </div>
  )
}
