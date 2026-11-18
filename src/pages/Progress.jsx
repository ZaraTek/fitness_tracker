import { useCallback, useEffect, useState } from 'react'
import { supabase, explain } from '../supabase'
import { toDateStr, prettyDate, parseDate } from '../dates'
import { photoTakenDate } from '../exif'

const BUCKET = 'progress-photos'

function resizeToBlob(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      c.toBlob((b) => (b ? resolve(b) : reject(new Error('Resize failed'))), 'image/jpeg', 0.85)
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => reject(new Error('Could not read that image'))
    img.src = URL.createObjectURL(file)
  })
}

export default function Progress({ settings, user }) {
  const [weighIns, setWeighIns] = useState([])
  const [photos, setPhotos] = useState([])
  const [urls, setUrls] = useState({})
  const [error, setError] = useState('')
  const [date, setDate] = useState(toDateStr())
  const [weight, setWeight] = useState('')
  const [staged, setStaged] = useState(null) // { file, url, date, detected }
  const [uploading, setUploading] = useState(false)
  const unit = settings.unit

  const load = useCallback(async () => {
    const [w, p] = await Promise.all([
      supabase.from('weigh_ins').select('*').order('date'),
      supabase.from('progress_photos').select('*').order('date', { ascending: false }),
    ])
    if (w.error || p.error) return setError(explain(w.error || p.error))
    setError('')
    setWeighIns(w.data)
    setPhotos(p.data)
    if (p.data.length) {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrls(
        p.data.map((x) => x.path),
        3600,
      )
      setUrls(Object.fromEntries((data ?? []).map((d) => [d.path, d.signedUrl])))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function addWeight(e) {
    e.preventDefault()
    const { error } = await supabase
      .from('weigh_ins')
      .upsert({ date, weight: Number(weight) }, { onConflict: 'user_id,date' })
    if (error) return setError(explain(error))
    setWeight('')
    load()
  }

  async function removeWeight(id) {
    const { error } = await supabase.from('weigh_ins').delete().eq('id', id)
    if (error) return setError(explain(error))
    setWeighIns((w) => w.filter((x) => x.id !== id))
  }

  // Pick a photo: read its taken-on date, then let the user confirm before uploading.
  async function pick(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    const found = await photoTakenDate(file)
    const date = found && found <= toDateStr() ? found : null
    if (staged) URL.revokeObjectURL(staged.url)
    setStaged({ file, url: URL.createObjectURL(file), date: date ?? toDateStr(), detected: Boolean(date) })
  }

  function cancelStaged() {
    if (staged) URL.revokeObjectURL(staged.url)
    setStaged(null)
  }

  async function upload() {
    if (!staged) return
    setUploading(true)
    try {
      const blob = await resizeToBlob(staged.file)
      const path = `${user.id}/${crypto.randomUUID()}.jpg`
      const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
      if (up.error) throw up.error
      const { error } = await supabase.from('progress_photos').insert({ date: staged.date, path })
      if (error) throw error
      cancelStaged()
      await load()
    } catch (err) {
      setError(explain(err))
    }
    setUploading(false)
  }

  async function removePhoto(p) {
    if (!confirm('Delete this photo?')) return
    await supabase.storage.from(BUCKET).remove([p.path])
    const { error } = await supabase.from('progress_photos').delete().eq('id', p.id)
    if (error) return setError(explain(error))
    setPhotos((x) => x.filter((y) => y.id !== p.id))
  }

  const first = weighIns[0]
  const last = weighIns[weighIns.length - 1]

  return (
    <>
      {error && <div className="error">{error}</div>}

      <form className="card" onSubmit={addWeight}>
        <h3>Weigh-in</h3>
        <div className="row">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value || toDateStr())} />
          <input
            type="number"
            inputMode="decimal"
            step="any"
            placeholder={unit}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            required
          />
          <button className="primary">Save</button>
        </div>
        {last && (
          <p className="muted small">
            Latest: <b>{Number(last.weight)} {unit}</b>
            {first !== last && (
              <> · change since {prettyDate(first.date)}: {(last.weight - first.weight > 0 ? '+' : '') + (last.weight - first.weight).toFixed(1)} {unit}</>
            )}
          </p>
        )}
        <WeightChart data={weighIns} />
        <details>
          <summary className="muted small">History</summary>
          {[...weighIns].reverse().map((w) => (
            <div className="row set-row" key={w.id}>
              <span>{prettyDate(w.date)}</span>
              <span>{Number(w.weight)} {unit}</span>
              <button type="button" className="link danger" onClick={() => removeWeight(w.id)}>✕</button>
            </div>
          ))}
        </details>
      </form>

      <div className="card">
        <div className="row">
          <h3>Photos</h3>
          <label className="primary file-btn">
            {staged ? 'Change photo' : '+ Add photo'}
            <input type="file" accept="image/*" hidden disabled={uploading} onChange={pick} />
          </label>
        </div>
        {staged ? (
          <div className="staged">
            <img src={staged.url} alt="Selected progress photo" />
            <div className="staged-form">
              <label>
                Photo date
                <input
                  type="date"
                  value={staged.date}
                  max={toDateStr()}
                  onChange={(e) => setStaged({ ...staged, date: e.target.value || toDateStr(), detected: false })}
                />
              </label>
              <p className="muted small">
                {staged.detected
                  ? 'Date read from the photo. Change it if it’s wrong.'
                  : 'No date found in the photo, so it’s set to today. Change it if needed.'}
              </p>
              <div className="row">
                <button className="primary" onClick={upload} disabled={uploading}>
                  {uploading ? 'Uploading…' : 'Upload'}
                </button>
                <button className="link" onClick={cancelStaged} disabled={uploading}>Cancel</button>
              </div>
            </div>
          </div>
        ) : (
          <p className="muted small">The date is read from the photo when it has one. Private to your account.</p>
        )}
        <div className="gallery">
          {photos.map((p) => (
            <figure key={p.id}>
              {urls[p.path] ? <img src={urls[p.path]} alt={`Progress ${p.date}`} loading="lazy" /> : <div className="ph" />}
              <figcaption>
                {prettyDate(p.date)}
                <button className="link danger" onClick={() => removePhoto(p)}>✕</button>
              </figcaption>
            </figure>
          ))}
        </div>
        {!photos.length && <p className="muted center">No photos yet.</p>}
      </div>
    </>
  )
}

function WeightChart({ data }) {
  if (data.length < 2) return <p className="muted small">Add two or more weigh-ins to see a chart.</p>
  const W = 320, H = 140, P = 24
  const xs = data.map((d) => parseDate(d.date).getTime())
  const ys = data.map((d) => Number(d.weight))
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const y0 = Math.min(...ys) - 1, y1 = Math.max(...ys) + 1
  const sx = (x) => P + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * P)
  const sy = (y) => H - P - ((y - y0) / (y1 - y0 || 1)) * (H - 2 * P)
  const pts = data.map((_, i) => `${sx(xs[i])},${sy(ys[i])}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Weight over time">
      <text x={4} y={sy(y1) + 4} className="axis">{y1.toFixed(0)}</text>
      <text x={4} y={sy(y0) + 4} className="axis">{y0.toFixed(0)}</text>
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" />
      {data.map((_, i) => (
        <circle key={i} cx={sx(xs[i])} cy={sy(ys[i])} r="3" fill="var(--accent)" />
      ))}
    </svg>
  )
}
