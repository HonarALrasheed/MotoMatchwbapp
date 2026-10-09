const KEY = 'mm_app_resume_v1'
const VERSION = 1
const MAX_AGE_MS = 30 * 24 * 60 * 60_000
const MAX_BYTES = 4096
const SCREENS = new Set(['garage', 'match-result', 'deckblatt', 'konfigurator'])
const TABS = new Set(['ansicht', 'ausstattung', 'community', 'karte', 'match'])

function validView(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !SCREENS.has(value.screen)) return false
  if (typeof value.bike !== 'string' || !value.bike.trim() || value.bike.length > 120 || /[\u0000-\u001f]/.test(value.bike)) return false
  if (value.screen === 'konfigurator' && value.tab != null && !TABS.has(value.tab)) return false
  return true
}

function safeView(value) {
  return value.screen === 'konfigurator'
    ? { screen: value.screen, bike: value.bike, ...(value.tab ? { tab: value.tab } : {}) }
    : { screen: value.screen, bike: value.bike }
}

function validEnvelope(value, now) {
  return value?.version === VERSION && Number.isSafeInteger(value.savedAt) &&
    value.savedAt <= now + 5 * 60_000 && now - value.savedAt <= MAX_AGE_MS &&
    validView(value.view) && Number.isSafeInteger(value.scrollY) && value.scrollY >= 0 && value.scrollY <= 10_000_000
}

/** Stores only a public screen descriptor and scroll offset; never auth/session data. */
export function createResumeState({ storage, now = () => Date.now() } = {}) {
  const getStorage = () => storage ?? globalThis.localStorage
  return {
    save(view, scrollY = 0) {
      if (!validView(view)) return false
      const safeScroll = Number.isFinite(scrollY) ? Math.max(0, Math.min(10_000_000, Math.floor(scrollY))) : 0
      const envelope = { version: VERSION, savedAt: now(), view: safeView(view), scrollY: safeScroll }
      try {
        const serialized = JSON.stringify(envelope)
        if (serialized.length > MAX_BYTES) return false
        getStorage().setItem(KEY, serialized)
        return true
      } catch { return false }
    },
    read() {
      try {
        const target = getStorage()
        const raw = target.getItem(KEY)
        if (!raw || raw.length > MAX_BYTES) return null
        const value = JSON.parse(raw)
        if (!validEnvelope(value, now())) {
          target.removeItem(KEY)
          return null
        }
        return { view: safeView(value.view), scrollY: value.scrollY }
      } catch { return null }
    },
    clear() {
      try { getStorage().removeItem(KEY); return true } catch { return false }
    },
  }
}

export const RESUME_STATE_KEY = KEY
