import { backend } from '../data/backend'
import { cardSearchText } from '../lib/doc'
import type { Board, Card } from '../types'
import { applyEdits, columnChildren, createBoard, nextZ, queue, selectOnly, useStore } from './store'

interface CloneOptions {
  dx?: number
  dy?: number
  z?: number
}

// Copies cards with fresh ids, keeping column membership and arrows connected,
// and deep-copying any nested boards so the copy is independent of the original.
export async function cloneCards(source: Card[], boardId: string, parentForBoards: string, options: CloneOptions = {}) {
  const { dx = 0, dy = 0, z = 0 } = options
  const ids = new Map(source.map((card) => [card.id, crypto.randomUUID()]))
  const clones: Card[] = []

  for (const card of source) {
    const content = structuredClone(card.content)
    if (card.type === 'board' && content.boardId) {
      const copy = await copyBoardTree(content.boardId, { parentBoardId: parentForBoards })
      if (!copy) continue
      content.boardId = copy.id
    }
    if (card.type === 'arrow') {
      let broken = false
      for (const end of [content.from, content.to]) {
        if (end?.cardId) {
          if (!ids.has(end.cardId)) broken = true
          else end.cardId = ids.get(end.cardId)
        } else if (end) {
          end.x = (end.x ?? 0) + dx
          end.y = (end.y ?? 0) + dy
        }
      }
      if (broken) continue
    }
    const inCopiedColumn = card.columnId ? ids.has(card.columnId) : false
    clones.push({
      ...card,
      id: ids.get(card.id)!,
      boardId,
      x: card.x + dx,
      y: card.y + dy,
      z: card.z + z,
      columnId: inCopiedColumn ? ids.get(card.columnId!)! : null,
      content,
      searchText: cardSearchText(content),
    })
  }
  return clones
}

export async function copyBoardTree(sourceId: string, fields: Partial<Board> = {}): Promise<Board | null> {
  await queue.drain()
  const source = useStore.getState().boards[sourceId]
  if (!source) return null
  const board = await createBoard({ title: source.title, ...fields })
  const cards = await backend.listCards(sourceId)
  const clones = await cloneCards(cards, board.id, board.id)
  if (clones.length) await backend.applyOps(clones.map((card) => ({ kind: 'insert', card })))
  return board
}

// The selection plus what travels with it: column contents, arrows between copied cards.
export function expandForCopy(ids: string[]): Card[] {
  const { cards } = useStore.getState()
  const chosen = new Set(ids)
  for (const id of ids) {
    if (cards[id]?.type === 'column') columnChildren(id).forEach((child) => chosen.add(child.id))
  }
  for (const card of Object.values(cards)) {
    const { from, to } = card.content
    if (card.type === 'arrow' && from?.cardId && to?.cardId && chosen.has(from.cardId) && chosen.has(to.cardId)) {
      chosen.add(card.id)
    }
  }
  return [...chosen].flatMap((id) => (cards[id] ? [cards[id]] : []))
}

export async function pasteCards(source: Card[], dx: number, dy: number) {
  const { boardId } = useStore.getState()
  if (!boardId) return
  const baseZ = nextZ() - Math.min(...source.map((c) => c.z), 0)
  const clones = await cloneCards(source, boardId, boardId, { dx, dy, z: baseZ })
  if (!clones.length) return
  applyEdits(clones.map((card) => ({ t: 'insert', card })))
  selectOnly(clones.filter((c) => !c.columnId).map((c) => c.id))
}
