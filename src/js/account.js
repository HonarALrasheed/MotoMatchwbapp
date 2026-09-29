/**
 * ══════════════════════════════════════════════════════════════════
 *  MotoMatch — Account (Konto)
 *  Comprehensive user account overlay connecting all features:
 *  - Profile (name, avatar, bio, stats)
 *  - Meine Bikes (saved bikes)
 *  - Ausrüstung (favorited gear)
 *  - Community (own posts, liked, subscribed, comments)
 *  - Orte (saved map favorites)
 *  - Einstellungen (settings)
 * ══════════════════════════════════════════════════════════════════
 */

// Zentrale, plattformweite Auth — dieselbe Session/DB wie im Community-Bereich
import * as auth from './auth.js'
import { getCatalog, preisAb, findBikeByShortName } from './matching.js'
import { bikeBild } from './bike-bild.js'
import { esc, fmtDate, fmtRelative } from './util.js'
import {
  starteAufzeichnung, standortVerfuegbar, unterbrocheneAufzeichnung,
  verwerfeUnterbrochene, spurPfad, formatiereDauer,
} from './ride-tracker.js'
import { teileFahrt } from './ride-share.js'
import {
  kilometerAbschnitte, tempoVerlauf, hoehenVerlauf,
  verlaufPfad, verlaufFlaeche, bestwerte,
} from './ride-stats.js'

const DEFAULT_ACCOUNT = {
  name: 'Gast',
  email: '',
  bio: 'Motorradfahrer · MotoMatch 🏍',
  avatar: null, // initials computed from name
  joinedAt: Date.now(),
  notif: { events: true, community: true, gear: false },
  theme: 'dark',
}

/** Das Konto IST der aktuell angemeldete Nutzer (Single Sign-On). */
export function getAccount() {
  const u = auth.currentUser()
  if (u) return { ...DEFAULT_ACCOUNT, ...u, name: u.name || u.username }
  return { ...DEFAULT_ACCOUNT }
}
export function saveAccount(patch) {
  // Schreibt in den zentralen User-Datensatz (gilt für die ganze Plattform)
  auth.updateProfile(patch)
  const next = getAccount()
  try { window.dispatchEvent(new CustomEvent('mm:account-updated', { detail: next })) } catch {}
  return next
}
export function isAuthenticated() { return auth.isLoggedIn() }

function stringColor(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  const palette = ['#e05555','#c074dc','#5aa8d8','#5fc587','#d49258','#ff8c42','#6dba72','#7ab3e0']
  return palette[Math.abs(h) % palette.length]
}
function getInitials(name) {
  return name.split(/[\s·]+/).filter(Boolean).slice(0,2).map(s => s[0]).join('').toUpperCase()
}

// ─── Data collectors from other features ───
function collectGearFavs() {
  try {
    const meta = JSON.parse(localStorage.getItem('mm_gear_favs_meta') || '{}')
    return Object.entries(meta).map(([id, m]) => ({ id, ...m }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
  } catch { return [] }
}
function collectMapFavs() {
  try {
    const ids = JSON.parse(localStorage.getItem('mm_kv_favs') || '[]')
    const meta = JSON.parse(localStorage.getItem('mm_kv_favs_meta') || '{}')
    return ids.map(id => ({ id, ...(meta[id] || { name: `Ort #${id.slice(0,8)}`, address: '', lat: null, lng: null, rating: null }) }))
  } catch { return [] }
}
function collectCommunityActivity() {
  try {
    const state = JSON.parse(localStorage.getItem('mm_community_state_v1') || '{}')
    const posts = JSON.parse(localStorage.getItem('mm_user_posts_v1') || '[]')
    const liked = Object.entries(state).filter(([, v]) => v.liked).map(([id]) => id)
    const subscribed = Object.entries(state).filter(([, v]) => v.subscribed).map(([id]) => id)
    // Count user comments across all cards
    let commentCount = 0
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith('mm_comments_')) {
        try { commentCount += JSON.parse(localStorage.getItem(k) || '[]').length } catch {}
      }
    }
    return { posts, liked, subscribed, commentCount }
  } catch { return { posts: [], liked: [], subscribed: [], commentCount: 0 } }
}
function collectRecentBikes() {
  // Bike data is in bike-detail.js — read from a recents list we maintain (or seed with defaults)
  try {
    return JSON.parse(localStorage.getItem('mm_recent_bikes_v1') || '[]')
  } catch { return [] }
}

/* ─── Eigene Bikes (Besitz) — getrennt von der reinen Ansichts-Chronik.
   Nur weil jemand 20 Bikes angeschaut hat, heißt das nicht, dass er sie
   besitzt. "Meine Bikes" zeigt nur Bikes, die explizit als eigenes
   markiert wurden ("Ich fahre dieses Bike"). ─── */
const LS_OWNED_BIKES = 'mm_owned_bikes_v1'
export function getOwnedBikes() {
  try { return JSON.parse(localStorage.getItem(LS_OWNED_BIKES) || '[]') } catch { return [] }
}
function saveOwnedBikes(list) {
  try { localStorage.setItem(LS_OWNED_BIKES, JSON.stringify(list)) } catch {}
}
export function isBikeOwned(name) {
  return getOwnedBikes().some(b => b.name === name)
}
/** Schaltet den Besitz-Status um. Gibt zurück, ob das Bike danach als eigenes markiert ist. */
export function toggleOwnedBike(name, style, image) {
  const list = getOwnedBikes()
  const exists = list.some(b => b.name === name)
  const next = exists
    ? list.filter(b => b.name !== name)
    : [{ name, style: style || '', image: image || '', addedAt: Date.now() }, ...list]
  saveOwnedBikes(next)
  return !exists
}
/** Fügt ein Bike direkt zur Wartungsliste hinzu (ohne Toggle) */
export function addOwnedBike(name, style, image) {
  const list = getOwnedBikes()
  if (list.some(b => b.name === name)) return
  saveOwnedBikes([{ name, style: style || '', image: image || '', addedAt: Date.now() }, ...list])
}
// Public: called from other modules when user views/configures a bike
export function trackBikeVisit(bikeName, bikeStyle) {
  if (!bikeName) return
  try {
    let list = JSON.parse(localStorage.getItem('mm_recent_bikes_v1') || '[]')
    list = list.filter(b => b.name !== bikeName)
    list.unshift({ name: bikeName, style: bikeStyle || '', ts: Date.now() })
    list = list.slice(0, 12)
    localStorage.setItem('mm_recent_bikes_v1', JSON.stringify(list))
  } catch {}
}

// ─── Account overlay HTML ───
function buildAccountHTML() {
  const acc = getAccount()
  const initials = getInitials(acc.name)
  const color = stringColor(acc.name)
  const gear = collectGearFavs()
  const mapFavs = collectMapFavs()
  const com = collectCommunityActivity()
  const owned = getOwnedBikes()

  const realUser = auth.currentUser() && !auth.currentUser().guest
  const friends = accFriendsCount()
  const beitraege = com.posts.length + com.commentCount
  const I = ACC_NAV_ICONS
  const navItems = [
    ['overview', 'Chronik', I.chronik, null],
    /* Bikes, Ausruestung und Orte waren drei Reiter mit demselben Inhaltstyp:
       Dinge, die man sich gemerkt hat. Einzeln standen sie oft leer da. Jetzt
       ein Reiter mit einer Leiste darin. */
    ['favoriten', 'Favoriten', I.stern, owned.length + gear.length + mapFavs.length],
    ['journal', 'Fahrten', I.route, null],
    ['compare', 'Vergleich', I.compare, null],
    ['settings', 'Einstellungen', I.cog, null],
  ]
  return `
    <div class="acc-overlay" id="acc-overlay">
      <div class="acc-backdrop" id="acc-backdrop"></div>
      <aside class="acc-panel" role="dialog" aria-label="Konto">
        <button class="acc-close" id="acc-close" aria-label="Schließen">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>

        <div class="acc-profile">
          <!-- LINKS: Profil-Spalte -->
          <aside class="acc-side">
            <div class="acc-side-card">
              <div class="acc-avatar" style="background:${color}">${acc.avatar ? `<img src="${esc(acc.avatar)}" alt="">` : initials}</div>
              <div class="acc-name-row">
                <h2 class="acc-name" id="acc-display-name">${esc(acc.name)}</h2>
                <button class="acc-edit-icon" id="acc-edit-btn" title="Profil bearbeiten" aria-label="Profil bearbeiten">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
                </button>
              </div>
              <p class="acc-bio" id="acc-display-bio">${esc(acc.bio)}</p>
              <div class="acc-social">
                <div class="acc-social-item"><span class="acc-social-num">0</span><span class="acc-social-label">Folgen dir</span></div>
                <div class="acc-social-item"><span class="acc-social-num">0</span><span class="acc-social-label">Du folgst</span></div>
                <div class="acc-social-item"><span class="acc-social-num">${friends}</span><span class="acc-social-label">Freunde</span></div>
              </div>
              <button class="acc-auth-cta" id="acc-auth-btn">${realUser ? 'Abmelden' : 'Anmelden'}</button>
              <p class="acc-meta">Mitglied seit ${fmtDate(acc.joinedAt)}</p>
            </div>

            <nav class="acc-navlist" role="tablist">
              ${navItems.map(([id, label, icon, count], i) => `
                <button class="acc-navitem ${i === 0 ? 'acc-navitem--active' : ''}" data-tab="${id}" aria-label="${label}">
                  <span class="acc-navitem-ic">${icon}</span>
                  <span class="acc-navitem-label">${label}</span>
                  ${count != null ? `<span class="acc-navcount">${count}</span>` : '<span class="acc-navchev">›</span>'}
                </button>`).join('')}
            </nav>
          </aside>

          <!-- RECHTS: Inhalt / Chronik -->
          <main class="acc-main">
            <div class="acc-content" id="acc-content"></div>
          </main>
        </div>
      </aside>
    </div>
  `
}

function accFriendsCount() {
  try { return (JSON.parse(localStorage.getItem('mm_comm_friends_v2') || '[]')).length } catch { return 0 }
}
const ACC_NAV_ICONS = {
  chronik: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  bike:    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17 10 8h4l2 4M10 8l2 9"/></svg>',
  route:   '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/></svg>',
  compare: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7"/><rect x="14" y="6" width="3" height="11"/></svg>',
  gear2:   '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2M4 8h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M9 8V5a3 3 0 0 1 6 0v3"/></svg>',
  chat:    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  pin:     '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  cog:     '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h3M19 12h3M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  stern:   '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.8 6.2 20.9l1.1-6.5L2.6 9.8l6.5-.9z"/></svg>',
}

/** Aktualisiert Avatar/Name/Bio im Profil-Header, ohne das ganze Panel neu zu rendern. */
function refreshAccountHeader() {
  const acc = getAccount()
  const nameEl = document.getElementById('acc-display-name')
  if (nameEl) nameEl.textContent = acc.name
  const bioEl = document.getElementById('acc-display-bio')
  if (bioEl) bioEl.textContent = acc.bio
  const avatarEl = document.querySelector('.acc-side-card .acc-avatar')
  if (avatarEl) {
    avatarEl.style.background = stringColor(acc.name)
    avatarEl.innerHTML = acc.avatar ? `<img src="${esc(acc.avatar)}" alt="">` : getInitials(acc.name)
  }
  const settingsAvatarEl = document.getElementById('acc-avatar-preview')
  if (settingsAvatarEl) {
    settingsAvatarEl.style.background = stringColor(acc.name)
    settingsAvatarEl.innerHTML = acc.avatar ? `<img src="${esc(acc.avatar)}" alt="">` : getInitials(acc.name)
  }
}

function renderTabContent(tab) {
  const c = document.getElementById('acc-content')
  if (!c) return
  switch (tab) {
    case 'overview':    c.innerHTML = renderOverview(); break
    case 'favoriten':   c.innerHTML = renderFavoriten(); wireFavoriten(); break
    case 'bikes':       c.innerHTML = renderBikes(); wireBikeSearch(); break
    case 'compare':     c.innerHTML = renderCompare(); wireCompare(); break
    case 'journal':     c.innerHTML = renderJournal(); wireJournal(); break
    case 'gear':        c.innerHTML = renderGear(); break
    case 'community':   c.innerHTML = renderCommunity(); break
    case 'settings':    c.innerHTML = renderSettings(); wireSettings(); break
  }
  wireTabContent()
}

/* Die Plakette am Reiter zaehlt alle drei Arten zusammen — nach dem Entfernen
   eines Eintrags muss sie neu gerechnet werden, nicht nur die eine Zahl
   gesetzt. */
function aktualisiereFavoritenZaehler() {
  const badge = document.querySelector('.acc-navitem[data-tab="favoriten"] .acc-navcount')
  if (!badge) return
  badge.textContent = String(
    getOwnedBikes().length + collectGearFavs().length + collectMapFavs().length,
  )
}

function wireTabContent() {
  // Open bike: dispatch a custom event for landing/bike-detail to handle
  document.querySelectorAll('[data-open-bike]').forEach(el => {
    el.addEventListener('click', () => {
      const name = el.dataset.openBike
      const tab = el.dataset.openTab || null
      window.dispatchEvent(new CustomEvent('mm:open-bike', { detail: { name, tab } }))
      closeAccount()
    })
  })
  // Open community
  document.querySelectorAll('[data-open-community]').forEach(el => {
    el.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('mm:open-community'))
      closeAccount()
    })
  })
  /* Zu einem anderen Reiter springen (Schnellzugriff-Kacheln, Chronik-Einträge, …)
     bikes, gear und places sind keine eigenen Reiter mehr, sondern Filter
     innerhalb von "Favoriten" — die alten Ziele bleiben trotzdem gueltig und
     stellen den passenden Filter ein. */
  const FAV_ZIELE = { bikes: 'bikes', gear: 'gear', places: 'places' }
  document.querySelectorAll('[data-tab-jump]').forEach(el => {
    el.addEventListener('click', () => {
      const ziel = el.dataset.tabJump
      if (FAV_ZIELE[ziel]) {
        setFavFilter(FAV_ZIELE[ziel])
        document.querySelector('.acc-navitem[data-tab="favoriten"]')?.click()
        return
      }
      document.querySelector(`.acc-navitem[data-tab="${ziel}"]`)?.click()
    })
  })
  // Eigenes Bike wieder entfernen
  document.querySelectorAll('[data-remove-owned-bike]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation()
      toggleOwnedBike(el.dataset.removeOwnedBike)
      aktualisiereFavoritenZaehler()
      renderTabContent(getActiveTab())
    })
  })
  // Remove favorite (gear)
  document.querySelectorAll('[data-remove-gear-fav]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation()
      const id = el.dataset.removeGearFav
      try {
        let favs = JSON.parse(localStorage.getItem('mm_gear_favs') || '[]')
        favs = favs.filter(f => f !== id)
        localStorage.setItem('mm_gear_favs', JSON.stringify(favs))
        const meta = JSON.parse(localStorage.getItem('mm_gear_favs_meta') || '{}')
        delete meta[id]
        localStorage.setItem('mm_gear_favs_meta', JSON.stringify(meta))
        aktualisiereFavoritenZaehler()
        renderTabContent(getActiveTab())
      } catch {}
    })
  })
  // Remove favorite (place)
  document.querySelectorAll('[data-remove-place-fav]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation()
      const id = el.dataset.removePlaceFav
      try {
        let favs = JSON.parse(localStorage.getItem('mm_kv_favs') || '[]')
        favs = favs.filter(f => f !== id)
        localStorage.setItem('mm_kv_favs', JSON.stringify(favs))
        const meta = JSON.parse(localStorage.getItem('mm_kv_favs_meta') || '{}')
        delete meta[id]
        localStorage.setItem('mm_kv_favs_meta', JSON.stringify(meta))
        aktualisiereFavoritenZaehler()
        renderTabContent(getActiveTab())
      } catch {}
    })
  })
  // Navigate saved place → in-app Karte view
  document.querySelectorAll('[data-open-place-map]').forEach(el => {
    el.addEventListener('click', () => {
      const lat = parseFloat(el.dataset.lat)
      const lng = parseFloat(el.dataset.lng)
      closeAccount()
      window.dispatchEvent(new CustomEvent('mm:open-karte', { detail: { lat, lng } }))
    })
  })
  // Delete community post
  document.querySelectorAll('[data-delete-post]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation()
      const id = el.dataset.deletePost
      try {
        let posts = JSON.parse(localStorage.getItem('mm_user_posts_v1') || '[]')
        posts = posts.filter(p => p.id !== id)
        localStorage.setItem('mm_user_posts_v1', JSON.stringify(posts))
        renderTabContent(getActiveTab())
      } catch {}
    })
  })
}
function getActiveTab() {
  return document.querySelector('.acc-navitem--active')?.dataset.tab || 'overview'
}

/* Ein Bike in einer Liste zeigt sein eigenes Foto, nicht ein Sinnbild fuer
   "Motorrad". Genommen wird die freigestellte Kachel (…_kachel.webp), dieselbe
   wie in der Suche.

   Gesucht wird ueber findBikeByShortName aus matching.js statt ueber einen
   eigenen Vergleich auf name: die Speicher legen mal den vollen Namen ab
   ("Harley-Davidson Iron 883"), mal den kurzen aus dem Konfigurator
   ("Iron 883") — nur name zu pruefen liess jede Vergleichsspalte leer.

   Findet sich nichts oder fehlt das Foto, kommt der graue Universal-
   Platzhalter aus der Bildwerkstatt. Er traegt keine Marke, damit ihn niemand
   fuer das gesuchte Modell haelt. */
function bikeKachel(name, klasse) {
  const kat = findBikeByShortName(name)
  const bild = bikeBild(kat, 'kachel')
  return `<div class="${klasse} ${klasse}--foto"><img src="${esc(bild)}" alt="" loading="lazy" decoding="async"></div>`
}

// ─── Tab renderers ───
/** Sammelt alle bekannten Nutzeraktionen aus den verschiedenen Feature-Speichern
 *  zu einer einzigen, chronologisch sortierten Aktivitäts-Chronik. */
function collectActivityFeed(limit = 12) {
  const gear = collectGearFavs()
  const com = collectCommunityActivity()
  const recents = collectRecentBikes()
  const rides = getRides()

  /* Die Chronik speichert nur Name, Stil und Zeit — das Bild steht im Katalog.
     Genommen wird die freigestellte Kachel, dieselbe wie in der Suche; ohne
     Treffer der graue Universal-Platzhalter. Beide stehen auf Weiss, deshalb
     bekommt die Kachel in .acc-activity-icon--foto eine helle Flaeche. */
  const activities = []
  recents.forEach(b => {
    const kat = findBikeByShortName(b.name)
    activities.push({
      type: 'bike', icon: ACC_NAV_ICONS.bike,
      bild: bikeBild(kat, 'kachel'),
      title: `${b.name} angesehen`, sub: b.style, ts: b.ts,
      jump: { openBike: b.name },
    })
  })
  gear.forEach(g => activities.push({
    type: 'gear', icon: ACC_NAV_ICONS.gear2,
    title: `${g.brand} ${g.name} gemerkt`, sub: `${g.type} · ${g.price}`, ts: g.ts || 0,
    jump: { tab: 'gear' },
  }))
  com.posts.forEach(p => activities.push({
    type: 'post', icon: ACC_NAV_ICONS.chat,
    title: `Beitrag veröffentlicht: ${p.title}`, sub: p.category, ts: p.createdAt,
    jump: { community: true },
  }))
  rides.forEach(r => activities.push({
    type: 'ride', icon: ACC_NAV_ICONS.route,
    title: `Fahrt erfasst: ${r.title}`, sub: `${r.km} km${r.hours ? ` · ${r.hours} h` : ''}`, ts: r.date,
    jump: { tab: 'journal' },
  }))
  activities.sort((a, b) => b.ts - a.ts)
  return activities.slice(0, limit)
}

function renderOverview() {
  const recent5 = collectActivityFeed(12)
  return `
    <div class="acc-section">
      <h3 class="acc-section-title">Schnellzugriff</h3>
      <div class="acc-quick-grid">
        <button class="acc-quick-card" data-open-community>
          <div class="acc-quick-icon">${ACC_NAV_ICONS.chat}</div>
          <span class="acc-quick-label">Community</span>
        </button>
        <button class="acc-quick-card" data-tab-jump="gear">
          <div class="acc-quick-icon">${ACC_NAV_ICONS.gear2}</div>
          <span class="acc-quick-label">Ausrüstung</span>
        </button>
        <button class="acc-quick-card" data-tab-jump="places">
          <div class="acc-quick-icon">${ACC_NAV_ICONS.pin}</div>
          <span class="acc-quick-label">Meine Orte</span>
        </button>
        <button class="acc-quick-card" data-tab-jump="bikes">
          <div class="acc-quick-icon">${ACC_NAV_ICONS.bike}</div>
          <span class="acc-quick-label">Meine Bikes</span>
        </button>
      </div>
    </div>

    <div class="acc-section">
      <h3 class="acc-section-title">Chronik</h3>
      ${recent5.length === 0 ? `
        <div class="acc-empty">
          <p>Noch keine Aktivität — fang an, Bikes & Ausrüstung zu entdecken!</p>
        </div>
      ` : `
        <div class="acc-activity-list">
          ${recent5.map(a => `
            <div class="acc-activity-item" ${a.jump?.openBike ? `data-open-bike="${a.jump.openBike}"` : ''} ${a.jump?.tab ? `data-tab-jump="${a.jump.tab}"` : ''} ${a.jump?.community ? 'data-open-community' : ''}>
              <div class="acc-activity-icon${a.bild ? ' acc-activity-icon--foto' : ''}">${a.bild ? `<img src="${esc(a.bild)}" alt="" loading="lazy" decoding="async">` : a.icon}</div>
              <div class="acc-activity-body">
                <div class="acc-activity-title">${esc(a.title)}</div>
                <div class="acc-activity-sub">${esc(a.sub)}</div>
              </div>
              <div class="acc-activity-time">${fmtRelative(a.ts)}</div>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `
}

/* ─── Bike comparison data + storage ───
   COMPARE_SPECS deckt nur die vier Schaustück-Bikes ab — jedes echte
   Katalog-Bike (aus "Zuletzt angesehen" oder der Suche) fand hier nie einen
   Eintrag und zeigte deshalb überall "–" (2026-09-27 Audit). Specs kommen
   jetzt live aus dem Katalog, COMPARE_SPECS bleibt nur als Fallback für die
   vier Demo-Namen ohne echten Katalogeintrag. */
const COMPARE_SPECS = {
  'Iron 883':      { ps: 51, weight: 256, accel: 6.5, topSpeed: 161, cc: 883,  price: 7000 },
  'Seventy-Two':   { ps: 66, weight: 255, accel: 5.2, topSpeed: 170, cc: 1202, price: 15000 },
  'CB 750 F':      { ps: 67, weight: 235, accel: 5.8, topSpeed: 200, cc: 736,  price: 12000 },
  '500 Custom':    { ps: 48, weight: 200, accel: 6.0, topSpeed: 180, cc: 500,  price: 6500 },
}
/* Der Name kommt mal mit, mal ohne Marke an: `trackBikeVisit` (bike-detail.js) schreibt
   `data.fullName || bikeData.name`, also "Honda CMX500 Rebel" oder "CMX500 Rebel". Früher stand hier
   eine Regex mit neun fest verdrahteten Marken — sie kannte 33 der 42 Marken im Katalog nicht (378 von
   1192 Bikes: MV Agusta, Moto Guzzi, Aprilia, Vespa, Piaggio …) und traf "Honda CMX500 Rebel" auch bei
   den neun nicht, weil sie die Marke am Katalognamen abschnitt statt am gesuchten. Beides zeigte in der
   Vergleichstabelle überall "–" (2026-09-27 Audit).
   Jetzt entscheidet `brand` aus dem Katalog — bei allen 1192 Einträgen gesetzt, und `name` beginnt
   immer damit. Verglichen wird ohne Sonderzeichen, damit "R 1250 GS" und "R1250GS" dasselbe sind. */
function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}
function findCatalogBikeByFullName(name) {
  const gesucht = normName(name)
  if (!gesucht) return null
  return getCatalog().find((b) => {
    const voll = normName(b.name)
    if (voll === gesucht) return true
    const ohneMarke = normName(String(b.name || '').slice(String(b.brand || '').length))
    return Boolean(ohneMarke) && ohneMarke === gesucht
  }) || null
}
function compareSpecsFor(name) {
  const bike = findCatalogBikeByFullName(name)
  if (!bike) return COMPARE_SPECS[name] || null
  const preis = preisAb(bike, Infinity)
  return {
    ps: bike.ps ?? null,
    weight: bike.weight ?? null,
    accel: bike.accel ?? null,
    topSpeed: bike.topSpeed ?? null,
    cc: bike.cc ?? null,
    // Die 1 war nie ein Platzhalter, sondern ein Fehler in csv_de.py: `x and not y` ergibt True statt x,
    // woraus zahl(True) eine 1 machte (2026-09-27 behoben). Der Katalog lässt den Preis jetzt weg, wenn
    // keiner belegt ist — deshalb zählt nur noch, ob überhaupt eine Zahl da ist.
    price: Number.isFinite(preis) ? preis : null,
  }
}
function getCompareSet() {
  try { return JSON.parse(localStorage.getItem('mm_compare_v1') || '[]') } catch { return [] }
}
function saveCompareSet(arr) {
  try { localStorage.setItem('mm_compare_v1', JSON.stringify(arr.slice(0, 3))) } catch {}
}

function renderCompare() {
  const set = getCompareSet()
  const recents = collectRecentBikes()
  // Build option list from recents
  const options = recents.length
    ? recents.map(b => b.name)
    : ['Iron 883', 'Seventy-Two', 'CB 750 F', '500 Custom']
  const searchBar = `
    <div class="acc-cmp-search-wrap">
      <input class="acc-cmp-search-input" id="cmp-search-input" type="text" placeholder="Bike suchen …" autocomplete="off" ${set.length >= 3 ? 'disabled' : ''}>
      <ul class="acc-cmp-search-results" id="cmp-search-results" style="display:none"></ul>
    </div>
  `
  if (!set.length) {
    return `
      <div class="acc-section">
        <h3 class="acc-section-title">Bike-Vergleich</h3>
        <p class="acc-section-sub">Wähle bis zu 3 Bikes und sieh die Specs direkt nebeneinander.</p>
        ${searchBar}
        <div class="acc-cmp-picker">
          ${options.slice(0, 8).map(name => `
            <button class="acc-cmp-add" data-cmp-add="${name}">+ ${name}</button>
          `).join('')}
        </div>
        <div class="acc-empty" style="padding:32px 20px">
          <p>Noch keine Bikes ausgewählt</p>
          <p class="acc-empty-sub">Suche oben oder wähle ein Bike aus.</p>
        </div>
      </div>
    `
  }
  const specs = ['ps', 'weight', 'accel', 'topSpeed', 'cc', 'price']
  const specLabels = { ps: 'Leistung (PS)', weight: 'Gewicht (kg)', accel: '0–100 (s)', topSpeed: 'Top-Speed (km/h)', cc: 'Hubraum (ccm)', price: 'Preis (€)' }
  const lowerBetter = { weight: true, accel: true, price: true }
  const findBest = (key) => {
    let bestVal = null
    let bestName = null
    set.forEach(name => {
      const v = compareSpecsFor(name)?.[key]
      if (v == null) return
      if (bestVal === null) { bestVal = v; bestName = name; return }
      if (lowerBetter[key] ? v < bestVal : v > bestVal) { bestVal = v; bestName = name }
    })
    return bestName
  }
  return `
    <div class="acc-section">
      <h3 class="acc-section-title">Bike-Vergleich <span class="acc-count">${set.length}/3</span></h3>
      ${searchBar}
      <div class="acc-cmp-picker">
        ${options.filter(n => !set.includes(n)).slice(0, 6).map(name => `
          <button class="acc-cmp-add" data-cmp-add="${name}" ${set.length >= 3 ? 'disabled' : ''}>+ ${name}</button>
        `).join('')}
      </div>
      <div class="acc-cmp-table">
        <div class="acc-cmp-header">
          <div></div>
          ${set.map(name => `
            <div class="acc-cmp-col">
              ${bikeKachel(name, 'acc-cmp-bike-icon')}
              <div class="acc-cmp-bike-name">${name}</div>
              <button class="acc-cmp-remove" data-cmp-remove="${name}" aria-label="Entfernen">×</button>
            </div>
          `).join('')}
        </div>
        ${specs.map(key => {
          const best = findBest(key)
          return `
            <div class="acc-cmp-row">
              <div class="acc-cmp-label">${specLabels[key]}</div>
              ${set.map(name => {
                const v = compareSpecsFor(name)?.[key] ?? '—'
                const display = key === 'price' && v !== '—' ? `${v.toLocaleString('de-DE')} €` : v
                return `<div class="acc-cmp-cell ${name === best ? 'acc-cmp-cell--best' : ''}">${display}${name === best ? ' <span class="acc-cmp-best-tag">BEST</span>' : ''}</div>`
              }).join('')}
            </div>
          `
        }).join('')}
      </div>
    </div>
  `
}
function wireCompare() {
  document.querySelectorAll('[data-cmp-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.cmpAdd
      const set = getCompareSet()
      if (set.length >= 3 || set.includes(name)) return
      set.push(name)
      saveCompareSet(set)
      renderTabContent('compare')
    })
  })
  document.querySelectorAll('[data-cmp-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.cmpRemove
      saveCompareSet(getCompareSet().filter(n => n !== name))
      renderTabContent('compare')
    })
  })

  const searchInput = document.getElementById('cmp-search-input')
  const searchResults = document.getElementById('cmp-search-results')
  if (!searchInput) return

  const bikeListPromise = import('./bike-detail.js').then(m =>
    Object.values(m.BIKE_DATA || {}).map(b => ({ name: b.fullName, style: b.style || '', image: b.img1 || b.img2 || '' }))
  ).catch(() => [])

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase()
    if (!q) { searchResults.innerHTML = ''; searchResults.style.display = 'none'; return }
    bikeListPromise.then(bikes => {
      const set = getCompareSet()
      const hits = bikes.filter(b => b.name.toLowerCase().includes(q) || b.style.toLowerCase().includes(q)).slice(0, 6)
      if (!hits.length) { searchResults.style.display = 'none'; return }
      searchResults.innerHTML = hits.map(b => `
        <li class="acc-cmp-search-item ${set.includes(b.name) ? 'acc-cmp-search-item--in' : ''}"
          data-name="${b.name}" data-style="${b.style}" data-image="${b.image}">
          <img class="acc-cmp-search-img" src="${bikeBild(b, 'kachel')}" alt="">
          <span class="acc-cmp-search-name">${b.name}</span>
          <span class="acc-cmp-search-style">${b.style}</span>
          ${set.includes(b.name) ? '<span class="acc-cmp-search-check">✓</span>' : ''}
        </li>
      `).join('')
      searchResults.style.display = 'block'
      searchResults.querySelectorAll('.acc-cmp-search-item:not(.acc-cmp-search-item--in)').forEach(li => {
        li.addEventListener('click', () => {
          const set = getCompareSet()
          if (set.length >= 3 || set.includes(li.dataset.name)) return
          set.push(li.dataset.name)
          saveCompareSet(set)
          searchInput.value = ''
          searchResults.style.display = 'none'
          renderTabContent('compare')
        })
      })
    })
  })

  document.addEventListener('click', e => {
    if (!e.target.closest('.acc-cmp-search-wrap')) {
      searchResults.style.display = 'none'
    }
  }, { once: true })
}

/* ─── Ride journal ─── */

/* Die Aufzeichnung ist gebaut und geprueft, geht aber noch nicht mit live:
   sie braucht eine Runde auf echter Strasse mit echtem Satellitenempfang,
   bevor Nutzer sie zu sehen bekommen. Der Schalter blendet den Knopf, die
   Vollbild-Ansicht und den Hinweis auf eine unterbrochene Aufzeichnung aus.
   Alles andere im Fahrtenbuch bleibt: eine Fahrt von Hand eintragen, die
   Karteikarten, das Teilen. Auf true stellen, dann ist sie wieder da. */
const AUFZEICHNEN_AKTIV = false
function getRides() {
  try { return JSON.parse(localStorage.getItem('mm_rides_v1') || '[]') } catch { return [] }
}
function saveRides(arr) {
  try { localStorage.setItem('mm_rides_v1', JSON.stringify(arr)) } catch {}
}

const RIDE_MOODS = ['☀️','⛅','🌧️','🌩️','❄️','🌫️']
const CARD_ACCENTS = ['#e8c56d','#7ab3e0','#e07a5f','#81b29a','#c77dff','#f4a261']
const CARD_ROTATIONS = ['-1.2deg','0.8deg','-0.5deg','1.5deg','-0.9deg','0.4deg']

function compressPhoto(file) {
  return new Promise(resolve => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const max = 600
      let w = img.width, h = img.height
      if (w > max || h > max) { const r = Math.min(max/w, max/h); w = w*r|0; h = h*r|0 }
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.72))
    }
    // Ohne diesen Zweig wird das Promise bei einer defekten oder
    // nicht-dekodierbaren Datei NIE aufgeloest — der await davor haengt dann
    // fuer immer, und der Nutzer sieht gar keine Rueckmeldung.
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

/* Die aufgezeichnete Strecke als Linie — ohne Kartendienst. Ein Kartenbild
   haette den Standort an einen fremden Anbieter gemeldet und braeuchte eine
   Einwilligung; die blosse Form der Strecke verraet dagegen nicht, wo sie
   liegt. Genau deshalb steht in der Vorschau auch kein Ortsname. */
function spurSvg(track, b, h, klasse) {
  const d = spurPfad(track?.punkte, b, h, 8)
  if (!d) return ''
  return `<svg class="${klasse}" viewBox="0 0 ${b} ${h}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`
}

/* Die Detailansicht einer aufgezeichneten Fahrt: Streckenriss, Kilometer-
   Abschnitte, Tempo- und Hoehenverlauf. Alles aus der gespeicherten Spur
   gerechnet, keine Nachfrage an irgendeinen Dienst. */
function renderFahrtDetail(r) {
  const t = r.track
  const abschnitte = kilometerAbschnitte(t)
  const tempo = tempoVerlauf(t)
  const hoehe = hoehenVerlauf(t)
  const schnellster = abschnitte.length
    ? abschnitte.reduce((a, b) => (b.kmh > a.kmh ? b : a)) : null

  const kurve = (werte, schluessel, klasse, einheit, nachkomma = 0) => {
    if (!werte.length) return ''
    const { d, min, max } = verlaufPfad(werte, schluessel, 600, 120, 6)
    if (!d) return ''
    return `
      <div class="rj-kurve ${klasse}">
        <svg viewBox="0 0 600 120" preserveAspectRatio="none" aria-hidden="true">
          <path d="${verlaufFlaeche(d, 600, 120, 6)}" class="rj-kurve-flaeche"/>
          <path d="${d}" class="rj-kurve-linie"/>
        </svg>
        <span class="rj-kurve-max">${max.toFixed(nachkomma)} ${einheit}</span>
        <span class="rj-kurve-min">${min.toFixed(nachkomma)} ${einheit}</span>
      </div>`
  }

  return `
    <div class="rj-detail-kopf">
      <button class="rj-detail-zurueck" id="rj-detail-zurueck">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Fahrtenbuch
      </button>
      <button class="rj-detail-teilen" data-share-ride="${r.id}">Teilen</button>
    </div>

    <h3 class="rj-detail-titel">${esc(r.title)}</h3>
    <div class="rj-detail-datum">${new Date(r.date).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</div>

    <div class="rj-detail-spur" style="--accent:${r.accent || '#e8c56d'}">
      ${spurSvg(t, 600, 300, 'rj-detail-spur-svg')}
    </div>

    <div class="rj-detail-zahlen">
      <div class="rj-detail-zahl"><span>${(r.km || 0).toLocaleString('de-DE')}</span><small>Kilometer</small></div>
      <div class="rj-detail-zahl"><span>${formatiereDauer(t.fahrMs)}</span><small>Fahrzeit</small></div>
      <div class="rj-detail-zahl"><span>${Math.round(t.schnittKmh || 0)}</span><small>km/h ø</small></div>
      <div class="rj-detail-zahl"><span>${Math.round(t.maxKmh || 0)}</span><small>km/h max</small></div>
      ${t.hoehenMeter ? `<div class="rj-detail-zahl"><span>${Math.round(t.hoehenMeter)}</span><small>Höhenmeter</small></div>` : ''}
    </div>

    ${tempo.length ? `
      <div class="rj-detail-block">
        <h4 class="rj-detail-h">Tempo über die Strecke</h4>
        ${kurve(tempo, 'kmh', 'is-tempo', 'km/h')}
      </div>` : ''}

    ${hoehe.length ? `
      <div class="rj-detail-block">
        <h4 class="rj-detail-h">Höhe</h4>
        ${kurve(hoehe, 'h', 'is-hoehe', 'm')}
      </div>` : `
      <div class="rj-detail-block">
        <h4 class="rj-detail-h">Höhe</h4>
        <p class="rj-detail-leer">Dieses Gerät hat während der Fahrt keine Höhe geliefert. Das ist normal — viele Telefone melden sie nur bei gutem Empfang unter freiem Himmel.</p>
      </div>`}

    ${abschnitte.length ? `
      <div class="rj-detail-block">
        <h4 class="rj-detail-h">Kilometer</h4>
        <div class="rj-splits">
          ${abschnitte.map(a => {
            const anteil = schnellster && schnellster.kmh > 0 ? a.kmh / schnellster.kmh : 0
            return `
              <div class="rj-split">
                <span class="rj-split-km">${a.teil ? `${a.km} (${a.teil} km)` : a.km}</span>
                <span class="rj-split-bar"><i style="width:${(anteil * 100).toFixed(1)}%"></i></span>
                <span class="rj-split-kmh">${a.kmh.toFixed(1).replace('.', ',')} km/h</span>
                <span class="rj-split-zeit">${formatiereDauer(a.dauerMs)}</span>
                ${a.anstieg != null ? `<span class="rj-split-hm">${a.anstieg > 0 ? '+' : ''}${a.anstieg} m</span>` : '<span class="rj-split-hm"></span>'}
              </div>`
          }).join('')}
        </div>
      </div>` : ''}

    ${r.notes ? `<div class="rj-detail-block"><h4 class="rj-detail-h">Notiz</h4><p class="rj-detail-notiz">${esc(r.notes)}</p></div>` : ''}

    <button class="rj-detail-bearbeiten" data-edit-ride="${r.id}">Eintrag bearbeiten</button>
  `
}

function renderJournal() {
  const rides = getRides().sort((a, b) => b.date - a.date)
  const totalKm = rides.reduce((s, r) => s + (r.km || 0), 0)
  const totalHours = rides.reduce((s, r) => s + (r.hours || 0), 0)
  const months = [...new Set(rides.map(r => {
    const d = new Date(r.date); return `${d.getFullYear()}-${d.getMonth()}`
  }))]

  return `
    <div class="rj-wrap">
      <!-- Header stats bar -->
      <div class="rj-header">
        <div class="rj-stat"><span class="rj-stat-num">${rides.length}</span><span class="rj-stat-lbl">Fahrten</span></div>
        <div class="rj-stat"><span class="rj-stat-num">${totalKm.toLocaleString('de-DE')}</span><span class="rj-stat-lbl">km</span></div>
        <div class="rj-stat"><span class="rj-stat-num">${totalHours.toFixed(0)}</span><span class="rj-stat-lbl">Stunden</span></div>
        <div class="rj-stat"><span class="rj-stat-num">${months.length}</span><span class="rj-stat-lbl">Monate</span></div>
        ${AUFZEICHNEN_AKTIV && standortVerfuegbar() ? `
          <button class="rj-rec-btn" id="rj-start-rec">
            <span class="rj-rec-btn-dot"></span>
            Aufzeichnen
          </button>
        ` : ''}
        <button class="rj-add-btn" id="rj-open-form">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
          Neue Fahrt
        </button>
      </div>

      ${(() => {
        /* Wer waehrend der Fahrt die Seite neu laedt oder dessen Telefon den
           Browser wegraeumt, soll die gefahrenen Kilometer nicht verlieren.
           Der Zwischenstand wird alle fuenf Sekunden gesichert. */
        if (!AUFZEICHNEN_AKTIV) return ''
        const offen = unterbrocheneAufzeichnung()
        if (!offen) return ''
        const km = (offen.meter / 1000).toFixed(1).replace('.', ',')
        return `
          <div class="rj-resume" id="rj-resume">
            <div class="rj-resume-text">
              Eine Aufzeichnung wurde unterbrochen — <strong>${km} km</strong> sind gesichert.
            </div>
            <div class="rj-resume-btns">
              <button class="rj-resume-go" id="rj-resume-go">Fortsetzen</button>
              <button class="rj-resume-drop" id="rj-resume-drop">Verwerfen</button>
            </div>
          </div>
        `
      })()}

      <!-- Aufzeichnung: eigener Vollbild-Schirm, damit die Zahlen waehrend
           der Fahrt aus Armlaenge lesbar sind -->
      ${!AUFZEICHNEN_AKTIV ? '' : `
      <div class="rj-rec" id="rj-rec" hidden>
        <div class="rj-rec-top">
          <div class="rj-rec-status">
            <span class="rj-rec-dot" id="rj-rec-dot"></span>
            <span id="rj-rec-state">Warte auf Satellitenempfang …</span>
          </div>
          <span class="rj-rec-gps" id="rj-rec-gps"></span>
        </div>

        <div class="rj-rec-haupt">
          <span class="rj-rec-haupt-num" id="rj-rec-km">0,00</span>
          <span class="rj-rec-haupt-lbl">Kilometer</span>
        </div>

        <div class="rj-rec-map">
          <svg class="rj-rec-svg" id="rj-rec-svg" viewBox="0 0 320 190" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <path id="rj-rec-path" d="" fill="none" stroke="currentColor" stroke-width="3"
                  stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="rj-rec-empty" id="rj-rec-empty">Die Strecke erscheint, sobald der erste Punkt steht.</div>
        </div>

        <div class="rj-rec-nums">
          <div class="rj-rec-num"><span id="rj-rec-time">0:00</span><small>Fahrzeit</small></div>
          <div class="rj-rec-num"><span id="rj-rec-kmh">0</span><small>km/h</small></div>
          <div class="rj-rec-num"><span id="rj-rec-avg">0</span><small>km/h ø</small></div>
          <div class="rj-rec-num"><span id="rj-rec-hm">0</span><small>Höhenmeter</small></div>
        </div>

        <div class="rj-rec-btns">
          <button type="button" class="rj-rec-pause" id="rj-rec-pause">Pause</button>
          <button type="button" class="rj-rec-stop" id="rj-rec-stop">Fahrt beenden</button>
        </div>
        <button type="button" class="rj-rec-cancel" id="rj-rec-cancel">Aufzeichnung verwerfen</button>
        <p class="rj-rec-hint">
          Die Strecke bleibt auf diesem Gerät. Es wird keine Karte geladen und
          keine Koordinate versendet.
        </p>
      </div>`}

      <!-- New ride sheet (hidden by default) -->
      <div class="rj-sheet" id="rj-sheet" hidden>
        <div class="rj-sheet-inner">
          <div class="rj-sheet-tape"></div>
          <div class="rj-sheet-header">
            <span class="rj-sheet-label">Neue Seite</span>
            <button class="rj-sheet-close" id="rj-close-form" aria-label="Schließen">✕</button>
          </div>

          <!-- Photo upload -->
          <div class="rj-photo-drop" id="rj-photo-drop">
            <input type="file" id="rj-photo-input" accept="image/*" hidden>
            <div class="rj-photo-placeholder" id="rj-photo-placeholder">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
              <span>Foto hinzufügen</span>
            </div>
            <img class="rj-photo-preview" id="rj-photo-preview" hidden>
            <button class="rj-photo-remove" id="rj-photo-remove" hidden aria-label="Foto entfernen">✕</button>
          </div>

          <form id="rj-form">
            <div class="rj-field-title-wrap">
              <input type="text" class="rj-title-input" id="rj-title" placeholder="Titel der Fahrt …" maxlength="50" required>
              <input type="date" class="rj-date-input" id="rj-date" value="${new Date().toISOString().slice(0,10)}" required>
            </div>

            <div class="rj-field-row">
              <label class="rj-field">
                <span>km</span>
                <input type="number" class="rj-input" id="rj-km" min="0" step="1" placeholder="120" required>
              </label>
              <label class="rj-field">
                <span>Stunden</span>
                <input type="number" class="rj-input" id="rj-hours" min="0" step="0.5" placeholder="2.5">
              </label>
            </div>

            <div class="rj-mood-row">
              <span class="rj-mood-label">Wetter</span>
              ${RIDE_MOODS.map((m,i) => `
                <label class="rj-mood-opt">
                  <input type="radio" name="rj-mood" value="${m}" ${i===0?'checked':''}>
                  <span>${m}</span>
                </label>
              `).join('')}
            </div>

            <textarea class="rj-notes-input" id="rj-notes" rows="4" placeholder="Was war besonders? Strecke, Highlights, Gedanken …" maxlength="400"></textarea>

            <div class="rj-accent-row">
              <span class="rj-mood-label">Farbe</span>
              ${CARD_ACCENTS.map((c,i) => `
                <label class="rj-accent-opt">
                  <input type="radio" name="rj-accent" value="${c}" ${i===0?'checked':''}>
                  <span style="background:${c}"></span>
                </label>
              `).join('')}
            </div>

            <button type="submit" class="rj-save-btn">Eintrag speichern</button>
          </form>
        </div>
      </div>

      ${(() => {
        /* Bestwerte erst ab der zweiten Fahrt: bei einer einzigen waere jede
           Zeile dieselbe Fahrt, das sagt nichts. */
        if (rides.length < 2) return ''
        const b = bestwerte(rides)
        const zeile = (label, wert, zusatz) => wert ? `
          <div class="rj-best">
            <span class="rj-best-lbl">${label}</span>
            <span class="rj-best-val">${wert}</span>
            ${zusatz ? `<span class="rj-best-sub">${esc(zusatz)}</span>` : ''}
          </div>` : ''
        return `
          <div class="rj-bests">
            ${zeile('Diesen Monat', `${b.kmMonat.toLocaleString('de-DE')} km`)}
            ${zeile('Längste Fahrt', b.laengste ? `${b.laengste.km} km` : '', b.laengste?.title)}
            ${b.schnellste ? zeile('Schnellste ø', `${Math.round(b.schnellste.track.schnittKmh)} km/h`, b.schnellste.title) : ''}
            ${b.hoehenMeter > 0 ? zeile('Höhenmeter', `${b.hoehenMeter.toLocaleString('de-DE')} hm`) : ''}
          </div>
        `
      })()}

      <!-- Pinboard -->
      ${rides.length === 0 ? `
        <div class="rj-empty">
          <div style="font-size:48px;opacity:.3">📖</div>
          <div>Dein Journal ist noch leer.</div>
          <div style="font-size:12px;color:#666;margin-top:4px">Klicke auf „Neue Fahrt" um deine erste Seite zu erstellen.</div>
        </div>
      ` : `
        <div class="rj-board" id="rj-board">
          ${rides.map((r, i) => {
            const accent = r.accent || CARD_ACCENTS[i % CARD_ACCENTS.length]
            const rot = CARD_ROTATIONS[i % CARD_ROTATIONS.length]
            const d = new Date(r.date)
            const dayStr = d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' })
            const yearStr = d.getFullYear()
            return `
              <div class="rj-card" style="--accent:${accent};--rot:${rot}" data-open-ride="${r.id}" role="button" tabindex="0">
                <div class="rj-card-pin"></div>
                <button class="rj-card-share" data-share-ride="${r.id}" title="Fahrt teilen" aria-label="Fahrt teilen">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v14"/></svg>
                </button>
                ${r.photo
                  ? `<img class="rj-card-photo" src="${r.photo}" alt="">`
                  : (spurSvg(r.track, 240, 120, 'rj-card-spur')
                      ? `<div class="rj-card-spur-wrap">${spurSvg(r.track, 240, 120, 'rj-card-spur')}</div>`
                      : `<div class="rj-card-photo-empty">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".25"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                  </div>`)}
                ${r.photo && r.track?.punkte?.length >= 2
                  ? `<div class="rj-card-spur-strip">${spurSvg(r.track, 240, 34, 'rj-card-spur')}</div>` : ''}
                <div class="rj-card-body">
                  <div class="rj-card-date">${dayStr} <span>${yearStr}</span></div>
                  <div class="rj-card-title">${esc(r.title)}</div>
                  <div class="rj-card-chips">
                    <span class="rj-chip">${r.km} km</span>
                    ${r.track?.fahrMs ? `<span class="rj-chip">${formatiereDauer(r.track.fahrMs)}</span>`
                                      : (r.hours ? `<span class="rj-chip">${r.hours} h</span>` : '')}
                    ${r.track?.schnittKmh ? `<span class="rj-chip">ø ${Math.round(r.track.schnittKmh)} km/h</span>` : ''}
                    ${r.mood ? `<span class="rj-chip rj-chip-mood">${esc(r.mood)}</span>` : ''}
                  </div>
                  ${r.notes ? `<div class="rj-card-notes">${esc(r.notes)}</div>` : ''}
                </div>
                <div class="rj-card-edit-hint">Tippen zum Bearbeiten</div>
              </div>
            `
          }).join('')}
        </div>
      `}
      <!-- Detailansicht einer aufgezeichneten Fahrt -->
      <div class="rj-detail" id="rj-detail" hidden></div>

      <!-- Edit overlay -->
      <div class="rj-edit-overlay" id="rj-edit-overlay" hidden>
        <div class="rj-edit-modal">
          <div class="rj-edit-header">
            <span class="rj-sheet-label">Eintrag bearbeiten</span>
            <button class="rj-sheet-close" id="rj-edit-close" aria-label="Schließen">✕</button>
          </div>
          <div class="rj-photo-drop" id="rj-edit-photo-drop">
            <input type="file" id="rj-edit-photo-input" accept="image/*" hidden>
            <div class="rj-photo-placeholder" id="rj-edit-photo-placeholder">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
              <span>Foto hinzufügen</span>
            </div>
            <img class="rj-photo-preview" id="rj-edit-photo-preview" hidden>
            <button class="rj-photo-remove" id="rj-edit-photo-remove" hidden aria-label="Foto entfernen">✕</button>
          </div>
          <form id="rj-edit-form">
            <input type="hidden" id="rj-edit-id">
            <div class="rj-field-title-wrap">
              <input type="text" class="rj-title-input" id="rj-edit-title" placeholder="Titel der Fahrt …" maxlength="50" required>
              <input type="date" class="rj-date-input" id="rj-edit-date" required>
            </div>
            <div class="rj-field-row">
              <label class="rj-field"><span>km</span><input type="number" class="rj-input" id="rj-edit-km" min="0" step="1" placeholder="120" required></label>
              <label class="rj-field"><span>Stunden</span><input type="number" class="rj-input" id="rj-edit-hours" min="0" step="0.5" placeholder="2.5"></label>
            </div>
            <div class="rj-mood-row">
              <span class="rj-mood-label">Wetter</span>
              ${RIDE_MOODS.map(m => `
                <label class="rj-mood-opt">
                  <input type="radio" name="rj-edit-mood" value="${m}">
                  <span>${m}</span>
                </label>
              `).join('')}
            </div>
            <textarea class="rj-notes-input" id="rj-edit-notes" rows="4" placeholder="Was war besonders? Strecke, Highlights, Gedanken …" maxlength="400"></textarea>
            <div class="rj-accent-row">
              <span class="rj-mood-label">Farbe</span>
              ${CARD_ACCENTS.map(c => `
                <label class="rj-accent-opt">
                  <input type="radio" name="rj-edit-accent" value="${c}">
                  <span style="background:${c}"></span>
                </label>
              `).join('')}
            </div>
            <div class="rj-edit-actions">
              <button type="button" class="rj-delete-btn" id="rj-edit-delete">Eintrag löschen</button>
              <button type="submit" class="rj-save-btn" style="flex:1">Speichern</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `
}

function wireJournal() {
  let pendingPhoto = null
  let photoGen = 0 // Generation-Zaehler gegen Race: spaete compressPhoto()-Antwort darf neueren Stand nicht ueberschreiben
  let pendingTrack = null   // Strecke der eben beendeten Aufzeichnung, wartet auf das Speichern
  let aufnahme = null       // Steuerung der laufenden Aufzeichnung

  // ── Fahrt aufzeichnen ──
  if (AUFZEICHNEN_AKTIV) wireAufzeichnung()

  function wireAufzeichnung() {
  /* Rest aus einem frueheren Aufbau des Reiters: vollbildAn() haengt die
     Ansicht an <body>, beim Neuzeichnen entstuende sonst ein zweites Element
     mit derselben id. */
  document.querySelectorAll('body > #rj-rec').forEach(el => el.remove())

  const recPanel  = document.getElementById('rj-rec')
  const recPath   = document.getElementById('rj-rec-path')
  const recLeer   = document.getElementById('rj-rec-empty')
  const recStatus = document.getElementById('rj-rec-state')
  const recDot    = document.getElementById('rj-rec-dot')
  const recPause  = document.getElementById('rj-rec-pause')

  const recGps = document.getElementById('rj-rec-gps')

  const zeigeStand = (stand) => {
    document.getElementById('rj-rec-km').textContent = stand.km.toFixed(2).replace('.', ',')
    document.getElementById('rj-rec-time').textContent = formatiereDauer(stand.fahrMs)
    document.getElementById('rj-rec-kmh').textContent = Math.round(stand.tempoKmh)
    document.getElementById('rj-rec-avg').textContent = Math.round(stand.schnittKmh)
    document.getElementById('rj-rec-hm').textContent = Math.round(stand.hoehenMeter)
    const d = spurPfad(stand.punkte, 320, 190, 14)
    if (d) { recPath.setAttribute('d', d); recLeer.hidden = true }

    /* Die automatische Pause muss man sehen. Sonst steht man an der Ampel,
       die Uhr bewegt sich nicht, und man haelt die Aufzeichnung fuer kaputt. */
    recStatus.textContent = stand.pausiert ? 'Pausiert'
      : stand.autoPause ? 'Pause — Stillstand erkannt'
      : 'Zeichnet auf'
    recGps.textContent = `${stand.punktZahl} ${stand.punktZahl === 1 ? 'Punkt' : 'Punkte'}`
    recDot.classList.toggle('is-paused', stand.ruht)
    recPanel.classList.toggle('is-paused', stand.ruht)
    recPause.textContent = stand.pausiert ? 'Weiter' : 'Pause'
  }

  /* .acc-panel traegt ein transform (Einblend-Animation). Ein Vorfahr mit
     transform wird zum Bezugsrahmen fuer position: fixed — die Ansicht fuellte
     dadurch nur das Konto-Feld statt des Bildschirms, am Telefon gemessen
     367x796 statt 375x812, und die Seite darunter blieb sichtbar. Waehrend der
     Aufzeichnung haengt sie deshalb direkt an <body> und kommt danach an ihren
     Platz zurueck. */
  const recHeimat = recPanel?.parentElement

  const vollbildAn = (an) => {
    if (!recPanel) return
    if (an) document.body.appendChild(recPanel)
    else recHeimat?.appendChild(recPanel)
    recPanel.hidden = !an
    document.body.classList.toggle('rj-rec-offen', an)
  }

  async function starte(fortsetzen = null) {
    if (aufnahme) return
    vollbildAn(true)
    recStatus.textContent = 'Warte auf Satellitenempfang …'
    try {
      aufnahme = await starteAufzeichnung({
        fortsetzen,
        beiAenderung: zeigeStand,
        beiFehler: (text) => { recStatus.textContent = text },
      })
      zeigeStand(aufnahme.stand())
    } catch (err) {
      vollbildAn(false)
      aufnahme = null
      showFlash(err.message)
    }
  }

  document.getElementById('rj-start-rec')?.addEventListener('click', () => starte())
  document.getElementById('rj-resume-go')?.addEventListener('click', () => {
    const offen = unterbrocheneAufzeichnung()
    document.getElementById('rj-resume')?.remove()
    starte(offen)
  })
  document.getElementById('rj-resume-drop')?.addEventListener('click', () => {
    verwerfeUnterbrochene()
    document.getElementById('rj-resume')?.remove()
  })

  recPause?.addEventListener('click', () => {
    if (!aufnahme) return
    aufnahme.stand().pausiert ? aufnahme.weiter() : aufnahme.pause()
  })

  document.getElementById('rj-rec-cancel')?.addEventListener('click', () => {
    if (!aufnahme) { vollbildAn(false); return }
    if (!confirm('Aufzeichnung verwerfen? Die gefahrene Strecke geht verloren.')) return
    aufnahme.abbrechen()
    aufnahme = null
    vollbildAn(false)
  })

  document.getElementById('rj-rec-stop')?.addEventListener('click', () => {
    if (!aufnahme) return
    const fahrt = aufnahme.beenden()
    aufnahme = null
    vollbildAn(false)
    if (!fahrt) {
      showFlash('Zu wenig Bewegung aufgezeichnet — es wurde nichts gespeichert.')
      return
    }
    /* Die Aufzeichnung speichert nicht selbst: Titel, Wetter und Notiz fehlen
       noch. Sie fuellt das Formular vor und ueberlaesst das Absenden dem
       Nutzer — so bleibt eine Probefahrt ums Haus auch loeschbar, ohne dass
       sie erst im Journal auftaucht. */
    pendingTrack = fahrt
    const sheet = document.getElementById('rj-sheet')
    sheet.hidden = false
    document.getElementById('rj-km').value = Math.round(fahrt.km)
    document.getElementById('rj-hours').value = (fahrt.fahrMs / 3600000).toFixed(1)
    document.getElementById('rj-date').value = new Date(fahrt.start).toISOString().slice(0, 10)
    const titel = document.getElementById('rj-title')
    titel.placeholder = 'Titel der Fahrt …'
    sheet.scrollIntoView({ behavior: 'smooth', block: 'start' })
    titel.focus()
    showFlash(`${fahrt.km.toFixed(1).replace('.', ',')} km aufgezeichnet — Titel eintragen und speichern.`)
  })

  } // Ende wireAufzeichnung

  // ── Fahrt teilen ──
  document.querySelectorAll('[data-share-ride]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()   // sonst oeffnet zusaetzlich die Bearbeiten-Ansicht
      const ride = getRides().find(r => r.id === btn.dataset.shareRide)
      if (!ride) return
      btn.disabled = true
      try {
        const wie = await teileFahrt(ride)
        if (wie === 'geladen') showFlash('Bild gespeichert — du kannst es jetzt versenden.')
        else if (wie === 'geteilt') showFlash('Geteilt \u2713')
      } catch {
        showFlash('Das Teilen hat nicht geklappt.')
      } finally {
        btn.disabled = false
      }
    })
  })

  // Open / close form sheet
  document.getElementById('rj-open-form')?.addEventListener('click', () => {
    const sheet = document.getElementById('rj-sheet')
    sheet.hidden = false
    sheet.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  document.getElementById('rj-close-form')?.addEventListener('click', () => {
    photoGen++
    document.getElementById('rj-sheet').hidden = true
  })

  // Photo upload
  const photoDrop = document.getElementById('rj-photo-drop')
  const photoInput = document.getElementById('rj-photo-input')
  const photoPreview = document.getElementById('rj-photo-preview')
  const photoPlaceholder = document.getElementById('rj-photo-placeholder')
  const photoRemove = document.getElementById('rj-photo-remove')

  photoDrop?.addEventListener('click', e => {
    if (e.target === photoRemove || photoRemove?.contains(e.target)) return
    photoInput?.click()
  })
  photoInput?.addEventListener('change', async () => {
    const file = photoInput.files?.[0]
    if (!file) return
    const gen = ++photoGen
    const compressed = await compressPhoto(file)
    if (gen !== photoGen) return // in der Zwischenzeit entfernt oder durch anderes Foto ersetzt
    pendingPhoto = compressed
    photoPreview.src = pendingPhoto
    photoPreview.hidden = false
    photoPlaceholder.hidden = true
    photoRemove.hidden = false
  })
  photoRemove?.addEventListener('click', e => {
    e.stopPropagation()
    photoGen++
    pendingPhoto = null
    photoPreview.hidden = true
    photoPlaceholder.hidden = false
    photoRemove.hidden = true
    photoInput.value = ''
  })

  // Save form
  document.getElementById('rj-form')?.addEventListener('submit', e => {
    e.preventDefault()
    const mood = document.querySelector('input[name="rj-mood"]:checked')?.value || ''
    const accent = document.querySelector('input[name="rj-accent"]:checked')?.value || CARD_ACCENTS[0]
    const ride = {
      id: Date.now().toString(36),
      date: new Date(document.getElementById('rj-date').value).getTime(),
      km: parseInt(document.getElementById('rj-km').value) || 0,
      hours: parseFloat(document.getElementById('rj-hours').value) || 0,
      title: document.getElementById('rj-title').value.trim(),
      notes: document.getElementById('rj-notes').value.trim(),
      mood,
      accent,
      photo: pendingPhoto || null,
      track: pendingTrack || null,
    }
    if (!ride.title || !Number.isFinite(ride.km) || ride.km < 0) {
      showFlash('Bitte einen gültigen Kilometerstand angeben (0 oder mehr).')
      return
    }
    const rides = getRides()
    rides.push(ride)
    saveRides(rides)
    pendingPhoto = null
    pendingTrack = null
    photoGen++
    showFlash('Eintrag gespeichert ✓')
    renderTabContent('journal')
  })

  // ── Edit overlay ──
  let editPhoto = null // photo state for edit modal
  let editPhotoGen = 0 // wie photoGen oben — schuetzt vor veralteter compressPhoto()-Antwort

  function openEditOverlay(ride) {
    const overlay = document.getElementById('rj-edit-overlay')
    if (!overlay) return
    editPhotoGen++
    editPhoto = ride.photo || null

    // Pre-fill fields
    document.getElementById('rj-edit-id').value = ride.id
    document.getElementById('rj-edit-title').value = ride.title
    document.getElementById('rj-edit-date').value = new Date(ride.date).toISOString().slice(0,10)
    document.getElementById('rj-edit-km').value = ride.km
    document.getElementById('rj-edit-hours').value = ride.hours || ''
    document.getElementById('rj-edit-notes').value = ride.notes || ''

    // Mood
    const moodRadio = document.querySelector(`input[name="rj-edit-mood"][value="${ride.mood || RIDE_MOODS[0]}"]`)
    if (moodRadio) moodRadio.checked = true

    // Accent
    const accentVal = ride.accent || CARD_ACCENTS[0]
    const accentRadio = document.querySelector(`input[name="rj-edit-accent"][value="${accentVal}"]`)
    if (accentRadio) accentRadio.checked = true

    // Photo
    const prev = document.getElementById('rj-edit-photo-preview')
    const placeholder = document.getElementById('rj-edit-photo-placeholder')
    const removeBtn = document.getElementById('rj-edit-photo-remove')
    if (ride.photo) {
      prev.src = ride.photo; prev.hidden = false
      placeholder.hidden = true; removeBtn.hidden = false
    } else {
      prev.hidden = true; placeholder.hidden = false; removeBtn.hidden = true
    }

    overlay.hidden = false
    overlay.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  /* Aufgezeichnete Fahrten oeffnen die Detailansicht, von Hand eingetragene
     gehen direkt ins Bearbeiten — dort gaebe es sonst nichts zu sehen ausser
     denselben drei Zahlen, die schon auf der Karte stehen. */
  const detail = document.getElementById('rj-detail')
  const board  = document.getElementById('rj-board')

  function zeigeDetail(ride) {
    detail.innerHTML = renderFahrtDetail(ride)
    detail.hidden = false
    document.querySelector('.rj-header')?.setAttribute('hidden', '')
    document.querySelector('.rj-bests')?.setAttribute('hidden', '')
    if (board) board.hidden = true
    detail.scrollIntoView({ block: 'start' })
    detail.querySelector('#rj-detail-zurueck')?.addEventListener('click', schliesseDetail)
    detail.querySelector('[data-edit-ride]')?.addEventListener('click', (e) => {
      const r = getRides().find(x => x.id === e.currentTarget.dataset.editRide)
      if (r) openEditOverlay(r)
    })
    detail.querySelector('[data-share-ride]')?.addEventListener('click', async (e) => {
      const r = getRides().find(x => x.id === e.currentTarget.dataset.shareRide)
      if (!r) return
      const wie = await teileFahrt(r)
      if (wie === 'geladen') showFlash('Bild gespeichert — du kannst es jetzt versenden.')
      else if (wie === 'geteilt') showFlash('Geteilt \u2713')
    })
  }

  function schliesseDetail() {
    detail.hidden = true
    detail.innerHTML = ''
    document.querySelector('.rj-header')?.removeAttribute('hidden')
    document.querySelector('.rj-bests')?.removeAttribute('hidden')
    if (board) board.hidden = false
  }

  // Open on card click (oder Enter/Leertaste, da role="button" tabindex="0")
  document.querySelectorAll('[data-open-ride]').forEach(card => {
    const open = () => {
      const ride = getRides().find(r => r.id === card.dataset.openRide)
      if (!ride) return
      if (ride.track?.punkte?.length >= 2) zeigeDetail(ride)
      else openEditOverlay(ride)
    }
    card.addEventListener('click', open)
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        open()
      }
    })
  })

  // Close overlay
  document.getElementById('rj-edit-close')?.addEventListener('click', () => {
    editPhotoGen++
    document.getElementById('rj-edit-overlay').hidden = true
  })

  // Edit photo upload
  const editDrop = document.getElementById('rj-edit-photo-drop')
  const editInput = document.getElementById('rj-edit-photo-input')
  const editPrev = document.getElementById('rj-edit-photo-preview')
  const editPh = document.getElementById('rj-edit-photo-placeholder')
  const editRm = document.getElementById('rj-edit-photo-remove')
  editDrop?.addEventListener('click', e => {
    if (e.target === editRm || editRm?.contains(e.target)) return
    editInput?.click()
  })
  editInput?.addEventListener('change', async () => {
    const file = editInput.files?.[0]
    if (!file) return
    const gen = ++editPhotoGen
    const compressed = await compressPhoto(file)
    if (gen !== editPhotoGen) return // in der Zwischenzeit entfernt oder durch anderes Foto ersetzt
    editPhoto = compressed
    editPrev.src = editPhoto; editPrev.hidden = false
    editPh.hidden = true; editRm.hidden = false
  })
  editRm?.addEventListener('click', e => {
    e.stopPropagation()
    editPhotoGen++
    editPhoto = null
    editPrev.hidden = true; editPh.hidden = false; editRm.hidden = true
    editInput.value = ''
  })

  // Save edit
  document.getElementById('rj-edit-form')?.addEventListener('submit', e => {
    e.preventDefault()
    const id = document.getElementById('rj-edit-id').value
    const mood = document.querySelector('input[name="rj-edit-mood"]:checked')?.value || ''
    const accent = document.querySelector('input[name="rj-edit-accent"]:checked')?.value || CARD_ACCENTS[0]
    /* Das Formular baut den Eintrag neu auf. Die aufgezeichnete Strecke steht
       in keinem Feld — ohne diese Zeile waere sie nach dem ersten Bearbeiten
       eines Eintrags weg. */
    const bisher = getRides().find(r => r.id === id)
    const updated = {
      id,
      date: new Date(document.getElementById('rj-edit-date').value).getTime(),
      km: parseInt(document.getElementById('rj-edit-km').value) || 0,
      hours: parseFloat(document.getElementById('rj-edit-hours').value) || 0,
      title: document.getElementById('rj-edit-title').value.trim(),
      notes: document.getElementById('rj-edit-notes').value.trim(),
      mood, accent,
      photo: editPhoto || null,
      track: bisher?.track || null,
    }
    if (!updated.title || !Number.isFinite(updated.km) || updated.km < 0) {
      showFlash('Bitte einen gültigen Kilometerstand angeben (0 oder mehr).')
      return
    }
    saveRides(getRides().map(r => r.id === id ? updated : r))
    showFlash('Eintrag aktualisiert ✓')
    renderTabContent('journal')
  })

  // Delete from edit overlay
  document.getElementById('rj-edit-delete')?.addEventListener('click', () => {
    const id = document.getElementById('rj-edit-id').value
    if (!id) return
    saveRides(getRides().filter(r => r.id !== id))
    showFlash('Eintrag gelöscht')
    renderTabContent('journal')
  })
}

/* ─── Favoriten: Bikes, Ausruestung und Orte unter einem Dach ───
   Der aktive Filter ueberlebt das Neuzeichnen (Eintrag entfernen, Karte
   laden), steht aber bewusst nicht in localStorage: beim naechsten Oeffnen
   des Kontos soll wieder alles zu sehen sein. */
let favFilter = 'alle'

const FAV_FILTER = [
  ['alle',   'Alle'],
  ['bikes',  'Bikes'],
  ['gear',   'Ausrüstung'],
  ['places', 'Orte'],
]

export function setFavFilter(f) {
  favFilter = FAV_FILTER.some(([k]) => k === f) ? f : 'alle'
}

function renderFavoriten() {
  const zahlen = {
    bikes:  getOwnedBikes().length,
    gear:   collectGearFavs().length,
    places: collectMapFavs().length,
  }
  zahlen.alle = zahlen.bikes + zahlen.gear + zahlen.places

  const zeige = (k) => favFilter === 'alle' || favFilter === k

  return `
    <!-- Bewusst ohne die tb-bar/tb-btn der Seite: die sind fuer helle Bereiche
         gebaut (.tb-bar hat weissen Grund) und liessen die drei inaktiven
         Knoepfe hier weiss auf weiss verschwinden. -->
    <div class="fav-bar" role="tablist">
      ${FAV_FILTER.map(([k, label]) => `
        <button class="fav-btn${favFilter === k ? ' fav-btn--active' : ''}"
                data-fav-filter="${k}" role="tab" aria-selected="${favFilter === k}">
          ${label}<span class="fav-btn-count">${zahlen[k]}</span>
        </button>
      `).join('')}
    </div>

    ${zahlen.alle === 0 ? `
      <div class="acc-empty">
        <p>Noch nichts gemerkt.</p>
        <p class="acc-empty-sub">Bikes, Ausrüstung und Orte, die du dir merkst, sammeln sich hier.</p>
      </div>
    ` : `
      ${zeige('bikes')  ? `<div class="fav-sektion" data-fav-sektion="bikes">${renderBikes()}</div>` : ''}
      ${zeige('gear')   ? `<div class="fav-sektion" data-fav-sektion="gear">${renderGear()}</div>` : ''}
      ${zeige('places') ? `<div class="fav-sektion" data-fav-sektion="places">${renderPlaces()}</div>` : ''}
    `}
  `
}

function wireFavoriten() {
  document.querySelectorAll('[data-fav-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      setFavFilter(btn.dataset.favFilter)
      renderTabContent('favoriten')
    })
  })
  if (favFilter === 'alle' || favFilter === 'bikes') wireBikeSearch()
}

/* Die erklaerende Zeile unter der Ueberschrift ist weg — sie stand in jedem
   Aufruf da, egal wie oft man den Bereich schon gesehen hatte. Was sie sagte,
   sagt jetzt der Platzhalter im Suchfeld. */
function renderBikes() {
  const owned = getOwnedBikes()
  const recents = collectRecentBikes().filter(b => !owned.some(o => o.name === b.name))

  const zeile = (name, meta, extra = '') => `
    <div class="fav-zeile acc-bike-card" data-open-bike="${esc(name)}">
      ${bikeKachel(name, 'fav-zeile-bild')}
      <div class="fav-zeile-text">
        <div class="fav-zeile-name">${esc(name)}</div>
        <div class="fav-zeile-meta">${esc(meta)}</div>
      </div>
      ${extra}
    </div>`

  return `
    <div class="acc-section">
      <h3 class="fav-h">Meine Bikes</h3>
      <input type="text" class="acc-input fav-suche" id="acc-bike-search-input"
             placeholder="Eigenes Bike eintragen — Modell suchen …" autocomplete="off">
      <div class="acc-bike-search-results" id="acc-bike-search-results" hidden></div>

      ${owned.length === 0 ? `
        <p class="acc-leer-sub fav-hinweis">Noch kein eigenes Bike eingetragen.</p>
      ` : `
        <div class="fav-liste">
          ${owned.map(b => zeile(b.name, `${b.style} · seit ${fmtDate(b.addedAt)}`, `
            <button class="acc-remove-btn" data-remove-owned-bike="${esc(b.name)}" aria-label="Entfernen">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>`)).join('')}
        </div>
      `}

      ${recents.length ? `
        <h3 class="fav-h fav-h--zweit">Zuletzt angesehen</h3>
        <div class="fav-liste">
          ${recents.slice(0, 6).map(b => zeile(b.name, `${b.style} · ${fmtDate(b.ts)}`, `
            <svg class="fav-zeile-pfeil" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>`)).join('')}
        </div>
      ` : ''}
    </div>
  `
}

function wireBikeSearch() {
  const input = document.getElementById('acc-bike-search-input')
  const results = document.getElementById('acc-bike-search-results')
  if (!input || !results) return

  const renderResults = (query) => {
    const q = query.trim().toLowerCase()
    if (!q) { results.hidden = true; results.innerHTML = ''; return }
    const owned = getOwnedBikes()
    const matches = getCatalog()
      .filter(b => !owned.some(o => o.name === b.name))
      .filter(b => b.name.toLowerCase().includes(q) || b.brand?.toLowerCase().includes(q))
      .slice(0, 6)
    if (!matches.length) {
      results.innerHTML = `<div class="acc-bike-search-empty">Kein Bike gefunden.</div>`
      results.hidden = false
      return
    }
    results.innerHTML = matches.map(b => `
      <button type="button" class="acc-bike-search-item" data-add-owned-bike="${b.name}" data-add-owned-style="${b.style || ''}">
        <span class="acc-bike-search-item-name">${b.brand ? b.brand + ' ' : ''}${b.name}</span>
        <span class="acc-bike-search-item-style">${b.style || ''}</span>
      </button>
    `).join('')
    results.hidden = false
  }

  input.addEventListener('input', () => renderResults(input.value))
  input.addEventListener('focus', () => { if (input.value.trim()) renderResults(input.value) })
  // Kleine Verzögerung, damit ein Klick auf ein Suchergebnis vor dem Schließen ausgelöst wird
  input.addEventListener('blur', () => setTimeout(() => { results.hidden = true }, 150))

  results.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-add-owned-bike]')
    if (!btn) return
    toggleOwnedBike(btn.dataset.addOwnedBike, btn.dataset.addOwnedStyle)
    input.value = ''
    results.hidden = true
    results.innerHTML = ''
    renderTabContent('bikes')
  })
}

/* Frueher standen hier: eine Budget-Summe, ein gelber Warnkasten mit fehlenden
   Kategorien, Gruppenkoepfe je Kategorie mit Emoji und Zaehler, und fuenf
   Punkte fuer eine aus dem Produktnamen geratene "Schutzstufe". Das war viel
   Deutung fuer eine Merkliste. Geblieben ist die Liste selbst. */
function renderGear() {
  const gear = collectGearFavs()
  if (!gear.length) return `<div class="acc-leer">
    <p>Keine Ausrüstung gemerkt.</p>
    <p class="acc-leer-sub">Tippe auf das Herz an einer Karte im Bereich Ausrüstung.</p>
  </div>`

  return `
    <div class="acc-section">
      <h3 class="fav-h">Ausrüstung</h3>
      <div class="fav-liste">
        ${gear.map(g => `
          <div class="fav-zeile">
            <div class="fav-zeile-text">
              <div class="fav-zeile-name">${esc(g.brand)} ${esc(g.name)}</div>
              <div class="fav-zeile-meta">${esc(g.type || '')}</div>
            </div>
            <span class="fav-zeile-wert">${esc(g.price || '')}</span>
            <button class="acc-remove-btn" data-remove-gear-fav="${g.id}" aria-label="Entfernen">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

function renderCommunity() {
  const com = collectCommunityActivity()
  return `
    <div class="acc-section">
      <h3 class="acc-section-title">Meine Beiträge <span class="acc-count">${com.posts.length}</span></h3>
      ${com.posts.length === 0 ? `<div class="acc-empty-inline">Du hast noch keine Beiträge veröffentlicht.</div>` : `
        <div class="acc-posts-list">
          ${com.posts.map(p => `
            <div class="acc-post-card">
              <div class="acc-post-cat">${esc(p.category)}</div>
              <div class="acc-post-body">
                <div class="acc-post-title">${esc(p.title)}</div>
                <div class="acc-post-desc">${esc(p.desc)}</div>
                <div class="acc-post-meta">${fmtDate(p.createdAt)} · ${esc(p.meta)} · ${esc(p.extra)}</div>
              </div>
              <button class="acc-remove-btn" data-delete-post="${p.id}" aria-label="Löschen">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg>
              </button>
            </div>
          `).join('')}
        </div>
      `}
    </div>

    <div class="acc-section">
      <h3 class="acc-section-title">Aktivität</h3>
      <div class="acc-mini-stats">
        <div class="acc-mini-stat">
          <div class="acc-mini-stat-num">${com.liked.length}</div>
          <div class="acc-mini-stat-label">Likes</div>
        </div>
        <div class="acc-mini-stat">
          <div class="acc-mini-stat-num">${com.subscribed.length}</div>
          <div class="acc-mini-stat-label">Abos</div>
        </div>
        <div class="acc-mini-stat">
          <div class="acc-mini-stat-num">${com.commentCount}</div>
          <div class="acc-mini-stat-label">Kommentare</div>
        </div>
      </div>
    </div>
  `
}

function renderPlaces() {
  const favs = collectMapFavs()
  if (!favs.length) return `<div class="acc-leer">
    <p>Keine Orte gemerkt.</p>
    <p class="acc-leer-sub">Tippe auf „Merken" in der Karten-Ansicht.</p>
  </div>`
  /* Hier lag bis 2026-09-29 eine Kartenvorschau aus Kacheln von CARTO. Sie
     ging aus drei Gruenden: der Dienst verlangt inzwischen einen Schluessel
     und zeigte quer ueber den Kacheln "API KEY REQUIRED", jede Kachel schickte
     die IP-Adresse des Nutzers und den betrachteten Ausschnitt an CARTO, und
     der noetige Zustimmungs-Dialog davor machte die Liste unruhig. Zu jedem
     Ort fuehrt weiterhin ein Knopf in die Karten-Ansicht der Seite. */
  return `
    <div class="acc-section">
      <h3 class="fav-h">Orte</h3>
      <div class="fav-liste">
        ${favs.map(f => `
          <div class="acc-place-card fav-zeile" data-place-id="${f.id}" data-lat="${f.lat || ''}" data-lng="${f.lng || ''}">
            <div class="fav-zeile-text">
              <div class="fav-zeile-name">${esc(f.name)}</div>
              <div class="fav-zeile-meta">${esc([f.address, f.rating ? `★ ${f.rating.toFixed(1)}` : ''].filter(Boolean).join(' · '))}</div>
            </div>
            ${f.lat && f.lng ? `
              <button class="fav-zeile-aktion" data-open-place-map="${f.id}" data-lat="${f.lat}" data-lng="${f.lng}" aria-label="In Karte öffnen" title="In Karte öffnen">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z M8 2v16 M16 6v16"/></svg>
              </button>` : ''}
            <button class="acc-remove-btn" data-remove-place-fav="${f.id}" aria-label="Entfernen">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

const SETTINGS_CATS = [
  ['profil', 'Profil', 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  ['konto', 'Konto', 'M4 4h16v16H4z M4 9h16 M9 21V9'],
  ['benachrichtigungen', 'Benachrichtigungen', 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0'],
  ['verbindungen', 'Verbindungen', 'M18.36 5.64a9 9 0 1 1-12.73 0 M12 2v10'],
  ['daten', 'Daten', 'M21 8V16.2c0 1.68 0 2.52-.327 3.162a3 3 0 0 1-1.311 1.311C18.72 21 17.88 21 16.2 21H7.8c-1.68 0-2.52 0-3.162-.327a3 3 0 0 1-1.311-1.311C3 18.72 3 17.88 3 16.2V7.8c0-1.68 0-2.52.327-3.162a3 3 0 0 1 1.311-1.311C5.28 3 6.12 3 7.8 3H16 M17 21v-8H7v8 M7 3v5h8'],
]
function renderSettings() {
  const acc = getAccount()
  const u = auth.currentUser()
  const realUser = u && !u.guest
  const initials = getInitials(acc.name)
  const color = stringColor(acc.name)
  const licenseOptions = [
    ['', 'Keine Angabe'], ['A1', 'A1 — max. 125cc'], ['A2', 'A2 — max. 35kW'],
    ['A', 'A — Unbegrenzt'], ['B196', 'B196 — 125cc ab 25'],
  ]
  const provider = u?.provider // 'google' | undefined

  return `
    <div class="acc-set-layout">
      <nav class="acc-set-nav">
        ${SETTINGS_CATS.map(([id, label, d], i) => `
          <button class="acc-set-navitem ${i === 0 ? 'acc-set-navitem--active' : ''}" data-set-tab="${id}">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d.split(' M').map((p,i)=>`<path d="${i===0?p:'M'+p}"/>`).join('')}</svg>
            <span>${label}</span>
          </button>`).join('')}
      </nav>

      <div class="acc-set-content">
        <div class="acc-set-panel acc-set-panel--active" data-set-panel="profil">
          <div class="acc-section">
            <h3 class="acc-section-title">Profilbild</h3>
            <div class="acc-avatar-edit">
              <div class="acc-avatar acc-avatar--lg" style="background:${color}" id="acc-avatar-preview">${acc.avatar ? `<img src="${esc(acc.avatar)}" alt="">` : initials}</div>
              <div class="acc-avatar-edit-actions">
                <label class="acc-data-btn" for="acc-avatar-file">Bild hochladen</label>
                <input type="file" id="acc-avatar-file" accept="image/*" style="display:none">
                ${acc.avatar ? '<button type="button" class="acc-btn-ghost-sm" id="acc-avatar-remove">Entfernen</button>' : ''}
              </div>
            </div>
          </div>
          <div class="acc-section">
            <h3 class="acc-section-title">Über dich</h3>
            <form class="acc-form" id="acc-settings-form">
              <label class="acc-field">
                <span class="acc-field-label">Name</span>
                <input class="acc-input" id="acc-set-name" type="text" value="${esc(acc.name)}" maxlength="32">
              </label>
              <label class="acc-field">
                <span class="acc-field-label">Bio</span>
                <textarea class="acc-input" id="acc-set-bio" rows="3" maxlength="160">${esc(acc.bio)}</textarea>
              </label>
              <button type="submit" class="acc-save-btn">Speichern</button>
            </form>
          </div>
        </div>

        <div class="acc-set-panel" data-set-panel="konto">
          <div class="acc-section">
            <h3 class="acc-section-title">Konto</h3>
            ${!realUser ? `<p class="acc-section-sub">Als Gast angemeldet — <button type="button" class="acc-btn-ghost-sm" id="acc-set-login-link">jetzt anmelden</button>, um Benutzername, E-Mail und Passwort zu verwalten.</p>` : ''}

            ${realUser ? `
            <div class="acc-fieldbox" data-fieldbox="username">
              <div class="acc-fieldbox-label">Benutzername</div>
              <div class="acc-fieldbox-row">
                <div class="acc-fieldbox-value" data-fb-value>${esc(u.username)}</div>
                <input class="acc-input acc-fieldbox-input" data-fb-input type="text" value="${esc(u.username)}" maxlength="24" hidden>
                <button type="button" class="acc-fieldbox-btn" data-fb-edit>Bearbeiten</button>
              </div>
              <div class="acc-inline-error" data-fb-error hidden></div>
            </div>` : ''}

            <div class="acc-fieldbox" data-fieldbox="email">
              <div class="acc-fieldbox-label">E-Mail</div>
              <div class="acc-fieldbox-row">
                <div class="acc-fieldbox-value" data-fb-value>${esc(acc.email || '—')}</div>
                <input class="acc-input acc-fieldbox-input" data-fb-input type="email" value="${esc(acc.email)}" hidden>
                <button type="button" class="acc-fieldbox-btn" data-fb-edit>Bearbeiten</button>
              </div>
              <div class="acc-inline-error" data-fb-error hidden></div>
            </div>

            ${realUser && !u.provider ? `
            <div class="acc-fieldbox" data-fieldbox="password">
              <div class="acc-fieldbox-label">Passwort</div>
              <div class="acc-fieldbox-row">
                <div class="acc-fieldbox-value" data-fb-value>••••••••</div>
                <button type="button" class="acc-fieldbox-btn" data-fb-edit>Bearbeiten</button>
              </div>
              <div class="acc-fieldbox-pwform" data-fb-pwform hidden>
                <input class="acc-input" data-fb-curpass type="password" placeholder="Aktuelles Passwort">
                <input class="acc-input" data-fb-newpass type="password" minlength="${auth.MIN_PASSWORD_LENGTH}" placeholder="Neues Passwort">
              </div>
              <div class="acc-inline-error" data-fb-error hidden></div>
            </div>` : ''}

            <div class="acc-fieldbox" data-fieldbox="age">
              <div class="acc-fieldbox-label">Alter</div>
              <div class="acc-fieldbox-row">
                <div class="acc-fieldbox-value" data-fb-value>${acc.age ?? '—'}</div>
                <input class="acc-input acc-fieldbox-input" data-fb-input type="number" min="14" max="99" value="${acc.age ?? ''}" placeholder="z. B. 28" hidden>
                <button type="button" class="acc-fieldbox-btn" data-fb-edit>Bearbeiten</button>
              </div>
            </div>

            <div class="acc-fieldbox" data-fieldbox="license">
              <div class="acc-fieldbox-label">Führerschein</div>
              <div class="acc-fieldbox-row">
                <div class="acc-fieldbox-value" data-fb-value>${licenseOptions.find(([v]) => v === acc.license)?.[1] || 'Keine Angabe'}</div>
                <select class="acc-input acc-fieldbox-input" data-fb-input hidden>
                  ${licenseOptions.map(([v, l]) => `<option value="${v}" ${acc.license === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
                <button type="button" class="acc-fieldbox-btn" data-fb-edit>Bearbeiten</button>
              </div>
            </div>
          </div>
        </div>

        <div class="acc-set-panel" data-set-panel="benachrichtigungen">
          <div class="acc-section">
            <h3 class="acc-section-title">Benachrichtigungen</h3>
            <label class="acc-toggle-row">
              <span>Events &amp; Stammtische</span>
              <input type="checkbox" id="acc-notif-events" ${acc.notif?.events ? 'checked' : ''}>
              <span class="acc-switch"></span>
            </label>
            <label class="acc-toggle-row">
              <span>Community-Aktivität</span>
              <input type="checkbox" id="acc-notif-community" ${acc.notif?.community ? 'checked' : ''}>
              <span class="acc-switch"></span>
            </label>
            <label class="acc-toggle-row">
              <span>Neue Ausrüstung</span>
              <input type="checkbox" id="acc-notif-gear" ${acc.notif?.gear ? 'checked' : ''}>
              <span class="acc-switch"></span>
            </label>
          </div>
        </div>

        <div class="acc-set-panel" data-set-panel="verbindungen">
          <div class="acc-section">
            <h3 class="acc-section-title">Verknüpfte Konten</h3>
            <div class="acc-connection-row">
              <div class="acc-connection-info">
                <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                <div>
                  <div class="acc-connection-name">Google</div>
                  <div class="acc-connection-status">${provider === 'google' ? 'Verknüpft' : 'Nicht verknüpft'}</div>
                </div>
              </div>
              ${provider === 'google'
                ? '<span class="acc-connection-badge">Aktiv</span>'
                : '<button type="button" class="acc-btn-ghost-sm" id="acc-connect-google">Verknüpfen</button>'}
            </div>
          </div>
        </div>

        <div class="acc-set-panel" data-set-panel="daten">
          <div class="acc-section">
            <h3 class="acc-section-title">Daten exportieren &amp; importieren</h3>
            <p class="acc-section-sub">Sichere alle deine Daten (Favoriten, Posts, Fahrten, Wartung, …) als JSON-Datei oder spiele ein Backup ein.</p>
            <div class="acc-data-actions">
              <button class="acc-data-btn" id="acc-export-data">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                Daten exportieren
              </button>
              <label class="acc-data-btn" for="acc-import-file">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                Daten importieren
              </label>
              <input type="file" id="acc-import-file" accept="application/json" style="display:none">
            </div>
          </div>

          <div class="acc-section acc-section--danger">
            <h3 class="acc-section-title">Gefahrenzone</h3>
            <button class="acc-danger-btn" id="acc-clear-data">Alle lokalen Daten löschen</button>
            <p class="acc-danger-note">Löscht Favoriten, Kommentare, Posts und Einstellungen.</p>
            ${realUser ? `
            <button class="acc-danger-btn" id="acc-delete-account" style="margin-top:10px">Konto endgültig löschen</button>
            <p class="acc-danger-note">Löscht unwiderruflich: Konto und Anmeldedaten, Profil, alle deine Nachrichten in Gruppen und DMs, deine Gruppenmitgliedschaften und Freundschaften, alle von dir hochgeladenen Anhänge sowie Gruppen, die du selbst erstellt hast. Nicht rückgängig zu machen.</p>` : ''}
          </div>
        </div>
      </div>
    </div>
  `
}

function wireSettings() {

  // Kategorien-Sidebar umschalten
  document.querySelectorAll('.acc-set-navitem').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.setTab
      document.querySelectorAll('.acc-set-navitem').forEach(b => b.classList.toggle('acc-set-navitem--active', b === btn))
      document.querySelectorAll('.acc-set-panel').forEach(p => p.classList.toggle('acc-set-panel--active', p.dataset.setPanel === target))
    })
  })
  document.getElementById('acc-set-login-link')?.addEventListener('click', () => {
    auth.openAuthModal(() => reopenAccount())
  })
  document.getElementById('acc-connect-google')?.addEventListener('click', () => {
    showFlash('Google-Verknüpfung für bestehende Konten kommt bald')
  })

  // Profilbild hochladen (als Data-URL in profiles.avatar)
  document.getElementById('acc-avatar-file')?.addEventListener('change', async e => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { showFlash('Bild ist zu groß (max. 2 MB)'); return }
    // Frueher ging hier die rohe FileReader-Data-URL raus — eine 2-MB-Datei
    // landete als ~2,7 MB base64 in der Zeile. compressPhoto() steht in dieser
    // Datei und wird an zwei anderen Stellen laengst benutzt (600 px, JPEG
    // 0.72, typisch unter 150 KB); nur dieser Pfad hat es nicht getan. Das ist
    // zugleich die Voraussetzung fuer das Constraint profiles_avatar_len.
    const dataUrl = await compressPhoto(file)
    if (!dataUrl) { showFlash('Bild konnte nicht gelesen werden'); return }
    saveAccount({ avatar: dataUrl })
    renderTabContent('settings')
    refreshAccountHeader()
    showFlash('Profilbild aktualisiert ✓')
  })
  document.getElementById('acc-avatar-remove')?.addEventListener('click', () => {
    saveAccount({ avatar: null })
    renderTabContent('settings')
    refreshAccountHeader()
  })

  document.getElementById('acc-settings-form')?.addEventListener('submit', e => {
    e.preventDefault()
    const name = document.getElementById('acc-set-name')?.value.trim() || 'Du'
    const bio = document.getElementById('acc-set-bio')?.value.trim() || ''
    saveAccount({ name, bio })
    refreshAccountHeader()
    showFlash('Profil gespeichert ✓')
  })

  // Konto-Felder — jedes Feld einzeln per "Bearbeiten" umschaltbar (Komoot-Stil)
  document.querySelectorAll('.acc-fieldbox').forEach(box => {
    const field = box.dataset.fieldbox
    const editBtn = box.querySelector('[data-fb-edit]')
    const valueEl = box.querySelector('[data-fb-value]')
    const inputEl = box.querySelector('[data-fb-input]')
    const errEl = box.querySelector('[data-fb-error]')
    const pwForm = box.querySelector('[data-fb-pwform]')

    const setEditing = (on) => {
      editBtn.textContent = on ? 'Speichern' : 'Bearbeiten'
      if (valueEl) valueEl.hidden = on
      if (inputEl) inputEl.hidden = !on
      if (pwForm) pwForm.hidden = !on
      if (on) (inputEl || pwForm?.querySelector('input'))?.focus()
    }

    editBtn?.addEventListener('click', async () => {
      const editing = editBtn.textContent === 'Speichern'
      if (!editing) { setEditing(true); return }

      if (errEl) errEl.hidden = true

      if (field === 'username') {
        editBtn.disabled = true
        const res = await auth.changeUsername(inputEl.value.trim())
        editBtn.disabled = false
        if (!res.ok) { errEl.textContent = res.error; errEl.hidden = false; return }
        valueEl.textContent = auth.currentUser().username
      } else if (field === 'password') {
        const [curInput, newInput] = pwForm.querySelectorAll('input')
        editBtn.disabled = true
        const res = await auth.changePassword(curInput.value, newInput.value)
        editBtn.disabled = false
        if (!res.ok) { errEl.textContent = res.error; errEl.hidden = false; return }
        curInput.value = ''; newInput.value = ''
        showFlash('Passwort geändert ✓')
      } else if (field === 'email') {
        const email = inputEl.value.trim()
        // gleiche Regel wie auth.js register() — nur Format, kein Duplikat-Check (kein Backend-Aufruf hier)
        if (email && !/^\S+@\S+\.\S+$/.test(email)) {
          if (errEl) { errEl.textContent = 'Bitte eine gültige E-Mail-Adresse angeben.'; errEl.hidden = false }
          return
        }
        saveAccount({ email })
        valueEl.textContent = email || '—'
      } else if (field === 'age') {
        let v = inputEl.value ? parseInt(inputEl.value) : null
        if (v != null && !Number.isNaN(v)) v = Math.min(99, Math.max(14, v))
        else v = null
        inputEl.value = v ?? ''
        saveAccount({ age: v })
        valueEl.textContent = v ?? '—'
      } else if (field === 'license') {
        saveAccount({ license: inputEl.value })
        valueEl.textContent = inputEl.selectedOptions[0]?.textContent || 'Keine Angabe'
      }
      setEditing(false)
    })
  })

  /* Die destruktivste Aktion der App — und seit sie tatsaechlich loescht
     (api/delete-account.js) auch wirklich endgueltig. Deshalb zwei Stufen:
     erst der vollstaendige Umfang zum Lesen, dann der eigene Benutzername zum
     Abtippen. Ein einzelnes confirm() klickt man versehentlich weg, den
     eigenen Namen tippt man nicht aus Versehen.
     Der Umfang stammt aus den ON-DELETE-CASCADE-Ketten in schema.sql — inkl.
     groups.created_by: selbst erstellte Gruppen verschwinden mit. */
  document.getElementById('acc-delete-account')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget
    const username = auth.currentUser()?.username || ''

    const scope = [
      'Konto endgültig löschen?',
      '',
      'Unwiderruflich gelöscht werden:',
      '· dein Konto und deine Anmeldedaten',
      '· dein Profil (Name, Bio, Profilbild)',
      '· alle deine Nachrichten in Gruppen und Direktnachrichten',
      '· deine Gruppenmitgliedschaften, Zusagen und Freundschaften',
      '· alle Dateien, die du in Chats hochgeladen hast',
      '· Gruppen, die du selbst erstellt hast — mit allen Kanälen und Nachrichten darin',
      '',
      'Das lässt sich nicht rückgängig machen. Es gibt keine Wiederherstellung.',
      'Wenn du deine Daten vorher sichern willst: Abbrechen und zuerst "Daten exportieren".',
    ].join('\n')
    if (!confirm(scope)) return

    const typed = prompt(`Letzter Schritt: Tippe zur Bestätigung deinen Benutzernamen ein.\n\n${username}`)
    if (typed === null) return
    if (typed.trim() !== username) {
      showFlash('Benutzername stimmt nicht — Konto wurde NICHT gelöscht.')
      return
    }

    btn.disabled = true
    btn.textContent = 'Wird gelöscht …'
    /* Wirft deleteAccount() unerwartet (Supabase-Client nicht erreichbar),
       bliebe der Knopf sonst dauerhaft auf "Wird gelöscht …" stehen — ohne
       Meldung und ohne Moeglichkeit, es erneut zu versuchen. */
    let res
    try {
      res = await auth.deleteAccount()
    } catch (err) {
      res = { ok: false, error: 'Konto konnte nicht gelöscht werden: ' + (err?.message || 'unbekannter Fehler') }
    }
    if (!res.ok) {
      /* Kein reload mehr im Fehlerfall: die Session besteht jetzt weiter
         (auth.js meldet nur noch bei Erfolg ab), der Versuch ist also
         wiederholbar — ein Neuladen wuerde die Meldung nur wegwerfen. */
      btn.disabled = false
      btn.textContent = 'Konto endgültig löschen'
      showFlash(res.error || 'Konto konnte nicht gelöscht werden.')
      return
    }
    showFlash('Konto gelöscht')
    setTimeout(() => location.reload(), 600)
  })

  ;['events', 'community', 'gear'].forEach(key => {
    document.getElementById(`acc-notif-${key}`)?.addEventListener('change', e => {
      const acc = getAccount()
      saveAccount({ notif: { ...acc.notif, [key]: e.target.checked } })
    })
  })
  document.getElementById('acc-clear-data')?.addEventListener('click', () => {
    if (!confirm('Wirklich alle Daten löschen? Diese Aktion kann nicht rückgängig gemacht werden.')) return
    /* Schon der Zugriff auf localStorage wirft, wenn der Browser Speicher fuer
       die Seite sperrt (Safari mit blockierten Cookies, privater Modus mancher
       Builds). Ungeschuetzt starb der Handler dann mitten im Loeschen: ein Teil
       der Schluessel war weg, die Rueckmeldung und der Neuladen kamen nie —
       der Nutzer sah nach einer bestaetigten, unumkehrbaren Aktion gar nichts.
       Jetzt entweder vollstaendig durch oder mit ehrlicher Meldung. */
    try {
      const keys = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('mm_')) keys.push(k)
      }
      keys.forEach(k => localStorage.removeItem(k))
    } catch {
      showFlash('Daten konnten nicht gelöscht werden — Browser-Speicher gesperrt.')
      return
    }
    showFlash('Daten gelöscht')
    setTimeout(() => location.reload(), 600)
  })

  /* Export = Auskunft nach Art. 15 DSGVO, nicht nur ein Browser-Backup.
     Vorher wurden ausschliesslich die mm_*-Schluessel aus dem localStorage
     eingesammelt — Nachrichten, Gruppen, Freundschaften, Meldungen und
     Feedback liegen aber in Supabase und fehlten damit vollstaendig.
     Jetzt: erst die Serverdaten (RPC export_my_data(), gibt nur eigene Zeilen
     zurueck), dann die lokalen Schluessel dazu, alles in eine Datei.
     Faellt die RPC aus (offline, Endpoint nicht deployt), wird wie bisher nur
     der lokale Teil exportiert — dann aber mit einem Hinweis IN der Datei,
     damit niemand die unvollstaendige Datei fuer die ganze Auskunft haelt.
     `keys` behaelt Name und Form, damit der Import-Pfad unten weiter passt. */
  document.getElementById('acc-export-data')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget
    btn.disabled = true

    const data = {
      exportedAt: new Date().toISOString(),
      version: 2,
      hinweis: null,
      server: null,
      keys: {},
    }

    let localOk = true
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k?.startsWith('mm_')) data.keys[k] = localStorage.getItem(k)
      }
    } catch {
      localOk = false
    }

    let res
    try {
      res = await auth.exportMyData()
    } catch (err) {
      res = { ok: false, error: err?.message || 'unbekannter Fehler' }
    }
    if (res.ok) {
      data.server = res.data
    } else {
      data.hinweis = `UNVOLLSTÄNDIG: Die Serverdaten (Nachrichten, Gruppen, Freundschaften, Meldungen, Feedback) konnten nicht abgerufen werden — ${res.error}. Diese Datei enthält nur die lokal in diesem Browser gespeicherten Daten.`
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `motomatch-daten-${new Date().toISOString().slice(0,10)}.json`
    a.click()
    URL.revokeObjectURL(url)

    btn.disabled = false
    if (!res.ok) showFlash('Nur lokale Daten — Serverdaten nicht abrufbar (Hinweis steht in der Datei)')
    else if (!localOk) showFlash('Serverdaten heruntergeladen — Browser-Speicher war gesperrt')
    else showFlash('Daten heruntergeladen ✓')
  })

  // Import → read JSON file and restore keys
  document.getElementById('acc-import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      if (!data.keys || typeof data.keys !== 'object') throw new Error('Ungültiges Format')
      if (!confirm(`${Object.keys(data.keys).length} Einträge importieren? Bestehende Daten werden überschrieben.`)) return
      Object.entries(data.keys).forEach(([k, v]) => {
        if (k.startsWith('mm_')) localStorage.setItem(k, v)
      })
      showFlash('Daten importiert ✓')
      setTimeout(() => location.reload(), 800)
    } catch (err) {
      showFlash('Fehler: ' + err.message)
    }
    e.target.value = ''
  })
}

function showFlash(text) {
  const flash = document.createElement('div')
  flash.className = 'acc-flash'
  flash.textContent = text
  document.body.appendChild(flash)
  requestAnimationFrame(() => flash.classList.add('acc-flash--show'))
  setTimeout(() => {
    flash.classList.remove('acc-flash--show')
    setTimeout(() => flash.remove(), 300)
  }, 1800)
}

// ─── Public API ───
/**
 * Spiegelt die Taskleiste der aufrufenden Seite ueber das Overlay. Das Panel
 * ist deckend (inset: 0, z-index 1200) — die originale Leiste liegt darunter
 * und waere sonst weg. Geklont statt neu gebaut, damit die Klicks auf den
 * Original-Buttons landen und deren Handler gelten.
 */
function mountAccountTabbar(sourceBar) {
  const overlay = document.getElementById('acc-overlay')
  if (!overlay || !sourceBar || overlay.querySelector('.acc-tabbar')) return

  const originals = [...sourceBar.querySelectorAll('.tb-btn')]
  // Der Profil-Reiter fuehrt hierher zurueck — merken, bevor die IDs im Klon
  // entfernt werden (doppelte IDs im Dokument).
  const isProfil = originals.map((b) => /profil/i.test(b.id))

  const clone = sourceBar.cloneNode(true)
  clone.removeAttribute('id')
  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))

  const wrap = document.createElement('div')
  // Die Konfigurator-Leiste bleibt am Desktop in der Grundgroesse, die
  // Garage-Leiste ist groesser — der Klon markiert seine Herkunft, damit er
  // dieselben Masse traegt wie das Original darunter.
  const fromKonf = !!sourceBar.closest('.konf-tb-wrap')
  wrap.className = `tb-wrap scrolled acc-tabbar${fromKonf ? ' acc-tabbar--konf' : ''}`
  wrap.appendChild(clone)
  overlay.appendChild(wrap)
  // Schliessen-Button und Inhalt muessen unter der Leiste anfangen
  overlay.classList.add('acc-overlay--tabbar')

  clone.querySelectorAll('.tb-btn').forEach((btn, i) => {
    btn.classList.toggle('tb-btn-active', isProfil[i])
    btn.addEventListener('click', () => {
      // Profil ist der Reiter, auf dem man schon steht — nur schliessen.
      if (isProfil[i]) { closeAccount(); return }
      /* Reihenfolge ist hier der ganze Punkt.
         Vorher lief es: Overlay ausblenden → 300 ms warten → navigieren.
         In der Luecke dazwischen lag die Seite, von der man gerade kam, gut
         sichtbar auf dem Schirm — es sah aus, als ginge es erst zurueck und
         dann erst vorwaerts.
         Jetzt startet der Wechsel zuerst und laeuft hinter dem noch
         stehenden Overlay ab; aufgeloest wird es erst, wenn der neue
         Bildschirm da ist. Zu sehen ist damit nur noch ein Uebergang. */
      const original = originals[i]
      /* Der Reiter, auf dem man ohnehin schon steht — der uebliche Weg
         zurueck aus dem Konto. Sein Original-Handler tut dann nichts
         ("if (tab !== activeKonfTab)"), es gibt also nichts, worauf sich
         warten liesse. Ohne diesen Zweig lief der Waechter bis zur Notbremse
         und das Konto blieb ueber eine Sekunde stehen. */
      if (original?.classList.contains('tb-btn-active')) { closeAccount({ fast: true }); return }
      original?.click()
      closeAccountWhenTargetReady()
    })
  })
}

/**
 * Schliesst das Konto-Overlay, sobald das Ziel wirklich steht.
 *
 * Zwei Arten von Zielen, beide muessen erkannt werden:
 *   1. ein anderer Bildschirm (Garage -> Konfigurator): einer der
 *      `display`-geschalteten Container auf oberster Ebene wechselt.
 *   2. ein anderer Reiter im selben Konfigurator: dort bleibt alles
 *      sichtbar, ausgetauscht wird nur der Inhalt von #konf-right — und
 *      zwar erst nach dessen Ausblenden. Deshalb NICHT auf die aktive
 *      Schaltflaeche schauen: die springt sofort um, der Inhalt darunter
 *      aber erst 200 ms spaeter. Wer darauf schliesst, zeigt fuer einen
 *      Moment den alten Reiter.
 * Erkannt wird der Tausch am neuen ersten Kindknoten — billig zu pruefen,
 * anders als der serialisierte innerHTML jedes Einzelbild.
 *
 * Der Wecker ist die Notbremse fuer echte Aussetzer (Modul laedt nicht o. Ae.).
 * Der haeufige Fall "es passiert nichts, weil man den Reiter anklickt, auf dem
 * man schon steht" wird oben abgefangen und laeuft gar nicht erst hier durch.
 */
const SCREEN_IDS = ['landing', 'bike-detail', 'quiz-screen', 'garage-container', 'drop-container']

function closeAccountWhenTargetReady() {
  /* Der Waechter gehoert zu genau diesem Overlay. Ohne diese Bindung konnte
     ein Lauf aus einer frueheren Runde ein inzwischen neu geoeffnetes
     Overlay wegschliessen. */
  const meins = document.getElementById('acc-overlay')
  if (!meins) return
  const screens = SCREEN_IDS.map((id) => document.getElementById(id)).filter(Boolean)
  const displaysBefore = screens.map((el) => getComputedStyle(el).display)
  const rightPane = document.getElementById('konf-right')
  const paneChildBefore = rightPane?.firstElementChild || null
  const start = performance.now()

  const tick = () => {
    if (document.getElementById('acc-overlay') !== meins) return // fremdes Overlay, nicht anfassen
    const screenChanged = screens.some((el, i) => getComputedStyle(el).display !== displaysBefore[i])
    const paneChanged = !!rightPane && rightPane.firstElementChild !== paneChildBefore
    if (screenChanged || paneChanged || performance.now() - start > 600) { closeAccount({ fast: true }); return }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/**
 * @param {Element} [sourceBar] Taskleiste der aufrufenden Seite; wird ueber
 *   dem Overlay gespiegelt, damit man von hier direkt weiternavigieren kann.
 */
export function openAccount(sourceBar) {
  const bestehend = document.getElementById('acc-overlay')
  if (bestehend) {
    /* Steht schon offen: nichts zu tun.
       Ist es dagegen noch im Ausblenden (Reiterwechsel, 130 ms), dann lag hier
       bisher ein totes Zeitfenster: der Klick auf "Profil" lief ins Leere,
       weil das Element noch im Dokument haengt. Wer zuegig hin und her
       wechselt, traf es regelmaessig — es sah aus, als reagiere der Reiter
       nicht. Also: Rest wegraeumen und frisch aufbauen. */
    if (bestehend.classList.contains('acc-overlay--open')) return
    bestehend.remove()
  }
  const wrapper = document.createElement('div')
  wrapper.innerHTML = buildAccountHTML()
  document.body.appendChild(wrapper.firstElementChild)
  document.body.style.overflow = 'hidden'
  _lastSourceBar = sourceBar || null
  mountAccountTabbar(_lastSourceBar)
  requestAnimationFrame(() => {
    document.getElementById('acc-overlay')?.classList.add('acc-overlay--open')
  })

  document.getElementById('acc-close')?.addEventListener('click', closeAccount)
  document.getElementById('acc-backdrop')?.addEventListener('click', closeAccount)
  document.addEventListener('keydown', escHandler)

  // Vertikale Navigation (Komoot-Stil)
  document.querySelectorAll('.acc-navitem').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.acc-navitem').forEach(t => t.classList.remove('acc-navitem--active'))
      tab.classList.add('acc-navitem--active')
      renderTabContent(tab.dataset.tab)
      document.getElementById('acc-content')?.scrollTo({ top: 0 })
    })
  })

  // Initial tab
  renderTabContent('overview')

  // Edit button → jump to settings
  document.getElementById('acc-edit-btn')?.addEventListener('click', () => {
    document.querySelector('.acc-navitem[data-tab="settings"]')?.click()
  })

  // Anmelden / Abmelden (zentrale Auth, gilt plattformweit)
  document.getElementById('acc-auth-btn')?.addEventListener('click', () => {
    const u = auth.currentUser()
    if (u && !u.guest) { auth.logout(); reopenAccount() }
    else { auth.openAuthModal(() => reopenAccount()) }
  })

  // Wenn initSupabaseAuth noch läuft und Session erst nach dem Render eintrifft,
  // Panel einmalig neu aufbauen sobald ein echter User bekannt wird.
  if (!auth.currentUser() || auth.currentUser().guest) {
    const unsub = auth.subscribe(session => {
      if (session && !session.guest) { unsub(); reopenAccount() }
    })
  }
}
let _lastSourceBar = null

function reopenAccount() {
  const ov = document.getElementById('acc-overlay')
  if (ov) ov.remove()
  document.removeEventListener('keydown', escHandler)
  document.body.style.overflow = ''
  openAccount(_lastSourceBar)
}
function escHandler(e) {
  if (e.key === 'Escape') closeAccount()
}
/**
 * @param {{fast?: boolean}} [opts] `fast` beim Reiterwechsel: der neue
 *   Bildschirm steht schon darunter, das Overlay soll ihn zuegig freigeben.
 *   Wird die Funktion direkt als Ereignis-Empfaenger benutzt (Kreuz, Backdrop),
 *   kommt hier das Event an — es hat kein `fast`, also der ruhige Weg.
 */
export function closeAccount(opts) {
  const overlay = document.getElementById('acc-overlay')
  if (!overlay) return
  const fast = opts?.fast === true
  if (fast) overlay.classList.add('acc-overlay--switching')
  overlay.classList.remove('acc-overlay--open')
  document.removeEventListener('keydown', escHandler)
  setTimeout(() => {
    overlay.remove()
    /* Nur freigeben, wenn inzwischen nicht schon wieder eines steht: bei
       schnellem Hin und Her kann in diesen 130 ms ein neues Overlay geoeffnet
       haben, dem die Scroll-Sperre gehoert. */
    if (!document.getElementById('acc-overlay')) document.body.style.overflow = ''
  }, fast ? 130 : 280)
}
