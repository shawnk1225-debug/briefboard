import { useEffect } from 'react'
import { normalizeUrl, fetchLinkPreview } from '../lib/links'
import { textToDoc } from '../lib/doc'
import { duplicateColumn, expandForCopy, pasteCards } from '../store/copy'
import { addCard, patchContent, redo, removeCards, selectOnly, setEditing, setTool, undo, useStore } from '../store/store'
import type { Card } from '../types'
import { addFiles } from './addFiles'
import { setFullScreen } from './fullScreen'
import { fitToContent, getViewportEl, viewportCenter, zoomCentered } from './geometry'

const CLIPBOARD_TYPE = 'application/x-briefboard'
let space = false
export const spaceHeld = () => space

const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null
  return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))
}

export async function addLink(rawUrl: string, x: number, y: number): Promise<boolean> {
  const url = normalizeUrl(rawUrl)
  if (!url) return false
  const card = addCard('link', x, y, { url, title: new URL(url).hostname })
  patchContent(card.id, await fetchLinkPreview(url), { history: false })
  return true
}

export function duplicateSelection() {
  const { selected, cards } = useStore.getState()
  const ids = Object.keys(selected)
  if (!ids.length) return
  if (ids.length === 1 && cards[ids[0]]?.type === 'column') void duplicateColumn(ids[0])
  else void pasteCards(expandForCopy(ids, { keepAttachedArrows: true }), 28, 28)
}

export function useBoardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = useStore.getState()
      if (e.key === 'Escape') {
        if (s.editingId) setEditing(null)
        else if (s.tool !== 'select') setTool('select')
        else if (s.commentsOpen) useStore.setState({ commentsOpen: false, commentCardId: null })
        else if (Object.keys(s.selected).length) selectOnly([])
        // Only reached where the browser doesn't handle Esc for full screen itself.
        else if (s.fullScreen) setFullScreen(false)
        return
      }
      // Drawing or a full-screen document has no focused text field, but keys must not reach the board.
      if (isTyping(e.target) || s.editingId) return
      const cmd = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()
      if (e.code === 'Space') {
        space = true
        getViewportEl()?.classList.add('space-pan')
        e.preventDefault()
      } else if (cmd && key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (cmd && key === 'y') {
        e.preventDefault()
        redo()
      } else if (cmd && key === 'd') {
        e.preventDefault()
        duplicateSelection()
      } else if (cmd && key === 'a') {
        e.preventDefault()
        selectOnly(Object.values(s.cards).filter((c) => !c.columnId).map((c) => c.id))
      } else if (cmd && (key === '=' || key === '+')) {
        e.preventDefault()
        zoomCentered(s.viewport.zoom * 1.25)
      } else if (cmd && key === '-') {
        e.preventDefault()
        zoomCentered(s.viewport.zoom / 1.25)
      } else if (cmd && key === '0') {
        e.preventDefault()
        fitToContent()
      } else if (key === 'delete' || key === 'backspace') {
        const ids = Object.keys(s.selected)
        if (ids.length) {
          e.preventDefault()
          removeCards(ids)
        }
      } else if (key === 'enter') {
        const ids = Object.keys(s.selected)
        if (ids.length === 1 && ['note', 'doc', 'sketch'].includes(s.cards[ids[0]]?.type)) {
          e.preventDefault()
          setEditing(ids[0])
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        space = false
        getViewportEl()?.classList.remove('space-pan')
      }
    }
    const writeClipboard = (e: ClipboardEvent) => {
      const ids = Object.keys(useStore.getState().selected)
      if (!ids.length || !e.clipboardData) return false
      const cards = expandForCopy(ids)
      e.clipboardData.setData(CLIPBOARD_TYPE, JSON.stringify(cards))
      e.clipboardData.setData('text/plain', cards.map((c) => c.searchText).filter(Boolean).join('\n\n'))
      e.preventDefault()
      return true
    }
    const onCopy = (e: ClipboardEvent) => {
      if (!isTyping(e.target) && !window.getSelection()?.toString()) writeClipboard(e)
    }
    const onCut = (e: ClipboardEvent) => {
      if (!isTyping(e.target) && writeClipboard(e)) removeCards(Object.keys(useStore.getState().selected))
    }
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || !e.clipboardData || useStore.getState().editingId) return
      const data = e.clipboardData
      const at = viewportCenter()
      const copied = data.getData(CLIPBOARD_TYPE)
      if (copied) {
        e.preventDefault()
        const cards = JSON.parse(copied) as Card[]
        const top = cards.filter((c) => !c.columnId && c.type !== 'arrow')
        const minX = Math.min(...top.map((c) => c.x))
        const minY = Math.min(...top.map((c) => c.y))
        void pasteCards(cards, at.x - minX - 100, at.y - minY - 60)
        return
      }
      const files = [...data.files]
      if (files.length) {
        e.preventDefault()
        void addFiles(files, at.x - 160, at.y - 120)
        return
      }
      const text = data.getData('text/plain').trim()
      if (!text) return
      e.preventDefault()
      if (normalizeUrl(text) && /^(https?:\/\/|www\.)/i.test(text)) void addLink(text, at.x - 150, at.y - 60)
      else addCard('note', at.x - 130, at.y - 40, { doc: textToDoc(text) })
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  }, [])
}
