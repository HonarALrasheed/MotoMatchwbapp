import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const katalog = JSON.parse(await readFile(new URL('../public/data/katalog-de.json', import.meta.url), 'utf8'))
const fetchAlt = globalThis.fetch
globalThis.fetch = async (url) => {
  assert.equal(url, '/data/katalog-de.json')
  return { ok: true, json: async () => katalog }
}

const matching = await import('../src/js/matching.js')
await matching.ladeVollkatalog()
globalThis.fetch = fetchAlt

test('A2-Naked-Profil liefert fünf valide, passend sortierte Vollkatalog-Treffer', () => {
  const results = matching.findTopMatches({
    q1: 'A2', q2: 'Anfänger', q3: 'Naked', q4: 'Pendeln',
    q5: 7000, q6: 175, q7: 'Ja', q9: 'mittel',
  })

  assert.equal(results.length, 5)
  assert.equal(results[0].bike.name, 'KTM 390 Duke')
  assert.ok(results.every(({ bike }) => bike.license === 'A2' && bike.style === 'Naked'))
  assert.equal(new Set(results.map(({ bike }) => bike.id)).size, results.length)
  assert.ok(results.every(({ score, pct, bike }) => Number.isFinite(score) && pct >= 0 && pct <= 100 &&
    Number.isFinite(bike.price) && bike.price > 0 && bike.price <= 7000))
  assert.deepEqual(results.map(({ pct }) => pct), [96, 94, 92, 91, 90])
})

test('Match-Animation und angezeigte Treffer teilen dieselbe Top-Empfehlung', () => {
  const answers = { q1: 'A2', q2: 'Anfänger', q3: 'Naked', q4: 'Pendeln',
    q5: 7000, q6: 175, q7: 'Ja', q9: 'mittel' }
  assert.equal(matching.findBestBike(answers).id, matching.findTopMatches(answers)[0].bike.id)
})

test('mehrere Motorradtypen werden als ODER gefiltert und Aliasnamen werden normalisiert', () => {
  const answers = { q1: 'A2', q2: 'Anfänger', q3: ['Naked Bike', 'Supersportler'], q4: 'Pendeln',
    q5: 12000, q6: 175, q7: 'Nein', q9: 'mittel' }
  const results = matching.findTopMatches(answers)
  assert.equal(results.length, 5)
  assert.ok(results.every(({ bike }) => ['Naked', 'Sportbike'].includes(bike.style)))
  for (const name of ['KTM 390 Duke', 'Aprilia RS 660']) {
    const bike = matching.findBikeByShortName(name)
    assert.equal(matching.scoreBikeAgainst(bike, answers).breakdown.style, 45)
  }
  assert.deepEqual(matching.normalizeStyleSelections(['Naked Bike', 'Naked', 'Supersportler']), ['Naked', 'Sportbike'])
  assert.deepEqual(matching.normalizeStyleSelections('Egal'), [])
})

test('wesentliche Antworten verändern die Rangfolge und gesetzliche Klasse bleibt hart', () => {
  const basis = { q1: 'A2', q2: 'Anfänger', q3: 'Naked', q4: 'Pendeln', q5: 7000,
    q6: 175, q7: 'Ja', q9: 'mittel' }
  const reiseprofil = { ...basis, q3: 'Touring', q4: 'Urlaub', q5: 18000, q6: 190, q7: 'Ja', q9: 'voll' }
  const commuter = matching.findTopMatches(basis)
  const tourer = matching.findTopMatches(reiseprofil)
  assert.notEqual(commuter[0].bike.id, tourer[0].bike.id)
  assert.ok(commuter.every(({ bike }) => bike.license === 'A2' || bike.a2))
  assert.ok(tourer.every(({ bike }) => bike.license === 'A2' || bike.a2))
})

test('Zufallsbike respektiert Typfilter, vermeidet Wiederholung und behandelt Einzelpools', () => {
  const all = matching.getCatalog()
  const draws = Array.from({ length: 5 }, () => matching.pickRandomBike({ style: 'Supersportler', random: () => 0 }))
  assert.ok(draws.every((bike) => bike?.name && bike.style === 'Sportbike' && Number.isFinite(bike.id)))
  assert.ok(draws.every((bike, i) => i === 0 || bike.name !== draws[i - 1].name))
  const mixedDraw = matching.pickRandomBike({ style: ['Naked', 'Supersportler'], random: () => 0 })
  assert.ok(['Naked', 'Sportbike'].includes(mixedDraw.style))
  assert.equal(matching.pickRandomBike({ style: ['Naked', 'Egal'] }), null)
  assert.equal(matching.pickRandomBike({ style: 'kein-motorradtyp' }), null)

  const only = all.find((bike) => bike.style === 'Roller')
  matching.setCatalog([only])
  try {
    assert.equal(matching.pickRandomBike({ style: 'Roller', random: () => 0 }).name, only.name)
    assert.equal(matching.pickRandomBike({ style: 'Roller', random: () => 0 }).name, only.name)
  } finally {
    matching.setCatalog(all)
  }
})
