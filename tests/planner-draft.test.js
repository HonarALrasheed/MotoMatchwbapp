import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlannerDraftStore, PLANNER_DRAFT_KEY } from '../src/js/planner-draft.js'

function harness(now = 1_800_000_000_000) {
  const data = new Map()
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  }
  return { data, storage, store: createPlannerDraftStore({ storage, now: () => now }) }
}

const draft = {
  points: [[48.1, 11.5, 'München'], [47.9, 11.4, 'Ziel']],
  mode: 'schnell', roundTrip: false, startMissing: false,
}

test('Planerentwurf speichert nur validierte Eingaben und liefert keinen Routencache', () => {
  const h = harness()
  assert.equal(h.store.save({ ...draft, result: { pts: [[1, 2]] }, token: 'must-not-persist' }), true)
  const saved = JSON.parse(h.data.get(PLANNER_DRAFT_KEY))
  assert.deepEqual(saved.draft, draft)
  assert.equal(JSON.stringify(saved).includes('must-not-persist'), false)
  assert.equal(h.store.read().mode, 'schnell')
})

test('Planerentwurf lehnt ungültige Koordinaten und zu viele Punkte ab', () => {
  const h = harness()
  assert.equal(h.store.save({ ...draft, points: [[91, 11]] }), false)
  assert.equal(h.store.save({ ...draft, points: Array.from({ length: 26 }, () => [48, 11]) }), false)
  assert.equal(h.data.size, 0)
})

test('abgelaufener oder beschädigter Planerentwurf wird verworfen', () => {
  const h = harness()
  h.data.set(PLANNER_DRAFT_KEY, JSON.stringify({ version: 1, savedAt: 1, draft }))
  assert.equal(h.store.read(), null)
  assert.equal(h.data.has(PLANNER_DRAFT_KEY), false)
  h.data.set(PLANNER_DRAFT_KEY, '{bad-json')
  assert.equal(h.store.read(), null)
  assert.equal(h.data.has(PLANNER_DRAFT_KEY), false)
})

test('Planerentwurf überlebt Schließen und lässt sich ausdrücklich entfernen', () => {
  const h = harness()
  assert.equal(h.store.save(draft), true)
  const nextPage = createPlannerDraftStore({ storage: h.storage, now: () => 1_800_000_000_000 })
  assert.deepEqual(nextPage.read(), draft)
  assert.equal(nextPage.clear(), true)
  assert.equal(h.store.read(), null)
})

test('Speicherfehler werden als fehlgeschlagene Sicherung sichtbar', () => {
  const brokenStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded') },
    removeItem: () => { throw new Error('storage unavailable') },
  }
  const store = createPlannerDraftStore({ storage: brokenStorage })
  assert.equal(store.save(draft), false)
  assert.equal(store.clear(), false)
})
