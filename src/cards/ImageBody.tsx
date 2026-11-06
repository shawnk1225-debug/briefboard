import { useEffect, useState } from 'react'
import { backend } from '../data/backend'
import { patchContent } from '../store/store'
import type { Card } from '../types'
import { useTextCommit } from './useTextCommit'

export function ImageBody({ card }: { card: Card }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const commit = useTextCommit(card.id)
  const { ref, aspect, caption } = card.content

  useEffect(() => {
    let live = true
    if (ref) {
      backend
        .resolveImage(ref)
        .then((url) => live && setSrc(url))
        .catch(() => live && setFailed(true))
    }
    return () => {
      live = false
    }
  }, [ref])

  return (
    <figure className="image-body">
      <div className="image-frame" style={{ aspectRatio: aspect ? String(aspect) : '4 / 3' }}>
        {src && !failed && <img src={src} alt={caption ?? ''} draggable={false} crossOrigin="anonymous" onError={() => setFailed(true)} />}
        {failed && <span className="image-missing">Image couldn't be loaded</span>}
      </div>
      <input
        className="caption"
        data-interactive
        placeholder="Add a caption"
        aria-label="Image caption"
        value={caption ?? ''}
        {...commit}
        onChange={(e) => patchContent(card.id, { caption: e.target.value }, { history: false })}
      />
    </figure>
  )
}
