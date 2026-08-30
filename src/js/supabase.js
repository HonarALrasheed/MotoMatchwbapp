/**
 * MotoMatch — Supabase-Client
 *
 * Wenn VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY gesetzt sind, wird
 * ein echter Supabase-Client exportiert. Andernfalls wird OFFLINE_MODE = true
 * und alle API-Aufrufe fallen auf localStorage zurück.
 *
 * ACHTUNG: Der Demo-Modus ist ausschließlich für die lokale Entwicklung.
 * Er hält alle Daten im localStorage — ohne Server, ohne echte Auth. In einem
 * Produktions-Build wäre er kein brauchbarer Fallback, sondern eine stille
 * Fehlfunktion: die App sähe funktionsfähig aus, während jeder Besucher in
 * seiner eigenen leeren Sandbox säße. Deshalb bricht der Build unten ab,
 * statt in den Demo-Modus zu rutschen.
 */
import { createClient } from '@supabase/supabase-js'

const url  = import.meta.env.VITE_SUPABASE_URL  || ''
const key  = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const OFFLINE_MODE = !url || !key

if (OFFLINE_MODE && import.meta.env.PROD) {
  const msg = 'MotoMatch: VITE_SUPABASE_URL und/oder VITE_SUPABASE_ANON_KEY fehlen. '
    + 'Ein Produktions-Build darf nicht in den localStorage-Demo-Modus fallen. '
    + 'Variablen in Vercel für ALLE Umgebungen setzen (Production, Preview, Development) '
    + 'und neu deployen.'
  // Ein throw allein wäre für einen Menschen eine weiße Seite — die Meldung
  // muss auch sichtbar sein, sonst ist "laut scheitern" nur laut in der Konsole.
  try {
    const box = document.createElement('pre')
    box.setAttribute('role', 'alert')
    box.style.cssText = 'position:fixed;inset:0;z-index:99999;margin:0;padding:24px;'
      + 'background:#1b1b1b;color:#ff8a80;font:14px/1.6 ui-monospace,monospace;'
      + 'white-space:pre-wrap;overflow:auto'
    box.textContent = msg
    ;(document.body || document.documentElement).appendChild(box)
  } catch {}
  throw new Error(msg)
}

export const supabase = OFFLINE_MODE
  ? null
  : createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    })

if (OFFLINE_MODE) {
  console.info('[MotoMatch] Kein Supabase konfiguriert — Demo-Modus (localStorage).')
}
