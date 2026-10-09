import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const catalogData = JSON.parse(source('../public/data/katalog-de.json'))

test('Homepage- und Quiz-Einstieg zeigen fuer dieselbe Z900 denselben Vollkatalogpreis', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url) => {
    assert.equal(url, '/data/katalog-de.json')
    return { ok: true, json: async () => catalogData }
  }

  try {
    const matching = await import(`../src/js/matching.js?homepage-price-${Date.now()}`)
    const showroomSeed = matching.findBikeByShortName('Z900')
    assert.equal(showroomSeed.name, 'Kawasaki Z900')
    assert.equal(showroomSeed.priceDisplay, 'Preis folgt')

    const homepageDetail = await matching.resolveBikeDetail('Z900')
    const quizDetail = matching.findBikeByShortName('Kawasaki Z900')
    assert.equal(homepageDetail.catalogLoaded, true)
    assert.equal(homepageDetail.bike, quizDetail)
    assert.equal(homepageDetail.bike.priceDisplay, 'ca. 10.213 €')

    const budgetMatch = matching.findBestBike({
      q1: 'A', q2: 'Profi', q3: ['Naked'], q4: 'Pendeln', q5: 8000, q6: 175, q7: 'Nein', q9: 'voll',
    })
    assert.equal(budgetMatch.name, 'Kawasaki Z900')
    assert.equal(budgetMatch.priceDisplay, 'ca. 7.523 €')
    const quizDetailRecord = matching.canonicalBikeForDetail(budgetMatch)
    assert.equal(quizDetailRecord, homepageDetail.bike)
    assert.equal(quizDetailRecord.priceDisplay, homepageDetail.bike.priceDisplay)

    const garage = source('../src/js/garage.js')
    const matchRender = garage.slice(garage.indexOf('export function loadGarage'), garage.indexOf('/**\n * Open the garage page'))
    assert.match(matchRender, /canonicalBikeForDetail\(matchBike\)/)
    assert.match(matchRender, /buildPage\(bikeData, true, topMatches\.hinweis, matchBike\)/)
    const detailOpen = garage.slice(garage.indexOf('export async function openBikeGarage'), garage.indexOf('// ═══ PAGE BUILDER'))
    assert.match(detailOpen, /await resolveBikeDetail\(shortName\)/)
    assert.match(detailOpen, /Motorraddaten werden geladen/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Vollkatalog gibt fuer weitere Preise denselben Eintrag und fuer fehlende Preise nur dann Preis folgt aus', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: true, json: async () => catalogData })

  try {
    const matching = await import(`../src/js/matching.js?homepage-price-records-${Date.now()}`)
    const xsr = await matching.resolveBikeDetail('XSR900')
    assert.equal(xsr.bike.name, 'Yamaha XSR900')
    assert.equal(xsr.bike.priceDisplay, 'ca. 12.220 €')

    const ohnePreis = await matching.resolveBikeDetail('Aprilia RSV4')
    assert.equal(ohnePreis.bike.name, 'Aprilia RSV4')
    assert.equal(ohnePreis.bike.price, undefined)
    assert.equal(ohnePreis.bike.priceNew, undefined)
    assert.equal(ohnePreis.bike.priceUsed, undefined)
    assert.equal(ohnePreis.bike.priceDisplay, 'Preis folgt')
    assert.equal(matching.canonicalBikeForDetail(ohnePreis.bike).priceDisplay, 'Preis folgt')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Homepage-Initialisierung laedt den Vollkatalog nicht eager und Resume wartet auf Detailauflosung', () => {
  const app = source('../src/js/app.js')
  const resumeGarage = app.slice(app.indexOf("if (view.screen !== 'garage')"), app.indexOf('\n}', app.indexOf("if (view.screen !== 'garage')")))
  assert.match(resumeGarage, /await openBikeGarage\(view\.bike\)/)

  const landing = source('../src/js/landing.js')
  const init = landing.slice(landing.indexOf('export function initLanding()'))
  assert.doesNotMatch(init, /ladeVollkatalog\(\)/)
})

test('Ein fehlgeschlagener Vollkatalogabruf zeigt fuer unbekannte Seed-Preise keinen falschen Preis folgt-Status', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 503 })

  try {
    const matching = await import(`../src/js/matching.js?homepage-price-failure-${Date.now()}`)
    const result = await matching.resolveBikeDetail('Z900')
    assert.equal(result.catalogLoaded, false)
    assert.equal(result.bike.priceDisplay, 'Preis folgt')
    assert.equal(matching.canonicalBikeForDetail(result.bike).priceDisplay, 'Preisdaten derzeit nicht verfügbar')
  } finally {
    globalThis.fetch = originalFetch
  }
})
