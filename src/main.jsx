import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { supabase, isConfigured } from './supabase'
import Auth from './Auth'
import App from './App'
import './styles.css'

function Root() {
  const [session, setSession] = useState(undefined) // undefined = still loading

  useEffect(() => {
    if (!isConfigured) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!isConfigured) {
    return (
      <div className="center-screen">
        <div className="card">
          <h2>Setup needed</h2>
          <p>
            Copy <code>.env.example</code> to <code>.env</code> and fill in your Supabase URL and
            publishable key, then restart the dev server.
          </p>
        </div>
      </div>
    )
  }
  if (session === undefined) return <div className="center-screen muted">Loading…</div>
  return session ? <App user={session.user} /> : <Auth />
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
