import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/js/account.js', import.meta.url), 'utf8')

function extract(startText, endText) {
  const start = source.indexOf(startText)
  const end = source.indexOf(endText, start)
  assert.ok(start >= 0 && end > start, `Quellbereich ${startText} muss vorhanden sein`)
  return source.slice(start, end)
}

const code = [
  extract('function renderBikes()', '\nfunction wireBikeSearch()'),
  extract('function renderFavoriten()', '\n/**\n * Zeigt an einer seitlich scrollenden Zeile'),
].join('\n')

const context = vm.createContext({
  FAV_FILTER: [['bikes', 'Bikes'], ['gear', 'Ausrüstung'], ['places', 'Orte']],
  favFilter: 'alle',
  getOwnedBikes: () => [],
  collectRecentBikes: () => [],
  collectGearFavs: () => [],
  collectMapFavs: () => [],
  bikeKachel: () => '',
  esc: value => String(value),
  fmtDate: () => '',
})
vm.runInContext(`${code}\nglobalThis.render = renderFavoriten`, context)

test('leere Favoritenliste zeigt weiterhin den Einstieg zum eigenen ersten Bike', () => {
  const html = context.render()
  assert.match(html, /Noch nichts gemerkt\./)
  assert.match(html, /data-fav-sektion="bikes"/)
  assert.match(html, /id="acc-bike-search-input"/)
  assert.match(html, /Noch kein eigenes Bike eingetragen\./)
})
