import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Board, Card, CardOp, Comment, Folder, Member, RemoteEvent, SearchHit, SharedBatch, SharedBoard } from '../types'
import type { Backend } from './backend'
import { CLIENT_ID } from './clientId'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)
export const supabase: SupabaseClient | null = supabaseConfigured ? createClient(url!, anonKey!) : null

const IMAGE_BUCKET = 'board-images'
const FILE_BUCKET = 'board-files'
const SIGNED_URL_SECONDS = 60 * 60 * 24

/* eslint-disable @typescript-eslint/no-explicit-any */
const rowToCard = (r: any): Card => ({
  id: r.id,
  boardId: r.board_id,
  type: r.type,
  x: r.x,
  y: r.y,
  w: r.w,
  z: r.z,
  columnId: r.column_id,
  columnOrder: r.column_order,
  content: r.content ?? {},
  searchText: r.search_text ?? '',
})

const rowToBoard = (r: any): Board => ({
  id: r.id,
  parentBoardId: r.parent_board_id,
  title: r.title,
  isTemplate: r.is_template,
  deletedAt: r.deleted_at,
  updatedAt: r.updated_at,
  folderId: r.folder_id ?? null,
  status: r.status ?? null,
  format: r.format ?? null,
})

const rowToFolder = (r: any): Folder => ({ id: r.id, parentId: r.parent_id, name: r.name, shareToken: r.share_token ?? null })

// Link data arrives without the team-only fields, so fill them in.
const sharedBoard = (r: any): Board => ({
  id: r.id,
  parentBoardId: r.parent_board_id,
  title: r.title,
  isTemplate: false,
  deletedAt: null,
  updatedAt: r.updated_at,
  folderId: null,
  status: null,
  format: r.format ?? null,
})

const rowToComment = (r: any): Comment => ({
  id: r.id,
  boardId: r.board_id,
  cardId: r.card_id ?? null,
  authorEmail: r.author_email ?? '',
  authorName: r.author_name ?? null,
  body: r.body,
  resolved: r.resolved,
  internal: r.internal ?? false,
  createdAt: r.created_at,
})

const CARD_COLUMNS: Record<string, string> = {
  id: 'id',
  boardId: 'board_id',
  type: 'type',
  x: 'x',
  y: 'y',
  w: 'w',
  z: 'z',
  columnId: 'column_id',
  columnOrder: 'column_order',
  content: 'content',
  searchText: 'search_text',
}

const BOARD_COLUMNS: Record<string, string> = {
  id: 'id',
  parentBoardId: 'parent_board_id',
  title: 'title',
  isTemplate: 'is_template',
  deletedAt: 'deleted_at',
  folderId: 'folder_id',
  status: 'status',
  format: 'format',
}

const FOLDER_COLUMNS: Record<string, string> = { id: 'id', parentId: 'parent_id', name: 'name', shareToken: 'share_token' }

// One request updates at most this many boards, to keep the request URL a safe length.
const UPDATE_CHUNK = 100

function toRow(fields: Record<string, unknown>, columns: Record<string, string>) {
  const row: Record<string, unknown> = { updated_client: CLIENT_ID }
  for (const [key, value] of Object.entries(fields)) {
    if (columns[key]) row[columns[key]] = value
  }
  return row
}

// Supabase caps how many rows one request returns (1,000 by default) without any error,
// so this keeps asking until a page comes back empty. It doesn't assume the page size.
export async function fetchAllPages<T>(fetchPage: (from: number, to: number) => Promise<T[]>, pageSize = 1000): Promise<T[]> {
  const rows: T[] = []
  for (;;) {
    const page = await fetchPage(rows.length, rows.length + pageSize - 1)
    if (!page.length) return rows
    rows.push(...page)
  }
}

// Escapes the wildcards ilike would otherwise interpret in a search term.
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`)

export class SupabaseBackend implements Backend {
  readonly mode = 'supabase' as const
  private db = supabase!
  private signedUrls = new Map<string, { url: string; expires: number }>()
  private shareClient: SupabaseClient | null = null

  async listBoards() {
    const rows = await fetchAllPages(async (from, to) => {
      // Sorted, so rows can't shift between pages and be skipped.
      const { data, error } = await this.db.from('boards').select('*').order('id').range(from, to)
      if (error) throw error
      return data
    })
    return rows.map(rowToBoard)
  }

  async listFolders() {
    const rows = await fetchAllPages(async (from, to) => {
      const { data, error } = await this.db.from('folders').select('*').order('id').range(from, to)
      if (error) throw error
      return data
    })
    return rows.map(rowToFolder)
  }

  async insertFolder(folder: Folder) {
    const { error } = await this.db.from('folders').insert(toRow({ ...folder }, FOLDER_COLUMNS))
    if (error) throw error
  }

  async updateFolder(id: string, fields: Partial<Folder>) {
    const { error } = await this.db.from('folders').update(toRow(fields, FOLDER_COLUMNS)).eq('id', id)
    if (error) throw error
  }

  async deleteFolder(id: string) {
    const { error } = await this.db.from('folders').delete().eq('id', id)
    if (error) throw error
  }

  async updateBoards(ids: string[], fields: Partial<Board>) {
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK) {
      const { error } = await this.db
        .from('boards')
        .update(toRow(fields, BOARD_COLUMNS))
        .in('id', ids.slice(i, i + UPDATE_CHUNK))
      if (error) throw error
    }
  }

  async listPins() {
    const rows = await fetchAllPages(async (from, to) => {
      const { data, error } = await this.db.from('pins').select('board_id').order('board_id').range(from, to)
      if (error) throw error
      return data
    })
    return rows.map((row: any) => row.board_id as string)
  }

  async pinBoard(boardId: string) {
    const { error } = await this.db.from('pins').upsert({ board_id: boardId }, { onConflict: 'email,board_id', ignoreDuplicates: true })
    if (error) throw error
  }

  async unpinBoard(boardId: string) {
    const { error } = await this.db.from('pins').delete().eq('board_id', boardId)
    if (error) throw error
  }

  async insertBoard(board: Board) {
    const { error } = await this.db.from('boards').insert(toRow({ ...board }, BOARD_COLUMNS))
    if (error) throw error
  }

  async updateBoard(id: string, fields: Partial<Board>) {
    const { error } = await this.db.from('boards').update(toRow(fields, BOARD_COLUMNS)).eq('id', id)
    if (error) throw error
  }

  async deleteBoardForever(id: string) {
    const { error } = await this.db.from('boards').delete().eq('id', id)
    if (error) throw error
  }

  async listCards(boardId: string) {
    const rows = await fetchAllPages(async (from, to) => {
      const { data, error } = await this.db.from('cards').select('*').eq('board_id', boardId).order('id').range(from, to)
      if (error) throw error
      return data
    })
    return rows.map(rowToCard)
  }

  async applyOps(ops: CardOp[]) {
    const inserts = ops.flatMap((op) => (op.kind === 'insert' ? [toRow({ ...op.card }, CARD_COLUMNS)] : []))
    const deletes = ops.flatMap((op) => (op.kind === 'delete' ? [op.id] : []))

    if (inserts.length) {
      const { error } = await this.db.from('cards').upsert(inserts)
      // A teammate permanently deleted the board these cards belong to:
      // there is nowhere left to save them, and retrying would block other saves.
      if (error && error.code === '23503') console.warn('Dropped cards for a deleted board', error)
      else if (error) throw error
    }
    await Promise.all(
      ops.flatMap((op) => {
        if (op.kind !== 'update') return []
        return [
          this.db
            .from('cards')
            .update(toRow(op.fields, CARD_COLUMNS))
            .eq('id', op.id)
            .then(({ error }) => {
              if (error) throw error
            }),
        ]
      }),
    )
    if (deletes.length) {
      const { error } = await this.db.from('cards').delete().in('id', deletes)
      if (error) throw error
    }
  }

  subscribe(handler: (event: RemoteEvent) => void) {
    // Unfiltered, because Postgres delete events can't be filtered by board.
    // The store ignores events for cards that aren't on the open board.
    const channel = this.db
      .channel('briefboard-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, (payload) => {
        if (payload.eventType === 'DELETE') handler({ table: 'card', kind: 'delete', id: (payload.old as any).id })
        else handler({ table: 'card', kind: 'upsert', card: rowToCard(payload.new), client: (payload.new as any).updated_client })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' }, (payload) => {
        if (payload.eventType === 'DELETE') handler({ table: 'board', kind: 'delete', id: (payload.old as any).id })
        else handler({ table: 'board', kind: 'upsert', board: rowToBoard(payload.new), client: (payload.new as any).updated_client })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'folders' }, (payload) => {
        if (payload.eventType === 'DELETE') handler({ table: 'folder', kind: 'delete', id: (payload.old as any).id })
        else handler({ table: 'folder', kind: 'upsert', folder: rowToFolder(payload.new) })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, (payload) => {
        if (payload.eventType === 'DELETE') handler({ table: 'comment', kind: 'delete', id: (payload.old as any).id })
        else handler({ table: 'comment', kind: 'upsert', comment: rowToComment(payload.new) })
      })
      .subscribe()
    return () => void this.db.removeChannel(channel)
  }

  async uploadImage(blob: Blob, extension: string) {
    const path = `${crypto.randomUUID()}.${extension}`
    const { error } = await this.db.storage.from(IMAGE_BUCKET).upload(path, blob, { contentType: blob.type })
    if (error) throw error
    return path
  }

  // Runs signed out, even for a teammate opening a link, so a link shows exactly what an
  // editor would see. The header is what lets storage's rules check the link.
  setShareToken(token: string | null) {
    this.signedUrls.clear()
    this.shareClient = token
      ? createClient(url!, anonKey!, {
          auth: { persistSession: false, autoRefreshToken: false, storageKey: 'briefboard-share' },
          global: { headers: { 'x-briefboard-share': token } },
        })
      : null
  }

  async getSharedBatch(token: string): Promise<SharedBatch | null> {
    const { data, error } = await (this.shareClient ?? this.db).rpc('share_get_batch', { p_token: token })
    if (error) throw error
    return data ? { name: data.name, boards: data.boards.map(sharedBoard) } : null
  }

  async getSharedBoard(token: string, boardId: string): Promise<SharedBoard | null> {
    const { data, error } = await (this.shareClient ?? this.db).rpc('share_get_board', { p_token: token, p_board_id: boardId })
    if (error) throw error
    if (!data) return null
    return { board: sharedBoard(data.board), cards: data.cards.map(rowToCard), comments: data.comments.map(rowToComment) }
  }

  async addSharedComment(token: string, boardId: string, cardId: string | null, name: string, body: string) {
    const { data, error } = await (this.shareClient ?? this.db).rpc('share_add_comment', {
      p_token: token,
      p_board_id: boardId,
      p_card_id: cardId,
      p_name: name,
      p_body: body,
    })
    if (error) throw error
    return rowToComment(data)
  }

  async resolveImage(ref: string) {
    const cached = this.signedUrls.get(ref)
    if (cached && cached.expires > Date.now()) return cached.url
    const { data, error } = await (this.shareClient ?? this.db).storage.from(IMAGE_BUCKET).createSignedUrl(ref, SIGNED_URL_SECONDS)
    if (error) throw error
    this.signedUrls.set(ref, { url: data.signedUrl, expires: Date.now() + (SIGNED_URL_SECONDS - 3600) * 1000 })
    return data.signedUrl
  }

  async uploadFile(blob: Blob, extension: string) {
    const path = `${crypto.randomUUID()}.${extension}`
    const { error } = await this.db.storage
      .from(FILE_BUCKET)
      .upload(path, blob, { contentType: blob.type || 'application/octet-stream' })
    if (error) throw error
    return path
  }

  async fileUrl(ref: string, downloadName?: string) {
    const { data, error } = await (this.shareClient ?? this.db).storage
      .from(FILE_BUCKET)
      .createSignedUrl(ref, 60 * 60, downloadName ? { download: downloadName } : undefined)
    if (error) throw error
    return data.signedUrl
  }

  async listComments(boardId: string) {
    const { data, error } = await this.db.from('comments').select('*').eq('board_id', boardId)
    if (error) throw error
    return data.map(rowToComment)
  }

  async addComment(fields: Pick<Comment, 'id' | 'boardId' | 'cardId' | 'body' | 'internal'>) {
    const { data, error } = await this.db
      .from('comments')
      .insert({ id: fields.id, board_id: fields.boardId, card_id: fields.cardId, body: fields.body, internal: fields.internal })
      .select()
      .single()
    if (error) throw error
    return rowToComment(data)
  }

  async setCommentResolved(id: string, resolved: boolean) {
    const { error } = await this.db.from('comments').update({ resolved }).eq('id', id)
    if (error) throw error
  }

  async deleteComment(id: string) {
    const { error } = await this.db.from('comments').delete().eq('id', id)
    if (error) throw error
  }

  async currentUser() {
    const { data } = await this.db.auth.getUser()
    return data.user?.email?.toLowerCase() ?? ''
  }

  async search(query: string): Promise<SearchHit[]> {
    const { data, error } = await this.db
      .from('cards')
      .select('*, boards!inner(title, deleted_at)')
      .ilike('search_text', `%${escapeLike(query)}%`)
      .is('boards.deleted_at', null)
      .limit(50)
    if (error) throw error
    return data.map((row: any) => ({ card: rowToCard(row), boardTitle: row.boards.title }))
  }
}

// Team management and sign-in only exist in Supabase mode.
export async function listMembers(): Promise<Member[]> {
  const { data, error } = await supabase!.from('members').select('email, role').order('created_at')
  if (error) throw error
  return data as Member[]
}

export async function addMember(email: string) {
  const { error } = await supabase!.from('members').insert({ email: email.trim().toLowerCase() })
  if (error) throw error
}

export async function removeMember(email: string) {
  const { error } = await supabase!.from('members').delete().eq('email', email)
  if (error) throw error
}
