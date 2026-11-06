import Highlight from '@tiptap/extension-highlight'
import StarterKit from '@tiptap/starter-kit'

export const extensions = [
  StarterKit.configure({
    link: {
      openOnClick: false,
      protocols: ['http', 'https', 'mailto'],
      HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
    },
  }),
  Highlight,
]
