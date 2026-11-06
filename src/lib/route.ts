import { useSyncExternalStore } from 'react'

const subscribe = (listener: () => void) => {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

export const useHash = () => useSyncExternalStore(subscribe, () => window.location.hash)

export const navigate = (path: string) => {
  window.location.hash = path
}

export function parseRoute(hash: string): { boardId: string | null; cardId: string | null } {
  const match = hash.match(/^#\/b\/([^?]+)(?:\?card=(.+))?$/)
  return { boardId: match?.[1] ?? null, cardId: match?.[2] ?? null }
}
