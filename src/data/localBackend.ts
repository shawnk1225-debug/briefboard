import { createStore, del, get, set, update } from 'idb-keyval'
import type { Board, Card, CardOp, Comment, Folder, RemoteEvent, SearchHit, SharedBatch, SharedBoard } from '../types'
import type { Backend } from './backend'
import { CLIENT_ID } from './clientId'

const db = () => createStore('briefboard', 'data')
type Boards = Record<string, Board>
type Cards = Record<string, Card>
type Comments = Record<string, Comment>
type Folders = Record<string, Folder>

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
    // Boards saved before folders and labels existed don't have these fields.
    return Object.values(boards).map((b) => ({
      ...b,
      folderId: b.folderId ?? null,
      status: b.status ?? null,
      format: b.format ?? null,
    }))
  }

  async listFolders() {
    return Object.values((await get<Folders>('folders', this.store)) ?? {})
  }

  async insertFolder(folder: Folder) {
    await update<Folders>('folders', (all = {}) => ({ ...all, [folder.id]: folder }), this.store)
    this.emit({ table: 'folder', kind: 'upsert', folder })
  }

  async updateFolder(id: string, fields: Partial<Folder>) {
    let next: Folder | undefined
    await update<Folders>(
      'folders',
      (all = {}) => {
        if (!all[id]) return all
        next = { ...all[id], ...fields }
        return { ...all, [id]: next }
      },
      this.store,
    )
    if (next) this.emit({ table: 'folder', kind: 'upsert', folder: next })
  }

  // Matches the database: subfolders go too, and their boards become unfiled.
  async deleteFolder(id: string) {
    const removed = new Set([id])
    await update<Folders>(
      'folders',
      (all = {}) => {
        for (const folder of Object.values(all)) if (folder.parentId === id) removed.add(folder.id)
        return Object.fromEntries(Object.entries(all).filter(([key]) => !removed.has(key)))
      },
      this.store,
    )
    const affected = (await this.listBoards()).filter((b) => b.folderId && removed.has(b.folderId)).map((b) => b.id)
    if (affected.length) await this.updateBoards(affected, { folderId: null })
    for (const folderId of removed) this.emit({ table: 'folder', kind: 'delete', id: folderId })
  }

  async updateBoards(ids: string[], fields: Partial<Board>) {
    const wanted = new Set(ids)
    const changed: Board[] = []
    await update<Boards>(
      'boards',
      (all = {}) => {
        changed.length = 0
        const next = { ...all }
        for (const id of wanted) {
          if (next[id]) {
            next[id] = { ...next[id], ...fields }
            changed.push(next[id])
          }
        }
        return next
      },
      this.store,
    )
    for (const board of changed) this.emit({ table: 'board', kind: 'upsert', board, client: CLIENT_ID })
  }

  async listPins() {
    return (await get<string[]>('pins', this.store)) ?? []
  }

  async pinBoard(boardId: string) {
    await update<string[]>('pins', (all = []) => (all.includes(boardId) ? all : [...all, boardId]), this.store)
  }

  async unpinBoard(boardId: string) {
    await update<string[]>('pins', (all = []) => all.filter((id) => id !== boardId), this.store)
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
        // Matches the database: filing or labelling a board isn't editing it.
        next = { ...all[id], ...fields, ...('title' in fields ? { updatedAt: new Date().toISOString() } : {}) }
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
    return Object.values(all)
      .filter((c) => c.boardId === boardId)
      .map((c) => ({ ...c, internal: c.internal ?? false, authorName: c.authorName ?? null }))
  }

  // Secret links, matching the database's rules for browser-only mode.
  setShareToken() {}

  private async sharedBoardIds(token: string): Promise<{ folder: Folder; ids: Set<string>; boards: Board[] } | null> {
    if (token.length < 32) return null
    const folders = await this.listFolders()
    const folder = folders.find((f) => f.shareToken === token)
    if (!folder) return null
    const folderIds = new Set([folder.id, ...folders.filter((f) => f.parentId === folder.id).map((f) => f.id)])
    const all = await this.listBoards()
    const live = all.filter((b) => !b.deletedAt && !b.isTemplate)
    const ids = new Set(live.filter((b) => !b.parentBoardId && b.folderId && folderIds.has(b.folderId)).map((b) => b.id))
    for (let grew = true; grew; ) {
      grew = false
      for (const b of live) {
        if (b.parentBoardId && ids.has(b.parentBoardId) && !ids.has(b.id)) {
          ids.add(b.id)
          grew = true
        }
      }
    }
    return { folder, ids, boards: live.filter((b) => ids.has(b.id)) }
  }

  async getSharedBatch(token: string): Promise<SharedBatch | null> {
    const shared = await this.sharedBoardIds(token)
    return shared && { name: shared.folder.name, boards: shared.boards }
  }

  async getSharedBoard(token: string, boardId: string): Promise<SharedBoard | null> {
    const shared = await this.sharedBoardIds(token)
    const board = shared?.boards.find((b) => b.id === boardId)
    if (!board) return null
    const comments = (await this.listComments(boardId))
      .filter((c) => !c.internal)
      .map((c) => ({ ...c, authorName: c.authorName ?? c.authorEmail, authorEmail: '' }))
    return { board, cards: await this.listCards(boardId), comments }
  }

  async addSharedComment(token: string, boardId: string, cardId: string | null, name: string, body: string) {
    const shared = await this.sharedBoardIds(token)
    if (!shared?.ids.has(boardId)) throw new Error('This link is not active')
    const comment: Comment = {
      id: crypto.randomUUID(),
      boardId,
      cardId,
      authorEmail: '',
      authorName: name,
      body,
      resolved: false,
      internal: false,
      createdAt: new Date().toISOString(),
    }
    await update<Comments>('comments', (all = {}) => ({ ...all, [comment.id]: comment }), this.store)
    this.emit({ table: 'comment', kind: 'upsert', comment })
    return comment
  }

  async addComment(fields: Pick<Comment, 'id' | 'boardId' | 'cardId' | 'body' | 'internal'>) {
    const comment: Comment = { ...fields, authorEmail: 'You', authorName: null, resolved: false, createdAt: new Date().toISOString() }
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
