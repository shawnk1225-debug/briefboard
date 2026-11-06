import { useStore } from '../store/store'

export interface Point {
  x: number
  y: number
}

export interface Rect extends Point {
  w: number
  h: number
}

let viewportEl: HTMLElement | null = null

export const setViewportEl = (el: HTMLElement | null) => {
  viewportEl = el
}

export const getViewportEl = () => viewportEl

export function screenToWorld(clientX: number, clientY: number): Point {
  const rect = viewportEl!.getBoundingClientRect()
  const { x, y, zoom } = useStore.getState().viewport
  return { x: (clientX - rect.left - x) / zoom, y: (clientY - rect.top - y) / zoom }
}

export function cardRect(id: string): Rect | null {
  const el = viewportEl?.querySelector(`[data-card-id="${id}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  const { zoom } = useStore.getState().viewport
  const topLeft = screenToWorld(r.left, r.top)
  return { ...topLeft, w: r.width / zoom, h: r.height / zoom }
}

export function viewportCenter(): Point {
  const r = viewportEl!.getBoundingClientRect()
  return screenToWorld(r.left + r.width / 2, r.top + r.height / 2)
}

export function cardIdAtPoint(clientX: number, clientY: number): string | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const id = el.closest('[data-card-id]')?.getAttribute('data-card-id')
    if (id) return id
  }
  return null
}

// Where the line from a card's center toward `toward` leaves the card's edge.
export function clipToRect(rect: Rect, toward: Point, margin = 6): Point {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const dx = toward.x - cx
  const dy = toward.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const scale = Math.min(
    dx ? (rect.w / 2 + margin) / Math.abs(dx) : Infinity,
    dy ? (rect.h / 2 + margin) / Math.abs(dy) : Infinity,
  )
  return scale >= 1 ? { x: toward.x, y: toward.y } : { x: cx + dx * scale, y: cy + dy * scale }
}

export const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

export function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.w))
  const maxY = Math.max(...rects.map((r) => r.y + r.h))
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

// Fractional sort keys for `count` items placed between two neighbours.
export function ordersBetween(prev: number | undefined, next: number | undefined, count: number): number[] {
  const start = prev ?? (next !== undefined ? next - count - 1 : 0)
  const end = next ?? start + count + 1
  const step = (end - start) / (count + 1)
  return Array.from({ length: count }, (_, i) => start + step * (i + 1))
}

export const MIN_ZOOM = 0.15
export const MAX_ZOOM = 3

export function zoomAt(clientX: number, clientY: number, nextZoom: number) {
  const { viewport } = useStore.getState()
  const rect = viewportEl!.getBoundingClientRect()
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
  const px = clientX - rect.left
  const py = clientY - rect.top
  useStore.setState({
    viewport: {
      zoom,
      x: px - ((px - viewport.x) / viewport.zoom) * zoom,
      y: py - ((py - viewport.y) / viewport.zoom) * zoom,
    },
  })
}

export function zoomCentered(nextZoom: number) {
  const r = viewportEl!.getBoundingClientRect()
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, nextZoom)
}

export function topLevelRects(): Rect[] {
  const { cards } = useStore.getState()
  return Object.values(cards).flatMap((card) => {
    if (card.type === 'arrow' || card.columnId) return []
    const rect = cardRect(card.id)
    return rect ? [rect] : []
  })
}

export function fitToContent() {
  const bounds = boundsOf(topLevelRects())
  const el = viewportEl
  if (!el) return
  const { width, height } = el.getBoundingClientRect()
  if (!bounds) {
    useStore.setState({ viewport: { x: 120, y: 90, zoom: 1 } })
    return
  }
  const pad = 80
  const zoom = Math.min(1, Math.max(MIN_ZOOM, Math.min((width - pad * 2) / bounds.w, (height - pad * 2) / bounds.h)))
  useStore.setState({
    viewport: {
      zoom,
      x: width / 2 - (bounds.x + bounds.w / 2) * zoom,
      y: height / 2 - (bounds.y + bounds.h / 2) * zoom,
    },
  })
}

export function centerOn(id: string) {
  const rect = cardRect(id)
  const el = viewportEl
  if (!rect || !el) return
  const { width, height } = el.getBoundingClientRect()
  const zoom = Math.max(useStore.getState().viewport.zoom, 0.8)
  useStore.setState({
    viewport: { zoom, x: width / 2 - (rect.x + rect.w / 2) * zoom, y: height / 2 - (rect.y + rect.h / 2) * zoom },
  })
}
