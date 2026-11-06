import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setFullScreen } from '../src/canvas/fullScreen'
import { fitViewport, MIN_ZOOM, type Rect } from '../src/canvas/geometry'
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

describe('the view a board opens with', () => {
  const W = 1400
  const H = 800
  const shows = (bounds: Rect, width = W, height = H) => {
    const { x, y, zoom } = fitViewport(bounds, width, height)
    return {
      zoom,
      left: bounds.x * zoom + x,
      top: bounds.y * zoom + y,
      right: (bounds.x + bounds.w) * zoom + x,
      bottom: (bounds.y + bounds.h) * zoom + y,
    }
  }

  it('shows every edge of a board larger than the screen, clear of the toolbar', () => {
    const view = shows({ x: -500, y: -300, w: 6000, h: 4000 })
    expect(view.zoom).toBeLessThan(0.2)
    expect(view.left).toBeGreaterThanOrEqual(76)
    expect(view.top).toBeGreaterThanOrEqual(66)
    expect(view.right).toBeLessThanOrEqual(W)
    expect(view.bottom).toBeLessThanOrEqual(H)
  })

  it('zooms out further the more a board has on it', () => {
    expect(shows({ x: 0, y: 0, w: 8000, h: 500 }).zoom).toBeLessThan(shows({ x: 0, y: 0, w: 3000, h: 500 }).zoom)
  })

  it('still fits a board too large for manual zooming', () => {
    const view = shows({ x: 0, y: 0, w: 12000, h: 9000 })
    expect(view.zoom).toBeLessThan(MIN_ZOOM)
    expect(view.right).toBeLessThanOrEqual(W)
    expect(view.bottom).toBeLessThanOrEqual(H)
  })

  it('never enlarges a small board past normal size, and centers it', () => {
    const view = shows({ x: 10, y: 10, w: 200, h: 100 })
    expect(view.zoom).toBe(1)
    expect((view.left + view.right) / 2).toBeCloseTo(84 + (W - 124) / 2)
  })

  it('stays clear of the bottom toolbar on phones', () => {
    const view = shows({ x: 0, y: 0, w: 2000, h: 2000 }, 375, 812)
    expect(view.left).toBeGreaterThanOrEqual(16)
    expect(view.right).toBeLessThanOrEqual(375 - 16 + 0.01)
    expect(view.bottom).toBeLessThanOrEqual(812 - 130 + 0.01)
  })
})
