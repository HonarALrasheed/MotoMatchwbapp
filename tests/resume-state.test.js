import test from 'node:test'
import assert from 'node:assert/strict'
import { createResumeState, RESUME_STATE_KEY } from '../src/js/resume-state.js'

function memoryStorage() {
  const values = new Map()
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
  }
}

test('stores a bounded public screen descriptor and scroll offset across store instances', () => {
  const storage = memoryStorage()
  const writer = createResumeState({ storage, now: () => 10_000 })
  assert.equal(writer.save({ screen: 'konfigurator', bike: 'KTM 390 Duke', tab: 'karte', accessToken: 'never-store' }, 840), true)
  const raw = storage.getItem(RESUME_STATE_KEY)
  assert.doesNotMatch(raw, /never-store|accessToken/)
  assert.deepEqual(createResumeState({ storage, now: () => 10_001 }).read(), {
    view: { screen: 'konfigurator', bike: 'KTM 390 Duke', tab: 'karte' }, scrollY: 840,
  })
})

test('rejects unknown versions, malformed views, excessive scroll and expired state', () => {
  const storage = memoryStorage()
  const store = createResumeState({ storage, now: () => 40 * 24 * 60 * 60_000 })
  for (const state of [
    { version: 2, savedAt: 1, view: { screen: 'garage', bike: 'X' }, scrollY: 0 },
    { version: 1, savedAt: 1, view: { screen: 'external', bike: 'X' }, scrollY: 0 },
    { version: 1, savedAt: 1, view: { screen: 'garage', bike: 'X' }, scrollY: 10_000_001 },
  ]) {
    storage.setItem(RESUME_STATE_KEY, JSON.stringify(state))
    assert.equal(store.read(), null)
    assert.equal(storage.getItem(RESUME_STATE_KEY), null)
  }
})

test('invalid writes and unavailable storage fail without throwing', () => {
  const store = createResumeState({ storage: { setItem() { throw new Error('blocked') }, getItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } } })
  assert.equal(store.save({ screen: 'not-a-screen', bike: 'X' }), false)
  assert.equal(store.save({ screen: 'garage', bike: 'X' }), false)
  assert.equal(store.read(), null)
  assert.equal(store.clear(), false)
})

test('view schema rejects invalid tabs, oversized bike names and control characters', () => {
  const store = createResumeState({ storage: memoryStorage() })
  assert.equal(store.save({ screen: 'konfigurator', bike: 'Bike', tab: 'unknown' }), false)
  assert.equal(store.save({ screen: 'garage', bike: 'x'.repeat(121) }), false)
  assert.equal(store.save({ screen: 'garage', bike: 'Bike\n' }), false)
})

test('completed match results can be resumed, while malformed view types remain rejected', () => {
  const storage = memoryStorage()
  const store = createResumeState({ storage, now: () => 10_000 })
  assert.equal(store.save({ screen: 'match-result', bike: 'Honda CBF 125' }), true)
  assert.deepEqual(store.read(), {
    view: { screen: 'match-result', bike: 'Honda CBF 125' }, scrollY: 0,
  })
  assert.equal(store.save({ screen: 'match-result', bike: 'Honda\nCBF 125' }), false)
})
