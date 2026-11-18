import { useCallback, useEffect, useState } from 'react'
import { supabase, explain } from './supabase'
import Workouts from './pages/Workouts'
import Calories from './pages/Calories'
import Progress from './pages/Progress'

const DEFAULTS = {
  unit: 'lb',
  calorie_target: 2200,
  maintenance_calories: 2700,
  resting_calories: null, // when set and active calories are logged, day maintenance = resting + active
  protein_target: 160,
  carb_target: 220,
  fat_target: 70,
}

const TABS = [
  ['calories', '🍽️', 'Calories'],
  ['workouts', '🏋️', 'Workouts'],
  ['progress', '📈', 'Progress'],
]

export default function App({ user }) {
  const [tab, setTab] = useState(() => localStorage.getItem('tab') || 'calories')
  const [settings, setSettings] = useState(DEFAULTS)
  const [error, setError] = useState('')

  useEffect(() => {
    supabase
      .from('user_settings')
      .select('*')
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(explain(error))
        else if (data) setSettings({ ...DEFAULTS, ...data })
      })
  }, [])

  const saveSettings = useCallback(async (patch) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    const { user_id, updated_at, ...fields } = next
    const { error } = await supabase
      .from('user_settings')
      .upsert({ ...fields, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) setError(explain(error))
  }, [settings])

  function go(t) {
    setTab(t)
    localStorage.setItem('tab', t)
  }

  const props = { settings, saveSettings }
  return (
    <div className="app">
      <header>
        <strong className="brand">Fitness</strong>
        <span className="muted small">{user.email}</span>
        <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>
      {error && <div className="error">{error}</div>}
      <main>
        {tab === 'workouts' && <Workouts {...props} />}
        {tab === 'calories' && <Calories {...props} user={user} />}
        {tab === 'progress' && <Progress {...props} user={user} />}
      </main>
      <nav>
        {TABS.map(([id, icon, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => go(id)}>
            <span>{icon}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}
