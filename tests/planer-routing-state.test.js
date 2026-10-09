import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createPlannerDraftStore } from '../src/js/planner-draft.js'

const quelle = readFileSync(new URL('../src/js/planer.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '')
  .replace('export async function planerOeffnen', 'async function planerOeffnen')
  .replace('export const plantGerade', 'const plantGerade')
  .replace("await import('./touren.js')", '({ tourenKarteLeeren: globalThis.tourenKarteLeeren })')
  .replace("await import('./tour-fahren.js')", '({ fahrtVorbereiten: globalThis.fahrtVorbereiten })')

function verzögert() {
  let resolve, reject
  const promise = new Promise((ja, nein) => { resolve = ja; reject = nein })
  return { promise, resolve, reject }
}

function routeDaten(n = 1) {
  return {
    pts: [[50, 8], [50 + n / 100, 8 + n / 100]], kum: [0, n * 1400],
    schritte: [[0, 'depart', '', '', 0], [n * 1400, 'arrive', '', '', 0]],
    hoehen: [100, 110], meter: n * 1400, sekunden: n * 120, auf: 10, ab: 0,
  }
}

function umgebung(routeMock, { eingeben = async () => 'Teststrecke', speichern = () => 'id-1', karte = null } = {}) {
  const meldungen = [], speicherungen = [], navigationen = []
  const draftData = new Map()
  const draftStorage = {
    getItem: (key) => draftData.get(key) ?? null,
    setItem: (key, value) => draftData.set(key, value),
    removeItem: (key) => draftData.delete(key),
  }
  const info = { innerHTML: '' }, mini = { innerHTML: '' }, vorschlag = { hidden: false }
  const liste = {
    innerHTML: '', scrollTop: 0,
    addEventListener() {}, removeEventListener() {},
    querySelector(sel) {
      if (sel === '#plan-mini') return mini
      if (sel === '[data-plan="zurueck"]' || sel === '[data-plan="leeren"]' || sel === '[data-plan="standort"]' || sel === '.plan-vorschlag-karte') return { disabled: false, hidden: false }
      return null
    },
  }
  const document = {
    getElementById(id) { return id === 'tour-liste' ? liste : id === 'plan-info' ? info : id === 'plan-vorschlag' ? vorschlag : null },
    querySelector() { return null }, dispatchEvent() {}, body: { classList: { add() {}, remove() {} } },
  }
  class RoutingFehler extends Error {
    constructor(code, message, kind = code) { super(message); this.code = code; this.kind = kind }
  }
  const context = vm.createContext({
    document, window: { matchMedia: () => ({ matches: false }) }, navigator: {}, CustomEvent: class {},
    AbortController, setTimeout, clearTimeout,
    createPlannerDraftStore: () => createPlannerDraftStore({ storage: draftStorage }),
    esc: (s) => s, hinweisen: (...args) => meldungen.push(args), eingeben,
    getHubMap: () => karte, getMapLib: () => null, haversineKm: () => 5,
    getUserCoords: () => ({ lat: null, lng: null }), resolveOrt: async () => ({ ok: false }), sucheAdressen: async () => [],
    route: routeMock, naechster: () => ({ index: 0 }), RoutingFehler, streckenIn: async () => [],
    speichereStrecke: (daten) => { speicherungen.push(daten); return speichern(daten) },
    profilAus: () => [], alsTour: (daten) => daten, kurvigkeit: () => 100, PRAEFIX: 'eig-',
    tourenKarteLeeren() {},
    fahrtVorbereiten: (...args) => navigationen.push(args),
  })
  vm.runInContext(`${quelle}\nglobalThis.pruefung = { neuRechnen, planKlick, aufKarteGetippt, planerOeffnen, renderInfo, aktuellesErgebnis, schliessen, plannerDraft, setPlan: (p) => { plan = p }, getPlan: () => plan }`, context)
  const api = context.pruefung
  const plan = {
    punkte: [[50, 8], [50.01, 8.01]], marker: [], modus: 'schnell', rund: false,
    ergebnis: null, ergebnisSignatur: null, rechnet: false, lauf: 0, abbruch: null,
    vorschlagVias: null, vorschlagKm: null, fehler: null, verlauf: [], fertig() {},
  }
  api.setPlan(plan)
  const klick = (art, wert) => api.planKlick({
    target: { closest(sel) {
      return sel === `[data-${art}]` ? { dataset: { [art === 'plan' ? 'plan' : art === 'vorschlag-km' ? 'vorschlagKm' : art === 'plan-modus' ? 'planModus' : art === 'plan-rund' ? 'planRund' : 'planWeg']: wert } } : null
    } }, currentTarget: { removeEventListener() {} },
  })
  return { api, plan, info, mini, vorschlag, meldungen, speicherungen, navigationen, draftData, klick, RoutingFehler }
}

function testKarte() {
  return {
    __mmBereit: true,
    queryRenderedFeatures: () => [], getLayer: () => null, getSource: () => null,
    fitBounds() {}, off() {}, on() {}, addSource() {}, addLayer() {}, getZoom: () => 12,
    getCanvas: () => ({ classList: { add() {}, remove() {} } }),
  }
}

function kartenPunkt(u, lat, lng) {
  u.api.aufKarteGetippt({ point: { x: 0, y: 0 }, lngLat: { lat, lng } })
}

const planBerechnet = () => new Promise((resolve) => setImmediate(resolve))

test('wiederhergestellter Planer zeigt Draft und startet ohne ausdrückliche Aktion keine Route', async () => {
  let routeCalls = 0
  const u = umgebung(async () => { routeCalls++; return routeDaten() }, { karte: testKarte() })
  u.api.plannerDraft.save({ points: [[50, 8], [50.01, 8.01]], mode: 'schnell', roundTrip: false, startMissing: false })
  await u.api.planerOeffnen()
  assert.equal(routeCalls, 0)
  assert.equal(u.api.getPlan().wiederhergestellt, true)
  assert.match(u.info.innerHTML, /Entwurf wiederhergestellt/)
  assert.match(u.info.innerHTML, /Route neu berechnen/)
})

test('erfolgreiche Start-Ziel-Route ist aktuell und kann gespeichert werden', async () => {
  const u = umgebung(async () => routeDaten())
  await u.api.neuRechnen()
  assert.equal(u.api.aktuellesErgebnis(u.plan), u.plan.ergebnis)
  assert.match(u.info.innerHTML, /data-plan="speichern"/)
  await u.klick('plan', 'speichern')
  assert.equal(u.speicherungen.length, 1)
  assert.equal(u.speicherungen[0].art, 'geplant')
  assert.equal(u.api.getPlan(), null)
})

test('Zwischenpunktänderung bricht alte Berechnung ab und übernimmt nur die neue Antwort', async () => {
  const alt = verzögert(), neu = verzögert(), aufrufe = []
  const u = umgebung((punkte, opts) => { aufrufe.push({ punkte, signal: opts.signal }); return aufrufe.length === 1 ? alt.promise : neu.promise })
  const erster = u.api.neuRechnen()
  u.plan.punkte.push([50.02, 8.02])
  const zweiter = u.api.neuRechnen()
  assert.equal(aufrufe[0].signal.aborted, true)
  neu.resolve(routeDaten(2))
  await zweiter
  alt.resolve(routeDaten(1))
  await erster
  assert.equal(u.plan.ergebnis.meter, 2800)
  assert.equal(aufrufe[1].punkte.length, 3)
})

test('mehrere schnelle Berechnungen ignorieren verspätete Antworten in jeder Reihenfolge', async () => {
  const warten = [verzögert(), verzögert(), verzögert()]
  let n = 0
  const u = umgebung(() => warten[n++].promise)
  const laeufe = [u.api.neuRechnen()]
  u.plan.punkte[1] = [50.02, 8.02]; laeufe.push(u.api.neuRechnen())
  u.plan.punkte[1] = [50.03, 8.03]; laeufe.push(u.api.neuRechnen())
  warten[2].resolve(routeDaten(3)); await laeufe[2]
  warten[0].resolve(routeDaten(1)); warten[1].resolve(routeDaten(2))
  await Promise.all(laeufe.slice(0, 2))
  assert.equal(u.plan.ergebnis.meter, 4200)
  assert.equal(u.plan.rechnet, false)
})

test('kurvige Via-Suche startet für überholte Eingaben keine Routinganfrage mehr', async () => {
  const anfragen = []
  const u = umgebung(async (punkte) => { anfragen.push(punkte); return routeDaten() })
  u.plan.modus = 'kurvig'
  const alt = u.api.neuRechnen()
  u.plan.punkte[1] = [50.02, 8.02]
  const neu = u.api.neuRechnen()
  await Promise.all([alt, neu])
  assert.equal(anfragen.length, 1)
  assert.equal(anfragen[0][1][0], 50.02)
})

test('Leeren entwertet auch ohne neue Route die laufende Antwort', async () => {
  const alt = verzögert()
  const u = umgebung(() => alt.promise)
  const lauf = u.api.neuRechnen()
  await u.klick('plan', 'leeren')
  assert.equal(u.plan.punkte.length, 0)
  assert.equal(u.plan.rechnet, false)
  alt.resolve(routeDaten())
  await lauf
  assert.equal(u.api.aktuellesErgebnis(u.plan), null)
  assert.doesNotMatch(u.info.innerHTML, /data-plan="fahren"/)
})

test('Fehler bei unveränderten Eingaben erhält gültige Route und zeigt Fehler', async () => {
  let n = 0
  const u = umgebung(async () => { if (++n === 1) return routeDaten(); throw new Error('offline') })
  await u.api.neuRechnen()
  const vorher = u.plan.ergebnis
  await u.api.neuRechnen()
  assert.equal(u.api.aktuellesErgebnis(u.plan), vorher)
  assert.match(u.info.innerHTML, /Die Route konnte nicht berechnet werden/)
  assert.match(u.info.innerHTML, /data-plan="speichern"/)
})

test('Fehler nach geänderten Eingaben lässt alte Route weder anzeigen noch speichern', async () => {
  let n = 0
  const u = umgebung(async () => { if (++n === 1) return routeDaten(); throw new Error('offline') })
  await u.api.neuRechnen()
  u.plan.punkte[1] = [50.02, 8.02]
  await u.api.neuRechnen()
  assert.equal(u.api.aktuellesErgebnis(u.plan), null)
  assert.doesNotMatch(u.info.innerHTML, /data-plan="speichern"/)
  await u.klick('plan', 'speichern')
  assert.equal(u.speicherungen.length, 0)
})

test('Timeout zeigt die Routing-Meldung und hält eine veraltete Route gesperrt', async () => {
  let n = 0
  const u = umgebung(async () => { if (++n === 1) return routeDaten(); throw new u.RoutingFehler('timeout', 'Zeitüberschreitung', 'timeout') })
  await u.api.neuRechnen()
  u.plan.punkte[1] = [50.02, 8.02]
  await u.api.neuRechnen()
  assert.match(u.info.innerHTML, /Zeitüberschreitung/)
  assert.equal(u.plan.rechnet, false)
  assert.equal(u.api.aktuellesErgebnis(u.plan), null)
})

test('Netzwerk-, HTTP- und Validierungsfehler setzen den Ladezustand zurück', async () => {
  for (const [code, kind] of [['offline', 'netzwerk'], ['quota', 'http'], ['invalid_response', 'validierung']]) {
    let u
    u = umgebung(async () => { throw new u.RoutingFehler(code, `Fehler ${code}`, kind) })
    await u.api.neuRechnen()
    assert.equal(u.plan.rechnet, false)
    assert.match(u.info.innerHTML, new RegExp(`Fehler ${code}`))
    assert.doesNotMatch(u.info.innerHTML, /data-plan="fahren"/)
  }
})

test('bewusster Abbruch einer überholten Berechnung zeigt keinen Netzwerkfehler', async () => {
  let n = 0
  const u = umgebung((_, { signal }) => {
    if (++n === 2) return Promise.resolve(routeDaten(2))
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new u.RoutingFehler('abbruch', 'Abgebrochen', 'abbruch')), { once: true }))
  })
  const alt = u.api.neuRechnen()
  u.plan.punkte[1] = [50.02, 8.02]
  await u.api.neuRechnen()
  await alt
  assert.equal(u.plan.fehler, null)
  assert.equal(u.plan.ergebnis.meter, 2800)
  assert.equal(u.plan.abbruch, null)
})

test('veraltete Speichern- und Losfahren-Klicks bleiben ohne Wirkung', async () => {
  const u = umgebung(async () => routeDaten())
  await u.api.neuRechnen()
  u.plan.punkte[1] = [50.02, 8.02]
  await u.klick('plan', 'speichern')
  await u.klick('plan', 'fahren')
  assert.equal(u.speicherungen.length, 0)
  assert.equal(u.navigationen.length, 0)
  assert.equal(u.api.getPlan(), u.plan)
})

test('Änderung während der Namenseingabe verhindert das Speichern auch bei gleichen Eingaben danach', async () => {
  const name = verzögert()
  const u = umgebung(async () => routeDaten(), { eingeben: () => name.promise })
  await u.api.neuRechnen()
  const speichern = u.klick('plan', 'speichern')
  await u.api.neuRechnen()
  name.resolve('Meine Route')
  await speichern
  assert.equal(u.speicherungen.length, 0)
  assert.equal(u.meldungen[0][0], 'Nicht gespeichert')
})

test('Speicherfehler meldet keinen Erfolg und lässt den Planer offen', async () => {
  const u = umgebung(async () => routeDaten(), { speichern: () => { throw new Error('Speicher voll') } })
  await u.api.neuRechnen()
  await u.klick('plan', 'speichern')
  assert.equal(u.api.getPlan(), u.plan)
  assert.deepEqual(u.meldungen[0], ['Nicht gespeichert', 'Speicher voll'])
})

test('gültige Route startet Navigation mit denselben gespeicherten Routendaten', async () => {
  const u = umgebung(async () => routeDaten())
  await u.api.neuRechnen()
  await u.klick('plan', 'fahren')
  assert.equal(u.speicherungen.length, 1)
  assert.equal(u.navigationen.length, 1)
  assert.equal(u.navigationen[0][1].pts, u.speicherungen[0].pts)
})

test('zwei Rundtourvorgänge übernehmen nur den neueren Satz von sechs Kandidaten', async () => {
  const alt = Array.from({ length: 6 }, verzögert)
  const neu = Array.from({ length: 6 }, verzögert)
  const signale = [], u = umgebung((_, opts) => {
    signale.push(opts.signal)
    return signale.length <= 6 ? alt[signale.length - 1].promise : neu[signale.length - 7].promise
  })
  u.plan.punkte = [[50, 8]]
  const erster = u.klick('vorschlag-km', '60')
  const zweiter = u.klick('vorschlag-km', '100')
  assert.equal(signale.length, 12)
  assert.equal(signale[0].aborted, true)
  neu.forEach((w) => w.resolve(routeDaten(2)))
  await zweiter
  alt.forEach((w) => w.resolve(routeDaten(1)))
  await erster
  assert.equal(u.plan.ergebnis.meter, 2800)
  assert.equal(u.plan.vorschlagKm, 100)
})

test('Rundtour verwendet erfolgreiche Teilantwort trotz fehlgeschlagener Kandidaten', async () => {
  let n = 0
  const u = umgebung(async () => { if (++n === 3) return routeDaten(2); throw new Error('offline') })
  u.plan.punkte = [[50, 8]]
  await u.klick('vorschlag-km', '60')
  assert.equal(n, 6)
  assert.equal(u.plan.ergebnis.meter, 2800)
  assert.equal(u.plan.fehler, null)
  assert.match(u.info.innerHTML, /data-plan="fahren"/)
})

test('entfernter manueller Wegpunkt macht einen alten Rundtourvorschlag nicht wieder speicherbar', async () => {
  let anfragen = 0
  const u = umgebung(async () => {
    if (++anfragen <= 6) return routeDaten(2)
    throw new Error('offline')
  }, { karte: testKarte() })
  u.plan.punkte = [[50, 8]]
  await u.klick('vorschlag-km', '60')
  const vorschlag = u.plan.ergebnis
  assert.equal(u.api.aktuellesErgebnis(u.plan), vorschlag)

  kartenPunkt(u, 50.02, 8.02)
  await planBerechnet()
  assert.equal(u.plan.vorschlagKm, null)
  await u.klick('plan-weg', '1')

  assert.equal(u.plan.punkte.length, 1)
  assert.equal(u.api.aktuellesErgebnis(u.plan), null)
  assert.doesNotMatch(u.info.innerHTML, /data-plan="(?:speichern|fahren)"/)
  await u.klick('plan', 'speichern')
  await u.klick('plan', 'fahren')
  assert.equal(u.speicherungen.length, 0)
  assert.equal(u.navigationen.length, 0)
})

test('mehrfaches Entfernen nach neuen Wegpunkten stellt den alten Vorschlag auch nach Rechenfehlern nicht wieder her', async () => {
  let anfragen = 0
  const u = umgebung(async () => {
    if (++anfragen <= 6) return routeDaten(2)
    throw new Error('offline')
  }, { karte: testKarte() })
  u.plan.punkte = [[50, 8]]
  await u.klick('vorschlag-km', '60')

  kartenPunkt(u, 50.02, 8.02)
  await planBerechnet()
  kartenPunkt(u, 50.03, 8.03)
  await planBerechnet()
  assert.equal(u.plan.punkte.length, 3)
  assert.equal(u.api.aktuellesErgebnis(u.plan), null)

  await u.klick('plan-weg', '2')
  await planBerechnet()
  assert.equal(u.plan.punkte.length, 2)
  assert.equal(u.api.aktuellesErgebnis(u.plan), null)
  await u.klick('plan-weg', '1')
  assert.equal(u.plan.punkte.length, 1)
  assert.equal(u.api.aktuellesErgebnis(u.plan), null)
  assert.doesNotMatch(u.info.innerHTML, /data-plan="(?:speichern|fahren)"/)
})

test('neuer Wegpunkt nach Rundtourvorschlag kann erfolgreich neu berechnet und gestartet werden', async () => {
  let anfragen = 0
  const u = umgebung(async () => routeDaten(++anfragen <= 6 ? 2 : 3), { karte: testKarte() })
  u.plan.punkte = [[50, 8]]
  await u.klick('vorschlag-km', '60')
  const alt = u.plan.ergebnis

  kartenPunkt(u, 50.03, 8.03)
  await planBerechnet()
  const neu = u.api.aktuellesErgebnis(u.plan)
  assert.ok(neu)
  assert.notEqual(neu, alt)
  assert.equal(neu.meter, 4200)
  await u.klick('plan', 'fahren')
  assert.equal(u.speicherungen.length, 1)
  assert.equal(u.navigationen.length, 1)
  assert.equal(u.navigationen[0][1].pts, neu.pts)
})

test('Rundtour ohne brauchbaren Kandidaten zeigt Fehler und keine Erfolgsaktion', async () => {
  const u = umgebung(async () => { throw new Error('offline') })
  u.plan.punkte = [[50, 8]]
  await u.klick('vorschlag-km', '60')
  assert.match(u.info.innerHTML, /keine Rundtour berechnen/)
  assert.doesNotMatch(u.info.innerHTML, /data-plan="speichern"/)
})

test('Leeren bricht alle sechs Rundtouranfragen ab und ignoriert späte Antworten', async () => {
  const warten = Array.from({ length: 6 }, verzögert), signale = []
  const u = umgebung((_, opts) => { signale.push(opts.signal); return warten[signale.length - 1].promise })
  u.plan.punkte = [[50, 8]]
  const lauf = u.klick('vorschlag-km', '60')
  await u.klick('plan', 'leeren')
  assert.equal(signale.every((s) => s.aborted), true)
  warten.forEach((w) => w.resolve(routeDaten()))
  await lauf
  assert.equal(u.api.aktuellesErgebnis(u.plan), null)
  assert.equal(u.plan.punkte.length, 0)
})

test('Rückgängig zur gültigen Rundtour entwertet eine parallel laufende Route', async () => {
  const warten = verzögert()
  const u = umgebung(() => warten.promise)
  const alt = routeDaten(2)
  u.plan.verlauf.push({ punkte: [[50, 8]], rund: true, vorschlagVias: [], vorschlagKm: 60, ergebnis: alt })
  const lauf = u.api.neuRechnen()
  await u.klick('plan', 'zurueck')
  warten.resolve(routeDaten(1))
  await lauf
  assert.equal(u.api.aktuellesErgebnis(u.plan), alt)
  assert.equal(u.plan.ergebnis.meter, 2800)
})

test('Planer-Abbruch lässt unabhängigen Cache-Aufruf im echten Routingmodul bestehen', async () => {
  const altesFetch = globalThis.fetch
  const alterOrt = globalThis.location
  const alterSpeicher = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  globalThis.location = { origin: 'http://localhost:5173' }
  globalThis.localStorage = { getItem: () => null }
  try {
    const { route: echteRoute } = await import('../src/js/routing.js')
    let aufrufe = 0, planerSignal
    const daten = {
      linie: [[50.123, 8.123, 100], [50.133, 8.133, 110]],
      meter: 1400, sekunden: 120, auf: 10, ab: 0,
      schritte: [[0, 'depart', '', '', 0], [1400, 'arrive', '', '', 0]],
    }
    globalThis.fetch = (_, opts) => {
      aufrufe++
      if (aufrufe === 1) { planerSignal = opts.signal; return new Promise(() => {}) }
      return Promise.resolve({ ok: true, status: 200, json: async () => daten })
    }
    const u = umgebung(echteRoute)
    u.plan.punkte = [[50.123, 8.123], [50.133, 8.133]]
    const lauf = u.api.neuRechnen()
    const fremd = echteRoute(u.plan.punkte)
    u.api.schliessen(() => {})
    await lauf
    assert.equal(planerSignal.aborted, true)
    const ergebnis = await fremd
    assert.ok(ergebnis.meter > 0)
    assert.equal(await echteRoute(u.plan.punkte), ergebnis)
    assert.equal(aufrufe, 2)
  } finally {
    globalThis.fetch = altesFetch
    if (alterOrt === undefined) delete globalThis.location
    else globalThis.location = alterOrt
    if (alterSpeicher === undefined) delete globalThis.localStorage
    else Object.defineProperty(globalThis, 'localStorage', alterSpeicher)
  }
})
