import type { Board, Card, CardOp, Comment, Folder, RemoteEvent, SearchHit, SharedBatch, SharedBoard, TutorialState } from '../types'
import { LocalBackend } from './localBackend'
import { SupabaseBackend, supabaseConfigured } from './supabaseBackend'

export interface Backend {
  readonly mode: 'local' | 'supabase'
  listBoards(): Promise<Board[]>
  insertBoard(board: Board): Promise<void>
  updateBoard(id: string, fields: Partial<Board>): Promise<void>
  updateBoards(ids: string[], fields: Partial<Board>): Promise<void>
  listFolders(): Promise<Folder[]>
  insertFolder(folder: Folder): Promise<void>
  updateFolder(id: string, fields: Partial<Folder>): Promise<void>
  deleteFolder(id: string): Promise<void>
  listPins(): Promise<string[]>
  pinBoard(boardId: string): Promise<void>
  unpinBoard(boardId: string): Promise<void>
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
  addComment(comment: Pick<Comment, 'id' | 'boardId' | 'cardId' | 'body' | 'internal'>): Promise<Comment>
  // Secret links. Setting a token makes image and file requests use that link's access.
  setShareToken(token: string | null): void
  getSharedBatch(token: string): Promise<SharedBatch | null>
  getSharedBoard(token: string, boardId: string): Promise<SharedBoard | null>
  addSharedComment(token: string, boardId: string, cardId: string | null, name: string, body: string): Promise<Comment>
  setCommentResolved(id: string, resolved: boolean): Promise<void>
  deleteComment(id: string): Promise<void>
  currentUser(): Promise<string>
  // Whether this person has been offered the tutorial, remembered per login.
  loadTutorialState(): Promise<TutorialState>
  saveTutorialState(state: TutorialState): Promise<void>
}

export const backend: Backend = supabaseConfigured ? new SupabaseBackend() : new LocalBackend()
