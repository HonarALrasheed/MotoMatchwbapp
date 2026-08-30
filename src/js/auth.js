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
import { report } from './monitoring.js'
import { initCommunityData, unsubscribeAll, setMyProfile } from './community-api.js'

const LS_USERS   = 'mm_auth_users_v1'    // [{ username, password, name, email, bio, avatar, joinedAt, notif, theme, provider }]
const LS_SESSION = 'mm_auth_session_v1'  // { username } | { username:'Gast', guest:true } | null
const LS_GUEST   = 'mm_auth_guest_v1'    // Profil-Overrides für Gast
const LS_ONLINE_PROFILES = 'mm_auth_online_profiles_v1'  // { [uid]: Profil-Overrides } für Supabase-User (Felder ohne DB-Spalte, z. B. Avatar/Bio/Alter)

/* Mindestlänge für Passwörter — MUSS mit der Supabase-Einstellung
   (Auth → Providers → Email → "Minimum password length") übereinstimmen,
   sonst passiert ein zu kurzes Passwort den Client und scheitert erst am
   Server mit englischer Meldung. */
export const MIN_PASSWORD_LENGTH = 8

/* ── Supabase-Session-Cache (sync-lesbar) ─────────────────────────
   Wird durch onAuthStateChange und initSupabaseAuth() befüllt.
   Solange null, ist niemand angemeldet (oder Supabase noch am Init). */
let _sbSession = null  // { username, uid } | { username:'Gast', guest:true } | null

/* register() ruft _onSignedIn() selbst auf, sobald signUp() eine Session
   liefert. Der onAuthStateChange-Listener soll in dem Fenster nicht parallel
   ein zweites Mal initialisieren. */
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
    if (event === 'PASSWORD_RECOVERY') {
      openPasswordResetScreen()
      return
    }
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

/**
 * Wunschnamen aus der Session ableiten — 1:1 dieselbe Reihenfolge wie
 * handle_new_user() in supabase/schema.sql: Metadatum aus signUp(), sonst
 * E-Mail-Lokalteil (OAuth), sonst uuid. Beide Seiten müssen gleich ableiten,
 * sonst bekäme derselbe Nutzer je nach Weg einen anderen Namen.
 */
function _usernameBase(session) {
  const uid = session.user.id
  const raw = (session.user.user_metadata?.username || '').trim()
            || (session.user.email || '').split('@')[0]
  return raw.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24)
         || `user_${uid.replace(/-/g, '').slice(0, 8)}`
}

/**
 * Legt eine fehlende profiles-Zeile nachträglich an — Notnagel für den Zustand
 * "Code deployt, Trigger noch nicht eingespielt". Die Namenskandidaten spiegeln
 * die Logik von handle_new_user(): Wunschname, dann uuid-Suffixe. Der letzte
 * enthält die volle uuid und kann praktisch nicht kollidieren.
 * @returns {Promise<string|null>} vergebener Benutzername oder null
 */
async function _repairMissingProfile(session) {
  const uid  = session.user.id
  const bare = uid.replace(/-/g, '')
  const base = _usernameBase(session)

  for (const username of [base, `${base}_${bare.slice(0, 4)}`, `${base}_${bare}`]) {
    const { error } = await supabase.from('profiles').insert({ id: uid, username })
    if (!error) return username
    // Kollidiert hat entweder die uuid (Zeile existiert doch — dann gewinnt sie)
    // oder der Name (dann nächster Kandidat).
    const { data: row } = await supabase.from('profiles').select('username').eq('id', uid).maybeSingle()
    if (row?.username) return row.username
    if (!/duplicate|unique/i.test(error.message || '')) {
      report(error, { where: '_repairMissingProfile', uid })
      return null
    }
  }
  return null
}

async function _onSignedIn(session) {
  const uid = session.user.id
  const { data: profile } = await supabase.from('profiles').select('username').eq('id', uid).maybeSingle()
  // Das Profil legt der DB-Trigger handle_new_user() an (supabase/schema.sql) —
  // auch für Google-OAuth-Nutzer, die hier zum ersten Mal ankommen. Der Trigger
  // läuft in derselben Transaktion wie der INSERT auf auth.users; wenn wir hier
  // ankommen, ist die Zeile also da. Deshalb legt dieser Pfad im Normalfall
  // nichts mehr an — das täte es sonst doppelt.
  let username = profile?.username
  if (!username) {
    // Reparaturpfad: greift genau dann, wenn der Trigger noch NICHT installiert
    // ist. Ohne ihn hätte ein neuer Google-Nutzer sonst gar kein Profil und
    // damit keine funktionierende Community. Hier ist eine Session vorhanden,
    // auth.uid() also gesetzt und profiles_insert erfüllt.
    username = await _repairMissingProfile(session)
    report(new Error(username
      ? 'profiles-Zeile fehlte, vom Client nachgeholt — Trigger handle_new_user() installiert?'
      : 'profiles-Zeile fehlt und liess sich nicht anlegen'), { where: '_onSignedIn', uid })
    // Letzte Rückfallebene: lieber ein Anzeigename als "undefined" in der UI.
    username = username || _usernameBase(session)
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

/* ── Social Login (Google) ────────────────────────────────────────
   Keine Client-ID im Frontend: den Ablauf führt Supabase, die ID liegt in
   den Provider-Einstellungen des Projekts. */

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

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
function write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)) } catch {} }

/* ── Pub/Sub ───────────────────────────────────────────────────── */
const listeners = new Set()
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
function notify() {
  const s = getSession()
  // Ein defekter Abonnent darf die übrigen nicht aufhalten — deshalb der
  // catch. Er darf aber auch nicht spurlos bleiben: hier hängen Anmeldung,
  // Abmeldung und Sitzungswechsel dran.
  listeners.forEach(fn => {
    try { fn(s) } catch (err) { report(err, { where: 'auth.notify', listener: fn.name || 'anonym' }) }
  })
  try { window.dispatchEvent(new CustomEvent('mm:auth-changed', { detail: s })) } catch {}
}

/* ── State ─────────────────────────────────────────────────────── */

/**
 * Demo-Modus-Nutzer aus dem localStorage.
 *
 * Der Demo-Modus speicherte hier früher Passwörter im Klartext und verglich sie
 * beim Login ebenso. Das ist ersatzlos entfallen (siehe login()) — ein Hash
 * hätte hier nichts gebracht: er läge unsalted im selben localStorage, wäre
 * offline in Sekunden zu knacken und würde nur Sicherheit vortäuschen, die
 * dieser Modus per Konstruktion nicht hat.
 *
 * Der Filter unten räumt zusätzlich Altbestände auf: Klartext-Passwörter, die
 * in bereits benutzten Browsern liegen, verschwinden beim ersten Lesen.
 */
export function getUsers() {
  const users = read(LS_USERS, [])
  if (users.some(u => u && 'password' in u)) {
    const cleaned = users.map(({ password, ...rest }) => rest)
    write(LS_USERS, cleaned)
    return cleaned
  }
  return users
}
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
      // Mit aktivem "Confirm email" ist das der häufigste Fall direkt nach der
      // Registrierung — "Passwort falsch" wäre hier schlicht gelogen.
      if (/not confirmed/i.test(error?.message || ''))
        return { ok: false, error: 'Bitte bestätige zuerst deine E-Mail-Adresse — den Link findest du in deinem Postfach.' }
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
  if (!u) return { ok: false, error: 'Zugangsdaten oder Passwort sind falsch.' }
  // Kein Passwortvergleich: der Demo-Modus speichert keine Passwörter (siehe
  // getUsers()). Er läuft ohne Server ausschließlich lokal — es gibt hier nichts
  // zu schützen und niemanden, gegen den geschützt würde.
  console.info('[MotoMatch] Demo-Modus — Anmeldung ohne Passwortprüfung.')
  _sbSession = { username: u.username }
  setSessionRaw({ username: u.username }); notify()
  await initCommunityData(null, u.username)
  return { ok: true, user: u }
}

/**
 * Registrierung.
 * Im Online-Modus: Supabase signUp — die profiles-Zeile legt der DB-Trigger
 * handle_new_user() an. Ist "Confirm email" aktiv, kommt keine Session zurück;
 * dann ist das Ergebnis { ok: true, needsEmailConfirmation: true }.
 * Im Offline-Modus: localStorage.
 */
export async function register({ username, password, password2, email = '', age = '', license = '' }) {
  username = (username || '').trim()
  email    = (email || '').trim()
  if (username.length < 2) return { ok: false, error: 'Benutzername ist zu kurz.' }
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: 'Bitte eine gültige E-Mail-Adresse angeben.' }
  if ((password || '').length < MIN_PASSWORD_LENGTH) return { ok: false, error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.` }
  if (password2 !== undefined && password !== password2) return { ok: false, error: 'Passwörter stimmen nicht überein.' }

  if (!OFFLINE_MODE) {
    // Vorabprüfung, damit der Nutzer eine deutsche Meldung bekommt, statt vom
    // Trigger stillschweigend einen Namen mit Suffix zugeteilt zu bekommen.
    // .eq() statt .ilike(): ILIKE deutet "_" als Platzhalter, "max_1" kollidierte
    // dadurch fälschlich mit "maxx1".
    const { data: existing } = await supabase
      .from('profiles').select('id').eq('username', username).maybeSingle()
    if (existing) return { ok: false, error: 'Dieser Benutzername ist bereits vergeben.' }

    _registering = true
    try {
      // username geht als Metadatum mit — der DB-Trigger handle_new_user()
      // liest ihn dort aus (auth.users.raw_user_meta_data->>'username') und legt
      // die profiles-Zeile an. Kein Profil-Insert mehr von hier: ohne Session
      // (Confirm email an) wäre auth.uid() NULL und die RLS-Policy würde blocken.
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { username } },
      })
      if (error) {
        if (error.message.includes('already registered'))
          return { ok: false, error: 'Diese E-Mail-Adresse wird bereits verwendet.' }
        return { ok: false, error: error.message }
      }
      if (!data.user?.id) return { ok: false, error: 'Registrierung fehlgeschlagen.' }

      if (!data.session) {
        // "Confirm email" ist aktiv: das Konto existiert, ist aber bis zum Klick
        // auf den Link in der Mail nicht nutzbar. Kein Fehler — ein Hinweis.
        return { ok: true, needsEmailConfirmation: true, email, user: { username } }
      }

      await _onSignedIn(data.session)
      notify()
      // Der Trigger kann bei einer Kollision im letzten Moment einen anderen
      // Namen vergeben haben — _onSignedIn() hat den echten gerade gelesen.
      return { ok: true, user: { username: _sbSession?.username || username } }
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
  const user = { ...DEFAULT_PROFILE, username, name: username, email, age: age ? parseInt(age) : null, license, joinedAt: Date.now() }
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
    users.push({ ...DEFAULT_PROFILE, username, name: name || username, bio: bio || DEFAULT_PROFILE.bio, joinedAt: Date.now() })
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
    // .eq() wie in register(): ILIKE deutete "_" als Platzhalter und meldete
    // "max_1" als vergeben, sobald es ein "maxx1" gab. Zusätzlich wirft
    // .maybeSingle() bei mehreren Wildcard-Treffern — hier kann es nur einen geben.
    const { data: existing } = await supabase.from('profiles').select('id').eq('username', newUsername).maybeSingle()
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
  if ((newPassword || '').length < MIN_PASSWORD_LENGTH) return { ok: false, error: `Neues Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.` }

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
  if (u.provider) return { ok: false, error: 'Dieses Konto ist über Google verknüpft — kein lokales Passwort.' }
  // Nichts zu prüfen und nichts zu speichern — der Demo-Modus hält keine
  // Passwörter. Die Bestätigung ist ehrlich: hinterher gilt jedes Passwort,
  // vorher galt auch jedes.
  return { ok: true }
}

/**
 * Bestätigungsmail erneut anfordern.
 *
 * Ohne diesen Weg sässe jeder fest, dessen Mail verloren ging oder dessen Link
 * abgelaufen ist (Supabase: 24 h): der Benutzername ist durch den Trigger
 * bereits vergeben, eine zweite Registrierung scheitert also schon an der
 * Vorabprüfung in register(). Und anmelden kann er sich ohne Bestätigung auch
 * nicht — eine Sackgasse ohne Ausgang.
 *
 * Wie bei requestPasswordReset() wird nicht verraten, ob die Adresse existiert.
 */
export async function resendConfirmation(email) {
  email = (email || '').trim()
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: 'Bitte eine gültige E-Mail-Adresse angeben.' }
  if (OFFLINE_MODE) return { ok: false, error: 'Im Demo-Modus gibt es keine Bestätigungsmails.' }
  const emailRedirectTo = `${window.location.origin}${window.location.pathname}`
  const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo } })
  if (error) {
    // Supabase drosselt Mailversand hart (Default-SMTP: wenige pro Stunde).
    if (/rate|limit|seconds|too many/i.test(error.message || ''))
      return { ok: false, error: 'Zu viele Versuche — bitte warte ein paar Minuten und probier es dann erneut.' }
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

/**
 * Startet den öffentlichen Passwort-vergessen-Flow: Supabase schickt eine
 * Reset-Mail mit Link, der zurück zur App führt (`?reset=1`). Aus Datenschutz-
 * gründen liefern wir hier keine Info darüber, ob die E-Mail existiert.
 */
export async function requestPasswordReset(email) {
  email = (email || '').trim()
  if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, error: 'Bitte eine gültige E-Mail-Adresse angeben.' }
  if (OFFLINE_MODE) return { ok: false, error: 'Passwort-Reset ist im Offline-Modus nicht verfügbar.' }
  const redirectTo = `${window.location.origin}${window.location.pathname}?reset=1`
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Setzt das Passwort des aktuell (per Recovery-Link) angemeldeten Nutzers. */
export async function updatePasswordDirect(newPassword) {
  if ((newPassword || '').length < MIN_PASSWORD_LENGTH) return { ok: false, error: `Neues Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.` }
  if (OFFLINE_MODE) return { ok: false, error: 'Passwort-Reset ist im Offline-Modus nicht verfügbar.' }
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Konto endgültig löschen (Art. 17 DSGVO).
 *
 * Online läuft das über api/delete-account.js: der Service-Role-Key, den die
 * Admin-API dafür braucht, darf nicht im Client liegen. Der Endpoint bekommt
 * nur den Access-Token, die zu löschende uid liest er selbst aus dem
 * verifizierten Token.
 *
 * WICHTIG — abgemeldet wird ausschließlich im Erfolgsfall. Vorher wurde auch
 * bei einem Fehlschlag abgemeldet: der Nutzer stand dann vor einer
 * Fehlermeldung, ohne Session, mit weiterhin existierendem Konto. Bleibt die
 * Session bestehen, ist der Versuch einfach wiederholbar.
 */
export async function deleteAccount() {
  const s = getSession(); if (!s || s.guest) return { ok: false, error: 'Als Gast nicht möglich.' }

  if (!OFFLINE_MODE) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { ok: false, error: 'Deine Sitzung ist abgelaufen. Bitte melde dich erneut an — dein Konto wurde nicht gelöscht.' }

    let res, body
    try {
      res = await fetch('/api/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: '{}',
      })
      body = await res.json().catch(() => ({}))
    } catch {
      return { ok: false, error: 'Konto konnte nicht gelöscht werden (Netzwerkfehler). Du bist weiterhin angemeldet.' }
    }
    // Serverformat aller api/-Endpoints: { error: { code, message } }. Den
    // Statuscode als Rückfall mitnehmen — ohne ihn sähe ein 404 (Endpoint gar
    // nicht deployt, also gar kein Body) aus wie ein inhaltlicher Fehler.
    if (!res.ok) {
      return {
        ok: false,
        code: body?.error?.code,
        error: body?.error?.message || `Konto konnte nicht gelöscht werden (HTTP ${res.status}). Du bist weiterhin angemeldet.`,
      }
    }

    // Die lokalen Profil-Overrides (Avatar, Bio, Alter — Felder ohne DB-Spalte)
    // liegen nur hier im Browser. Ohne diesen Schritt bliebe nach einer als
    // vollständig angekündigten Löschung das Profilbild im localStorage liegen.
    if (s.uid) {
      const all = read(LS_ONLINE_PROFILES, {})
      delete all[s.uid]
      write(LS_ONLINE_PROFILES, all)
    }

    // signOut() spricht mit einem Token, dessen Nutzer es serverseitig nicht
    // mehr gibt — ein Fehler daraus ist hier bedeutungslos. logout() räumt den
    // lokalen Zustand auf, bevor es signOut() abwartet.
    try { await logout() } catch {}
    return { ok: true }
  }

  const users = getUsers().filter(x => x.username.toLowerCase() !== s.username.toLowerCase())
  saveUsers(users)
  setSessionRaw(null)
  notify()
  return { ok: true }
}

/**
 * Auskunft nach Art. 15 DSGVO: alle Serverdaten zum eigenen Konto.
 *
 * Ruft die SECURITY-DEFINER-Funktion export_my_data() auf (supabase/schema.sql).
 * Die Funktion nimmt keinen Parameter — sie liest auth.uid() aus dem JWT und
 * gibt ausschließlich eigene Zeilen zurück; es gibt also keinen Weg, hierüber
 * fremde Daten abzufragen.
 *
 * Der Aufrufer muss den Fehlerfall behandeln: die App funktioniert offline
 * weiter, ein Export ohne Serverteil ist dann unvollständig und muss als
 * solcher gekennzeichnet werden (siehe src/js/account.js).
 */
export async function exportMyData() {
  const s = getSession()
  if (!s) return { ok: false, error: 'Nicht angemeldet.' }
  if (s.guest) return { ok: false, error: 'Als Gast gibt es keine Serverdaten.' }
  if (OFFLINE_MODE) return { ok: false, error: 'Offline-Modus — es gibt keine Serverdaten.' }

  const { data, error } = await supabase.rpc('export_my_data')
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
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
  // Adresse, für die gerade eine Bestätigung aussteht — schaltet den
  // "Erneut senden"-Weg frei.
  let pendingEmail = ''
  const overlay = document.createElement('div')
  overlay.id = 'mm-authmodal'
  overlay.className = 'p-auth-overlay'
  document.body.appendChild(overlay)

  const close = (done) => {
    overlay.classList.remove('p-auth-overlay--open')
    setTimeout(() => overlay.remove(), 200)
    if (done && typeof onDone === 'function') onDone()
  }

  const render = (error = '', info = '') => {
    const isLogin = mode === 'login'
    const isForgot = mode === 'forgot'
    if (isForgot) {
      overlay.innerHTML = `
      <div class="p-auth-backdrop" id="mm-am-backdrop"></div>
      <div class="p-auth-card">
        <div class="p-auth-brand">MOTOMATCH</div>
        <h3 class="p-auth-title">Passwort vergessen</h3>
        <p class="p-auth-sub">Gib deine E-Mail an — wir schicken dir einen Link zum Zurücksetzen.</p>
        <form id="mm-am-form" autocomplete="off">
          <label class="p-auth-field">
            <span class="p-auth-label">E-Mail</span>
            <input class="p-auth-input" id="mm-am-email" type="email" placeholder="du@mail.de" required>
          </label>
          <div class="p-auth-error" id="mm-am-error" ${error ? '' : 'hidden'}>${esc(error)}</div>
          ${info ? `<div class="p-auth-sub" style="color:#0a0;margin:8px 0 4px">${esc(info)}</div>` : ''}
          <div class="p-auth-actions">
            <button type="button" class="p-auth-cancel" id="mm-am-back">Zurück</button>
            <button type="submit" class="p-auth-submit" id="mm-am-submit">Reset-Link senden</button>
          </div>
        </form>
      </div>`
      overlay.querySelector('#mm-am-backdrop').addEventListener('click', () => close(false))
      overlay.querySelector('#mm-am-back').addEventListener('click', () => { mode = 'login'; render() })
      overlay.querySelector('#mm-am-form').addEventListener('submit', async e => {
        e.preventDefault()
        const btn = overlay.querySelector('#mm-am-submit')
        btn.disabled = true
        btn.textContent = 'Senden…'
        const email = overlay.querySelector('#mm-am-email').value
        const res = await requestPasswordReset(email)
        // Kein Leak: Erfolgsmeldung auch bei Fehler zeigen, außer bei Format-Fehler
        if (!res.ok && /gültige E-Mail/.test(res.error)) {
          btn.disabled = false
          btn.textContent = 'Reset-Link senden'
          render(res.error)
        } else {
          render('', 'Falls diese E-Mail registriert ist, hast du eine Mail bekommen.')
        }
      })
      requestAnimationFrame(() => overlay.querySelector('#mm-am-email')?.focus())
      return
    }
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
            <input class="p-auth-input" id="mm-am-pass" type="password" ${isLogin ? '' : `minlength="${MIN_PASSWORD_LENGTH}"`} placeholder="••••••••" required>
          </label>
          ${isLogin && !OFFLINE_MODE ? `
          <div style="margin:-8px 0 12px;text-align:right">
            <button type="button" class="p-auth-toggle" id="mm-am-forgot">Passwort vergessen?</button>
          </div>` : ''}
          ${isLogin ? '' : `
          <label class="p-auth-field">
            <span class="p-auth-label">Passwort bestätigen</span>
            <input class="p-auth-input" id="mm-am-pass2" type="password" minlength="${MIN_PASSWORD_LENGTH}" placeholder="••••••••" required>
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
          ${info ? `<div class="p-auth-sub" style="color:#0a0;margin:8px 0 4px">${esc(info)}</div>` : ''}
          ${pendingEmail ? `
          <div style="margin:4px 0 12px;text-align:center">
            <button type="button" class="p-auth-toggle" id="mm-am-resend">Mail nicht angekommen? Erneut senden</button>
          </div>` : ''}
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
    overlay.querySelector('#mm-am-forgot')?.addEventListener('click', () => { mode = 'forgot'; render() })
    overlay.querySelector('#mm-am-resend')?.addEventListener('click', async ev => {
      ev.target.disabled = true
      ev.target.textContent = 'Senden…'
      const res = await resendConfirmation(pendingEmail)
      render(res.ok ? '' : res.error, res.ok ? `Neue Bestätigungsmail an ${pendingEmail} unterwegs.` : '')
    })
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
      if (!res.ok) {
        submitBtn.disabled = false
        // "Bitte bestätige zuerst deine E-Mail" ohne Ausweg wäre eine Sackgasse.
        if (/bestätige/i.test(res.error) && username.includes('@')) pendingEmail = username.trim()
        render(res.error)
      } else if (res.needsEmailConfirmation) {
        // Konto angelegt, aber noch keine Session — der Nutzer muss erst den
        // Link in der Bestätigungsmail klicken. Kein Fehler, ein Hinweis.
        mode = 'login'
        pendingEmail = res.email
        render('', `Fast geschafft! Wir haben dir eine Mail an ${res.email} geschickt — bitte bestätige darin deine Adresse und melde dich dann an.`)
      } else {
        close(true)
      }
    })
    requestAnimationFrame(() => overlay.querySelector('#mm-am-user')?.focus())
  }

  render()
  requestAnimationFrame(() => overlay.classList.add('p-auth-overlay--open'))
}

/**
 * Reset-Screen für Nutzer, die per Recovery-Link zurückkommen. Wird von
 * onAuthStateChange (Event PASSWORD_RECOVERY) sowie beim App-Start bei
 * `?reset=1` aufgerufen. Nach Erfolg: URL bereinigen und schließen.
 */
export function openPasswordResetScreen() {
  if (document.getElementById('mm-resetmodal')) return
  const overlay = document.createElement('div')
  overlay.id = 'mm-resetmodal'
  overlay.className = 'p-auth-overlay'
  document.body.appendChild(overlay)

  const close = () => {
    overlay.classList.remove('p-auth-overlay--open')
    setTimeout(() => overlay.remove(), 200)
  }

  const clearResetParam = () => {
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('reset')
      window.history.replaceState(window.history.state, '', url.pathname + (url.search ? url.search : '') + url.hash)
    } catch {}
  }

  const render = (error = '', info = '') => {
    overlay.innerHTML = `
      <div class="p-auth-backdrop"></div>
      <div class="p-auth-card">
        <div class="p-auth-brand">MOTOMATCH</div>
        <h3 class="p-auth-title">Neues Passwort setzen</h3>
        <p class="p-auth-sub">Wähle ein neues Passwort für dein Konto.</p>
        <form id="mm-rm-form" autocomplete="off">
          <label class="p-auth-field">
            <span class="p-auth-label">Neues Passwort</span>
            <input class="p-auth-input" id="mm-rm-p1" type="password" minlength="${MIN_PASSWORD_LENGTH}" autocomplete="new-password" placeholder="••••••••" required>
          </label>
          <label class="p-auth-field">
            <span class="p-auth-label">Neues Passwort bestätigen</span>
            <input class="p-auth-input" id="mm-rm-p2" type="password" minlength="${MIN_PASSWORD_LENGTH}" autocomplete="new-password" placeholder="••••••••" required>
          </label>
          <div class="p-auth-error" id="mm-rm-error" ${error ? '' : 'hidden'}>${esc(error)}</div>
          ${info ? `<div class="p-auth-sub" style="color:#0a0;margin:8px 0 4px">${esc(info)}</div>` : ''}
          <div class="p-auth-actions">
            <button type="submit" class="p-auth-submit" id="mm-rm-submit">Neues Passwort speichern</button>
          </div>
        </form>
      </div>`
    overlay.querySelector('#mm-rm-form').addEventListener('submit', async e => {
      e.preventDefault()
      const btn = overlay.querySelector('#mm-rm-submit')
      const p1 = overlay.querySelector('#mm-rm-p1').value
      const p2 = overlay.querySelector('#mm-rm-p2').value
      if (p1 !== p2) { render('Passwörter stimmen nicht überein.'); return }
      btn.disabled = true
      btn.textContent = 'Speichern…'
      const res = await updatePasswordDirect(p1)
      if (!res.ok) {
        btn.disabled = false
        btn.textContent = 'Neues Passwort speichern'
        render(res.error)
        return
      }
      clearResetParam()
      render('', 'Passwort erfolgreich geändert.')
      setTimeout(close, 1500)
    })
    requestAnimationFrame(() => overlay.querySelector('#mm-rm-p1')?.focus())
  }

  render()
  requestAnimationFrame(() => overlay.classList.add('p-auth-overlay--open'))
}
