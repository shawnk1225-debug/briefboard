import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../store/store'
import { baselineOf, stepDone, type TutorialStep } from './steps'
import { declineTutorial, dismissTutorialHint, exitTutorial, goToStep, startTutorial, STEPS, useTutorial } from './tutorialStore'

function findTarget(step: TutorialStep): HTMLElement | null {
  if (!step.target) return null
  if ('tour' in step.target) return document.querySelector<HTMLElement>(`[data-tour="${step.target.tour}"]`)
  const title = step.target.column
  const input = [...document.querySelectorAll<HTMLInputElement>('.column-title')].find((el) => el.value === title)
  return input?.closest<HTMLElement>('[data-card-id]') ?? null
}

// Follows an element around, since the canvas and panels can move at any time.
function useTargetRect(find: () => HTMLElement | null, deps: unknown[]) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  useEffect(() => {
    const update = () => {
      const next = find()?.getBoundingClientRect() ?? null
      setRect((old) => {
        if (!old || !next) return old === next ? old : next
        const same = old.left === next.left && old.top === next.top && old.width === next.width && old.height === next.height
        return same ? old : next
      })
    }
    update()
    const timer = setInterval(update, 150)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return rect
}

const BUBBLE_W = 340
const GAP = 14
const EDGE = 12

function bubbleStyle(rect: DOMRect | null, place: TutorialStep['place'], height: number): React.CSSProperties {
  const narrow = window.innerWidth < 720
  if (narrow) {
    return { top: EDGE, left: EDGE, right: EDGE }
  }
  // On the practice board it stays over the plan side, clear of the hooks and the Duplicate bar.
  if (!rect || !place) {
    return { top: 62, left: 84, width: BUBBLE_W }
  }
  const maxLeft = window.innerWidth - BUBBLE_W - EDGE
  const maxTop = Math.max(EDGE, window.innerHeight - height - EDGE)
  if (place === 'right') {
    return { width: BUBBLE_W, left: Math.min(maxLeft, rect.right + GAP), top: Math.min(maxTop, Math.max(EDGE, rect.top)) }
  }
  return { width: BUBBLE_W, left: Math.max(EDGE, Math.min(maxLeft, rect.right - BUBBLE_W)), top: Math.min(maxTop, rect.bottom + GAP) }
}

function SharePreview() {
  return (
    <div className="tour-share" aria-label="Preview of the share window">
      <div className="tour-share-link">
        <span>…/briefboard/#/s/••••••••</span>
        <em>Copy</em>
      </div>
      <p>Only a preview, so no link is created.</p>
    </div>
  )
}

function TutorialLayer() {
  const stepIndex = useTutorial((s) => s.step)
  const step = STEPS[stepIndex]
  const cards = useStore((s) => s.cards)
  const commentCount = useStore((s) => Object.keys(s.comments).length)
  const nextRef = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const isHome = step.stage === 'home'
  const last = stepIndex === STEPS.length - 1

  const rect = useTargetRect(() => findTarget(step), [stepIndex])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const baseline = useMemo(() => baselineOf(Object.values(cards), commentCount), [stepIndex])
  const done = stepDone(step.check, baseline, Object.values(cards), commentCount)

  useEffect(() => {
    findTarget(step)?.scrollIntoView({ block: 'nearest' })
    nextRef.current?.focus({ preventScroll: true })
  }, [stepIndex, step])

  // Home steps only point at things, so the real page underneath can't be clicked or tabbed to.
  useEffect(() => {
    if (!isHome) return
    const page = document.querySelector<HTMLElement>('.home')
    if (!page) return
    page.inert = true
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitTutorial()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      page.inert = false
      window.removeEventListener('keydown', onKey)
    }
  }, [isHome, stepIndex])

  // Leaving through the browser's Back button or a link ends the tutorial.
  useEffect(() => {
    window.addEventListener('hashchange', exitTutorial)
    return () => window.removeEventListener('hashchange', exitTutorial)
  }, [])

  return createPortal(
    <>
      {isHome && <div className="tour-block" />}
      {rect && (
        <div
          className={`tour-ring${isHome ? ' dim' : ''}`}
          style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      )}
      {!rect && isHome && <div className="tour-dim" />}
      <div
        ref={bubbleRef}
        className="tour-bubble"
        role="dialog"
        aria-label={step.title}
        style={bubbleStyle(rect, step.place, bubbleRef.current?.offsetHeight ?? 200)}
      >
        <div className="tour-progress">Step {stepIndex + 1} of {STEPS.length}</div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        {step.sharePreview && <SharePreview />}
        {done && <p className="tour-done" role="status">✓ Nice, you've got it.</p>}
        <div className="tour-actions">
          <button className="link-btn" onClick={exitTutorial}>Exit</button>
          <div>
            {stepIndex > 0 && <button className="btn" onClick={() => goToStep(stepIndex - 1)}>Back</button>}
            <button ref={nextRef} className="btn primary" onClick={() => (last ? exitTutorial() : goToStep(stepIndex + 1))}>
              {last ? 'Finish' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}

function TutorialPrompt() {
  const yesRef = useRef<HTMLButtonElement>(null)
  useEffect(() => yesRef.current?.focus(), [])
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && declineTutorial()}>
      <div className="dialog tour-prompt" role="dialog" aria-modal="true" aria-label="Take the tutorial?">
        <h2>Welcome to Briefboard</h2>
        <p>Want a 2-minute tour of the key things? You'll practise on a board that's never saved.</p>
        <div className="dialog-actions">
          <button className="btn" onClick={declineTutorial}>No thanks</button>
          <button ref={yesRef} className="btn primary" onClick={startTutorial}>Yes, show me</button>
        </div>
      </div>
    </div>
  )
}

function TutorialHint() {
  const rect = useTargetRect(() => document.querySelector<HTMLElement>('[data-tour="tutorial"]'), [])
  if (!rect) return null
  // On a phone the sidebar can be far down the page, so the hint sits on screen and says where to go.
  const narrow = window.innerWidth < 720
  const style: React.CSSProperties = narrow
    ? { left: EDGE, right: EDGE, bottom: EDGE, width: 'auto' }
    : { left: rect.right + GAP, top: rect.top + rect.height / 2, transform: 'translateY(-50%)' }
  return createPortal(
    <div className={`tour-hint${narrow ? ' docked' : ''}`} role="status" style={style}>
      <p>{narrow ? 'Want the tutorial later? Click Tutorial in the sidebar.' : "Want the tutorial later? It's here."}</p>
      <button className="btn" onClick={dismissTutorialHint}>Got it</button>
    </div>,
    document.body,
  )
}

// The pop-up and hint belong on the home page, so a shared link to a board isn't interrupted.
export function TutorialHomeUi() {
  const status = useTutorial((s) => s.status)
  const active = useTutorial((s) => s.active)
  if (active) return null
  if (status === 'new') return <TutorialPrompt />
  if (status === 'bubble') return <TutorialHint />
  return null
}

export function ActiveTutorial() {
  const active = useTutorial((s) => s.active)
  return active ? <TutorialLayer /> : null
}
