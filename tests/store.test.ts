import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { backend } from '../src/data/backend'
import { textToDoc } from '../src/lib/doc'
import { copyBoardTree, expandForCopy, pasteCards } from '../src/store/copy'
import {
  addCard,
  addComment,
  applyEdits,
  deleteComment,
  setCommentResolved,
  commitInteraction,
  createBoard,
  handleRemote,
  openBoard,
  queue,
  redo,
  removeCards,
  undo,
  useStore,
} from '../src/store/store'
import type { Card } from '../src/types'

const cards = () => useStore.getState().cards
const persisted = async (boardId: string) => {
  await queue.drain()
  return backend.listCards(boardId)
}

describe('board store', () => {
  let boardId: string

  beforeEach(async () => {
    boardId = (await createBoard({ title: 'Test' })).id
    await openBoard(boardId)
  })

  it('saves new cards to storage and makes them searchable', async () => {
    const card = addCard('note', 10, 20, { doc: textToDoc('Hook idea') })
    const saved = await persisted(boardId)
    expect(saved.map((c) => c.id)).toEqual([card.id])
    const hits = await backend.search('hook')
    expect(hits.some((h) => h.card.id === card.id && h.boardTitle === 'Test')).toBe(true)
  })

  it('undoes and redoes creation, moves and deletion, including what is saved', async () => {
    const card = addCard('note', 0, 0)
    applyEdits([{ t: 'patch', id: card.id, fields: { x: 50 } }])
    undo()
    expect(cards()[card.id].x).toBe(0)
    redo()
    expect(cards()[card.id].x).toBe(50)

    removeCards([card.id])
    expect(cards()[card.id]).toBeUndefined()
    expect(await persisted(boardId)).toHaveLength(0)
    undo()
    expect(cards()[card.id].x).toBe(50)
    expect((await persisted(boardId))[0].x).toBe(50)

    undo()
    undo()
    expect(cards()[card.id]).toBeUndefined()
    expect(await persisted(boardId)).toHaveLength(0)
  })

  it('undo only reverts the fields it changed, keeping a teammate edit', async () => {
    const card = addCard('note', 0, 0)
    await queue.drain()
    applyEdits([{ t: 'patch', id: card.id, fields: { x: 50 } }])
    await queue.drain()
    handleRemote({ table: 'card', kind: 'upsert', client: 'teammate', card: { ...cards()[card.id], w: 999 } })
    undo()
    expect(cards()[card.id].x).toBe(0)
    expect(cards()[card.id].w).toBe(999)
  })

  it('treats a whole drag as a single undo step', () => {
    const card = addCard('note', 0, 0)
    const before: Card[] = [{ ...cards()[card.id] }]
    for (const x of [1, 2, 3, 4]) applyEdits([{ t: 'patch', id: card.id, fields: { x } }], { history: false, sync: false })
    commitInteraction(before)
    undo()
    expect(cards()[card.id].x).toBe(0)
  })

  it('removes column contents and attached arrows with a card, and restores them on undo', () => {
    const column = addCard('column', 0, 0)
    const child = addCard('note', 0, 0)
    applyEdits([{ t: 'patch', id: child.id, fields: { columnId: column.id } }])
    const other = addCard('note', 500, 0)
    const arrow = addCard('arrow', 0, 0, { from: { cardId: child.id }, to: { cardId: other.id } })

    removeCards([column.id])
    expect(cards()[column.id]).toBeUndefined()
    expect(cards()[child.id]).toBeUndefined()
    expect(cards()[arrow.id]).toBeUndefined()
    expect(cards()[other.id]).toBeDefined()

    undo()
    expect(cards()[child.id].columnId).toBe(column.id)
    expect(cards()[arrow.id]).toBeDefined()
  })

  it('ignores echoes of its own writes and edits it has not saved yet', () => {
    const card = addCard('note', 0, 0)
    handleRemote({ table: 'card', kind: 'upsert', client: 'teammate', card: { ...cards()[card.id], x: 777 } })
    expect(cards()[card.id].x).toBe(0) // still has a pending local save
  })

  it('applies a teammate edit once local saves are done, and their deletes', async () => {
    const card = addCard('note', 0, 0)
    await queue.drain()
    handleRemote({ table: 'card', kind: 'upsert', client: 'teammate', card: { ...cards()[card.id], x: 777 } })
    expect(cards()[card.id].x).toBe(777)
    handleRemote({ table: 'card', kind: 'delete', id: card.id })
    expect(cards()[card.id]).toBeUndefined()
  })

  it('keeps typed text when a teammate moves the note being edited', async () => {
    const card = addCard('note', 0, 0, { doc: textToDoc('old') })
    await queue.drain()
    useStore.setState({ editingId: card.id })
    handleRemote({ table: 'card', kind: 'upsert', client: 'teammate', card: { ...cards()[card.id], x: 40, content: {} } })
    expect(cards()[card.id].x).toBe(40)
    expect(cards()[card.id].content.doc).toBeDefined()
    useStore.setState({ editingId: null })
  })

  it('moving a board card to the trash and undoing restores the board', async () => {
    const child = await createBoard({ parentBoardId: boardId, title: 'Child' })
    const card = addCard('board', 0, 0, { boardId: child.id })
    removeCards([card.id])
    expect(useStore.getState().boards[child.id].deletedAt).not.toBeNull()
    undo()
    expect(useStore.getState().boards[child.id].deletedAt).toBeNull()
  })

  it('keeps comments through a card being deleted and restored, and applies teammate comments', async () => {
    const card = addCard('note', 0, 0)
    await queue.drain()
    await addComment(card.id, 'Hook is weak')
    const [comment] = Object.values(useStore.getState().comments)
    removeCards([card.id])
    undo()
    await queue.drain()
    await openBoard(boardId)
    expect(useStore.getState().comments[comment.id].body).toBe('Hook is weak')

    await setCommentResolved(comment.id, true)
    expect(useStore.getState().comments[comment.id].resolved).toBe(true)
    handleRemote({ table: 'comment', kind: 'upsert', comment: { ...comment, id: 'teammate', body: 'Agreed' } })
    expect(useStore.getState().comments.teammate.body).toBe('Agreed')
    handleRemote({ table: 'comment', kind: 'upsert', comment: { ...comment, id: 'elsewhere', boardId: 'other' } })
    expect(useStore.getState().comments.elsewhere).toBeUndefined()
    handleRemote({ table: 'comment', kind: 'delete', id: 'teammate' })
    expect(useStore.getState().comments.teammate).toBeUndefined()
    await deleteComment(comment.id)
    expect(await backend.listComments(boardId)).toHaveLength(0)
  })

  it('makes tables and file names searchable', async () => {
    addCard('table', 0, 0, { rows: [['Hook'], ['Zebra angle']] })
    addCard('file', 0, 0, { name: 'quokka-cut.mp4', ref: 'x' })
    await queue.drain()
    expect((await backend.search('zebra')).length).toBeGreaterThan(0)
    expect((await backend.search('quokka')).length).toBeGreaterThan(0)
  })

  it('duplicates with new ids, keeping column contents and connected arrows', async () => {
    const column = addCard('column', 0, 0, { title: 'Col' })
    const child = addCard('note', 0, 0)
    applyEdits([{ t: 'patch', id: child.id, fields: { columnId: column.id, columnOrder: 1 } }])
    const note = addCard('note', 400, 0)
    const arrow = addCard('arrow', 0, 0, { from: { cardId: column.id }, to: { cardId: note.id } })

    await pasteCards(expandForCopy([column.id, note.id]), 30, 30)
    const all = Object.values(cards())
    const columnCopy = all.find((c) => c.type === 'column' && c.id !== column.id)!
    const noteCopy = all.find((c) => c.type === 'note' && c.x === 430)!
    const arrowCopy = all.find((c) => c.type === 'arrow' && c.id !== arrow.id)!
    expect(columnCopy.x).toBe(30)
    expect(all.some((c) => c.columnId === columnCopy.id && c.id !== child.id)).toBe(true)
    expect(arrowCopy.content.from?.cardId).toBe(columnCopy.id)
    expect(arrowCopy.content.to?.cardId).toBe(noteCopy.id)
    undo()
    expect(Object.values(cards()).filter((c) => c.type === 'column')).toHaveLength(1)
  })

  it('deep-copies nested boards, so editing the copy leaves the original alone', async () => {
    const child = await createBoard({ parentBoardId: boardId, title: 'Child' })
    addCard('board', 0, 0, { boardId: child.id })
    await backend.applyOps([
      { kind: 'insert', card: { id: crypto.randomUUID(), boardId: child.id, type: 'note', x: 0, y: 0, w: 100, z: 1, columnId: null, columnOrder: 0, content: { doc: textToDoc('inner') }, searchText: 'inner' } },
    ])

    const copy = (await copyBoardTree(boardId, { title: 'Copy', isTemplate: true }))!
    expect(copy.isTemplate).toBe(true)
    const copiedCards = await backend.listCards(copy.id)
    const nestedId = copiedCards[0].content.boardId!
    expect(nestedId).not.toBe(child.id)
    const nested = await backend.listCards(nestedId)
    expect(nested[0].searchText).toBe('inner')
    expect(nested[0].boardId).toBe(nestedId)
    expect((await backend.listCards(child.id))).toHaveLength(1)
  })
})
