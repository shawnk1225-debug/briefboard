import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import { generateHTML } from '@tiptap/html'
import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { extensions } from '../lib/editorExtensions'
import { docText } from '../lib/doc'
import { normalizeUrl } from '../lib/links'
import { commitInteraction, patchContent, useStore } from '../store/store'
import type { Card } from '../types'

function FormatBar({ editor }: { editor: Editor }) {
  const btn = (label: string, title: string, active: boolean, run: () => void) => (
    <button
      key={title}
      className={active ? 'active' : ''}
      title={title}
      aria-label={title}
      onMouseDown={(e) => {
        e.preventDefault() // keep the text selection in the editor
        run()
      }}
    >
      {label}
    </button>
  )
  const chain = () => editor.chain().focus()
  const setLink = () => {
    const current = editor.getAttributes('link').href as string | undefined
    const input = window.prompt('Link URL (leave empty to remove)', current ?? '')
    if (input === null) return
    if (!input.trim()) {
      chain().unsetLink().run()
      return
    }
    const href = normalizeUrl(input)
    if (href) chain().extendMarkRange('link').setLink({ href }).run()
  }
  return createPortal(
    <div className="floating-bar format-bar" data-interactive onPointerDown={(e) => e.stopPropagation()}>
      {btn('H1', 'Large heading', editor.isActive('heading', { level: 1 }), () => chain().toggleHeading({ level: 1 }).run())}
      {btn('H2', 'Heading', editor.isActive('heading', { level: 2 }), () => chain().toggleHeading({ level: 2 }).run())}
      {btn('H3', 'Small heading', editor.isActive('heading', { level: 3 }), () => chain().toggleHeading({ level: 3 }).run())}
      <span className="sep" />
      {btn('B', 'Bold', editor.isActive('bold'), () => chain().toggleBold().run())}
      {btn('I', 'Italic', editor.isActive('italic'), () => chain().toggleItalic().run())}
      {btn('S', 'Strikethrough', editor.isActive('strike'), () => chain().toggleStrike().run())}
      {btn('✎', 'Highlight', editor.isActive('highlight'), () => chain().toggleHighlight().run())}
      <span className="sep" />
      {btn('•', 'Bullet list', editor.isActive('bulletList'), () => chain().toggleBulletList().run())}
      {btn('1.', 'Numbered list', editor.isActive('orderedList'), () => chain().toggleOrderedList().run())}
      {btn('❝', 'Quote', editor.isActive('blockquote'), () => chain().toggleBlockquote().run())}
      {btn('🔗', 'Link', editor.isActive('link'), setLink)}
    </div>,
    document.body,
  )
}

export function RichEditor({ card, className = 'note-text' }: { card: Card; className?: string }) {
  const before = useRef(card)
  const readOnly = useStore((s) => s.readOnly)
  const editor = useEditor({
    extensions,
    content: card.content.doc ?? '',
    editable: !readOnly,
    autofocus: readOnly ? false : 'end',
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { class: className } },
    onUpdate: ({ editor: e }) => patchContent(card.id, { doc: e.getJSON() as Card['content']['doc'] }, { history: false }),
  })
  // TipTap's autofocus waits a frame, which would lose keys typed right after the click.
  useEffect(() => {
    if (!readOnly && editor?.view.dom.isConnected) editor.view.dom.focus({ preventScroll: true })
  }, [editor, readOnly])
  // Everything typed in one editing session becomes a single undo step.
  useEffect(() => () => commitInteraction([before.current], { sync: false }), [])
  return (
    <>
      <EditorContent editor={editor} />
      {editor && !readOnly && <FormatBar editor={editor} />}
    </>
  )
}

function NoteStatic({ card }: { card: Card }) {
  const html = useMemo(() => {
    if (!docText(card.content.doc)) return null
    try {
      // Rendered through the editor's schema, so unknown tags and scripts can't get in.
      return generateHTML(card.content.doc as never, extensions)
    } catch {
      return null
    }
  }, [card.content.doc])
  if (html === null) return <div className="note-text placeholder">Write something…</div>
  return <div className="note-text" dangerouslySetInnerHTML={{ __html: html }} />
}

export function NoteBody({ card }: { card: Card }) {
  const editing = useStore((s) => s.editingId === card.id)
  return (
    <div className="note-body" data-color={card.content.color ?? 'none'}>
      {editing ? <RichEditor card={card} /> : <NoteStatic card={card} />}
    </div>
  )
}
