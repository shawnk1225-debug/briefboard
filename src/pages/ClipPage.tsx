import { useEffect, useState } from 'react'
import { backend } from '../data/backend'
import { parseClip, textClipContent, type Clip } from '../lib/clip'
import { cardSearchText } from '../lib/doc'
import { prepareImage } from '../lib/images'
import { fetchLinkPreview, parseEmbed } from '../lib/links'
import { createBoard, useStore } from '../store/store'
import type { Card, CardContent, CardType } from '../types'

async function buildContent(clip: Clip): Promise<{ type: CardType; content: CardContent; w: number }> {
  if (clip.kind === 'text') return { type: 'note', content: textClipContent(clip), w: 320 }
  if (clip.kind === 'image' && clip.imageDataUrl) {
    try {
      const blob = await (await fetch(clip.imageDataUrl)).blob()
      const { blob: prepared, extension, aspect } = await prepareImage(blob)
      const ref = await backend.uploadImage(prepared, extension)
      return { type: 'image', content: { ref, aspect, caption: clip.title }, w: 320 }
    } catch (err) {
      console.error('Falling back to a link for this image', err)
    }
  }
  const url = clip.imageUrl ?? clip.url
  const preview = await fetchLinkPreview(url)
  return {
    type: 'link',
    w: 300,
    // A video's own title is more accurate than the title of the page linking to it.
    content: { ...preview, title: parseEmbed(url) ? preview.title : clip.title || preview.title },
  }
}

async function saveClip(clip: Clip, boardId: string) {
  const existing = await backend.listCards(boardId)
  // Staggered so repeated clips to one board don't land exactly on top of each other.
  const offset = (existing.length % 12) * 32
  const { type, content, w } = await buildContent(clip)
  const card: Card = {
    id: crypto.randomUUID(),
    boardId,
    type,
    x: 40 + offset,
    y: 40 + offset,
    w,
    z: existing.reduce((max, c) => Math.max(max, c.z), 0) + 1,
    columnId: null,
    columnOrder: 0,
    content,
    searchText: cardSearchText(content),
  }
  await backend.applyOps([{ kind: 'insert', card }])
  return card
}

const NEW_BOARD = 'new'

export function ClipPage() {
  const boards = useStore((s) => s.boards)
  const [clip, setClip] = useState<Clip | null>(null)
  const [boardId, setBoardId] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'failed'>('idle')
  const [saved, setSaved] = useState<{ boardId: string; cardId: string } | null>(null)

  const options = Object.values(boards)
    .filter((b) => !b.deletedAt && !b.isTemplate)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const chosen = boardId || options[0]?.id || NEW_BOARD

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // Only this window: the extension posts here, and no other page or frame can.
      if (e.source !== window || e.origin !== window.location.origin) return
      const parsed = parseClip(e.data)
      if (parsed) setClip((current) => current ?? parsed)
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ type: 'briefboard-clip-ready' }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const save = async () => {
    if (!clip) return
    setState('saving')
    try {
      const target = chosen === NEW_BOARD ? (await createBoard({ title: clip.title?.slice(0, 80) || 'Clipped' })).id : chosen
      const card = await saveClip(clip, target)
      setSaved({ boardId: target, cardId: card.id })
      setState('idle')
    } catch (err) {
      console.error(err)
      setState('failed')
    }
  }

  if (saved) {
    return (
      <div className="center-page">
        <h1>Saved</h1>
        <p className="muted">You can close this tab.</p>
        <a className="btn primary" href={`#/b/${saved.boardId}?card=${saved.cardId}`}>Open board</a>
      </div>
    )
  }

  if (!clip) {
    return (
      <div className="center-page">
        <h1>Nothing to save yet</h1>
        <p className="muted">Use the Briefboard browser extension on a page to send something here.</p>
        <a className="btn" href="#/">Back to all boards</a>
      </div>
    )
  }

  return (
    <div className="center-page">
      <div className="clip-card">
        <h1 className="brand">Save to Briefboard</h1>
        <div className="clip-preview">
          {clip.imageDataUrl && <img src={clip.imageDataUrl} alt="" />}
          {clip.text && <blockquote>{clip.text}</blockquote>}
          <strong>{clip.title || clip.url}</strong>
          <span>{clip.url}</span>
        </div>
        <label>
          Board
          <select value={chosen} onChange={(e) => setBoardId(e.target.value)}>
            {options.map((board) => (
              <option key={board.id} value={board.id}>{board.title}</option>
            ))}
            <option value={NEW_BOARD}>New board</option>
          </select>
        </label>
        {state === 'failed' && <p className="field-error" role="alert">Couldn't save that. Check your connection and try again.</p>}
        <button className="btn primary" disabled={state === 'saving'} onClick={() => void save()}>
          {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
