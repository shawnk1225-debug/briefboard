import { createPortal } from 'react-dom'
import { docText } from '../lib/doc'
import { patchContent, setEditing, useStore } from '../store/store'
import type { Card } from '../types'
import { RichEditor } from './NoteBody'
import { useTextCommit } from './useTextCommit'

function DocOverlay({ card }: { card: Card }) {
  const commit = useTextCommit(card.id)
  // The overlay sits in the card's React tree, so its events would otherwise
  // reach the canvas, where a click on "empty space" closes the editor.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  return createPortal(
    <div
      className="doc-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Document"
      onPointerDown={stop}
      onDoubleClick={stop}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <header className="doc-head">
        <button className="btn" onClick={() => setEditing(null)}>← Back to board</button>
      </header>
      <div className="doc-page">
        <input
          className="doc-title"
          placeholder="Untitled document"
          aria-label="Document title"
          value={card.content.title ?? ''}
          {...commit}
          onChange={(e) => patchContent(card.id, { title: e.target.value }, { history: false })}
        />
        <RichEditor card={card} className="doc-text" />
      </div>
    </div>,
    document.body,
  )
}

export function DocBody({ card }: { card: Card }) {
  const editing = useStore((s) => s.editingId === card.id)
  const preview = docText(card.content.doc).slice(0, 180)
  return (
    <div className="doc-body">
      <h3>{card.content.title || 'Untitled document'}</h3>
      <p className={preview ? '' : 'placeholder'}>{preview || 'Click again to open and write.'}</p>
      <button
        className="doc-open"
        data-interactive
        data-html2image-ignore
        onClick={() => setEditing(card.id)}
      >
        Open
      </button>
      {editing && <DocOverlay card={card} />}
    </div>
  )
}
