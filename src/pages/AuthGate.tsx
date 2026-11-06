import type { Session } from '@supabase/supabase-js'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { supabase } from '../data/supabaseBackend'

type Access = 'checking' | 'member' | 'not-member' | 'error'

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: failure } = await supabase!.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (failure) setError(failure.status === 400 ? 'Wrong email or password.' : failure.message)
  }

  return (
    <div className="center-page">
      <form className="login" onSubmit={(e) => void submit(e)}>
        <h1 className="brand">Briefboard</h1>
        <p className="muted">Invite only. Ask your team owner if you need a login.</p>
        <label>
          Email
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}

// Only runs in Supabase mode. The database enforces access regardless; this
// just gives people a clear screen instead of an empty app.
export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [access, setAccess] = useState<Access>('checking')
  const email = session?.user.email?.toLowerCase()

  useEffect(() => {
    void supabase!.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase!.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!email) return
    setAccess('checking')
    supabase!
      .from('members')
      .select('email')
      .eq('email', email)
      .then(({ data, error }) => setAccess(error ? 'error' : data.length ? 'member' : 'not-member'))
  }, [email])

  if (session === undefined) return <div className="center-page muted">Loading…</div>
  if (!session) return <Login />
  if (access === 'checking') return <div className="center-page muted">Loading…</div>
  if (access !== 'member') {
    return (
      <div className="center-page">
        <h1>{access === 'error' ? "Can't reach the server" : 'No access yet'}</h1>
        <p>
          {access === 'error'
            ? 'Check your connection and reload the page.'
            : `${email} hasn't been added to this team. Ask your team owner to add you.`}
        </p>
        <button className="btn" onClick={() => void supabase!.auth.signOut()}>Sign out</button>
      </div>
    )
  }
  return <>{children}</>
}
