import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('Homepage starts only near-visible motorcycle tiles eagerly and keeps responsive lazy images', () => {
  const landing = source('../src/js/landing.js')
  assert.match(landing, /srcset="\$\{c\.img\.replace\(\/\\\.webp\$\/i, "_640\.jpg"\)\} 640w, \$\{c\.img\} 1280w"/)
  assert.match(landing, /width="1280" height="960"[^\n]*loading="lazy" decoding="async"/)
  assert.match(landing, /bounds\.bottom > 0 && bounds\.top < viewportHeight \+ 600\) img\.loading = 'eager'/)
  assert.match(landing, /eagerVisibleDiscoverImages\(landing\)/)
  assert.doesNotMatch(landing, /p-discover-cat img[^\n]*fetchpriority="high"/)
})

test('Motorcycle detail main image is requested promptly without a reveal delay', () => {
  const detail = source('../src/js/bike-detail.js')
  assert.match(detail, /class="bd-hero-img"[^\n]*loading="eager" fetchpriority="high" decoding="async"/)

  const styles = source('../src/styles/main.css')
  assert.doesNotMatch(styles, /bdHeroIn/)
  assert.match(styles, /\.bd-hero-img\s*\{[^}]*max-height: 56vh/s)
})
