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
import { getCatalog } from './matching.js'
import { esc } from './util.js'

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
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })
}
/** Relative Zeit für die Chronik — "Gerade eben" / "vor 3 Std." / "Gestern" / Datum. */
function fmtRelative(ts) {
  if (!ts) return ''
  const diffMs = Date.now() - ts
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'Gerade eben'
  if (min < 60) return `vor ${min} Min.`
  const h = Math.floor(min / 60)
  if (h < 24) return `vor ${h} Std.`
  const d = Math.floor(h / 24)
  if (d === 1) return 'Gestern'
  if (d < 7) return `vor ${d} Tagen`
  return fmtDate(ts)
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
    ['bikes', 'Meine Bikes', I.bike, owned.length],
    ['journal', 'Fahrten', I.route, null],
    ['maintenance', 'Wartung', I.wrench, null],
    ['compare', 'Vergleich', I.compare, null],
    ['gear', 'Ausrüstung', I.gear2, gear.length],
    ['places', 'Orte', I.pin, mapFavs.length],
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
                <button class="acc-navitem ${i === 0 ? 'acc-navitem--active' : ''}" data-tab="${id}">
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
  wrench:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  compare: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="7"/><rect x="14" y="6" width="3" height="11"/></svg>',
  gear2:   '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2M4 8h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M9 8V5a3 3 0 0 1 6 0v3"/></svg>',
  chat:    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  pin:     '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  cog:     '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h3M19 12h3M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
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
    case 'bikes':       c.innerHTML = renderBikes(); wireBikeSearch(); break
    case 'compare':     c.innerHTML = renderCompare(); wireCompare(); break
    case 'maintenance': c.innerHTML = renderMaintenance(); wireMaintenance(); break
    case 'journal':     c.innerHTML = renderJournal(); wireJournal(); break
    case 'gear':        c.innerHTML = renderGear(); break
    case 'community':   c.innerHTML = renderCommunity(); break
    case 'places':      c.innerHTML = renderPlaces(); requestAnimationFrame(() => requestAnimationFrame(wirePlaces)); break
    case 'settings':    c.innerHTML = renderSettings(); wireSettings(); break
  }
  wireTabContent()
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
  // Zu einem anderen Reiter springen (Schnellzugriff-Kacheln, Chronik-Einträge, …)
  document.querySelectorAll('[data-tab-jump]').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelector(`.acc-navitem[data-tab="${el.dataset.tabJump}"]`)?.click()
    })
  })
  // Eigenes Bike wieder entfernen
  document.querySelectorAll('[data-remove-owned-bike]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation()
      toggleOwnedBike(el.dataset.removeOwnedBike)
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
        const badge = document.querySelector('.acc-navitem[data-tab="gear"] .acc-navcount')
        if (badge) badge.textContent = String(favs.length)
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
        const badge = document.querySelector('.acc-navitem[data-tab="places"] .acc-navcount')
        if (badge) badge.textContent = String(favs.length)
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

// ─── Tab renderers ───
/** Sammelt alle bekannten Nutzeraktionen aus den verschiedenen Feature-Speichern
 *  zu einer einzigen, chronologisch sortierten Aktivitäts-Chronik. */
function collectActivityFeed(limit = 12) {
  const gear = collectGearFavs()
  const com = collectCommunityActivity()
  const recents = collectRecentBikes()
  const rides = getRides()
  const maintenance = getMaintenanceData()

  const activities = []
  recents.forEach(b => activities.push({
    type: 'bike', icon: '🏍', color: 'linear-gradient(135deg,#d49258,#a76d3a)',
    title: `${b.name} angesehen`, sub: b.style, ts: b.ts,
    jump: { openBike: b.name },
  }))
  gear.forEach(g => activities.push({
    type: 'gear', icon: '🎒', color: 'linear-gradient(135deg,#4a8eff,#3066d6)',
    title: `${g.brand} ${g.name} gemerkt`, sub: `${g.type} · ${g.price}`, ts: g.ts || 0,
    jump: { tab: 'gear' },
  }))
  com.posts.forEach(p => activities.push({
    type: 'post', icon: '💬', color: 'linear-gradient(135deg,#e05555,#c074dc)',
    title: `Beitrag veröffentlicht: ${p.title}`, sub: p.category, ts: p.createdAt,
    jump: { community: true },
  }))
  rides.forEach(r => activities.push({
    type: 'ride', icon: '🛣️', color: 'linear-gradient(135deg,#5fc587,#3da567)',
    title: `Fahrt erfasst: ${r.title}`, sub: `${r.km} km${r.hours ? ` · ${r.hours} h` : ''}`, ts: r.date,
    jump: { tab: 'journal' },
  }))
  Object.entries(maintenance).forEach(([bikeName, bikeData]) => {
    MAINTENANCE_INTERVALS.forEach(iv => {
      const doneAt = bikeData[iv.key + '_date']
      if (doneAt) activities.push({
        type: 'maintenance', icon: '🔧', color: 'linear-gradient(135deg,#e8b94a,#b8842a)',
        title: `${iv.label} erledigt`, sub: bikeName, ts: doneAt,
        jump: { tab: 'maintenance' },
      })
    })
  })

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
          <div class="acc-quick-icon" style="background:linear-gradient(135deg,#e05555,#c074dc)">💬</div>
          <span class="acc-quick-label">Community</span>
        </button>
        <button class="acc-quick-card" data-tab-jump="gear">
          <div class="acc-quick-icon" style="background:linear-gradient(135deg,#4a8eff,#3066d6)">🎒</div>
          <span class="acc-quick-label">Ausrüstung</span>
        </button>
        <button class="acc-quick-card" data-tab-jump="places">
          <div class="acc-quick-icon" style="background:linear-gradient(135deg,#5fc587,#3da567)">📍</div>
          <span class="acc-quick-label">Meine Orte</span>
        </button>
        <button class="acc-quick-card" data-tab-jump="bikes">
          <div class="acc-quick-icon" style="background:linear-gradient(135deg,#d49258,#a76d3a)">🏍</div>
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
              <div class="acc-activity-icon" style="background:${a.color}">${a.icon}</div>
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

/* ─── Bike comparison data + storage ─── */
const COMPARE_SPECS = {
  'Iron 883':      { ps: 51, weight: 256, accel: 6.5, topSpeed: 161, cc: 883,  price: 7000 },
  'Seventy-Two':   { ps: 66, weight: 255, accel: 5.2, topSpeed: 170, cc: 1202, price: 15000 },
  'CB 750 F':      { ps: 67, weight: 235, accel: 5.8, topSpeed: 200, cc: 736,  price: 12000 },
  '500 Custom':    { ps: 48, weight: 200, accel: 6.0, topSpeed: 180, cc: 500,  price: 6500 },
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
      const v = COMPARE_SPECS[name]?.[key]
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
              <div class="acc-cmp-bike-icon" style="background:linear-gradient(135deg,${stringColor(name)},#1a1a1a)">🏍</div>
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
                const v = COMPARE_SPECS[name]?.[key] ?? '—'
                const display = key === 'price' ? `${v.toLocaleString('de-DE')} €` : v
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
          ${b.image ? `<img class="acc-cmp-search-img" src="${b.image}" alt="">` : '<span class="acc-cmp-search-img acc-cmp-search-img--placeholder">🏍</span>'}
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

/* ─── Maintenance tracker ─── */
const MAINTENANCE_INTERVALS = [
  { key: 'oil',    label: 'Ölwechsel',         km: 5000 },
  { key: 'tires',  label: 'Reifenwechsel',     km: 20000 },
  { key: 'chain',  label: 'Kette/Riemen',      km: 15000 },
  { key: 'brakes', label: 'Bremsen-Check',     km: 10000 },
  { key: 'tuv',    label: 'TÜV/AU',            km: 0, months: 24 },
]
/** Style-spezifische Intervall-Overrides */
function getBikeIntervals(style) {
  const s = (style || '').toLowerCase()
  const base = MAINTENANCE_INTERVALS.map(iv => ({ ...iv }))
  if (s.includes('cruiser') || s.includes('chopper')) {
    // Cruiser: größerer Motor, längere Ölwechsel, Riemenantrieb statt Kette
    base.find(iv => iv.key === 'oil').km = 8000
    const chain = base.find(iv => iv.key === 'chain')
    chain.label = 'Riemen-Check'
    chain.km = 25000
  } else if (s.includes('sport') || s.includes('supersport')) {
    // Sportbike: kürzere Intervalle, härtere Beanspruchung
    base.find(iv => iv.key === 'oil').km = 3000
    base.find(iv => iv.key === 'chain').km = 8000
    base.find(iv => iv.key === 'brakes').km = 8000
    base.find(iv => iv.key === 'tires').km = 10000
  } else if (s.includes('adventure') || s.includes('enduro') || s.includes('reise')) {
    // Adventure: robustere Wartung, Shaft/Kette je nach Modell
    base.find(iv => iv.key === 'oil').km = 7500
    base.find(iv => iv.key === 'chain').km = 12000
    base.find(iv => iv.key === 'tires').km = 15000
  } else if (s.includes('naked') || s.includes('streetfighter')) {
    base.find(iv => iv.key === 'oil').km = 6000
  }
  return base
}
function getMaintenanceData() {
  try { return JSON.parse(localStorage.getItem('mm_maintenance_v1') || '{}') } catch { return {} }
}
function saveMaintenanceData(data) {
  try { localStorage.setItem('mm_maintenance_v1', JSON.stringify(data)) } catch {}
}
const MAINT_ICONS = {
  oil:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2l1 4H5l1-4M3 10h6l-2 10H5L3 10zM14 2s3 3 3 7-3 7-3 7"/><path d="M17 9h4v12h-4z"/></svg>`,
  tires:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/></svg>`,
  chain:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9" width="6" height="6" rx="2"/><rect x="16" y="9" width="6" height="6" rx="2"/><path d="M8 12h8"/></svg>`,
  brakes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>`,
  tuv:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z"/></svg>`,
}

function renderMaintenance() {
  const owned = getOwnedBikes()
  const data = getMaintenanceData()

  const searchBar = `
    <div class="mw-search-wrap">
      <input class="mw-search-input" id="mw-search-input" placeholder="Motorrad suchen und hinzufügen…" autocomplete="off">
      <ul class="mw-search-results" id="mw-search-results"></ul>
    </div>
  `

  if (!owned.length) {
    return `
      <div class="mw-wrap">
        ${searchBar}
        <div class="mw-empty">
          <div class="mw-empty-icon">🔧</div>
          <div class="mw-empty-title">Noch kein Bike hinterlegt</div>
          <div class="mw-empty-sub">Suche dein Motorrad oben oder markiere es im Bike-Ansicht-Tab als „Ich fahre dieses Bike".</div>
        </div>
      </div>
    `
  }

  // Pick active bike (first owned by default)
  const activeBikeName = data.__activeBike || owned[0].name
  const activeBike = owned.find(b => b.name === activeBikeName) || owned[0]
  const bData = data[activeBike.name] || {}
  const currentKm = bData.km || 0
  const intervals = getBikeIntervals(activeBike.style)

  // Compute next service urgency
  const urgentCount = intervals.filter(iv => {
    if (!iv.km) return false
    const lastKm = bData[iv.key + '_km'] || 0
    return (currentKm - lastKm) >= (iv.km - 500)
  }).length

  const heroIcon = activeBike.image
    ? `<img class="mw-hero-img" src="${activeBike.image}" alt="${activeBike.name}">`
    : `<div class="mw-hero-icon">🏍</div>`

  return `
    <div class="mw-wrap">
      ${searchBar}

      <!-- Bike selector (if multiple bikes) -->
      ${owned.length > 1 ? `
        <div class="mw-bike-tabs">
          ${owned.map(b => `
            <button class="mw-bike-tab ${b.name === activeBike.name ? 'mw-bike-tab--active' : ''}" data-select-bike="${b.name}">
              ${b.image ? `<img class="mw-bike-tab-img" src="${b.image}" alt="${b.name}">` : `<span class="mw-bike-tab-dot" style="background:${stringColor(b.name)}"></span>`}
              ${b.name}
            </button>
          `).join('')}
        </div>
      ` : ''}

      <!-- Bike header card -->
      <div class="mw-hero" style="--bcolor:${stringColor(activeBike.name)}">
        <div class="mw-hero-inner">
          <div class="mw-hero-left">
            ${heroIcon}
            <div class="mw-hero-info">
              <div class="mw-hero-name">${activeBike.name}</div>
              <div class="mw-hero-style">${activeBike.style}</div>
              ${urgentCount > 0 ? `<div class="mw-hero-alert">⚠ ${urgentCount} Service${urgentCount > 1 ? 's' : ''} fällig</div>` : ''}
            </div>
          </div>
          <div class="mw-hero-km">
            <div class="mw-hero-km-label">Km-Stand</div>
            <input type="number" class="mw-km-input" id="mw-km-input" data-bike="${activeBike.name}" value="${currentKm}" min="0" step="100" placeholder="0">
            <div class="mw-hero-km-sub">km</div>
          </div>
        </div>
      </div>

      <!-- Service cards -->
      <div class="mw-services">
        ${intervals.map(iv => {
          const lastKm = bData[iv.key + '_km'] || 0
          const lastDate = bData[iv.key + '_date']
          const pct = iv.km ? Math.max(0, Math.min(100, ((currentKm - lastKm) / iv.km) * 100)) : 0
          const remain = iv.km ? (lastKm + iv.km) - currentKm : null
          const urgent = remain !== null && remain < 500
          const overdue = remain !== null && remain < 0
          const statusCls = overdue ? 'bad' : urgent ? 'warn' : 'ok'
          const statusLabel = remain === null
            ? (lastDate ? `Zuletzt: ${new Date(lastDate).toLocaleDateString('de-DE',{day:'2-digit',month:'short',year:'numeric'})}` : 'Noch nie geprüft')
            : overdue
              ? `Überfällig ${Math.abs(remain).toLocaleString('de-DE')} km`
              : `Noch ${remain.toLocaleString('de-DE')} km`

          return `
            <div class="mw-service-card ${urgent || overdue ? 'mw-service-card--alert' : ''}">
              <div class="mw-service-icon">${MAINT_ICONS[iv.key] || ''}</div>
              <div class="mw-service-body">
                <div class="mw-service-top">
                  <span class="mw-service-name">${iv.label}</span>
                  <span class="mw-service-status mw-service-status--${statusCls}">${statusLabel}</span>
                </div>
                ${iv.km ? `
                  <div class="mw-bar">
                    <div class="mw-bar-fill ${statusCls !== 'ok' ? 'mw-bar-fill--' + statusCls : ''}" style="width:${pct}%"></div>
                  </div>
                  <div class="mw-bar-labels">
                    <span>${lastDate || lastKm ? `Zuletzt bei ${lastKm.toLocaleString('de-DE')} km` : 'Noch kein Eintrag'}</span>
                    <span>alle ${(iv.km/1000).toLocaleString('de-DE')} Tkm</span>
                  </div>
                ` : `
                  <div class="mw-bar-labels">
                    <span>${lastDate ? `Letzter TÜV: ${new Date(lastDate).toLocaleDateString('de-DE',{month:'short',year:'numeric'})}` : 'Noch kein Eintrag'}</span>
                    <span>alle 2 Jahre</span>
                  </div>
                `}
              </div>
              <button class="mw-done-btn" data-bike="${activeBike.name}" data-key="${iv.key}" title="Als erledigt markieren">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>
              </button>
            </div>
          `
        }).join('')}
      </div>

    </div>
  `
}
function wireMaintenance() {
  // Bike search
  const searchInput = document.getElementById('mw-search-input')
  const searchResults = document.getElementById('mw-search-results')
  let allBikes = []

  if (searchInput) {
    const bikeListPromise = import('./bike-detail.js').then(m =>
      Object.values(m.BIKE_DATA || {}).map(b => ({
        name: b.fullName, style: b.style || '', image: b.img1 || b.img2 || '',
      }))
    ).catch(() => [])

    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase()
      if (!q) { searchResults.innerHTML = ''; searchResults.style.display = 'none'; return }
      bikeListPromise.then(bikes => {
        const hits = bikes.filter(b => b.name.toLowerCase().includes(q) || b.style.toLowerCase().includes(q)).slice(0, 6)
      if (!hits.length) { searchResults.innerHTML = ''; searchResults.style.display = 'none'; return }
      searchResults.innerHTML = hits.map(b => `
        <li class="mw-search-item" data-name="${b.name}" data-style="${b.style}" data-image="${b.image}">
          ${b.image ? `<img class="mw-search-item-img" src="${b.image}" alt="">` : '<span class="mw-search-item-icon">🏍</span>'}
          <span class="mw-search-item-name">${b.name}</span>
          <span class="mw-search-item-style">${b.style}</span>
        </li>
      `).join('')
      searchResults.style.display = 'block'

      searchResults.querySelectorAll('.mw-search-item').forEach(li => {
        li.addEventListener('click', () => {
          addOwnedBike(li.dataset.name, li.dataset.style, li.dataset.image)
          const mData = getMaintenanceData()
          mData.__activeBike = li.dataset.name
          saveMaintenanceData(mData)
          searchInput.value = ''
          searchResults.style.display = 'none'
          renderTabContent('maintenance')
        })
      })
    }) // closes bikeListPromise.then
    }) // closes searchInput.addEventListener

    document.addEventListener('click', e => {
      if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.style.display = 'none'
      }
    }, { capture: true, once: false })
  }

  // Bike selector tabs
  document.querySelectorAll('[data-select-bike]').forEach(btn => {
    btn.addEventListener('click', () => {
      const data = getMaintenanceData()
      data.__activeBike = btn.dataset.selectBike
      saveMaintenanceData(data)
      renderTabContent('maintenance')
    })
  })

  // km input — save on blur/enter
  const kmInput = document.getElementById('mw-km-input')
  const saveKm = () => {
    const data = getMaintenanceData()
    const bike = kmInput?.dataset.bike
    if (!bike) return
    data[bike] = data[bike] || {}
    data[bike].km = parseInt(kmInput.value) || 0
    saveMaintenanceData(data)
    renderTabContent('maintenance')
  }
  kmInput?.addEventListener('change', saveKm)
  kmInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveKm() } })

  // Mark done
  document.querySelectorAll('.mw-done-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const data = getMaintenanceData()
      const bike = btn.dataset.bike
      const key = btn.dataset.key
      data[bike] = data[bike] || {}
      data[bike][key + '_km'] = data[bike].km || 0
      data[bike][key + '_date'] = Date.now()
      saveMaintenanceData(data)
      showFlash('Service eingetragen ✓')
      renderTabContent('maintenance')
    })
  })
}

/* ─── Ride journal ─── */
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
    img.src = url
  })
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
        <button class="rj-add-btn" id="rj-open-form">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
          Neue Fahrt
        </button>
      </div>

      <!-- New ride sheet (hidden by default) -->
      <div class="rj-sheet" id="rj-sheet" hidden>
        <div class="rj-sheet-inner">
          <div class="rj-sheet-tape"></div>
          <div class="rj-sheet-header">
            <span class="rj-sheet-label">Neue Seite</span>
            <button class="rj-sheet-close" id="rj-close-form">✕</button>
          </div>

          <!-- Photo upload -->
          <div class="rj-photo-drop" id="rj-photo-drop">
            <input type="file" id="rj-photo-input" accept="image/*" hidden>
            <div class="rj-photo-placeholder" id="rj-photo-placeholder">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
              <span>Foto hinzufügen</span>
            </div>
            <img class="rj-photo-preview" id="rj-photo-preview" hidden>
            <button class="rj-photo-remove" id="rj-photo-remove" hidden>✕</button>
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
                ${r.photo ? `<img class="rj-card-photo" src="${r.photo}" alt="">` : `
                  <div class="rj-card-photo-empty">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".25"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                  </div>
                `}
                <div class="rj-card-body">
                  <div class="rj-card-date">${dayStr} <span>${yearStr}</span></div>
                  <div class="rj-card-title">${esc(r.title)}</div>
                  <div class="rj-card-chips">
                    <span class="rj-chip">${r.km} km</span>
                    ${r.hours ? `<span class="rj-chip">${r.hours} h</span>` : ''}
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
      <!-- Edit overlay -->
      <div class="rj-edit-overlay" id="rj-edit-overlay" hidden>
        <div class="rj-edit-modal">
          <div class="rj-edit-header">
            <span class="rj-sheet-label">Eintrag bearbeiten</span>
            <button class="rj-sheet-close" id="rj-edit-close">✕</button>
          </div>
          <div class="rj-photo-drop" id="rj-edit-photo-drop">
            <input type="file" id="rj-edit-photo-input" accept="image/*" hidden>
            <div class="rj-photo-placeholder" id="rj-edit-photo-placeholder">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
              <span>Foto hinzufügen</span>
            </div>
            <img class="rj-photo-preview" id="rj-edit-photo-preview" hidden>
            <button class="rj-photo-remove" id="rj-edit-photo-remove" hidden>✕</button>
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

  // Open / close form sheet
  document.getElementById('rj-open-form')?.addEventListener('click', () => {
    const sheet = document.getElementById('rj-sheet')
    sheet.hidden = false
    sheet.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
  document.getElementById('rj-close-form')?.addEventListener('click', () => {
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
    pendingPhoto = await compressPhoto(file)
    photoPreview.src = pendingPhoto
    photoPreview.hidden = false
    photoPlaceholder.hidden = true
    photoRemove.hidden = false
  })
  photoRemove?.addEventListener('click', e => {
    e.stopPropagation()
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
    }
    if (!ride.title || !ride.km) return
    const rides = getRides()
    rides.push(ride)
    saveRides(rides)
    pendingPhoto = null
    showFlash('Eintrag gespeichert ✓')
    renderTabContent('journal')
  })

  // ── Edit overlay ──
  let editPhoto = null // photo state for edit modal

  function openEditOverlay(ride) {
    const overlay = document.getElementById('rj-edit-overlay')
    if (!overlay) return
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

  // Open on card click
  document.querySelectorAll('[data-open-ride]').forEach(card => {
    card.addEventListener('click', () => {
      const ride = getRides().find(r => r.id === card.dataset.openRide)
      if (ride) openEditOverlay(ride)
    })
  })

  // Close overlay
  document.getElementById('rj-edit-close')?.addEventListener('click', () => {
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
    editPhoto = await compressPhoto(file)
    editPrev.src = editPhoto; editPrev.hidden = false
    editPh.hidden = true; editRm.hidden = false
  })
  editRm?.addEventListener('click', e => {
    e.stopPropagation()
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
    const updated = {
      id,
      date: new Date(document.getElementById('rj-edit-date').value).getTime(),
      km: parseInt(document.getElementById('rj-edit-km').value) || 0,
      hours: parseFloat(document.getElementById('rj-edit-hours').value) || 0,
      title: document.getElementById('rj-edit-title').value.trim(),
      notes: document.getElementById('rj-edit-notes').value.trim(),
      mood, accent,
      photo: editPhoto || null,
    }
    if (!updated.title || !updated.km) return
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

function renderBikes() {
  const owned = getOwnedBikes()
  const recents = collectRecentBikes().filter(b => !owned.some(o => o.name === b.name))

  return `
    <div class="acc-section">
      <h3 class="acc-section-title">Meine Bikes <span class="acc-count">${owned.length}</span></h3>
      <p class="acc-section-sub">Suche dein Bike und trage es hier ein — nur weil du Bikes ansiehst, heißt das nicht, dass du sie besitzt.</p>
      <div class="acc-bike-search">
        <input type="text" class="acc-input" id="acc-bike-search-input" placeholder="Bike suchen, z. B. Iron 883…" autocomplete="off">
        <div class="acc-bike-search-results" id="acc-bike-search-results" hidden></div>
      </div>
      ${owned.length === 0 ? `
        <div class="acc-empty-inline">Noch kein eigenes Bike markiert.</div>
      ` : `
        <div class="acc-bikes-list">
          ${owned.map(b => `
            <div class="acc-bike-card" data-open-bike="${b.name}">
              <div class="acc-bike-icon" style="background:linear-gradient(135deg, ${stringColor(b.name)}, #1a1a1a)">🏍</div>
              <div class="acc-bike-info">
                <div class="acc-bike-name">${b.name}</div>
                <div class="acc-bike-meta">${b.style} · seit ${fmtDate(b.addedAt)}</div>
              </div>
              <button class="acc-remove-btn" data-remove-owned-bike="${b.name}" aria-label="Entfernen">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          `).join('')}
        </div>
      `}
    </div>

    <div class="acc-section">
      <h3 class="acc-section-title">Zuletzt angesehen <span class="acc-count">${recents.length}</span></h3>
      ${recents.length === 0 ? `
        <div class="acc-empty-inline">Noch keine weiteren Bikes angesehen.</div>
      ` : `
        <div class="acc-bikes-list">
          ${recents.map(b => `
            <button class="acc-bike-card" data-open-bike="${b.name}">
              <div class="acc-bike-icon" style="background:linear-gradient(135deg, ${stringColor(b.name)}, #1a1a1a)">🏍</div>
              <div class="acc-bike-info">
                <div class="acc-bike-name">${b.name}</div>
                <div class="acc-bike-meta">${b.style} · ${fmtDate(b.ts)}</div>
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18l6-6-6-6"/></svg>
            </button>
          `).join('')}
        </div>
      `}
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

function renderGear() {
  const gear = collectGearFavs()
  if (!gear.length) return `<div class="acc-empty">
    <div class="acc-empty-icon-lg">🎒</div>
    <p>Keine Ausrüstung gemerkt</p>
    <p class="acc-empty-sub">Tippe auf das ♥ auf einer Karte im Ausrüstung-Tab.</p>
  </div>`

  const CAT_META = {
    helmet:         { label:'Helme',           icon:'⛑️',  protect: 5 },
    jacket:         { label:'Jacken',           icon:'🥋',  protect: 4 },
    gloves:         { label:'Handschuhe',       icon:'🧤',  protect: 3 },
    boots:          { label:'Stiefel',          icon:'👢',  protect: 3 },
    pants:          { label:'Hosen',            icon:'👖',  protect: 3 },
    kidneybelt:     { label:'Nierengurte',      icon:'🩹',  protect: 2 },
    balaclava:      { label:'Sturmhauben',      icon:'🪖',  protect: 1 },
    backprotector:  { label:'Rückenprotektoren',icon:'🛡️',  protect: 5 },
    other:          { label:'Sonstiges',        icon:'🔧',  protect: 0 },
  }

  function protectLevel(type, cat) {
    const t = (type || '').toLowerCase()
    if (t.includes('racing') || t.includes('carbon')) return 5
    if (t.includes('integral') || t.includes('sport')) return 4
    if (t.includes('flip') || t.includes('offroad') || t.includes('enduro')) return 3
    return CAT_META[cat]?.protect ?? 2
  }

  function parsePriceMin(priceStr) {
    const m = (priceStr || '').replace(/\./g, '').match(/(\d+)/)
    return m ? parseInt(m[1]) : 0
  }

  const groups = {}
  gear.forEach(g => { const k = g.gear || 'other'; (groups[k] = groups[k] || []).push(g) })

  const totalMin = gear.reduce((s, g) => s + parsePriceMin(g.price), 0)
  const covered = new Set(gear.map(g => g.gear || 'other'))
  const missing = ['helmet','jacket','gloves','boots'].filter(k => !covered.has(k))

  return `
    <div class="acc-section">
      <div class="acc-gear-header">
        <div>
          <h3 class="acc-section-title" style="margin:0">Meine Ausrüstung <span class="acc-count">${gear.length}</span></h3>
          <div class="acc-gear-budget">ab ${totalMin.toLocaleString('de-DE')} € Gesamtinvestition</div>
        </div>
        ${missing.length ? `<div class="acc-gear-missing">⚠ Noch fehlend: ${missing.map(k => CAT_META[k].label).join(', ')}</div>` : `<div class="acc-gear-complete">✓ Vollständige Schutzausrüstung</div>`}
      </div>

      ${Object.entries(groups).map(([key, items]) => {
        const meta = CAT_META[key] || CAT_META.other
        return `
        <div class="acc-gear-group">
          <div class="acc-gear-group-header">
            <span class="acc-gear-cat-icon">${meta.icon}</span>
            <span class="acc-gear-group-label">${meta.label}</span>
            <span class="acc-gear-group-count">${items.length}</span>
          </div>
          <div class="acc-gear-list">
            ${items.map(g => {
              const lvl = protectLevel(g.type, key)
              const dots = Array.from({length:5}, (_,i) => `<span class="acc-gear-dot ${i < lvl ? 'acc-gear-dot--on' : ''}"></span>`).join('')
              return `
              <div class="acc-gear-card">
                <div class="acc-gear-info">
                  <div class="acc-gear-top-row">
                    <span class="acc-gear-brand">${g.brand}</span>
                    <span class="acc-gear-protect">${dots}</span>
                  </div>
                  <div class="acc-gear-name">${g.name}</div>
                  <div class="acc-gear-type">${g.type}</div>
                </div>
                <div class="acc-gear-right">
                  <div class="acc-gear-price">${g.price}</div>
                  <button class="acc-remove-btn" data-remove-gear-fav="${g.id}" aria-label="Entfernen">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              </div>`
            }).join('')}
          </div>
        </div>`
      }).join('')}
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
              <div class="acc-post-cat">${p.category}</div>
              <div class="acc-post-body">
                <div class="acc-post-title">${p.title}</div>
                <div class="acc-post-desc">${p.desc}</div>
                <div class="acc-post-meta">${fmtDate(p.createdAt)} · ${p.meta} · ${p.extra}</div>
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
  if (!favs.length) return `<div class="acc-empty">
    <div class="acc-empty-icon-lg">📍</div>
    <p>Keine gespeicherten Orte</p>
    <p class="acc-empty-sub">Tippe auf „Merken" in der Karten-Ansicht.</p>
  </div>`
  const hasCoords = favs.some(f => f.lat && f.lng)
  return `
    <div class="acc-section">
      <h3 class="acc-section-title">Gespeicherte Orte <span class="acc-count">${favs.length}</span></h3>
      ${hasCoords ? `<div class="acc-places-map-wrap"></div>` : ''}
      <div class="acc-places-list">
        ${favs.map(f => `
          <div class="acc-place-card" data-place-id="${f.id}" data-lat="${f.lat || ''}" data-lng="${f.lng || ''}">
            <div class="acc-place-pin">📍</div>
            <div class="acc-place-body">
              <div class="acc-place-name">${f.name}</div>
              ${f.address ? `<div class="acc-place-addr">${f.address}</div>` : ''}
              ${f.rating ? `<div class="acc-place-rating">★ ${f.rating.toFixed(1)}</div>` : ''}
            </div>
            <div class="acc-place-actions">
              ${f.lat && f.lng ? `
                <button class="acc-place-route" data-open-place-map="${f.id}" data-lat="${f.lat}" data-lng="${f.lng}" aria-label="In Karte öffnen" title="In Karte öffnen">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z M8 2v16 M16 6v16"/></svg>
                </button>
                <a class="acc-place-route" href="https://www.google.com/maps/dir/?api=1&destination=${f.lat},${f.lng}" target="_blank" rel="noopener" aria-label="Route">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l18-8-8 18-2-7-8-3z"/></svg>
                </a>` : ''}
              <button class="acc-remove-btn" data-remove-place-fav="${f.id}" aria-label="Entfernen">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `
}

function wirePlaces() {
  const mapWrap = document.querySelector('.acc-places-map-wrap')
  if (!mapWrap) return
  const favs = collectMapFavs().filter(f => f.lat && f.lng)
  if (!favs.length) return

  // Canvas-based tile map — avoids Leaflet sizing issues inside overflow:auto containers
  const lats = favs.map(f => f.lat)
  const lngs = favs.map(f => f.lng)

  function lngToTileX(lng, z) { return (lng + 180) / 360 * Math.pow(2, z) }
  function latToTileY(lat, z) {
    const r = lat * Math.PI / 180
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)
  }

  const state = {
    zoom: 14,
    clat: lats.reduce((a, b) => a + b, 0) / lats.length,
    clng: lngs.reduce((a, b) => a + b, 0) / lngs.length,
  }

  const W = mapWrap.offsetWidth || 470
  const H = mapWrap.offsetHeight || 220
  const dpr = devicePixelRatio || 1
  const subs = ['a', 'b', 'c', 'd']

  const canvas = document.createElement('canvas')
  canvas.width = W * dpr
  canvas.height = H * dpr
  canvas.style.cssText = 'width:100%;height:100%;display:block'
  mapWrap.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)

  function render() {
    const { zoom, clat, clng } = state
    const txF = lngToTileX(clng, zoom)
    const tyF = latToTileY(clat, zoom)
    const tileX = Math.floor(txF)
    const tileY = Math.floor(tyF)
    const offX = W / 2 - (txF - tileX) * 256
    const offY = H / 2 - (tyF - tileY) * 256

    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, W, H)

    let pending = 9
    const check = () => { if (--pending === 0) drawMarkers(zoom, tileX, tileY, offX, offY) }

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const tx = tileX + dx, ty = tileY + dy
        const sub = subs[Math.abs(tx + ty) % 4]
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => { ctx.drawImage(img, offX + dx * 256, offY + dy * 256, 256, 256); check() }
        img.onerror = check
        img.src = `https://${sub}.basemaps.cartocdn.com/dark_nolabels/${zoom}/${tx}/${ty}@2x.png`
      }
    }
  }

  function drawMarkers(zoom, tileX, tileY, offX, offY) {
    favs.forEach(f => {
      const fx = offX + (lngToTileX(f.lng, zoom) - tileX) * 256
      const fy = offY + (latToTileY(f.lat, zoom) - tileY) * 256
      ctx.beginPath()
      ctx.arc(fx, fy, 6, 0, Math.PI * 2)
      ctx.fillStyle = '#c9a84c'
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.stroke()
    })
  }

  render()

  // Zoom buttons
  const zoomCtrl = document.createElement('div')
  zoomCtrl.style.cssText = 'position:absolute;bottom:10px;right:10px;display:flex;flex-direction:column;gap:4px;z-index:10'
  ;['+', '−'].forEach((label, i) => {
    const btn = document.createElement('button')
    btn.textContent = label
    btn.style.cssText = 'width:28px;height:28px;border-radius:6px;border:1px solid rgba(255,255,255,0.15);background:rgba(20,20,20,0.85);color:#fff;font-size:16px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center'
    btn.addEventListener('click', () => {
      state.zoom = Math.max(10, Math.min(18, state.zoom + (i === 0 ? 1 : -1)))
      render()
    })
    zoomCtrl.appendChild(btn)
  })
  mapWrap.style.position = 'relative'
  mapWrap.appendChild(zoomCtrl)

  // Hover or click on place card → center map on that location
  document.querySelectorAll('.acc-place-card[data-lat]').forEach(card => {
    const focus = () => {
      const lat = parseFloat(card.dataset.lat)
      const lng = parseFloat(card.dataset.lng)
      if (!lat || !lng) return
      state.clat = lat
      state.clng = lng
      state.zoom = 16
      render()
      document.querySelectorAll('.acc-place-card').forEach(c => c.classList.remove('acc-place-card--active'))
      card.classList.add('acc-place-card--active')
    }
    card.addEventListener('mouseenter', focus)
    card.addEventListener('click', e => { if (!e.target.closest('a, button')) focus() })
  })
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

            ${realUser && u.password !== null ? `
            <div class="acc-fieldbox" data-fieldbox="password">
              <div class="acc-fieldbox-label">Passwort</div>
              <div class="acc-fieldbox-row">
                <div class="acc-fieldbox-value" data-fb-value>••••••••</div>
                <button type="button" class="acc-fieldbox-btn" data-fb-edit>Bearbeiten</button>
              </div>
              <div class="acc-fieldbox-pwform" data-fb-pwform hidden>
                <input class="acc-input" data-fb-curpass type="password" minlength="4" placeholder="Aktuelles Passwort">
                <input class="acc-input" data-fb-newpass type="password" minlength="4" placeholder="Neues Passwort">
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
            <p class="acc-danger-note">Löscht dein Konto unwiderruflich — du wirst automatisch abgemeldet.</p>` : ''}
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

  // Profilbild hochladen (als Data-URL lokal gespeichert)
  document.getElementById('acc-avatar-file')?.addEventListener('change', e => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { showFlash('Bild ist zu groß (max. 2 MB)'); return }
    const reader = new FileReader()
    reader.onload = () => {
      saveAccount({ avatar: reader.result })
      renderTabContent('settings')
      refreshAccountHeader()
      showFlash('Profilbild aktualisiert ✓')
    }
    reader.readAsDataURL(file)
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
        saveAccount({ email: inputEl.value.trim() })
        valueEl.textContent = inputEl.value.trim() || '—'
      } else if (field === 'age') {
        const v = inputEl.value ? parseInt(inputEl.value) : null
        saveAccount({ age: v })
        valueEl.textContent = v ?? '—'
      } else if (field === 'license') {
        saveAccount({ license: inputEl.value })
        valueEl.textContent = inputEl.selectedOptions[0]?.textContent || 'Keine Angabe'
      }
      setEditing(false)
    })
  })

  document.getElementById('acc-delete-account')?.addEventListener('click', async () => {
    if (!confirm('Konto wirklich endgültig löschen? Diese Aktion kann nicht rückgängig gemacht werden.')) return
    const res = await auth.deleteAccount()
    if (!res.ok) { showFlash(res.error); setTimeout(() => location.reload(), 1200); return }
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
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith('mm_')) keys.push(k)
    }
    keys.forEach(k => localStorage.removeItem(k))
    showFlash('Daten gelöscht')
    setTimeout(() => location.reload(), 600)
  })

  // Export → download all mm_* keys as JSON
  document.getElementById('acc-export-data')?.addEventListener('click', () => {
    const data = { exportedAt: new Date().toISOString(), version: 1, keys: {} }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith('mm_')) data.keys[k] = localStorage.getItem(k)
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `motomatch-backup-${new Date().toISOString().slice(0,10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    showFlash('Daten heruntergeladen ✓')
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
export function openAccount() {
  if (document.getElementById('acc-overlay')) return
  const wrapper = document.createElement('div')
  wrapper.innerHTML = buildAccountHTML()
  document.body.appendChild(wrapper.firstElementChild)
  document.body.style.overflow = 'hidden'
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
function reopenAccount() {
  const ov = document.getElementById('acc-overlay')
  if (ov) ov.remove()
  document.removeEventListener('keydown', escHandler)
  document.body.style.overflow = ''
  openAccount()
}
function escHandler(e) {
  if (e.key === 'Escape') closeAccount()
}
export function closeAccount() {
  const overlay = document.getElementById('acc-overlay')
  if (!overlay) return
  overlay.classList.remove('acc-overlay--open')
  document.removeEventListener('keydown', escHandler)
  setTimeout(() => { overlay.remove(); document.body.style.overflow = '' }, 280)
}
