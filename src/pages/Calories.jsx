import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, explain } from '../supabase'
import { toDateStr, addDays, prettyDate } from '../dates'
import { resizeToBase64 } from '../image'
import FoodChat from './FoodChat'
import { MICROS, ALL_NUMERIC, BASE_NUMERIC } from '../nutrients'

const NUM = ALL_NUMERIC
const EMPTY = Object.fromEntries(['name', ...NUM].map((k) => [k, '']))
const MIGRATION_HINT = 'Micronutrients weren’t saved: run supabase/002_micros.sql in the Supabase SQL Editor.'


export default function Calories({ settings, saveSettings }) {
  const [date, setDate] = useState(toDateStr())
  const [entries, setEntries] = useState([])
  const [active, setActive] = useState(null) // active calories logged for this date, or null
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('food_entries')
      .select('*')
      .eq('date', date)
      .order('created_at')
    if (error) return setError(explain(error))
    setError('')
    setEntries(data)
  }, [date])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setActive(null)
    supabase
      .from('daily_activity')
      .select('active_calories')
      .eq('date', date)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(explain(error))
        else setActive(data ? data.active_calories : null)
      })
  }, [date])

  async function saveActive(value) {
    const { error } =
      value === null
        ? await supabase.from('daily_activity').delete().eq('date', date)
        : await supabase.from('daily_activity').upsert({ date, active_calories: value }, { onConflict: 'user_id,date' })
    if (error) {
      setError(explain(error))
      return false
    }
    setActive(value)
    return true
  }

  const total = useMemo(() => {
    const t = Object.fromEntries(NUM.map((k) => [k, 0]))
    for (const e of entries) for (const k of NUM) t[k] += Number(e[k]) || 0 // new columns may be missing
    return t
  }, [entries])

  async function save(form) {
    const row = { date, name: form.name || 'Food' }
    for (const k of NUM) row[k] = Number(form[k]) || 0
    row.calories = Math.round(row.calories) // integer column
    let { data, error } = await supabase.from('food_entries').insert(row).select().single()
    if (error?.code === 'PGRST204') {
      // Micronutrient columns not migrated yet: save the basics and say how to fix it.
      const basic = Object.fromEntries(Object.entries(row).filter(([k]) => k === 'date' || k === 'name' || BASE_NUMERIC.includes(k)))
      ;({ data, error } = await supabase.from('food_entries').insert(basic).select().single())
      if (!error) setError(MIGRATION_HINT)
    }
    if (error) {
      setError(explain(error))
      return null
    }
    setEntries((e) => [...e, data])
    return data
  }

  async function update(id, form) {
    const fields = { name: form.name || 'Food' }
    for (const k of NUM) fields[k] = Number(form[k]) || 0
    fields.calories = Math.round(fields.calories) // integer column
    const { data, error } = await supabase.from('food_entries').update(fields).eq('id', id).select().single()
    if (error) {
      setError(explain(error))
      return false
    }
    setEntries((all) => all.map((x) => (x.id === id ? data : x)))
    return true
  }

  async function remove(id) {
    const { error } = await supabase.from('food_entries').delete().eq('id', id)
    if (error) {
      setError(explain(error))
      return false
    }
    setEntries((e) => e.filter((x) => x.id !== id))
    return true
  }

  // With a resting burn set and active calories logged, the day's maintenance is resting + active.
  const resting = Number(settings.resting_calories) || 0
  const fromActivity = resting > 0 && active !== null
  const maintenance = fromActivity ? resting + active : settings.maintenance_calories
  const balance = Math.round(total.calories - maintenance)
  const remaining = Math.round(settings.calorie_target - total.calories)

  return (
    <>
      <div className="row datenav">
        <button className="link" onClick={() => setDate(addDays(date, -1))}>◀</button>
        <strong>{date === toDateStr() ? 'Today' : prettyDate(date)}</strong>
        <button className="link" onClick={() => setDate(addDays(date, 1))} disabled={date >= toDateStr()}>▶</button>
      </div>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="big">
          {Math.round(total.calories)} <span className="muted small">/ {settings.calorie_target} kcal</span>
        </div>
        <Bar value={total.calories} max={settings.calorie_target} />
        <p className="small">
          {remaining >= 0 ? `${remaining} kcal left` : `${-remaining} kcal over target`}
          {' · '}
          <b className={balance <= 0 ? 'good' : 'warn'}>
            {balance <= 0 ? `${-balance} deficit` : `${balance} surplus`}
          </b>{' '}
          <span className="muted">
            vs {maintenance} maintenance{fromActivity && ` (${resting} resting + ${active} active)`}
          </span>
        </p>
        <ActiveCalories value={active} onSave={saveActive} hasResting={resting > 0} />
        <MacroRow label="Protein" v={total.protein} t={settings.protein_target} />
        <MacroRow label="Carbs" v={total.carbs} t={settings.carb_target} />
        <MacroRow label="Fat" v={total.fat} t={settings.fat_target} />
      </div>

      <Micros total={total} />

      <FoodChat
        onSave={save}
        onRemove={remove}
        context={`${Math.round(total.calories)} of ${settings.calorie_target} kcal eaten; protein ${Math.round(total.protein)}/${settings.protein_target} g, carbs ${Math.round(total.carbs)}/${settings.carb_target} g, fat ${Math.round(total.fat)}/${settings.fat_target} g.`}
      />
      <AddFood onSave={save} />

      {entries.map((e) => (
        <EntryCard key={e.id} entry={e} onUpdate={(form) => update(e.id, form)} onRemove={() => remove(e.id)} />
      ))}

      <Goals settings={settings} saveSettings={saveSettings} />
    </>
  )
}

function ActiveCalories({ value, onSave, hasResting }) {
  const [draft, setDraft] = useState(null) // non-null while editing
  const [busy, setBusy] = useState(false)

  async function submit(ev) {
    ev.preventDefault()
    const v = draft.trim() === '' ? null : Math.round(Number(draft))
    if (v !== null && !(v >= 0)) return
    setBusy(true)
    if (await onSave(v)) setDraft(null)
    setBusy(false)
  }

  if (draft !== null) {
    return (
      <form className="active-form" onSubmit={submit}>
        <input
          type="number"
          inputMode="numeric"
          min="0"
          placeholder="Active kcal"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          autoFocus
        />
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="link" onClick={() => setDraft(null)} disabled={busy}>Cancel</button>
      </form>
    )
  }

  return (
    <div className="active-row small">
      {value === null ? (
        <button className="link" onClick={() => setDraft('')}>🔥 Add active calories</button>
      ) : (
        <>
          <span>🔥 {value} active kcal</span>
          <button className="link" onClick={() => setDraft(String(value))}>Edit</button>
        </>
      )}
      {value !== null && !hasResting && (
        <span className="muted">Set your resting burn in Goals to use this.</span>
      )}
    </div>
  )
}

function Bar({ value, max, goal = false }) {
  const pct = Math.min(100, max ? (value / max) * 100 : 0)
  // Over a limit is a warning; over a goal is fine.
  const cls = value > max ? (goal ? 'met' : 'over') : ''
  return (
    <div className="bar">
      <div style={{ width: pct + '%' }} className={cls} />
    </div>
  )
}

function EntryCard({ entry, onUpdate, onRemove }) {
  const [form, setForm] = useState(null) // non-null while editing
  const [busy, setBusy] = useState(false)
  const set = (k) => (ev) => setForm({ ...form, [k]: ev.target.value })

  function startEdit() {
    setForm(Object.fromEntries(['name', ...NUM].map((k) => [k, String(k === 'name' ? entry.name : Number(entry[k]) || 0)])))
  }

  async function save(ev) {
    ev.preventDefault()
    setBusy(true)
    if (await onUpdate(form)) setForm(null)
    setBusy(false)
  }

  if (form) {
    return (
      <form className="card" onSubmit={save}>
        <input value={form.name} onChange={set('name')} placeholder="Name" required />
        <div className="grid3">
          <label>Calories<input type="number" inputMode="decimal" step="any" value={form.calories} onChange={set('calories')} /></label>
          <label>Protein g<input type="number" inputMode="decimal" step="any" value={form.protein} onChange={set('protein')} /></label>
          <label>Carbs g<input type="number" inputMode="decimal" step="any" value={form.carbs} onChange={set('carbs')} /></label>
          <label>Fat g<input type="number" inputMode="decimal" step="any" value={form.fat} onChange={set('fat')} /></label>
        </div>
        <p className="muted small">Micronutrients</p>
        <div className="grid3">
          {MICROS.map((m) => (
            <label key={m.key}>
              {m.label} {m.unit}
              <input type="number" inputMode="decimal" step="any" value={form[m.key]} onChange={set(m.key)} />
            </label>
          ))}
        </div>
        <div className="row">
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          <button type="button" className="link" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
        </div>
      </form>
    )
  }

  return (
    <div className="card">
      <div className="row">
        <h3>{entry.name}</h3>
        <div className="entry-actions">
          <button className="link" onClick={startEdit}>Edit</button>
          <button className="link danger" onClick={onRemove} aria-label="Delete">✕</button>
        </div>
      </div>
      <p className="muted small">
        {entry.calories} kcal · P {Number(entry.protein)} · C {Number(entry.carbs)} · F {Number(entry.fat)}
      </p>
      <details>
        <summary className="muted small">Nutrients</summary>
        <div className="nutrient-list small">
          {MICROS.map((m) => (
            <span key={m.key}>
              {m.label} <b className="plain">{fmtAmount(Number(entry[m.key]) || 0)} {m.unit}</b>
            </span>
          ))}
        </div>
      </details>
    </div>
  )
}

function fmtAmount(v) {
  if (v === 0) return '0'
  if (v < 10) return v.toFixed(1).replace(/\.0$/, '')
  return String(Math.round(v))
}

function Micros({ total }) {
  return (
    <details className="card">
      <summary>Micronutrients</summary>
      <div className="micros">
        {MICROS.map((m) => {
          const v = total[m.key] || 0
          return (
            <div className="micro" key={m.key}>
              <div className="row small">
                <span>{m.label}</span>
                <span className="muted">
                  {fmtAmount(v)} {m.unit} · {Math.round((v / m.dv) * 100)}%
                </span>
              </div>
              <Bar value={v} max={m.dv} goal={m.kind === 'goal'} />
            </div>
          )
        })}
      </div>
      <p className="muted small">
        % of the FDA Daily Value. Sugar, sodium, saturated fat and cholesterol are limits; the rest are goals. AI
        estimates for vitamins and minerals are rough.
      </p>
    </details>
  )
}

function MacroRow({ label, v, t }) {
  return (
    <div className="macro">
      <span>{label}</span>
      <Bar value={v} max={t} />
      <span className="small">{Math.round(v)} / {t} g</span>
    </div>
  )
}

function AddFood({ onSave }) {
  const [form, setForm] = useState(EMPTY)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')
  const [file, setFile] = useState(null)

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  async function estimate() {
    if (!file) return
    setBusy(true)
    setMsg('')
    try {
      const image = await resizeToBase64(file)
      const { data, error } = await supabase.functions.invoke('estimate-food', {
        body: { image, mediaType: 'image/jpeg', note },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setForm(Object.fromEntries(['name', ...NUM].map((k) => [k, data[k] ?? ''])))
      setMsg(`Estimate (${data.confidence ?? '?'} confidence): ${data.notes ?? ''} Edit anything, then save.`)
    } catch (e) {
      setMsg('Estimate failed: ' + (e.message || e))
    }
    setBusy(false)
  }

  function submit(e) {
    e.preventDefault()
    onSave(form)
    setForm(EMPTY)
    setFile(null)
    setNote('')
    setMsg('')
    setOpen(false)
  }

  if (!open) return <button className="primary wide" onClick={() => setOpen(true)}>+ Add food</button>

  return (
    <form className="card" onSubmit={submit}>
      <div className="photo-box">
        <label className="primary file-btn">
          📷 {file ? 'Change photo' : 'Take / choose photo'}
          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => setFile(e.target.files[0] ?? null)} />
        </label>
        {file && (
          <>
            <input placeholder="Optional note, e.g. “about 200g chicken”" value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="button" onClick={estimate} disabled={busy}>
              {busy ? 'Estimating…' : 'Estimate with Claude'}
            </button>
          </>
        )}
        {msg && <p className="muted small">{msg}</p>}
      </div>
      <input placeholder="Name" value={form.name} onChange={set('name')} required />
      <div className="grid3">
        <label>Calories<input type="number" inputMode="decimal" value={form.calories} onChange={set('calories')} required /></label>
        <label>Protein g<input type="number" inputMode="decimal" step="any" value={form.protein} onChange={set('protein')} /></label>
        <label>Carbs g<input type="number" inputMode="decimal" step="any" value={form.carbs} onChange={set('carbs')} /></label>
        <label>Fat g<input type="number" inputMode="decimal" step="any" value={form.fat} onChange={set('fat')} /></label>
      </div>
      <details>
        <summary className="muted small">Micronutrients (optional)</summary>
        <div className="grid3">
          {MICROS.map((m) => (
            <label key={m.key}>
              {m.label} {m.unit}
              <input type="number" inputMode="decimal" step="any" value={form[m.key]} onChange={set(m.key)} />
            </label>
          ))}
        </div>
      </details>
      <div className="row">
        <button className="primary">Save</button>
        <button type="button" className="link" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  )
}

function Goals({ settings, saveSettings }) {
  const [f, setF] = useState(settings)
  useEffect(() => setF(settings), [settings])
  const field = (k, label) => (
    <label>
      {label}
      <input type="number" inputMode="numeric" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  )
  return (
    <details className="card">
      <summary>Goals &amp; settings</summary>
      <div className="grid3">
        {field('calorie_target', 'Target kcal')}
        {field('maintenance_calories', 'Maintenance kcal')}
        {field('resting_calories', 'Resting burn kcal')}
        {field('protein_target', 'Protein g')}
        {field('carb_target', 'Carbs g')}
        {field('fat_target', 'Fat g')}
        <label>
          Weight unit
          <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
            <option value="lb">lb</option>
            <option value="kg">kg</option>
          </select>
        </label>
      </div>
      <button
        className="primary"
        onClick={() =>
          saveSettings({
            unit: f.unit,
            calorie_target: Number(f.calorie_target) || 0,
            maintenance_calories: Number(f.maintenance_calories) || 0,
            resting_calories: Number(f.resting_calories) || null,
            protein_target: Number(f.protein_target) || 0,
            carb_target: Number(f.carb_target) || 0,
            fat_target: Number(f.fat_target) || 0,
          })
        }
      >
        Save goals
      </button>
      <p className="muted small">
        Deficit/surplus = calories eaten − maintenance. On days you add active calories (e.g. Apple Watch Active
        Energy), maintenance = resting burn + active calories; otherwise the maintenance above is used.
      </p>
    </details>
  )
}
