import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { spaceHeld } from '../canvas/shortcuts'
import { commitInteraction, patchContent, setEditing, useStore } from '../store/store'
import type { Card, SketchStroke } from '../types'

const WIDTH = 400
const HEIGHT = 300
const COLORS = ['#1d1f24', '#c8441f', '#2563c9', '#2e8b57', '#d4a017']
const SIZES = [{ label: 'Fine', width: 2 }, { label: 'Medium', width: 4 }, { label: 'Thick', width: 9 }]

export function strokePath(points: number[]): string {
  if (points.length < 2) return ''
  let d = `M${points[0]} ${points[1]}`
  // A single tap still draws a dot, because the line ends use round caps.
  if (points.length === 2) d += `L${points[0]} ${points[1]}`
  for (let i = 2; i < points.length; i += 2) d += `L${points[i]} ${points[i + 1]}`
  return d
}

// Colours and widths are attributes, not CSS: image export drops CSS on shapes inside an SVG.
const Strokes = ({ strokes }: { strokes: SketchStroke[] }) => (
  <>
    {strokes.map((stroke, i) => (
      <path key={i} d={strokePath(stroke.points)} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />
    ))}
  </>
)

function SketchEditor({ card }: { card: Card }) {
  const strokes = card.content.strokes ?? []
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(SIZES[1].width)
  const [current, setCurrent] = useState<SketchStroke | null>(null)
  const before = useRef(card)
  const svgRef = useRef<SVGSVGElement>(null)

  // A whole drawing session is one undo step on the board.
  useEffect(() => () => commitInteraction([before.current], { sync: false }), [])

  const undoStroke = () => {
    const latest = useStore.getState().cards[card.id]?.content.strokes ?? []
    if (latest.length) patchContent(card.id, { strokes: latest.slice(0, -1) }, { history: false })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undoStroke()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const toPoint = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect()
    return [
      Math.round(((e.clientX - r.left) / r.width) * WIDTH * 10) / 10,
      Math.round(((e.clientY - r.top) / r.height) * HEIGHT * 10) / 10,
    ]
  }

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || spaceHeld()) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setCurrent({ color, width, points: toPoint(e) })
  }

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!current) return
    const [x, y] = toPoint(e)
    const n = current.points.length
    if (Math.hypot(x - current.points[n - 2], y - current.points[n - 1]) < 1) return
    setCurrent({ ...current, points: [...current.points, x, y] })
  }

  const finishStroke = () => {
    if (!current) return
    const latest = useStore.getState().cards[card.id]?.content.strokes ?? []
    patchContent(card.id, { strokes: [...latest, current] }, { history: false })
    setCurrent(null)
  }

  return (
    <>
      <svg
        ref={svgRef}
        className="sketch-canvas drawing"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label="Sketch, drawing mode"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
      >
        <Strokes strokes={current ? [...strokes, current] : strokes} />
      </svg>
      {createPortal(
        <div className="floating-bar sketch-bar" data-interactive onPointerDown={(e) => e.stopPropagation()}>
          {COLORS.map((value) => (
            <button
              key={value}
              className={`swatch${value === color ? ' current' : ''}`}
              style={{ background: value }}
              aria-label={`Pen colour ${value}`}
              aria-pressed={value === color}
              onClick={() => setColor(value)}
            />
          ))}
          <span className="sep" />
          {SIZES.map((size) => (
            <button key={size.label} className={size.width === width ? 'active' : ''} aria-pressed={size.width === width} onClick={() => setWidth(size.width)}>
              {size.label}
            </button>
          ))}
          <span className="sep" />
          <button disabled={!strokes.length} onClick={undoStroke}>Undo line</button>
          <button disabled={!strokes.length} onClick={() => patchContent(card.id, { strokes: [] }, { history: false })}>Clear</button>
          <span className="sep" />
          <button className="active" onClick={() => setEditing(null)}>Done</button>
        </div>,
        document.body,
      )}
    </>
  )
}

export function SketchBody({ card }: { card: Card }) {
  const editing = useStore((s) => s.editingId === card.id)
  if (editing) return <SketchEditor card={card} />
  const strokes = card.content.strokes ?? []
  return (
    <div className="sketch-static">
      <svg className="sketch-canvas" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Sketch">
        <Strokes strokes={strokes} />
      </svg>
      {!strokes.length && <span className="sketch-hint">Click again to draw</span>}
    </div>
  )
}
