import type { PointerEvent as ReactPointerEvent } from 'react'
import { applyEdits, columnChildren, commitInteraction, nextZ, selectOnly, setEditing, useStore, type DropTarget, type Edit } from '../store/store'
import type { Card } from '../types'
import { cardRect, getViewportEl, ordersBetween, screenToWorld } from './geometry'

const DRAG_THRESHOLD = 4
const COLUMN_ITEM_TYPES = new Set(['note', 'image', 'link', 'todo', 'board', 'table', 'doc', 'file', 'sketch'])
// Clicking one of these again once it's selected opens it for editing.
const EDITABLE_TYPES = new Set(['note', 'doc', 'sketch'])

function findDropTarget(clientX: number, clientY: number, dragged: Card[]): DropTarget | null {
  if (dragged.some((c) => !COLUMN_ITEM_TYPES.has(c.type))) return null
  const draggedIds = new Set(dragged.map((c) => c.id))
  const columns = getViewportEl()?.querySelectorAll<HTMLElement>('[data-column-id]') ?? []
  for (const column of columns) {
    const r = column.getBoundingClientRect()
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) continue
    const items = [...column.querySelectorAll<HTMLElement>('[data-card-id]')].filter(
      (el) => !draggedIds.has(el.getAttribute('data-card-id')!),
    )
    let index = 0
    for (const item of items) {
      const ir = item.getBoundingClientRect()
      if (clientY > ir.top + ir.height / 2) index += 1
    }
    return { columnId: column.getAttribute('data-column-id')!, index }
  }
  return null
}

function dropEdits(dragged: Card[], target: DropTarget | null): Edit[] {
  if (!target) return dragged.map((c) => ({ t: 'patch', id: c.id, fields: { columnId: null } }))
  const draggedIds = new Set(dragged.map((c) => c.id))
  const siblings = columnChildren(target.columnId).filter((c) => !draggedIds.has(c.id))
  const orders = ordersBetween(siblings[target.index - 1]?.columnOrder, siblings[target.index]?.columnOrder, dragged.length)
  return dragged.map((c, i) => ({ t: 'patch', id: c.id, fields: { columnId: target.columnId, columnOrder: orders[i] } }))
}

export function startCardPointer(e: ReactPointerEvent, card: Card) {
  if (e.button !== 0) return
  const s = useStore.getState()
  if (s.tool === 'arrow' || s.editingId === card.id) return
  const target = e.target as HTMLElement
  const interactive = target.closest('[data-interactive]')
  const wasSelected = Boolean(s.selected[card.id])

  if (s.editingId) setEditing(null)
  if (e.shiftKey) {
    const next = { ...s.selected }
    if (next[card.id]) delete next[card.id]
    else next[card.id] = true
    useStore.setState({ selected: next })
    return
  }
  if (!wasSelected) selectOnly([card.id])
  if (interactive) return // inputs, checkboxes and buttons keep their own behaviour

  const startX = e.clientX
  const startY = e.clientY
  let before: Card[] = []
  let dragged: Card[] = []
  let started = false

  const begin = () => {
    started = true
    window.getSelection()?.removeAllRanges()
    const state = useStore.getState()
    const ids = new Set(Object.keys(state.selected))
    // A card inside a selected column moves with the column, not on its own.
    dragged = [...ids]
      .map((id) => state.cards[id])
      .filter((c) => c && c.type !== 'arrow' && !(c.columnId && ids.has(c.columnId)))
    before = dragged.map((c) => ({ ...c }))

    const z = nextZ()
    const edits: Edit[] = []
    const detached: Record<string, true> = {}
    const dragIds: Record<string, true> = {}
    dragged.forEach((c, i) => {
      dragIds[c.id] = true
      const fields: Partial<Card> = { z: z + i }
      if (c.columnId) {
        const rect = cardRect(c.id)
        if (rect) Object.assign(fields, { x: rect.x, y: rect.y, w: rect.w })
        detached[c.id] = true
      }
      edits.push({ t: 'patch', id: c.id, fields })
    })
    applyEdits(edits, { history: false, sync: false })
    useStore.setState({ detached, dragIds })
    dragged = dragged.map((c) => useStore.getState().cards[c.id])
  }

  const onMove = (ev: PointerEvent) => {
    if (!started) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return
      begin()
    }
    const a = screenToWorld(startX, startY)
    const b = screenToWorld(ev.clientX, ev.clientY)
    applyEdits(
      dragged.map((c) => ({ t: 'patch', id: c.id, fields: { x: c.x + b.x - a.x, y: c.y + b.y - a.y } })),
      { history: false, sync: false },
    )
    useStore.setState({ dropTarget: findDropTarget(ev.clientX, ev.clientY, dragged) })
  }

  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    if (!started) {
      if (wasSelected && EDITABLE_TYPES.has(card.type) && !target.closest('a')) {
        selectOnly([card.id])
        setEditing(card.id)
      }
      return
    }
    const { dropTarget } = useStore.getState()
    applyEdits(dropEdits(dragged, dropTarget), { history: false, sync: false })
    useStore.setState({ detached: {}, dragIds: {}, dropTarget: null })
    commitInteraction(before)
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

export function startResize(e: ReactPointerEvent, card: Card) {
  e.stopPropagation()
  e.preventDefault()
  const before = [{ ...card }]
  const startX = e.clientX
  const minWidth = card.type === 'board' ? 130 : card.type === 'table' ? 280 : 160

  const onMove = (ev: PointerEvent) => {
    const { zoom } = useStore.getState().viewport
    const w = Math.min(1600, Math.max(minWidth, card.w + (ev.clientX - startX) / zoom))
    applyEdits([{ t: 'patch', id: card.id, fields: { w } }], { history: false, sync: false })
  }
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    commitInteraction(before)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}
