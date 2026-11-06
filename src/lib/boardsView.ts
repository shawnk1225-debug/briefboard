import type { Board, BoardFormat, BoardStatus, Folder } from '../types'

export type HomeView =
  | { kind: 'all' }
  | { kind: 'unfiled' }
  | { kind: 'folder'; id: string }
  | { kind: 'templates' }
  | { kind: 'trash' }

export type SortOrder = 'edited' | 'name' | 'oldest'

export interface BoardFilters {
  query: string
  status: BoardStatus | 'any' | 'none'
  format: BoardFormat | 'any' | 'none'
  sort: SortOrder
}

export const STATUS_LABELS: Record<BoardStatus, string> = {
  draft: 'Draft',
  in_production: 'In production',
  live: 'Live',
  done: 'Done',
}

export const FORMAT_LABELS: Record<BoardFormat, string> = { video: 'Video', static: 'Static' }

type Folders = Record<string, Folder>

// So "Batch 2" comes before "Batch 10".
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

// Everyday boards: not trashed, not templates, not nested inside another board.
export const activeBoards = (boards: Board[]) => boards.filter((b) => !b.deletedAt && !b.isTemplate && !b.parentBoardId)

export const childFolders = (folders: Folders, parentId: string | null) =>
  Object.values(folders)
    .filter((f) => (f.parentId ?? null) === parentId)
    .sort((a, b) => byName(a.name, b.name))

// A product folder's view also includes the boards in its batches.
export function folderAndChildren(folders: Folders, id: string): Set<string> {
  return new Set([id, ...childFolders(folders, id).map((f) => f.id)])
}

export function folderPath(folders: Folders, id: string | null): string {
  const folder = id ? folders[id] : undefined
  if (!folder) return ''
  const parent = folder.parentId ? folders[folder.parentId] : undefined
  return parent ? `${parent.name} / ${folder.name}` : folder.name
}

export function viewBoards(boards: Board[], folders: Folders, view: HomeView): Board[] {
  const active = activeBoards(boards)
  if (view.kind === 'unfiled') return active.filter((b) => !b.folderId || !folders[b.folderId])
  if (view.kind === 'folder') {
    const ids = folderAndChildren(folders, view.id)
    return active.filter((b) => b.folderId && ids.has(b.folderId))
  }
  return active
}

export function filterAndSort(boards: Board[], filters: BoardFilters): Board[] {
  const needle = filters.query.trim().toLowerCase()
  const matching = boards.filter((b) => {
    if (needle && !b.title.toLowerCase().includes(needle)) return false
    if (filters.status === 'none' ? b.status : filters.status !== 'any' && b.status !== filters.status) return false
    if (filters.format === 'none' ? b.format : filters.format !== 'any' && b.format !== filters.format) return false
    return true
  })
  return matching.sort((a, b) => {
    if (filters.sort === 'name') return byName(a.title, b.title)
    return filters.sort === 'oldest' ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt)
  })
}

export function pinnedBoards(boards: Board[], pins: Record<string, true>): Board[] {
  return activeBoards(boards)
    .filter((b) => pins[b.id])
    .sort((a, b) => byName(a.title, b.title))
}

// Where a folder can move to, keeping to two levels: a folder with batches inside must stay
// at the top, and anything else can sit under any other top-level folder.
export function moveTargets(folders: Folders, folder: Folder): Folder[] {
  if (childFolders(folders, folder.id).length) return []
  return childFolders(folders, null).filter((f) => f.id !== folder.id)
}

// Folder choices for a dropdown. Batches show their product, because "Batch 1" alone
// could be in any product.
export function folderOptions(folders: Folders): { id: string; label: string }[] {
  return childFolders(folders, null).flatMap((top) => [
    { id: top.id, label: top.name },
    ...childFolders(folders, top.id).map((child) => ({ id: child.id, label: `${top.name} / ${child.name}` })),
  ])
}

export function boardCount(boards: Board[], folders: Folders, view: HomeView): number {
  return viewBoards(boards, folders, view).length
}
