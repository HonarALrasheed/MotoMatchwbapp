/**
 * ══════════════════════════════════════════════════════════════
 *  MOTOMATCH — nav.js
 *  Rück- und Vorwärts-Navigation für die Bildschirm-SPA
 * ══════════════════════════════════════════════════════════════
 *
 * Hält einen eigenen Screen-Stack im Modul-Scope und spiegelt jede Ebene auf
 * genau einen History-Eintrag. Damit hat der Zurück-Button des Browsers etwas
 * zu tun, statt die Seite zu verlassen (vorher: history.length === 1 über die
 * gesamte Sitzung).
 *
 * ── Zwei Dinge, die der Stack allein nicht konnte ─────────────────────────
 *
 * 1. **Vorwärts** war wirkungslos: `popstate` feuert in beide Richtungen, der
 *    Handler nahm aber jedes Signal als "zurück" und holte noch eine Ebene vom
 *    Stack. Nach einem Zurück blieb der Bildschirm beim Vorwärts einfach
 *    stehen. Die Richtung steht jetzt in `history.state.mmNav`: eine laufende
 *    Nummer je Eintrag, kleiner als die aktuelle heisst zurück, groesser
 *    heisst vorwaerts.
 *
 * 2. **Neu laden** warf einen immer auf die Startseite, weil alle Ebenen
 *    dieselbe Adresse haben.
 *
 * Beides braucht dasselbe: eine Ebene muss aus Daten wiederherstellbar sein,
 * nicht nur aus einer Closure. Dafuer gibt jeder Aufrufer von `enterScreen()`
 * eine **serialisierbare Beschreibung** seines Bildschirms mit (`view`), und
 * app.js hinterlegt einmal per `setViewResolver()`, wie aus so einer
 * Beschreibung wieder ein Bildschirm wird. Vorwaerts und Neuladen benutzen
 * denselben Weg — ein Mechanismus statt zwei, die auseinanderlaufen koennen.
 *
 * Der Rückweg selbst liegt bewusst NICHT in `history.state`: auth.js
 * (?reset=1) und community.js (?dm=…, ?group=…&channel=…) räumen ihre
 * Query-Parameter per `replaceState` aus der URL. Die drei Aufrufe reichen
 * `history.state` inzwischen durch, damit `mmNav` erhalten bleibt — der
 * Rückweg mit seinen Closures gehört aber weiterhin hierher, weil Funktionen
 * ohnehin nicht in den History-State passen.
 *
 * In-App-Zurück-Button, Browser-Zurück und Wischgeste laufen durch denselben
 * Code: `goBack()` löst nur `history.back()` aus, den eigentlichen Bildschirm-
 * wechsel macht immer der popstate-Handler.
 */

import { createResumeState } from './resume-state.js'

/** Besuchte Ebenen, unterste zuerst. */
const stack = []
/** Per Zurück verlassene Ebenen — Nachschub für Vorwärts. */
const ahead = []

let installed = false
let backInFlight = false
/** Position in der History, gespiegelt in `history.state.mmNav`. */
let index = 0
/** Während einer Wiederherstellung darf enterScreen keinen Eintrag anlegen. */
let restoring = false
/** Von app.js gesetzt: macht aus einer view-Beschreibung wieder einen Bildschirm. */
let resolveView = null

/** Persistiert nur eine validierte öffentliche Ansicht, niemals Auth-Zustand. */
const resumeState = createResumeState()
let persistTimer = null

export function initNav() {
  if (installed) return
  installed = true
  // Den Einstiegseintrag stempeln, damit die erste Richtungsentscheidung eine
  // Zahl zum Vergleichen hat. Bestehenden State durchreichen: auf ihm koennen
  // Query-Parameter-Aufraeumer von auth.js/community.js sitzen.
  index = numFromState(window.history.state)
  try {
    window.history.replaceState({ ...(window.history.state || {}), mmNav: index }, '', window.location.href)
  } catch { /* ohne Stempel faellt die Richtung auf "zurück" zurück — wie vorher */ }
  window.addEventListener('popstate', handlePop)
  window.addEventListener('scroll', () => {
    if (persistTimer !== null) return
    persistTimer = setTimeout(() => { persistTimer = null; persist() }, 180)
  }, { passive: true })
}

function numFromState(state) {
  const n = state && typeof state.mmNav === 'number' ? state.mmNav : 0
  return Number.isFinite(n) ? n : 0
}

/** Beschreibung der obersten Ebene sichern (fürs Neuladen). */
function persist() {
  const top = stack[stack.length - 1]
  if (top?.view) resumeState.save(top.view, window.scrollY)
  else resumeState.clear()
}

/**
 * Einen Bildschirm aus seiner Beschreibung neu aufbauen.
 *
 * Auch der Einstiegspunkt fuer app.js: Vorwaerts-Navigation UND die
 * Wiederherstellung nach dem Neuladen laufen beide hierueber, damit
 * `restoring` in jedem Fall gesetzt ist, bevor der wiederhergestellte
 * Bildschirm sich per `enterScreen()` anmeldet.
 *
 * Der Aufbau ist asynchron (die Bildschirm-Module werden nachgeladen), deshalb
 * bleibt `restoring` bis zum Ende gesetzt — sonst legte das `enterScreen()` des
 * wiederhergestellten Bildschirms einen zweiten History-Eintrag an und der
 * Rückweg waere doppelt. Der Wecker ist nur ein Warnsignal, kein Ruecksetzer:
 * er darf `restoring` NICHT zuruecksetzen, solange `resolveView()` noch laeuft
 * — sonst waere genau das doppelte Anlegen, das er verhindern soll, durch ihn
 * selbst wieder moeglich (das verspaetete `enterScreen()` faende die Sperre
 * schon offen vor). Zurueckgesetzt wird `restoring` deshalb ausschliesslich,
 * wenn `resolveView()` tatsaechlich fertig ist — egal wie lange das dauert.
 *
 * @returns {Promise<boolean>} ob die Wiederherstellung geglueckt ist — false,
 *          wenn sich die Beschreibung nicht aufloesen liess oder ein Fehler
 *          auftrat.
 */
export function rebuild(view, scrollY = 0) {
  restoring = true
  let seededStack = false
  let seededHistory = false
  if (!stack.length) {
    const name = ({ garage: 'garage', 'match-result': 'garage', deckblatt: 'bd-deckblatt', konfigurator: 'bd-konfigurator' })[view?.screen]
    if (name) {
      // On a fresh tab, create one in-app back step to the landing page. On a
      // reload, the current entry already carries mmNav and must not be doubled.
      stack.push({ name, view, onBack() {}, isActive: () => true })
      seededStack = true
      if (index === 0) {
        index += 1
        try {
          window.history.pushState({ ...(window.history.state || {}), mmNav: index }, '', window.location.href)
          seededHistory = true
        } catch {
          index -= 1
          stack.pop()
          seededStack = false
        }
      }
    }
  }
  let settled = false
  const guard = setTimeout(() => {
    if (!settled) console.warn('[nav] Vorwärts-Schritt braucht ungewöhnlich lange — restoring bleibt gesperrt, bis er fertig ist.')
  }, 3000)
  const finish = (ok) => {
    settled = true
    clearTimeout(guard)
    if (!ok && seededStack) {
      stack.pop()
      if (seededHistory) {
        index = Math.max(0, index - 1)
        try { window.history.replaceState({ ...(window.history.state || {}), mmNav: index }, '', window.location.href) } catch {}
      }
    }
    restoring = false
    return ok
  }
  try {
    return Promise.resolve(resolveView(view))
      .then(ok => {
        if (ok && Number.isFinite(scrollY) && scrollY > 0) {
          setTimeout(() => window.scrollTo?.(0, scrollY), 350)
        }
        return finish(ok)
      })
      .catch(err => {
        console.error('[nav] Vorwärts-Schritt fehlgeschlagen:', err)
        return finish(false)
      })
  } catch (err) {
    console.error('[nav] Vorwärts-Schritt fehlgeschlagen:', err)
    return Promise.resolve(finish(false))
  }
}

function handlePop(event) {
  backInFlight = false
  const to = numFromState(event.state)

  if (to < index) {
    // Zurück — auch mehrere Schritte auf einmal (langer Druck auf den
    // Zurück-Button des Browsers).
    for (let i = index; i > to; i--) {
      const entry = stack.pop()
      if (!entry) break
      ahead.push(entry)
      // Der Bildschirm kann zwischenzeitlich auf einem anderen Weg verlassen
      // worden sein — der Quiz-Start blendet #bike-detail z. B. direkt aus,
      // ohne über dieses Modul zu laufen. Dann ist der Eintrag nur noch
      // Altlast: aufbrauchen, aber nichts umschalten.
      if (typeof entry.isActive === 'function' && !entry.isActive()) continue
      try {
        entry.onBack()
      } catch (err) {
        console.error('[nav] Zurück-Schritt fehlgeschlagen:', err)
      }
    }
  } else if (to > index) {
    // Vorwärts. Bei mehreren Schritten auf einmal wandern alle Ebenen zurück
    // auf den Stack, aufgebaut wird aber nur das Ziel — die uebersprungenen
    // Bildschirme wuerde ohnehin niemand zu sehen bekommen.
    let target = null
    for (let i = index; i < to; i++) {
      const entry = ahead.pop()
      if (!entry) break
      stack.push(entry)
      target = entry
    }
    if (target?.view && resolveView) rebuild(target.view)
  }

  index = to
  persist()
}

/**
 * Eine Ebene tiefer gehen.
 *
 * @param {string}   name     Kennung des Bildschirms (dedupliziert Ebenen)
 * @param {Function} onBack   führt genau einen Schritt zurück aus
 * @param {Function} isActive prüft, ob der Bildschirm noch angezeigt wird
 * @param {Object}  [view]    serialisierbare Beschreibung für Vorwärts und
 *                            Neuladen, z. B. `{ screen:'garage', bike:'…' }`.
 *                            Fehlt sie, funktioniert Zurück wie bisher — die
 *                            Ebene ist dann nur nicht wiederherstellbar.
 *
 * Ist die oberste Ebene bereits derselbe Bildschirm, wird nur der Handler
 * aufgefrischt statt ein zweiter Eintrag angelegt — sonst sammelte
 * Deckblatt → Konfigurator → zurück → Konfigurator Karteileichen an.
 */
export function enterScreen(name, onBack, isActive, view = null) {
  const top = stack[stack.length - 1]
  if (top && top.name === name) {
    top.onBack = onBack
    top.isActive = isActive
    if (view) top.view = view
    persist()
    return
  }

  // Während einer Wiederherstellung baut der Bildschirm sich selbst neu auf und
  // meldet sich dabei erneut an. Der History-Eintrag dafür existiert aber
  // schon — ein zweiter würde den Rückweg verdoppeln.
  if (restoring) {
    const entry = stack[stack.length - 1]
    if (entry) { entry.onBack = onBack; entry.isActive = isActive; if (view) entry.view = view }
    persist()
    return
  }

  stack.push({ name, onBack, isActive, view })
  // Ein neuer Zweig macht den bisherigen Vorwärts-Weg ungültig — dieselbe
  // Regel, nach der auch der Browser seinen Vorwärts-Verlauf verwirft.
  ahead.length = 0
  index += 1
  // Gleiche URL: die Bildschirme haben keine eigenen Adressen, und ein
  // erfundener Pfad würde beim Neuladen einen 404 auf dem Dev-Server bzw. in
  // Vercel erzeugen. Gebraucht wird nur der History-Eintrag.
  try {
    window.history.pushState({ mmNav: index }, '', window.location.href)
  } catch (err) {
    stack.pop()
    index -= 1
    console.error('[nav] pushState fehlgeschlagen:', err)
  }
  persist()
}

/**
 * Programmatisch einen Schritt zurück (In-App-Zurück-Button, Wischgeste).
 * @returns {boolean} false, wenn es nichts zurückzugehen gibt — der Aufrufer
 *                    soll dann seinen eigenen Fallback fahren.
 */
export function goBack() {
  if (backInFlight) return true
  if (!stack.length) return false
  backInFlight = true
  window.history.back()
  // Sicherheitsnetz: bleibt popstate wider Erwarten aus, blockiert der Button
  // nicht dauerhaft.
  setTimeout(() => { backInFlight = false }, 700)
  return true
}

/**
 * Einen Schritt vorwärts — zurück auf den Bildschirm, den man per Zurück
 * verlassen hat.
 * @returns {boolean} false, wenn es nichts vorzugehen gibt.
 */
export function goForward() {
  if (!ahead.length) return false
  window.history.forward()
  return true
}

/** Gibt es einen Bildschirm, auf den Vorwärts führen würde? */
export function canGoForward() {
  return ahead.length > 0
}

/** Name der obersten Ebene, oder null auf der Startseite. */
export function currentScreen() {
  return stack.length ? stack[stack.length - 1].name : null
}

/**
 * Wird einmal von app.js gesetzt: baut aus einer view-Beschreibung wieder den
 * zugehörigen Bildschirm. Getrennt gehalten, damit nav.js nichts über die
 * einzelnen Bildschirme wissen muss.
 */
export function setViewResolver(fn) {
  resolveView = fn
}

/** Aktualisiert den serialisierbaren Zustand des aktuellen Screens. */
export function updateCurrentView(view) {
  const top = stack[stack.length - 1]
  if (!top || !view) return false
  top.view = view
  persist()
  return true
}

/** Die beim letzten Mal sichtbare Ebene — für die Wiederherstellung beim Laden. */
export function readRestoreView() {
  return resumeState.read()?.view || null
}

export function readRestoreState() {
  return resumeState.read()
}

/** Gemerkte Ebene verwerfen (z. B. wenn die Wiederherstellung fehlschlägt). */
export function clearRestoreView() {
  resumeState.clear()
}
