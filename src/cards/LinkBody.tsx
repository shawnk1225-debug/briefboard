import { useState } from 'react'
import { embedSrc, fetchLinkPreview, hostOf, normalizeUrl } from '../lib/links'
import { patchContent } from '../store/store'
import type { Card } from '../types'
import { useTextCommit } from './useTextCommit'

function LinkEntry({ card }: { card: Card }) {
  const [value, setValue] = useState('')
  const [invalid, setInvalid] = useState(false)
  const submit = async () => {
    const url = normalizeUrl(value)
    if (!url) {
      setInvalid(true)
      return
    }
    patchContent(card.id, await fetchLinkPreview(url))
  }
  return (
    <div className="link-entry">
      <input
        data-interactive
        autoFocus
        placeholder="Paste a link and press Enter"
        aria-label="Link URL"
        value={value}
        aria-invalid={invalid}
        onChange={(e) => {
          setValue(e.target.value)
          setInvalid(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
        }}
      />
      {invalid && <p className="field-error">That doesn't look like a web address.</p>}
    </div>
  )
}

export function LinkBody({ card }: { card: Card }) {
  const [playing, setPlaying] = useState(false)
  const commit = useTextCommit(card.id)
  const { url, title, thumbnail, embed } = card.content
  if (!url) return <LinkEntry card={card} />
  const vertical = embed?.provider === 'tiktok'

  return (
    <div className="link-body">
      {embed && (
        <div className={`link-media${vertical ? ' vertical' : ''}`}>
          {playing ? (
            <iframe
              src={embedSrc(embed)}
              title={title ?? 'Embedded video'}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <>
              {thumbnail && <img src={thumbnail} alt="" draggable={false} referrerPolicy="no-referrer" />}
              <button className="play" data-interactive aria-label="Play video" onClick={() => setPlaying(true)}>
                ▶
              </button>
            </>
          )}
        </div>
      )}
      <div className="link-meta">
        <input
          className="link-title"
          data-interactive
          aria-label="Link title"
          placeholder="Title"
          value={title ?? ''}
          {...commit}
          onChange={(e) => patchContent(card.id, { title: e.target.value }, { history: false })}
        />
        <a href={url} target="_blank" rel="noopener noreferrer" data-interactive className="link-host">
          {hostOf(url)} ↗
        </a>
      </div>
    </div>
  )
}
