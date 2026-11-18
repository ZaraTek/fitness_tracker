import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, explain } from '../supabase'
import { toDateStr, prettyDate } from '../dates'

const CATS = ['push', 'pull', 'legs']

// "3×4 @ 120" — group consecutive identical sets.
function fmtSets(list, unit) {
  const groups = []
  for (const s of list) {
    const last = groups[groups.length - 1]
    if (last && last.weight === Number(s.weight) && last.reps === s.reps) last.count++
    else groups.push({ weight: Number(s.weight), reps: s.reps, count: 1 })
  }
  return groups.map((g) => `${g.count}×${g.reps} @ ${g.weight}${unit === 'kg' ? 'kg' : ''}`).join(', ')
}

export default function Workouts({ settings }) {
  const [cat, setCat] = useState('push')
  const [exercises, setExercises] = useState([])
  const [workouts, setWorkouts] = useState([])
  const [sets, setSets] = useState([])
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // { exercise, date }
  const unit = settings.unit

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

  // Per exercise: sessions (date -> sets), newest first.
  const history = useMemo(() => {
    const wDate = Object.fromEntries(workouts.map((w) => [w.id, w.date]))
    const out = {}
    for (const s of sets) {
      const d = wDate[s.workout_id]
      if (!d) continue
      const byDate = (out[s.exercise_id] ??= {})
      ;(byDate[d] ??= []).push(s)
    }
    return Object.fromEntries(
      Object.entries(out).map(([id, byDate]) => [
        id,
        Object.entries(byDate)
          .sort(([a], [b]) => (a < b ? 1 : -1))
          .map(([date, list]) => ({ date, sets: list.sort((a, b) => a.set_number - b.set_number) })),
      ]),
    )
  }, [sets, workouts])

  async function addExercise(name) {
    const { data, error } = await supabase.from('exercises').insert({ name, category: cat }).select().single()
    if (error) return setError(error.code === '23505' ? 'That exercise already exists.' : explain(error))
    setExercises((e) => [...e, data].sort((a, b) => a.name.localeCompare(b.name)))
  }

  async function removeExercise(ex) {
    if (!confirm(`Delete "${ex.name}" and all its logged sets?`)) return
    const { error } = await supabase.from('exercises').delete().eq('id', ex.id)
    if (error) return setError(explain(error))
    setEditing(null)
    await load()
  }

  // Replace this exercise's sets for the given date with `rows`.
  async function saveStats(exercise, date, rows) {
    try {
      let workout = workouts.find((w) => w.date === date && w.category === exercise.category)
      if (!workout) {
        if (!rows.length) return setEditing(null)
        const { data, error } = await supabase
          .from('workouts')
          .insert({ date, category: exercise.category })
          .select()
          .single()
        if (error) throw error
        workout = data
      }
      const del = await supabase
        .from('workout_sets')
        .delete()
        .eq('workout_id', workout.id)
        .eq('exercise_id', exercise.id)
      if (del.error) throw del.error
      if (rows.length) {
        const ins = await supabase.from('workout_sets').insert(
          rows.map((r, i) => ({
            workout_id: workout.id,
            exercise_id: exercise.id,
            set_number: i + 1,
            reps: Number(r.reps),
            weight: Number(r.weight) || 0,
          })),
        )
        if (ins.error) throw ins.error
      }
      setEditing(null)
      await load()
    } catch (e) {
      setError(explain(e))
    }
  }

  const list = exercises.filter((e) => e.category === cat)

  return (
    <>
      <div className="seg">
        {CATS.map((c) => (
          <button key={c} className={cat === c ? 'active' : ''} onClick={() => { setCat(c); setEditing(null) }}>
            {c}
          </button>
        ))}
      </div>
      {error && <div className="error">{error}</div>}

      <NewExercise cat={cat} onAdd={addExercise} />

      {list.map((ex) => {
        const sessions = history[ex.id] ?? []
        const latest = sessions[0]
        const best = Math.max(0, ...sessions.flatMap((s) => s.sets.map((x) => Number(x.weight))))
        const isEditing = editing?.exercise.id === ex.id
        return (
          <div className="card" key={ex.id}>
            <div className="row">
              <h3>{ex.name}</h3>
              {!isEditing && (
                <button onClick={() => setEditing({ exercise: ex, date: toDateStr() })}>Edit stats</button>
              )}
            </div>

            {latest ? (
              <p className="muted small">
                {prettyDate(latest.date)}: <b className="plain">{fmtSets(latest.sets, unit)}</b> · Best {best} {unit}
              </p>
            ) : (
              <p className="muted small">No stats yet.</p>
            )}

            {isEditing && (
              <StatsEditor
                exercise={ex}
                initialDate={editing.date}
                sessions={sessions}
                unit={unit}
                onSave={(date, rows) => saveStats(ex, date, rows)}
                onCancel={() => setEditing(null)}
                onDelete={() => removeExercise(ex)}
              />
            )}

            {!isEditing && sessions.length > 1 && (
              <details>
                <summary className="muted small">History ({sessions.length})</summary>
                {sessions.map((s) => (
                  <div className="row set-row" key={s.date}>
                    <span className="small">{prettyDate(s.date)}</span>
                    <span className="small">{fmtSets(s.sets, unit)}</span>
                    <button className="link" onClick={() => setEditing({ exercise: ex, date: s.date })}>Edit</button>
                  </div>
                ))}
              </details>
            )}
          </div>
        )
      })}
      {!list.length && <p className="muted center">No {cat} exercises yet. Add one above.</p>}
    </>
  )
}

function StatsEditor({ sessions, unit, initialDate, onSave, onCancel, onDelete }) {
  const [date, setDate] = useState(initialDate)
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)

  // Load the sets already logged on this date; otherwise start from the last session.
  useEffect(() => {
    const onDate = sessions.find((s) => s.date === date)
    const source = onDate ?? sessions[0]
    setRows(
      source
        ? source.sets.map((s) => ({ weight: String(Number(s.weight)), reps: String(s.reps) }))
        : [{ weight: '', reps: '' }],
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  const existing = sessions.some((s) => s.date === date)
  const setRow = (i, k) => (e) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    await onSave(date, rows.filter((r) => r.reps !== ''))
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="editor">
      <label>
        Date
        <input type="date" value={date} max={toDateStr()} onChange={(e) => setDate(e.target.value || toDateStr())} />
      </label>
      <p className="muted small">
        {existing ? 'Editing sets logged on this date.' : 'New entry, prefilled from your last session.'}
      </p>
      {rows.map((r, i) => (
        <div className="editor-row" key={i}>
          <span className="muted small">{i + 1}</span>
          <input type="number" inputMode="decimal" step="any" placeholder={unit} value={r.weight} onChange={setRow(i, 'weight')} />
          <input type="number" inputMode="numeric" placeholder="reps" value={r.reps} onChange={setRow(i, 'reps')} />
          <button type="button" className="link danger" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="row">
        <button type="button" onClick={() => setRows([...rows, rows[rows.length - 1] ? { ...rows[rows.length - 1] } : { weight: '', reps: '' }])}>
          + Set
        </button>
        <button className="primary" disabled={busy}>Save</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
      <button type="button" className="link danger" onClick={onDelete}>Delete exercise</button>
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
