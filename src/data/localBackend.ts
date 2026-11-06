import { createStore, del, get, set, update } from 'idb-keyval'
import type { Board, Card, CardOp, Comment, RemoteEvent, SearchHit } from '../types'
import type { Backend } from './backend'
import { CLIENT_ID } from './clientId'

const db = () => createStore('briefboard', 'data')
type Boards = Record<string, Board>
type Cards = Record<string, Card>
type Comments = Record<string, Comment>

// Browser-only storage, used until Supabase is configured. Other tabs of the
// same browser get updates over a BroadcastChannel, like teammates over Realtime.
export class LocalBackend implements Backend {
  readonly mode = 'local' as const
  private store = db()
  private channel = new BroadcastChannel('briefboard-sync')
  private imageUrls = new Map<string, string>()

  private emit(event: RemoteEvent) {
    this.channel.postMessage(event)
  }

  async listBoards() {
    const boards = (await get<Boards>('boards', this.store)) ?? {}
    return Object.values(boards)
  }

  async insertBoard(board: Board) {
    await update<Boards>('boards', (all = {}) => ({ ...all, [board.id]: board }), this.store)
    this.emit({ table: 'board', kind: 'upsert', board, client: CLIENT_ID })
  }

  async updateBoard(id: string, fields: Partial<Board>) {
    let next: Board | undefined
    await update<Boards>(
      'boards',
      (all = {}) => {
        if (!all[id]) return all
        next = { ...all[id], ...fields, updatedAt: new Date().toISOString() }
        return { ...all, [id]: next }
      },
      this.store,
    )
    if (next) this.emit({ table: 'board', kind: 'upsert', board: next, client: CLIENT_ID })
  }

  async deleteBoardForever(id: string) {
    const removed = new Set<string>([id])
    await update<Boards>(
      'boards',
      (all = {}) => {
        // Children cascade, matching the database's foreign key.
        for (let grew = true; grew; ) {
          grew = false
          for (const b of Object.values(all)) {
            if (b.parentBoardId && removed.has(b.parentBoardId) && !removed.has(b.id)) {
              removed.add(b.id)
              grew = true
            }
          }
        }
        return Object.fromEntries(Object.entries(all).filter(([key]) => !removed.has(key)))
      },
      this.store,
    )
    await update<Cards>(
      'cards',
      (all = {}) => Object.fromEntries(Object.entries(all).filter(([, c]) => !removed.has(c.boardId))),
      this.store,
    )
    for (const boardId of removed) this.emit({ table: 'board', kind: 'delete', id: boardId })
  }

  async listCards(boardId: string) {
    const cards = (await get<Cards>('cards', this.store)) ?? {}
    return Object.values(cards).filter((c) => c.boardId === boardId)
  }

  async applyOps(ops: CardOp[]) {
    const events: RemoteEvent[] = []
    await update<Cards>(
      'cards',
      (all = {}) => {
        events.length = 0
        const next = { ...all }
        for (const op of ops) {
          if (op.kind === 'insert') {
            next[op.card.id] = op.card
            events.push({ table: 'card', kind: 'upsert', card: op.card, client: CLIENT_ID })
          } else if (op.kind === 'delete') {
            delete next[op.id]
            events.push({ table: 'card', kind: 'delete', id: op.id })
          } else if (next[op.id]) {
            next[op.id] = { ...next[op.id], ...op.fields }
            events.push({ table: 'card', kind: 'upsert', card: next[op.id], client: CLIENT_ID })
          }
        }
        return next
      },
      this.store,
    )
    events.forEach((e) => this.emit(e))
    // Matches the database trigger: editing a card counts as updating its board.
    const updatedAt = new Date().toISOString()
    const edited = new Set(ops.flatMap((op) => (op.kind === 'insert' ? [op.card.boardId] : [])))
    for (const event of events) if (event.table === 'card' && event.kind === 'upsert') edited.add(event.card.boardId)
    if (edited.size) {
      await update<Boards>(
        'boards',
        (all = {}) => {
          const next = { ...all }
          for (const id of edited) if (next[id]) next[id] = { ...next[id], updatedAt }
          return next
        },
        this.store,
      )
    }
  }

  subscribe(handler: (event: RemoteEvent) => void) {
    const listener = (e: MessageEvent<RemoteEvent>) => handler(e.data)
    this.channel.addEventListener('message', listener)
    return () => this.channel.removeEventListener('message', listener)
  }

  async uploadImage(blob: Blob) {
    const ref = `local-${crypto.randomUUID()}`
    await set(`image:${ref}`, blob, this.store)
    return ref
  }

  async resolveImage(ref: string) {
    const cached = this.imageUrls.get(ref)
    if (cached) return cached
    const blob = await get<Blob>(`image:${ref}`, this.store)
    if (!blob) throw new Error(`Image not found: ${ref}`)
    const url = URL.createObjectURL(blob)
    this.imageUrls.set(ref, url)
    return url
  }

  uploadFile(blob: Blob) {
    return this.uploadImage(blob)
  }

  fileUrl(ref: string) {
    return this.resolveImage(ref)
  }

  async listComments(boardId: string) {
    const all = (await get<Comments>('comments', this.store)) ?? {}
    return Object.values(all).filter((c) => c.boardId === boardId)
  }

  async addComment(fields: Pick<Comment, 'id' | 'boardId' | 'cardId' | 'body'>) {
    const comment: Comment = { ...fields, authorEmail: 'You', resolved: false, createdAt: new Date().toISOString() }
    await update<Comments>('comments', (all = {}) => ({ ...all, [comment.id]: comment }), this.store)
    this.emit({ table: 'comment', kind: 'upsert', comment })
    return comment
  }

  async setCommentResolved(id: string, resolved: boolean) {
    let next: Comment | undefined
    await update<Comments>(
      'comments',
      (all = {}) => {
        if (!all[id]) return all
        next = { ...all[id], resolved }
        return { ...all, [id]: next }
      },
      this.store,
    )
    if (next) this.emit({ table: 'comment', kind: 'upsert', comment: next })
  }

  async deleteComment(id: string) {
    await update<Comments>('comments', (all = {}) => Object.fromEntries(Object.entries(all).filter(([key]) => key !== id)), this.store)
    this.emit({ table: 'comment', kind: 'delete', id })
  }

  async currentUser() {
    return 'You'
  }

  async search(query: string): Promise<SearchHit[]> {
    const needle = query.toLowerCase()
    const [boards, cards] = await Promise.all([this.listBoards(), get<Cards>('cards', this.store)])
    const byId = new Map(boards.map((b) => [b.id, b]))
    return Object.values(cards ?? {})
      .filter((c) => c.searchText.toLowerCase().includes(needle) && byId.get(c.boardId) && !byId.get(c.boardId)!.deletedAt)
      .slice(0, 50)
      .map((card) => ({ card, boardTitle: byId.get(card.boardId)!.title }))
  }

  // Used by tests to start from a clean slate.
  async clear() {
    await del('boards', this.store)
    await del('cards', this.store)
  }
}
