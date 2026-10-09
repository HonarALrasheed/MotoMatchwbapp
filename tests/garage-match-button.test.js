import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const quelle = readFileSync(new URL('../src/js/garage.js', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
const anfang = quelle.indexOf('function preisDetails(')
const ende = quelle.indexOf('\nfunction initAnimations(', anfang)
assert.ok(anfang >= 0 && ende > anfang, 'Garage-Ergebnis muss im Test auffindbar sein')

const context = vm.createContext({
  kachelFuerHero: () => '/bike-kachel.webp',
  bikeBild: () => '/bike-titel.webp',
  hatFoto: () => true,
})
vm.runInContext(`${quelle.slice(anfang, ende)}\nglobalThis.baueErgebnis = buildPage`, context)

const bike = { name: 'Yamaha XV 535 Virago', priceDisplay: 'ca. 2.999 €', bgText: 'XV 535 Virago' }

test('Quiz-Ergebnis zeigt Motorrad und Match-Inhalt ohne großen Teilen-Button', () => {
  const html = context.baueErgebnis(bike, true)
  assert.match(html, /Yamaha XV 535 Virago/)
  assert.match(html, /Dein perfektes Match/)
  assert.match(html, /bike-titel\.webp/)
  assert.match(html, /id="gr-tabbar"/)
  assert.match(html, /id="garage-teilen"/)
  assert.equal(/Mein Match teilen|id="gr-match-teilen"|class="gr-match-teilen"/.test(html), false)
})

test('Direkte Garage-Ansicht behält ihren unabhängigen Teilen-Knopf', () => {
  const html = context.baueErgebnis(bike, false)
  assert.match(html, /id="garage-teilen"/)
  assert.equal(/Mein Match teilen|id="gr-match-teilen"/.test(html), false)
})

test('Button-exklusive CSS-Regeln und Handler bleiben nicht zurück', () => {
  assert.equal(/\.gr-match-teilen\b/.test(css), false)
  assert.equal(/gr-match-teilen|matchBildVorbereiten|matchTeilen\(/.test(quelle), false)
  assert.match(quelle, /getElementById\("garage-teilen"\).*teilen\(bikeData\)/)
})
