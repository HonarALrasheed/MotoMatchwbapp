import test from 'node:test'
import assert from 'node:assert/strict'
import { createQuizProgress, QUIZ_PROGRESS_KEY } from '../src/js/quiz-progress.js'

const questions = [
  { id: 1, options: [{ value: 'A2' }, { value: 'A' }] },
  { id: 3, multiple: true, options: [{ value: 'Naked' }, { value: 'Sportbike' }, { value: 'Supersportler' }, { value: 'Egal' }] },
  { id: 5, min: 500, max: 30000 },
]
function storageMock() {
  const values = new Map()
  return { values, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) }
}

test('quiz progress survives store recreation without persisting unrelated fields', () => {
  const storage = storageMock()
  const progress = createQuizProgress({ questions, storage, now: () => 1000 })
  assert.equal(progress.save(1, { q1: 'A2', q5: '4500', token: 'secret' }), false)
  assert.equal(progress.save(1, { q1: 'A2', q5: '4500' }), true)
  assert.deepEqual(createQuizProgress({ questions, storage, now: () => 2000 }).read(), {
    questionIndex: 1, answers: { q1: 'A2', q5: '4500' },
  })
  assert.doesNotMatch(storage.getItem(QUIZ_PROGRESS_KEY), /secret|token/)
})

test('rejects corrupt, stale, incompatible and out-of-range quiz checkpoints', () => {
  const storage = storageMock()
  const now = 40 * 24 * 60 * 60_000
  const progress = createQuizProgress({ questions, storage, now: () => now })
  for (const state of [
    { version: 2, savedAt: 1, questionIndex: 0, answers: { q1: 'A2' } },
    { version: 1, savedAt: 1, questionIndex: 0, answers: { q1: 'other' } },
    { version: 1, savedAt: 1, questionIndex: 4, answers: { q1: 'A2' } },
  ]) {
    storage.setItem(QUIZ_PROGRESS_KEY, JSON.stringify(state))
    assert.equal(progress.read(), null)
    assert.equal(storage.getItem(QUIZ_PROGRESS_KEY), null)
  }
})

test('blocked storage fails closed without throwing or claiming persistence', () => {
  const storage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  const progress = createQuizProgress({ questions, storage })
  assert.equal(progress.save(0, { q1: 'A2' }), false)
  assert.equal(progress.read(), null)
  assert.equal(progress.clear(), false)
})

test('multi-category quiz answers resume while legacy single-category answers remain valid', () => {
  const storage = storageMock()
  const progress = createQuizProgress({ questions, storage, now: () => 1000 })
  assert.equal(progress.save(2, { q3: ['Naked', 'Sportbike'] }), true)
  assert.deepEqual(createQuizProgress({ questions, storage, now: () => 1001 }).read().answers.q3,
    ['Naked', 'Sportbike'])
  assert.equal(progress.save(2, { q3: 'Naked' }), true)
  assert.equal(progress.read().answers.q3, 'Naked')
  for (const invalid of [
    ['Naked', 'Naked'], ['Naked', 'Egal'], ['Naked', 'unknown'], ['A2', 'A'],
  ]) {
    assert.equal(progress.save(2, { q3: invalid }), false)
  }
})
