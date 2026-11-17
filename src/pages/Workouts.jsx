import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, explain } from '../supabase'
import { toDateStr, prettyDate } from '../dates'

const CATS = ['push', 'pull', 'legs']

export default function Workouts({ settings }) {
  const [cat, setCat] = useState('push')
  const [date, setDate] = useState(toDateStr())
  const [exercises, setExercises] = useState([])
  const [workouts, setWorkouts] = useState([])
  const [sets, setSets] = useState([])
  const [error, setError] = useState('')
  const [view, setView] = useState('log') // log | catalog

  const load = useCallback(async () => {
    const [ex, wk, st] = await Promise.all([
      supabase.from('exercises').select('*').order('name'),
      supabase.from('workouts').select('*').order('date', { ascending: false }),
      supabase.from('workout_sets').select('*').order('set_number'),
    ])
    const err = ex.error || wk.error || st.error
    if (err) return setError(explain(err))
    setError('')
    setExercises(ex.data)
    setWorkouts(wk.data)
    setSets(st.data)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const workout = workouts.find((w) => w.date === date && w.category === cat)
  const catExercises = exercises.filter((e) => e.category === cat)

  // Best weight + last performance per exercise, from all history.
  const stats = useMemo(() => {
    const wDate = Object.fromEntries(workouts.map((w) => [w.id, w.date]))
    const out = {}
    for (const s of sets) {
      const d = wDate[s.workout_id]
      const o = (out[s.exercise_id] ??= { best: 0, lastDate: '', lastSets: [] })
      o.best = Math.max(o.best, Number(s.weight))
      if (d > o.lastDate) {
        o.lastDate = d
        o.lastSets = []
      }
      if (d === o.lastDate) o.lastSets.push(s)
    }
    return out
  }, [sets, workouts])

  async function ensureWorkout() {
    if (workout) return workout.id
    const { data, error } = await supabase.from('workouts').insert({ date, category: cat }).select().single()
    if (error) throw error
    setWorkouts((w) => [data, ...w])
    return data.id
  }

  async function addSets({ exercise_id, weight, reps, count }) {
    try {
      const workout_id = await ensureWorkout()
      const existing = sets.filter((s) => s.workout_id === workout_id && s.exercise_id === exercise_id).length
      const rows = Array.from({ length: count }, (_, i) => ({
        workout_id,
        exercise_id,
        set_number: existing + i + 1,
        reps,
        weight,
      }))
      const { data, error } = await supabase.from('workout_sets').insert(rows).select()
      if (error) throw error
      setSets((s) => [...s, ...data])
    } catch (e) {
      setError(explain(e))
    }
  }

  async function removeSet(id) {
    const { error } = await supabase.from('workout_sets').delete().eq('id', id)
    if (error) return setError(explain(error))
    setSets((s) => s.filter((x) => x.id !== id))
  }

  async function addExercise(name) {
    const { data, error } = await supabase.from('exercises').insert({ name, category: cat }).select().single()
    if (error) return setError(error.code === '23505' ? 'That exercise already exists.' : explain(error))
    setExercises((e) => [...e, data].sort((a, b) => a.name.localeCompare(b.name)))
  }

  async function removeExercise(ex) {
    if (!confirm(`Delete "${ex.name}" and all its logged sets?`)) return
    const { error } = await supabase.from('exercises').delete().eq('id', ex.id)
    if (error) return setError(explain(error))
    setExercises((e) => e.filter((x) => x.id !== ex.id))
    setSets((s) => s.filter((x) => x.exercise_id !== ex.id))
  }

  async function removeWorkout() {
    if (!confirm('Delete this whole session?')) return
    const { error } = await supabase.from('workouts').delete().eq('id', workout.id)
    if (error) return setError(explain(error))
    setWorkouts((w) => w.filter((x) => x.id !== workout.id))
    setSets((s) => s.filter((x) => x.workout_id !== workout.id))
  }

  const sessionSets = workout ? sets.filter((s) => s.workout_id === workout.id) : []
  const unit = settings.unit

  return (
    <>
      <div className="seg">
        {CATS.map((c) => (
          <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="seg small-seg">
        <button className={view === 'log' ? 'active' : ''} onClick={() => setView('log')}>Log</button>
        <button className={view === 'catalog' ? 'active' : ''} onClick={() => setView('catalog')}>Catalog</button>
      </div>
      {error && <div className="error">{error}</div>}

      {view === 'log' && (
        <>
          <div className="card">
            <div className="row">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value || toDateStr())} />
              {workout && (
                <button className="link danger" onClick={removeWorkout}>Delete session</button>
              )}
            </div>
            <AddSetForm exercises={catExercises} stats={stats} unit={unit} onAdd={addSets} />
          </div>

          {catExercises
            .filter((e) => sessionSets.some((s) => s.exercise_id === e.id))
            .map((e) => (
              <div className="card" key={e.id}>
                <h3>{e.name}</h3>
                {sessionSets
                  .filter((s) => s.exercise_id === e.id)
                  .map((s) => (
                    <div className="row set-row" key={s.id}>
                      <span>Set {s.set_number}</span>
                      <span>
                        {Number(s.weight)} {unit} × {s.reps}
                      </span>
                      <button className="link danger" onClick={() => removeSet(s.id)}>✕</button>
                    </div>
                  ))}
              </div>
            ))}
          {!sessionSets.length && <p className="muted center">No sets logged for {prettyDate(date)} ({cat}).</p>}
        </>
      )}

      {view === 'catalog' && (
        <>
          <NewExercise cat={cat} onAdd={addExercise} />
          {catExercises.map((e) => {
            const st = stats[e.id]
            return (
              <div className="card" key={e.id}>
                <div className="row">
                  <h3>{e.name}</h3>
                  <button className="link danger" onClick={() => removeExercise(e)}>Delete</button>
                </div>
                {st ? (
                  <p className="muted small">
                    Best: <b>{st.best} {unit}</b> · Last ({prettyDate(st.lastDate)}):{' '}
                    {st.lastSets.map((s) => `${Number(s.weight)}×${s.reps}`).join(', ')}
                  </p>
                ) : (
                  <p className="muted small">Not logged yet.</p>
                )}
              </div>
            )
          })}
          {!catExercises.length && <p className="muted center">No {cat} exercises yet. Add one above.</p>}
        </>
      )}
    </>
  )
}

function AddSetForm({ exercises, stats, unit, onAdd }) {
  const [exId, setExId] = useState('')
  const [weight, setWeight] = useState('')
  const [reps, setReps] = useState('')
  const [count, setCount] = useState(1)

  const selected = exercises.find((e) => e.id === exId) ? exId : exercises[0]?.id || ''
  const st = stats[selected]

  // Prefill from the last performance whenever the exercise changes.
  useEffect(() => {
    const last = stats[selected]?.lastSets?.[0]
    if (last) {
      setWeight(String(Number(last.weight)))
      setReps(String(last.reps))
    } else {
      setWeight('')
      setReps('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  if (!exercises.length) return <p className="muted">Add exercises in the Catalog tab first.</p>

  function submit(e) {
    e.preventDefault()
    onAdd({ exercise_id: selected, weight: Number(weight) || 0, reps: Number(reps), count: Number(count) || 1 })
  }

  return (
    <form onSubmit={submit}>
      <select value={selected} onChange={(e) => setExId(e.target.value)}>
        {exercises.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      {st && (
        <p className="muted small">
          Last ({prettyDate(st.lastDate)}): {st.lastSets.map((s) => `${Number(s.weight)}×${s.reps}`).join(', ')} · Best {st.best} {unit}
        </p>
      )}
      <div className="grid3">
        <label>
          Weight ({unit})
          <input type="number" inputMode="decimal" step="any" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </label>
        <label>
          Reps
          <input type="number" inputMode="numeric" value={reps} onChange={(e) => setReps(e.target.value)} required />
        </label>
        <label>
          Sets
          <input type="number" inputMode="numeric" min="1" value={count} onChange={(e) => setCount(e.target.value)} />
        </label>
      </div>
      <button className="primary">Add</button>
    </form>
  )
}

function NewExercise({ cat, onAdd }) {
  const [name, setName] = useState('')
  return (
    <form
      className="card row"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) onAdd(name.trim())
        setName('')
      }}
    >
      <input placeholder={`New ${cat} exercise`} value={name} onChange={(e) => setName(e.target.value)} />
      <button className="primary">Add</button>
    </form>
  )
}
