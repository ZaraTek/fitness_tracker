import { useEffect, useMemo, useState } from 'react'
import { supabase, explain } from '../supabase'
import { toDateStr, parseDate, addDays } from '../dates'

// Monday of the week containing `s` (YYYY-MM-DD, local time).
function weekStart(s) {
  const dow = (parseDate(s).getDay() + 6) % 7 // Mon = 0
  return addDays(s, -dow)
}

// Same rule as the daily summary: resting + active when both are known, else the set maintenance.
export function dayMaintenance(settings, active) {
  const resting = Number(settings.resting_calories) || 0
  return resting > 0 && active !== null && active !== undefined ? resting + active : settings.maintenance_calories
}

const KCAL_PER = { lb: 3500, kg: 7700 }

// Bar from the zero line to y, with only the far (data) end rounded.
function barPath(x, w, y0, y, r = 4) {
  const h = Math.abs(y - y0)
  r = Math.min(r, h, w / 2)
  if (y < y0) {
    return `M${x},${y0} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y0} Z`
  }
  return `M${x},${y0} V${y - r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y - r} V${y0} Z`
}

export default function WeekChart({ settings, refreshKey }) {
  const today = toDateStr()
  const [start, setStart] = useState(() => weekStart(today))
  const [rows, setRows] = useState({ food: {}, active: {} })
  const [picked, setPicked] = useState(null)
  const [error, setError] = useState('')
  const end = addDays(start, 6)
  const isCurrent = start === weekStart(today)

  useEffect(() => {
    let stale = false
    Promise.all([
      supabase.from('food_entries').select('date, calories').gte('date', start).lte('date', end),
      supabase.from('daily_activity').select('date, active_calories').gte('date', start).lte('date', end),
    ]).then(([f, a]) => {
      if (stale) return
      const err = f.error || a.error
      if (err) return setError(explain(err))
      setError('')
      const food = {}
      for (const r of f.data) food[r.date] = (food[r.date] || 0) + (Number(r.calories) || 0)
      const active = {}
      for (const r of a.data) active[r.date] = r.active_calories
      setRows({ food, active })
    })
    return () => {
      stale = true
    }
  }, [start, end, refreshKey])

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const date = addDays(start, i)
        const eaten = rows.food[date]
        const active = rows.active[date] ?? null
        const burn = dayMaintenance(settings, active)
        // Positive = deficit. Days with no food logged, and today (not over yet), have no value.
        const deficit = eaten === undefined || date >= today ? null : Math.round(burn - eaten)
        return { date, eaten, active, burn, deficit, future: date > today, inProgress: date === today }
      }),
    [start, rows, settings, today],
  )

  const logged = days.filter((d) => d.deficit !== null)
  const weekTotal = logged.reduce((s, d) => s + d.deficit, 0)
  const unit = settings.unit === 'kg' ? 'kg' : 'lb'
  const weight = Math.abs(weekTotal) / KCAL_PER[unit]

  // Default selection: the last finished day with food logged.
  const sel = days.find((d) => d.date === picked) ?? logged.at(-1) ?? null

  // Chart geometry. Symmetric-ish domain that always includes zero.
  const W = 320
  const H = 150
  const vals = logged.map((d) => d.deficit)
  const hi = Math.max(250, ...vals)
  const lo = Math.min(0, ...vals)
  const top = 16 // room for value labels above deficit bars
  const bottom = lo < 0 ? 38 : 24 // weekday labels, plus value labels under surplus bars
  const span = hi - lo
  const y = (v) => top + ((hi - v) / span) * (H - top - bottom)
  const y0 = y(0)
  const band = W / 7
  const bw = Math.min(28, band - 10)

  function shift(n) {
    setStart(addDays(start, n * 7))
    setPicked(null)
  }

  const fmtRange = (a, b) => {
    const o = { month: 'short', day: 'numeric' }
    return `${parseDate(a).toLocaleDateString(undefined, o)} – ${parseDate(b).toLocaleDateString(undefined, o)}`
  }

  return (
    <div className="card week">
      <div className="row datenav">
        <button className="link" onClick={() => shift(-1)} aria-label="Previous week">◀</button>
        <strong>{isCurrent ? 'This week' : fmtRange(start, end)}</strong>
        <button className="link" onClick={() => shift(1)} disabled={isCurrent} aria-label="Next week">▶</button>
      </div>
      {error && <div className="error">{error}</div>}

      <p className="small week-total">
        {logged.length === 0 ? (
          <span className="muted">No finished days logged this week yet.</span>
        ) : (
          <>
            <b className={weekTotal >= 0 ? 'good' : 'warn'}>
              {Math.abs(weekTotal).toLocaleString()} kcal {weekTotal >= 0 ? 'deficit' : 'surplus'}
            </b>{' '}
            <span className="muted">
              ≈ {weight.toFixed(1)} {unit} · {logged.length} day{logged.length === 1 ? '' : 's'} logged
            </span>
          </>
        )}
      </p>

      <svg viewBox={`0 0 ${W} ${H}`} className="chart week-chart" role="img" aria-label="Calorie deficit by day">
        {days.map((d, i) => {
          const x = i * band + (band - bw) / 2
          const on = sel?.date === d.date
          const label = parseDate(d.date).toLocaleDateString(undefined, { weekday: 'narrow' })
          return (
            <g key={d.date} className={'wk-day' + (on ? ' on' : '')} onClick={() => setPicked(d.date)}>
              {/* hit target: the whole column */}
              <rect x={i * band} y={0} width={band} height={H} fill="transparent" />
              {d.deficit !== null && d.deficit !== 0 && (
                <path
                  d={barPath(x, bw, y0, y(d.deficit))}
                  className={d.deficit > 0 ? 'wk-bar deficit' : 'wk-bar surplus'}
                />
              )}
              {(d.deficit === 0 || (d.deficit === null && !d.future && !d.inProgress)) && <circle cx={x + bw / 2} cy={y0} r={2} className="wk-empty" />}
              {d.deficit !== null && (
                <text
                  x={x + bw / 2}
                  y={d.deficit >= 0 ? y(d.deficit) - 4 : y(d.deficit) + 11}
                  className={'wk-value' + (on ? ' on' : '')}
                  textAnchor="middle"
                >
                  {d.deficit > 0 ? '−' : d.deficit < 0 ? '+' : ''}
                  {Math.abs(d.deficit)}
                </text>
              )}
              <text x={x + bw / 2} y={H - 6} className={'wk-label' + (d.date === today ? ' today' : '')} textAnchor="middle">
                {label}
              </text>
            </g>
          )
        })}
        <line x1={0} x2={W} y1={y0} y2={y0} className="wk-zero" />
      </svg>

      {sel && (
        <p className="small muted wk-detail">
          <b className="plain">{parseDate(sel.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</b>
          {' · '}
          {sel.deficit === null ? (
            sel.future ? (
              'upcoming'
            ) : sel.inProgress ? (
              `in progress${sel.eaten !== undefined ? ` · ${Math.round(sel.eaten)} eaten so far` : ''} · counts once the day is over`
            ) : (
              'nothing logged'
            )
          ) : (
            <>
              ate {Math.round(sel.eaten)} · burned {sel.burn}
              {sel.active !== null && Number(settings.resting_calories) > 0 && ` (${settings.resting_calories} + ${sel.active} active)`}
              {' · '}
              <b className={sel.deficit >= 0 ? 'good' : 'warn'}>
                {Math.abs(sel.deficit)} {sel.deficit >= 0 ? 'deficit' : 'surplus'}
              </b>
            </>
          )}
        </p>
      )}
      <p className="muted small wk-key">
        <span className="swatch deficit" /> deficit <span className="swatch surplus" /> surplus · tap a day for details
      </p>
    </div>
  )
}
