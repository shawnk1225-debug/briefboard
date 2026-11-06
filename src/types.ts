export type CardType = 'note' | 'image' | 'link' | 'todo' | 'board' | 'column' | 'arrow' | 'table' | 'doc' | 'file' | 'sketch'

export interface SketchStroke {
  color: string
  width: number
  // Flattened x, y pairs in the sketch's 400 x 300 drawing space.
  points: number[]
}

export interface TodoItem {
  id: string
  text: string
  done: boolean
}

export interface ArrowEnd {
  cardId?: string
  x?: number
  y?: number
}

export interface LinkEmbed {
  provider: 'youtube' | 'vimeo' | 'tiktok'
  id: string
}

// One shape for every card type; each type only uses its own fields.
export interface CardContent {
  // note
  doc?: RichDoc
  color?: string
  // image
  ref?: string
  aspect?: number
  caption?: string
  // link
  url?: string
  title?: string
  description?: string
  thumbnail?: string
  embed?: LinkEmbed
  // todo (also uses title) and column (also uses title, color)
  items?: TodoItem[]
  // board
  boardId?: string
  // arrow
  from?: ArrowEnd
  to?: ArrowEnd
  label?: string
  // table (also uses title); the first row is the header
  rows?: string[][]
  // file (also uses ref); doc uses title and doc
  name?: string
  size?: number
  mime?: string
  // sketch
  strokes?: SketchStroke[]
}

// A TipTap/ProseMirror JSON document.
export interface RichDoc {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string; attrs?: Record<string, unknown> }[]
  content?: RichDoc[]
}

// Cards are auto-height: only width is stored, height follows the content.
export interface Card {
  id: string
  boardId: string
  type: CardType
  x: number
  y: number
  w: number
  z: number
  columnId: string | null
  columnOrder: number
  content: CardContent
  searchText: string
}

export type BoardStatus = 'draft' | 'in_production' | 'live' | 'done'
export type BoardFormat = 'video' | 'static'

export interface Board {
  id: string
  parentBoardId: string | null
  title: string
  isTemplate: boolean
  deletedAt: string | null
  updatedAt: string
  folderId: string | null
  status: BoardStatus | null
  format: BoardFormat | null
}

// Two levels: a product folder (no parent) and its batch folders.
export interface Folder {
  id: string
  parentId: string | null
  name: string
  // The secret link's token while sharing is on; empty when it's off.
  shareToken?: string | null
}

export interface SharedBatch {
  name: string
  boards: Board[]
}

export interface SharedBoard {
  board: Board
  cards: Card[]
  comments: Comment[]
}

export type CardOp =
  | { kind: 'insert'; card: Card }
  | { kind: 'update'; id: string; fields: Partial<Card> }
  | { kind: 'delete'; id: string }

export type RemoteEvent =
  | { table: 'card'; kind: 'upsert'; card: Card; client: string | null }
  | { table: 'card'; kind: 'delete'; id: string }
  | { table: 'board'; kind: 'upsert'; board: Board; client: string | null }
  | { table: 'board'; kind: 'delete'; id: string }
  | { table: 'comment'; kind: 'upsert'; comment: Comment }
  | { table: 'comment'; kind: 'delete'; id: string }
  | { table: 'folder'; kind: 'upsert'; folder: Folder }
  | { table: 'folder'; kind: 'delete'; id: string }

export interface Comment {
  id: string
  boardId: string
  // Empty for a comment on the board as a whole.
  cardId: string | null
  authorEmail: string
  // The name typed by someone commenting through a secret link.
  authorName: string | null
  body: string
  resolved: boolean
  // Team only: never sent to anyone viewing through a secret link.
  internal: boolean
  createdAt: string
}

export interface SearchHit {
  card: Card
  boardTitle: string
}

export interface Member {
  email: string
  role: 'owner' | 'member'
}
