import type { Board, Card, CardOp, Comment, RemoteEvent, SearchHit } from '../types'
import { LocalBackend } from './localBackend'
import { SupabaseBackend, supabaseConfigured } from './supabaseBackend'

export interface Backend {
  readonly mode: 'local' | 'supabase'
  listBoards(): Promise<Board[]>
  insertBoard(board: Board): Promise<void>
  updateBoard(id: string, fields: Partial<Board>): Promise<void>
  deleteBoardForever(id: string): Promise<void>
  listCards(boardId: string): Promise<Card[]>
  applyOps(ops: CardOp[]): Promise<void>
  subscribe(handler: (event: RemoteEvent) => void): () => void
  uploadImage(blob: Blob, extension: string): Promise<string>
  resolveImage(ref: string): Promise<string>
  uploadFile(blob: Blob, extension: string): Promise<string>
  // With a downloadName the link saves the file; without one it plays or displays in place.
  fileUrl(ref: string, downloadName?: string): Promise<string>
  search(query: string): Promise<SearchHit[]>
  listComments(boardId: string): Promise<Comment[]>
  addComment(comment: Pick<Comment, 'id' | 'boardId' | 'cardId' | 'body'>): Promise<Comment>
  setCommentResolved(id: string, resolved: boolean): Promise<void>
  deleteComment(id: string): Promise<void>
  currentUser(): Promise<string>
}

export const backend: Backend = supabaseConfigured ? new SupabaseBackend() : new LocalBackend()
