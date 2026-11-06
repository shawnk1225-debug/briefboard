import { describe, expect, it, vi } from 'vitest'
import { parseClip, textClipContent } from '../src/lib/clip'
import { docText, docToMarkdown, textToDoc } from '../src/lib/doc'
import { embedSrc, normalizeUrl, parseEmbed } from '../src/lib/links'
import type { Card, RichDoc } from '../src/types'

// export.ts pulls in the canvas module, whose store needs a browser database.
vi.mock('../src/data/backend', () => ({ backend: { listCards: vi.fn(), mode: 'local' } }))

const { boardToMarkdown } = await import('../src/lib/export')
const { clipToRect, intersects, ordersBetween } = await import('../src/canvas/geometry')
const { escapeLike } = await import('../src/data/supabaseBackend')

describe('normalizeUrl', () => {
  it('accepts web addresses and fills in https', () => {
    expect(normalizeUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(normalizeUrl('example.com/page')).toBe('https://example.com/page')
    expect(normalizeUrl('www.tiktok.com')).toBe('https://www.tiktok.com/')
  })

  it('rejects anything that could run code, and plain text', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('JaVaScRiPt:alert(1)')).toBeNull()
    expect(normalizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(normalizeUrl('just some words')).toBeNull()
    expect(normalizeUrl('hello')).toBeNull()
  })
})

describe('parseEmbed', () => {
  it('recognises video links', () => {
    expect(parseEmbed('https://www.youtube.com/watch?v=abc123')).toEqual({ provider: 'youtube', id: 'abc123' })
    expect(parseEmbed('https://youtu.be/abc123')).toEqual({ provider: 'youtube', id: 'abc123' })
    expect(parseEmbed('https://www.youtube.com/shorts/abc123')).toEqual({ provider: 'youtube', id: 'abc123' })
    expect(parseEmbed('https://vimeo.com/12345')).toEqual({ provider: 'vimeo', id: '12345' })
    expect(parseEmbed('https://www.tiktok.com/@user/video/987')).toEqual({ provider: 'tiktok', id: '987' })
  })

  it('leaves other links alone', () => {
    expect(parseEmbed('https://example.com/watch?v=abc')).toBeUndefined()
    expect(parseEmbed('https://vimeo.com/channels/staff')).toBeUndefined()
  })

  it('encodes ids placed into player URLs', () => {
    expect(embedSrc({ provider: 'youtube', id: 'a"b/c' })).toContain('a%22b%2Fc')
  })
})

describe('rich text', () => {
  const doc: RichDoc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Hooks' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'link', marks: [{ type: 'link', attrs: { href: 'https://a.co' } }] },
        ],
      },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }] },
        ],
      },
    ],
  }

  it('converts to Markdown', () => {
    expect(docToMarkdown(doc)).toBe('## Hooks\n\n**Bold** and [link](https://a.co)\n\n- One\n- Two')
  })

  it('extracts plain text', () => {
    expect(docText(textToDoc('line one\nline two'))).toBe('line one\nline two')
    expect(docText(doc)).toContain('Bold and link')
  })
})

describe('boardToMarkdown', () => {
  const card = (over: Partial<Card>): Card => ({
    id: crypto.randomUUID(), boardId: 'b', type: 'note', x: 0, y: 0, w: 100, z: 0, columnId: null, columnOrder: 0, content: {}, searchText: '', ...over,
  })

  it('reads in visual order, with column contents under the column', () => {
    const column = card({ id: 'col', type: 'column', x: 400, y: 100, content: { title: 'Script' } })
    const md = boardToMarkdown('Brief', [
      card({ x: 0, y: 500, content: { doc: textToDoc('last') } }),
      card({ columnId: 'col', columnOrder: 2, content: { doc: textToDoc('second') } }),
      card({ columnId: 'col', columnOrder: 1, content: { doc: textToDoc('first') } }),
      column,
      card({ x: 0, y: 110, content: { doc: textToDoc('left of column') } }),
      card({ type: 'todo', x: 0, y: 900, content: { title: 'Tasks', items: [{ id: '1', text: 'Done', done: true }, { id: '2', text: 'Open', done: false }] } }),
      card({ type: 'arrow', content: { from: { x: 0, y: 0 }, to: { x: 1, y: 1 } } }),
    ])
    expect(md).toBe(
      '# Brief\n\nleft of column\n\n## Script\n\nfirst\n\nsecond\n\nlast\n\n**Tasks**\n\n- [x] Done\n- [ ] Open\n',
    )
  })
})

describe('boardToMarkdown with newer card types', () => {
  const card = (over: Partial<Card>): Card => ({
    id: crypto.randomUUID(), boardId: 'b', type: 'note', x: 0, y: 0, w: 100, z: 0, columnId: null, columnOrder: 0, content: {}, searchText: '', ...over,
  })

  it('writes tables, documents, files and sketches', () => {
    const md = boardToMarkdown('B', [
      card({ type: 'table', y: 0, content: { rows: [['Hook', 'Result'], ['A|B', 'line\nbreak']] } }),
      card({ type: 'doc', y: 100, content: { title: 'Script', doc: textToDoc('Body') } }),
      card({ type: 'file', y: 200, content: { name: 'cut.mp4' } }),
      card({ type: 'sketch', y: 300, content: { strokes: [] } }),
    ])
    expect(md).toBe(
      '# B\n\n| Hook | Result |\n| --- | --- |\n| A\\|B | line<br>break |\n\n## Script\n\nBody\n\n*[File: cut.mp4]*\n\n*[Sketch]*\n',
    )
  })
})

describe('parseClip', () => {
  const message = (clip: object) => ({ type: 'briefboard-clip', clip })

  it('accepts a valid clip', () => {
    expect(parseClip(message({ kind: 'page', url: 'https://a.co/x', title: 'T' }))).toEqual({ kind: 'page', url: 'https://a.co/x', title: 'T', text: undefined })
  })

  it('rejects other messages, unknown kinds and unsafe URLs', () => {
    expect(parseClip({ type: 'other' })).toBeNull()
    expect(parseClip(null)).toBeNull()
    expect(parseClip(message({ kind: 'evil', url: 'https://a.co' }))).toBeNull()
    expect(parseClip(message({ kind: 'page', url: 'javascript:alert(1)' }))).toBeNull()
    expect(parseClip(message({ kind: 'text', url: 'https://a.co' }))).toBeNull()
  })

  it('drops unsafe image sources but keeps the clip', () => {
    const clip = parseClip(message({ kind: 'image', url: 'https://a.co', imageUrl: 'javascript:x', imageDataUrl: 'data:text/html;base64,AAAA' }))!
    expect(clip.imageUrl).toBeUndefined()
    expect(clip.imageDataUrl).toBeUndefined()
    expect(parseClip(message({ kind: 'image', url: 'https://a.co', imageDataUrl: 'data:image/svg+xml;base64,AAAA' }))!.imageDataUrl).toBeUndefined()
    expect(parseClip(message({ kind: 'image', url: 'https://a.co', imageDataUrl: 'data:image/png;base64,AAAA' }))!.imageDataUrl).toBeDefined()
  })

  it('turns selected text into a quote that links to its source', () => {
    const content = textClipContent({ kind: 'text', url: 'https://a.co', title: 'Page', text: 'Quote' })
    expect(docToMarkdown(content.doc)).toBe('> Quote\n\nSource: [Page](https://a.co)')
  })
})

describe('geometry', () => {
  it('stops an arrow at the edge of a card, plus margin', () => {
    const rect = { x: 0, y: 0, w: 100, h: 100 }
    expect(clipToRect(rect, { x: 300, y: 50 }, 10)).toEqual({ x: 110, y: 50 })
    expect(clipToRect(rect, { x: 50, y: -300 }, 10)).toEqual({ x: 50, y: -10 })
  })

  it('detects overlap', () => {
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true)
    expect(intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 10, h: 10 })).toBe(false)
  })

  it('creates sort keys that fall between neighbours', () => {
    expect(ordersBetween(1, 2, 1)).toEqual([1.5])
    const [a, b] = ordersBetween(undefined, 1, 2)
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(1)
    expect(ordersBetween(5, undefined, 1)[0]).toBeGreaterThan(5)
    expect(ordersBetween(undefined, undefined, 2)).toEqual([1, 2])
  })
})

describe('escapeLike', () => {
  it('stops search wildcards being interpreted', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\')
  })
})
