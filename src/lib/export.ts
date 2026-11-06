import { boundsOf, getViewportEl, topLevelRects, type Rect } from '../canvas/geometry'
import { backend } from '../data/backend'
import { selectOnly, setEditing, useStore } from '../store/store'
import type { Card } from '../types'
import { docToMarkdown } from './doc'

const MAX_EXPORT_EDGE = 8000
const PAD = 40

function download(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.click()
}

const fileName = (title: string, extension: string) =>
  `${title.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'board'}.${extension}`

function contentBounds(): Rect | null {
  const { cards } = useStore.getState()
  const rects = topLevelRects()
  for (const card of Object.values(cards)) {
    if (card.type !== 'arrow') continue
    for (const end of [card.content.from, card.content.to]) {
      if (end && !end.cardId && end.x !== undefined && end.y !== undefined) rects.push({ x: end.x, y: end.y, w: 1, h: 1 })
    }
  }
  return boundsOf(rects)
}

async function renderImage(format: 'png' | 'jpeg'): Promise<{ dataUrl: string; width: number; height: number } | null> {
  selectOnly([])
  setEditing(null)
  // Lets selection outlines clear first. A timer, because animation frames stop in background tabs.
  await new Promise((resolve) => setTimeout(resolve, 50))
  const bounds = contentBounds()
  const world = getViewportEl()?.querySelector<HTMLElement>('.world')
  if (!bounds || !world) return null

  const width = Math.ceil(bounds.w + PAD * 2)
  const height = Math.ceil(bounds.h + PAD * 2)
  const pixelRatio = Math.min(2, MAX_EXPORT_EDGE / Math.max(width, height))
  const { toJpeg, toPng } = await import('html-to-image')
  const render = format === 'png' ? toPng : toJpeg
  const dataUrl = await render(world, {
    width,
    height,
    pixelRatio,
    quality: 0.9,
    backgroundColor: '#ffffff',
    style: {
      transform: `translate(${PAD - bounds.x}px, ${PAD - bounds.y}px)`,
      transformOrigin: '0 0',
      left: '0',
      top: '0',
    },
    filter: (node) => !(node instanceof Element && node.hasAttribute('data-html2image-ignore')),
    // An image the browser won't let us read (e.g. a video thumbnail) becomes blank, not a failed export.
    imagePlaceholder: 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
  })
  return { dataUrl, width, height }
}

export async function exportPng(title: string) {
  const image = await renderImage('png')
  if (image) download(image.dataUrl, fileName(title, 'png'))
  return Boolean(image)
}

export async function exportPdf(title: string) {
  // JPEG keeps a PDF small enough to email; the same page as a PNG runs to many megabytes.
  const image = await renderImage('jpeg')
  if (!image) return false
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({
    orientation: image.width > image.height ? 'landscape' : 'portrait',
    unit: 'px',
    format: [image.width, image.height],
    hotfixes: ['px_scaling'],
  })
  pdf.addImage(image.dataUrl, 'JPEG', 0, 0, image.width, image.height)
  pdf.save(fileName(title, 'pdf'))
  return true
}

function cardToMarkdown(card: Card, all: Card[], level: number, boardTitles: Record<string, string>): string {
  const { content } = card
  switch (card.type) {
    case 'note':
      return docToMarkdown(content.doc)
    case 'image':
      return `*[Image${content.caption ? `: ${content.caption}` : ''}]*`
    case 'link':
      return `[${content.title || content.url}](${content.url})`
    case 'todo': {
      const items = (content.items ?? []).map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n')
      return [content.title ? `**${content.title}**` : '', items].filter(Boolean).join('\n\n')
    }
    case 'board':
      return `**Board: ${boardTitles[content.boardId ?? ''] ?? 'Untitled board'}**`
    case 'doc':
      return [`${'#'.repeat(Math.min(level + 1, 6))} ${content.title || 'Untitled document'}`, docToMarkdown(content.doc)].filter(Boolean).join('\n\n')
    case 'file':
      return `*[File: ${content.name ?? 'attachment'}]*`
    case 'sketch':
      return '*[Sketch]*'
    case 'table': {
      const rows = (content.rows ?? []).map((row) => `| ${row.map((cell) => cell.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')).join(' | ')} |`)
      if (!rows.length) return ''
      const divider = `| ${(content.rows![0] ?? []).map(() => '---').join(' | ')} |`
      return [content.title ? `**${content.title}**\n` : '', rows[0], divider, ...rows.slice(1)].filter(Boolean).join('\n')
    }
    case 'column': {
      const children = all.filter((c) => c.columnId === card.id).sort((a, b) => a.columnOrder - b.columnOrder)
      const heading = `${'#'.repeat(Math.min(level + 1, 6))} ${content.title || 'Column'}`
      return [heading, ...children.map((c) => cardToMarkdown(c, all, level + 1, boardTitles))].filter(Boolean).join('\n\n')
    }
    default:
      return ''
  }
}

// Reads the board in visual order: rows top to bottom, each row left to right.
// Items whose tops are within ROW_TOLERANCE count as the same row.
const ROW_TOLERANCE = 40

export function boardToMarkdown(title: string, cards: Card[], boardTitles: Record<string, string> = {}): string {
  const top = cards.filter((c) => !c.columnId && c.type !== 'arrow').sort((a, b) => a.y - b.y)
  const rows: Card[][] = []
  for (const card of top) {
    const row = rows[rows.length - 1]
    if (row && card.y - row[0].y <= ROW_TOLERANCE) row.push(card)
    else rows.push([card])
  }
  const ordered = rows.flatMap((row) => row.sort((a, b) => a.x - b.x))
  const body = ordered.map((c) => cardToMarkdown(c, cards, 1, boardTitles)).filter(Boolean)
  return [`# ${title}`, ...body].join('\n\n') + '\n'
}

export async function exportMarkdown(boardId: string, title: string) {
  const cards = await backend.listCards(boardId)
  const titles = Object.fromEntries(Object.values(useStore.getState().boards).map((b) => [b.id, b.title]))
  const blob = new Blob([boardToMarkdown(title, cards, titles)], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  download(url, fileName(title, 'md'))
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
