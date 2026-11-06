import { useEffect, useState, type FormEvent } from 'react'
import { useShallow } from 'zustand/shallow'
import { centerOn } from '../canvas/geometry'
import { backend } from '../data/backend'
import { cardTitle } from '../lib/doc'
import { addComment, addSharedComment, deleteComment, selectOnly, setCommentResolved, useStore } from '../store/store'
import type { Comment } from '../types'
import { showToast } from './feedback'

const NAME_KEY = 'briefboard:comment-name'

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function rememberName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name)
  } catch {
    // Having to retype a name next time is only a small inconvenience.
  }
}

const authorOf = (comment: Comment) => comment.authorName || comment.authorEmail

function CardLink({ cardId }: { cardId: string }) {
  const card = useStore((s) => s.cards[cardId])
  if (!card) return <span className="comment-card missing">On a deleted card</span>
  return (
    <button
      className="comment-card"
      title="Show this card"
      onClick={() => {
        selectOnly([cardId])
        centerOn(cardId)
      }}
    >
      On: {cardTitle(card)}
    </button>
  )
}

export function CommentsPanel() {
  const open = useStore((s) => s.commentsOpen)
  const targetId = useStore((s) => s.commentCardId)
  const target = useStore((s) => (s.commentCardId ? s.cards[s.commentCardId] : undefined))
  const readOnly = useStore((s) => s.readOnly)
  const selection = useStore(useShallow((s) => Object.keys(s.selected)))
  const comments = useStore(
    useShallow((s) => Object.values(s.comments).sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
  )
  const [me, setMe] = useState('')
  const [body, setBody] = useState('')
  const [name, setName] = useState(savedName)
  const [internal, setInternal] = useState(false)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!readOnly) void backend.currentUser().then(setMe)
  }, [readOnly])

  // While the panel is open, selecting a card points the next comment at it.
  const only = selection.length === 1 ? selection[0] : null
  useEffect(() => {
    if (open && only && useStore.getState().cards[only]?.type !== 'arrow') useStore.setState({ commentCardId: only })
  }, [open, only])

  if (!open) return null

  const guard = (action: Promise<unknown>, failure: string) => {
    action.catch((err) => {
      console.error(err)
      showToast(failure)
    })
  }

  const trimmedName = name.trim()
  const canSend = Boolean(body.trim()) && !sending && (!readOnly || Boolean(trimmedName))

  const send = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!canSend) return
    setSending(true)
    try {
      if (readOnly) {
        await addSharedComment(targetId, trimmedName, body.trim())
        rememberName(trimmedName)
      } else {
        await addComment(targetId, body.trim(), internal)
      }
      setBody('')
    } catch (err) {
      console.error(err)
      const message = err instanceof Error && /Too many/.test(err.message) ? 'Too many comments right now. Try again in a few minutes.' : "Couldn't post that comment. Your text is still in the box."
      showToast(message)
    } finally {
      setSending(false)
    }
  }

  return (
    <aside className="comments-panel" aria-label="Comments">
      <header>
        <h2>Comments</h2>
        <button className="icon-btn" aria-label="Close comments" onClick={() => useStore.setState({ commentsOpen: false })}>✕</button>
      </header>
      <ul>
        {comments.map((comment) => (
          <li key={comment.id} className={`${comment.resolved ? 'resolved' : ''}${comment.internal ? ' internal' : ''}${comment.cardId && comment.cardId === targetId ? ' on-target' : ''}`}>
            <div className="comment-meta">
              <strong>{authorOf(comment)}</strong>
              <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</time>
            </div>
            {comment.internal && <span className="comment-tag">Team only</span>}
            {!comment.authorEmail && !readOnly && <span className="comment-tag link">From a link</span>}
            {comment.cardId && <CardLink cardId={comment.cardId} />}
            <p>{comment.body}</p>
            {readOnly ? (
              comment.resolved && <div className="comment-actions"><span className="muted">Resolved</span></div>
            ) : (
              <div className="comment-actions">
                <button onClick={() => guard(setCommentResolved(comment.id, !comment.resolved), "Couldn't update that comment.")}>
                  {comment.resolved ? 'Reopen' : 'Resolve'}
                </button>
                {(comment.authorEmail === me || !comment.authorEmail) && (
                  <button className="danger-text" onClick={() => guard(deleteComment(comment.id), "Couldn't delete that comment.")}>Delete</button>
                )}
              </div>
            )}
          </li>
        ))}
        {!comments.length && <li className="muted no-comments">No comments yet.</li>}
      </ul>
      <form onSubmit={(e) => void send(e)}>
        <div className="comment-target">
          {target ? (
            <>
              <span>On: {cardTitle(target)}</span>
              <button type="button" aria-label="Comment on the whole board instead" title="Comment on the whole board instead" onClick={() => { useStore.setState({ commentCardId: null }); selectOnly([]) }}>✕</button>
            </>
          ) : (
            <span className="muted">On the whole board. Select a card to comment on it.</span>
          )}
        </div>
        {readOnly && (
          <input
            className="comment-name"
            aria-label="Your name"
            placeholder="Your name"
            maxLength={80}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
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
        <div className="comment-send">
          {!readOnly && (
            <label className="comment-internal" title="People viewing through a secret link won't see this comment">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
              Team only
            </label>
          )}
          <button className="btn primary" disabled={!canSend}>Post</button>
        </div>
      </form>
    </aside>
  )
}
