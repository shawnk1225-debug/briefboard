import { memo, useEffect, useRef } from 'react'
import { BoardBody } from '../cards/BoardBody'
import { ColumnBody } from '../cards/ColumnBody'
import { DocBody } from '../cards/DocBody'
import { FileBody } from '../cards/FileBody'
import { ImageBody } from '../cards/ImageBody'
import { LinkBody } from '../cards/LinkBody'
import { NoteBody } from '../cards/NoteBody'
import { SketchBody } from '../cards/SketchBody'
import { TableBody } from '../cards/TableBody'
import { TodoBody } from '../cards/TodoBody'
import { navigate } from '../lib/route'
import { useStore } from '../store/store'
import { bumpLayout } from './ArrowLayer'
import { startCardPointer, startResize } from './drag'
import { spaceHeld } from './shortcuts'

export const CardView = memo(function CardView({ id, inColumn = false }: { id: string; inColumn?: boolean }) {
  const card = useStore((s) => s.cards[id])
  const selected = useStore((s) => Boolean(s.selected[id]))
  const dragging = useStore((s) => Boolean(s.dragIds[id]))
  const commentCount = useStore((s) => Object.values(s.comments).filter((c) => c.cardId === id && !c.resolved).length)
  const ref = useRef<HTMLDivElement>(null)

  // Arrows need to follow when a card's height changes as its content changes.
  useEffect(() => {
    if (!ref.current) return
    const observer = new ResizeObserver(bumpLayout)
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  if (!card) return null

  const onDoubleClick = () => {
    if (card.type === 'board' && card.content.boardId) navigate(`/b/${card.content.boardId}`)
  }

  const style = inColumn ? undefined : { left: card.x, top: card.y, width: card.w, zIndex: card.z }

  return (
    <div
      ref={ref}
      data-card-id={id}
      className={`card card-${card.type}${selected ? ' selected' : ''}${dragging ? ' dragging' : ''}${inColumn ? ' in-column' : ''}`}
      style={style}
      onPointerDown={(e) => {
        // Middle-button and space-drag fall through to the canvas, for panning.
        if (e.button !== 0 || spaceHeld()) return
        // A nested card shouldn't also start a drag of the column around it.
        if (inColumn) e.stopPropagation()
        startCardPointer(e, card)
      }}
      onDoubleClick={onDoubleClick}
    >
      {card.type === 'note' && <NoteBody card={card} />}
      {card.type === 'image' && <ImageBody card={card} />}
      {card.type === 'link' && <LinkBody card={card} />}
      {card.type === 'todo' && <TodoBody card={card} />}
      {card.type === 'board' && <BoardBody card={card} selected={selected} />}
      {card.type === 'column' && <ColumnBody card={card} />}
      {card.type === 'table' && <TableBody card={card} selected={selected} />}
      {card.type === 'doc' && <DocBody card={card} />}
      {card.type === 'file' && <FileBody card={card} />}
      {card.type === 'sketch' && <SketchBody card={card} />}
      {commentCount > 0 && (
        <button
          className="comment-badge"
          data-interactive
          data-html2image-ignore
          aria-label={`${commentCount} open comments`}
          title="Open comments"
          onClick={() => useStore.setState({ commentCardId: id })}
        >
          {commentCount}
        </button>
      )}
      {selected && !inColumn && !dragging && (
        <div
          className="resize-handle"
          data-html2image-ignore
          title="Drag to resize"
          onPointerDown={(e) => startResize(e, card)}
        />
      )}
    </div>
  )
})
