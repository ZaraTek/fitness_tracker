// Nutrients tracked beyond calories and macros.
// dv = FDA Daily Value for adults. kind "limit" = stay under; "goal" = aim to reach.
// `base` columns exist since the original schema; the rest come from supabase/002_micros.sql.
export const MICROS = [
  { key: 'fiber', label: 'Fiber', unit: 'g', dv: 28, kind: 'goal', base: true },
  { key: 'sugar', label: 'Sugar', unit: 'g', dv: 50, kind: 'limit', base: true },
  { key: 'sodium', label: 'Sodium', unit: 'mg', dv: 2300, kind: 'limit', base: true },
  { key: 'saturated_fat', label: 'Saturated fat', unit: 'g', dv: 20, kind: 'limit' },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg', dv: 300, kind: 'limit' },
  { key: 'potassium', label: 'Potassium', unit: 'mg', dv: 4700, kind: 'goal' },
  { key: 'calcium', label: 'Calcium', unit: 'mg', dv: 1300, kind: 'goal' },
  { key: 'iron', label: 'Iron', unit: 'mg', dv: 18, kind: 'goal' },
  { key: 'magnesium', label: 'Magnesium', unit: 'mg', dv: 420, kind: 'goal' },
  { key: 'vitamin_c', label: 'Vitamin C', unit: 'mg', dv: 90, kind: 'goal' },
  { key: 'vitamin_d', label: 'Vitamin D', unit: 'mcg', dv: 20, kind: 'goal' },
]

export const MACROS = ['calories', 'protein', 'carbs', 'fat']
export const ALL_NUMERIC = [...MACROS, ...MICROS.map((m) => m.key)]
export const BASE_NUMERIC = [...MACROS, ...MICROS.filter((m) => m.base).map((m) => m.key)]
