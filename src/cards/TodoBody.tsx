import { useEffect, useRef } from 'react'
import { patchContent } from '../store/store'
import type { Card, TodoItem } from '../types'
import { useTextCommit } from './useTextCommit'

export function TodoBody({ card }: { card: Card }) {
  const items = card.content.items ?? []
  const commit = useTextCommit(card.id)
  const focusId = useRef<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const done = items.filter((item) => item.done).length

  useEffect(() => {
    if (!focusId.current) return
    listRef.current?.querySelector<HTMLInputElement>(`[data-item="${focusId.current}"]`)?.focus()
    focusId.current = null
  })

  const setItems = (next: TodoItem[], history = true) => patchContent(card.id, { items: next }, { history })

  const insertAfter = (index: number) => {
    const item = { id: crypto.randomUUID(), text: '', done: false }
    focusId.current = item.id
    setItems([...items.slice(0, index + 1), item, ...items.slice(index + 1)])
  }

  return (
    <div className="todo-body">
      <div className="todo-head">
        <input
          className="todo-title"
          data-interactive
          placeholder="To-do list"
          aria-label="List title"
          value={card.content.title ?? ''}
          {...commit}
          onChange={(e) => patchContent(card.id, { title: e.target.value }, { history: false })}
        />
        {items.length > 0 && (
          <span className="todo-count">
            {done}/{items.length}
          </span>
        )}
      </div>
      <ul ref={listRef}>
        {items.map((item, index) => (
          <li key={item.id} className={item.done ? 'done' : ''}>
            <input
              type="checkbox"
              data-interactive
              checked={item.done}
              aria-label={`Mark "${item.text || 'item'}" done`}
              onChange={() => setItems(items.map((it) => (it.id === item.id ? { ...it, done: !it.done } : it)))}
            />
            <input
              type="text"
              data-interactive
              data-item={item.id}
              placeholder="New item"
              aria-label="Item text"
              value={item.text}
              {...commit}
              onChange={(e) => setItems(items.map((it) => (it.id === item.id ? { ...it, text: e.target.value } : it)), false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  insertAfter(index)
                } else if (e.key === 'Backspace' && !item.text) {
                  e.preventDefault()
                  focusId.current = items[index - 1]?.id ?? items[index + 1]?.id ?? null
                  setItems(items.filter((it) => it.id !== item.id))
                }
              }}
            />
          </li>
        ))}
      </ul>
      <button className="todo-add" data-interactive onClick={() => insertAfter(items.length - 1)}>
        + Add item
      </button>
    </div>
  )
}
