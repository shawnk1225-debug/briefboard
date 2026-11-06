import type { CardContent, RichDoc } from '../types'
import { textToDoc } from './doc'
import { normalizeUrl } from './links'

export interface Clip {
  kind: 'page' | 'link' | 'image' | 'text'
  url: string
  title?: string
  text?: string
  imageUrl?: string
  imageDataUrl?: string
}

const asText = (value: unknown, max: number) => (typeof value === 'string' && value ? value.slice(0, max) : undefined)

// Clips arrive by window message, so nothing in one is trusted until it has been checked here.
export function parseClip(data: unknown): Clip | null {
  const message = data as { type?: unknown; clip?: Record<string, unknown> } | null
  if (message?.type !== 'briefboard-clip' || !message.clip) return null
  const { kind, url, title, text, imageUrl, imageDataUrl } = message.clip
  if (kind !== 'page' && kind !== 'link' && kind !== 'image' && kind !== 'text') return null
  const safeUrl = typeof url === 'string' ? normalizeUrl(url) : null
  if (!safeUrl) return null
  const clip: Clip = { kind, url: safeUrl, title: asText(title, 500), text: asText(text, 20000) }
  if (typeof imageUrl === 'string') clip.imageUrl = normalizeUrl(imageUrl) ?? undefined
  if (typeof imageDataUrl === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(imageDataUrl)) {
    clip.imageDataUrl = imageDataUrl
  }
  if (kind === 'text' && !clip.text) return null
  return clip
}

// A quote from a page, followed by a link back to where it came from.
export function textClipContent(clip: Clip): CardContent {
  const doc = textToDoc(clip.text ?? '')
  const source: RichDoc = {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Source: ' },
      { type: 'text', text: clip.title || clip.url, marks: [{ type: 'link', attrs: { href: clip.url } }] },
    ],
  }
  return { doc: { type: 'doc', content: [{ type: 'blockquote', content: doc.content }, source] } }
}
