import { useEffect, useRef, useState } from 'react'
import { backend } from '../data/backend'
import { previewShape, type BoardPreviewShape, type PreviewRect } from '../lib/boardPreview'

const FILLS: Partial<Record<PreviewRect['type'], string>> = {
  column: 'var(--column)',
  image: '#c9d3e4',
  board: 'var(--accent-soft)',
  sketch: '#eef0f4',
}

const COLOR_FILLS: Record<string, string> = {
  yellow: 'var(--c-yellow)',
  green: 'var(--c-green)',
  blue: 'var(--c-blue)',
  pink: 'var(--c-pink)',
  gray: 'var(--c-gray)',
}

export function PreviewArt({ shape }: { shape: BoardPreviewShape | null }) {
  if (!shape?.rects.length) {
    return (
      <span className="board-preview empty" aria-hidden="true">
        {shape && <span>Empty</span>}
      </span>
    )
  }
  // Padding scales with the board, so a small board and a huge one both sit neatly in the tile.
  const pad = Math.max(shape.width, shape.height) * 0.05
  return (
    <span className="board-preview" aria-hidden="true">
      <svg viewBox={`${-pad} ${-pad} ${shape.width + pad * 2} ${shape.height + pad * 2}`} preserveAspectRatio="xMidYMid meet">
        {shape.rects.map((rect, i) => (
          <rect
            key={i}
            x={rect.x}
            y={rect.y}
            width={rect.w}
            height={rect.h}
            rx={Math.min(rect.w, rect.h) * 0.06}
            fill={(rect.color && COLOR_FILLS[rect.color]) || FILLS[rect.type] || '#ffffff'}
            stroke="#cdd1da"
            strokeWidth={Math.max(shape.width, shape.height) * 0.002}
          />
        ))}
      </svg>
    </span>
  )
}

// Remembers previews until a board is edited, so scrolling back doesn't fetch them again.
const cache = new Map<string, BoardPreviewShape>()
const MAX_AT_ONCE = 4
let running = 0
const waiting: (() => void)[] = []

function runNext() {
  while (running < MAX_AT_ONCE && waiting.length) {
    running += 1
    waiting.shift()!()
  }
}

function fetchShape(boardId: string): Promise<BoardPreviewShape> {
  return new Promise((resolve, reject) => {
    waiting.push(() => {
      backend
        .listPreviewCards(boardId)
        .then((cards) => resolve(previewShape(cards)), reject)
        .finally(() => {
          running -= 1
          runNext()
        })
    })
    runNext()
  })
}

// Loads only once the tile is near the screen, so hundreds of boards don't mean hundreds of requests.
export function BoardPreview({ boardId, updatedAt }: { boardId: string; updatedAt: string }) {
  const key = `${boardId}:${updatedAt}`
  const ref = useRef<HTMLSpanElement>(null)
  const [shape, setShape] = useState<BoardPreviewShape | null>(() => cache.get(key) ?? null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const known = cache.get(key)
    setShape(known ?? null)
    setFailed(false)
    if (known || !ref.current) return
    let live = true
    const load = () => {
      fetchShape(boardId)
        .then((result) => {
          cache.set(key, result)
          if (live) setShape(result)
        })
        .catch((err) => {
          console.error('Could not load a board preview', err)
          if (live) setFailed(true)
        })
    }
    if (typeof IntersectionObserver === 'undefined') {
      load()
      return () => {
        live = false
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          load()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(ref.current)
    return () => {
      live = false
      observer.disconnect()
    }
  }, [boardId, key])

  return (
    <span ref={ref} className="board-preview-wrap">
      {failed ? <span className="board-preview empty" aria-hidden="true" /> : <PreviewArt shape={shape} />}
    </span>
  )
}
