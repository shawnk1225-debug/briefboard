import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { backend } from '../data/backend'
import { cardTitle } from '../lib/doc'
import { navigate } from '../lib/route'
import { useStore } from '../store/store'
import type { SearchHit } from '../types'

const useSearchOpen = create<{ open: boolean }>(() => ({ open: false }))
export const openSearch = () => useSearchOpen.setState({ open: true })

export function SearchDialog() {
  const open = useSearchOpen((s) => s.open)
  const boards = useStore((s) => s.boards)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        openSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const term = query.trim()
    if (!open || !term) {
      setHits([])
      return
    }
    let live = true
    const timer = setTimeout(() => {
      backend
        .search(term)
        .then((results) => {
          if (live) {
            setHits(results)
            setFailed(false)
          }
        })
        .catch(() => live && setFailed(true))
    }, 200)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, open])

  if (!open) return null

  const close = () => {
    useSearchOpen.setState({ open: false })
    setQuery('')
  }
  const go = (path: string) => {
    close()
    navigate(path)
  }
  const term = query.trim().toLowerCase()
  const boardHits = term
    ? Object.values(boards).filter((b) => !b.deletedAt && b.title.toLowerCase().includes(term)).slice(0, 8)
    : []

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog search-dialog" role="dialog" aria-modal="true" aria-label="Search">
        <input
          autoFocus
          className="search-input"
          placeholder="Search all boards and cards"
          aria-label="Search all boards and cards"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && close()}
        />
        <ul className="search-results">
          {boardHits.map((board) => (
            <li key={board.id}>
              <button onClick={() => go(`/b/${board.id}`)}>
                <strong>{board.title}</strong>
                <span>Board</span>
              </button>
            </li>
          ))}
          {hits.map(({ card, boardTitle }) => (
            <li key={card.id}>
              <button onClick={() => go(`/b/${card.boardId}?card=${card.id}`)}>
                <strong>{cardTitle(card)}</strong>
                <span>{boardTitle}</span>
              </button>
            </li>
          ))}
        </ul>
        {failed && <p className="search-empty">Search isn't available right now. Check your connection.</p>}
        {!failed && term && !boardHits.length && !hits.length && <p className="search-empty">No matches for “{query.trim()}”.</p>}
      </div>
    </div>
  )
}
