import type { Card, CardType } from '../types'

// Just enough of a card to draw it small, so previews don't download anyone's content.
export interface PreviewCard {
  id: string
  type: CardType
  x: number
  y: number
  w: number
  columnId: string | null
  color?: string
  aspect?: number
}

export interface PreviewRect {
  x: number
  y: number
  w: number
  h: number
  type: CardType
  color?: string
}

export interface BoardPreviewShape {
  rects: PreviewRect[]
  width: number
  height: number
}

const COLUMN_HEADER = 44
const COLUMN_ROW = 72
const COLUMN_EMPTY = 90

// Heights aren't stored, because cards grow with their text, so these are typical sizes.
function estimatedHeight(card: PreviewCard): number {
  switch (card.type) {
    case 'image':
      return card.w / (card.aspect && card.aspect > 0 ? card.aspect : 4 / 3)
    case 'sketch':
      return card.w * 0.75
    case 'board':
      return card.w
    case 'todo':
    case 'table':
      return 150
    case 'link':
    case 'doc':
      return 110
    case 'file':
      return 62
    default:
      return 76
  }
}

export function previewShape(cards: PreviewCard[]): BoardPreviewShape {
  const placed = cards.filter((c) => c.type !== 'arrow' && !c.columnId)
  if (!placed.length) return { rects: [], width: 0, height: 0 }

  const inColumn = new Map<string, number>()
  for (const card of cards) {
    if (card.columnId) inColumn.set(card.columnId, (inColumn.get(card.columnId) ?? 0) + 1)
  }

  const rects = placed.map((card): PreviewRect => {
    const children = inColumn.get(card.id) ?? 0
    const h = card.type === 'column' ? (children ? COLUMN_HEADER + children * COLUMN_ROW : COLUMN_EMPTY) : estimatedHeight(card)
    return { x: card.x, y: card.y, w: card.w, h, type: card.type, color: card.color }
  })

  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.w))
  const maxY = Math.max(...rects.map((r) => r.y + r.h))
  return {
    rects: rects.map((r) => ({ ...r, x: r.x - minX, y: r.y - minY })),
    width: maxX - minX,
    height: maxY - minY,
  }
}

export const toPreviewCard = (card: Card): PreviewCard => ({
  id: card.id,
  type: card.type,
  x: card.x,
  y: card.y,
  w: card.w,
  columnId: card.columnId,
  color: card.content.color,
  aspect: card.content.aspect,
})
