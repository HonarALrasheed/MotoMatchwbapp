import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const quelle = readFileSync(new URL('../src/js/aufzeichnen.js', import.meta.url), 'utf8')
const anfang = quelle.indexOf('export async function aufzeichnungStarten(')
const ende = quelle.indexOf('\nexport const zeichnetAuf', anfang)
assert.ok(anfang >= 0 && ende > anfang, 'Aufzeichnungsstart muss im Test auffindbar sein')
const funktion = quelle.slice(anfang, ende)
  .replace('export async function', 'async function')
  .replace("import('./touren.js')", 'Promise.resolve({ tourenKarteLeeren() {} })')

function umgebung(anfangsstand) {
  let roh = JSON.stringify(anfangsstand)
  let antworten
  let starts = 0
  const meldungen = []
  const classList = { add() {}, remove() {} }
  const map = { on() {} }
  const host = { appendChild() {} }
  const document = {
    body: { classList },
    querySelector: (selector) => selector === '.konf-karte-hub .kv-map-wrap' ? host : { classList },
    createElement: () => ({ classList, addEventListener() {}, innerHTML: '' }),
  }
  const context = vm.createContext({
    Promise, document, getHubMap: () => map, standortVerfuegbar: () => true,
    unterbrocheneAufzeichnung: () => JSON.parse(roh || 'null'),
    ladeUnterbrocheneAufzeichnung: async () => JSON.parse(roh || 'null'),
    verwerfeUnterbrochene: (erwarteteId = null) => {
      const offen = JSON.parse(roh || 'null')
      if (erwarteteId && offen?.id !== erwarteteId) return false
      roh = null
      return true
    },
    verwerfeGesicherteAufzeichnung: async (erwarteteId = null) => {
      const offen = JSON.parse(roh || 'null')
      const id = offen?.fertig ? offen.track?.id : offen?.id
      if (erwarteteId && id !== erwarteteId) return false
      roh = null
      return true
    },
    fragen: () => new Promise((resolve) => { antworten = resolve }),
    hinweisen: (...meldung) => meldungen.push(meldung),
    ziehbar() {}, ebene() {}, getUserCoords: () => ({ lat: null }),
    starteAufzeichnung: async () => { starts++; return { stand: () => ({}) } },
    zeige() {},
  })
  vm.runInContext(`let lauf = null;\n${funktion}\nglobalThis.start = aufzeichnungStarten`, context)
  return {
    start: context.start,
    antworten: async (antwort) => {
      for (let i = 0; i < 100 && typeof antworten !== 'function'; i++) await new Promise((resolve) => setTimeout(resolve, 0))
      if (typeof antworten !== 'function') throw new Error('Dialog wurde nicht geöffnet')
      antworten(antwort)
    },
    ersetzen: (stand) => { roh = JSON.stringify(stand) },
    roh: () => roh,
    meldungen,
    starts: () => starts,
  }
}

const a = { id: 'auf-tab-a', start: 1, punkte: [[50, 8, 0]] }
const nachfolger = [
  { id: 'auf-tab-b', start: 2, punkte: [[51, 9, 0]] },
  { fertig: true, track: { id: 'auf-tab-b', punkte: [[51, 9, 0], [51.01, 9.01, 60]] } },
]

for (const b of nachfolger) {
  test(`Kartenaufzeichnung bewahrt fremden ${b.fertig ? 'fertigen' : 'laufenden'} Zwischenstand nach Dialog`, async () => {
    const u = umgebung(a)
    const start = u.start()
    const fremd = JSON.stringify(b)
    u.ersetzen(b)
    await u.antworten(false)
    await start

    assert.equal(u.roh(), fremd)
    assert.equal(u.starts(), 0)
    assert.match(u.meldungen.at(-1)?.join(' '), /geändert|andere Aufzeichnung/i)
  })
}

test('Kartenaufzeichnung verwirft den bestätigten eigenen Zwischenstand und startet neu', async () => {
  const u = umgebung(a)
  const start = u.start()
  await u.antworten(false)
  await start
  assert.equal(u.roh(), null)
  assert.equal(u.starts(), 1)
})

test('Kartenaufzeichnung verwirft einen Zwischenstand ohne ID nicht ungezielt', async () => {
  const u = umgebung({ start: 1, punkte: [[50, 8, 0]] })
  const roh = u.roh()
  const start = u.start()
  await u.antworten(false)
  await start
  assert.equal(u.roh(), roh)
  assert.equal(u.starts(), 0)
  assert.match(u.meldungen.at(-1)?.join(' '), /nicht verworfen|geändert/i)
})
