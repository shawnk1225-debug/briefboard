import { useState } from 'react'
import { boardCount, childFolders, moveTargets, type HomeView } from '../lib/boardsView'
import { createFolder, deleteFolder, updateFolder, useStore } from '../store/store'
import type { Board, Folder } from '../types'
import { askConfirm, askInput, showToast } from '../ui/feedback'
import { useHomePrefs } from './homePrefs'

const failToast = (action: Promise<unknown>, message: string) =>
  action.catch((err) => {
    console.error(err)
    showToast(message)
  })

const sameView = (a: HomeView, b: HomeView) => a.kind === b.kind && (a.kind !== 'folder' || a.id === (b as { id: string }).id)

const TOP_LEVEL = '__top'

function FolderMenu({ folder, boards, onClose }: { folder: Folder; boards: Board[]; onClose: () => void }) {
  const folders = useStore((s) => s.folders)
  const run = (action: () => Promise<unknown>, failure: string) => () => {
    onClose()
    void failToast(action(), failure)
  }

  const rename = async () => {
    const name = await askInput({ title: 'Rename folder', label: 'Folder name', value: folder.name, confirmLabel: 'Rename' })
    if (name) await updateFolder(folder.id, { name })
  }

  const addBatch = async () => {
    const name = await askInput({ title: `New batch in ${folder.name}`, label: 'Batch name', value: '', confirmLabel: 'Create' })
    if (name) await createFolder(name, folder.id)
  }

  const move = async () => {
    const targets = moveTargets(folders, folder)
    const options = [
      ...(folder.parentId ? [{ value: TOP_LEVEL, label: 'Top level (its own product)' }] : []),
      ...targets.filter((t) => t.id !== folder.parentId).map((t) => ({ value: t.id, label: t.name })),
    ]
    if (!options.length) {
      showToast(childFolders(folders, folder.id).length ? 'A folder with batches inside has to stay at the top level.' : 'There is no other folder to move this into yet.')
      return
    }
    const choice = await askInput({ title: `Move ${folder.name}`, label: 'Move into', value: options[0].value, options, confirmLabel: 'Move' })
    if (choice) await updateFolder(folder.id, { parentId: choice === TOP_LEVEL ? null : choice })
  }

  const remove = async () => {
    const count = boardCount(boards, folders, { kind: 'folder', id: folder.id })
    const batches = childFolders(folders, folder.id).length
    const detail = [
      batches ? (batches === 1 ? 'Its batch will be removed too.' : `Its ${batches} batches will be removed too.`) : '',
      count ? (count === 1 ? 'Its 1 board moves to Unfiled and is not deleted.' : `Its ${count} boards move to Unfiled and are not deleted.`) : '',
    ]
      .filter(Boolean)
      .join(' ')
    if (!(await askConfirm(`Delete “${folder.name}”? ${detail}`.trim(), 'Delete folder'))) return
    await deleteFolder(folder.id)
    if (useHomePrefs.getState().view.kind === 'folder' && !useStore.getState().folders[(useHomePrefs.getState().view as { id: string }).id]) {
      useHomePrefs.setState({ view: { kind: 'all' } })
    }
  }

  return (
    <>
      <div className="menu-scrim" onPointerDown={onClose} />
      <div className="menu folder-menu" role="menu">
        <button role="menuitem" onClick={() => { onClose(); useHomePrefs.setState({ shareFolderId: folder.id }) }}>Share…</button>
        <button role="menuitem" onClick={run(rename, "Couldn't rename that folder.")}>Rename</button>
        {!folder.parentId && <button role="menuitem" onClick={run(addBatch, "Couldn't create that batch.")}>Add batch</button>}
        <button role="menuitem" onClick={run(move, "Couldn't move that folder.")}>Move</button>
        <hr />
        <button role="menuitem" className="danger-text" onClick={run(remove, "Couldn't delete that folder.")}>Delete</button>
      </div>
    </>
  )
}

function FolderRow({ folder, boards, depth }: { folder: Folder; boards: Board[]; depth: 0 | 1 }) {
  const folders = useStore((s) => s.folders)
  const view = useHomePrefs((s) => s.view)
  const collapsed = useHomePrefs((s) => s.collapsed)
  const [menuOpen, setMenuOpen] = useState(false)
  const children = childFolders(folders, folder.id)
  const isCollapsed = Boolean(collapsed[folder.id])
  const current = view.kind === 'folder' && view.id === folder.id

  const toggle = () => {
    const next = { ...collapsed }
    if (isCollapsed) delete next[folder.id]
    else next[folder.id] = true
    useHomePrefs.setState({ collapsed: next })
  }

  return (
    <li>
      <div className={`side-row${current ? ' current' : ''}${depth ? ' nested' : ''}`}>
        {children.length > 0 ? (
          <button className="side-chevron" aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${folder.name}`} aria-expanded={!isCollapsed} onClick={toggle}>
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="side-chevron" aria-hidden="true" />
        )}
        <button className="side-name" aria-current={current ? 'true' : undefined} onClick={() => useHomePrefs.setState({ view: { kind: 'folder', id: folder.id } })}>
          <span>{folder.name}</span>
          {folder.shareToken && <i className="shared-mark" title="Shared by secret link">Shared</i>}
          <em>{boardCount(boards, folders, { kind: 'folder', id: folder.id })}</em>
        </button>
        <div className="menu-wrap">
          <button className="side-more" aria-label={`Options for ${folder.name}`} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>⋯</button>
          {menuOpen && <FolderMenu folder={folder} boards={boards} onClose={() => setMenuOpen(false)} />}
        </div>
      </div>
      {children.length > 0 && !isCollapsed && (
        <ul>
          {children.map((child) => (
            <FolderRow key={child.id} folder={child} boards={boards} depth={1} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function HomeSidebar({ boards, trashCount }: { boards: Board[]; trashCount: number }) {
  const folders = useStore((s) => s.folders)
  const view = useHomePrefs((s) => s.view)
  const tops = childFolders(folders, null)

  const item = (target: HomeView, label: string, count?: number) => {
    const current = sameView(view, target)
    return (
      <li>
        <div className={`side-row${current ? ' current' : ''}`}>
          <span className="side-chevron" aria-hidden="true" />
          <button className="side-name" aria-current={current ? 'true' : undefined} onClick={() => useHomePrefs.setState({ view: target })}>
            <span>{label}</span>
            {count !== undefined && <em>{count}</em>}
          </button>
        </div>
      </li>
    )
  }

  const newFolder = () =>
    failToast(
      (async () => {
        const name = await askInput({ title: 'New product folder', label: 'Folder name', value: '', confirmLabel: 'Create' })
        if (name) useHomePrefs.setState({ view: { kind: 'folder', id: (await createFolder(name, null)).id } })
      })(),
      "Couldn't create that folder.",
    )

  return (
    <nav className="home-side" aria-label="Folders">
      <ul>
        {item({ kind: 'all' }, 'All boards', boardCount(boards, folders, { kind: 'all' }))}
        {item({ kind: 'unfiled' }, 'Unfiled', boardCount(boards, folders, { kind: 'unfiled' }))}
      </ul>
      <div className="side-head">
        <h2>Folders</h2>
        <button className="link-btn" onClick={() => void newFolder()}>+ New folder</button>
      </div>
      {tops.length ? (
        <ul>
          {tops.map((folder) => (
            <FolderRow key={folder.id} folder={folder} boards={boards} depth={0} />
          ))}
        </ul>
      ) : (
        <p className="side-empty">Add a folder for each product, then batches inside it.</p>
      )}
      <hr />
      <ul>
        {item({ kind: 'templates' }, 'Templates')}
        {item({ kind: 'trash' }, 'Trash', trashCount)}
      </ul>
    </nav>
  )
}
