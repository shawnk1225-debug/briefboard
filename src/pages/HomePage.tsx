import { useState } from 'react'
import { backend } from '../data/backend'
import { supabase } from '../data/supabaseBackend'
import { navigate } from '../lib/route'
import { BUILTIN_TEMPLATES, createFromBuiltin } from '../lib/templates'
import { copyBoardTree } from '../store/copy'
import { createBoard, deleteBoardForever, trashBoard, updateBoard, useStore } from '../store/store'
import type { Board } from '../types'
import { askConfirm, showToast } from '../ui/feedback'
import { SearchIcon } from '../ui/icons'
import { openSearch } from '../ui/SearchDialog'
import { TeamDialog } from './TeamDialog'

const byNewest = (a: Board, b: Board) => b.updatedAt.localeCompare(a.updatedAt)

const guard = (action: () => Promise<unknown>, failure: string) => () => {
  action().catch((err) => {
    console.error(err)
    showToast(failure)
  })
}

function BoardTile({ board }: { board: Board }) {
  return (
    <article className="tile">
      <a className="tile-open" href={`#/b/${board.id}`}>
        <span className="tile-art" aria-hidden="true">
          <i /><i /><i />
        </span>
        <h3>{board.title}</h3>
        <time dateTime={board.updatedAt}>Updated {new Date(board.updatedAt).toLocaleDateString()}</time>
      </a>
      <div className="tile-actions">
        <button
          onClick={guard(async () => {
            const copy = await copyBoardTree(board.id, { title: `${board.title} copy`, parentBoardId: null })
            if (copy) showToast(`Created “${copy.title}”.`)
          }, 'Could not duplicate that board.')}
        >
          Duplicate
        </button>
        <button className="danger-text" onClick={() => trashBoard(board.id)}>
          Trash
        </button>
      </div>
    </article>
  )
}

export function HomePage() {
  const boards = useStore((s) => s.boards)
  const [showTrash, setShowTrash] = useState(false)
  const [showTeam, setShowTeam] = useState(false)

  const all = Object.values(boards)
  const active = all.filter((b) => !b.deletedAt && !b.parentBoardId && !b.isTemplate).sort(byNewest)
  const templates = all.filter((b) => !b.deletedAt && b.isTemplate).sort(byNewest)
  const trash = all.filter((b) => b.deletedAt).sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''))

  return (
    <div className="home">
      <header className="home-head">
        <h1 className="brand">Briefboard</h1>
        <div className="home-actions">
          <button className="btn" onClick={openSearch}>
            <SearchIcon /> Search
          </button>
          {supabase && (
            <>
              <button className="btn" onClick={() => setShowTeam(true)}>Team</button>
              <button className="btn" onClick={() => void supabase!.auth.signOut()}>Sign out</button>
            </>
          )}
        </div>
      </header>

      {backend.mode === 'local' && (
        <div className="banner">
          <strong>Browser-only mode.</strong> Boards are saved in this browser, not the cloud, and teammates can't see them.
          Connect Supabase to turn on login and team sync.
        </div>
      )}

      <section>
        <div className="section-head">
          <h2>Boards</h2>
          <button
            className="btn primary"
            onClick={guard(async () => navigate(`/b/${(await createBoard()).id}`), 'Could not create a board.')}
          >
            New board
          </button>
        </div>
        {active.length ? (
          <div className="tiles">
            {active.map((board) => (
              <BoardTile key={board.id} board={board} />
            ))}
          </div>
        ) : (
          <p className="muted">No boards yet. Start a blank one, or use a template below.</p>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>Templates</h2>
          <span className="muted">Open any board's menu and choose “Save as template” to add your own.</span>
        </div>
        <div className="tiles">
          {BUILTIN_TEMPLATES.map((template) => (
            <article key={template.id} className="tile template">
              <h3>{template.title}</h3>
              <p>{template.description}</p>
              <button
                className="btn"
                onClick={guard(async () => navigate(`/b/${(await createFromBuiltin(template)).id}`), 'Could not use that template.')}
              >
                Use template
              </button>
            </article>
          ))}
          {templates.map((template) => (
            <article key={template.id} className="tile template">
              <h3>{template.title}</h3>
              <p>Your template</p>
              <div className="tile-buttons">
                <button
                  className="btn"
                  onClick={guard(async () => {
                    const board = await copyBoardTree(template.id, { parentBoardId: null, isTemplate: false })
                    if (board) navigate(`/b/${board.id}`)
                  }, 'Could not use that template.')}
                >
                  Use template
                </button>
                <a className="btn" href={`#/b/${template.id}`}>Edit</a>
                <button className="btn danger-text" onClick={() => trashBoard(template.id)}>Trash</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section>
        <button className="link-btn" aria-expanded={showTrash} onClick={() => setShowTrash(!showTrash)}>
          {showTrash ? 'Hide' : 'Show'} Trash ({trash.length})
        </button>
        {showTrash && (
          <ul className="trash-list">
            {trash.map((board) => (
              <li key={board.id}>
                <span>{board.title}</span>
                <div className="tile-buttons">
                  <button
                    className="btn"
                    title="Restores to your main boards list"
                    onClick={() => updateBoard(board.id, { deletedAt: null, parentBoardId: null })}
                  >
                    Restore
                  </button>
                  <button
                    className="btn danger-text"
                    onClick={guard(async () => {
                      const ok = await askConfirm(`Permanently delete “${board.title}” and everything inside it? This can't be undone.`, 'Delete forever')
                      if (ok) await deleteBoardForever(board.id)
                    }, 'Could not delete that board.')}
                  >
                    Delete forever
                  </button>
                </div>
              </li>
            ))}
            {!trash.length && <li className="muted">Trash is empty.</li>}
          </ul>
        )}
      </section>

      {showTeam && <TeamDialog onClose={() => setShowTeam(false)} />}
    </div>
  )
}
