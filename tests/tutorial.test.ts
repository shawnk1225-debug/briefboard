import 'fake-indexeddb/auto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backend } from '../src/data/backend'
import { furthestTutorialState } from '../src/lib/tutorialMemory'
import { useHomePrefs } from '../src/pages/homePrefs'
import { expandForCopy, pasteCards } from '../src/store/copy'
import {
  addCard,
  addComment,
  applyEdits,
  commitInteraction,
  createBoard,
  deleteComment,
  queue,
  redo,
  refreshOpenBoard,
  removeCards,
  setCommentResolved,
  undo,
  updateBoard,
  useStore,
} from '../src/store/store'
import { baselineOf, buildSteps, stepDone } from '../src/tutorial/steps'
import {
  declineTutorial,
  dismissTutorialHint,
  exitTutorial,
  goToStep,
  loadTutorialStatus,
  startTutorial,
  STEPS,
  useTutorial,
} from '../src/tutorial/tutorialStore'
import type { Card } from '../src/types'

const memory = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
})

const state = () => useStore.getState()
const tutorial = () => useTutorial.getState()

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.tsx') ? [path] : []
  })
}

afterEach(() => {
  if (tutorial().active) exitTutorial()
  useTutorial.setState({ status: null, active: false, step: 0 })
  memory.clear()
  vi.restoreAllMocks()
})

describe('the first-time question', () => {
  it('asks a brand-new person, once, and remembers each answer', async () => {
    await loadTutorialStatus()
    expect(tutorial().status).toBe('new')

    declineTutorial()
    expect(tutorial().status).toBe('bubble')
    await loadTutorialStatus()
    expect(tutorial().status).toBe('bubble')

    dismissTutorialHint()
    await loadTutorialStatus()
    expect(tutorial().status).toBe('done')
  })

  it('counts saying yes as answered', async () => {
    startTutorial()
    exitTutorial()
    await loadTutorialStatus()
    expect(tutorial().status).toBe('done')
  })

  it('stays quiet when the answer can’t be loaded, instead of asking again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(backend, 'loadTutorialState').mockRejectedValue(new Error('offline'))
    await loadTutorialStatus()
    expect(tutorial().status).toBe('done')
  })

  it('never goes backward when two copies of the answer disagree', () => {
    expect(furthestTutorialState('new', 'bubble')).toBe('bubble')
    expect(furthestTutorialState('done', 'bubble')).toBe('done')
    expect(furthestTutorialState('bubble', 'done')).toBe('done')
    expect(furthestTutorialState('new', 'new')).toBe('new')
  })

  it('survives a failed save', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(backend, 'saveTutorialState').mockRejectedValue(new Error('offline'))
    declineTutorial()
    expect(tutorial().status).toBe('bubble')
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

describe('the tutorial steps', () => {
  it('has seven steps that fit the plan', () => {
    expect(STEPS).toHaveLength(7)
    expect(STEPS.map((s) => s.stage)).toEqual(['home', 'practice', 'practice', 'practice', 'practice', 'practice', 'home'])
  })

  it('points every step at something that exists in the app', () => {
    const source = sourceFiles('src').map((path) => readFileSync(path, 'utf8')).join('\n')
    for (const step of STEPS) {
      if (step.target && 'tour' in step.target) expect(source, step.title).toContain(`data-tour="${step.target.tour}"`)
    }
    expect(source).toContain('data-tour="tutorial"')
  })

  it('points at a column the practice template really has', () => {
    startTutorial()
    goToStep(3)
    const target = STEPS[3].target as { column: string }
    expect(Object.values(state().cards).some((c) => c.type === 'column' && c.content.title === target.column)).toBe(true)
  })

  it('only mentions passwords and Team where accounts exist', () => {
    expect(buildSteps(true).at(-1)!.body).toContain('Team')
    expect(buildSteps(false).at(-1)!.body).not.toContain('Team')
  })

  it('reacts to what happens during a step, not before it', () => {
    const note = { id: 'a', type: 'note', content: {} } as Card
    const hook = { id: 'b', type: 'column', content: { title: 'Hook 4' } } as Card
    const base = baselineOf([note], 1)
    expect(stepDone('addedNote', base, [note], 1)).toBe(false)
    expect(stepDone('addedNote', base, [note, { ...note, id: 'c' }], 1)).toBe(true)
    expect(stepDone('addedHook', base, [note], 1)).toBe(false)
    expect(stepDone('addedHook', base, [note, hook], 1)).toBe(true)
    expect(stepDone('addedComment', base, [note], 2)).toBe(true)
    expect(stepDone(undefined, base, [note, hook], 9)).toBe(false)
  })
})

describe('moving through the tutorial', () => {
  it('moves between the home page and the practice board', () => {
    startTutorial()
    expect(tutorial().active).toBe(true)
    expect(state().practice).toBe(false)
    goToStep(1)
    expect(state().practice).toBe(true)
    goToStep(0)
    expect(state().practice).toBe(false)
    goToStep(6)
    expect(state().practice).toBe(false)
  })

  it('keeps work across steps on the practice board, and stays in range', () => {
    startTutorial()
    goToStep(2)
    const note = addCard('note', 0, 0)
    goToStep(3)
    expect(state().cards[note.id]).toBeDefined()
    goToStep(99)
    expect(tutorial().step).toBe(6)
    goToStep(-5)
    expect(tutorial().step).toBe(0)
  })

  it('leaves nothing behind on exit, and returns to the folder they were in', () => {
    useHomePrefs.setState({ view: { kind: 'folder', id: 'abc' } })
    startTutorial()
    expect(useHomePrefs.getState().view).toEqual({ kind: 'all' })
    goToStep(2)
    addCard('note', 0, 0)
    exitTutorial()
    expect(state()).toMatchObject({ practice: false, boardId: null, cards: {}, comments: {}, past: [] })
    expect(tutorial().active).toBe(false)
    expect(useHomePrefs.getState().view).toEqual({ kind: 'folder', id: 'abc' })
    useHomePrefs.setState({ view: { kind: 'all' } })
  })

  it('can run again from the start', () => {
    startTutorial()
    goToStep(4)
    exitTutorial()
    startTutorial()
    expect(tutorial().step).toBe(0)
    goToStep(1)
    expect(Object.values(state().cards).some((c) => c.content.title === 'Hook 4')).toBe(false)
  })
})

describe('the practice board never touches real data', () => {
  const WRITES = [
    'applyOps',
    'insertBoard',
    'updateBoard',
    'updateBoards',
    'deleteBoardForever',
    'insertFolder',
    'updateFolder',
    'deleteFolder',
    'uploadImage',
    'uploadFile',
    'addComment',
    'setCommentResolved',
    'deleteComment',
    'pinBoard',
    'unpinBoard',
  ] as const
  type Spies = Record<(typeof WRITES)[number], ReturnType<typeof vi.spyOn>>
  let spies: Spies

  beforeEach(async () => {
    await queue.drain()
    spies = Object.fromEntries(WRITES.map((name) => [name, vi.spyOn(backend, name)])) as unknown as Spies
    vi.spyOn(backend, 'saveTutorialState').mockResolvedValue()
  })

  const expectNoWrites = async () => {
    await queue.drain()
    await new Promise((resolve) => setTimeout(resolve, 450))
    await queue.drain()
    for (const name of WRITES) expect(spies[name], name).not.toHaveBeenCalled()
    expect(queue.idle).toBe(true)
  }

  it('saves nothing, whatever happens on it', async () => {
    startTutorial()
    goToStep(2)
    const note = addCard('note', 10, 10, { title: 'Try' })
    applyEdits([{ t: 'patch', id: note.id, fields: { x: 99 } }])
    commitInteraction([{ ...state().cards[note.id], x: 1 }])
    undo()
    redo()

    const hook = Object.values(state().cards).find((c) => c.content.title === 'Hook 1')!
    await pasteCards(expandForCopy([hook.id], { keepAttachedArrows: true }), 320, 0)

    await addComment(note.id, 'Practice', true)
    const [comment] = Object.values(state().comments)
    expect(comment.body).toBe('Practice')
    await setCommentResolved(comment.id, true)
    await deleteComment(comment.id)

    removeCards([note.id])
    undo()
    await expectNoWrites()
  })

  it('doesn’t create a real board when a board is added or pasted', async () => {
    startTutorial()
    goToStep(2)
    const board = await createBoard({ title: 'Practice child' })
    updateBoard(board.id, { title: 'Renamed' })
    const card = addCard('board', 0, 0, { boardId: board.id })
    await pasteCards([card], 30, 30)
    removeCards([card.id])
    await expectNoWrites()
    expect((await backend.listBoards()).some((b) => b.title === 'Practice child')).toBe(false)
  })

  it('isn’t wiped when the tab comes back into view', async () => {
    startTutorial()
    goToStep(2)
    const note = addCard('note', 0, 0)
    const listCards = vi.spyOn(backend, 'listCards')
    await refreshOpenBoard()
    expect(listCards).not.toHaveBeenCalled()
    expect(state().cards[note.id]).toBeDefined()
  })

  it('leaves real boards exactly as they were', async () => {
    vi.restoreAllMocks()
    vi.spyOn(backend, 'saveTutorialState').mockResolvedValue()
    const real = await createBoard({ title: 'Real brief' })
    const before = JSON.stringify(await backend.listBoards())
    const cardsBefore = await backend.listCards(real.id)
    startTutorial()
    goToStep(2)
    addCard('note', 0, 0)
    await addComment(null, 'Practice')
    exitTutorial()
    await queue.drain()
    expect(JSON.stringify(await backend.listBoards())).toBe(before)
    expect(await backend.listCards(real.id)).toEqual(cardsBefore)
    expect(await backend.listComments(real.id)).toEqual([])
  })

  it('goes back to saving normally after the tutorial', async () => {
    vi.restoreAllMocks()
    vi.spyOn(backend, 'saveTutorialState').mockResolvedValue()
    startTutorial()
    goToStep(2)
    addCard('note', 0, 0)
    exitTutorial()
    const real = await createBoard({ title: 'After tutorial' })
    useStore.setState({ boardId: real.id, cards: {} })
    const note = addCard('note', 0, 0)
    await queue.drain()
    expect((await backend.listCards(real.id)).map((c) => c.id)).toEqual([note.id])
    useStore.setState({ boardId: null, cards: {}, selected: {} })
  })
})
