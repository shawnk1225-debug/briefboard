import { useRef, useState } from 'react'
import { boardCount, childFolders } from '../lib/boardsView'
import { updateFolder, useStore } from '../store/store'
import type { Folder } from '../types'
import { showToast } from '../ui/feedback'

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export const shareUrl = (token: string) => `${window.location.origin}${window.location.pathname}#/s/${token}`

export function ShareDialog({ folder, onClose }: { folder: Folder; onClose: () => void }) {
  const folders = useStore((s) => s.folders)
  const boards = useStore((s) => s.boards)
  const current = folders[folder.id] ?? folder
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const count = boardCount(Object.values(boards), folders, { kind: 'folder', id: folder.id })
  const batches = childFolders(folders, folder.id).length
  const link = current.shareToken ? shareUrl(current.shareToken) : null

  const setToken = async (shareToken: string | null) => {
    setBusy(true)
    try {
      await updateFolder(folder.id, { shareToken })
    } catch (err) {
      console.error(err)
      showToast("Couldn't change that link. Nothing was shared; try again.")
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      showToast('Link copied.')
    } catch {
      inputRef.current?.select()
      showToast('Press Cmd+C to copy the link.')
    }
  }

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog share-dialog" role="dialog" aria-modal="true" aria-label={`Share ${folder.name}`}>
        <h2>Share “{folder.name}”</h2>
        <p className="muted">
          Anyone with the link can view and comment, with no account. They can't change anything or see your other boards.
        </p>
        {link ? (
          <>
            <div className="share-link">
              <input ref={inputRef} readOnly aria-label="Secret link" value={link} onFocus={(e) => e.target.select()} />
              <button className="btn primary" onClick={() => void copy()}>Copy</button>
            </div>
            <ul className="share-notes">
              <li>
                {count === 1 ? 'Shows 1 board' : `Shows ${count} boards`}
                {batches ? `, including its ${batches === 1 ? 'batch' : `${batches} batches`}` : ''}, along with images and files.
              </li>
              <li>Boards you add to this folder later appear too.</li>
              <li>They see every comment except ones marked <strong>Team only</strong>.</li>
              <li>Anyone you forward it to gets the same access, so send it with care.</li>
            </ul>
          </>
        ) : (
          <p>This folder isn't shared. No one outside your team can see it.</p>
        )}
        <div className="dialog-actions">
          {link ? (
            <button className="btn danger-text" disabled={busy} title="The link stops working right away. Turning it back on makes a new link." onClick={() => void setToken(null)}>
              Turn off link
            </button>
          ) : (
            <button className="btn primary" disabled={busy} onClick={() => void setToken(newToken())}>Turn on link</button>
          )}
          <button className="btn" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
