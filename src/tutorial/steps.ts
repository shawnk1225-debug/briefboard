import type { Card } from '../types'

// What a step checks to congratulate someone. Never required: Next always works.
export type StepCheck = 'addedNote' | 'addedHook' | 'addedComment'

export interface TutorialStep {
  // Its short name in the Getting started checklist.
  label: string
  title: string
  body: string
  stage: 'home' | 'practice'
  // The on-screen thing to point at: a data-tour name, or a column on the practice board.
  target?: { tour: string } | { column: string }
  place?: 'right' | 'below'
  check?: StepCheck
  sharePreview?: boolean
}

export const PRACTICE_NOTE = 'This practice board is never saved, so try anything.'

export function buildSteps(hasAccounts: boolean): TutorialStep[] {
  return [
    {
      label: 'Find your folders',
      title: 'Folders keep boards organized',
      body: 'Each product gets a folder, with batches inside it. Click a folder to see only its boards.',
      stage: 'home',
      target: { tour: 'folders' },
      place: 'right',
    },
    {
      label: 'Start from a template',
      title: 'Start from a template',
      body: `On the home page, pick Video or Static under Start a new board. This practice board is a Video ad brief: the plan on the left, the ad's structure on the right. ${PRACTICE_NOTE}`,
      stage: 'practice',
    },
    {
      label: 'Add a note',
      title: 'Add a note',
      body: 'Double-click an empty spot and type something. Then click away and drag your note around.',
      stage: 'practice',
      check: 'addedNote',
    },
    {
      label: 'Add a hook',
      title: 'Add another hook',
      body: 'Click the title of Hook 1, then click Duplicate in the bar at the bottom. The new hook joins the row with its arrow already connected.',
      stage: 'practice',
      target: { column: 'Hook 1' },
      check: 'addedHook',
    },
    {
      label: 'Leave a comment',
      title: 'Leave comments',
      body: 'Click Comments and post something. Select a card first to comment on it. Tick Team only to hide a comment from people with a link.',
      stage: 'practice',
      target: { tour: 'comments' },
      check: 'addedComment',
    },
    {
      label: 'Share with an editor',
      title: 'Send a batch to an editor',
      body: 'Open a folder on the home page, click Share, then Turn on link. Editors can view and comment without an account, and you can turn the link off at any time.',
      stage: 'practice',
      sharePreview: true,
    },
    {
      label: 'Finish up',
      title: "You're ready",
      body: hasAccounts
        ? 'Search finds any board or card. If someone gave you a temporary password, open Team now and change it. To see this again, click Tutorial in the sidebar.'
        : 'Search finds any board or card. To see this again, click Tutorial in the sidebar.',
      stage: 'home',
      target: { tour: 'account' },
      place: 'below',
    },
  ]
}

const countNotes = (cards: Card[]) => cards.filter((c) => c.type === 'note').length
const countHooks = (cards: Card[]) => cards.filter((c) => c.type === 'column' && /^Hook \d+$/.test(c.content.title ?? '')).length

// The counts when a step began, so a step only reacts to what was done during it.
export interface StepBaseline {
  notes: number
  hooks: number
  comments: number
}

export const baselineOf = (cards: Card[], comments: number): StepBaseline => ({
  notes: countNotes(cards),
  hooks: countHooks(cards),
  comments,
})

export function stepDone(check: StepCheck | undefined, baseline: StepBaseline, cards: Card[], comments: number): boolean {
  if (check === 'addedNote') return countNotes(cards) > baseline.notes
  if (check === 'addedHook') return countHooks(cards) > baseline.hooks
  if (check === 'addedComment') return comments > baseline.comments
  return false
}
