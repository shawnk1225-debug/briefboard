import { useLayoutEffect, useRef, useState } from 'react'
import { patchContent, useStore } from '../store/store'
import type { Card } from '../types'
import { useTextCommit } from './useTextCommit'

const EMPTY_TABLE = [
  ['', '', ''],
  ['', '', ''],
  ['', '', ''],
]

function Cell({ value, label, onChange, onFocus, onBlur, onEnter }: {
  value: string
  label: string
  onChange: (value: string) => void
  onFocus: () => void
  onBlur: () => void
  onEnter: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // Grows with its text, so long lines wrap instead of being cut off.
  useLayoutEffect(() => {
    const el = ref.current!
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      data-interactive
      rows={1}
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          onEnter()
        }
      }}
    />
  )
}

export function TableBody({ card, selected }: { card: Card; selected: boolean }) {
  const rows = card.content.rows ?? EMPTY_TABLE
  const commit = useTextCommit(card.id)
  const readOnly = useStore((s) => s.readOnly)
  const [active, setActive] = useState({ row: 0, column: 0 })
  const tableRef = useRef<HTMLTableElement>(null)
  const columnCount = rows[0]?.length ?? 0

  const setRows = (next: string[][], history = true) => patchContent(card.id, { rows: next }, { history })

  const focusCell = (row: number, column: number) => {
    requestAnimationFrame(() => {
      tableRef.current?.rows[row]?.cells[column]?.querySelector('textarea')?.focus()
    })
  }

  const addRow = () => setRows([...rows, Array<string>(columnCount).fill('')])
  const addColumn = () => setRows(rows.map((row) => [...row, '']))
  const deleteRow = () => {
    if (rows.length > 1) setRows(rows.filter((_, r) => r !== active.row))
    setActive({ row: 0, column: active.column })
  }
  const deleteColumn = () => {
    if (columnCount > 1) setRows(rows.map((row) => row.filter((_, c) => c !== active.column)))
    setActive({ row: active.row, column: 0 })
  }

  return (
    <div className="table-body">
      <input
        className="table-title"
        data-interactive
        placeholder="Table title"
        aria-label="Table title"
        value={card.content.title ?? ''}
        {...commit}
        onChange={(e) => patchContent(card.id, { title: e.target.value }, { history: false })}
      />
      <table ref={tableRef}>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className={r === 0 ? 'header-row' : ''}>
              {row.map((value, c) => (
                <td key={c}>
                  <Cell
                    value={value}
                    label={`Row ${r + 1}, column ${c + 1}`}
                    onChange={(text) => setRows(rows.map((cells, i) => (i === r ? cells.map((old, j) => (j === c ? text : old)) : cells)), false)}
                    onFocus={() => {
                      setActive({ row: r, column: c })
                      commit.onFocus()
                    }}
                    onBlur={commit.onBlur}
                    onEnter={() => {
                      if (r === rows.length - 1) addRow()
                      focusCell(r + 1, c)
                    }}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {selected && !readOnly && (
        <div className="table-actions" data-interactive data-html2image-ignore>
          <button onClick={addRow}>+ Row</button>
          <button onClick={addColumn}>+ Column</button>
          <button disabled={rows.length < 2} title="Deletes the row of the last cell you clicked" onClick={deleteRow}>− Row</button>
          <button disabled={columnCount < 2} title="Deletes the column of the last cell you clicked" onClick={deleteColumn}>− Column</button>
        </div>
      )}
    </div>
  )
}
