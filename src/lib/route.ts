import { useSyncExternalStore } from 'react'

const subscribe = (listener: () => void) => {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

export const useHash = () => useSyncExternalStore(subscribe, () => window.location.hash)

export const navigate = (path: string) => {
  window.location.hash = path
}

export function parseShareRoute(hash: string): { token: string; boardId: string | null; cardId: string | null } | null {
  const match = hash.match(/^#\/s\/([A-Za-z0-9]+)(?:\/b\/([^?]+)(?:\?card=(.+))?)?$/)
  return match ? { token: match[1], boardId: match[2] ?? null, cardId: match[3] ?? null } : null
}

export function parseRoute(hash: string): { boardId: string | null; cardId: string | null } {
  const match = hash.match(/^#\/b\/([^?]+)(?:\?card=(.+))?$/)
  return { boardId: match?.[1] ?? null, cardId: match?.[2] ?? null }
}
