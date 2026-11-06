import { create } from 'zustand'
import type { BoardFilters, HomeView } from '../lib/boardsView'

interface HomePrefs extends BoardFilters {
  view: HomeView
  layout: 'list' | 'grid'
  collapsed: Record<string, true>
  shareFolderId: string | null
}

const KEY = 'briefboard:home'
const DEFAULTS: HomePrefs = { view: { kind: 'all' }, layout: 'list', collapsed: {}, shareFolderId: null, query: '', status: 'any', format: 'any', sort: 'edited' }

function load(): HomePrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<HomePrefs>
    return { ...DEFAULTS, ...saved, query: '' }
  } catch {
    return DEFAULTS
  }
}

// Survives opening a board and coming back, so you return to the folder you were in.
export const useHomePrefs = create<HomePrefs>(load)

useHomePrefs.subscribe(({ view, layout, collapsed, status, format, sort }) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ view, layout, collapsed, status, format, sort }))
  } catch {
    // Remembering these is only a convenience.
  }
})
