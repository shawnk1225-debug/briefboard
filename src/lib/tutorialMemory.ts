import type { TutorialState } from '../types'

const key = (who: string) => `briefboard:tutorial:${who}`
const RANK: Record<TutorialState, number> = { new: 0, bubble: 1, done: 2 }

export function readTutorialState(who: string): TutorialState {
  try {
    const saved = localStorage.getItem(key(who))
    return saved === 'bubble' || saved === 'done' ? saved : 'new'
  } catch {
    return 'new'
  }
}

export function writeTutorialState(who: string, state: TutorialState) {
  try {
    localStorage.setItem(key(who), state)
  } catch {
    // The login's own copy still remembers this.
  }
}

// Answers only ever move forward, so nobody is asked again if one copy is behind.
export const furthestTutorialState = (a: TutorialState, b: TutorialState): TutorialState => (RANK[a] >= RANK[b] ? a : b)
