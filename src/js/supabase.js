/**
 * MotoMatch — Supabase-Client
 *
 * Wenn VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY gesetzt sind, wird
 * ein echter Supabase-Client exportiert. Andernfalls wird OFFLINE_MODE = true
 * und alle API-Aufrufe fallen auf localStorage zurück.
 */
import { createClient } from '@supabase/supabase-js'

const url  = import.meta.env.VITE_SUPABASE_URL  || ''
const key  = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const OFFLINE_MODE = !url || !key

export const supabase = OFFLINE_MODE
  ? null
  : createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    })

if (OFFLINE_MODE) {
  console.info('[MotoMatch] Kein Supabase konfiguriert — Demo-Modus (localStorage).')
}
