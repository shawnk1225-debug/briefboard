import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setFullScreen } from '../src/canvas/fullScreen'
import { useStore } from '../src/store/store'

const fullScreen = () => useStore.getState().fullScreen

function stubDocument({ request, element = null }: { request?: () => Promise<void>; element?: unknown }) {
  const exitFullscreen = vi.fn(() => Promise.resolve())
  vi.stubGlobal('document', { documentElement: { requestFullscreen: request }, fullscreenElement: element, exitFullscreen })
  return { exitFullscreen }
}

afterEach(() => {
  useStore.setState({ fullScreen: false })
  vi.unstubAllGlobals()
})

describe('optional full screen', () => {
  it('starts off, so the normal view is the default', () => {
    expect(fullScreen()).toBe(false)
  })

  it('asks the browser for full screen, and leaves it again', () => {
    const request = vi.fn(() => Promise.resolve())
    const { exitFullscreen } = stubDocument({ request, element: {} })
    setFullScreen(true)
    expect(fullScreen()).toBe(true)
    expect(request).toHaveBeenCalledOnce()
    setFullScreen(false)
    expect(fullScreen()).toBe(false)
    expect(exitFullscreen).toHaveBeenCalledOnce()
  })

  it('still fills the page when the browser refuses', async () => {
    stubDocument({ request: () => Promise.reject(new Error('denied')) })
    setFullScreen(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fullScreen()).toBe(true)
  })

  it('still fills the page where browsers have no full screen at all', () => {
    stubDocument({})
    expect(() => setFullScreen(true)).not.toThrow()
    expect(fullScreen()).toBe(true)
  })

  it('turns off without error when the browser was never in full screen', () => {
    const { exitFullscreen } = stubDocument({})
    useStore.setState({ fullScreen: true })
    setFullScreen(false)
    expect(fullScreen()).toBe(false)
    expect(exitFullscreen).not.toHaveBeenCalled()
  })
})
