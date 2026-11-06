import type { CardContent, LinkEmbed } from '../types'

// Only http(s) URLs ever reach an href or iframe, so a pasted javascript: URL can't run.
export function normalizeUrl(input: string): string | null {
  const text = input.trim()
  if (!text || /\s/.test(text)) return null
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text)
  if (!hasScheme && !/^[^/]+\.[a-z]{2,}([/?#:]|$)/i.test(text)) return null
  try {
    const url = new URL(hasScheme ? text : `https://${text}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export function parseEmbed(href: string): LinkEmbed | undefined {
  const url = new URL(href)
  const host = url.hostname.replace(/^(www|m)\./, '')
  const parts = url.pathname.split('/').filter(Boolean)
  if (host === 'youtu.be' && parts[0]) return { provider: 'youtube', id: parts[0] }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id = url.searchParams.get('v') ?? (['shorts', 'embed', 'live'].includes(parts[0]) ? parts[1] : undefined)
    if (id) return { provider: 'youtube', id }
  }
  if (host === 'vimeo.com' && /^\d+$/.test(parts[0] ?? '')) return { provider: 'vimeo', id: parts[0] }
  if (host === 'tiktok.com') {
    const index = parts.indexOf('video')
    if (index >= 0 && /^\d+$/.test(parts[index + 1] ?? '')) return { provider: 'tiktok', id: parts[index + 1] }
  }
  return undefined
}

export function embedSrc(embed: LinkEmbed): string {
  const id = encodeURIComponent(embed.id)
  if (embed.provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${id}?autoplay=1`
  if (embed.provider === 'vimeo') return `https://player.vimeo.com/video/${id}?autoplay=1`
  return `https://www.tiktok.com/embed/v2/${id}`
}

export const hostOf = (href: string) => {
  try {
    return new URL(href).hostname.replace(/^www\./, '')
  } catch {
    return href
  }
}

const OEMBED: Record<LinkEmbed['provider'], string> = {
  youtube: 'https://www.youtube.com/oembed?format=json&url=',
  vimeo: 'https://vimeo.com/api/oembed.json?url=',
  tiktok: 'https://www.tiktok.com/oembed?url=',
}

// Static hosting can't fetch arbitrary pages (browsers block it), so rich previews
// are limited to providers with a public oEmbed API. Everything else stays a plain
// link card whose title you can edit by hand.
export async function fetchLinkPreview(href: string): Promise<Partial<CardContent>> {
  const embed = parseEmbed(href)
  const base: Partial<CardContent> = { url: href, embed, title: hostOf(href) }
  if (embed?.provider === 'youtube') base.thumbnail = `https://i.ytimg.com/vi/${encodeURIComponent(embed.id)}/hqdefault.jpg`
  if (!embed) return base
  try {
    const res = await fetch(OEMBED[embed.provider] + encodeURIComponent(href))
    if (!res.ok) return base
    const data = (await res.json()) as { title?: string; thumbnail_url?: string }
    return { ...base, title: data.title || base.title, thumbnail: base.thumbnail ?? data.thumbnail_url }
  } catch {
    return base
  }
}
