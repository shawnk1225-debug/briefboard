import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { backend } from '../src/data/backend'
import { textToDoc } from '../src/lib/doc'
import { parseShareRoute } from '../src/lib/route'
import {
  addCard,
  addComment,
  addSharedComment,
  applyEdits,
  boardPath,
  closeBoard,
  createBoard,
  createFolder,
  handleRemote,
  loadBoards,
  loadSharedBoard,
  openBoard,
  openCardComments,
  queue,
  undo,
  updateBoard,
  updateFolder,
  useStore,
} from '../src/store/store'

const TOKEN = 'a'.repeat(64)
const state = () => useStore.getState()

afterEach(() => {
  useStore.setState({ readOnly: false, shareToken: null, boardId: null, commentsOpen: false, commentCardId: null })
})

async function sharedBatch(token = TOKEN) {
  const folder = await createFolder('Batch', null)
  await updateFolder(folder.id, { shareToken: token })
  const board = await createBoard({ title: 'Brief', folderId: folder.id })
  await openBoard(board.id)
  const card = addCard('note', 0, 0, { doc: textToDoc('Hook') })
  await queue.drain()
  return { folder, board, card }
}

describe('link routes', () => {
  it('reads batch, board and card links', () => {
    expect(parseShareRoute(`#/s/${TOKEN}`)).toEqual({ token: TOKEN, boardId: null, cardId: null })
    expect(parseShareRoute(`#/s/${TOKEN}/b/abc`)).toEqual({ token: TOKEN, boardId: 'abc', cardId: null })
    expect(parseShareRoute(`#/s/${TOKEN}/b/abc?card=xyz`)).toEqual({ token: TOKEN, boardId: 'abc', cardId: 'xyz' })
  })

  it('leaves team routes alone', () => {
    expect(parseShareRoute('#/')).toBeNull()
    expect(parseShareRoute('#/b/abc')).toBeNull()
    expect(parseShareRoute('#/clip')).toBeNull()
    expect(parseShareRoute('#/s/')).toBeNull()
  })
})

describe('read-only link mode', () => {
  it('blocks every kind of change, on screen and in storage', async () => {
    const { board, card } = await sharedBatch()
    useStore.setState({ readOnly: true, shareToken: TOKEN })
    const before = state().cards[card.id]

    applyEdits([{ t: 'patch', id: card.id, fields: { x: 999 } }])
    applyEdits([{ t: 'remove', id: card.id }])
    updateBoard(board.id, { title: 'Hacked' })
    undo()

    expect(state().cards[card.id]).toEqual(before)
    expect(state().boards[board.id].title).toBe('Brief')
    await queue.drain()
    const stored = await backend.listCards(board.id)
    expect(stored.find((c) => c.id === card.id)?.x).toBe(before.x)
    expect((await backend.listBoards()).find((b) => b.id === board.id)?.title).toBe('Brief')
  })

  it('keeps nested board links inside the shared view', () => {
    useStore.setState({ shareToken: TOKEN })
    expect(boardPath('child')).toBe(`/s/${TOKEN}/b/child`)
    useStore.setState({ shareToken: null })
    expect(boardPath('child')).toBe('/b/child')
  })

  it('doesn’t touch the team’s board list when leaving a shared board', async () => {
    await loadBoards()
    useStore.setState({ readOnly: true, boards: { only: state().boards[Object.keys(state().boards)[0]] } })
    closeBoard()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(Object.keys(state().boards)).toEqual(['only'])
    useStore.setState({ readOnly: false })
    await loadBoards()
  })

  it('keeps your place when comments refresh, and resets it on a new board', async () => {
    const { board, card } = await sharedBatch('c'.repeat(64))
    const data = (await backend.getSharedBoard('c'.repeat(64), board.id))!
    useStore.setState({ boardId: null })
    loadSharedBoard(data)
    useStore.setState({ selected: { [card.id]: true }, viewport: { x: 5, y: 6, zoom: 2 } })
    loadSharedBoard(data)
    expect(state().selected[card.id]).toBe(true)
    expect(state().viewport.zoom).toBe(2)
    loadSharedBoard({ ...data, board: { ...data.board, id: 'other' } })
    expect(state().selected).toEqual({})
    expect(state().viewport.zoom).toBe(1)
  })
})

describe('what a link can reach', () => {
  it('finds nothing with a wrong or short token', async () => {
    await sharedBatch('e'.repeat(64))
    expect(await backend.getSharedBatch('z'.repeat(64))).toBeNull()
    expect(await backend.getSharedBatch('e')).toBeNull()
    expect(await backend.getSharedBatch('')).toBeNull()
  })

  it('stops as soon as the link is off, and a new token replaces the old', async () => {
    const { folder, board } = await sharedBatch('f'.repeat(64))
    await updateFolder(folder.id, { shareToken: null })
    expect(await backend.getSharedBatch('f'.repeat(64))).toBeNull()
    expect(await backend.getSharedBoard('f'.repeat(64), board.id)).toBeNull()
    await updateFolder(folder.id, { shareToken: '1'.repeat(64) })
    expect(await backend.getSharedBatch('f'.repeat(64))).toBeNull()
    expect((await backend.getSharedBatch('1'.repeat(64)))?.name).toBe('Batch')
  })

  it('never reaches another batch, trash, or a board outside the folder', async () => {
    const { board } = await sharedBatch('2'.repeat(64))
    const other = await sharedBatch('3'.repeat(64))
    const trashed = await createBoard({ title: 'Gone', folderId: other.folder.id, deletedAt: new Date().toISOString() })
    expect(await backend.getSharedBoard('2'.repeat(64), other.board.id)).toBeNull()
    expect(await backend.getSharedBoard('3'.repeat(64), board.id)).toBeNull()
    expect(await backend.getSharedBoard('3'.repeat(64), trashed.id)).toBeNull()
    await expect(backend.addSharedComment('2'.repeat(64), other.board.id, null, 'Ed', 'Hi')).rejects.toThrow(/not active/)
  })
})

describe('the comment sidebar', () => {
  it('holds general, card and team-only comments together', async () => {
    const { card } = await sharedBatch('4'.repeat(64))
    await addComment(card.id, 'On a card')
    await addComment(null, 'On the board')
    await addComment(null, 'Private', true)
    const all = Object.values(state().comments)
    expect(all.map((c) => [c.body, c.cardId, c.internal]).sort()).toEqual([
      ['On a card', card.id, false],
      ['On the board', null, false],
      ['Private', null, true],
    ].sort())
  })

  it('keeps team-only comments out of what a link receives, and hides emails', async () => {
    const { board } = await sharedBatch('5'.repeat(64))
    await addComment(null, 'Visible')
    await addComment(null, 'Margin is thin', true)
    const data = (await backend.getSharedBoard('5'.repeat(64), board.id))!
    expect(data.comments.map((c) => c.body)).toEqual(['Visible'])
    expect(data.comments[0].authorEmail).toBe('')
  })

  it('posts a comment under the typed name, and the team sees it', async () => {
    const { board, card } = await sharedBatch('6'.repeat(64))
    useStore.setState({ readOnly: true, shareToken: '6'.repeat(64) })
    await addSharedComment(card.id, 'Sam', 'Hook 2 is strong')
    const [comment] = Object.values(state().comments).filter((c) => c.authorName === 'Sam')
    expect(comment).toMatchObject({ body: 'Hook 2 is strong', cardId: card.id, internal: false, authorEmail: '' })
    expect((await backend.listComments(board.id)).some((c) => c.authorName === 'Sam')).toBe(true)
  })

  it('reads comments saved before the sidebar existed', async () => {
    const { board } = await sharedBatch('7'.repeat(64))
    const { createStore, update } = await import('idb-keyval')
    const id = crypto.randomUUID()
    await update('comments', (all: Record<string, unknown> = {}) => ({
      ...all,
      [id]: { id, boardId: board.id, cardId: 'x', authorEmail: 'You', body: 'Old', resolved: false, createdAt: '2026-01-01' },
    }), createStore('briefboard', 'data'))
    const old = (await backend.listComments(board.id)).find((c) => c.id === id)!
    expect(old).toMatchObject({ internal: false, authorName: null })
  })

  it('opens from anywhere, pointed at the right card, and stays open if that card goes', async () => {
    const { card } = await sharedBatch('8'.repeat(64))
    openCardComments(card.id)
    expect(state()).toMatchObject({ commentsOpen: true, commentCardId: card.id })
    applyEdits([{ t: 'remove', id: card.id }])
    expect(state()).toMatchObject({ commentsOpen: true, commentCardId: null })
  })

  it('shows a teammate’s comment arriving live, and a removal', async () => {
    const { board } = await sharedBatch('9'.repeat(64))
    const comment = { id: 'live', boardId: board.id, cardId: null, authorEmail: '', authorName: 'Sam', body: 'Hi', resolved: false, internal: false, createdAt: '2026-01-01' }
    handleRemote({ table: 'comment', kind: 'upsert', comment })
    expect(state().comments.live.authorName).toBe('Sam')
    handleRemote({ table: 'comment', kind: 'delete', id: 'live' })
    expect(state().comments.live).toBeUndefined()
  })
})
