import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, explain } from '../supabase'
import { toDateStr, addDays, prettyDate } from '../dates'
import { resizeToBase64 } from '../image'
import FoodChat from './FoodChat'

const EMPTY = { name: '', calories: '', protein: '', carbs: '', fat: '', fiber: '', sugar: '', sodium: '' }
const NUM = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium']


export default function Calories({ settings, saveSettings }) {
  const [date, setDate] = useState(toDateStr())
  const [entries, setEntries] = useState([])
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

  const total = useMemo(() => {
    const t = Object.fromEntries(NUM.map((k) => [k, 0]))
    for (const e of entries) for (const k of NUM) t[k] += Number(e[k])
    return t
  }, [entries])

  async function save(form) {
    const row = { date, name: form.name || 'Food' }
    for (const k of NUM) row[k] = Number(form[k]) || 0
    row.calories = Math.round(row.calories) // integer column
    const { data, error } = await supabase.from('food_entries').insert(row).select().single()
    if (error) {
      setError(explain(error))
      return null
    }
    setEntries((e) => [...e, data])
    return data
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

  const balance = Math.round(total.calories - settings.maintenance_calories)
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
          <span className="muted">vs {settings.maintenance_calories} maintenance</span>
        </p>
        <MacroRow label="Protein" v={total.protein} t={settings.protein_target} />
        <MacroRow label="Carbs" v={total.carbs} t={settings.carb_target} />
        <MacroRow label="Fat" v={total.fat} t={settings.fat_target} />
        <p className="muted small">
          Fiber {Math.round(total.fiber)} g · Sugar {Math.round(total.sugar)} g · Sodium {Math.round(total.sodium)} mg
        </p>
      </div>

      <FoodChat
        onSave={save}
        onRemove={remove}
        context={`${Math.round(total.calories)} of ${settings.calorie_target} kcal eaten; protein ${Math.round(total.protein)}/${settings.protein_target} g, carbs ${Math.round(total.carbs)}/${settings.carb_target} g, fat ${Math.round(total.fat)}/${settings.fat_target} g.`}
      />
      <AddFood onSave={save} />

      {entries.map((e) => (
        <div className="card" key={e.id}>
          <div className="row">
            <h3>{e.name}</h3>
            <button className="link danger" onClick={() => remove(e.id)}>✕</button>
          </div>
          <p className="muted small">
            {e.calories} kcal · P {Number(e.protein)} · C {Number(e.carbs)} · F {Number(e.fat)}
          </p>
        </div>
      ))}

      <Goals settings={settings} saveSettings={saveSettings} />
    </>
  )
}

function Bar({ value, max }) {
  const pct = Math.min(100, max ? (value / max) * 100 : 0)
  return (
    <div className="bar">
      <div style={{ width: pct + '%' }} className={value > max ? 'over' : ''} />
    </div>
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
      setForm({
        name: data.name ?? '',
        calories: data.calories ?? '',
        protein: data.protein ?? '',
        carbs: data.carbs ?? '',
        fat: data.fat ?? '',
        fiber: data.fiber ?? '',
        sugar: data.sugar ?? '',
        sodium: data.sodium ?? '',
      })
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
        <label>Fiber g<input type="number" inputMode="decimal" step="any" value={form.fiber} onChange={set('fiber')} /></label>
        <label>Sugar g<input type="number" inputMode="decimal" step="any" value={form.sugar} onChange={set('sugar')} /></label>
        <label>Sodium mg<input type="number" inputMode="decimal" step="any" value={form.sodium} onChange={set('sodium')} /></label>
      </div>
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
      <input type="number" inputMode="numeric" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  )
  return (
    <details className="card">
      <summary>Goals &amp; settings</summary>
      <div className="grid3">
        {field('calorie_target', 'Target kcal')}
        {field('maintenance_calories', 'Maintenance kcal')}
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
            protein_target: Number(f.protein_target) || 0,
            carb_target: Number(f.carb_target) || 0,
            fat_target: Number(f.fat_target) || 0,
          })
        }
      >
        Save goals
      </button>
      <p className="muted small">Deficit/surplus = calories eaten − maintenance (what you burn per day).</p>
    </details>
  )
}
