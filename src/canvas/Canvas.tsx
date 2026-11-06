import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useShallow } from 'zustand/shallow'
import { addCard, setEditing, setViewport, useStore } from '../store/store'
import type { ArrowEnd } from '../types'
import { addFiles } from './addFiles'
import { ArrowLayer, type ArrowDraft } from './ArrowLayer'
import { CardView } from './CardView'
import { cardIdAtPoint, cardRect, intersects, screenToWorld, setViewportEl, zoomAt, type Rect } from './geometry'
import { spaceHeld } from './shortcuts'

export function Canvas() {
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewport = useStore((s) => s.viewport)
  const tool = useStore((s) => s.tool)
  const ids = useStore(
    useShallow((s) =>
      Object.values(s.cards)
        .filter((c) => c.type !== 'arrow' && (!c.columnId || s.detached[c.id]))
        .map((c) => c.id),
    ),
  )
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [draft, setDraft] = useState<ArrowDraft | null>(null)
  const [panning, setPanning] = useState(false)

  useEffect(() => {
    const el = viewportRef.current!
    setViewportEl(el)
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.ProseMirror') && !e.ctrlKey) return
      e.preventDefault()
      const current = useStore.getState().viewport
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, current.zoom * Math.exp(-e.deltaY * 0.01))
      } else {
        setViewport({ ...current, x: current.x - e.deltaX, y: current.y - e.deltaY })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      setViewportEl(null)
    }
  }, [])

  const track = (onMove: (ev: PointerEvent) => void, onEnd: (ev: PointerEvent) => void) => {
    const end = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      onEnd(ev)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
  }

  const startPan = (e: ReactPointerEvent) => {
    const start = { cx: e.clientX, cy: e.clientY, ...useStore.getState().viewport }
    setPanning(true)
    track(
      (ev) => setViewport({ zoom: start.zoom, x: start.x + ev.clientX - start.cx, y: start.y + ev.clientY - start.cy }),
      () => setPanning(false),
    )
  }

  const startMarquee = (e: ReactPointerEvent) => {
    const origin = screenToWorld(e.clientX, e.clientY)
    const additive = e.shiftKey ? { ...useStore.getState().selected } : {}
    useStore.setState({ selected: additive })
    let last: Rect | null = null
    track(
      (ev) => {
        const p = screenToWorld(ev.clientX, ev.clientY)
        const rect = { x: Math.min(origin.x, p.x), y: Math.min(origin.y, p.y), w: Math.abs(p.x - origin.x), h: Math.abs(p.y - origin.y) }
        last = rect
        setMarquee(rect)
        const selected: Record<string, true> = { ...additive }
        for (const card of Object.values(useStore.getState().cards)) {
          if (card.type === 'arrow' || card.columnId) continue
          const r = cardRect(card.id)
          if (r && intersects(rect, r)) selected[card.id] = true
        }
        useStore.setState({ selected })
      },
      () => {
        if (last) setMarquee(null)
      },
    )
  }

  const startArrow = (e: ReactPointerEvent) => {
    const start = screenToWorld(e.clientX, e.clientY)
    const fromId = cardIdAtPoint(e.clientX, e.clientY)
    const from: ArrowEnd = fromId ? { cardId: fromId } : start
    setDraft({ from, to: start })
    track(
      (ev) => setDraft({ from, to: screenToWorld(ev.clientX, ev.clientY) }),
      (ev) => {
        setDraft(null)
        const point = screenToWorld(ev.clientX, ev.clientY)
        const toId = cardIdAtPoint(ev.clientX, ev.clientY)
        const moved = Math.hypot(point.x - start.x, point.y - start.y) > 8
        if (!moved || (toId && toId === fromId)) {
          useStore.setState({ tool: 'select' })
          return
        }
        addCard('arrow', 0, 0, { from, to: toId ? { cardId: toId } : point })
      },
    )
  }

  const onPointerDownCapture = (e: ReactPointerEvent) => {
    if (tool === 'arrow' && e.button === 0) {
      e.stopPropagation()
      e.preventDefault()
      startArrow(e)
    }
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    const target = e.target as HTMLElement
    if (e.button === 1 || (e.button === 0 && spaceHeld())) {
      e.preventDefault()
      startPan(e)
      return
    }
    if (target.closest('[data-card-id]') || target.closest('[data-arrow-ui]')) return
    if (e.button !== 0) return
    setEditing(null)
    if (e.pointerType === 'touch') startPan(e)
    else startMarquee(e)
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('[data-card-id]') || target.closest('[data-arrow-ui]') || useStore.getState().readOnly) return
    const p = screenToWorld(e.clientX, e.clientY)
    const card = addCard('note', p.x - 20, p.y - 20)
    setEditing(card.id)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const files = [...e.dataTransfer.files]
    if (!files.length || useStore.getState().readOnly) return
    const p = screenToWorld(e.clientX, e.clientY)
    void addFiles(files, p.x, p.y)
  }

  // Dots follow the canvas, and fade out when zoomed far enough to turn to noise.
  const gridSize = 28 * viewport.zoom
  const background =
    viewport.zoom < 0.4
      ? undefined
      : { backgroundSize: `${gridSize}px ${gridSize}px`, backgroundPosition: `${viewport.x}px ${viewport.y}px` }

  return (
    <div
      ref={viewportRef}
      className={`viewport${background ? ' with-grid' : ''}${tool === 'arrow' ? ' tool-arrow' : ''}${panning ? ' panning' : ''}`}
      style={background}
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div
        className="world"
        style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
      >
        {ids.map((id) => (
          <CardView key={id} id={id} />
        ))}
        <ArrowLayer draft={draft} />
        {marquee && (
          <div
            className="marquee"
            style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h, borderWidth: 1 / viewport.zoom }}
          />
        )}
      </div>
    </div>
  )
}
