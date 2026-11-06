import type { Card, CardContent, RichDoc } from '../types'

export const textToDoc = (text: string): RichDoc => ({
  type: 'doc',
  content: text.split(/\r?\n/).map((line) => ({
    type: 'paragraph',
    ...(line ? { content: [{ type: 'text', text: line }] } : {}),
  })),
})

export function docText(doc?: RichDoc): string {
  if (!doc) return ''
  if (doc.type === 'text') return doc.text ?? ''
  const parts = (doc.content ?? []).map(docText)
  const block = doc.content?.some((c) => c.type !== 'text' && c.type !== 'hardBreak')
  return parts.join(block ? '\n' : '').trim()
}

export function cardSearchText(content: CardContent): string {
  const parts = [
    docText(content.doc),
    content.title,
    content.caption,
    content.url,
    content.description,
    content.label,
    content.name,
    ...(content.items ?? []).map((item) => item.text),
    ...(content.rows ?? []).flat(),
  ]
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

export function cardTitle(card: Card): string {
  const text = card.searchText || card.type
  return text.length > 60 ? `${text.slice(0, 60)}…` : text
}

function inlineMarkdown(node: RichDoc): string {
  if (node.type === 'hardBreak') return '  \n'
  if (node.type !== 'text') return (node.content ?? []).map(inlineMarkdown).join('')
  let text = node.text ?? ''
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') text = `**${text}**`
    else if (mark.type === 'italic') text = `*${text}*`
    else if (mark.type === 'strike') text = `~~${text}~~`
    else if (mark.type === 'code') text = `\`${text}\``
    else if (mark.type === 'link') text = `[${text}](${String(mark.attrs?.href ?? '')})`
  }
  return text
}

const indentLines = (text: string, pad: string) =>
  text
    .split('\n')
    .map((line, i) => (i === 0 || !line ? line : pad + line))
    .join('\n')

export function docToMarkdown(doc?: RichDoc): string {
  if (!doc) return ''
  const inner = () => (doc.content ?? []).map(inlineMarkdown).join('')
  const blocks = (separator = '\n\n') => (doc.content ?? []).map(docToMarkdown).filter(Boolean).join(separator)
  switch (doc.type) {
    case 'doc':
      return blocks()
    case 'paragraph':
      return inner()
    case 'heading':
      return `${'#'.repeat(Number(doc.attrs?.level ?? 1))} ${inner()}`
    case 'bulletList':
      return (doc.content ?? []).map((li) => `- ${indentLines(docToMarkdown(li), '  ')}`).join('\n')
    case 'orderedList':
      return (doc.content ?? []).map((li, i) => `${i + 1}. ${indentLines(docToMarkdown(li), '   ')}`).join('\n')
    case 'listItem':
      return blocks('\n')
    case 'blockquote':
      return blocks()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
    case 'codeBlock':
      return `\`\`\`\n${(doc.content ?? []).map((n) => n.text ?? '').join('')}\n\`\`\``
    case 'horizontalRule':
      return '---'
    default:
      return inner()
  }
}
