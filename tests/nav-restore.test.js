import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../src/js/nav.js', import.meta.url), 'utf8')
  .replace(/^import .*\n/gm, '')
  .replace(/^export /gm, '')

function navHarness(initialState = null) {
  const state = { data: null, pushes: 0, back: null }
  const handlers = {}
  const context = vm.createContext({
    createResumeState: () => ({ save: view => { state.data = view }, clear: () => { state.data = null }, read: () => state.data ? { view: state.data, scrollY: 0 } : null }),
    window: {
      history: {
        state: initialState,
        replaceState(value) { this.state = value },
        pushState(value) { this.state = value; state.pushes++ },
        back() { state.back?.() },
      },
      location: { href: 'http://localhost/' },
      scrollY: 0,
      scrollTo() {},
      addEventListener(type, fn) { handlers[type] = fn },
    },
    setTimeout, clearTimeout, console,
  })
  vm.runInContext(`${source}\nglobalThis.nav = { initNav, setViewResolver, rebuild, enterScreen, currentScreen, goBack }`, context)
  return { api: context.nav, state, handlers, context }
}

test('frischer Resume baut den Screen in den Stack und ermöglicht In-App-Zurück', async () => {
  const h = navHarness()
  h.api.initNav()
  let backCalls = 0
  h.api.setViewResolver(async view => {
    h.api.enterScreen('garage', () => { backCalls++ }, () => true, view)
    return true
  })
  assert.equal(await h.api.rebuild({ screen: 'garage', bike: 'Kawasaki Z900' }), true)
  assert.equal(h.api.currentScreen(), 'garage')
  assert.equal(h.state.pushes, 1)
  assert.equal(h.context.window.history.state.mmNav, 1)

  h.state.back = () => {
    h.context.window.history.state = { mmNav: 0 }
    queueMicrotask(() => h.handlers.popstate({ state: { mmNav: 0 } }))
  }
  assert.equal(h.api.goBack(), true)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(backCalls, 1)
  assert.equal(h.api.currentScreen(), null)
})

test('Reload mit vorhandenem mmNav-Eintrag verdoppelt den History-Stack nicht', async () => {
  const h = navHarness({ mmNav: 2 })
  h.api.initNav()
  h.api.setViewResolver(async view => {
    h.api.enterScreen('garage', () => {}, () => true, view)
    return true
  })
  assert.equal(await h.api.rebuild({ screen: 'garage', bike: 'Kawasaki Z900' }), true)
  assert.equal(h.state.pushes, 0)
  assert.equal(h.api.currentScreen(), 'garage')
})

test('frisches Browserprofil baut ein Quiz-Matchergebnis als wiederherstellbare Garage auf', async () => {
  const h = navHarness()
  h.api.initNav()
  const view = { screen: 'match-result', bike: 'BMW G 310 R' }
  h.api.setViewResolver(async restored => {
    h.api.enterScreen('garage', () => {}, () => true, restored)
    return true
  })
  assert.equal(await h.api.rebuild(view), true)
  assert.equal(h.api.currentScreen(), 'garage')
  assert.equal(h.state.pushes, 1)
  assert.deepEqual(h.state.data, view)
})
