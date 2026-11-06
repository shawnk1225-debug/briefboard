import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Board, Card, CardOp, Comment, Member, RemoteEvent, SearchHit } from '../types'
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
})

const rowToComment = (r: any): Comment => ({
  id: r.id,
  boardId: r.board_id,
  cardId: r.card_id,
  authorEmail: r.author_email,
  body: r.body,
  resolved: r.resolved,
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
}

function toRow(fields: Record<string, unknown>, columns: Record<string, string>) {
  const row: Record<string, unknown> = { updated_client: CLIENT_ID }
  for (const [key, value] of Object.entries(fields)) {
    if (columns[key]) row[columns[key]] = value
  }
  return row
}

// Escapes the wildcards ilike would otherwise interpret in a search term.
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`)

export class SupabaseBackend implements Backend {
  readonly mode = 'supabase' as const
  private db = supabase!
  private signedUrls = new Map<string, { url: string; expires: number }>()

  async listBoards() {
    const { data, error } = await this.db.from('boards').select('*')
    if (error) throw error
    return data.map(rowToBoard)
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
    const { data, error } = await this.db.from('cards').select('*').eq('board_id', boardId)
    if (error) throw error
    return data.map(rowToCard)
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

  async resolveImage(ref: string) {
    const cached = this.signedUrls.get(ref)
    if (cached && cached.expires > Date.now()) return cached.url
    const { data, error } = await this.db.storage.from(IMAGE_BUCKET).createSignedUrl(ref, SIGNED_URL_SECONDS)
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
    const { data, error } = await this.db.storage
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

  async addComment(fields: Pick<Comment, 'id' | 'boardId' | 'cardId' | 'body'>) {
    const { data, error } = await this.db
      .from('comments')
      .insert({ id: fields.id, board_id: fields.boardId, card_id: fields.cardId, body: fields.body })
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
