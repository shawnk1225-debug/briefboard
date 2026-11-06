import { create } from 'zustand'
import { backend } from '../data/backend'
import { CLIENT_ID } from '../data/clientId'
import { SyncQueue, type SyncStatus } from '../data/syncQueue'
import { cardSearchText } from '../lib/doc'
import type { Board, Card, CardContent, CardType, Comment, Folder, RemoteEvent, SharedBoard } from '../types'

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface DropTarget {
  columnId: string
  index: number
}

export interface Change {
  id: string
  before: Card | null
  after: Card | null
}

export type Edit =
  | { t: 'insert'; card: Card }
  | { t: 'patch'; id: string; fields: Partial<Card> }
  | { t: 'remove'; id: string }

interface State {
  boards: Record<string, Board>
  boardId: string | null
  boardLoading: boolean
  cards: Record<string, Card>
  selected: Record<string, true>
  editingId: string | null
  tool: 'select' | 'arrow'
  viewport: Viewport
  // Cards lifted out of a column while being dragged render on the canvas.
  detached: Record<string, true>
  dragIds: Record<string, true>
  dropTarget: DropTarget | null
  syncStatus: SyncStatus
  past: Change[][]
  future: Change[][]
  comments: Record<string, Comment>
  commentCardId: string | null
  folders: Record<string, Folder>
  pins: Record<string, true>
  commentsOpen: boolean
  // Viewing through a secret link: nothing on the canvas can change.
  readOnly: boolean
  shareToken: string | null
  // In the tutorial: edits work on screen, but nothing is ever saved or sent anywhere.
  practice: boolean
}

export const useStore = create<State>(() => ({
  boards: {},
  boardId: null,
  boardLoading: false,
  cards: {},
  selected: {},
  editingId: null,
  tool: 'select',
  viewport: { x: 0, y: 0, zoom: 1 },
  detached: {},
  dragIds: {},
  dropTarget: null,
  syncStatus: 'saved',
  past: [],
  future: [],
  comments: {},
  commentCardId: null,
  folders: {},
  pins: {},
  commentsOpen: false,
  readOnly: false,
  shareToken: null,
  practice: false,
}))

const get = useStore.getState
const set = useStore.setState

export const queue = new SyncQueue(
  (ops) => backend.applyOps(ops),
  (syncStatus) => set({ syncStatus }),
)

const HISTORY_LIMIT = 100
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)

export function diffFields(from: Card, to: Card): Partial<Card> {
  const diff: Record<string, unknown> = {}
  for (const key of Object.keys(to) as (keyof Card)[]) {
    if (!same(from[key], to[key])) diff[key] = to[key]
  }
  return diff as Partial<Card>
}

function pushHistory(changes: Change[]) {
  if (!changes.length) return
  set((s) => ({ past: [...s.past.slice(-(HISTORY_LIMIT - 1)), changes], future: [] }))
}

// Single path for every card change: updates the screen, queues the save, records undo.
export function applyEdits(edits: Edit[], { history = true, sync: wantSync = true }: { history?: boolean; sync?: boolean } = {}) {
  const s = get()
  if (s.readOnly) return
  const sync = wantSync && !s.practice
  const cards = { ...s.cards }
  const selected = { ...s.selected }
  const changes: Change[] = []

  for (const edit of edits) {
    if (edit.t === 'insert') {
      const card = { ...edit.card, searchText: cardSearchText(edit.card.content) }
      changes.push({ id: card.id, before: cards[card.id] ?? null, after: card })
      cards[card.id] = card
      if (sync) {
        queue.enqueue({ kind: 'insert', card })
        if (card.type === 'board' && card.content.boardId) restoreBoardIfTrashed(card.content.boardId)
      }
    } else if (edit.t === 'patch') {
      const current = cards[edit.id]
      if (!current) continue
      const fields = edit.fields.content
        ? { ...edit.fields, searchText: cardSearchText(edit.fields.content) }
        : edit.fields
      const next = { ...current, ...fields }
      changes.push({ id: edit.id, before: current, after: next })
      cards[edit.id] = next
      if (sync) queue.enqueue({ kind: 'update', id: edit.id, fields })
    } else {
      const current = cards[edit.id]
      if (!current) continue
      changes.push({ id: edit.id, before: current, after: null })
      delete cards[edit.id]
      delete selected[edit.id]
      if (sync) {
        queue.enqueue({ kind: 'delete', id: edit.id })
        if (current.type === 'board' && current.content.boardId) trashBoard(current.content.boardId)
      }
    }
  }

  set({
    cards,
    selected,
    editingId: s.editingId && cards[s.editingId] ? s.editingId : null,
    commentCardId: s.commentCardId && cards[s.commentCardId] ? s.commentCardId : null,
  })
  if (history) pushHistory(changes)
}

// Closes out a live interaction (drag, resize, typing) as one undo step.
export function commitInteraction(before: Card[], { sync: wantSync = true }: { sync?: boolean } = {}) {
  const { cards, readOnly, practice } = get()
  if (readOnly) return
  const sync = wantSync && !practice
  const changes: Change[] = []
  for (const old of before) {
    const current = cards[old.id]
    if (!current) continue
    const fields = diffFields(old, current)
    if (!Object.keys(fields).length) continue
    changes.push({ id: old.id, before: old, after: current })
    if (sync) queue.enqueue({ kind: 'update', id: old.id, fields })
  }
  pushHistory(changes)
}

function reverseEdits(changes: Change[], direction: 'undo' | 'redo'): Edit[] {
  const ordered = direction === 'undo' ? [...changes].reverse() : changes
  return ordered.map(({ id, before, after }) => {
    const from = direction === 'undo' ? after : before
    const to = direction === 'undo' ? before : after
    if (!to) return { t: 'remove', id }
    if (!from) return { t: 'insert', card: to }
    // Only the fields this step changed, so a teammate's other edits survive.
    return { t: 'patch', id, fields: diffFields(from, to) }
  })
}

export function undo() {
  const { past, future } = get()
  const changes = past[past.length - 1]
  if (!changes) return
  applyEdits(reverseEdits(changes, 'undo'), { history: false })
  set({ past: past.slice(0, -1), future: [...future, changes] })
}

export function redo() {
  const { past, future } = get()
  const changes = future[future.length - 1]
  if (!changes) return
  applyEdits(reverseEdits(changes, 'redo'), { history: false })
  set({ past: [...past, changes], future: future.slice(0, -1) })
}

export function nextZ(): number {
  let max = 0
  for (const card of Object.values(get().cards)) if (card.z > max) max = card.z
  return max + 1
}

const DEFAULT_WIDTH: Record<CardType, number> = {
  table: 460,
  doc: 240,
  file: 280,
  sketch: 400,
  note: 260,
  image: 320,
  link: 300,
  todo: 260,
  board: 170,
  column: 300,
  arrow: 0,
}

export function makeCard(type: CardType, x: number, y: number, content: CardContent, width?: number): Card {
  return {
    id: crypto.randomUUID(),
    boardId: get().boardId!,
    type,
    x,
    y,
    w: width ?? DEFAULT_WIDTH[type],
    z: nextZ(),
    columnId: null,
    columnOrder: 0,
    content,
    searchText: '',
  }
}

export function addCard(type: CardType, x: number, y: number, content: CardContent = {}, width?: number): Card {
  const card = makeCard(type, x, y, content, width)
  applyEdits([{ t: 'insert', card }])
  set({ selected: { [card.id]: true }, tool: 'select' })
  return card
}

export function patchContent(id: string, content: Partial<CardContent>, options?: { history?: boolean }) {
  const card = get().cards[id]
  if (card) applyEdits([{ t: 'patch', id, fields: { content: { ...card.content, ...content } } }], options)
}

export function columnChildren(columnId: string): Card[] {
  return Object.values(get().cards)
    .filter((c) => c.columnId === columnId)
    .sort((a, b) => a.columnOrder - b.columnOrder)
}

// Removes cards along with what depends on them: column contents and attached arrows.
export function removeCards(ids: string[]) {
  const { cards } = get()
  const doomed = new Set(ids)
  for (const id of ids) {
    if (cards[id]?.type === 'column') columnChildren(id).forEach((child) => doomed.add(child.id))
  }
  for (const card of Object.values(cards)) {
    const { from, to } = card.content
    if (card.type === 'arrow' && ((from?.cardId && doomed.has(from.cardId)) || (to?.cardId && doomed.has(to.cardId)))) {
      doomed.add(card.id)
    }
  }
  applyEdits([...doomed].map((id) => ({ t: 'remove', id })))
}

export const selectOnly = (ids: string[]) =>
  set({ selected: Object.fromEntries(ids.map((id) => [id, true as const])) })

export const setEditing = (editingId: string | null) => set({ editingId })
export const setTool = (tool: State['tool']) => set({ tool })
export const setViewport = (viewport: Viewport) => set({ viewport })

// ---- Boards ----

export async function loadBoards() {
  const [boards, folders, pins] = await Promise.all([backend.listBoards(), backend.listFolders(), backend.listPins()])
  set({
    boards: Object.fromEntries(boards.map((b) => [b.id, b])),
    folders: Object.fromEntries(folders.map((f) => [f.id, f])),
    pins: Object.fromEntries(pins.map((id) => [id, true as const])),
  })
}

// Changes many boards at once, on screen first. If the save fails, the screen goes back
// to what is really stored and the error is passed on so the page can say so.
export async function updateBoards(ids: string[], fields: Partial<Board>) {
  set((s) => {
    const boards = { ...s.boards }
    for (const id of ids) if (boards[id]) boards[id] = { ...boards[id], ...fields }
    return { boards }
  })
  try {
    await backend.updateBoards(ids, fields)
  } catch (err) {
    await loadBoards().catch(console.error)
    throw err
  }
}

export async function setPinned(boardId: string, pinned: boolean) {
  const apply = (on: boolean) =>
    set((s) => {
      const pins = { ...s.pins }
      if (on) pins[boardId] = true
      else delete pins[boardId]
      return { pins }
    })
  apply(pinned)
  try {
    await (pinned ? backend.pinBoard(boardId) : backend.unpinBoard(boardId))
  } catch (err) {
    apply(!pinned)
    throw err
  }
}

export async function createFolder(name: string, parentId: string | null): Promise<Folder> {
  const folder: Folder = { id: crypto.randomUUID(), parentId, name }
  await backend.insertFolder(folder)
  set((s) => ({ folders: { ...s.folders, [folder.id]: folder } }))
  return folder
}

export async function updateFolder(id: string, fields: Partial<Folder>) {
  await backend.updateFolder(id, fields)
  set((s) => (s.folders[id] ? { folders: { ...s.folders, [id]: { ...s.folders[id], ...fields } } } : s))
}

export async function deleteFolder(id: string) {
  await backend.deleteFolder(id)
  await loadBoards()
}

export async function createBoard(fields: Partial<Board> = {}): Promise<Board> {
  const board: Board = {
    id: crypto.randomUUID(),
    parentBoardId: null,
    title: 'Untitled board',
    isTemplate: false,
    deletedAt: null,
    updatedAt: new Date().toISOString(),
    folderId: null,
    status: null,
    format: null,
    ...fields,
  }
  set((s) => ({ boards: { ...s.boards, [board.id]: board } }))
  if (!get().practice) await backend.insertBoard(board)
  return board
}

// The tutorial's board: real cards on screen, with no board behind them in storage.
export function enterPracticeBoard(boardId: string, cards: Card[]) {
  set({
    practice: true,
    boardId,
    boardLoading: false,
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    comments: {},
    selected: {},
    editingId: null,
    tool: 'select',
    past: [],
    future: [],
    commentsOpen: false,
    commentCardId: null,
    detached: {},
    dragIds: {},
    dropTarget: null,
    viewport: { x: 120, y: 90, zoom: 1 },
  })
}

export function exitPracticeBoard() {
  set({
    practice: false,
    boardId: null,
    cards: {},
    comments: {},
    selected: {},
    editingId: null,
    tool: 'select',
    past: [],
    future: [],
    commentsOpen: false,
    commentCardId: null,
    detached: {},
    dragIds: {},
    dropTarget: null,
  })
}

// Where opening a nested board goes, which differs when viewing through a link.
export function boardPath(id: string): string {
  const { shareToken } = get()
  return shareToken ? `/s/${shareToken}/b/${id}` : `/b/${id}`
}

// Enters read-only link mode for one board. Comments are kept current by polling,
// because link visitors have no login for live updates.
export function loadSharedBoard(data: SharedBoard) {
  const s = get()
  const sameBoard = s.boardId === data.board.id
  set({
    boardId: data.board.id,
    boardLoading: false,
    cards: Object.fromEntries(data.cards.map((c) => [c.id, c])),
    comments: Object.fromEntries(data.comments.map((c) => [c.id, c])),
    ...(sameBoard ? {} : { selected: {}, editingId: null, commentCardId: null, viewport: { x: 120, y: 90, zoom: 1 } }),
  })
}

export function openCardComments(cardId: string | null) {
  set({ commentsOpen: true, commentCardId: cardId })
}

export async function addSharedComment(cardId: string | null, name: string, body: string) {
  const { shareToken, boardId } = get()
  const comment = await backend.addSharedComment(shareToken!, boardId!, cardId, name, body)
  set((s) => ({ comments: { ...s.comments, [comment.id]: comment } }))
}

export function updateBoard(id: string, fields: Partial<Board>) {
  if (get().readOnly) return
  set((s) => (s.boards[id] ? { boards: { ...s.boards, [id]: { ...s.boards[id], ...fields } } } : s))
  if (get().practice) return
  void backend.updateBoard(id, fields).catch((err) => console.error('Board save failed', err))
}

export const trashBoard = (id: string) => updateBoard(id, { deletedAt: new Date().toISOString() })

function restoreBoardIfTrashed(id: string) {
  if (get().boards[id]?.deletedAt) updateBoard(id, { deletedAt: null })
}

export async function deleteBoardForever(id: string) {
  await backend.deleteBoardForever(id)
  await loadBoards()
}

const viewportKey = (boardId: string) => `briefboard:viewport:${boardId}`

export function saveViewport() {
  const { boardId, viewport, practice } = get()
  if (!boardId || practice) return
  try {
    localStorage.setItem(viewportKey(boardId), JSON.stringify(viewport))
  } catch {
    // Remembering the scroll position is only a convenience.
  }
}

function savedViewport(boardId: string): Viewport | null {
  try {
    const raw = localStorage.getItem(viewportKey(boardId))
    return raw ? (JSON.parse(raw) as Viewport) : null
  } catch {
    return null
  }
}

export async function openBoard(boardId: string) {
  saveViewport()
  set({
    boardId,
    boardLoading: true,
    cards: {},
    selected: {},
    editingId: null,
    tool: 'select',
    past: [],
    future: [],
    comments: {},
    commentCardId: null,
    viewport: savedViewport(boardId) ?? { x: 120, y: 90, zoom: 1 },
  })
  await queue.drain()
  const [cards, comments] = await Promise.all([backend.listCards(boardId), backend.listComments(boardId)])
  if (get().boardId !== boardId) return // user already moved on
  set({
    cards: Object.fromEntries(cards.map((c) => [c.id, c])),
    comments: Object.fromEntries(comments.map((c) => [c.id, c])),
    boardLoading: false,
  })
}

export async function addComment(cardId: string | null, body: string, internal = false) {
  const fields = { id: crypto.randomUUID(), boardId: get().boardId!, cardId, body, internal }
  const comment: Comment = get().practice
    ? { ...fields, authorEmail: 'You', authorName: null, resolved: false, createdAt: new Date().toISOString() }
    : await backend.addComment(fields)
  set((s) => ({ comments: { ...s.comments, [comment.id]: comment } }))
}

export async function setCommentResolved(id: string, resolved: boolean) {
  if (!get().practice) await backend.setCommentResolved(id, resolved)
  set((s) => (s.comments[id] ? { comments: { ...s.comments, [id]: { ...s.comments[id], resolved } } } : s))
}

export async function deleteComment(id: string) {
  if (!get().practice) await backend.deleteComment(id)
  set((s) => {
    const comments = { ...s.comments }
    delete comments[id]
    return { comments }
  })
}

export function closeBoard() {
  saveViewport()
  set({ boardId: null, cards: {}, selected: {}, editingId: null, past: [], future: [], comments: {}, commentCardId: null })
  // A link visitor has no access to the team's board list.
  if (get().readOnly) return
  // The home page sorts by last edit, so it needs dates that include this visit.
  void queue
    .drain()
    .then(loadBoards)
    .catch((err) => console.error('Could not refresh boards', err))
}

// Picks up anything missed while the tab was asleep or offline.
export async function refreshOpenBoard() {
  const { boardId, practice } = get()
  // A practice board has nothing stored, so a refresh would wipe it.
  if (practice || !boardId || !queue.idle || Object.keys(get().dragIds).length) return
  const fresh = await backend.listCards(boardId)
  const s = get()
  if (s.boardId !== boardId || !queue.idle || Object.keys(s.dragIds).length) return
  const cards = Object.fromEntries(fresh.map((c) => [c.id, c]))
  if (s.editingId && s.cards[s.editingId]) cards[s.editingId] = s.cards[s.editingId]
  set({ cards })
  await loadBoards()
}

export function handleRemote(event: RemoteEvent) {
  const s = get()
  if (event.table === 'comment') {
    if (event.kind === 'upsert') {
      if (event.comment.boardId === s.boardId) set({ comments: { ...s.comments, [event.comment.id]: event.comment } })
    } else if (s.comments[event.id]) {
      const comments = { ...s.comments }
      delete comments[event.id]
      set({ comments })
    }
    return
  }
  if (event.table === 'folder') {
    const folders = { ...s.folders }
    if (event.kind === 'upsert') folders[event.folder.id] = event.folder
    else delete folders[event.id]
    set({ folders })
    return
  }
  if (event.table === 'board') {
    if (event.kind === 'delete') {
      const boards = { ...s.boards }
      delete boards[event.id]
      set({ boards })
    } else if (event.client !== CLIENT_ID) {
      set({ boards: { ...s.boards, [event.board.id]: event.board } })
    }
    return
  }
  if (event.kind === 'delete') {
    if (!s.cards[event.id] || queue.hasPending(event.id)) return
    applyEdits([{ t: 'remove', id: event.id }], { history: false, sync: false })
    return
  }
  const { card, client } = event
  if (client === CLIENT_ID || card.boardId !== s.boardId) return
  if (queue.hasPending(card.id) || s.dragIds[card.id]) return
  const incoming =
    s.editingId === card.id && s.cards[card.id]
      ? { ...card, content: s.cards[card.id].content, searchText: s.cards[card.id].searchText }
      : card
  set({ cards: { ...get().cards, [card.id]: incoming } })
}

let unsubscribe: (() => void) | null = null

export function startSync() {
  unsubscribe ??= backend.subscribe(handleRemote)
}

export function stopSync() {
  unsubscribe?.()
  unsubscribe = null
}
