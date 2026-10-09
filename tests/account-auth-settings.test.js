import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const authSource = readFileSync(new URL('../src/js/auth.js', import.meta.url), 'utf8')
const accountSource = readFileSync(new URL('../src/js/account.js', import.meta.url), 'utf8')

function extract(source, startText, endText) {
  const start = source.indexOf(startText)
  const end = source.indexOf(endText, start)
  assert.ok(start >= 0 && end > start, `Quellbereich ${startText} muss vorhanden sein`)
  return source.slice(start, end).replace(/^export /gm, '')
}

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function logoutHarness(signOut) {
  const state = { session: { username: 'rider', uid: 'user-1' }, cleared: 0, notified: 0, unsubscribed: 0 }
  const code = extract(authSource, 'export async function logout(', '/** Profilfelder des aktuellen Nutzers')
  const context = vm.createContext({
    OFFLINE_MODE: false,
    _sbSession: state.session,
    supabase: { auth: { signOut } },
    unsubscribeAll: () => { state.unsubscribed++ },
    setSessionRaw: value => { if (value === null) state.cleared++ },
    notify: () => { state.notified++ },
  })
  vm.runInContext(`${code}\nglobalThis.runLogout = logout`, context)
  return { state, logout: context.runLogout }
}

function updateProfileHarness({ setMyProfile, offline = false, session = { username: 'rider', uid: 'user-1' }, storageError = null }) {
  const writes = []
  const state = { notified: 0 }
  const code = extract(authSource, 'export async function updateProfile(', '/** Benutzernamen des aktuellen Nutzers')
  const context = vm.createContext({
    OFFLINE_MODE: offline,
    LS_GUEST: 'guest-profile',
    LS_ONLINE_PROFILES: 'online-profiles',
    LS_USERS: 'users',
    getSession: () => session,
    setMyProfile: setMyProfile || (async () => ({ ok: true })),
    read: (_key, fallback) => fallback,
    getUsers: () => [{ username: 'rider', name: 'Old' }],
    notify: () => { state.notified++ },
    localStorage: {
      setItem(key, value) {
        if (storageError) throw storageError
        writes.push([key, value])
      },
    },
  })
  vm.runInContext(`${code}\nglobalThis.runUpdateProfile = updateProfile`, context)
  return { state, writes, updateProfile: context.runUpdateProfile }
}

function saveAccountHarness(updateProfile) {
  const emitted = []
  const code = extract(accountSource, 'export async function saveAccount(', 'export function isAuthenticated()')
  const context = vm.createContext({
    auth: { updateProfile },
    getAccount: () => ({ name: 'Rider' }),
    window: { dispatchEvent: event => emitted.push(event.detail) },
    CustomEvent: class { constructor(_name, options) { this.detail = options.detail } },
  })
  vm.runInContext(`${code}\nglobalThis.runSaveAccount = saveAccount`, context)
  return { emitted, saveAccount: context.runSaveAccount }
}

test('Abmelden wartet auf Supabase, bevor die lokale Session entfernt wird', async () => {
  const pending = deferred()
  const h = logoutHarness(() => pending.promise)
  const resultPromise = h.logout()
  await Promise.resolve()
  assert.deepEqual(h.state.session, { username: 'rider', uid: 'user-1' })
  assert.equal(h.state.cleared, 0)
  assert.equal(h.state.notified, 0)

  pending.resolve({ error: null })
  assert.deepEqual(JSON.parse(JSON.stringify(await resultPromise)), { ok: true })
  assert.equal(h.state.cleared, 1)
  assert.equal(h.state.notified, 1)
  assert.equal(h.state.unsubscribed, 1)
})

test('fehlgeschlagenes Abmelden lässt Session und Kontoansicht unangetastet', async () => {
  const h = logoutHarness(async () => ({ error: new Error('network') }))
  assert.deepEqual(JSON.parse(JSON.stringify(await h.logout())), { ok: false, error: 'Abmelden fehlgeschlagen. Bitte erneut versuchen.' })
  assert.deepEqual(h.state.session, { username: 'rider', uid: 'user-1' })
  assert.equal(h.state.cleared, 0)
  assert.equal(h.state.notified, 0)
  assert.equal(h.state.unsubscribed, 0)
})

test('Profil zeigt Erfolg erst nach bestätigtem Supabase-Schreiben', async () => {
  const pending = deferred()
  const remote = updateProfileHarness(() => pending.promise)
  const account = saveAccountHarness(remote.updateProfile)
  const resultPromise = account.saveAccount({ name: 'New name' })
  await Promise.resolve()
  assert.equal(remote.writes.length, 0)
  assert.equal(account.emitted.length, 0)

  pending.resolve({ ok: true })
  assert.deepEqual(JSON.parse(JSON.stringify(await resultPromise)), { ok: true, account: { name: 'Rider' } })
  assert.equal(remote.writes.length, 1)
  assert.equal(account.emitted.length, 1)
})

test('fehlgeschlagenes Profil-Schreiben meldet keinen Erfolg und aktualisiert keinen Cache', async () => {
  const remote = updateProfileHarness({ setMyProfile: async () => ({ ok: false, error: 'DB nicht erreichbar' }) })
  const account = saveAccountHarness(remote.updateProfile)
  const result = await account.saveAccount({ name: 'New name' })
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: false, error: 'DB nicht erreichbar' })
  assert.equal(remote.writes.length, 0)
  assert.equal(remote.state.notified, 0)
  assert.equal(account.emitted.length, 0)
})

test('E-Mail wird aus der Auth-Session angezeigt und lokale E-Mail-Patches werden abgelehnt', async () => {
  let remoteCalls = 0
  const h = updateProfileHarness({ setMyProfile: async () => { remoteCalls++; return { ok: true } } })
  assert.deepEqual(JSON.parse(JSON.stringify(await h.updateProfile({ email: 'unverified@example.test' }))), {
    ok: false,
    error: 'E-Mail ändern ist hier derzeit nicht verfügbar.',
  })
  assert.equal(remoteCalls, 0)
  assert.equal(h.writes.length, 0)

  const emailMarkup = accountSource.match(/<div class="acc-fieldbox" data-fieldbox="email">[\s\S]*?<p class="acc-inline-note">[\s\S]*?<\/div>/)?.[0]
  assert.ok(emailMarkup)
  assert.match(emailMarkup, /E-Mail ändern ist derzeit nicht verfügbar\./)
  assert.doesNotMatch(emailMarkup, /data-fb-edit|data-fb-input/)
  assert.match(authSource, /email: s\.email \|\| ''/)
})

test('Offline-Profiländerungen melden Storage-Fehler statt einen falschen Erfolg', async () => {
  const h = updateProfileHarness({
    offline: true,
    session: { username: 'rider' },
    storageError: new Error('quota exceeded'),
    setMyProfile: async () => ({ ok: true }),
  })
  assert.equal((await h.updateProfile({ name: 'Changed' })).ok, false)
  assert.equal(h.writes.length, 0)
  assert.equal(h.state.notified, 0)
})
