import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const root = new URL('..', import.meta.url)
const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))
const lockJson = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'))
const karte = readFileSync(new URL('src/js/karte.js', root), 'utf8')

test('MapLibre ist in Manifest und Lockfile auf die gepatchte Version gepinnt', () => {
  assert.equal(packageJson.dependencies['maplibre-gl'], '6.4.1')
  assert.equal(lockJson.packages['node_modules/maplibre-gl'].version, '6.4.1')
})

test('MapLibre bleibt lazy geladen und konfiguriert den Vite-Worker', () => {
  assert.match(karte, /import\('maplibre-gl'\)/)
  assert.match(karte, /maplibre-gl-worker\.mjs\?worker&url/)
  assert.match(karte, /ml\.setWorkerUrl\(worker\.default\)/)
  assert.doesNotMatch(karte, /^\s*import\s+.*from\s+['"]maplibre-gl/m)
})

test('WebGL2-Initialisierungsfehler zeigt einen zugänglichen Karten-Fallback', () => {
  const start = karte.indexOf('function zeigeFehler(el, err) {')
  const ende = karte.indexOf('\n\nlet initToken', start)
  assert.ok(start >= 0 && ende > start, 'Fallbackfunktion muss im Kartenmodul vorhanden sein')

  class GPUInitializationError extends Error {}
  const retry = { handler: null }
  const el = {
    innerHTML: '',
    querySelector(selector) {
      assert.equal(selector, '#hub-map-retry-btn')
      return { addEventListener(_event, handler) { retry.handler = handler } }
    },
  }
  const zeigeFehler = vm.runInNewContext(`(${karte.slice(start, ende)})`, {
    ml: { GPUInitializationError },
    initHubMap() {},
  })

  zeigeFehler(el, new GPUInitializationError('WebGL 2 unavailable'))

  assert.match(el.innerHTML, /role="status" aria-live="polite"/)
  assert.match(el.innerHTML, /Karte wird nicht unterstützt/)
  assert.match(el.innerHTML, /WebGL 2 benötigt/)
  assert.equal(typeof retry.handler, 'function')
})
