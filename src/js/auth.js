/**
 * ══════════════════════════════════════════════════════════════════
 *  MotoMatch — Zentrale Authentifizierung (Shared Auth)
 *
 *  EINE User-Datenbank + EINE Session für die gesamte Plattform.
 *  Online:  Supabase Auth (E-Mail + Passwort, signUp/signInWithPassword)
 *  Offline: localStorage-Fallback (Demo-Modus ohne Supabase-Keys)
 *
 *  getSession() ist IMMER synchron (liest aus Cache).
 *  login() / register() / logout() sind async.
 * ══════════════════════════════════════════════════════════════════
 */

import { supabase, OFFLINE_MODE } from './supabase.js'
import { initCommunityData, unsubscribeAll, setMyProfile } from './community-api.js'

const LS_USERS   = 'mm_auth_users_v1'    // [{ username, password, name, email, bio, avatar, joinedAt, notif, theme, provider }]
const LS_SESSION = 'mm_auth_session_v1'  // { username } | { username:'Gast', guest:true } | null
const LS_GUEST   = 'mm_auth_guest_v1'    // Profil-Overrides für Gast
const LS_ONLINE_PROFILES = 'mm_auth_online_profiles_v1'  // { [uid]: Profil-Overrides } für Supabase-User (Felder ohne DB-Spalte, z. B. Avatar/Bio/Alter)

/* ── Supabase-Session-Cache (sync-lesbar) ─────────────────────────
   Wird durch onAuthStateChange und initSupabaseAuth() befüllt.
   Solange null, ist niemand angemeldet (oder Supabase noch am Init). */
let _sbSession = null  // { username, uid } | { username:'Gast', guest:true } | null

/* Während register() legt bereits der Aufrufer selbst das Profil an —
   der onAuthStateChange-Listener soll in dem Fenster nicht parallel
   ein zweites (kollidierendes) Profil anlegen. */
let _registering = false

/**
 * Muss einmal beim App-Start aufgerufen werden (OFFLINE_MODE-agnostisch).
 * Gibt die initiale Session zurück (oder null) und registriert den
 * Auth-State-Listener für spätere Änderungen (Token-Refresh, Sign-Out).
 */
export async function initSupabaseAuth() {
  if (OFFLINE_MODE) {
    const s = read(LS_SESSION, null)
    if (s) {
      _sbSession = s
      const uid = null
      const username = s.guest ? 'Gast' : s.username
      await initCommunityData(uid, username)
    }
    return _sbSession
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (session) {
    await _onSignedIn(session)
    notify()
  }

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      if (_registering) return // register() ruft _onSignedIn() selbst auf, nachdem das Profil steht
      await _onSignedIn(session)
      notify()
    } else if (event === 'SIGNED_OUT') {
      _sbSession = null
      unsubscribeAll()
      notify()
    } else if (event === 'TOKEN_REFRESHED' && session) {
      // keep _sbSession uid current
      if (_sbSession) _sbSession.uid = session.user.id
    }
  })

  return _sbSession
}

async function _onSignedIn(session) {
  const uid = session.user.id
  const { data: profile } = await supabase.from('profiles').select('username').eq('id', uid).maybeSingle()
  let username = profile?.username
  if (!username) {
    // Neuer Social-Login-User: Username aus E-Mail ableiten und Profil anlegen
    const base = (session.user.email || uid).split('@')[0].replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 30)
    username = base || `user_${uid.slice(0, 8)}`
    // Eindeutigkeit sicherstellen
    const { data: conflict } = await supabase.from('profiles').select('id').eq('username', username).maybeSingle()
    if (conflict) username = `${username}_${uid.slice(0, 4)}`
    await supabase.from('profiles').insert({ id: uid, username })
  }
  _sbSession = { username, uid }
  // Beitrittsdatum einmalig aus der Auth-Session übernehmen (auth.users.created_at)
  const overrides = read(LS_ONLINE_PROFILES, {})
  if (!overrides[uid]) {
    overrides[uid] = { joinedAt: session.user.created_at ? new Date(session.user.created_at).getTime() : Date.now() }
    write(LS_ONLINE_PROFILES, overrides)
  }
  await initCommunityData(uid, username)
}

/* ── Social Login (Google / Apple) ────────────────────────────────
   Client-IDs kommen aus .env (VITE_GOOGLE_CLIENT_ID / VITE_APPLE_CLIENT_ID).
   Ohne echte, in der jeweiligen Entwicklerkonsole registrierte Client-ID
   funktioniert der jeweilige Button nicht — das ist von Google/Apple aus
   nicht anders möglich (siehe Hinweise am Ende der Konversation). */
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
const APPLE_CLIENT_ID = import.meta.env.VITE_APPLE_CLIENT_ID || ''

function loadScriptOnce(src, id) {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) return resolve()
    const s = document.createElement('script')
    s.id = id
    s.src = src
    s.async = true
    s.defer = true
    s.onload = resolve
    s.onerror = () => reject(new Error(`Skript konnte nicht geladen werden: ${src}`))
    document.head.appendChild(s)
  })
}

/** JWT-Payload clientseitig dekodieren (nur zum Auslesen von email/name — keine Verifizierung!). */
function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(decodeURIComponent(atob(base64).split('').map(c =>
      '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')))
  } catch { return {} }
}

/** Legt bei Bedarf ein lokales Konto für einen Social-Login-Nutzer an und meldet ihn an. */
function loginOrRegisterFromProvider(provider, { sub, email, name, avatar }) {
  const username = `${provider}_${sub}`.slice(0, 40)
  const users = getUsers()
  let u = users.find(x => x.username === username)
  if (!u) {
    u = { ...DEFAULT_PROFILE, username, password: null, provider, name: name || email || username, email: email || '', avatar: avatar || null, joinedAt: Date.now() }
    users.push(u)
    saveUsers(users)
  }
  setSessionRaw({ username: u.username })
  notify()
  return { ok: true, user: u }
}

/**
 * Rendert einen "Mit Google anmelden"-Button, der Supabase OAuth nutzt.
 * Supabase übernimmt den kompletten Redirect-Flow; kein Google-Script nötig.
 * Nach dem Callback feuert onAuthStateChange → _onSignedIn → notify().
 */
export function renderGoogleButton(container, onDone, _theme) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'p-auth-google-btn'
  btn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
      <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 6.294C4.672 4.169 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
    Weiter mit Google`
  btn.addEventListener('click', async () => {
    btn.disabled = true
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    })
    if (error) {
      btn.disabled = false
      const errEl = document.getElementById('mm-am-error')
      if (errEl) { errEl.textContent = error.message; errEl.removeAttribute('hidden') }
    }
    // Bei Erfolg: Supabase leitet weiter → onAuthStateChange feuert nach Rückkehr
  })
  container.innerHTML = ''
  container.appendChild(btn)
}

/**
 * Startet den "Mit Apple anmelden"-Flow über Sign in with Apple JS.
 * Erfordert eine echte Services-ID (siehe VITE_APPLE_CLIENT_ID) mit
 * verifizierter Domain im Apple Developer Portal — funktioniert NICHT
 * auf localhost, nur auf einer echten, dort hinterlegten Domain.
 */
export async function loginWithApple(onDone, onError) {
  if (!APPLE_CLIENT_ID) {
    if (onError) onError('Apple-Login noch nicht eingerichtet (VITE_APPLE_CLIENT_ID fehlt).')
    return
  }
  try {
    await loadScriptOnce('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js', 'mm-apple-jsapi')
    window.AppleID.auth.init({
      clientId: APPLE_CLIENT_ID,
      scope: 'name email',
      redirectURI: window.location.origin,
      usePopup: true,
    })
    const res = await window.AppleID.auth.signIn()
    const payload = decodeJwtPayload(res.authorization.id_token)
    const name = res.user ? `${res.user.name?.firstName || ''} ${res.user.name?.lastName || ''}`.trim() : ''
    loginOrRegisterFromProvider('apple', { sub: payload.sub, email: payload.email, name })
    if (typeof onDone === 'function') onDone()
  } catch (err) {
    if (onError) onError('Apple-Login fehlgeschlagen oder abgebrochen.')
  }
}

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)) } catch {} }

/* ── Pub/Sub ───────────────────────────────────────────────────── */
const listeners = new Set()
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
function notify() {
  const s = getSession()
  listeners.forEach(fn => { try { fn(s) } catch {} })
  try { window.dispatchEvent(new CustomEvent('mm:auth-changed', { detail: s })) } catch {}
}

/* ── State ─────────────────────────────────────────────────────── */
export function getUsers() { return read(LS_USERS, []) }
function saveUsers(u) { write(LS_USERS, u) }

/**
 * Synchrone Session — liest im Online-Modus aus dem In-Memory-Cache,
 * im Offline-Modus aus localStorage.
 */
export function getSession() {
  if (!OFFLINE_MODE) return _sbSession
  return read(LS_SESSION, null)
}

function setSessionRaw(s) {
  if (s) write(LS_SESSION, s)
  else { try { localStorage.removeItem(LS_SESSION) } catch {} }
}
export function isLoggedIn() { return !!getSession() }

/** Alle registrierten Benutzernamen (ohne Passwörter) — für Suche/Freund-hinzufügen. */
export function listUsernames() { return getUsers().map(u => u.username) }

/** Exakte Nutzersuche nach Benutzername (case-insensitive). Gibt {username} oder null zurück. */
export function findUserByUsername(username) {
  const u = getUsers().find(x => x.username.toLowerCase() === (username || '').trim().toLowerCase())
  return u ? { username: u.username } : null
}

/** Name/Avatar/Bio eines beliebigen Nutzers (nur Offline-Modus, dort liegt die volle User-DB lokal vor). */
export function getUserRecord(username) {
  const u = getUsers().find(x => x.username.toLowerCase() === (username || '').trim().toLowerCase())
  return u ? { name: u.name || u.username, avatar: u.avatar || null, bio: u.bio } : null
}

/** Live-Suche: Benutzernamen, die mit query beginnen/enthalten (max. 8 Treffer). */
export function searchUsers(query, { exclude = [] } = {}) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return []
  const excl = new Set(exclude.map(x => x.toLowerCase()))
  return getUsers()
    .map(u => u.username)
    .filter(name => !excl.has(name.toLowerCase()) && name.toLowerCase().includes(q))
    .sort((a, b) => a.toLowerCase().indexOf(q) - b.toLowerCase().indexOf(q))
    .slice(0, 8)
}

const DEFAULT_PROFILE = {
  name: '', email: '', bio: 'Motorradfahrer · MotoMatch 🏍', avatar: null,
  age: null, license: '',
  joinedAt: 0, notif: { events: true, community: true, gear: false }, theme: 'dark',
}

/** Vollständiger Datensatz des aktuell angemeldeten Nutzers (oder null). */
export function currentUser() {
  const s = getSession(); if (!s) return null
  if (s.guest) return { username: 'Gast', guest: true, ...DEFAULT_PROFILE, name: 'Gast', joinedAt: Date.now(), ...read(LS_GUEST, {}) }
  const u = getUsers().find(x => x.username.toLowerCase() === s.username.toLowerCase())
  if (u) return { ...DEFAULT_PROFILE, ...u, name: u.name || u.username }
  // Online-Modus: User ist in Supabase, nicht im lokalen Store → Basis-Profil aus Session
  // + lokale Overrides für Felder ohne DB-Spalte (Avatar, Bio, Alter, Notif-Einstellungen, …)
  if (!OFFLINE_MODE && s.username) {
    const overrides = s.uid ? read(LS_ONLINE_PROFILES, {})[s.uid] : null
    return { ...DEFAULT_PROFILE, username: s.username, name: s.username, ...overrides }
  }
  return null
}

/* ── Aktionen ──────────────────────────────────────────────────── */

/**
 * Login per Benutzername ODER E-Mail-Adresse.
 * Im Online-Modus: Supabase signInWithPassword (erwartet E-Mail).
 * Im Offline-Modus: lokaler localStorage-Check.
 */
export async function login(identifier, password) {
  identifier = (identifier || '').trim()
  if (identifier.length < 2) return { ok: false, error: 'Benutzername oder E-Mail ist zu kurz.' }

  if (!OFFLINE_MODE) {
    // Benutzername → E-Mail nachschlagen (per RPC, da profiles keine E-Mail-Spalte hat)
    let email = identifier
    if (!identifier.includes('@')) {
      const { data: resolvedEmail } = await supabase.rpc('email_for_username', { uname: identifier })
      if (!resolvedEmail) return { ok: false, error: 'Kein Konto mit diesem Benutzernamen gefunden.' }
      email = resolvedEmail
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session) {
      // Zweiter Versuch: Identifier könnte Benutzername sein, Auth braucht E-Mail
      return { ok: false, error: 'Zugangsdaten oder Passwort sind falsch.' }
    }
    // _sbSession wird durch onAuthStateChange gesetzt, aber wir setzen es sofort
    await _onSignedIn(data.session)
    notify()
    return { ok: true, user: { username: _sbSession?.username } }
  }

  // Offline-Modus
  const id = identifier.toLowerCase()
  const u = getUsers().find(x => x.username.toLowerCase() === id || (x.email && x.email.toLowerCase() === id))
  if (!u || u.password !== password) return { ok: false, error: 'Zugangsdaten oder Passwort sind falsch.' }
  _sbSession = { username: u.username }
  setSessionRaw({ username: u.username }); notify()
  await initCommunityData(null, u.username)
  return { ok: true, user: u }
}

/**
 * Registrierung.
 * Im Online-Modus: Supabase signUp + Profil-Zeile anlegen.
 * Im Offline-Modus: localStorage.
 */
export async function register({ username, password, password2, email = '', age = '', license = '' }) {
  username = (username || '').trim()
  email    = (email || '').trim()
  if (username.length < 2) return { ok: false, error: 'Benutzername ist zu kurz.' }
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: 'Bitte eine gültige E-Mail-Adresse angeben.' }
  if ((password || '').length < 4) return { ok: false, error: 'Passwort muss mindestens 4 Zeichen haben.' }
  if (password2 !== undefined && password !== password2) return { ok: false, error: 'Passwörter stimmen nicht überein.' }

  if (!OFFLINE_MODE) {
    // Prüfen ob Username bereits vergeben (profiles-Tabelle)
    const { data: existing } = await supabase
      .from('profiles').select('id').ilike('username', username).maybeSingle()
    if (existing) return { ok: false, error: 'Dieser Benutzername ist bereits vergeben.' }

    _registering = true
    try {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) {
        if (error.message.includes('already registered'))
          return { ok: false, error: 'Diese E-Mail-Adresse wird bereits verwendet.' }
        return { ok: false, error: error.message }
      }
      const uid = data.user?.id
      if (!uid) return { ok: false, error: 'Registrierung fehlgeschlagen.' }

      // Session setzen, damit auth.uid() für die RLS-Policy verfügbar ist
      if (data.session) await supabase.auth.setSession(data.session)

      // Profil anlegen
      const { error: profErr } = await supabase.from('profiles').insert({
        id: uid, username, bio: DEFAULT_PROFILE.bio,
      })
      if (profErr) {
        if (profErr.message.includes('unique')) return { ok: false, error: 'Dieser Benutzername ist bereits vergeben.' }
        return { ok: false, error: profErr.message }
      }

      if (data.session) {
        await _onSignedIn(data.session)
        notify()
      }
      return { ok: true, user: { username } }
    } finally {
      _registering = false
    }
  }

  // Offline-Modus
  const users = getUsers()
  if (users.some(x => x.username.toLowerCase() === username.toLowerCase()))
    return { ok: false, error: 'Dieser Benutzername ist bereits vergeben.' }
  if (email && users.some(x => x.email && x.email.toLowerCase() === email.toLowerCase()))
    return { ok: false, error: 'Diese E-Mail-Adresse wird bereits verwendet.' }
  const user = { ...DEFAULT_PROFILE, username, password, name: username, email, age: age ? parseInt(age) : null, license, joinedAt: Date.now() }
  users.push(user); saveUsers(users)
  _sbSession = { username }
  setSessionRaw({ username }); notify()
  await initCommunityData(null, username)
  return { ok: true, user }
}

/** Gast-Login (bleibt rein lokal — kein Supabase-Konto). */
export async function loginGuest() {
  _sbSession = { username: 'Gast', guest: true }
  setSessionRaw({ username: 'Gast', guest: true })
  await initCommunityData(null, 'Gast')
  notify()
}

/**
 * Legt Demo-Nutzer im Hintergrund an (falls noch nicht vorhanden) — OHNE die
 * aktuelle Session zu verändern. Nur für lokale Entwicklung/Vorführung, damit
 * Übersichten (Freunde, Suche …) nicht komplett leer aussehen.
 */
export function ensureDemoUsers(list) {
  const users = getUsers()
  let changed = false
  list.forEach(({ username, name, bio }) => {
    if (users.some(x => x.username.toLowerCase() === username.toLowerCase())) return
    users.push({ ...DEFAULT_PROFILE, username, password: 'demo1234', name: name || username, bio: bio || DEFAULT_PROFILE.bio, joinedAt: Date.now() })
    changed = true
  })
  if (changed) saveUsers(users)
}

export async function logout() {
  _sbSession = null
  unsubscribeAll()
  setSessionRaw(null)
  notify()
  if (!OFFLINE_MODE) await supabase.auth.signOut()
}

/** Profilfelder des aktuellen Nutzers aktualisieren (Name, Bio, E-Mail …). */
export function updateProfile(patch) {
  const s = getSession(); if (!s) return
  if (s.guest) { write(LS_GUEST, { ...read(LS_GUEST, {}), ...patch }); notify(); return }

  // Name/Bio/Avatar sind dieselbe Identität wie im Community-Profil (dort als
  // displayName/bio/avatarImg gecacht) — hier spiegeln, sonst zeigt die Community
  // weiterhin den rohen Benutzernamen statt des im Konto gesetzten Namens.
  const commPatch = {}
  if ('name'   in patch) commPatch.displayName = patch.name
  if ('bio'    in patch) commPatch.bio = patch.bio
  if ('avatar' in patch) commPatch.avatarImg = patch.avatar
  if (Object.keys(commPatch).length) setMyProfile(commPatch)

  if (!OFFLINE_MODE && s.uid) {
    const all = read(LS_ONLINE_PROFILES, {})
    all[s.uid] = { ...all[s.uid], ...patch }
    write(LS_ONLINE_PROFILES, all)
    notify()
    return
  }
  const users = getUsers()
  const u = users.find(x => x.username.toLowerCase() === s.username.toLowerCase())
  if (u) { Object.assign(u, patch); saveUsers(users); notify() }
}

/** Benutzernamen des aktuellen Nutzers ändern (inkl. Session-Update). */
export async function changeUsername(newUsername) {
  const s = getSession(); if (!s || s.guest) return { ok: false, error: 'Als Gast nicht möglich.' }
  newUsername = (newUsername || '').trim()
  if (newUsername.length < 2) return { ok: false, error: 'Benutzername ist zu kurz.' }
  if (newUsername.toLowerCase() === s.username.toLowerCase()) return { ok: true }

  if (!OFFLINE_MODE) {
    const { data: existing } = await supabase.from('profiles').select('id').ilike('username', newUsername).maybeSingle()
    if (existing) return { ok: false, error: 'Dieser Benutzername ist bereits vergeben.' }
    const { error } = await supabase.from('profiles').update({ username: newUsername }).eq('id', s.uid)
    if (error) return { ok: false, error: error.message.includes('unique') ? 'Dieser Benutzername ist bereits vergeben.' : error.message }
    _sbSession = { ...s, username: newUsername }
    notify()
    return { ok: true }
  }

  const users = getUsers()
  if (users.some(x => x.username.toLowerCase() === newUsername.toLowerCase()))
    return { ok: false, error: 'Dieser Benutzername ist bereits vergeben.' }
  const u = users.find(x => x.username.toLowerCase() === s.username.toLowerCase())
  if (!u) return { ok: false, error: 'Nutzer nicht gefunden.' }
  u.username = newUsername
  saveUsers(users)
  setSessionRaw({ username: newUsername })
  notify()
  return { ok: true }
}

/** Passwort des aktuellen Nutzers ändern (prüft das aktuelle Passwort). */
export async function changePassword(currentPassword, newPassword) {
  const s = getSession(); if (!s || s.guest) return { ok: false, error: 'Als Gast nicht möglich.' }
  if ((newPassword || '').length < 4) return { ok: false, error: 'Neues Passwort muss mindestens 4 Zeichen haben.' }

  if (!OFFLINE_MODE) {
    // Aktuelles Passwort über einen Re-Login-Versuch verifizieren
    const { data: { user } } = await supabase.auth.getUser()
    const email = user?.email
    if (!email) return { ok: false, error: 'Dieses Konto ist über Google verknüpft — kein lokales Passwort.' }
    const { error: verifyErr } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
    if (verifyErr) return { ok: false, error: 'Aktuelles Passwort ist falsch.' }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  const users = getUsers()
  const u = users.find(x => x.username.toLowerCase() === s.username.toLowerCase())
  if (!u) return { ok: false, error: 'Nutzer nicht gefunden.' }
  if (u.password === null) return { ok: false, error: 'Dieses Konto ist über Google verknüpft — kein lokales Passwort.' }
  if (u.password !== currentPassword) return { ok: false, error: 'Aktuelles Passwort ist falsch.' }
  u.password = newPassword
  saveUsers(users)
  return { ok: true }
}

/** Konto endgültig löschen (Nutzer aus der DB entfernen + abmelden). */
export async function deleteAccount() {
  const s = getSession(); if (!s || s.guest) return { ok: false, error: 'Als Gast nicht möglich.' }

  if (!OFFLINE_MODE) {
    // Echtes Löschen des auth.users-Datensatzes erfordert den Supabase Service-Role-Key
    // (Admin-API) und ist im Frontend aus Sicherheitsgründen nicht möglich — noch kein
    // Backend-Endpunkt dafür vorhanden. Bis dahin: nur abmelden, ehrlich fehlschlagen.
    await logout()
    return { ok: false, error: 'Konto-Löschung ist in der Beta noch nicht verfügbar. Du wurdest abgemeldet — bitte kontaktiere uns, falls dein Konto entfernt werden soll.' }
  }

  const users = getUsers().filter(x => x.username.toLowerCase() !== s.username.toLowerCase())
  saveUsers(users)
  setSessionRaw(null)
  notify()
  return { ok: true }
}

/* Tab-übergreifende Synchronisation */
try {
  window.addEventListener('storage', e => {
    if (e.key === LS_SESSION || e.key === LS_USERS || e.key === LS_GUEST) notify()
  })
} catch {}

/* ══════════════════════════════════════════════════════════════════
   GEMEINSAMER LOGIN-DIALOG (für die Haupt-Website / Konto)
   Nutzt dieselbe Auth wie die Community — keine zweite Passwort-Eingabe.
   ══════════════════════════════════════════════════════════════════ */
function esc(s = '') {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
export function openAuthModal(onDone) {
  if (document.getElementById('mm-authmodal')) return
  let mode = 'login'
  const overlay = document.createElement('div')
  overlay.id = 'mm-authmodal'
  overlay.className = 'p-auth-overlay'
  document.body.appendChild(overlay)

  const close = (done) => {
    overlay.classList.remove('p-auth-overlay--open')
    setTimeout(() => overlay.remove(), 200)
    if (done && typeof onDone === 'function') onDone()
  }

  const render = (error = '') => {
    const isLogin = mode === 'login'
    overlay.innerHTML = `
      <div class="p-auth-backdrop" id="mm-am-backdrop"></div>
      <div class="p-auth-card">
        <div class="p-auth-brand">MOTOMATCH</div>
        <h3 class="p-auth-title">${isLogin ? 'Willkommen zurück' : 'Konto erstellen'}</h3>
        <p class="p-auth-sub">${isLogin ? 'Melde dich an — gilt für die ganze Plattform.' : 'Ein Konto für Website und Community.'}</p>

        <div id="mm-am-google-btn" class="p-auth-google-slot"></div>
        <div class="p-auth-divider"><span>oder</span></div>

        <form id="mm-am-form" autocomplete="off">
          <label class="p-auth-field">
            <span class="p-auth-label">${isLogin ? 'Benutzername oder E-Mail' : 'Benutzername'}</span>
            <input class="p-auth-input" id="mm-am-user" type="text" maxlength="60" placeholder="${isLogin ? 'z. B. RiderMax oder du@mail.de' : 'z. B. RiderMax'}" required>
          </label>
          ${isLogin ? '' : `
          <label class="p-auth-field">
            <span class="p-auth-label">E-Mail</span>
            <input class="p-auth-input" id="mm-am-email" type="email" placeholder="du@mail.de" required>
          </label>`}
          <label class="p-auth-field">
            <span class="p-auth-label">Passwort</span>
            <input class="p-auth-input" id="mm-am-pass" type="password" minlength="4" placeholder="••••••••" required>
          </label>
          ${isLogin ? '' : `
          <label class="p-auth-field">
            <span class="p-auth-label">Passwort bestätigen</span>
            <input class="p-auth-input" id="mm-am-pass2" type="password" minlength="4" placeholder="••••••••" required>
          </label>
          <div class="p-auth-field-row">
            <label class="p-auth-field">
              <span class="p-auth-label">Alter</span>
              <input class="p-auth-input" id="mm-am-age" type="number" min="14" max="99" placeholder="z. B. 28">
            </label>
            <label class="p-auth-field">
              <span class="p-auth-label">Führerschein</span>
              <select class="p-auth-input" id="mm-am-license">
                <option value="">Keine Angabe</option>
                <option value="A1">A1 — max. 125cc</option>
                <option value="A2">A2 — max. 35kW</option>
                <option value="A">A — Unbegrenzt</option>
                <option value="B196">B196 — 125cc ab 25</option>
              </select>
            </label>
          </div>`}
          <div class="p-auth-error" id="mm-am-error" ${error ? '' : 'hidden'}>${esc(error)}</div>
          <div class="p-auth-actions">
            <button type="button" class="p-auth-cancel" id="mm-am-cancel">Abbrechen</button>
            <button type="submit" class="p-auth-submit">${isLogin ? 'Anmelden' : 'Registrieren'}</button>
          </div>
        </form>
        <p class="p-auth-switch">
          ${isLogin ? 'Noch kein Konto?' : 'Bereits registriert?'}
          <button type="button" class="p-auth-toggle" id="mm-am-toggle">${isLogin ? 'Registrieren' : 'Anmelden'}</button>
        </p>
      </div>`

    overlay.querySelector('#mm-am-backdrop').addEventListener('click', () => close(false))
    overlay.querySelector('#mm-am-cancel').addEventListener('click', () => close(false))
    overlay.querySelector('#mm-am-toggle').addEventListener('click', () => { mode = isLogin ? 'register' : 'login'; render() })
    renderGoogleButton(overlay.querySelector('#mm-am-google-btn'), () => close(true), 'outline')
    overlay.querySelector('#mm-am-form').addEventListener('submit', async e => {
      e.preventDefault()
      const submitBtn = overlay.querySelector('button[type="submit"]')
      submitBtn.disabled = true
      const username = overlay.querySelector('#mm-am-user').value
      const password = overlay.querySelector('#mm-am-pass').value
      const res = isLogin
        ? await login(username, password)
        : await register({
            username, password,
            password2: overlay.querySelector('#mm-am-pass2').value,
            email: overlay.querySelector('#mm-am-email').value,
            age: overlay.querySelector('#mm-am-age').value,
            license: overlay.querySelector('#mm-am-license').value,
          })
      if (!res.ok) { submitBtn.disabled = false; render(res.error) } else { close(true) }
    })
    requestAnimationFrame(() => overlay.querySelector('#mm-am-user')?.focus())
  }

  render()
  requestAnimationFrame(() => overlay.classList.add('p-auth-overlay--open'))
}
