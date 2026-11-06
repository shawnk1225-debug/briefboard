import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { backend } from '../src/data/backend'
import { fetchAllPages } from '../src/data/supabaseBackend'
import {
  activeBoards,
  boardCount,
  filterAndSort,
  folderOptions,
  folderPath,
  moveTargets,
  pinnedBoards,
  viewBoards,
  type BoardFilters,
} from '../src/lib/boardsView'
import { BUILTIN_TEMPLATES, createFromBuiltin } from '../src/lib/templates'
import { copyBoardTree } from '../src/store/copy'
import { createBoard, createFolder, deleteFolder, loadBoards, setPinned, updateBoards, useStore } from '../src/store/store'
import type { Board, Folder } from '../src/types'

const board = (over: Partial<Board>): Board => ({
  id: crypto.randomUUID(),
  parentBoardId: null,
  title: 'Board',
  isTemplate: false,
  deletedAt: null,
  updatedAt: '2026-01-01T00:00:00.000Z',
  folderId: null,
  status: null,
  format: null,
  ...over,
})

const folders: Record<string, Folder> = {
  a: { id: 'a', parentId: null, name: 'Product A' },
  a1: { id: 'a1', parentId: 'a', name: 'Batch 10' },
  a2: { id: 'a2', parentId: 'a', name: 'Batch 2' },
  b: { id: 'b', parentId: null, name: 'Product B' },
}

const filters = (over: Partial<BoardFilters> = {}): BoardFilters => ({ query: '', status: 'any', format: 'any', sort: 'edited', ...over })

describe('fetchAllPages', () => {
  const server = (total: number, cap: number) => {
    const calls: [number, number][] = []
    const fetchPage = async (from: number, to: number) => {
      calls.push([from, to])
      const end = Math.min(total, Math.min(to + 1, from + cap))
      return Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i)
    }
    return { calls, fetchPage }
  }

  it('gets every row past the 1,000 limit, with none missing or repeated', async () => {
    const { fetchPage } = server(2500, 1000)
    const rows = await fetchAllPages(fetchPage)
    expect(rows).toHaveLength(2500)
    expect(new Set(rows).size).toBe(2500)
  })

  it('still gets everything when the server caps pages lower than asked', async () => {
    const { fetchPage } = server(1205, 300)
    expect(await fetchAllPages(fetchPage)).toHaveLength(1205)
  })

  it('handles an exact multiple of the page size, and nothing at all', async () => {
    expect(await fetchAllPages(server(2000, 1000).fetchPage)).toHaveLength(2000)
    expect(await fetchAllPages(server(0, 1000).fetchPage)).toEqual([])
  })

  it('passes on a failed page rather than returning a partial list', async () => {
    let calls = 0
    const failing = async () => {
      calls += 1
      if (calls === 2) throw new Error('network')
      return [1, 2, 3]
    }
    await expect(fetchAllPages(failing)).rejects.toThrow('network')
  })
})

describe('which boards a view shows', () => {
  const inProduct = board({ title: 'In product', folderId: 'a' })
  const inBatch = board({ title: 'In batch', folderId: 'a1' })
  const inOther = board({ title: 'Other product', folderId: 'b' })
  const unfiled = board({ title: 'Unfiled' })
  const orphan = board({ title: 'Folder gone', folderId: 'deleted-folder' })
  const hidden = [
    board({ title: 'Trashed', deletedAt: '2026-01-02T00:00:00.000Z', folderId: 'a' }),
    board({ title: 'Template', isTemplate: true, folderId: 'a' }),
    board({ title: 'Nested', parentBoardId: 'x', folderId: 'a' }),
  ]
  const all = [inProduct, inBatch, inOther, unfiled, orphan, ...hidden]
  const titles = (list: Board[]) => list.map((b) => b.title).sort()

  it('leaves out trashed, template and nested boards', () => {
    expect(activeBoards(all)).toHaveLength(5)
  })

  it('includes batch boards in their product folder', () => {
    expect(titles(viewBoards(all, folders, { kind: 'folder', id: 'a' }))).toEqual(['In batch', 'In product'])
  })

  it('shows only that batch in a batch folder', () => {
    expect(titles(viewBoards(all, folders, { kind: 'folder', id: 'a1' }))).toEqual(['In batch'])
  })

  it('never loses a board whose folder has gone: it counts as unfiled', () => {
    expect(titles(viewBoards(all, folders, { kind: 'unfiled' }))).toEqual(['Folder gone', 'Unfiled'])
  })

  it('counts match what is shown', () => {
    expect(boardCount(all, folders, { kind: 'all' })).toBe(5)
    expect(boardCount(all, folders, { kind: 'folder', id: 'a' })).toBe(2)
  })
})

describe('filtering and sorting', () => {
  const list = [
    board({ title: 'Hook test 10', updatedAt: '2026-03-01T00:00:00.000Z', status: 'draft', format: 'video' }),
    board({ title: 'hook test 2', updatedAt: '2026-01-01T00:00:00.000Z', status: 'live', format: 'static' }),
    board({ title: 'Offer test', updatedAt: '2026-02-01T00:00:00.000Z' }),
  ]
  const titles = (f: Partial<BoardFilters>) => filterAndSort([...list], filters(f)).map((b) => b.title)

  it('matches names regardless of case, and trims spaces', () => {
    expect(titles({ query: '  HOOK ' })).toEqual(['Hook test 10', 'hook test 2'])
    expect(titles({ query: 'zzz' })).toEqual([])
  })

  it('treats search characters as plain text', () => {
    expect(filterAndSort([board({ title: '50% off (v2)' }), board({ title: 'Other' })], filters({ query: '% off (' }))).toHaveLength(1)
  })

  it('filters by status and format, including boards with none', () => {
    expect(titles({ status: 'live' })).toEqual(['hook test 2'])
    expect(titles({ format: 'video' })).toEqual(['Hook test 10'])
    expect(titles({ status: 'none' })).toEqual(['Offer test'])
    expect(titles({ format: 'none' })).toEqual(['Offer test'])
    expect(titles({ status: 'draft', format: 'static' })).toEqual([])
  })

  it('sorts by last edited, oldest and name, with numbers in natural order', () => {
    expect(titles({ sort: 'edited' })).toEqual(['Hook test 10', 'Offer test', 'hook test 2'])
    expect(titles({ sort: 'oldest' })).toEqual(['hook test 2', 'Offer test', 'Hook test 10'])
    expect(titles({ sort: 'name' })).toEqual(['hook test 2', 'Hook test 10', 'Offer test'])
  })
})

describe('folder helpers', () => {
  it('builds a readable path, and copes with missing folders', () => {
    expect(folderPath(folders, 'a1')).toBe('Product A / Batch 10')
    expect(folderPath(folders, 'a')).toBe('Product A')
    expect(folderPath(folders, null)).toBe('')
    expect(folderPath(folders, 'gone')).toBe('')
  })

  it('lists batches under their product, in natural order', () => {
    expect(folderOptions(folders).map((o) => o.label)).toEqual(['Product A', 'Product A / Batch 2', 'Product A / Batch 10', 'Product B'])
  })

  it('keeps folder moves within two levels', () => {
    expect(moveTargets(folders, folders.a)).toEqual([])
    expect(moveTargets(folders, folders.b).map((f) => f.id)).toEqual(['a'])
    expect(moveTargets(folders, folders.a1).map((f) => f.id)).toEqual(['a', 'b'])
  })
})

describe('pinned boards', () => {
  it('leave the list when trashed, and come back in name order', () => {
    const a = board({ title: 'Zed' })
    const b = board({ title: 'Alpha' })
    const trashed = board({ title: 'Gone', deletedAt: '2026-01-02T00:00:00.000Z' })
    const pins = { [a.id]: true, [b.id]: true, [trashed.id]: true } as Record<string, true>
    expect(pinnedBoards([a, b, trashed], pins).map((x) => x.title)).toEqual(['Alpha', 'Zed'])
  })
})

describe('saving folders, labels and pins', () => {
  const stored = async (id: string) => (await backend.listBoards()).find((b) => b.id === id)!

  it('moves and labels many boards at once, without changing their last edited date', async () => {
    const folder = await createFolder('Product', null)
    const a = await createBoard({ title: 'A' })
    const b = await createBoard({ title: 'B' })
    const untouched = await createBoard({ title: 'C' })
    await updateBoards([a.id, b.id], { folderId: folder.id, status: 'live' })
    expect(useStore.getState().boards[a.id]).toMatchObject({ folderId: folder.id, status: 'live' })
    expect(await stored(b.id)).toMatchObject({ folderId: folder.id, status: 'live', updatedAt: b.updatedAt })
    expect(await stored(untouched.id)).toMatchObject({ folderId: null, status: null })
  })

  it('makes deleted folder boards unfiled, including those in batches, and keeps them', async () => {
    const product = await createFolder('Product', null)
    const batch = await createFolder('Batch 1', product.id)
    const a = await createBoard({ title: 'In product', folderId: product.id })
    const b = await createBoard({ title: 'In batch', folderId: batch.id })
    await deleteFolder(product.id)
    expect(useStore.getState().folders[product.id]).toBeUndefined()
    expect(useStore.getState().folders[batch.id]).toBeUndefined()
    expect(await stored(a.id)).toMatchObject({ title: 'In product', folderId: null, deletedAt: null })
    expect(await stored(b.id)).toMatchObject({ title: 'In batch', folderId: null, deletedAt: null })
  })

  it('remembers pins after reloading', async () => {
    const a = await createBoard({ title: 'Pin me' })
    await setPinned(a.id, true)
    await setPinned(a.id, true)
    await loadBoards()
    expect(useStore.getState().pins[a.id]).toBe(true)
    await setPinned(a.id, false)
    await loadBoards()
    expect(useStore.getState().pins[a.id]).toBeUndefined()
  })

  it('reads boards saved before folders and labels existed', async () => {
    const a = await createBoard({ title: 'Old' })
    const { folderId: _f, status: _s, format: _m, ...old } = a
    await backend.insertBoard(old as Board)
    expect(await stored(a.id)).toMatchObject({ folderId: null, status: null, format: null })
  })

  it('sets the format from the template, and files new boards in the chosen folder', async () => {
    const folder = await createFolder('Product', null)
    const video = BUILTIN_TEMPLATES.find((t) => t.format === 'video')!
    const fromTemplate = await createFromBuiltin(video, { folderId: folder.id })
    expect(fromTemplate).toMatchObject({ format: 'video', folderId: folder.id, status: null })
    const copy = (await copyBoardTree(fromTemplate.id, { folderId: null }))!
    expect(copy).toMatchObject({ format: 'video', folderId: null })
  })
})
