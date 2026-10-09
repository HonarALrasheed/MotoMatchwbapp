const KEY = 'mm_route_planner_draft_v1'
const VERSION = 1
const MAX_AGE_MS = 30 * 24 * 60 * 60_000
const MAX_BYTES = 8_192
const MAX_POINTS = 25

function validPoint(point) {
  return Array.isArray(point) && point.length >= 2 && point.length <= 3 &&
    Number.isFinite(point[0]) && point[0] >= -90 && point[0] <= 90 &&
    Number.isFinite(point[1]) && point[1] >= -180 && point[1] <= 180 &&
    (point[2] == null || typeof point[2] === 'string' && point[2].length <= 120)
}

function validDraft(draft) {
  return draft && typeof draft === 'object' && !Array.isArray(draft) &&
    Array.isArray(draft.points) && draft.points.length > 0 && draft.points.length <= MAX_POINTS &&
    draft.points.every(validPoint) && ['kurvig', 'schnell'].includes(draft.mode) &&
    typeof draft.roundTrip === 'boolean' && typeof draft.startMissing === 'boolean'
}

export function createPlannerDraftStore({ storage, now = () => Date.now() } = {}) {
  const getStorage = () => storage ?? globalThis.localStorage
  return {
    save(draft) {
      if (!validDraft(draft)) return false
      const value = {
        version: VERSION,
        savedAt: now(),
        draft: {
          points: draft.points.map(([lat, lng, label]) => [lat, lng, label || null]),
          mode: draft.mode,
          roundTrip: draft.roundTrip,
          startMissing: draft.startMissing,
        },
      }
      try {
        const serialized = JSON.stringify(value)
        if (serialized.length > MAX_BYTES) return false
        getStorage().setItem(KEY, serialized)
        return true
      } catch { return false }
    },
    read() {
      let target
      try {
        target = getStorage()
        const raw = target.getItem(KEY)
        if (!raw) return null
        if (raw.length > MAX_BYTES) { target.removeItem(KEY); return null }
        let value
        try { value = JSON.parse(raw) } catch { target.removeItem(KEY); return null }
        if (value?.version !== VERSION || !Number.isSafeInteger(value.savedAt) ||
            value.savedAt > now() + 5 * 60_000 || now() - value.savedAt > MAX_AGE_MS ||
            !validDraft(value.draft)) {
          target.removeItem(KEY)
          return null
        }
        return value.draft
      } catch { return null }
    },
    clear() {
      try { getStorage().removeItem(KEY); return true } catch { return false }
    },
  }
}

export const PLANNER_DRAFT_KEY = KEY
