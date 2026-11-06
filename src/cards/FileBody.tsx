import { useEffect, useState } from 'react'
import { backend } from '../data/backend'
import type { Card } from '../types'
import { showToast } from '../ui/feedback'

export function formatBytes(bytes = 0): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileBody({ card }: { card: Card }) {
  const { ref, name, size, mime } = card.content
  const playable = mime?.startsWith('video/') || mime?.startsWith('audio/')
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const extension = name?.match(/\.([a-z0-9]{1,4})$/i)?.[1].toUpperCase() ?? 'FILE'

  useEffect(() => {
    let live = true
    if (ref && playable) {
      backend
        .fileUrl(ref)
        .then((url) => live && setMediaUrl(url))
        .catch((err) => console.error(err))
    }
    return () => {
      live = false
    }
  }, [ref, playable])

  const download = async () => {
    if (!ref) return
    try {
      const a = document.createElement('a')
      a.href = await backend.fileUrl(ref, name)
      a.download = name ?? 'file'
      a.click()
    } catch (err) {
      console.error(err)
      showToast(`Couldn't download ${name ?? 'that file'}.`)
    }
  }

  return (
    <div className="file-body">
      {mediaUrl && mime?.startsWith('video/') && (
        <video className="file-media" data-interactive data-html2image-ignore src={mediaUrl} controls preload="metadata" />
      )}
      {mediaUrl && mime?.startsWith('audio/') && (
        <audio className="file-media audio" data-interactive data-html2image-ignore src={mediaUrl} controls preload="metadata" />
      )}
      <div className="file-row">
        <span className="file-badge" aria-hidden="true">{extension}</span>
        <div className="file-meta">
          <strong>{name ?? 'File'}</strong>
          <span>{formatBytes(size)}</span>
        </div>
        <button className="btn" data-interactive data-html2image-ignore onClick={() => void download()}>Download</button>
      </div>
    </div>
  )
}
