import { useEffect } from 'react'
import { parseRoute, parseShareRoute } from '../lib/route'
import { useStore } from '../store/store'

// Uses the browser's real full screen where it can. Where it's refused or unavailable, such as
// on iPhones, the board still fills the page, because the layout follows the store rather than
// the browser.
export function setFullScreen(on: boolean) {
  useStore.setState({ fullScreen: on })
  if (on) {
    void document.documentElement.requestFullscreen?.().catch(() => {})
  } else if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {})
  }
}

const onBoardRoute = (hash: string) => Boolean(parseRoute(hash).boardId || parseShareRoute(hash)?.boardId)

export function useFullScreenSync() {
  useEffect(() => {
    // Pressing Esc makes the browser leave full screen on its own, so the layout follows it.
    const onChange = () => {
      if (!document.fullscreenElement) useStore.setState({ fullScreen: false })
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      // Opening a nested board stays full screen. Leaving boards altogether doesn't.
      if (useStore.getState().fullScreen && !onBoardRoute(window.location.hash)) setFullScreen(false)
    }
  }, [])
}
