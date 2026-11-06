import { useEffect, useState, type FormEvent } from 'react'
import { useShallow } from 'zustand/shallow'
import { backend } from '../data/backend'
import { cardTitle } from '../lib/doc'
import { addComment, deleteComment, setCommentResolved, useStore } from '../store/store'
import { showToast } from './feedback'

export function CommentsPanel() {
  const cardId = useStore((s) => s.commentCardId)
  const card = useStore((s) => (s.commentCardId ? s.cards[s.commentCardId] : undefined))
  const comments = useStore(
    useShallow((s) =>
      Object.values(s.comments)
        .filter((c) => c.cardId === s.commentCardId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    ),
  )
  const [me, setMe] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    void backend.currentUser().then(setMe)
  }, [])

  if (!cardId || !card) return null

  const guard = (action: Promise<unknown>, failure: string) => {
    action.catch((err) => {
      console.error(err)
      showToast(failure)
    })
  }

  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    const text = body.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await addComment(cardId, text)
      setBody('')
    } catch (err) {
      console.error(err)
      showToast("Couldn't post that comment. Your text is still in the box.")
    } finally {
      setSending(false)
    }
  }

  return (
    <aside className="comments-panel" aria-label="Comments">
      <header>
        <div>
          <h2>Comments</h2>
          <p>{cardTitle(card)}</p>
        </div>
        <button className="icon-btn" aria-label="Close comments" onClick={() => useStore.setState({ commentCardId: null })}>✕</button>
      </header>
      <ul>
        {comments.map((comment) => (
          <li key={comment.id} className={comment.resolved ? 'resolved' : ''}>
            <div className="comment-meta">
              <strong>{comment.authorEmail}</strong>
              <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</time>
            </div>
            <p>{comment.body}</p>
            <div className="comment-actions">
              <button onClick={() => guard(setCommentResolved(comment.id, !comment.resolved), "Couldn't update that comment.")}>
                {comment.resolved ? 'Reopen' : 'Resolve'}
              </button>
              {comment.authorEmail === me && (
                <button className="danger-text" onClick={() => guard(deleteComment(comment.id), "Couldn't delete that comment.")}>Delete</button>
              )}
            </div>
          </li>
        ))}
        {!comments.length && <li className="muted no-comments">No comments yet.</li>}
      </ul>
      <form onSubmit={(e) => void send(e)}>
        <textarea
          aria-label="Write a comment"
          placeholder="Write a comment"
          rows={3}
          maxLength={5000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
          }}
        />
        <button className="btn primary" disabled={!body.trim() || sending}>Post</button>
      </form>
    </aside>
  )
}
