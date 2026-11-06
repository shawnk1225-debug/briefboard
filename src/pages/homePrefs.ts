import { create } from 'zustand'
import type { BoardFilters, HomeView } from '../lib/boardsView'

interface HomePrefs extends BoardFilters {
  view: HomeView
  layout: 'list' | 'grid'
  collapsed: Record<string, true>
  shareFolderId: string | null
  hideTemplates: boolean
}

const KEY = 'briefboard:home'
const DEFAULTS: HomePrefs = { view: { kind: 'all' }, layout: 'grid', collapsed: {}, shareFolderId: null, hideTemplates: false, query: '', status: 'any', format: 'any', sort: 'edited' }

// Saved separately from the old `layout` value, which every browser stored automatically when
// List was the default. Ignoring it moves everyone to Grid once, then their own choice sticks.
interface SavedPrefs extends Partial<Omit<HomePrefs, 'layout'>> {
  layout?: unknown
  chosenLayout?: HomePrefs['layout']
}

export function readSavedPrefs(raw: string | null): HomePrefs {
  try {
    const { layout: _oldLayout, chosenLayout, ...saved } = JSON.parse(raw ?? '{}') as SavedPrefs
    return { ...DEFAULTS, ...saved, layout: chosenLayout ?? DEFAULTS.layout, shareFolderId: null, query: '' }
  } catch {
    return DEFAULTS
  }
}

function load(): HomePrefs {
  try {
    return readSavedPrefs(localStorage.getItem(KEY))
  } catch {
    return DEFAULTS
  }
}

// Survives opening a board and coming back, so you return to the folder you were in.
export const useHomePrefs = create<HomePrefs>(load)

useHomePrefs.subscribe(({ view, layout, collapsed, status, format, sort, hideTemplates }) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ view, chosenLayout: layout, collapsed, status, format, sort, hideTemplates }))
  } catch {
    // Remembering these is only a convenience.
  }
})
