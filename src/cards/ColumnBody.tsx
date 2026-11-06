import { Fragment } from 'react'
import { useShallow } from 'zustand/shallow'
import { CardView } from '../canvas/CardView'
import { patchContent, useStore } from '../store/store'
import type { Card } from '../types'
import { useTextCommit } from './useTextCommit'

export function ColumnBody({ card }: { card: Card }) {
  const commit = useTextCommit(card.id)
  const childIds = useStore(
    useShallow((s) =>
      Object.values(s.cards)
        .filter((c) => c.columnId === card.id && !s.detached[c.id])
        .sort((a, b) => a.columnOrder - b.columnOrder)
        .map((c) => c.id),
    ),
  )
  const dropIndex = useStore((s) => (s.dropTarget?.columnId === card.id ? s.dropTarget.index : null))

  return (
    <div className={`column-body${dropIndex !== null ? ' drop-active' : ''}`} data-column-id={card.id} data-color={card.content.color ?? 'none'}>
      <input
        className="column-title"
        data-interactive
        placeholder="Column title"
        aria-label="Column title"
        value={card.content.title ?? ''}
        {...commit}
        onChange={(e) => patchContent(card.id, { title: e.target.value }, { history: false })}
      />
      <div className="column-items">
        {childIds.map((id, index) => (
          <Fragment key={id}>
            {dropIndex === index && <div className="drop-line" />}
            <CardView id={id} inColumn />
          </Fragment>
        ))}
        {dropIndex !== null && dropIndex >= childIds.length && <div className="drop-line" />}
        {!childIds.length && dropIndex === null && <div className="column-empty">Drag cards here</div>}
      </div>
    </div>
  )
}
