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
  // Lets an arrow in the same template point at this card.
  key?: string
  x?: number
  y?: number
  w?: number
  content: CardContent
  children?: Spec[]
  arrow?: { from: string; to: string }
}

export interface BuiltinTemplate {
  id: string
  title: string
  description: string
  cards: Spec[]
}

const LEFT_A = 0
const LEFT_B = 330
const RIGHT_X = 720
const COLUMN_W = 300
const COLUMN_GAP = 20
const TOP = 110

const section = (title: string, x: number, w: number): Spec => ({
  type: 'note',
  x,
  y: 0,
  w,
  content: { color: 'blue', doc: doc(h(2, title)) },
})

const field = (title: string, prompt?: string): Spec => ({
  type: 'note',
  content: { doc: doc(h(3, title), p(prompt)) },
})

function column(title: string, x: number, y: number, children: Spec[], key?: string): Spec {
  return { type: 'column', key, x, y, w: COLUMN_W, content: { title }, children }
}

function arrow(from: string, to: string): Spec {
  return { type: 'arrow', content: {}, arrow: { from, to } }
}

// The planning side, shared by both formats.
function briefSide(adType: 'Video ad' | 'Image ad', sizes: string[], variations: string[]): Spec[] {
  const typeItems = todo('Video ad', 'Image ad', 'Carousel ad').map((item) => ({ ...item, done: item.text === adType }))
  return [
    section('Ad concept and brief', LEFT_A, 630),
    column('Product', LEFT_A, TOP, [field('Product name')]),
    column('Batch number', LEFT_A, TOP + 170, [field('Batch', 'Must match the creative roadmap.')]),
    column('Ad links to', LEFT_A, TOP + 360, [
      { type: 'link', content: {} },
      { type: 'note', content: { doc: doc(p('Drop a product image here.')) } },
    ]),
    { type: 'todo', x: LEFT_B, y: TOP, w: COLUMN_W, content: { title: 'Type of ad', items: typeItems } },
    { type: 'todo', x: LEFT_B, y: TOP + 170, w: COLUMN_W, content: { title: 'Sizes needed', items: todo(...sizes) } },
    column('Variations needed', LEFT_B, TOP + 390, [{ type: 'note', content: { doc: doc(...variations.map((v) => p(v))) } }]),
    column('Ad concept: the theme or overall idea', LEFT_B, TOP + 590, [
      field('What', 'What the ad says and does.'),
      field('Why', 'Why this will work for this buyer.'),
      field('How', 'How the idea plays out in the ad.'),
    ]),
  ]
}

const HOOKS = ['hook1', 'hook2', 'hook3']
const hookX = (index: number) => RIGHT_X + index * (COLUMN_W + COLUMN_GAP)
const STRUCTURE_W = 3 * COLUMN_W + 2 * COLUMN_GAP

// To add more without code, build a board and choose "Save as template" from its menu.
export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'video-ad-brief',
    title: 'Video ad brief',
    description: 'Concept and brief on the left. 3 hooks into a hold and body, then the CTA.',
    cards: [
      ...briefSide('Video ad', ['1080x1080 (1:1)', '1080x1350 (4:5)', '1080x1920 (9:16)', '1920x1080 (16:9)'], ['3 hooks', '1 hold', '3 total ads']),
      section('Ad structure', RIGHT_X, STRUCTURE_W),
      ...HOOKS.map((key, i) =>
        column(`Hook ${i + 1}`, hookX(i), TOP, [field('Visuals'), field('Voiceover'), field('On-screen text')], key),
      ),
      column('Hold and body copy', hookX(1), TOP + 460, [field('Copy'), field('Visuals')], 'hold'),
      column('CTA', hookX(1), TOP + 800, [field('Copy'), field('Visuals')], 'cta'),
      ...HOOKS.map((key) => arrow(key, 'hold')),
      arrow('hold', 'cta'),
    ],
  },
  {
    id: 'static-ad-brief',
    title: 'Static ad brief',
    description: 'Concept and brief on the left. 3 hooks leading straight into the CTA.',
    cards: [
      ...briefSide('Image ad', ['1080x1080 (1:1)', '1080x1350 (4:5)', '1080x1920 (9:16)'], ['3 hooks', '3 total ads']),
      section('Ad structure', RIGHT_X, STRUCTURE_W),
      ...HOOKS.map((key, i) => column(`Hook ${i + 1}`, hookX(i), TOP, [field('Visuals'), field('Headline')], key)),
      column('CTA', hookX(1), TOP + 370, [field('Supporting copy'), field('Button text')], 'cta'),
      ...HOOKS.map((key) => arrow(key, 'cta')),
    ],
  },
]

export function buildTemplateCards(template: BuiltinTemplate, boardId: string): Card[] {
  const cards: Card[] = []
  const ids = new Map<string, string>()
  const arrows: Spec[] = []
  let z = 1

  const build = (spec: Spec, columnId: string | null, order: number) => {
    if (spec.arrow) {
      arrows.push(spec)
      return
    }
    const id = crypto.randomUUID()
    if (spec.key) ids.set(spec.key, id)
    cards.push({
      id,
      boardId,
      type: spec.type,
      x: spec.x ?? 0,
      y: spec.y ?? 0,
      w: spec.w ?? COLUMN_W,
      z: z++,
      columnId,
      columnOrder: order,
      content: spec.content,
      searchText: cardSearchText(spec.content),
    })
    spec.children?.forEach((child, i) => build(child, id, i + 1))
  }
  template.cards.forEach((spec) => build(spec, null, 0))

  // Arrows come last, once every card they point at has an id.
  for (const spec of arrows) {
    cards.push({
      id: crypto.randomUUID(),
      boardId,
      type: 'arrow',
      x: 0,
      y: 0,
      w: 0,
      z: z++,
      columnId: null,
      columnOrder: 0,
      content: { from: { cardId: ids.get(spec.arrow!.from) }, to: { cardId: ids.get(spec.arrow!.to) } },
      searchText: '',
    })
  }
  return cards
}

export async function createFromBuiltin(template: BuiltinTemplate, fields: Partial<Board> = {}): Promise<Board> {
  const board = await createBoard({ title: template.title, ...fields })
  const cards = buildTemplateCards(template, board.id)
  await backend.applyOps(cards.map((card) => ({ kind: 'insert', card })))
  return board
}
