import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const vorherigerOrt = globalThis.location
const vorherigerSpeicher = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
globalThis.location = { origin: 'http://localhost:5173' }

const RIDES = 'mm_rides_v1'
const STRECKEN = 'mm_strecken_v1'
const pts = [[50, 8], [50.01, 8.01]]

class BrowserSpeicher {
  daten = new Map()
  lesefehler = new Set()
  schreibfehler = new Map()
  schreibversuche = 0
  getItem(key) {
    if (this.lesefehler.has(key)) throw new DOMException('gesperrt', 'SecurityError')
    return this.daten.get(key) ?? null
  }
  setItem(key, value) {
    this.schreibversuche++
    if (this.schreibfehler.has(key)) throw this.schreibfehler.get(key)
    this.daten.set(key, String(value))
  }
}

const speicher = new BrowserSpeicher()
globalThis.localStorage = speicher
const eigene = await import('../src/js/eigene-strecken.js')
test.beforeEach(() => {
  speicher.daten.clear()
  speicher.lesefehler.clear()
  speicher.schreibfehler.clear()
  speicher.schreibversuche = 0
})
test.after(() => {
  if (vorherigerOrt === undefined) delete globalThis.location
  else globalThis.location = vorherigerOrt
  if (vorherigerSpeicher === undefined) delete globalThis.localStorage
  else Object.defineProperty(globalThis, 'localStorage', vorherigerSpeicher)
})

const faerht = { id: 'auf-alt', title: 'Alt', date: 1, track: {
  id: 'auf-alt', start: 1, km: 2, fahrMs: 1000, punkte: [[50, 8, 0, null], [50.01, 8.01, 60, null]],
}, meta: { bleibt: true } }
const strecke = { id: 'gep-alt', name: 'Alt', art: 'geplant', datum: 1, linie: eigene.kodieren(pts), meta: { bleibt: true } }

const faelle = [
  {
    key: RIDES, id: 'eigen:fahrt-auf-alt', feld: 'title', eintrag: faerht,
    weiterer: { ...faerht, id: 'auf-weiter', title: 'Weiter', track: { ...faerht.track, id: 'auf-weiter' } },
    anlegen: () => eigene.speichereFahrt({ id: 'auf-neu', start: 2, km: 2, fahrMs: 1000, punkte: faerht.track.punkte }, 'Neu'),
  },
  {
    key: STRECKEN, id: 'eigen:gep-alt', feld: 'name', eintrag: strecke,
    weiterer: { ...strecke, id: 'gep-weiter', name: 'Weiter' },
    anlegen: () => eigene.speichereStrecke({ name: 'Neu', art: 'geplant', pts }),
  },
]

function roh(liste, key) {
  const wert = JSON.stringify(liste)
  speicher.daten.set(key, wert)
  return wert
}

for (const f of faelle) {
  test(`${f.key}: Umbenennen erhält ID, Metadaten und andere Einträge`, () => {
    roh([f.eintrag, f.weiterer], f.key)
    assert.equal(eigene.umbenennen(f.id, 'Neuer Name'), true)
    const liste = JSON.parse(speicher.getItem(f.key))
    assert.deepEqual(liste[0], { ...f.eintrag, [f.feld]: 'Neuer Name' })
    assert.deepEqual(liste[1], f.weiterer)
  })

  test(`${f.key}: Löschen entfernt nur den gefundenen Eintrag`, () => {
    roh([f.eintrag, f.weiterer], f.key)
    assert.equal(eigene.loesche(f.id), true)
    assert.deepEqual(JSON.parse(speicher.getItem(f.key)), [f.weiterer])
  })

  test(`${f.key}: fehlendes Ziel und fehlender Schlüssel erzeugen keinen Erfolg und keinen Schreibzugriff`, () => {
    assert.equal(eigene.umbenennen(f.id, 'Neu'), false)
    assert.equal(eigene.loesche(f.id), false)
    assert.equal(speicher.getItem(f.key), null)
    assert.equal(speicher.schreibversuche, 0)
    const alt = roh([f.eintrag], f.key)
    assert.equal(eigene.umbenennen('eigen:unbekannt', 'Neu'), false)
    assert.equal(eigene.loesche('eigen:unbekannt'), false)
    assert.equal(speicher.getItem(f.key), alt)
    assert.equal(speicher.schreibversuche, 0)
  })

  test(`${f.key}: nur fehlender Schlüssel gilt beim Anlegen als leere Liste`, () => {
    f.anlegen()
    assert.equal(JSON.parse(speicher.getItem(f.key)).length, 1)
  })

  test(`${f.key}: beschädigtes JSON und ungültige Listen werden nie überschrieben`, () => {
    const ungueltig = ['{kaputt', 'null', '{}', '[null]', '[42]', '[[]]', '[{}]', '[{"id":"x"},{"id":"x"}]']
    if (f.key === STRECKEN) ungueltig.push('[{"id":"x"}]')
    for (const wert of ungueltig) {
      speicher.daten.set(f.key, wert)
      assert.throws(() => eigene.umbenennen(f.id, 'Neu'), /nicht gelesen/)
      assert.throws(() => eigene.loesche(f.id), /nicht gelesen/)
      assert.throws(f.anlegen, /nicht gelesen/)
      assert.equal(speicher.daten.get(f.key), wert)
      assert.equal(speicher.schreibversuche, 0)
    }
  })

  test(`${f.key}: Lesefehler stoppt Umbenennen, Löschen und Anlegen`, () => {
    const alt = roh([f.eintrag], f.key)
    speicher.lesefehler.add(f.key)
    assert.throws(() => eigene.umbenennen(f.id, 'Neu'), /nicht gelesen/)
    assert.throws(() => eigene.loesche(f.id), /nicht gelesen/)
    assert.throws(f.anlegen, /nicht gelesen/)
    assert.equal(speicher.daten.get(f.key), alt)
    assert.equal(speicher.schreibversuche, 0)
  })

  test(`${f.key}: voller Speicher erhält Rohdaten und meldet den Grund`, () => {
    const alt = roh([f.eintrag], f.key)
    speicher.schreibfehler.set(f.key, new DOMException('voll', 'QuotaExceededError'))
    assert.throws(() => eigene.umbenennen(f.id, 'Neu'), /Speicher.*voll/)
    assert.throws(() => eigene.loesche(f.id), /Speicher.*voll/)
    assert.throws(f.anlegen, /Speicher.*voll/)
    assert.equal(speicher.daten.get(f.key), alt)
  })

  test(`${f.key}: sonstiger Schreibfehler bleibt sichtbar und erhält Rohdaten`, () => {
    const alt = roh([f.eintrag], f.key)
    speicher.schreibfehler.set(f.key, new DOMException('gesperrt', 'SecurityError'))
    assert.throws(() => eigene.umbenennen(f.id, 'Neu'), /nicht gespeichert/)
    assert.throws(() => eigene.loesche(f.id), /nicht gespeichert/)
    assert.throws(f.anlegen, /nicht gespeichert/)
    assert.equal(speicher.daten.get(f.key), alt)
  })
}

test('geplante Strecke erhält bei Zeitstempel-Kollision eine eindeutige ID', () => {
  const original = Date.now
  const zeit = 1234567890
  Date.now = () => zeit
  try {
    const alt = { ...strecke, id: `gep-${zeit.toString(36)}` }
    roh([alt], STRECKEN)
    const id = eigene.speichereStrecke({ name: 'Neu', art: 'geplant', pts })
    const liste = JSON.parse(speicher.getItem(STRECKEN))
    assert.notEqual(id, alt.id)
    assert.equal(new Set(liste.map((s) => s.id)).size, 2)
    assert.deepEqual(liste[1], alt)
  } finally { Date.now = original }
})

test('geplante, importierte und geteilte Strecken überschreiben beschädigte Rohdaten nicht', () => {
  for (const art of ['geplant', 'importiert', 'geteilt']) {
    const alt = '{kaputt'
    speicher.daten.set(STRECKEN, alt)
    assert.throws(() => eigene.speichereStrecke({ name: 'Neu', art, pts }), /nicht gelesen/)
    assert.equal(speicher.daten.get(STRECKEN), alt)
    speicher.daten.delete(STRECKEN)
    assert.ok(eigene.speichereStrecke({ name: 'Neu', art, pts }).startsWith(`${art.slice(0, 3)}-`))
  }
})

const tourenQuelle = readFileSync(new URL('../src/js/touren.js', import.meta.url), 'utf8')
const anfang = tourenQuelle.indexOf("if (e.target.closest('[data-umbenennen]'))")
const ende = tourenQuelle.indexOf("if (e.target.closest('[data-flug]'))", anfang)
assert.ok(anfang >= 0 && ende > anfang, 'Touren-Aktionen müssen im Test auffindbar sein')
const aktionen = tourenQuelle.slice(anfang, ende)

const geteiltAnfang = tourenQuelle.indexOf('function geteilteUebernehmen()')
const geteiltEnde = tourenQuelle.indexOf('/**\n * Touren-Ansicht verdrahten', geteiltAnfang)
assert.ok(geteiltAnfang >= 0 && geteiltEnde > geteiltAnfang, 'Übernahme geteilter Strecken muss im Test auffindbar sein')
const geteiltCode = tourenQuelle.slice(geteiltAnfang, geteiltEnde)

function geteilteAktion() {
  const zwischen = new Map([['mm_strecke_import', '#strecke=test']])
  const meldungen = [], gezeigt = []
  const context = vm.createContext({
    sessionStorage: {
      getItem: key => zwischen.get(key) ?? null,
      removeItem: key => zwischen.delete(key),
    },
    ausLink: () => ({ name: 'Geteilt', pts }),
    speichereStrecke: eigene.speichereStrecke,
    zeigeEigene: id => gezeigt.push(id),
    hinweis: text => meldungen.push(text),
    PRAEFIX: eigene.PRAEFIX,
  })
  vm.runInContext(`${geteiltCode}\nglobalThis.uebernehmen = geteilteUebernehmen`, context)
  return { zwischen, meldungen, gezeigt, ausloesen: () => context.uebernehmen() }
}

test('geteilte Strecke bleibt bei Speicherfehler erneut übernehmbar und meldet den Fehler', () => {
  const ui = geteilteAktion()
  speicher.schreibfehler.set(STRECKEN, new DOMException('voll', 'QuotaExceededError'))
  assert.equal(ui.ausloesen(), false)
  assert.equal(ui.zwischen.get('mm_strecke_import'), '#strecke=test')
  assert.equal(speicher.daten.has(STRECKEN), false)
  assert.deepEqual(ui.gezeigt, [])
  assert.match(ui.meldungen.at(-1), /Speicher.*voll/)
  speicher.schreibfehler.clear()
  assert.equal(ui.ausloesen(), true)
  assert.equal(ui.zwischen.has('mm_strecke_import'), false)
  assert.equal(JSON.parse(speicher.getItem(STRECKEN)).length, 1)
  assert.equal(ui.gezeigt.length, 1)
  assert.equal(ui.meldungen.at(-1), 'Geteilte Strecke gespeichert')
})

function tourenAktionen(f, { name = 'Neuer Name', bestaetigt = true } = {}) {
  const zustand = { offeneTour: f.id }
  const meldungen = []
  let cacheNeuladen = 0, geoeffnet = 0, listeGerendert = 0
  const context = vm.createContext({
    zustand, findeTour: () => ({ id: f.id, name: 'Alt' }),
    eingeben: async () => name, fragen: async () => bestaetigt,
    umbenennen: eigene.umbenennen, loesche: eigene.loesche,
    eigeneGeaendert: () => { cacheNeuladen++ },
    oeffneTour: () => { geoeffnet++ },
    renderListe: () => { listeGerendert++ },
    hinweis: text => meldungen.push(text),
  })
  vm.runInContext(`async function aktion(e) { ${aktionen} } globalThis.aktion = aktion`, context)
  return {
    zustand, meldungen,
    zaehler: () => ({ cacheNeuladen, geoeffnet, listeGerendert }),
    async ausloesen(art) {
      await context.aktion({ target: { closest: sel => sel === `[data-${art}]` ? {} : null } })
      await new Promise(resolve => setImmediate(resolve))
    },
  }
}

for (const f of faelle) {
  test(`${f.key}: Tourenansicht bleibt nach fehlgeschlagenem Umbenennen und Löschen offen`, async () => {
    const alt = roh([f.eintrag], f.key)
    speicher.schreibfehler.set(f.key, new DOMException('voll', 'QuotaExceededError'))
    const ui = tourenAktionen(f)
    await ui.ausloesen('umbenennen')
    await ui.ausloesen('loeschen')
    assert.equal(speicher.daten.get(f.key), alt)
    assert.equal(ui.zustand.offeneTour, f.id)
    assert.deepEqual(ui.zaehler(), { cacheNeuladen: 0, geoeffnet: 0, listeGerendert: 0 })
    assert.equal(ui.meldungen.length, 2)
    assert.ok(ui.meldungen.every(text => /Speicher.*voll/.test(text)))
  })

  test(`${f.key}: Tourenansicht meldet fehlendes Ziel und schließt nicht`, async () => {
    const ui = tourenAktionen(f)
    await ui.ausloesen('umbenennen')
    await ui.ausloesen('loeschen')
    assert.equal(ui.zustand.offeneTour, f.id)
    assert.deepEqual(ui.zaehler(), { cacheNeuladen: 0, geoeffnet: 0, listeGerendert: 0 })
    assert.equal(ui.meldungen.length, 2)
    assert.ok(ui.meldungen.every(text => /nicht gefunden/.test(text)))
  })

  test(`${f.key}: Tourenansicht meldet Lesefehler und bleibt offen`, async () => {
    const alt = roh([f.eintrag], f.key)
    speicher.lesefehler.add(f.key)
    const ui = tourenAktionen(f)
    await ui.ausloesen('umbenennen')
    await ui.ausloesen('loeschen')
    assert.equal(speicher.daten.get(f.key), alt)
    assert.equal(ui.zustand.offeneTour, f.id)
    assert.deepEqual(ui.zaehler(), { cacheNeuladen: 0, geoeffnet: 0, listeGerendert: 0 })
    assert.equal(ui.meldungen.length, 2)
    assert.ok(ui.meldungen.every(text => /nicht gelesen/.test(text)))
  })

  test(`${f.key}: Tourenansicht wechselt erst nach erfolgreichem Speichern`, async () => {
    roh([f.eintrag], f.key)
    const ui = tourenAktionen(f)
    await ui.ausloesen('umbenennen')
    assert.deepEqual(ui.zaehler(), { cacheNeuladen: 1, geoeffnet: 1, listeGerendert: 0 })
    assert.equal(JSON.parse(speicher.getItem(f.key))[0][f.feld], 'Neuer Name')
    await ui.ausloesen('loeschen')
    assert.deepEqual(ui.zaehler(), { cacheNeuladen: 2, geoeffnet: 1, listeGerendert: 1 })
    assert.equal(ui.zustand.offeneTour, null)
    assert.deepEqual(JSON.parse(speicher.getItem(f.key)), [])
    assert.deepEqual(ui.meldungen, [])
  })
}
