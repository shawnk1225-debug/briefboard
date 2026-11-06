import { create } from 'zustand'
import { backend } from '../data/backend'
import { supabaseConfigured } from '../data/supabaseBackend'
import type { HomeView } from '../lib/boardsView'
import { BUILTIN_TEMPLATES, buildTemplateCards } from '../lib/templates'
import { useHomePrefs } from '../pages/homePrefs'
import { enterPracticeBoard, exitPracticeBoard, useStore } from '../store/store'
import type { TutorialState } from '../types'
import { buildSteps } from './steps'

export const STEPS = buildSteps(supabaseConfigured)

interface TutorialStore {
  // Empty until known, so nobody sees a pop-up while their answer is still loading.
  status: TutorialState | null
  active: boolean
  step: number
}

export const useTutorial = create<TutorialStore>(() => ({ status: null, active: false, step: 0 }))

const set = useTutorial.setState

let viewBefore: HomeView | null = null

function remember(status: TutorialState) {
  set({ status })
  backend.saveTutorialState(status).catch((err) => console.error('Could not save tutorial choice', err))
}

export async function loadTutorialStatus() {
  try {
    set({ status: await backend.loadTutorialState() })
  } catch (err) {
    // Without an answer, staying quiet beats asking someone who already said no.
    console.error('Could not load tutorial choice', err)
    set({ status: 'done' })
  }
}

export const declineTutorial = () => remember('bubble')
export const dismissTutorialHint = () => remember('done')

function syncStage(step: number) {
  const stage = STEPS[step].stage
  const inPractice = useStore.getState().practice
  if (stage === 'practice' && !inPractice) {
    const boardId = `practice-${crypto.randomUUID()}`
    const video = BUILTIN_TEMPLATES.find((t) => t.format === 'video')!
    enterPracticeBoard(boardId, buildTemplateCards(video, boardId))
  } else if (stage === 'home' && inPractice) {
    exitPracticeBoard()
  }
}

export function startTutorial() {
  remember('done')
  const prefs = useHomePrefs.getState()
  viewBefore = prefs.view
  useHomePrefs.setState({ view: { kind: 'all' }, shareFolderId: null })
  syncStage(0)
  set({ active: true, step: 0 })
}

export function goToStep(step: number) {
  const next = Math.max(0, Math.min(STEPS.length - 1, step))
  // Finishes any note being typed, so its formatting bar doesn't linger into the next step.
  useStore.setState({ editingId: null })
  syncStage(next)
  set({ step: next })
}

export function exitTutorial() {
  if (useStore.getState().practice) exitPracticeBoard()
  if (viewBefore) useHomePrefs.setState({ view: viewBefore })
  viewBefore = null
  set({ active: false, step: 0 })
}
