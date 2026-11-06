import { useLayoutEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useShallow } from 'zustand/shallow'
import { applyEdits, commitInteraction, patchContent, selectOnly, useStore } from '../store/store'
import type { ArrowEnd, Card } from '../types'
import { cardIdAtPoint, cardRect, clipToRect, screenToWorld, type Point, type Rect } from './geometry'

export interface ArrowDraft {
  from: ArrowEnd
  to: Point
}

const layoutListeners = new Set<() => void>()
let scheduled = false

// Coalesces the many ResizeObserver callbacks during a change into one redraw.
export function bumpLayout() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(() => {
    scheduled = false
    layoutListeners.forEach((listener) => listener())
  })
}

type Rects = Record<string, Rect>

function endpoints(from: ArrowEnd | undefined, to: ArrowEnd | undefined, rects: Rects): [Point, Point] | null {
  const rectFor = (end?: ArrowEnd) => (end?.cardId ? rects[end.cardId] : undefined)
  const pointFor = (end?: ArrowEnd): Point | null => {
    if (end?.cardId) {
      const r = rects[end.cardId]
      return r ? { x: r.x + r.w / 2, y: r.y + r.h / 2 } : null
    }
    return end && end.x !== undefined && end.y !== undefined ? { x: end.x, y: end.y } : null
  }
  const a = pointFor(from)
  const b = pointFor(to)
  if (!a || !b) return null
  const ra = rectFor(from)
  const rb = rectFor(to)
  return [ra ? clipToRect(ra, b) : a, rb ? clipToRect(rb, a) : b]
}

function ArrowHandle({ arrow, which, at }: { arrow: Card; which: 'from' | 'to'; at: Point }) {
  const onPointerDown = (e: ReactPointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const before = [{ ...arrow }]
    const setEnd = (end: ArrowEnd) =>
      applyEdits(
        [{ t: 'patch', id: arrow.id, fields: { content: { ...useStore.getState().cards[arrow.id].content, [which]: end } } }],
        { history: false, sync: false },
      )
    const onMove = (ev: PointerEvent) => setEnd(screenToWorld(ev.clientX, ev.clientY))
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const other = arrow.content[which === 'from' ? 'to' : 'from']
      const hit = cardIdAtPoint(ev.clientX, ev.clientY)
      if (hit && hit !== other?.cardId) setEnd({ cardId: hit })
      commitInteraction(before)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  return <circle className="arrow-handle" data-arrow-ui cx={at.x} cy={at.y} r={6} onPointerDown={onPointerDown} />
}

export function ArrowLayer({ draft }: { draft: ArrowDraft | null }) {
  const arrows = useStore(useShallow((s) => Object.values(s.cards).filter((c) => c.type === 'arrow')))
  const selected = useStore((s) => s.selected)
  const readOnly = useStore((s) => s.readOnly)
  // Anything that can move a card also moves the arrows attached to it.
  const cards = useStore((s) => s.cards)
  const [rects, setRects] = useState<Rects>({})
  const [tick, setTick] = useState(0)

  useLayoutEffect(() => {
    const listener = () => setTick((t) => t + 1)
    layoutListeners.add(listener)
    return () => void layoutListeners.delete(listener)
  }, [])

  useLayoutEffect(() => {
    const ends = [...arrows.flatMap((a) => [a.content.from, a.content.to]), draft?.from]
    const next: Rects = {}
    for (const end of ends) {
      if (end?.cardId && !next[end.cardId]) {
        const rect = cardRect(end.cardId)
        if (rect) next[end.cardId] = rect
      }
    }
    setRects(next)
  }, [cards, tick, draft, arrows])

  const draftLine = draft ? endpoints(draft.from, draft.to, rects) : null

  // The SVG box wraps every arrow, because exporting clips anything outside it.
  const points = [...arrows.flatMap((a) => endpoints(a.content.from, a.content.to, rects) ?? []), ...(draftLine ?? [])]
  const pad = 20
  const left = Math.min(0, ...points.map((p) => p.x)) - pad
  const top = Math.min(0, ...points.map((p) => p.y)) - pad
  const width = Math.max(1, ...points.map((p) => p.x)) + pad - left
  const height = Math.max(1, ...points.map((p) => p.y)) + pad - top

  return (
    <>
      <svg className="arrow-layer" style={{ left, top, width, height }} viewBox={`${left} ${top} ${width} ${height}`}>
        <defs>
          <marker id="arrowhead" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
          </marker>
        </defs>
        {arrows.map((arrow) => {
          const line = endpoints(arrow.content.from, arrow.content.to, rects)
          if (!line) return null
          const [a, b] = line
          const isSelected = selected[arrow.id]
          const select = (e: ReactPointerEvent) => {
            e.stopPropagation()
            if (e.shiftKey) useStore.setState({ selected: { ...selected, [arrow.id]: true } })
            else selectOnly([arrow.id])
          }
          return (
            <g key={arrow.id}>
              {/* Stroke set here as well as in CSS: image export drops CSS on shapes inside an SVG. */}
              <line className={`arrow-line${isSelected ? ' selected' : ''}`} stroke="#5d626c" strokeWidth={2} x1={a.x} y1={a.y} x2={b.x} y2={b.y} markerEnd="url(#arrowhead)" />
              <line className="arrow-hit" data-arrow-ui x1={a.x} y1={a.y} x2={b.x} y2={b.y} onPointerDown={select} />
              {isSelected && !readOnly && (
                <>
                  <ArrowHandle arrow={arrow} which="from" at={a} />
                  <ArrowHandle arrow={arrow} which="to" at={b} />
                </>
              )}
            </g>
          )
        })}
        {draftLine && (
          <line className="arrow-line draft" x1={draftLine[0].x} y1={draftLine[0].y} x2={draftLine[1].x} y2={draftLine[1].y} markerEnd="url(#arrowhead)" />
        )}
      </svg>
      {arrows.map((arrow) => {
        const line = endpoints(arrow.content.from, arrow.content.to, rects)
        const isSelected = selected[arrow.id] && !readOnly
        if (!line || (!isSelected && !arrow.content.label)) return null
        const left = (line[0].x + line[1].x) / 2
        const top = (line[0].y + line[1].y) / 2
        if (!isSelected) {
          return (
            <div key={arrow.id} className="arrow-label" style={{ left, top }}>
              {arrow.content.label}
            </div>
          )
        }
        return (
          <input
            key={arrow.id}
            className="arrow-label editing"
            data-arrow-ui
            data-html2image-ignore
            style={{ left, top }}
            placeholder="Label"
            aria-label="Arrow label"
            value={arrow.content.label ?? ''}
            onChange={(e) => patchContent(arrow.id, { label: e.target.value }, { history: false })}
            onPointerDown={(e) => e.stopPropagation()}
          />
        )
      })}
    </>
  )
}
