import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const RIDES = 'mm_rides_v1'
const AKTIV = 'mm_ride_track_active_v1'
const source = readFileSync(new URL('../src/js/account.js', import.meta.url), 'utf8')
const start = source.indexOf('const AUFZEICHNEN_AKTIV = false')
const end = source.indexOf('/* ─── Favoriten:', start)
assert.ok(start >= 0 && end > start, 'Journal-Funktionen müssen im Test auffindbar sein')
const journalSource = source.slice(start, end)

class BrowserSpeicher {
  daten = new Map()
  lesefehler = null
  schreibfehler = null
  getItem(key) {
    if (this.lesefehler) throw this.lesefehler
    return this.daten.get(key) ?? null
  }
  setItem(key, value) {
    if (this.schreibfehler) throw this.schreibfehler
    this.daten.set(key, String(value))
  }
  removeItem(key) { this.daten.delete(key) }
}

class Element {
  constructor(id = '') {
    this.id = id
    this.value = ''
    this.hidden = false
    this.src = ''
    this.files = []
    this.dataset = {}
    this.listeners = new Map()
    this.removed = false
    this.classList = { toggle() {}, add() {}, remove() {} }
    this.parentElement = { appendChild() {} }
  }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || []
    handlers.push(handler)
    this.listeners.set(type, handlers)
  }
  async fire(type) {
    for (const handler of this.listeners.get(type) || []) {
      await handler({ target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} })
    }
  }
  contains() { return false }
  focus() {}
  scrollIntoView() {}
  setAttribute() {}
  remove() { this.removed = true }
}

function journal({ recorder = false, recovery = null, now = Date.now() } = {}) {
  const speicher = new BrowserSpeicher()
  if (recovery) speicher.setItem(AKTIV, JSON.stringify(recovery))
  const elemente = new Map()
  const element = id => {
    if (!elemente.has(id)) elemente.set(id, new Element(id))
    return elemente.get(id)
  }
  const meldungen = []
  const renders = []
  const body = new Element('body')
  body.appendChild = () => {}
  const document = {
    body,
    getElementById: element,
    querySelectorAll: () => [],
    querySelector: () => null,
  }
  class FixedDate extends Date { static now() { return now } }
  const track = {
    id: 'auf-test', start: Date.UTC(2026, 9, 8), km: 12.5, fahrMs: 3600000,
    punkte: [[50, 8, 0, null], [50.01, 8.01, 60, null]],
  }
  const steuerung = {
    stand: () => ({ km: 12.5, fahrMs: 3600000, tempoKmh: 30, schnittKmh: 25, hoehenMeter: 0, punkte: [], punktZahl: 2 }),
    beenden: () => track,
  }
  const context = vm.createContext({
    localStorage: speicher, document, Date: FixedDate,
    esc: value => String(value),
    standortVerfuegbar: () => true,
    unterbrocheneAufzeichnung: () => JSON.parse(speicher.getItem(AKTIV) || 'null'),
    ladeUnterbrocheneAufzeichnung: async () => JSON.parse(speicher.getItem(AKTIV) || 'null'),
    verwerfeUnterbrochene: (erwarteteId = null) => {
      const offen = JSON.parse(speicher.getItem(AKTIV) || 'null')
      if (erwarteteId && (offen?.fertig ? offen.track?.id : offen?.id) !== erwarteteId) return false
      speicher.removeItem(AKTIV)
      return true
    },
    verwerfeGesicherteAufzeichnung: async (erwarteteId = null) => {
      const offen = JSON.parse(speicher.getItem(AKTIV) || 'null')
      if (erwarteteId && (offen?.fertig ? offen.track?.id : offen?.id) !== erwarteteId) return false
      speicher.removeItem(AKTIV)
      return true
    },
    bestaetigeGespeicherteFahrt: async () => true,
    showFlash: text => meldungen.push(text),
    renderTabContent: tab => renders.push(tab),
    starteAufzeichnung: async () => steuerung,
    formatiereDauer: () => '1:00', spurPfad: () => '',
  })
  const code = recorder
    ? journalSource.replace('const AUFZEICHNEN_AKTIV = false', 'const AUFZEICHNEN_AKTIV = true')
    : journalSource
  vm.runInContext(`'use strict';\n${code}\nglobalThis.journalApi = { getRides, saveRides, wireJournal, setPhoto: value => { compressPhoto = async () => value } }`, context)
  if (recorder && recovery) {
    const html = vm.runInContext('renderJournal()', context)
    element('rj-resume-drop').dataset.recoveryId = html.match(/id="rj-resume-drop"[^>]*data-recovery-id="([^"]*)"/)?.[1]
  }
  vm.runInContext('wireJournal()', context)

  for (const [id, value] of Object.entries({
    'rj-date': '2026-10-08', 'rj-km': '42', 'rj-hours': '1.5',
    'rj-title': 'Neue Fahrt', 'rj-notes': 'Notiz',
    'rj-edit-id': 'alt', 'rj-edit-date': '2026-10-09',
    'rj-edit-km': '50', 'rj-edit-hours': '2',
    'rj-edit-title': 'Bearbeitet', 'rj-edit-notes': 'Neue Notiz',
  })) element(id).value = value

  return { speicher, element, meldungen, renders, api: context.journalApi, track }
}

function gespeichert(speicher) { return JSON.parse(speicher.getItem(RIDES)) }
function alterEintrag(extra = {}) {
  return { id: 'alt', date: Date.UTC(2026, 9, 7), km: 10, hours: 1, title: 'Alt', notes: '', photo: null, track: null, ...extra }
}
function keinErfolg(h) {
  assert.equal(h.renders.length, 0)
  assert.ok(!h.meldungen.some(text => /gespeichert ✓|aktualisiert ✓|Eintrag gelöscht/.test(text)))
}

test('fehlender Schlüssel: Fahrt wird mit bisherigem Format angelegt', async () => {
  const h = journal()
  await h.element('rj-form').fire('submit')
  const rides = gespeichert(h.speicher)
  assert.equal(rides.length, 1)
  assert.equal(rides[0].title, 'Neue Fahrt')
  assert.equal(rides[0].km, 42)
  assert.equal(typeof rides[0].id, 'string')
  assert.deepEqual(h.meldungen, ['Eintrag gespeichert ✓'])
  assert.deepEqual(h.renders, ['journal'])
})

test('bestehende Kartenfahrt bleibt beim Anlegen und Bearbeiten vollständig erhalten', async () => {
  const h = journal()
  const alt = alterEintrag({ track: h.track, zusatzfeld: { quelle: 'karte' } })
  h.speicher.setItem(RIDES, JSON.stringify([alt]))
  await h.element('rj-form').fire('submit')
  assert.deepEqual(gespeichert(h.speicher)[0], alt)
  h.element('rj-edit-id').value = 'alt'
  await h.element('rj-edit-form').fire('submit')
  const rides = gespeichert(h.speicher)
  assert.equal(rides.length, 2)
  assert.equal(rides[0].title, 'Bearbeitet')
  assert.deepEqual(rides[0].track, h.track)
  assert.deepEqual(rides[0].zusatzfeld, { quelle: 'karte' })
  assert.equal(rides[0].id, 'alt')
  assert.equal(rides[1].title, 'Neue Fahrt')
})

test('echter Karten-Speicherpfad und Profil-Fahrtenbuch bleiben kompatibel', async () => {
  const h = journal()
  const vorher = globalThis.localStorage
  const vorherigerOrt = globalThis.location
  globalThis.localStorage = h.speicher
  globalThis.location = { origin: 'http://localhost:5173' }
  try {
    const { speichereFahrt, alleEigenen } = await import('../src/js/eigene-strecken.js')
    assert.equal(speichereFahrt(h.track, 'Kartenfahrt'), 'fahrt-auf-test')
    await h.element('rj-form').fire('submit')
    h.element('rj-edit-id').value = 'auf-test'
    await h.element('rj-edit-form').fire('submit')
    const rides = gespeichert(h.speicher)
    assert.equal(rides.length, 2)
    assert.deepEqual(rides[0].track, h.track)
    assert.equal(alleEigenen().find(ride => ride.id === 'fahrt-auf-test')?.name, 'Bearbeitet')
  } finally {
    if (vorher === undefined) delete globalThis.localStorage
    else globalThis.localStorage = vorher
    if (vorherigerOrt === undefined) delete globalThis.location
    else globalThis.location = vorherigerOrt
  }
})

test('Fahrt wird gelöscht, andere Fahrten bleiben erhalten', async () => {
  const h = journal()
  const andere = alterEintrag({ id: 'andere', title: 'Andere' })
  h.speicher.setItem(RIDES, JSON.stringify([alterEintrag(), andere]))
  await h.element('rj-edit-delete').fire('click')
  assert.deepEqual(gespeichert(h.speicher), [andere])
  assert.deepEqual(h.meldungen, ['Eintrag gelöscht'])
  assert.deepEqual(h.renders, ['journal'])
})

test('Profil verwirft nur die ursprünglich angezeigte Aufzeichnung und bewahrt einen Ersatz aus anderem Tab', async () => {
  const alt = { id: 'auf-tab-a', start: 1, meter: 1200, punkte: [[50, 8, 0]] }
  const h = journal({ recorder: true, recovery: alt })
  assert.equal(h.element('rj-resume-drop').dataset.recoveryId, alt.id)
  const neu = { fertig: true, track: { id: 'auf-tab-b', punkte: [[51, 9, 0], [51.01, 9.01, 60]] } }
  const roh = JSON.stringify(neu)
  h.speicher.setItem(AKTIV, roh)

  await h.element('rj-resume-drop').fire('click')

  assert.equal(h.speicher.getItem(AKTIV), roh)
  assert.equal(h.element('rj-resume').removed, false)
  assert.match(h.meldungen.at(-1), /geändert|andere Aufzeichnung/i)
})

test('Profil kann den ursprünglich angezeigten eigenen Zwischenstand verwerfen', async () => {
  const h = journal({ recorder: true, recovery: { id: 'auf-tab-a', start: 1, meter: 1200, punkte: [[50, 8, 0]] } })
  await h.element('rj-resume-drop').fire('click')
  assert.equal(h.speicher.getItem(AKTIV), null)
  assert.equal(h.element('rj-resume').removed, true)
})

test('Profil verwirft einen Wiederherstellungsstand ohne ID nicht ungezielt', async () => {
  const alt = { start: 1, meter: 1200, punkte: [[50, 8, 0]] }
  const h = journal({ recorder: true, recovery: alt })
  const roh = h.speicher.getItem(AKTIV)
  await h.element('rj-resume-drop').fire('click')
  assert.equal(h.speicher.getItem(AKTIV), roh)
  assert.equal(h.element('rj-resume').removed, false)
  assert.match(h.meldungen.at(-1), /nicht verworfen|geändert/i)
})

test('voller Speicher: Anlegen behält Eingaben und Bild für erneuten Versuch', async () => {
  const h = journal()
  h.api.setPhoto('data:image/png;base64,dGVzdA==')
  h.element('rj-photo-input').files = [{ name: 'foto.png' }]
  await h.element('rj-photo-input').fire('change')
  h.speicher.schreibfehler = new DOMException('voll', 'QuotaExceededError')
  await h.element('rj-form').fire('submit')
  assert.equal(h.speicher.getItem(RIDES), null)
  assert.equal(h.element('rj-title').value, 'Neue Fahrt')
  assert.equal(h.element('rj-notes').value, 'Notiz')
  assert.equal(h.element('rj-photo-preview').src, 'data:image/png;base64,dGVzdA==')
  assert.equal(h.element('rj-photo-input').files.length, 1)
  assert.match(h.meldungen.at(-1), /Speicher voll/)
  keinErfolg(h)
  h.speicher.schreibfehler = null
  await h.element('rj-form').fire('submit')
  assert.equal(gespeichert(h.speicher).length, 1)
  assert.equal(gespeichert(h.speicher)[0].photo, 'data:image/png;base64,dGVzdA==')
})

test('voller Speicher: Bearbeiten und Löschen verändern vorhandene Rohdaten nicht', async () => {
  const h = journal()
  const raw = JSON.stringify([alterEintrag({ zusatzfeld: ['bleibt'] })])
  h.speicher.setItem(RIDES, raw)
  h.speicher.schreibfehler = new DOMException('voll', 'QuotaExceededError')
  await h.element('rj-edit-form').fire('submit')
  assert.equal(h.speicher.getItem(RIDES), raw)
  assert.equal(h.element('rj-edit-title').value, 'Bearbeitet')
  await h.element('rj-edit-delete').fire('click')
  assert.equal(h.speicher.getItem(RIDES), raw)
  assert.equal(h.meldungen.length, 2)
  keinErfolg(h)
})

test('ungültiges JSON und ungültige Strukturen werden nie überschrieben', async () => {
  for (const raw of ['{kaputt', '{"rides":[]}', 'null', '[null]', '[[]]']) {
    const h = journal()
    h.speicher.setItem(RIDES, raw)
    await h.element('rj-form').fire('submit')
    await h.element('rj-edit-form').fire('submit')
    await h.element('rj-edit-delete').fire('click')
    assert.equal(h.speicher.getItem(RIDES), raw)
    assert.equal(h.element('rj-title').value, 'Neue Fahrt')
    assert.ok(h.meldungen.every(text => /nicht gelesen/.test(text)))
    keinErfolg(h)
  }
})

test('Lesefehler stoppt alle Schreibvorgänge ohne falsche Erfolgsmeldung', async () => {
  const h = journal()
  const raw = JSON.stringify([alterEintrag()])
  h.speicher.setItem(RIDES, raw)
  h.speicher.lesefehler = new DOMException('gesperrt', 'SecurityError')
  await h.element('rj-form').fire('submit')
  await h.element('rj-edit-form').fire('submit')
  await h.element('rj-edit-delete').fire('click')
  assert.equal(h.speicher.daten.get(RIDES), raw)
  assert.ok(h.meldungen.every(text => /nicht gelesen/.test(text)))
  keinErfolg(h)
})

test('fehlgeschlagener Schreibzugriff gibt den Fehler weiter und meldet keinen Erfolg', async () => {
  const h = journal()
  h.speicher.schreibfehler = new DOMException('gesperrt', 'SecurityError')
  assert.throws(() => h.api.saveRides([]), { name: 'SecurityError' })
  await h.element('rj-form').fire('submit')
  assert.equal(h.speicher.getItem(RIDES), null)
  assert.match(h.meldungen.at(-1), /nicht gespeichert/)
  keinErfolg(h)
})

test('bereits verwendete ID wird beim Anlegen nicht dupliziert', async () => {
  const now = 1234567890
  const h = journal({ now })
  h.speicher.setItem(RIDES, JSON.stringify([alterEintrag({ id: now.toString(36) })]))
  await h.element('rj-form').fire('submit')
  const ids = gespeichert(h.speicher).map(ride => ride.id)
  assert.equal(new Set(ids).size, 2)
})

test('vorgemerkter Track bleibt nach Speicherfehler für erneuten Versuch erhalten', async () => {
  // Der Schalter wird nur im isolierten Testkontext aktiviert; in account.js bleibt er aus.
  const h = journal({ recorder: true })
  await h.element('rj-start-rec').fire('click')
  await h.element('rj-rec-stop').fire('click')
  h.element('rj-title').value = 'Aufgezeichnet'
  h.speicher.schreibfehler = new DOMException('voll', 'QuotaExceededError')
  await h.element('rj-form').fire('submit')
  assert.equal(h.element('rj-title').value, 'Aufgezeichnet')
  keinErfolg(h)
  h.speicher.schreibfehler = null
  await h.element('rj-form').fire('submit')
  assert.equal(gespeichert(h.speicher).length, 1)
  assert.deepEqual(gespeichert(h.speicher)[0].track, h.track)
})
