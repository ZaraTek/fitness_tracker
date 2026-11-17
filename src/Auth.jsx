import { useState } from 'react'
import { supabase } from './supabase'

export default function Auth() {
  const [mode, setMode] = useState('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setMsg(error.message)
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin + window.location.pathname },
      })
      if (error) setMsg(error.message)
      else if (!data.session) setMsg('Check your email for a confirmation link, then sign in.')
    }
    setBusy(false)
  }

  return (
    <div className="center-screen">
      <form className="card" onSubmit={submit}>
        <h1>🏋️ Fitness Tracker</h1>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
        />
        <button className="primary" disabled={busy}>
          {mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
        {msg && <p className="muted">{msg}</p>}
        <button type="button" className="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}
