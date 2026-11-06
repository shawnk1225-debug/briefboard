import { useEffect, useState, type FormEvent } from 'react'
import { addMember, listMembers, removeMember, supabase } from '../data/supabaseBackend'
import type { Member } from '../types'
import { askConfirm } from '../ui/feedback'

export function TeamDialog({ onClose }: { onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [me, setMe] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const refresh = () =>
    listMembers()
      .then(setMembers)
      .catch(() => setMessage("Couldn't load the team list."))

  useEffect(() => {
    void refresh()
    void supabase!.auth.getUser().then(({ data }) => setMe(data.user?.email?.toLowerCase() ?? null))
  }, [])

  const isOwner = members.some((m) => m.email === me && m.role === 'owner')

  const invite = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await addMember(email)
      setMessage(`${email.trim()} is on the list. Now create their login in Supabase (Authentication → Users → Add user) and send them the temporary password.`)
      setEmail('')
      await refresh()
    } catch {
      setMessage(`Couldn't add ${email.trim()}. They may already be on the team.`)
    }
  }

  const remove = async (member: Member) => {
    if (!(await askConfirm(`Remove ${member.email}? They will lose access to every board.`, 'Remove'))) return
    try {
      await removeMember(member.email)
      await refresh()
    } catch {
      setMessage(`Couldn't remove ${member.email}.`)
    }
  }

  const changePassword = async (e: FormEvent) => {
    e.preventDefault()
    const { error } = await supabase!.auth.updateUser({ password })
    setMessage(error ? `Password not changed: ${error.message}` : 'Password changed.')
    if (!error) setPassword('')
  }

  return (
    <div className="dialog-backdrop" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dialog team-dialog" role="dialog" aria-modal="true" aria-label="Team">
        <h2>Team</h2>
        <ul className="member-list">
          {members.map((member) => (
            <li key={member.email}>
              <span>
                {member.email} {member.email === me && <em>(you)</em>}
              </span>
              <span className="muted">{member.role}</span>
              {isOwner && member.email !== me && (
                <button className="link-btn danger-text" onClick={() => void remove(member)}>Remove</button>
              )}
            </li>
          ))}
        </ul>
        {isOwner && (
          <form className="inline-form" onSubmit={(e) => void invite(e)}>
            <label>
              Add a teammate's email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="btn primary">Add</button>
          </form>
        )}
        <form className="inline-form" onSubmit={(e) => void changePassword(e)}>
          <label>
            Change your password
            <input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <button className="btn">Change</button>
        </form>
        {message && <p className="form-message" role="status">{message}</p>}
        <div className="dialog-actions">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
