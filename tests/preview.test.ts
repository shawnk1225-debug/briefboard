import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { backend } from '../src/data/backend'
import { previewShape, type PreviewCard } from '../src/lib/boardPreview'
import { BUILTIN_TEMPLATES, buildTemplateCards, createFromBuiltin } from '../src/lib/templates'
import { addCard, createBoard, openBoard, queue } from '../src/store/store'

const card = (over: Partial<PreviewCard>): PreviewCard => ({ id: crypto.randomUUID(), type: 'note', x: 0, y: 0, w: 100, columnId: null, ...over })

describe('board previews', () => {
  it('shows nothing for an empty board, or one with only arrows', () => {
    expect(previewShape([]).rects).toEqual([])
    expect(previewShape([card({ type: 'arrow' })]).rects).toEqual([])
  })

  it('moves everything to start at the corner, including negative positions', () => {
    const shape = previewShape([card({ x: -500, y: -200, w: 100 }), card({ x: 300, y: 100, w: 200 })])
    expect(Math.min(...shape.rects.map((r) => r.x))).toBe(0)
    expect(Math.min(...shape.rects.map((r) => r.y))).toBe(0)
    expect(shape.width).toBe(1000)
    for (const rect of shape.rects) {
      expect(rect.x + rect.w).toBeLessThanOrEqual(shape.width)
      expect(rect.y + rect.h).toBeLessThanOrEqual(shape.height)
    }
  })

  it('draws cards inside a column as part of it, growing with its contents', () => {
    const column = card({ id: 'col', type: 'column', w: 300 })
    const empty = previewShape([column])
    const full = previewShape([column, card({ columnId: 'col' }), card({ columnId: 'col' })])
    expect(full.rects).toHaveLength(1)
    expect(full.rects[0].h).toBeGreaterThan(empty.rects[0].h)
  })

  it('keeps an image’s proportions, and copes with a missing or bad one', () => {
    const wide = previewShape([card({ type: 'image', w: 400, aspect: 2 })]).rects[0]
    expect(wide.h).toBe(200)
    for (const aspect of [undefined, 0, -1]) {
      expect(previewShape([card({ type: 'image', w: 400, aspect })]).rects[0].h).toBe(300)
    }
  })

  it('carries a note’s colour through', () => {
    expect(previewShape([card({ color: 'pink' })]).rects[0].color).toBe('pink')
  })

  it('draws every built-in template', () => {
    for (const template of BUILTIN_TEMPLATES) {
      const cards = buildTemplateCards(template, 'preview').map((c) => ({ ...c, color: c.content.color, aspect: c.content.aspect }))
      const shape = previewShape(cards)
      expect(shape.rects.length, template.title).toBeGreaterThan(5)
      expect(shape.width).toBeGreaterThan(0)
    }
  })

  it('reads a real board’s layout, without note text', async () => {
    const board = await createBoard({ title: 'Preview' })
    await openBoard(board.id)
    addCard('note', 10, 20, { color: 'yellow', title: 'Private words' })
    addCard('image', 300, 20, { ref: 'a.webp', aspect: 2 })
    await queue.drain()
    const cards = await backend.listPreviewCards(board.id)
    expect(cards.map((c) => c.type).sort()).toEqual(['image', 'note'])
    expect(cards.find((c) => c.type === 'note')!.color).toBe('yellow')
    expect(cards.find((c) => c.type === 'image')!.aspect).toBe(2)
    expect(JSON.stringify(cards)).not.toContain('Private words')
  })

  it('creates a template’s board in the folder being viewed', async () => {
    const board = await createFromBuiltin(BUILTIN_TEMPLATES[0], { folderId: 'folder-1' })
    expect(board.folderId).toBe('folder-1')
  })
})
