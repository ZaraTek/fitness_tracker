import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && key)
export const supabase = isConfigured ? createClient(url, key) : null

// Friendly message for missing tables/columns (migration not run yet).
export function explain(error) {
  if (!error) return ''
  if (['PGRST205', '42703', '42P01'].includes(error.code)) {
    return 'Database is out of date: run supabase/schema.sql in the Supabase SQL Editor.'
  }
  return error.message
}
