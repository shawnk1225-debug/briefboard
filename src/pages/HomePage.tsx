import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { backend } from '../data/backend'
import { supabase } from '../data/supabaseBackend'
import {
  filterAndSort,
  folderOptions,
  folderPath,
  FORMAT_LABELS,
  pinnedBoards,
  STATUS_LABELS,
  viewBoards,
  type BoardFilters,
} from '../lib/boardsView'
import { navigate } from '../lib/route'
import { BUILTIN_TEMPLATES, createFromBuiltin } from '../lib/templates'
import { copyBoardTree } from '../store/copy'
import { createBoard, deleteBoardForever, setPinned, trashBoard, updateBoard, updateBoards, useStore } from '../store/store'
import type { Board, BoardFormat, BoardStatus } from '../types'
import { askConfirm, askInput, showToast } from '../ui/feedback'
import { SearchIcon } from '../ui/icons'
import { openSearch } from '../ui/SearchDialog'
import { BoardGrid, BoardTable, guard } from './BoardList'
import { HomeSidebar } from './HomeSidebar'
import { useHomePrefs } from './homePrefs'
import { ShareDialog } from './ShareDialog'
import { TeamDialog } from './TeamDialog'

const byNewest = (a: Board, b: Board) => b.updatedAt.localeCompare(a.updatedAt)

function NewBoardMenu({ folderId, templates }: { folderId: string | null; templates: Board[] }) {
  const [open, setOpen] = useState(false)
  const run = (action: () => Promise<unknown>) => () => {
    setOpen(false)
    guard(action, "Couldn't create that board.")()
  }
  return (
    <div className="menu-wrap">
      <button className="btn primary" aria-expanded={open} onClick={() => setOpen(!open)}>New board ▾</button>
      {open && (
        <>
          <div className="menu-scrim" onPointerDown={() => setOpen(false)} />
          <div className="menu" role="menu">
            <button role="menuitem" onClick={run(async () => navigate(`/b/${(await createBoard({ folderId })).id}`))}>Blank board</button>
            <hr />
            {BUILTIN_TEMPLATES.map((template) => (
              <button key={template.id} role="menuitem" onClick={run(async () => navigate(`/b/${(await createFromBuiltin(template, { folderId })).id}`))}>
                {template.title}
              </button>
            ))}
            {templates.map((template) => (
              <button
                key={template.id}
                role="menuitem"
                onClick={run(async () => {
                  const board = await copyBoardTree(template.id, { parentBoardId: null, isTemplate: false, folderId })
                  if (board) navigate(`/b/${board.id}`)
                })}
              >
                {template.title}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function Pinned({ boards }: { boards: Board[] }) {
  if (!boards.length) return null
  return (
    <section className="pinned" aria-label="Pinned boards">
      <h2>Pinned</h2>
      <ul>
        {boards.map((board) => (
          <li key={board.id}>
            <a href={`#/b/${board.id}`}>{board.title}</a>
            <button
              aria-label={`Unpin ${board.title}`}
              title="Unpin"
              onClick={guard(() => setPinned(board.id, false), "Couldn't update that pin.")}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function BoardToolbar() {
  const { query, sort, status, format, layout } = useHomePrefs()
  return (
    <div className="board-toolbar">
      <input
        className="filter-input"
        type="search"
        placeholder="Filter by name"
        aria-label="Filter boards by name"
        value={query}
        onChange={(e) => useHomePrefs.setState({ query: e.target.value })}
      />
      <label>
        Sort
        <select value={sort} onChange={(e) => useHomePrefs.setState({ sort: e.target.value as BoardFilters['sort'] })}>
          <option value="edited">Last edited</option>
          <option value="name">Name</option>
          <option value="oldest">Oldest edited</option>
        </select>
      </label>
      <label>
        Status
        <select value={status} onChange={(e) => useHomePrefs.setState({ status: e.target.value as BoardFilters['status'] })}>
          <option value="any">Any</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
          <option value="none">No status</option>
        </select>
      </label>
      <label>
        Format
        <select value={format} onChange={(e) => useHomePrefs.setState({ format: e.target.value as BoardFilters['format'] })}>
          <option value="any">Any</option>
          {Object.entries(FORMAT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
          <option value="none">No format</option>
        </select>
      </label>
      <div className="layout-toggle" role="group" aria-label="Layout">
        <button aria-pressed={layout === 'list'} onClick={() => useHomePrefs.setState({ layout: 'list' })}>List</button>
        <button aria-pressed={layout === 'grid'} onClick={() => useHomePrefs.setState({ layout: 'grid' })}>Grid</button>
      </div>
    </div>
  )
}

function BulkBar({ ids, onClear }: { ids: string[]; onClear: () => void }) {
  const folders = useStore((s) => s.folders)
  const noun = ids.length === 1 ? 'board' : 'boards'

  const move = guard(async () => {
    const options = [{ value: '', label: 'Unfiled' }, ...folderOptions(folders).map((o) => ({ value: o.id, label: o.label }))]
    const choice = await askInput({ title: `Move ${ids.length} ${noun}`, label: 'Move to', value: '', options, confirmLabel: 'Move' })
    if (choice === null) return
    await updateBoards(ids, { folderId: choice || null })
    showToast(`Moved ${ids.length} ${noun} to ${folderPath(folders, choice) || 'Unfiled'}.`)
    onClear()
  }, "Couldn't move those boards. Nothing was lost; try again.")

  const setStatus = guard(async () => {
    const options = [{ value: '', label: 'No status' }, ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))]
    const choice = await askInput({ title: `Set status for ${ids.length} ${noun}`, label: 'Status', value: 'draft', options, confirmLabel: 'Set status' })
    if (choice === null) return
    await updateBoards(ids, { status: (choice || null) as BoardStatus | null })
    onClear()
  }, "Couldn't update those boards. Nothing was lost; try again.")

  const setFormat = guard(async () => {
    const options = [{ value: '', label: 'No format' }, ...Object.entries(FORMAT_LABELS).map(([value, label]) => ({ value, label }))]
    const choice = await askInput({ title: `Set format for ${ids.length} ${noun}`, label: 'Format', value: 'video', options, confirmLabel: 'Set format' })
    if (choice === null) return
    await updateBoards(ids, { format: (choice || null) as BoardFormat | null })
    onClear()
  }, "Couldn't update those boards. Nothing was lost; try again.")

  const trash = guard(async () => {
    await updateBoards(ids, { deletedAt: new Date().toISOString() })
    showToast(`Moved ${ids.length} ${noun} to Trash.`)
    onClear()
  }, "Couldn't move those boards to Trash.")

  return (
    <div className="floating-bar bulk-bar" role="toolbar" aria-label="Bulk actions">
      <span className="count">{ids.length} selected</span>
      <span className="sep" />
      <button onClick={move}>Move</button>
      <button onClick={setStatus}>Status</button>
      <button onClick={setFormat}>Format</button>
      <button className="danger-text" onClick={trash}>Trash</button>
      <span className="sep" />
      <button onClick={onClear}>Clear</button>
    </div>
  )
}

function TemplatesView({ templates }: { templates: Board[] }) {
  return (
    <section>
      <h2 className="view-title">Templates</h2>
      <p className="muted view-sub">Open any board's menu and choose “Save as template” to add your own.</p>
      <div className="tiles">
        {BUILTIN_TEMPLATES.map((template) => (
          <article key={template.id} className="tile template">
            <h3>{template.title}</h3>
            <p>{template.description}</p>
            <button className="btn" onClick={guard(async () => navigate(`/b/${(await createFromBuiltin(template)).id}`), "Couldn't use that template.")}>
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
                }, "Couldn't use that template.")}
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
  )
}

function TrashView({ trash }: { trash: Board[] }) {
  return (
    <section>
      <h2 className="view-title">Trash</h2>
      <ul className="trash-list">
        {trash.map((board) => (
          <li key={board.id}>
            <span>{board.title}</span>
            <div className="tile-buttons">
              <button className="btn" title="Restores to your main boards list" onClick={() => updateBoard(board.id, { deletedAt: null, parentBoardId: null })}>
                Restore
              </button>
              <button
                className="btn danger-text"
                onClick={guard(async () => {
                  const ok = await askConfirm(`Permanently delete “${board.title}” and everything inside it? This can't be undone.`, 'Delete forever')
                  if (ok) await deleteBoardForever(board.id)
                }, "Couldn't delete that board.")}
              >
                Delete forever
              </button>
            </div>
          </li>
        ))}
        {!trash.length && <li className="muted">Trash is empty.</li>}
      </ul>
    </section>
  )
}

export function HomePage() {
  const boardsById = useStore((s) => s.boards)
  const folders = useStore((s) => s.folders)
  const pins = useStore((s) => s.pins)
  const prefs = useHomePrefs()
  const [showTeam, setShowTeam] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())

  const boards = useMemo(() => Object.values(boardsById), [boardsById])
  const view = prefs.view.kind === 'folder' && !folders[prefs.view.id] ? ({ kind: 'all' } as const) : prefs.view

  const templates = useMemo(() => boards.filter((b) => !b.deletedAt && b.isTemplate).sort(byNewest), [boards])
  const trash = useMemo(
    () => boards.filter((b) => b.deletedAt).sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')),
    [boards],
  )
  const inView = useMemo(() => viewBoards(boards, folders, view), [boards, folders, view])
  // Typing stays instant on a long list: the rows catch up a moment after the keystroke.
  const query = useDeferredValue(prefs.query)
  const shown = useMemo(
    () => filterAndSort(inView, { query, status: prefs.status, format: prefs.format, sort: prefs.sort }),
    [inView, query, prefs.status, prefs.format, prefs.sort],
  )
  const pinned = useMemo(() => pinnedBoards(boards, pins), [boards, pins])

  // Ticks never carry over to another folder, where you couldn't see what they apply to.
  const viewKey = view.kind === 'folder' ? view.id : view.kind
  useEffect(() => setChecked(new Set()), [viewKey])

  const onCheck = (id: string, on: boolean) =>
    setChecked((current) => {
      const next = new Set(current)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  // Only boards still on screen count, so a filter or a teammate's change can't affect hidden ones.
  const checkedIds = shown.filter((b) => checked.has(b.id)).map((b) => b.id)
  const isBoardsView = view.kind !== 'templates' && view.kind !== 'trash'
  const filtering = Boolean(prefs.query.trim()) || prefs.status !== 'any' || prefs.format !== 'any'
  const folderId = view.kind === 'folder' ? view.id : null
  const title = view.kind === 'folder' ? folderPath(folders, view.id) : view.kind === 'unfiled' ? 'Unfiled' : 'All boards'

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
          <span><strong>Browser-only mode.</strong> Boards are saved in this browser, not the cloud, and teammates can't see them. Connect Supabase to turn on login and team sync.</span>
        </div>
      )}

      <div className="home-layout">
        <HomeSidebar boards={boards} trashCount={trash.length} />
        <main className="home-main">
          <Pinned boards={pinned} />
          {view.kind === 'templates' && <TemplatesView templates={templates} />}
          {view.kind === 'trash' && <TrashView trash={trash} />}
          {isBoardsView && (
            <section>
              <div className="section-head">
                <h2 className="view-title">{title}</h2>
                <span className="muted" role="status">
                  {filtering ? `${shown.length} of ${inView.length}` : `${inView.length}`} {inView.length === 1 ? 'board' : 'boards'}
                </span>
                <div className="section-buttons">
                  {folderId && (
                    <button className="btn" onClick={() => useHomePrefs.setState({ shareFolderId: folderId })}>
                      {folders[folderId]?.shareToken ? 'Shared' : 'Share'}
                    </button>
                  )}
                  <NewBoardMenu folderId={folderId} templates={templates} />
                </div>
              </div>
              <BoardToolbar />
              {shown.length > 0 && prefs.layout === 'list' && (
                <BoardTable
                  boards={shown}
                  checked={checked}
                  onCheck={onCheck}
                  onCheckAll={(on) => setChecked(on ? new Set(shown.map((b) => b.id)) : new Set())}
                />
              )}
              {shown.length > 0 && prefs.layout === 'grid' && <BoardGrid boards={shown} checked={checked} onCheck={onCheck} />}
              {!shown.length && (
                <div className="empty-list">
                  {filtering ? (
                    <>
                      <p>No boards match.</p>
                      <button className="btn" onClick={() => useHomePrefs.setState({ query: '', status: 'any', format: 'any' })}>Clear filters</button>
                    </>
                  ) : (
                    <p>{view.kind === 'folder' ? 'No boards in this folder yet. New boards you create here land in it.' : 'No boards here yet.'}</p>
                  )}
                </div>
              )}
              {checkedIds.length > 0 && <BulkBar ids={checkedIds} onClear={() => setChecked(new Set())} />}
            </section>
          )}
        </main>
      </div>

      {showTeam && <TeamDialog onClose={() => setShowTeam(false)} />}
      {prefs.shareFolderId && folders[prefs.shareFolderId] && (
        <ShareDialog folder={folders[prefs.shareFolderId]} onClose={() => useHomePrefs.setState({ shareFolderId: null })} />
      )}
    </div>
  )
}
