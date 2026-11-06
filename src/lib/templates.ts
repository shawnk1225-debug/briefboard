import { backend } from '../data/backend'
import { createBoard } from '../store/store'
import type { Board, Card, CardContent, CardType, RichDoc } from '../types'
import { cardSearchText } from './doc'

const text = (value: string): RichDoc => ({ type: 'text', text: value })
const h = (level: number, value: string): RichDoc => ({ type: 'heading', attrs: { level }, content: [text(value)] })
const p = (value = ''): RichDoc => ({ type: 'paragraph', ...(value ? { content: [text(value)] } : {}) })
const doc = (...content: RichDoc[]): RichDoc => ({ type: 'doc', content })
const todo = (...items: string[]) =>
  items.map((item) => ({ id: crypto.randomUUID(), text: item, done: false }))

interface Spec {
  type: CardType
  x?: number
  y?: number
  w?: number
  content: CardContent
  children?: Spec[]
}

export interface BuiltinTemplate {
  id: string
  title: string
  description: string
  cards: Spec[]
}

// A generic starting point. To use your own brief, build it on a board and choose
// "Save as template" from that board's menu.
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'ad-brief-starter',
    title: 'Ad brief (starter)',
    description: 'Overview, audience, angle, script, references and deliverables.',
    cards: [
      {
        type: 'note',
        x: 0,
        y: 0,
        w: 620,
        content: { doc: doc(h(1, 'Ad brief: [product / concept]'), p('Owner:  ·  Due:  ·  Status:')) },
      },
      {
        type: 'column',
        x: 0,
        y: 150,
        content: { title: 'Overview' },
        children: [
          { type: 'note', content: { doc: doc(h(3, 'Objective'), p('What should this ad make someone do?')) } },
          { type: 'note', content: { doc: doc(h(3, 'Offer and landing page'), p()) } },
          { type: 'note', content: { doc: doc(h(3, 'Platform and format'), p('Placement, length, aspect ratio.')) } },
        ],
      },
      {
        type: 'column',
        x: 320,
        y: 150,
        content: { title: 'Audience and angle' },
        children: [
          { type: 'note', content: { doc: doc(h(3, 'Avatar'), p('Who is this for? What do they believe today?')) } },
          { type: 'note', content: { doc: doc(h(3, 'Angle'), p('The one idea this ad is built on.')) } },
          { type: 'note', content: { doc: doc(h(3, 'Hooks to test'), p('1.'), p('2.'), p('3.')) } },
        ],
      },
      {
        type: 'column',
        x: 640,
        y: 150,
        w: 360,
        content: { title: 'Script' },
        children: [
          { type: 'note', content: { doc: doc(h(3, 'Hook'), p()) } },
          { type: 'note', content: { doc: doc(h(3, 'Body'), p()) } },
          { type: 'note', content: { doc: doc(h(3, 'Call to action'), p()) } },
        ],
      },
      {
        type: 'column',
        x: 1020,
        y: 150,
        content: { title: 'Visual references' },
        children: [{ type: 'note', content: { doc: doc(p('Drop images and paste video links here.')) } }],
      },
      {
        type: 'todo',
        x: 1340,
        y: 150,
        w: 280,
        content: { title: 'Deliverables', items: todo('Script approved', 'First cut', 'Final export', 'Variations') },
      },
    ],
  },
]

export async function createFromBuiltin(template: BuiltinTemplate, fields: Partial<Board> = {}): Promise<Board> {
  const board = await createBoard({ title: template.title.replace(/ \(starter\)$/, ''), ...fields })
  const cards: Card[] = []
  let z = 1
  const build = (spec: Spec, columnId: string | null, order: number) => {
    const id = crypto.randomUUID()
    cards.push({
      id,
      boardId: board.id,
      type: spec.type,
      x: spec.x ?? 0,
      y: spec.y ?? 0,
      w: spec.w ?? 300,
      z: z++,
      columnId,
      columnOrder: order,
      content: spec.content,
      searchText: cardSearchText(spec.content),
    })
    spec.children?.forEach((child, i) => build(child, id, i + 1))
  }
  template.cards.forEach((spec) => build(spec, null, 0))
  await backend.applyOps(cards.map((card) => ({ kind: 'insert', card })))
  return board
}
