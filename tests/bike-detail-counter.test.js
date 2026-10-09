import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { FREIGEGEBENE_BIKES } from '../src/js/freigegebene-bikes.js'

const source = readFileSync(new URL('../src/js/bike-detail.js', import.meta.url), 'utf8')
const start = source.indexOf('function counterStart(')
const end = source.indexOf('\nfunction buildAusstattungView(', start)
assert.ok(start >= 0 && end > start, 'Detail-Ansicht muss im Test auffindbar sein')

const context = vm.createContext({
  esc: (value) => String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]),
})
const extracted = source.slice(start, end).replace('export function buildAnsichtView(', 'function buildAnsichtView(')
vm.runInContext(`function mehrStartsOpen() { return false }\n${extracted}\nglobalThis.buildAnsichtView = buildAnsichtView`, context)

const ktm = FREIGEGEBENE_BIKES.find((entry) => entry.name === 'KTM 390 Duke')
assert.ok(ktm, 'KTM 390 Duke muss im freigegebenen Katalog vorhanden sein')
const bike = {
  fullName: 'KTM 390 Duke', desc: '', price: 'Preis folgt', highlights: [], equipment: [],
  specs: {
    accel: '4.5', topSpeed: '167', power: `${ktm.kw} kW / ${ktm.ps} PS`,
    cc: '373', weight: '150', seat: '83', tank: '13.4', gear: '6-Gang', license: 'A2',
  },
}

test('Leistungs- und Technikwerte bleiben korrekt sichtbar, wenn IntersectionObserver nie auslöst', () => {
  const html = context.buildAnsichtView(bike)
  assert.match(html, /data-target="32"[^>]*>32<\/span> kW/)
  assert.match(html, /data-target="44"[^>]*>44<\/span> PS/)
  assert.match(html, /data-target="4\.5"[^>]*>4\.5<\/span> s/)
  assert.match(html, /data-target="167"[^>]*>167<\/span> km\/h/)
})

test('fehlende Leistungsdaten werden nicht als erfundene Nullleistung ausgegeben', () => {
  const html = context.buildAnsichtView({ ...bike, specs: { ...bike.specs, power: '—' } })
  assert.match(html, /<span class="konf-bar-value">—<\/span>/)
  assert.doesNotMatch(html, /data-target="0"[^>]*>0<\/span> kW/)
})

test('freigegebener Motorradkatalog enthält keine Null- oder unplausiblen Leistungswerte', () => {
  assert.ok(FREIGEGEBENE_BIKES.length >= 400)
  for (const entry of FREIGEGEBENE_BIKES) {
    if (entry.kw == null || entry.ps == null) continue
    assert.ok(Number.isFinite(entry.kw) && entry.kw > 0, `${entry.name}: kW muss positiv sein`)
    assert.ok(Number.isFinite(entry.ps) && entry.ps > 0, `${entry.name}: PS muss positiv sein`)
    const ratio = entry.ps / entry.kw
    assert.ok(ratio >= 1.2 && ratio <= 1.55, `${entry.name}: kW/PS-Umrechnung ist unplausibel`)
  }
})
