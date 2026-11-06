import { useRef } from 'react'
import { commitInteraction, useStore } from '../store/store'
import type { Card } from '../types'

// For plain inputs on cards: typing saves as you go, and one focus-to-blur
// stretch of typing becomes one undo step.
export function useTextCommit(id: string) {
  const before = useRef<Card | null>(null)
  return {
    onFocus: () => {
      before.current = useStore.getState().cards[id] ?? null
    },
    onBlur: () => {
      if (before.current) commitInteraction([before.current], { sync: false })
      before.current = null
    },
  }
}
