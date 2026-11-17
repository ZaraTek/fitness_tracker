// Local-time YYYY-MM-DD. Never toISOString(): it shifts to UTC.
export function toDateStr(d = new Date()) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(s, n) {
  const d = parseDate(s)
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

export function prettyDate(s) {
  return parseDate(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
