const KEY = 'mm_quiz_resume_v1'
const VERSION = 1
const MAX_AGE_MS = 30 * 24 * 60 * 60_000
const MAX_BYTES = 2048

function validateAnswers(questions, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const byKey = new Map(questions.map(q => [`q${q.id}`, q]))
  const clean = {}
  for (const [key, answer] of Object.entries(value)) {
    const q = byKey.get(key)
    if (!q) return null
    if (q.options) {
      if (Array.isArray(answer)) {
        if (!q.multiple || answer.length < 2 || answer.length > q.options.length ||
            new Set(answer).size !== answer.length || answer.some(item => typeof item !== 'string' || item.length > 80 ||
              item === 'Egal' || !q.options.some(option => option.value === item))) return null
        clean[key] = [...answer]
      } else {
        if (typeof answer !== 'string' || answer.length > 80 ||
            !q.options.some(option => option.value === answer)) return null
        clean[key] = answer
      }
    } else {
      if (typeof answer !== 'string' || answer.length > 80) return null
      const n = Number(answer)
      if (!Number.isFinite(n) || n < q.min || n > q.max) return null
      clean[key] = answer
    }
  }
  return clean
}

export function createQuizProgress({ questions, storage, now = () => Date.now() }) {
  const getStorage = () => storage ?? globalThis.localStorage
  return {
    save(questionIndex, answers) {
      const cleanAnswers = validateAnswers(questions, answers)
      if (!cleanAnswers || !Object.keys(cleanAnswers).length || !Number.isSafeInteger(questionIndex) ||
          questionIndex < 0 || questionIndex >= questions.length) return false
      const value = { version: VERSION, savedAt: now(), questionIndex, answers: cleanAnswers }
      try {
        const raw = JSON.stringify(value)
        if (raw.length > MAX_BYTES) return false
        getStorage().setItem(KEY, raw)
        return true
      } catch { return false }
    },
    read() {
      try {
        const target = getStorage()
        const raw = target.getItem(KEY)
        if (!raw || raw.length > MAX_BYTES) return null
        const value = JSON.parse(raw)
        const answers = validateAnswers(questions, value?.answers)
        if (value?.version !== VERSION || !Number.isSafeInteger(value.savedAt) ||
            value.savedAt > now() + 5 * 60_000 || now() - value.savedAt > MAX_AGE_MS ||
            !Number.isSafeInteger(value.questionIndex) || value.questionIndex < 0 ||
            value.questionIndex >= questions.length || !answers || !Object.keys(answers).length) {
          target.removeItem(KEY)
          return null
        }
        return { questionIndex: value.questionIndex, answers }
      } catch { return null }
    },
    clear() {
      try { getStorage().removeItem(KEY); return true } catch { return false }
    },
  }
}

/** Lightweight landing-page check; full answer validation still runs on resume. */
export function hasQuizProgressHint({ storage, now = () => Date.now() } = {}) {
  try {
    const raw = (storage ?? globalThis.localStorage).getItem(KEY)
    if (!raw || raw.length > MAX_BYTES) return false
    const value = JSON.parse(raw)
    return value?.version === VERSION && Number.isSafeInteger(value.savedAt) &&
      value.savedAt <= now() + 5 * 60_000 && now() - value.savedAt <= MAX_AGE_MS &&
      Number.isSafeInteger(value.questionIndex) && value.questionIndex >= 0 &&
      value.answers && typeof value.answers === 'object' && !Array.isArray(value.answers) &&
      Object.keys(value.answers).length > 0
  } catch { return false }
}

export const QUIZ_PROGRESS_KEY = KEY
