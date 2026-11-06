import type { ReactNode } from 'react'

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export const NoteIcon = () => <Icon><path d="M5 4h14v11l-5 5H5z" /><path d="M14 20v-5h5" /><path d="M8.5 9h7M8.5 12.5h4" /></Icon>
export const ImageIcon = () => <Icon><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4 3.5 2.5L16 12l4.5 4" /></Icon>
export const LinkIcon = () => <Icon><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" /></Icon>
export const TodoIcon = () => <Icon><path d="m4 7 1.8 1.8L9 5.5M4 15l1.8 1.8L9 13.5" /><path d="M12.5 7.5H20M12.5 15.5H20" /></Icon>
export const BoardIcon = () => <Icon><rect x="3.5" y="4.5" width="7.5" height="15" rx="1.5" /><rect x="13" y="4.5" width="7.5" height="6.5" rx="1.5" /><rect x="13" y="13" width="7.5" height="6.5" rx="1.5" /></Icon>
export const ColumnIcon = () => <Icon><rect x="6" y="3.5" width="12" height="17" rx="2" /><path d="M6 8h12M9 12h6M9 15.5h6" /></Icon>
export const ArrowIcon = () => <Icon><path d="M5 19 19 5" /><path d="M10 5h9v9" /></Icon>
export const UndoIcon = () => <Icon><path d="M8.5 6 4.5 10l4 4" /><path d="M4.5 10H14a5 5 0 0 1 0 10h-3" /></Icon>
export const RedoIcon = () => <Icon><path d="m15.5 6 4 4-4 4" /><path d="M19.5 10H10a5 5 0 0 0 0 10h3" /></Icon>
export const TableIcon = () => <Icon><rect x="3.5" y="5" width="17" height="14" rx="1.5" /><path d="M3.5 10h17M3.5 14.5h17M10 10v9" /></Icon>
export const DocIcon = () => <Icon><path d="M6.5 3.5h7.5l4 4v13h-11.5z" /><path d="M14 3.5v4h4M9.5 12h5.5M9.5 15.5h5.5" /></Icon>
export const FileIcon = () => <Icon><path d="m19.5 11.5-7.8 7.8a4.5 4.5 0 0 1-6.4-6.4l8-8a3 3 0 0 1 4.3 4.2l-7.8 7.8a1.5 1.5 0 0 1-2.1-2.1l7-7" /></Icon>
export const SketchIcon = () => <Icon><path d="m4 20 1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" /><path d="m14.5 6.5 3 3" /></Icon>
export const ExpandIcon = () => <Icon><path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15" /></Icon>
export const CollapseIcon = () => <Icon><path d="M9 4.5V9H4.5M15 4.5V9h4.5M19.5 15H15v4.5M4.5 15H9v4.5" /></Icon>
export const SearchIcon = () => <Icon><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></Icon>
export const HomeIcon = () => <Icon><path d="m4 11 8-6.5 8 6.5" /><path d="M6 9.5V19.5h12V9.5" /></Icon>
export const MoreIcon = () => <Icon><circle cx="5.5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="18.5" cy="12" r="1" /></Icon>
