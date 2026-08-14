/**
 * ══════════════════════════════════════════════════════════════════
 *  MotoMatch — Community (Discord-Stil, lokale Version)
 *  - Lokale Anmeldung (localStorage, kein Backend)
 *  - Server/Kanäle in einer Sidebar, Chat pro Kanal
 *  - Nutzer können eigene Kanäle erstellen und löschen
 *
 *  HINWEIS: Rein lokaler Prototyp. Konten/Nachrichten liegen nur im
 *  Browser (localStorage), Passwörter werden NICHT sicher gespeichert.
 *  Ein echtes Backend (z.B. Supabase) kommt später.
 * ══════════════════════════════════════════════════════════════════
 */

import commBg from '../assets/community-bg.jpeg'
import { esc } from './util.js'
import {
  joinVoiceRoom, leaveVoiceRoom, toggleVoiceMute, toggleVoiceDeafen,
  inVoiceRoom, currentRoomId, listAudioDevices, switchMicrophone, switchSpeaker,
} from './voice.js'
// Zentrale, plattformweite Authentifizierung (geteilt mit der Haupt-Website)
import { getSession, login, register, loginGuest, logout, ensureDemoUsers, renderGoogleButton, initSupabaseAuth } from './auth.js'
import { openAccount } from './account.js'
import { OFFLINE_MODE } from './supabase.js'
import {
  // Profil
  getProfile, getMyProfile, setMyProfile,
  // Freunde
  getFriends, removeFriendPair,
  // Freundschaftsanfragen
  getRequests, incomingRequests, outgoingRequests,
  sendFriendRequest, acceptRequest, declineRequest, cancelRequest,
  // Blockieren / Ignorieren
  getBlocked, isBlocked, isBlockedBy, toggleBlock,
  isIgnored, toggleIgnore,
  // Nutzer melden
  reportUser,
  // Gruppen
  getGroups, setGroups, createGroup, deleteGroup, updateGroup, toggleRsvp,
  joinGroup, leaveGroup, kickMember, banMember, unbanMember, toggleMod, isGroupBanned,
  createChannel, deleteChannel,
  // Gruppen-Anfragen
  getGroupRequests, groupRequestsFor, myGroupRequest,
  sendJoinRequest, acceptGroupRequest, declineGroupRequest,
  // Einladungen
  getInvites, createInvite, revokeInvite, redeemInvite, activeInvitesForGroup,
  // Nachrichten (Gruppen)
  sendGroupMessage, editMessageInGroup, deleteGroupMessage, toggleReactionInGroup,
  // Nachrichten (DMs)
  getDMs, sendDM, editMessageInDM, deleteDMMessage, toggleReactionInDM,
  // Ungelesen
  markUnread, clearUnread, unreadFrom,
  // Nachrichten-Meldungen
  getMsgReports, reportsForGroup, reportMessage, dismissReport,
  // Nutzer-Suche
  searchUsersApi, findUserApi, mutualGroupCount,
  // Seed (Offline)
  seedGroupsIfEmpty, seedFriendPairs,
  // Realtime
  subscribeToChannel, unsubscribeAll, onNewMessage, onFriendRequest,
} from './community-api.js'

/* ── Avatar-Farbpalette (wählbare Profilfarben) ──────────────────── */
const AVATAR_PALETTE = [
  'hsl(0 45% 42%)',   'hsl(30 45% 42%)',  'hsl(60 45% 42%)',
  'hsl(120 45% 42%)', 'hsl(170 45% 42%)', 'hsl(210 45% 42%)',
  'hsl(240 45% 42%)', 'hsl(270 45% 42%)', 'hsl(300 45% 42%)',
  'hsl(330 45% 42%)',
]

/* ── UI-Preference keys (bleiben in localStorage) ───────────────── */
const LS_READSTATE = 'mm_comm_readstate_v1'
const LS_MUTES     = 'mm_comm_mutes_v1'
const LS_PREFS     = 'mm_comm_prefs_v1'
const LS_DEMO_SEEDED = 'mm_comm_demoseeded_v1'

/* ── Storage helpers (nur für UI-Preferences) ──────────────────── */
function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
function write(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}
function me() { return getSession()?.username || '' }

/* ── Profil-Helfer (liest aus API-Cache) ────────────────────────── */
function avatarColor(username) {
  const p = getProfile(username)
  return p.avatarColor || colorFor(username)
}
function displayName(username) {
  return getProfile(username).displayName || username
}
/** Innerer Avatar-Inhalt: echtes Profilbild, falls vorhanden, sonst Initialen des Anzeigenamens. */
function avatarInner(username) {
  const img = getProfile(username).avatarImg
  return img ? `<img class="mmc-avatar-img" src="${esc(img)}" alt="">` : initials(displayName(username))
}

/* ── Demo-Accounts (nur Offline-Modus) ──────────────────────────── */
const DEMO_USERS = [
  { username: 'Markus B.', bio: 'Cruiser-Fan · Sonntagstouren im Schwarzwald 🏍' },
  { username: 'Lisa K.',   bio: 'Café Racer · fährt jedes Wochenende' },
  { username: 'Anna P.',   bio: 'Alpenpässe & lange Touren' },
  { username: 'Felix W.',  bio: 'Schrauber · baut gerade an seinem Umbau' },
  { username: 'Sandra H.', bio: 'Organisiert Stammtische & Events' },
]
function seedDemoFriends() {
  if (!OFFLINE_MODE) return  // Online: echte Nutzer aus Supabase
  const myName = me()
  if (!myName || myName === 'Gast') return
  const seeded = read(LS_DEMO_SEEDED, {})
  if (seeded[myName]) return
  ensureDemoUsers(DEMO_USERS)
  seedFriendPairs(myName, DEMO_USERS)
  seeded[myName] = true
  write(LS_DEMO_SEEDED, seeded)
}

/* ── Read-state (Kanäle + DMs) ──────────────────────────────────── */
function getReadState() { return (read(LS_READSTATE, {}))[me()] || {} }
function setReadState(state) {
  const all = read(LS_READSTATE, {})
  all[me()] = state
  write(LS_READSTATE, all)
}
function markChannelRead(groupId, channelId) {
  const state = getReadState()
  state[`${groupId}/${channelId}`] = Date.now()
  setReadState(state)
}
function markDMRead(username) {
  const state = getReadState()
  state[`dm/${username}`] = Date.now()
  setReadState(state)
}
/** Timestamp of the last read message for a group channel; 0 = never read */
function lastReadTs(groupId, channelId) {
  return getReadState()[`${groupId}/${channelId}`] || 0
}
function lastReadDMTs(username) {
  return getReadState()[`dm/${username}`] || 0
}
/** Count unread messages in a channel (not authored by me) */
function unreadCountChannel(g, channelId) {
  const myName = me()
  const ch = g.channels?.find(c => c.id === channelId)
  if (!ch) return 0
  const since = lastReadTs(g.id, channelId)
  return ch.messages.filter(m => m.ts > since && m.author.toLowerCase() !== myName.toLowerCase()).length
}
/** Total unread across all channels of a group */
function unreadCountGroup(g) {
  groupDefaults(g)
  return g.channels.reduce((sum, ch) => sum + unreadCountChannel(g, ch.id), 0)
}
/** Total unread DM messages from a peer */
function unreadCountDM(username) {
  const myName = me()
  const thread = (getDMs())[username] || []
  const since = lastReadDMTs(username)
  return thread.filter(m => m.ts > since && m.author.toLowerCase() !== myName.toLowerCase()).length
}

/* ── Mutes ──────────────────────────────────────────────────────── */
function getMutes() { return (read(LS_MUTES, {}))[me()] || {} }
function setMutes(mutes) {
  const all = read(LS_MUTES, {})
  all[me()] = mutes
  write(LS_MUTES, all)
}
function isMuted(key) {
  const mutes = getMutes()
  const val = mutes[key]
  if (!val) return false
  if (val === 'forever') return true
  return Date.now() < val
}
function setMute(key, untilTs) {
  const mutes = getMutes()
  mutes[key] = untilTs
  setMutes(mutes)
}
function removeMute(key) {
  const mutes = getMutes()
  delete mutes[key]
  setMutes(mutes)
}

/* ── Reaktionen — jetzt in community-api.js; UI-Helfer bleiben ──── */

function reactionPillsHtml(reactions, myName) {
  if (!reactions) return ''
  const entries = Object.entries(reactions).filter(([, u]) => u.length > 0)
  if (!entries.length) return ''
  return `<div class="mmc-reactions">${entries.map(([emoji, users]) => {
    const mine = users.includes(myName)
    return `<button class="mmc-reaction-pill${mine ? ' is-mine' : ''}" data-react-emoji="${esc(emoji)}" title="${esc(users.join(', '))}">${emoji} <span>${users.length}</span></button>`
  }).join('')}</div>`
}

function openReactPicker(root, box, anchorBtn, msgId, msgs, empty, groupCtx) {
  document.querySelector('.mmc-react-pop')?.remove()
  const pop = document.createElement('div')
  pop.className = 'mmc-react-pop'
  pop.innerHTML = REACTION_EMOJIS.map(em => `<button class="mmc-react-pop-btn" data-re="${em}" title="${em}">${em}</button>`).join('')
  document.body.appendChild(pop)
  const rect = anchorBtn.getBoundingClientRect()
  requestAnimationFrame(() => {
    pop.style.top  = (rect.top - pop.offsetHeight - 8) + 'px'
    pop.style.left = Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8) + 'px'
  })
  pop.querySelectorAll('[data-re]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation(); pop.remove()
    if (groupCtx) {
      await toggleReactionInGroup(groupCtx.id, msgId, b.dataset.re)
      const updated = getGroups().find(g => g.id === groupCtx.id)
      if (updated) { groupDefaults(updated); renderMessagesInto(root, box, channelMsgs(updated, activeChannel), empty, updated) }
    } else if (activeDM) {
      await toggleReactionInDM(activeDM, msgId, b.dataset.re)
      renderMessagesInto(root, box, getDMs()[activeDM] || [], empty, null)
    }
  }))
  const onDoc = ev => { if (!pop.contains(ev.target) && ev.target !== anchorBtn) { pop.remove(); document.removeEventListener('click', onDoc) } }
  setTimeout(() => document.addEventListener('click', onDoc), 0)
}

/* ── UI-Preferences (nur localStorage) ─────────────────────────── */
function getPrefs()  { return read(LS_PREFS, { muted: false, deafened: false, status: 'online' }) }
function setPrefs(p) { write(LS_PREFS, p) }

const STATUS_META = {
  online:    { label: 'Online',             color: '#6fbf73', desc: 'Sichtbar für alle als aktiv.' },
  idle:      { label: 'Abwesend',           color: '#e0b34c', desc: 'Zeigt anderen, dass du gerade nicht aktiv bist.' },
  dnd:       { label: 'Bitte nicht stören', color: '#e05555', desc: 'Du erhältst keine Desktop-Benachrichtigungen.' },
  invisible: { label: 'Unsichtbar',         color: '#8a8a8a', desc: 'Du erscheinst offline, kannst die Community aber weiter nutzen.' },
}
function statusMeta(s) { return STATUS_META[s] || STATUS_META.online }

function fmtExpiry(expiresAt) {
  if (!expiresAt) return 'Unbegrenzt'
  const ms = expiresAt - Date.now()
  if (ms <= 0) return 'Abgelaufen'
  const h = Math.floor(ms / 3600_000)
  if (h < 24) return `${h} Std.`
  return `${Math.floor(h / 24)} Tag(e)`
}

/* ── Rollen-Helfer ─────────────────────────────────────────────── */
function groupDefaults(g) {
  if (!g.joinMode)     g.joinMode     = 'open'
  if (!g.moderators)   g.moderators   = []
  if (!g.banned)       g.banned       = []
  // Migration: g.messages → channels[0]
  if (!g.channels || !g.channels.length) {
    g.channels = [{ id: 'c-allgemein', name: 'allgemein', messages: g.messages || [] }]
    g.messages = []
  }
  return g
}

/** Nachrichten eines Kanals holen (fällt auf ersten Kanal zurück). */
function channelMsgs(g, channelId) {
  groupDefaults(g)
  const ch = channelId ? g.channels.find(c => c.id === channelId) : g.channels[0]
  return ch ? ch.messages : []
}
function isOwner(g)   { return g.createdBy.toLowerCase() === me().toLowerCase() }
function isMod(g)     { return (g.moderators || []).some(m => m.toLowerCase() === me().toLowerCase()) }
function canManage(g) { return isOwner(g) || isMod(g) }

/* ── Kategorien (fest) ─────────────────────────────────────────── */
const CATEGORIES = [
  { id: 'touren',      name: 'Touren',         icon: 'route',   noun: 'Tour',        verbNew: 'Tour erstellen' },
  { id: 'events',      name: 'Events',         icon: 'flag',    noun: 'Event',       verbNew: 'Event erstellen' },
  { id: 'gruppen',     name: 'Gruppen',        icon: 'people',  noun: 'Gruppe',      verbNew: 'Gruppe erstellen' },
  { id: 'stammtische', name: 'Stammtische',    icon: 'cup',     noun: 'Stammtisch',  verbNew: 'Stammtisch erstellen' },
  { id: 'rennstrecke', name: 'Rennstrecke',    icon: 'flag',    noun: 'Track-Day',   verbNew: 'Track-Day erstellen' },
  { id: 'schrauber',   name: 'Schrauber-Treff',icon: 'wrench',  noun: 'Treffen',     verbNew: 'Treffen erstellen' },
  { id: 'forum',       name: 'Forum',          icon: 'chat',    noun: 'Thema',       verbNew: 'Thema erstellen' },
]
const catById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[0]

/* Kategorien, die Termin + Treffpunkt unterstützen */
const EVENT_CATS = new Set(['touren', 'events', 'stammtische', 'rennstrecke'])

function fmtEvent(g) {
  if (!g.eventAt) return null
  const d = new Date(g.eventAt)
  const now = Date.now()
  const past = g.eventAt < now
  let dateStr = d.toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .replace(',', '.').replace(/(\d\d\.\d\d\.)(\s)(\d\d:\d\d)/, '$1, $3')
  if (d.getFullYear() !== new Date().getFullYear()) {
    dateStr = dateStr.replace(/(\d\d\.\d\d\.)/, `$1${d.getFullYear()}.`)
  }
  const place = g.meetingPoint ? ` · ${g.meetingPoint}` : ''
  return { text: dateStr + place, past }
}

/* ── Seed defaults (nur Offline-Modus) ──────────────────────────── */
function seedDefaults() {
  if (!OFFLINE_MODE) return  // Online: Daten kommen aus Supabase
  const t = Date.now()
  const g = (category, name, desc, createdBy, members, msgs = [], vr = []) => ({
    id: 'g-' + Math.random().toString(36).slice(2, 9),
    category, name, desc, createdBy, members,
    joinMode: 'open', moderators: [], banned: [],
    createdAt: t - Math.floor(Math.random() * 6) * 86400_000,
    channels: [{
      id: 'c-' + Math.random().toString(36).slice(2, 9), name: 'allgemein',
      messages: msgs.map((m, i) => ({ id: 'sm-' + i, author: m[0], text: m[1], ts: t - (msgs.length - i) * 3600_000 })),
    }],
    voiceRooms: vr.map((v, i) => ({ id: 'vr-' + i + '-' + Math.random().toString(36).slice(2, 6), title: v[0], members: v[1], capacity: v[2] || 4 })),
    messages: [],
  })
  seedGroupsIfEmpty([
    g('touren', 'Schwarzwald Sonntagstour', 'Kurvige Strecken & Kaffeestopp am Aussichtspunkt.', 'Markus B.', ['Markus B.', 'Lisa K.', 'Thomas S.'],
      [['Markus B.', 'Treffpunkt Sonntag 9 Uhr an der Tankstelle!'], ['Lisa K.', 'Bin dabei 🏍']],
      [['Routenplanung', ['Markus B.', 'Lisa K.'], 4], ['Smalltalk', ['Thomas S.', 'Anna P.', 'Felix W.', 'Sandra H.'], 4]]),
    g('touren', 'Alpen-Wochenende', 'Zwei Tage Passstraßen — Übernachtung inklusive.', 'Anna P.', ['Anna P.', 'Felix W.']),
    g('events', 'MotoMatch Bike-Night', 'Abendtreffen mit Foodtrucks und Live-Musik.', 'Sandra H.', ['Sandra H.', 'Markus B.', 'Du?'],
      [['Sandra H.', 'Wer bringt Verstärkung mit?']]),
    g('gruppen', 'Café Racer Freunde', 'Alles rund um Umbauten & Style.', 'Felix W.', ['Felix W.', 'Thomas S.']),
    g('stammtische', 'Stammtisch München', 'Jeden ersten Freitag im Monat.', 'Thomas S.', ['Thomas S.', 'Lisa K.', 'Anna P.']),
    g('schrauber', 'Winter-Schrauben', 'Gemeinsam basteln, wenn es draußen kalt ist.', 'Markus B.', ['Markus B.']),
    g('forum', 'Welcher Reifen für Nässe?', 'Empfehlungen für Regenreifen gesucht.', 'Lisa K.', ['Lisa K.', 'Felix W.'],
      [['Lisa K.', 'Fahre aktuell Michelin — Tipps?']]),
  ])
}

/* ── Utils ─────────────────────────────────────────────────────── */
function initials(name = '') {
  const p = name.trim().split(/\s+/)
  return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase() || name.slice(0, 2).toUpperCase()
}
function colorFor(str = '') {
  let h = 0
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h)
  return `hsl(${Math.abs(h) % 360} 45% 42%)`
}
function slug(name) {
  return name.toLowerCase().trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 24) || 'kanal'
}
function fmtTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const t = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `Heute um ${t}`
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return `Gestern um ${t}`
  return `${d.toLocaleDateString('de-DE')} ${t}`
}
function fmtDateSep(ts) {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return 'Heute'
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return 'Gestern'
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
}
function fmtTimeShort(ts) {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}
function renderText(text) {
  const urlRe = /https?:\/\/[^\s<>"']+/g
  let result = '', last = 0, match
  while ((match = urlRe.exec(text)) !== null) {
    result += esc(text.slice(last, match.index)).replace(/\n/g, '<br>')
    const url = match[0]
    result += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="mmc-link">${esc(url)}</a>`
    last = match.index + url.length
  }
  result += esc(text.slice(last)).replace(/\n/g, '<br>')
  return result
}

/* Decorative QR-style graphic (not a scannable code — placeholder for app login) */
function qrSvg() {
  const N = 25, cell = 6, pad = 8, size = N * cell + pad * 2
  const rects = []
  const isFinder = (r, c) => {
    const inBox = (br, bc) => r >= br && r < br + 7 && c >= bc && c < bc + 7
    return inBox(0, 0) || inBox(0, N - 7) || inBox(N - 7, 0)
  }
  // deterministic pseudo-random modules
  let seed = 1337
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (isFinder(r, c)) continue
      // keep a clear center square for the logo
      if (r >= 10 && r <= 14 && c >= 10 && c <= 14) continue
      if (rnd() > 0.52) {
        rects.push(`<rect x="${pad + c * cell}" y="${pad + r * cell}" width="${cell}" height="${cell}"/>`)
      }
    }
  }
  // three finder patterns
  const finder = (x, y) => `
    <rect x="${pad + x * cell}" y="${pad + y * cell}" width="${cell * 7}" height="${cell * 7}" rx="3"/>
    <rect x="${pad + (x + 1) * cell}" y="${pad + (y + 1) * cell}" width="${cell * 5}" height="${cell * 5}" rx="2" fill="#fff"/>
    <rect x="${pad + (x + 2) * cell}" y="${pad + (y + 2) * cell}" width="${cell * 3}" height="${cell * 3}" rx="1.5"/>`
  return `
    <div class="mmc-qr-box">
      <svg width="150" height="150" viewBox="0 0 ${size} ${size}" fill="#111">
        <g>${rects.join('')}</g>
        ${finder(0, 0)}${finder(N - 7, 0)}${finder(0, N - 7)}
        <circle cx="${size / 2}" cy="${size / 2}" r="${cell * 3}" fill="#111"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${cell * 2.2}" fill="#fff"/>
        <text x="${size / 2}" y="${size / 2 + 5}" text-anchor="middle" font-size="${cell * 3}" font-weight="900" fill="#111" font-family="Arial, sans-serif">◆</text>
      </svg>
    </div>`
}

/* ══════════════════════════════════════════════════════════════════
   PUBLIC ENTRY
   ══════════════════════════════════════════════════════════════════ */
export async function mountCommunity(root) {
  if (!root) return

  // Supabase-Auth initialisieren (setzt Session-Cache + lädt Community-Daten)
  const session = await initSupabaseAuth()

  seedDefaults()  // Offline: Demo-Daten wenn leer; Online: no-op

  // Realtime-Callbacks für community.js anmelden
  onNewMessage((msg, channelId, dmUsers) => {
    // Neue Nachricht direkt anhängen, wenn der betreffende Chat gerade offen ist
    if (channelId && activeGroup && activeChannel === channelId) {
      _appendMessageToGroupChat(root, msg)
    } else if (dmUsers && activeDM) {
      // Prüfe ob dieser DM aktiv ist: activeDM muss einer der beiden Benutzer sein
      const isThisDM = (activeDM.toLowerCase() === dmUsers.user1.toLowerCase()) ||
                       (activeDM.toLowerCase() === dmUsers.user2.toLowerCase())
      if (isThisDM) {
        _appendMessageToDMChat(root, msg)
      }
    }
    // Ungelesen-Badges aktualisieren
    if (typeof refreshFriendsChrome === 'function') refreshFriendsChrome(root)
  })

  onFriendRequest(() => refreshFriendsChrome(root))

  if (session) renderApp(root)
  else renderAuth(root)
}

/* ══════════════════════════════════════════════════════════════════
   AUTH SCREEN
   ══════════════════════════════════════════════════════════════════ */
function renderAuth(root, mode = 'login', error = '') {
  const isLogin = mode === 'login'
  root.innerHTML = `
    <div class="mmc-auth" style="background-image:url('${commBg}')">
      <div class="mmc-auth-overlay"></div>
      <div class="mmc-auth-card">
        <!-- Left: form -->
        <div class="mmc-auth-main">
          <h2 class="mmc-auth-title">${isLogin ? 'Willkommen zurück!' : 'Konto erstellen'}</h2>
          <p class="mmc-auth-sub">${isLogin ? 'Schön, dich in der MotoMatch-Community zu sehen!' : 'Wähle einen Namen und ein Passwort.'}</p>

          <div class="mmc-social-row">
            <div id="mmc-google-btn" class="mmc-social-google-slot"></div>
          </div>
          <div class="mmc-social-divider"><span>oder</span></div>

          <form class="mmc-auth-form" id="mmc-auth-form" autocomplete="off">
            <label class="mmc-field">
              <span class="mmc-field-label">${isLogin ? 'Benutzername oder E-Mail' : 'Benutzername'} <span class="mmc-req">*</span></span>
              <input class="mmc-input" id="mmc-username" type="text" maxlength="60" placeholder="${isLogin ? 'z. B. RiderMax oder du@mail.de' : 'z. B. RiderMax'}" required>
            </label>
            ${isLogin ? '' : `
            <label class="mmc-field">
              <span class="mmc-field-label">E-Mail <span class="mmc-req">*</span></span>
              <input class="mmc-input" id="mmc-email" type="email" placeholder="du@mail.de" required>
            </label>`}
            <label class="mmc-field">
              <span class="mmc-field-label">Passwort <span class="mmc-req">*</span></span>
              <input class="mmc-input" id="mmc-password" type="password" minlength="4" placeholder="••••••••" required>
            </label>
            ${isLogin ? '' : `
            <label class="mmc-field">
              <span class="mmc-field-label">Passwort bestätigen <span class="mmc-req">*</span></span>
              <input class="mmc-input" id="mmc-password2" type="password" minlength="4" placeholder="••••••••" required>
            </label>
            <div class="mmc-field-row">
              <label class="mmc-field">
                <span class="mmc-field-label">Alter</span>
                <input class="mmc-input" id="mmc-age" type="number" min="14" max="99" placeholder="z. B. 28">
              </label>
              <label class="mmc-field">
                <span class="mmc-field-label">Führerschein</span>
                <select class="mmc-input" id="mmc-license">
                  <option value="">Keine Angabe</option>
                  <option value="A1">A1 — max. 125cc</option>
                  <option value="A2">A2 — max. 35kW</option>
                  <option value="A">A — Unbegrenzt</option>
                  <option value="B196">B196 — 125cc ab 25</option>
                </select>
              </label>
            </div>`}
            ${isLogin ? '<button type="button" class="mmc-forgot" id="mmc-forgot">Passwort vergessen?</button>' : ''}
            <div class="mmc-auth-error" id="mmc-auth-error" ${error ? '' : 'hidden'}>${esc(error)}</div>
            <button class="mmc-auth-submit" type="submit">${isLogin ? 'Anmelden' : 'Registrieren'}</button>
          </form>

          <p class="mmc-auth-switch">
            ${isLogin ? 'Brauchst du einen Account?' : 'Bereits registriert?'}
            <button type="button" class="mmc-auth-toggle" id="mmc-auth-toggle">${isLogin ? 'Registrieren' : 'Anmelden'}</button>
          </p>
        </div>

        <!-- Right: QR panel -->
        <div class="mmc-auth-qr">
          <button type="button" class="mmc-skip" id="mmc-skip" title="Login überspringen (nur Entwicklung)">Überspringen →</button>
          ${qrSvg()}
          <h3 class="mmc-qr-title">Mit QR-Code einloggen</h3>
          <p class="mmc-qr-text">App-Login kommt bald. Bis dahin: melde dich links mit deinem Benutzernamen an.</p>
        </div>
      </div>
      <div class="mmc-auth-brand"><span class="mmc-auth-logo">◆</span> MotoMatch Community</div>
    </div>
  `

  root.querySelector('#mmc-forgot')?.addEventListener('click', () => {
    renderAuth(root, mode, 'Lokaler Prototyp — Passwort-Zurücksetzen kommt mit dem echten Login.')
  })

  renderGoogleButton(root.querySelector('#mmc-google-btn'), () => {
    resetNavState(); seedDemoFriends(); renderApp(root)
  })

  // Gast-Login (Offline-Lese-Modus)
  root.querySelector('#mmc-skip')?.addEventListener('click', async () => {
    if (!OFFLINE_MODE) {
      toast(root, 'Gast-Modus: Nur Lesen möglich. Bitte melde dich an, um zu schreiben.')
    }
    await loginGuest()
    resetNavState()
    seedDemoFriends()
    renderApp(root)
  })

  root.querySelector('#mmc-auth-toggle')?.addEventListener('click', () => {
    renderAuth(root, isLogin ? 'register' : 'login')
  })

  root.querySelector('#mmc-auth-form')?.addEventListener('submit', async e => {
    e.preventDefault()
    const username = root.querySelector('#mmc-username').value
    const password = root.querySelector('#mmc-password').value
    const showErr  = msg => renderAuth(root, mode, msg)

    if (isLogin) {
      const res = await login(username, password)
      if (!res.ok) return showErr(res.error)
      resetNavState(); seedDemoFriends(); renderApp(root)
    } else {
      const res = await register({
        username, password,
        password2: root.querySelector('#mmc-password2')?.value,
        email:     root.querySelector('#mmc-email')?.value,
        age:       root.querySelector('#mmc-age')?.value,
        license:   root.querySelector('#mmc-license')?.value,
      })
      if (!res.ok) return showErr(res.error)
      resetNavState(); seedDemoFriends(); renderApp(root)
    }
  })

  // Autofocus
  requestAnimationFrame(() => root.querySelector('#mmc-username')?.focus())
}

/* ══════════════════════════════════════════════════════════════════
   MAIN APP (Discord-Stil)
   ══════════════════════════════════════════════════════════════════ */
let homeSection = 'friends'  // 'friends' | 'requests'
let friendsTab = 'add'       // 'all' | 'pending' | 'add'
let activeDM = null          // friend name when a DM conversation is open
let serverCategory = 'touren'// active category in the MotoMatch server
let activeGroup = null       // group id when a group chat is open
let activeChannel = null     // channel id within activeGroup
let friendsMode = false      // true → Freunde-Seite statt Kategorie-Übersicht
let replyingTo = null        // { id, author, text } der Nachricht, auf die geantwortet wird

/** Navigations-Zustand auf Standard zurücksetzen — wichtig beim Konto-Wechsel
 *  (Login/Logout) im selben Tab, damit der neue Nutzer nicht in der Navigation
 *  landet, wo der vorherige Nutzer aufgehört hat. */
function resetNavState() {
  homeSection = 'friends'; friendsTab = 'all'; activeDM = null
  serverCategory = 'touren'; activeGroup = null; activeChannel = null; friendsMode = false
  replyingTo = null
}

/* ── SVG icon shorthands ───────────────────────────────────────── */
const ICON = {
  home:    '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M19 4H5a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3ZM9 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm7-1h-3v-1c0-1.1.9-2 2-2h1a1 1 0 0 1 0 2v.5a.5.5 0 0 1-.5.5H16Z"/></svg>',
  compass: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z" fill="currentColor" stroke="none"/></svg>',
  plus:    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  people:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  mic:     '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>',
  head:    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>',
  gear:    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  logout:  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
  send:    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',
  route:   '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/></svg>',
  flag:    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22V4"/></svg>',
  wrench:  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  cup:     '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6 2v2M10 2v2M14 2v2"/></svg>',
  chat:    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  back:    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>',
  users:   '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>',
  attach:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  smiley:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
  mail:    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/></svg>',
  chevdn:  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  shield:  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  crown:   '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M2 19h20l-2-9-5 4-3-7-3 7-5-4z"/></svg>',
  lock:    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  unlock:  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>',
  ban:     '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M4.9 4.9l14.2 14.2"/></svg>',
  manage:  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  clipboard:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  link:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  door:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
  belloff: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  bell:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  reply:   '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></svg>',
  pencil:  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
  trash:   '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>',
  report:  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
  undo:    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.62"/></svg>',
  react:   '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/><path d="M17 8h1.5"/></svg>',
  calendar:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  mappin:  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
}

/* ── Realtime-Re-Render-Helfer ──────────────────────────────────── */
let _rootRef = null  // wird in renderApp gesetzt
function _refreshGroupChat(root) {
  const box  = (root || _rootRef)?.querySelector('#mmc-chat-box')
  const empt = (root || _rootRef)?.querySelector('#mmc-chat-empty')
  if (!box || !activeGroup) return
  const g = getGroups().find(x => x.id === activeGroup)
  if (g) { groupDefaults(g); renderMessagesInto(root || _rootRef, box, channelMsgs(g, activeChannel), empt, g) }
}
function _refreshDMChat(root) {
  const box  = (root || _rootRef)?.querySelector('#mmc-chat-box')
  const empt = (root || _rootRef)?.querySelector('#mmc-chat-empty')
  if (!box || !activeDM) return
  renderMessagesInto(root || _rootRef, box, getDMs()[activeDM] || [], empt, null)
}

/** Neue Nachricht direkt an den Gruppen-Chat anhängen (ohne komplette Neurendition) */
function _appendMessageToGroupChat(root, msg) {
  const box = (root || _rootRef)?.querySelector('#mmc-chat-box')
  if (!box || !activeGroup) return
  const g = getGroups().find(x => x.id === activeGroup)
  if (!g) return
  groupDefaults(g)

  const myName = me()
  const clickable = !msg.system && msg.author.toLowerCase() !== myName.toLowerCase()
  const isOwn = !msg.system && msg.author.toLowerCase() === myName.toLowerCase()
  const del = !msg.system && (msg.author.toLowerCase() === myName.toLowerCase() || canManage(g))

  const actions = !msg.system ? `
    <div class="mmc-msg-actions">
      <button class="mmc-msg-act mmc-msg-act--react" data-react-open="${esc(msg.id)}" title="Reaktion hinzufügen">${ICON.react}</button>
      ${!isOwn ? `<button class="mmc-msg-act mmc-msg-act--reply" data-reply-msg="${esc(msg.id)}" data-reply-author="${esc(msg.author)}" data-reply-text="${esc(msg.text)}" title="Antworten">${ICON.reply}</button>` : ''}
      ${isOwn ? `<button class="mmc-msg-act mmc-msg-act--edit" data-edit-msg="${esc(msg.id)}" title="Bearbeiten">${ICON.pencil}</button>` : ''}
      ${del ? `<button class="mmc-msg-act mmc-msg-act--del" data-del-msg="${esc(msg.id)}" title="Nachricht löschen">${ICON.trash}</button>` : ''}
    </div>` : ''

  const pills = reactionPillsHtml(msg.reactions, myName)
  const imgHtml = msg.image ? `<img class="mmc-msg-image" src="${esc(msg.image)}" alt="Anhang" loading="lazy" data-img-src="${esc(msg.image)}">` : ''
  const replyQuote = msg.replyTo ? `
    <div class="mmc-reply-quote" data-reply-to="${esc(msg.replyTo.id)}">
      <span class="mmc-reply-quote-author">${esc(displayName(msg.replyTo.author))}</span>
      <span class="mmc-reply-quote-text">${esc((msg.replyTo.text || '').slice(0, 80))}${(msg.replyTo.text || '').length > 80 ? '…' : ''}</span>
    </div>` : ''

  const msgHtml = `
    <div class="mmc-msg${msg.system ? ' mmc-msg--system' : ''}" data-msg-id="${esc(msg.id)}">
      <div class="mmc-avatar mmc-avatar--sm ${clickable ? 'mmc-avatar--clickable' : ''}" ${clickable ? `data-user="${esc(msg.author)}"` : ''} style="background:${avatarColor(msg.author)}">${avatarInner(msg.author)}</div>
      <div class="mmc-msg-body">
        <div class="mmc-msg-head">
          <span class="mmc-msg-author${clickable ? ' mmc-msg-author--clickable' : ''}" ${clickable ? `data-user="${esc(msg.author)}"` : ''}>${esc(displayName(msg.author))}</span>
          <span class="mmc-msg-time">${fmtTime(msg.ts)}</span>
        </div>
        ${replyQuote}
        <div class="mmc-msg-text">${renderText(msg.text)}</div>
        ${imgHtml}
        ${pills}
      </div>
      ${actions}
    </div>`

  box.insertAdjacentHTML('beforeend', msgHtml)

  // Event-Listener für die neue Nachricht binden
  const newMsgEl = box.querySelector(`[data-msg-id="${msg.id}"]`)
  if (newMsgEl) {
    newMsgEl.querySelector('[data-user]')?.addEventListener('click', e => {
      e.stopPropagation(); openUserProfile(root || _rootRef, newMsgEl.querySelector('[data-user]').dataset.user)
    })
    newMsgEl.querySelector('[data-img-src]')?.addEventListener('click', function() {
      const ov = document.createElement('div')
      ov.className = 'mmc-img-lightbox'
      ov.innerHTML = `<div class="mmc-img-lightbox-backdrop"></div><img class="mmc-img-lightbox-img" src="${esc(this.dataset.imgSrc)}" alt="">`
      document.body.appendChild(ov)
      requestAnimationFrame(() => ov.classList.add('is-open'))
      const close = () => { ov.classList.remove('is-open'); setTimeout(() => ov.remove(), 200) }
      ov.querySelector('.mmc-img-lightbox-backdrop').addEventListener('click', close)
      ov.querySelector('.mmc-img-lightbox-img').addEventListener('click', e => e.stopPropagation())
      document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey) } })
    })
    newMsgEl.querySelector('[data-react-open]')?.addEventListener('click', e => {
      e.stopPropagation()
      const msgs = channelMsgs(g, activeChannel)
      const empty = { title: g.channels?.find(c => c.id === activeChannel)?.name || '', text: '', avatar: g.name, hash: true }
      openReactPicker(root || _rootRef, box, e.currentTarget, e.currentTarget.dataset.reactOpen, msgs, empty, g)
    })
    newMsgEl.querySelector('[data-del-msg]')?.addEventListener('click', async e => {
      e.stopPropagation()
      await deleteGroupMessage(g.id, msg.id)
      const updated = getGroups().find(x => x.id === g.id)
      if (updated) { groupDefaults(updated); renderMessagesInto(root || _rootRef, box, channelMsgs(updated, activeChannel), empty, updated) }
    })
    newMsgEl.querySelector('[data-reply-msg]')?.addEventListener('click', e => {
      e.stopPropagation()
      replyingTo = { id: msg.id, author: msg.author, text: msg.text }
      const replyBar = box.parentElement?.querySelector('#mmc-reply-bar')
      if (replyBar) {
        replyBar.hidden = false
        replyBar.innerHTML = `
          <div class="mmc-reply-bar-inner">
            <span class="mmc-reply-bar-icon">↩</span>
            <div class="mmc-reply-bar-text">Antwort an <strong>${esc(displayName(msg.author))}</strong>: <em>${esc(msg.text.slice(0, 60))}${msg.text.length > 60 ? '…' : ''}</em></div>
            <button class="mmc-reply-bar-close" id="mmc-reply-cancel" title="Abbrechen">✕</button>
          </div>`
        replyBar.querySelector('#mmc-reply-cancel')?.addEventListener('click', () => {
          replyingTo = null; replyBar.hidden = true; replyBar.innerHTML = ''
        })
      }
      box.parentElement?.querySelector('#mmc-compose-input')?.focus()
    })
  }

  // Automatisch nach unten scrollen
  box.scrollTop = box.scrollHeight
}

/** Neue Nachricht direkt an den DM-Chat anhängen (ohne komplette Neurendition) */
function _appendMessageToDMChat(root, msg) {
  const box = (root || _rootRef)?.querySelector('#mmc-chat-box')
  if (!box || !activeDM) return

  const myName = me()
  const clickable = !msg.system && msg.author.toLowerCase() !== myName.toLowerCase()
  const isOwn = !msg.system && msg.author.toLowerCase() === myName.toLowerCase()

  const actions = !msg.system ? `
    <div class="mmc-msg-actions">
      <button class="mmc-msg-act mmc-msg-act--react" data-react-open="${esc(msg.id)}" title="Reaktion hinzufügen">${ICON.react}</button>
      ${!isOwn ? `<button class="mmc-msg-act mmc-msg-act--reply" data-reply-msg="${esc(msg.id)}" data-reply-author="${esc(msg.author)}" data-reply-text="${esc(msg.text)}" title="Antworten">${ICON.reply}</button>` : ''}
      ${isOwn ? `<button class="mmc-msg-act mmc-msg-act--edit" data-edit-msg="${esc(msg.id)}" title="Bearbeiten">${ICON.pencil}</button>` : ''}
      ${isOwn ? `<button class="mmc-msg-act mmc-msg-act--del" data-del-msg="${esc(msg.id)}" title="Nachricht löschen">${ICON.trash}</button>` : ''}
    </div>` : ''

  const pills = reactionPillsHtml(msg.reactions, myName)
  const imgHtml = msg.image ? `<img class="mmc-msg-image" src="${esc(msg.image)}" alt="Anhang" loading="lazy" data-img-src="${esc(msg.image)}">` : ''

  const msgHtml = `
    <div class="mmc-msg${msg.system ? ' mmc-msg--system' : ''}" data-msg-id="${esc(msg.id)}">
      <div class="mmc-avatar mmc-avatar--sm ${clickable ? 'mmc-avatar--clickable' : ''}" ${clickable ? `data-user="${esc(msg.author)}"` : ''} style="background:${avatarColor(msg.author)}">${avatarInner(msg.author)}</div>
      <div class="mmc-msg-body">
        <div class="mmc-msg-head">
          <span class="mmc-msg-author${clickable ? ' mmc-msg-author--clickable' : ''}" ${clickable ? `data-user="${esc(msg.author)}"` : ''}>${esc(displayName(msg.author))}</span>
          <span class="mmc-msg-time">${fmtTime(msg.ts)}</span>
        </div>
        <div class="mmc-msg-text">${renderText(msg.text)}</div>
        ${imgHtml}
        ${pills}
      </div>
      ${actions}
    </div>`

  box.insertAdjacentHTML('beforeend', msgHtml)

  // Event-Listener für die neue Nachricht binden
  const newMsgEl = box.querySelector(`[data-msg-id="${msg.id}"]`)
  if (newMsgEl) {
    newMsgEl.querySelector('[data-user]')?.addEventListener('click', e => {
      e.stopPropagation(); openUserProfile(root || _rootRef, newMsgEl.querySelector('[data-user]').dataset.user)
    })
    newMsgEl.querySelector('[data-img-src]')?.addEventListener('click', function() {
      const ov = document.createElement('div')
      ov.className = 'mmc-img-lightbox'
      ov.innerHTML = `<div class="mmc-img-lightbox-backdrop"></div><img class="mmc-img-lightbox-img" src="${esc(this.dataset.imgSrc)}" alt="">`
      document.body.appendChild(ov)
      requestAnimationFrame(() => ov.classList.add('is-open'))
      const close = () => { ov.classList.remove('is-open'); setTimeout(() => ov.remove(), 200) }
      ov.querySelector('.mmc-img-lightbox-backdrop').addEventListener('click', close)
      ov.querySelector('.mmc-img-lightbox-img').addEventListener('click', e => e.stopPropagation())
      document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey) } })
    })
    newMsgEl.querySelector('[data-del-msg]')?.addEventListener('click', e => {
      e.stopPropagation()
      const msgId = msg.id
      openConfirmModal(root || _rootRef, {
        title: 'Nachricht löschen?',
        text: 'Diese Aktion kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        isDanger: true,
        onConfirm: async () => {
          await deleteDMMessage(activeDM, msgId)
          renderMessagesInto(root || _rootRef, box, getDMs()[activeDM] || [], { title: displayName(activeDM), text: '', avatar: activeDM }, null)
        },
      })
    })
  }

  // Automatisch nach unten scrollen
  box.scrollTop = box.scrollHeight
}

/* Shared compose bar: attachment (left) + input + emoji (right of input) + send */
const COMPOSE_EMOJIS   = ['🏍️', '🔥', '😂', '👍', '❤️', '🎉', '😎', '🙌', '🛠️', '🏁', '☕', '🌄']
const REACTION_EMOJIS  = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🏍️', '👋']
function composeHtml(placeholder) {
  return `
    <div class="mmc-compose">
      <div class="mmc-reply-bar" id="mmc-reply-bar" hidden></div>
      <div class="mmc-attach-preview" id="mmc-attach-preview" hidden>
        <img class="mmc-attach-thumb" id="mmc-attach-thumb" src="" alt="">
        <div class="mmc-attach-info">
          <div class="mmc-attach-name" id="mmc-attach-name"></div>
          <div class="mmc-attach-size" id="mmc-attach-size"></div>
        </div>
        <button type="button" class="mmc-attach-rm" id="mmc-attach-rm" title="Anhang entfernen" aria-label="Anhang entfernen">✕</button>
      </div>
      <form class="mmc-compose-form" id="mmc-compose-form">
        <input type="file" id="mmc-file-input" accept="image/*" style="display:none" aria-hidden="true" tabindex="-1">
        <button type="button" class="mmc-compose-ic" id="mmc-attach" title="Bild anhängen" aria-label="Bild anhängen">${ICON.attach}</button>
        <textarea class="mmc-compose-input" id="mmc-compose-input" rows="1" placeholder="${placeholder}" autocomplete="off"></textarea>
        <button type="button" class="mmc-compose-ic mmc-emoji" id="mmc-emoji" title="Emoji" aria-label="Emoji">${ICON.smiley}</button>
        <button class="mmc-send" type="submit" aria-label="Senden">${ICON.send}</button>
      </form>
    </div>`
}
function bindComposeExtras(scope, root) {
  const fileInput  = scope.querySelector('#mmc-file-input')
  const preview    = scope.querySelector('#mmc-attach-preview')
  const thumb      = scope.querySelector('#mmc-attach-thumb')
  const nameEl     = scope.querySelector('#mmc-attach-name')
  const sizeEl     = scope.querySelector('#mmc-attach-size')
  const form       = scope.querySelector('#mmc-compose-form')
  const MAX_BYTES  = 2 * 1024 * 1024

  const clearAttach = () => {
    if (form) form._pendingAttachment = null
    if (fileInput) fileInput.value = ''
    if (preview) preview.hidden = true
    if (thumb) thumb.src = ''
  }
  if (form) form._clearAttach = clearAttach

  scope.querySelector('#mmc-attach')?.addEventListener('click', () => fileInput?.click())
  scope.querySelector('#mmc-attach-rm')?.addEventListener('click', clearAttach)

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0]; if (!file) return
    if (file.size > MAX_BYTES) { toast(root, 'Bild zu groß (max. 2 MB).'); fileInput.value = ''; return }
    const reader = new FileReader()
    reader.onload = e => {
      if (form) form._pendingAttachment = e.target.result
      if (thumb) thumb.src = e.target.result
      if (nameEl) nameEl.textContent = file.name
      if (sizeEl) sizeEl.textContent = (file.size / 1024).toFixed(0) + ' KB'
      if (preview) preview.hidden = false
    }
    reader.readAsDataURL(file)
  })

  // Auto-resize textarea
  const textarea = scope.querySelector('#mmc-compose-input')
  if (textarea) {
    const resize = () => {
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, 130) + 'px'
    }
    textarea.addEventListener('input', resize)

    // Enter = senden, Shift+Enter = Zeilenumbruch
    textarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        scope.querySelector('#mmc-compose-form')?.requestSubmit()
        requestAnimationFrame(resize)
      }
    })
  }

  scope.querySelector('#mmc-emoji')?.addEventListener('click', e => {
    e.stopPropagation()
    const compose = scope.querySelector('.mmc-compose')
    const existing = compose.querySelector('.mmc-emoji-pop')
    if (existing) { existing.remove(); return }
    const pop = document.createElement('div')
    pop.className = 'mmc-emoji-pop'
    pop.innerHTML = COMPOSE_EMOJIS.map(em => `<button type="button" class="mmc-emoji-item">${em}</button>`).join('')
    compose.appendChild(pop)
    pop.querySelectorAll('.mmc-emoji-item').forEach(b => b.addEventListener('click', () => {
      const ta = scope.querySelector('#mmc-compose-input')
      const start = ta.selectionStart, end = ta.selectionEnd
      ta.value = ta.value.slice(0, start) + b.textContent + ta.value.slice(end)
      ta.selectionStart = ta.selectionEnd = start + b.textContent.length
      ta.focus(); ta.dispatchEvent(new Event('input')); pop.remove()
    }))
    const onDoc = ev => { if (!pop.contains(ev.target) && ev.target.id !== 'mmc-emoji') { pop.remove(); document.removeEventListener('click', onDoc) } }
    setTimeout(() => document.addEventListener('click', onDoc), 0)
  })
}

function userbarHtml(session, prefs) {
  const st = statusMeta(prefs.status)
  const prof = getMyProfile()
  const dname = prof.displayName || session.username
  const subline = prof.statusText || st.label
  const presenceColor = prefs.status === 'invisible' ? '#8a8a8a' : st.color
  return `
    <div class="mmc-userbar">
      <button class="mmc-user-id" id="mmc-user-id" title="Benutzermenü">
        <div class="mmc-avatar" style="background:${avatarColor(session.username)}">${avatarInner(session.username)}<span class="mmc-presence" style="background:${presenceColor}"></span></div>
        <div class="mmc-user-meta">
          <div class="mmc-user-name">${esc(dname)}</div>
          <div class="mmc-user-status">${esc(subline)}</div>
        </div>
      </button>
      <div class="mmc-user-ctrls">
        <div class="mmc-uc-group">
          <button class="mmc-uc ${prefs.muted ? 'is-off' : ''}" id="mmc-mic" title="${prefs.muted ? 'Stummschaltung aufheben' : 'Stummschalten'}">${ICON.mic}</button>
          <button class="mmc-uc mmc-uc-chev" id="mmc-mic-chev" title="Eingabegerät">${ICON.chevdn}</button>
        </div>
        <div class="mmc-uc-group">
          <button class="mmc-uc ${prefs.deafened ? 'is-off' : ''}" id="mmc-deaf" title="${prefs.deafened ? 'Ton aktivieren' : 'Ton deaktivieren'}">${ICON.head}</button>
          <button class="mmc-uc mmc-uc-chev" id="mmc-deaf-chev" title="Ausgabegerät">${ICON.chevdn}</button>
        </div>
        <button class="mmc-uc" id="mmc-settings" title="Einstellungen">${ICON.gear}</button>
      </div>
    </div>`
}

function renderApp(root) {
  _rootRef = root
  const session = getSession()
  const prefs = getPrefs()
  if (activeGroup && !getGroups().find(g => g.id === activeGroup)) activeGroup = null

  if (activeGroup) {
    // In einer Gruppe: 3 Spalten (Kategorie-Icons | Talks+Kanal | Chat)
    root.innerHTML = `
      <div class="mmc mmc--ingroup">
        <nav class="mmc-catrail" id="mmc-catrail"></nav>
        <div class="mmc-col2">
          <div class="mmc-col2-body" id="mmc-col2-body"></div>
          ${userbarHtml(session, prefs)}
        </div>
        <main class="mmc-main" id="mmc-main"></main>
      </div>`
    fillCatRail(root)
    fillGroupChannels(root)
    renderGroupChatMain(root)
  } else if (friendsMode) {
    // Freunde-Seite: Icon-Leiste | Home-Spalte (Freunde/Nachrichten/DMs) | Inhalt | Jetzt aktiv
    root.innerHTML = `
      <div class="mmc mmc--friends">
        <nav class="mmc-catrail" id="mmc-friends-rail"></nav>
        <div class="mmc-col2">
          <div class="mmc-col2-body" id="mmc-home-body"></div>
          ${userbarHtml(session, prefs)}
        </div>
        <main class="mmc-main" id="mmc-main"></main>
        <aside class="mmc-active" id="mmc-active"></aside>
      </div>`
    fillFriendsRail(root)
    fillHomeColumn(root)
    fillMain(root)
    fillActive(root)
  } else {
    // Übersicht: 2 Spalten (volle Kategorien-Leiste | Gruppen-Karten)
    root.innerHTML = `
      <div class="mmc mmc--overview">
        <div class="mmc-col2">
          <div class="mmc-col2-body" id="mmc-col2-body"></div>
          ${userbarHtml(session, prefs)}
        </div>
        <main class="mmc-main" id="mmc-main"></main>
      </div>`
    fillCol2(root)
    fillMain(root)
  }
  bindApp(root)
}

/* ── Userbar events ────────────────────────────────────────────── */
function bindApp(root) {
  root.querySelector('#mmc-user-id')?.addEventListener('click', e => { e.stopPropagation(); openUserMenu(root) })
  root.querySelector('#mmc-logout')?.addEventListener('click', async () => { await logout(); resetNavState(); renderAuth(root) })

  // Icon-Klick = stummschalten/Ton umschalten
  root.querySelector('#mmc-mic')?.addEventListener('click', e => {
    e.stopPropagation()
    const p = getPrefs(); p.muted = !p.muted; setPrefs(p)
    if (inVoiceRoom()) toggleVoiceMute(p.muted)
    const bar = root.querySelector('.mmc-userbar')
    if (bar) bar.outerHTML = userbarHtml(getSession(), getPrefs())
    bindApp(root)
  })
  root.querySelector('#mmc-deaf')?.addEventListener('click', e => {
    e.stopPropagation()
    const p = getPrefs()
    p.deafened = !p.deafened
    if (p.deafened) p.muted = true
    setPrefs(p)
    if (inVoiceRoom()) toggleVoiceDeafen(p.deafened, p.muted)
    const bar = root.querySelector('.mmc-userbar')
    if (bar) bar.outerHTML = userbarHtml(getSession(), getPrefs())
    bindApp(root)
  })
  // Chevron = Geräte-/Lautstärke-Popover öffnen
  root.querySelector('#mmc-mic-chev')?.addEventListener('click', e => { e.stopPropagation(); openAudioMenu(root, 'input') })
  root.querySelector('#mmc-deaf-chev')?.addEventListener('click', e => { e.stopPropagation(); openAudioMenu(root, 'output') })

  root.querySelector('#mmc-settings')?.addEventListener('click', () => openSettingsPanel(root))
}

/* ── Audio-Popover (Mikrofon / Kopfhörer) ──────────────────────── */
function openAudioMenu(root, type) {
  const anchor = root.querySelector('.mmc-userbar')?.parentElement || root.querySelector('.mmc-col2')
  if (!anchor) return
  anchor.querySelector('.mmc-usermenu')?.remove()
  const existing = anchor.querySelector('.mmc-audiomenu')
  if (existing) { const wasType = existing.dataset.type; existing.remove(); if (wasType === type) return }

  const prefs = getPrefs()
  const isIn = type === 'input'
  const vol = isIn ? (prefs.inVol ?? 80) : (prefs.outVol ?? 60)
  const selectedDevId = isIn ? (prefs.micDeviceId || '') : (prefs.sinkDeviceId || '')

  const pop = document.createElement('div')
  pop.className = 'mmc-audiomenu'; pop.dataset.type = type
  pop.innerHTML = `
    <div class="mmc-am-title mmc-am-title--head">${isIn ? 'Eingabegerät' : 'Ausgabegerät'}</div>
    <div class="mmc-am-device-list" id="mmc-am-devlist">
      <div class="mmc-am-sub">Geräte werden geladen …</div>
    </div>
    <div class="mmc-am-sep"></div>
    <div class="mmc-am-vol">
      <div class="mmc-am-title">${isIn ? 'Eingabelautstärke' : 'Ausgabelautstärke'}</div>
      <input type="range" class="mmc-am-slider" min="0" max="100" value="${vol}">
    </div>`
  anchor.appendChild(pop)
  requestAnimationFrame(() => pop.classList.add('is-open'))

  const close = () => { pop.remove(); document.removeEventListener('click', onDoc) }
  const onDoc = ev => { if (!pop.contains(ev.target) && !ev.target.closest('.mmc-uc-group')) close() }
  setTimeout(() => document.addEventListener('click', onDoc), 0)

  pop.querySelector('.mmc-am-slider')?.addEventListener('input', e => {
    const p = getPrefs(); if (isIn) p.inVol = +e.target.value; else p.outVol = +e.target.value; setPrefs(p)
  })

  // Geräteliste laden
  listAudioDevices().then(({ inputs, outputs }) => {
    const devices = isIn ? inputs : outputs
    const devList = pop.querySelector('#mmc-am-devlist')
    if (!devList) return
    if (!devices.length) {
      devList.innerHTML = '<div class="mmc-am-sub">Keine Geräte gefunden.</div>'
      return
    }
    devList.innerHTML = devices.map(d => `
      <button class="mmc-am-device${d.deviceId === selectedDevId ? ' is-selected' : ''}" data-dev="${esc(d.deviceId)}">
        ${d.deviceId === selectedDevId ? '✓ ' : ''}${esc(d.label || (isIn ? 'Mikrofon' : 'Lautsprecher'))}
      </button>`).join('')

    devList.querySelectorAll('[data-dev]').forEach(btn => btn.addEventListener('click', async () => {
      const devId = btn.dataset.dev
      const p = getPrefs()
      if (isIn) {
        p.micDeviceId = devId; setPrefs(p)
        await switchMicrophone(devId)
      } else {
        p.sinkDeviceId = devId; setPrefs(p)
        const supported = await switchSpeaker(devId)
        if (!supported) toast(root, 'Ausgabegerät-Wechsel wird von diesem Browser nicht unterstützt (setSinkId fehlt).')
      }
      close()
    }))
  })
}

/* ── Benutzer-Popover (Klick auf Avatar/Name) ──────────────────── */
function openUserMenu(root) {
  const anchor = root.querySelector('.mmc-userbar')?.parentElement || root.querySelector('.mmc-col2')
  if (!anchor) return
  if (anchor.querySelector('.mmc-usermenu')) { anchor.querySelector('.mmc-usermenu').remove(); return }
  const session = getSession(); const prefs = getPrefs()
  const name = session.username
  const cur = prefs.status || 'online'
  const statuses = ['online', 'idle', 'dnd', 'invisible']

  const myProf = getMyProfile()
  const myDisplayName = myProf.displayName || name
  const myAvatarColor = avatarColor(name)
  const pop = document.createElement('div')
  pop.className = 'mmc-usermenu'
  pop.innerHTML = `
    <div class="mmc-um-banner" style="background:linear-gradient(135deg, ${myAvatarColor}, #1a1a1a)"></div>
    <div class="mmc-um-avatar-wrap">
      <div class="mmc-avatar mmc-um-avatar" style="background:${myAvatarColor}">${avatarInner(name)}<span class="mmc-presence" style="background:${statusMeta(cur).color}"></span></div>
    </div>
    <div class="mmc-um-body">
      <div class="mmc-um-name">${esc(myDisplayName)}</div>
      <div class="mmc-um-tag">@${esc(name.toLowerCase())}${myProf.statusText ? `<br><span style="opacity:.6;font-size:.85em">${esc(myProf.statusText)}</span>` : ''}</div>
      <div class="mmc-um-card">
        <button class="mmc-um-item" data-act="profile">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
          <span>Profil bearbeiten</span>
        </button>
      </div>
      <div class="mmc-um-card">
        <button class="mmc-um-item mmc-um-statustoggle" id="mmc-status-toggle">
          <span class="mmc-um-dot" style="background:${statusMeta(cur).color}"></span>
          <span>${statusMeta(cur).label}</span>
          <span class="mmc-am-chev">›</span>
        </button>
      </div>
      <div class="mmc-um-card">
        <button class="mmc-um-item mmc-um-logout" data-act="logout">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>
          <span>Abmelden</span>
        </button>
      </div>
    </div>`
  anchor.appendChild(pop)
  requestAnimationFrame(() => pop.classList.add('is-open'))

  // Status-Flyout: eigenständiges Element (nicht in .mmc-usermenu verschachtelt,
  // damit es über dessen overflow:hidden/Rundung hinausragen kann)
  const flyHost = root.querySelector('.mmc') || anchor
  let flyout = null
  const closeFlyout = () => { flyout?.remove(); flyout = null }
  const positionFlyout = () => {
    if (!flyout) return
    const tRect = pop.querySelector('#mmc-status-toggle').getBoundingClientRect()
    const hRect = flyHost.getBoundingClientRect()
    flyout.style.left = (tRect.right - hRect.left + 8) + 'px'
    flyout.style.top = (tRect.top - hRect.top) + 'px'
  }
  const openFlyout = () => {
    if (flyout) { closeFlyout(); return }
    flyout = document.createElement('div')
    flyout.className = 'mmc-um-flyout'
    flyout.innerHTML = statuses.map(s => `
      <button class="mmc-um-flyitem ${s === cur ? 'is-active' : ''}" data-status="${s}">
        <span class="mmc-um-dot" style="background:${statusMeta(s).color}"></span>
        <div class="mmc-um-flytext">
          <div class="mmc-um-flytitle">${statusMeta(s).label}</div>
          <div class="mmc-um-flydesc">${esc(statusMeta(s).desc)}</div>
        </div>
        ${s === cur ? '<span class="mmc-um-check">✓</span>' : ''}
      </button>`).join('')
    flyHost.appendChild(flyout)
    positionFlyout()
    requestAnimationFrame(() => flyout.classList.add('is-open'))
    flyout.querySelectorAll('[data-status]').forEach(b => b.addEventListener('click', () => {
      const p = getPrefs(); p.status = b.dataset.status; setPrefs(p)
      close()
      const bar = root.querySelector('.mmc-userbar')
      if (bar) bar.outerHTML = userbarHtml(getSession(), getPrefs())
      bindApp(root)
    }))
  }

  const close = () => { closeFlyout(); pop.remove(); document.removeEventListener('click', onDoc) }
  const onDoc = ev => {
    if (pop.contains(ev.target) || ev.target.closest('#mmc-user-id') || (flyout && flyout.contains(ev.target))) return
    close()
  }
  setTimeout(() => document.addEventListener('click', onDoc), 0)

  pop.querySelector('#mmc-status-toggle')?.addEventListener('click', e => { e.stopPropagation(); openFlyout() })
  pop.querySelector('[data-act="profile"]')?.addEventListener('click', () => { close(); openAccount() })
  pop.querySelector('[data-act="logout"]')?.addEventListener('click', async () => { close(); await logout(); resetNavState(); renderAuth(root) })
}

/* ── Fremdes Nutzerprofil-Popover (Klick auf einen Namen im Chat/Talk) ──
   Discord-Stil: Banner, Avatar, gemeinsame Gruppen, Freundschaftsanfrage/
   Annehmen/Ablehnen je nach Beziehungsstatus, „…"-Menü mit Blockieren/Melden. */
function openUserProfile(root, username) {
  if (username.toLowerCase() === me().toLowerCase()) return // eigenes Profil hat eigenen Weg (Avatar unten links)
  document.querySelectorAll('.mmc-userprofile, .mmc-up-menu').forEach(x => x.remove())

  const render = () => {
    const isFriend = getFriends().some(f => f.toLowerCase() === username.toLowerCase())
    const outReq = outgoingRequests().find(r => r.to.toLowerCase() === username.toLowerCase())
    const inReq = incomingRequests().find(r => r.from.toLowerCase() === username.toLowerCase())
    const blocked = isBlocked(username)
    const mutual = mutualGroupCount(username)

    let actionHtml
    if (blocked) {
      actionHtml = `<button class="mmc-up-primary mmc-up-primary--danger" data-act="unblock">Blockiert · Entblocken</button>`
    } else if (isFriend) {
      actionHtml = `<button class="mmc-up-primary" disabled>✓ Befreundet</button>`
    } else if (inReq) {
      actionHtml = `
        <button class="mmc-up-primary" data-act="accept">Annehmen</button>
        <button class="mmc-up-primary mmc-up-primary--ghost" data-act="decline">Ablehnen</button>`
    } else if (outReq) {
      actionHtml = `<button class="mmc-up-primary mmc-up-primary--ghost" data-act="cancel">Anfrage gesendet · Zurückziehen</button>`
    } else {
      actionHtml = `<button class="mmc-up-primary" data-act="add">Freundschaftsanfrage senden</button>`
    }

    const uProf = getProfile(username)
    const uColor = avatarColor(username)
    const uDname = uProf.displayName || username
    const bikeLine = uProf.showBike && uProf.bikeText
      ? `<div class="mmc-up-bike">🏍️ ${esc(uProf.bikeText)}</div>` : ''
    const bioLine = uProf.bio ? `<div class="mmc-up-bio">${esc(uProf.bio)}</div>` : ''
    const statusLine = uProf.statusText ? `<div class="mmc-up-statustext">${esc(uProf.statusText)}</div>` : ''
    const pop = document.createElement('div')
    pop.className = 'mmc-userprofile'
    pop.innerHTML = `
      <div class="mmc-up-banner" style="background:linear-gradient(135deg, ${uColor}, #1a1a1a)"></div>
      <button class="mmc-up-more" id="mmc-up-more" title="Weitere Optionen" aria-label="Weitere Optionen">⋯</button>
      <div class="mmc-up-avatar-wrap">
        <div class="mmc-avatar mmc-um-avatar" style="background:${uColor}">${avatarInner(username)}<span class="mmc-presence"></span></div>
      </div>
      <div class="mmc-um-body">
        <div class="mmc-um-name">${esc(uDname)}</div>
        <div class="mmc-um-tag">@${esc(username.toLowerCase().replace(/\s+/g, ''))}</div>
        ${statusLine}${bioLine}${bikeLine}
        ${mutual ? `<div class="mmc-up-mutual">${mutual} gemeinsame${mutual === 1 ? '' : ''} Gruppe${mutual === 1 ? '' : 'n'}</div>` : ''}
        <div class="mmc-up-actions">${actionHtml}</div>
      </div>`
    document.body.appendChild(pop)

    const anchor = document.activeElement?.closest('[data-user]') || document.querySelector(`[data-user="${CSS.escape(username)}"]`)
    const r = anchor?.getBoundingClientRect()
    if (r) {
      const top = Math.min(r.top, window.innerHeight - 380)
      let left = r.right + 10
      if (left + 300 > window.innerWidth) left = r.left - 310
      pop.style.top = Math.max(10, top) + 'px'
      pop.style.left = Math.max(10, left) + 'px'
    }
    requestAnimationFrame(() => pop.classList.add('is-open'))

    const close = () => { pop.remove(); document.removeEventListener('click', onDoc) }
    const onDoc = ev => { if (!pop.contains(ev.target) && !ev.target.closest('[data-user]')) close() }
    setTimeout(() => document.addEventListener('click', onDoc), 0)

    pop.querySelector('[data-act="add"]')?.addEventListener('click', async () => {
      const res = await sendFriendRequest(username)
      toast(root, res.ok ? (res.autoAccepted ? `Ihr seid jetzt befreundet!` : 'Freundschaftsanfrage gesendet.') : res.error)
      close(); render(); refreshFriendsChrome(root)
    })
    pop.querySelector('[data-act="accept"]')?.addEventListener('click', async () => {
      await acceptRequest(inReq.id); toast(root, 'Freundschaftsanfrage angenommen.'); close(); render(); refreshFriendsChrome(root)
    })
    pop.querySelector('[data-act="decline"]')?.addEventListener('click', async () => { await declineRequest(inReq.id); close(); render(); refreshFriendsChrome(root) })
    pop.querySelector('[data-act="cancel"]')?.addEventListener('click', async () => { await cancelRequest(outReq.id); close(); render(); refreshFriendsChrome(root) })
    pop.querySelector('[data-act="unblock"]')?.addEventListener('click', async () => {
      await toggleBlock(username); toast(root, `${username} entblockt.`); close()
      refreshFriendsChrome(root)
      if (activeGroup) renderGroupChatMain(root)
      else render()
    })

    pop.querySelector('#mmc-up-more')?.addEventListener('click', e => {
      e.stopPropagation()
      document.querySelectorAll('.mmc-up-menu').forEach(x => x.remove())
      const ignored = isIgnored(username)
      const menu = document.createElement('div')
      menu.className = 'mmc-up-menu'
      menu.innerHTML = `
        <button class="mmc-um-item" data-mact="ignore">${ignored ? 'Nicht mehr ignorieren' : 'Ignorieren'}</button>
        <button class="mmc-um-item mmc-um-logout" data-mact="block">${blocked ? 'Entblocken' : 'Blockieren'}</button>
        <button class="mmc-um-item mmc-um-logout" data-mact="report">Nutzerprofil melden</button>`
      const btnRect = e.currentTarget.getBoundingClientRect()
      menu.style.top = btnRect.bottom + 4 + 'px'
      menu.style.left = Math.max(10, btnRect.right - 190) + 'px'
      document.body.appendChild(menu)
      requestAnimationFrame(() => menu.classList.add('is-open'))
      const closeMenu = ev => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeMenu) } }
      setTimeout(() => document.addEventListener('click', closeMenu), 0)

      menu.querySelector('[data-mact="ignore"]')?.addEventListener('click', async () => {
        menu.remove()
        const nowIgnored = await toggleIgnore(username)
        toast(root, nowIgnored ? `${username} wird ignoriert.` : `${username} wird nicht mehr ignoriert.`)
        close(); refreshFriendsChrome(root)
      })

      menu.querySelector('[data-mact="report"]')?.addEventListener('click', () => {
        menu.remove(); close()
        openUserReportModal(root, username)
      })

      menu.querySelector('[data-mact="block"]')?.addEventListener('click', async () => {
        const nowBlocked = await toggleBlock(username)
        menu.remove(); toast(root, nowBlocked ? `${username} blockiert.` : `${username} entblockt.`)
        close()
        refreshFriendsChrome(root)
        if (activeGroup) renderGroupChatMain(root)
        else render()
      })
    })
  }
  render()
}

/* ── Nutzer-Meldungs-Modal ──────────────────────────────────────── */
function openUserReportModal(root, username) {
  document.querySelectorAll('#mmc-user-report-modal').forEach(x => x.remove())
  const overlay = document.createElement('div')
  overlay.className = 'mmc-modal mmc-modal--open'; overlay.id = 'mmc-user-report-modal'
  overlay.innerHTML = `
    <div class="mmc-modal-backdrop" id="mmc-report-backdrop"></div>
    <div class="mmc-modal-card">
      <h3 class="mmc-modal-title">Nutzer melden</h3>
      <p class="mmc-modal-sub">Meldung über <strong>${esc(username)}</strong>. Wir prüfen alle Meldungen vertraulich.</p>
      <form id="mmc-report-form">
        <label class="mmc-field">
          <span class="mmc-field-label">Grund <span class="mmc-req">*</span></span>
          <select class="mmc-input" id="mmc-report-reason" required>
            <option value="">Bitte wählen …</option>
            <option value="spam">Spam</option>
            <option value="harassment">Belästigung</option>
            <option value="inappropriate">Unangemessene Inhalte</option>
            <option value="other">Sonstiges</option>
          </select>
        </label>
        <label class="mmc-field">
          <span class="mmc-field-label">Beschreibung <span style="opacity:.5">(optional)</span></span>
          <textarea class="mmc-input mmc-textarea" id="mmc-report-text" maxlength="400" rows="3" placeholder="Weitere Details …"></textarea>
        </label>
        <div class="mmc-auth-error" id="mmc-report-error" hidden></div>
        <div class="mmc-modal-actions">
          <button type="button" class="mmc-btn-ghost" id="mmc-report-cancel">Abbrechen</button>
          <button type="submit" class="mmc-auth-submit mmc-auth-submit--sm">Meldung absenden</button>
        </div>
      </form>
    </div>`
  document.body.appendChild(overlay)
  const close = () => { overlay.classList.remove('mmc-modal--open'); setTimeout(() => overlay.remove(), 200) }
  overlay.querySelector('#mmc-report-backdrop')?.addEventListener('click', close)
  overlay.querySelector('#mmc-report-cancel')?.addEventListener('click', close)
  overlay.querySelector('#mmc-report-form')?.addEventListener('submit', async e => {
    e.preventDefault()
    const reason = overlay.querySelector('#mmc-report-reason').value
    const text = overlay.querySelector('#mmc-report-text').value.trim()
    const errEl = overlay.querySelector('#mmc-report-error')
    if (!reason) { errEl.hidden = false; errEl.textContent = 'Bitte wähle einen Grund aus.'; return }
    const res = await reportUser(username, reason, text)
    if (!res.ok) { errEl.hidden = false; errEl.textContent = res.error; return }
    close()
    toast(root, 'Danke für deine Meldung. Wir kümmern uns darum.')
  })
  requestAnimationFrame(() => overlay.querySelector('#mmc-report-reason')?.focus())
}

/* ══════════════════════════════════════════════════════════════════
   SECOND COLUMN
   ══════════════════════════════════════════════════════════════════ */
function fillCol2(root) {
  const box = root.querySelector('#mmc-col2-body')
  if (!box) return
  box.innerHTML = col2ServerHtml()

  box.querySelector('#mmc-friends-tab')?.addEventListener('click', () => {
    friendsMode = true; homeSection = 'friends'; friendsTab = 'all'; activeGroup = null; activeDM = null; renderApp(root)
  })
  box.querySelectorAll('.mmc-cat[data-cat]').forEach(el => {
    el.addEventListener('click', () => {
      serverCategory = el.dataset.cat; activeGroup = null
      if (friendsMode) { friendsMode = false; renderApp(root) }
      else { fillCol2(root); fillMain(root) }
    })
  })
}

function groupsIn(catId) { return getGroups().filter(g => g.category === catId) }

/* ── Freunde-Modus: Icon-Leiste (links) ────────────────────────── */
function fillFriendsRail(root) {
  const rail = root.querySelector('#mmc-friends-rail'); if (!rail) return
  rail.innerHTML = `
    <button class="mmc-crb is-active" id="mmc-rail-home" title="Freunde / Startseite">${ICON.people}</button>
    <div class="mmc-rail-sep"></div>
    ${CATEGORIES.map(c => `<button class="mmc-crb" data-cat="${c.id}" title="${esc(c.name)}">${ICON[c.icon]}</button>`).join('')}`
  rail.querySelector('#mmc-rail-home')?.addEventListener('click', () => {
    homeSection = 'friends'; activeDM = null; fillHomeColumn(root); fillMain(root); fillActive(root)
  })
  rail.querySelectorAll('.mmc-crb[data-cat]').forEach(b => b.addEventListener('click', () => {
    friendsMode = false; serverCategory = b.dataset.cat; activeGroup = null; activeDM = null; renderApp(root)
  }))
}

/* ── Freunde-Modus: Home-Spalte (Freunde/Nachrichten + Direktnachrichten) ── */
function fillHomeColumn(root, searchQuery = '') {
  const box = root.querySelector('#mmc-home-body'); if (!box) return
  const friends = getFriends()
  const unread = unreadFrom()
  const reqCount = incomingRequests().length
  const q = searchQuery.trim().toLowerCase()
  const allFriends = q ? friends.filter(f => f.toLowerCase().includes(q)) : friends
  // Sort: ignored friends go to end
  const shownFriends = [
    ...allFriends.filter(f => !isIgnored(f)),
    ...allFriends.filter(f => isIgnored(f)),
  ]

  box.innerHTML = `
    <div class="mmc-search"><input type="text" id="mmc-dm-search" placeholder="Finde oder starte eine Unterhaltung" value="${esc(searchQuery)}"></div>
    <div class="mmc-nav">
      <div class="mmc-nav-item ${homeSection === 'friends' && !activeDM ? 'is-active' : ''}" data-section="friends">${ICON.people}<span>Freunde</span>${reqCount ? `<span class="mmc-navbadge">${reqCount}</span>` : ''}</div>
      <div class="mmc-nav-item ${homeSection === 'requests' && !activeDM ? 'is-active' : ''}" data-section="requests">${ICON.mail}<span>Nachrichten</span></div>
    </div>
    <div class="mmc-dm-head">
      <span>Direktnachrichten</span>
      <button class="mmc-chan-add" id="mmc-dm-add" title="Freund hinzufügen">+</button>
    </div>
    <div class="mmc-dm-list">
      ${shownFriends.length ? shownFriends.map(f => {
        const ign = isIgnored(f)
        return `
        <div class="mmc-dm ${activeDM === f ? 'is-active' : ''}${ign ? ' mmc-dm--ignored' : ''}" data-dm="${esc(f)}">
          <div class="mmc-avatar mmc-avatar--dm" style="background:${avatarColor(f)};${ign ? 'opacity:.45' : ''}">${avatarInner(f)}<span class="mmc-presence"></span></div>
          <span class="mmc-dm-name">${esc(displayName(f))}</span>
          ${!ign && unread.includes(f) ? '<span class="mmc-dm-dot"></span>' : ''}
        </div>`}).join('')
        : `<div class="mmc-dm-empty">${q ? 'Keine Treffer.' : 'Noch keine Unterhaltungen — füge oben Freunde hinzu'}</div>`}
    </div>`
  box.querySelectorAll('.mmc-nav-item[data-section]').forEach(el => el.addEventListener('click', () => {
    homeSection = el.dataset.section; activeDM = null; fillHomeColumn(root); fillMain(root); fillActive(root)
  }))
  box.querySelectorAll('.mmc-dm[data-dm]').forEach(el => el.addEventListener('click', () => {
    activeDM = el.dataset.dm; clearUnread(activeDM)
    subscribeToChannel(null, activeDM)
    fillHomeColumn(root, box.querySelector('#mmc-dm-search')?.value || ''); fillMain(root); fillActive(root)
  }))
  box.querySelector('#mmc-dm-add')?.addEventListener('click', () => {
    homeSection = 'friends'; friendsTab = 'add'; activeDM = null; fillHomeColumn(root); fillMain(root); fillActive(root)
  })
  const searchInput = box.querySelector('#mmc-dm-search')
  searchInput?.addEventListener('input', e => fillHomeColumn(root, e.target.value))
  if (searchQuery) { searchInput.focus(); searchInput.setSelectionRange(searchQuery.length, searchQuery.length) }
}

/* ── Freunde-Modus: Nachrichten (DM-Anfragen von Nicht-Freunden / Spam) ── */
function renderRequests(main, root) {
  main.innerHTML = `
    <header class="mmc-main-head">
      ${ICON.mail}<span class="mmc-main-title">Nachrichten</span>
      <div class="mmc-tabs">
        <button class="mmc-tab is-active" data-rtab="anfragen">Anfragen</button>
        <button class="mmc-tab" data-rtab="spam">Spam</button>
      </div>
    </header>
    <div class="mmc-main-body" id="mmc-req-body"></div>`
  const body = main.querySelector('#mmc-req-body')
  const renderTab = t => { body.innerHTML = `<div class="mmc-friends-empty"><p>${t === 'spam' ? 'Kein Spam vorhanden.' : 'Nachrichtenanfragen kommen mit dem echten Backend.'}</p></div>` }
  renderTab('anfragen')
  main.querySelectorAll('[data-rtab]').forEach(b => b.addEventListener('click', () => {
    main.querySelectorAll('[data-rtab]').forEach(x => x.classList.remove('is-active'))
    b.classList.add('is-active'); renderTab(b.dataset.rtab)
  }))
}

function col2ServerHtml() {
  const inReqCount = incomingRequests().length
  const friendsBadge = inReqCount > 0 ? `<span class="mmc-notif-badge">${inReqCount}</span>` : ''
  return `
    <div class="mmc-server-head">
      <div class="mmc-server-name">MotoMatch</div>
      <div class="mmc-server-tag">Community-Server</div>
    </div>
    <div class="mmc-nav">
      <div class="mmc-nav-item ${friendsMode ? 'is-active' : ''}" id="mmc-friends-tab" style="position:relative">${ICON.people}<span>Freunde</span>${friendsBadge}</div>
    </div>
    <div class="mmc-chan-head"><span>Kategorien</span></div>
    <div class="mmc-chan-list">
      ${CATEGORIES.map(c => `
        <div class="mmc-cat ${!friendsMode && c.id === serverCategory ? 'mmc-chan--active' : ''}" data-cat="${c.id}">
          <span class="mmc-cat-ic">${ICON[c.icon]}</span>
          <span class="mmc-chan-name">${esc(c.name)}</span>
          <span class="mmc-cat-count">${groupsIn(c.id).length}</span>
        </div>`).join('')}
    </div>`
}

/* ══════════════════════════════════════════════════════════════════
   MAIN CONTENT
   ══════════════════════════════════════════════════════════════════ */
function fillMain(root) {
  const main = root.querySelector('#mmc-main')
  if (!main) return

  if (friendsMode) {
    if (activeDM) renderDMView(main, root)
    else if (homeSection === 'requests') renderRequests(main, root)
    else renderFriendsView(main, root)
    return
  }
  renderGroupList(main, root)
}

/* ── Friends view ──────────────────────────────────────────────── */
function renderFriendsView(main, root) {
  const friends = getFriends()
  const pendingCount = incomingRequests().length + outgoingRequests().length
  const tabs = [
    ['all', 'Alle'], ['pending', 'Ausstehend'], ['add', 'Freund hinzufügen'],
  ]
  main.innerHTML = `
    <header class="mmc-main-head">
      ${ICON.people}<span class="mmc-main-title">Freunde</span>
      <div class="mmc-tabs">
        ${tabs.map(([k, l]) => `<button class="mmc-tab ${friendsTab === k ? 'is-active' : ''} ${k === 'add' ? 'mmc-tab-add' : ''}" data-tab="${k}">${l}${k === 'pending' && pendingCount ? ` <span class="mmc-tab-count">${pendingCount}</span>` : ''}</button>`).join('')}
      </div>
    </header>
    <div class="mmc-main-body" id="mmc-friends-body"></div>
  `
  const body = main.querySelector('#mmc-friends-body')

  if (friendsTab === 'add') {
    body.innerHTML = `
      <div class="mmc-addfriend">
        <h3>Freund hinzufügen</h3>
        <p class="mmc-addfriend-sub">Du kannst Freunde über ihren exakten MotoMatch-Benutzernamen hinzufügen.</p>
        <form class="mmc-addfriend-form" id="mmc-addfriend-form" autocomplete="off">
          <input type="text" id="mmc-addfriend-input" maxlength="24" placeholder="Gib einen Benutzernamen ein" autocomplete="off">
          <button type="submit">Freundschaftsanfrage senden</button>
        </form>
        <div class="mmc-addfriend-suggest" id="mmc-addfriend-suggest"></div>
        <div class="mmc-addfriend-msg" id="mmc-addfriend-msg" hidden></div>
        <h3 class="mmc-addfriend-more">Weitere Orte, um Freunde zu finden</h3>
        <button class="mmc-explore-card" id="mmc-explore-card">
          <span class="mmc-explore-ic">${ICON.compass}</span>
          <span class="mmc-explore-txt">Erkunde entdeckbare Server</span>
          <span class="mmc-explore-arr">›</span>
        </button>
      </div>`
    const form = body.querySelector('#mmc-addfriend-form')
    const input = body.querySelector('#mmc-addfriend-input')
    const msg = body.querySelector('#mmc-addfriend-msg')
    const suggestBox = body.querySelector('#mmc-addfriend-suggest')
    const show = (t, ok) => { msg.hidden = false; msg.textContent = t; msg.classList.toggle('is-ok', !!ok); msg.classList.toggle('is-err', !ok) }

    const doSend = async username => {
      if (!username || username.length < 2) return show('Bitte gib einen gültigen Benutzernamen ein.', false)
      const res = await sendFriendRequest(username)
      if (!res.ok) return show(res.error, false)
      input.value = ''; suggestBox.innerHTML = ''
      show(res.autoAccepted ? `Ihr seid jetzt mit ${res.username} befreundet!` : `Freundschaftsanfrage an ${res.username} gesendet.`, true)
      refreshFriendsChrome(root)
    }
    form?.addEventListener('submit', e => { e.preventDefault(); doSend(input.value.trim()) })
    input.addEventListener('input', async () => {
      const q = input.value.trim()
      msg.hidden = true
      if (!q) { suggestBox.innerHTML = ''; return }
      const already = [...getFriends(), me()]
      const matches = await searchUsersApi(q, { exclude: already })
      suggestBox.innerHTML = matches.length
        ? matches.map(u => `<button type="button" class="mmc-suggest-item" data-user="${esc(u)}">
            <span class="mmc-avatar mmc-avatar--dm" style="background:${avatarColor(u)}">${avatarInner(u)}</span>
            <span>${esc(displayName(u))}</span>
          </button>`).join('')
        : `<div class="mmc-suggest-empty">Kein passender Nutzer gefunden.</div>`
      suggestBox.querySelectorAll('[data-user]').forEach(b => b.addEventListener('click', () => doSend(b.dataset.user)))
    })
    body.querySelector('#mmc-explore-card')?.addEventListener('click', () => {
      friendsMode = false; activeDM = null; activeGroup = null; renderApp(root)
    })
    requestAnimationFrame(() => input?.focus())
    bindFriendsTabs(main, root)
    return
  }

  if (friendsTab === 'pending') {
    const inc = incomingRequests(), out = outgoingRequests()
    const row = (r, dir) => `
      <div class="mmc-friend-row">
        <div class="mmc-avatar mmc-avatar--dm" style="background:${avatarColor(dir === 'in' ? r.from : r.to)}">${avatarInner(dir === 'in' ? r.from : r.to)}</div>
        <div class="mmc-friend-meta">
          <div class="mmc-friend-name">${esc(displayName(dir === 'in' ? r.from : r.to))}</div>
          <div class="mmc-friend-status">${dir === 'in' ? 'Möchte dich als Freund hinzufügen' : 'Ausstehende Anfrage'}</div>
        </div>
        ${dir === 'in'
          ? `<button class="mmc-req-btn mmc-req-accept" data-accept="${r.id}" title="Annehmen">✓</button>
             <button class="mmc-req-btn mmc-req-decline" data-decline="${r.id}" title="Ablehnen">✕</button>`
          : `<button class="mmc-req-btn mmc-req-decline" data-cancel="${r.id}" title="Zurückziehen">✕</button>`}
      </div>`
    body.innerHTML = (inc.length || out.length)
      ? `
        ${inc.length ? `<div class="mmc-friends-count">Eingehende Anfragen — ${inc.length}</div><div class="mmc-friends-list">${inc.map(r => row(r, 'in')).join('')}</div>` : ''}
        ${out.length ? `<div class="mmc-friends-count">Ausgehende Anfragen — ${out.length}</div><div class="mmc-friends-list">${out.map(r => row(r, 'out')).join('')}</div>` : ''}`
      : `<div class="mmc-friends-empty"><p>Keine ausstehenden Anfragen.</p></div>`
    body.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', async () => {
      await acceptRequest(b.dataset.accept); toast(root, 'Freundschaftsanfrage angenommen.'); fillMain(root); refreshFriendsChrome(root)
    }))
    body.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', async () => { await declineRequest(b.dataset.decline); fillMain(root); refreshFriendsChrome(root) }))
    body.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', async () => { await cancelRequest(b.dataset.cancel); fillMain(root); refreshFriendsChrome(root) }))
    bindFriendsTabs(main, root)
    return
  }

  if (!friends.length) {
    body.innerHTML = `<div class="mmc-friends-empty"><p>Noch keine Freunde — füge oben welche hinzu!</p></div>`
    bindFriendsTabs(main, root); return
  }

  // online / all → list friends; ignored go to end and are grayed out
  const sortedFriends = [
    ...friends.filter(f => !isIgnored(f)),
    ...friends.filter(f => isIgnored(f)),
  ]
  body.innerHTML = `
    <div class="mmc-friends-count">Alle Freunde — ${friends.length}</div>
    <div class="mmc-friends-list">
      ${sortedFriends.map(f => {
        const ign = isIgnored(f)
        return `
        <div class="mmc-friend-row${ign ? ' mmc-friend-row--ignored' : ''}" data-dm="${esc(f)}">
          <div class="mmc-avatar mmc-avatar--dm" style="background:${avatarColor(f)};${ign ? 'opacity:.4' : ''}">${avatarInner(f)}<span class="mmc-presence"></span></div>
          <div class="mmc-friend-meta"><div class="mmc-friend-name"${ign ? ' style="opacity:.5"' : ''}>${esc(displayName(f))}</div><div class="mmc-friend-status">${ign ? 'ignoriert' : 'online'}</div></div>
          <button class="mmc-friend-msg-btn" data-dm="${esc(f)}" title="Nachricht">${ICON.send}</button>
        </div>`}).join('')}
    </div>`
  body.querySelectorAll('[data-dm]').forEach(el => {
    el.addEventListener('click', () => { activeDM = el.dataset.dm; clearUnread(activeDM); subscribeToChannel(null, activeDM); fillHomeColumn(root); fillMain(root); fillActive(root) })
  })
  bindFriendsTabs(main, root)
}

function bindFriendsTabs(main, root) {
  main.querySelectorAll('.mmc-tab[data-tab]').forEach(t => {
    t.addEventListener('click', () => { friendsTab = t.dataset.tab; fillMain(root) })
  })
}

/* ── DM chat ───────────────────────────────────────────────────── */
function renderDMView(main, root) {
  const name = activeDM
  clearUnread(name)
  const prevReadTs = lastReadDMTs(name)
  markDMRead(name)
  const dmKey = `dm/${name}`
  const dmMuted = isMuted(dmKey)
  const bellIcon = dmMuted
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`
  main.innerHTML = `
    <header class="mmc-chat-head">
      <div class="mmc-avatar mmc-avatar--dm" style="background:${avatarColor(name)}">${avatarInner(name)}<span class="mmc-presence"></span></div>
      <span class="mmc-chat-title">${esc(displayName(name))}</span>
      <button class="mmc-bell-btn${dmMuted ? ' is-muted' : ''}" id="mmc-dm-bell" title="${dmMuted ? 'Stummschaltung aufheben' : 'Chat stummschalten'}">${bellIcon}</button>
    </header>
    <div class="mmc-messages" id="mmc-messages"></div>
    ${composeHtml('Nachricht an @' + esc(name))}`
  main.querySelector('#mmc-dm-bell')?.addEventListener('click', e => { e.stopPropagation(); openMuteMenu(root, dmKey, true) })
  renderMessagesInto(root, main.querySelector('#mmc-messages'), (getDMs()[name]) || [], {
    title: displayName(name), text: `Das ist der Anfang deiner Unterhaltung mit ${displayName(name)}.`, avatar: name,
  }, null, prevReadTs)
  bindComposeExtras(main, root)
  main.querySelector('#mmc-compose-form')?.addEventListener('submit', async e => {
    e.preventDefault()
    const input = main.querySelector('#mmc-compose-input')
    const form  = main.querySelector('#mmc-compose-form')
    const text  = input.value.trim()
    const image = form?._pendingAttachment || null
    if (!text && !image) return
    // Gäste dürfen nicht schreiben (Online-Modus)
    if (!OFFLINE_MODE && getSession()?.guest) { toast(root, 'Bitte melde dich an, um Nachrichten zu senden.'); return }
    await sendDM(name, text, replyingTo, image)
    input.value = ''; input.style.height = 'auto'
    form?._clearAttach?.()
    const rb = main.querySelector('#mmc-reply-bar')
    if (rb) { rb.hidden = true; rb.innerHTML = '' }
    replyingTo = null
    renderMessagesInto(root, main.querySelector('#mmc-messages'), getDMs()[name] || [], { title: displayName(name), text: '', avatar: name })
    input.focus()
  })
  requestAnimationFrame(() => main.querySelector('#mmc-compose-input')?.focus())
}

/* ── Server: group list per category ───────────────────────────── */
function renderGroupList(main, root) {
  const cat = catById(serverCategory)
  const myName = getSession().username
  const groups = groupsIn(serverCategory)
  main.innerHTML = `
    <header class="mmc-main-head">
      ${ICON[cat.icon]}<span class="mmc-main-title">${esc(cat.name)}</span>
      <div class="mmc-tabs" style="margin-left:auto">
        <button class="mmc-tab mmc-tab-add" id="mmc-group-create">+ ${esc(cat.verbNew)}</button>
      </div>
    </header>
    <div class="mmc-main-body">
      <div class="mmc-invite-redeem" id="mmc-invite-redeem-box">
        <form class="mmc-invite-redeem-form" id="mmc-invite-redeem-form" autocomplete="off">
          <input class="mmc-input mmc-invite-redeem-input" id="mmc-invite-code-input" type="text" maxlength="10" placeholder="Einladungscode einlösen …" autocomplete="off" spellcheck="false">
          <button type="submit" class="mmc-auth-submit mmc-auth-submit--sm">Einlösen</button>
        </form>
        <div class="mmc-invite-redeem-msg" id="mmc-invite-redeem-msg" hidden></div>
      </div>
      <p class="mmc-cat-intro">Tritt einer bestehenden ${esc(cat.noun)} bei oder erstelle deine eigene.</p>
      ${groups.length
        ? `<div class="mmc-group-grid">${groups.map(g => groupCardHtml(g, myName)).join('')}</div>`
        : `<div class="mmc-friends-empty"><p>Noch nichts in ${esc(cat.name)} — erstelle die erste ${esc(cat.noun)}!</p></div>`}
    </div>`

  main.querySelector('#mmc-invite-redeem-form')?.addEventListener('submit', async e => {
    e.preventDefault()
    const input = main.querySelector('#mmc-invite-code-input')
    const msgEl = main.querySelector('#mmc-invite-redeem-msg')
    const code = input.value.trim()
    if (!code) return
    const res = await redeemInvite(code)
    msgEl.hidden = false
    if (res.ok) {
      msgEl.className = 'mmc-invite-redeem-msg mmc-invite-redeem-msg--ok'
      msgEl.textContent = `Du bist „${res.group.name}" beigetreten.`
      input.value = ''
      toast(root, `Du bist „${res.group.name}" beigetreten.`)
      activeGroup = res.group.id
      renderApp(root)
    } else {
      msgEl.className = 'mmc-invite-redeem-msg mmc-invite-redeem-msg--err'
      msgEl.textContent = res.error
    }
  })

  main.querySelector('#mmc-group-create')?.addEventListener('click', () => openCreateGroup(root))
  main.querySelectorAll('[data-join]').forEach(b => b.addEventListener('click', async e => { e.stopPropagation(); await _joinGroupUI(root, b.dataset.join) }))
  main.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { activeGroup = b.dataset.open; renderApp(root) }))
  main.querySelectorAll('[data-cancel-req]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation()
    const groupId = b.dataset.cancelReq
    const req = myGroupRequest(groupId)
    if (req) await declineGroupRequest(req.id)
    renderGroupList(main, root)
  }))
  main.querySelectorAll('[data-rsvp]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation()
    await toggleRsvp(b.dataset.rsvp)
    renderGroupList(main, root)
  }))
  main.querySelectorAll('[data-mappoint]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation()
    _openMapForPoint(b.dataset.mappoint)
  }))
}

const JOIN_MODE_META = {
  open:    { icon: ICON.unlock,    label: 'Offen' },
  request: { icon: ICON.clipboard, label: 'Anfrage' },
  invite:  { icon: ICON.lock,      label: 'Nur Einladung' },
}

function groupCardHtml(g, myName) {
  groupDefaults(g)
  const joined = g.members.includes(myName)
  const banned  = isGroupBanned(g, myName)
  const pending = myGroupRequest(g.id)
  let last = null
  for (const ch of g.channels) { const m = ch.messages[ch.messages.length - 1]; if (m && (!last || m.ts > last.ts)) last = m }
  const mode = JOIN_MODE_META[g.joinMode] || JOIN_MODE_META.open
  const reqCount = groupRequestsFor(g.id).length
  const muted = isMuted(g.id)
  const unreadCount = joined ? unreadCountGroup(g) : 0

  let actionBtn
  if (joined) {
    actionBtn = `<button class="mmc-group-btn mmc-group-btn--open" data-open="${g.id}">Öffnen</button>`
  } else if (banned) {
    actionBtn = `<button class="mmc-group-btn mmc-group-btn--disabled" disabled>Gesperrt</button>`
  } else if (g.joinMode === 'invite') {
    actionBtn = `<button class="mmc-group-btn mmc-group-btn--disabled" disabled>Nur auf Einladung</button>`
  } else if (pending) {
    actionBtn = `<button class="mmc-group-btn mmc-group-btn--pending" data-cancel-req="${g.id}">Anfrage gesendet · Zurückziehen</button>`
  } else {
    actionBtn = `<button class="mmc-group-btn mmc-group-btn--join" data-join="${g.id}">${g.joinMode === 'request' ? 'Anfrage senden' : 'Beitreten'}</button>`
  }

  const evt = fmtEvent(g)
  const myNameCard = me()
  const rsvpList = g.rsvp || []
  const didRsvp = rsvpList.some(u => u.toLowerCase() === myNameCard.toLowerCase())
  const rsvpBtn = joined && g.eventAt
    ? (evt?.past && !didRsvp ? '' : `<button class="mmc-rsvp-btn${didRsvp ? ' mmc-rsvp-btn--on' : ''}" data-rsvp="${esc(g.id)}"${evt?.past ? ' disabled' : ''}>${didRsvp ? '✓ Angemeldet' : 'Ich fahre mit'}</button>`)
    : ''
  const mapBtn = g.meetingPoint
    ? `<button class="mmc-map-btn" data-mappoint="${esc(g.meetingPoint)}">${ICON.mappin} Auf Karte</button>`
    : ''

  return `
    <div class="mmc-group-card">
      <div class="mmc-group-top">
        <div class="mmc-group-badge" style="background:${colorFor(g.name)}">${initials(g.name)}</div>
        <div class="mmc-group-info">
          <div class="mmc-group-name${!muted && unreadCount > 0 ? ' mmc-group-name--unread' : ''}">${esc(g.name)}</div>
          <div class="mmc-group-meta">${ICON.users}<span>${g.members.length} Mitglieder · von ${esc(displayName(g.createdBy))}</span></div>
        </div>
        <span class="mmc-mode-badge" title="${mode.label}">${mode.icon}</span>
        ${canManage(g) && reqCount > 0 ? `<span class="mmc-req-badge">${reqCount}</span>` : ''}
        ${unreadCount > 0 ? `<span class="mmc-unread-badge${muted ? ' mmc-unread-badge--muted' : ''}">${unreadCount}</span>` : ''}
        ${muted ? `<span class="mmc-mute-icon" title="Stummgeschaltet">${ICON.belloff}</span>` : ''}
      </div>
      <div class="mmc-group-desc">${esc(g.desc || (last ? last.text : ''))}</div>
      ${evt ? `<div class="mmc-group-evt${evt.past ? ' mmc-group-evt--past' : ''}">${ICON.calendar} <span>${esc(evt.text)}</span>${evt.past ? ' <span class="mmc-evt-past-tag">vorbei</span>' : ''}</div>` : ''}
      ${rsvpList.length > 0 ? `<div class="mmc-rsvp-count">${rsvpList.length} ${rsvpList.length === 1 ? 'fährt' : 'fahren'} mit</div>` : ''}
      <div class="mmc-group-actions">${actionBtn}${rsvpBtn}${mapBtn}</div>
    </div>`
}

async function _joinGroupUI(root, id) {
  const g = getGroups().find(x => x.id === id); if (!g) return
  groupDefaults(g)
  const myName = getSession().username
  if (isGroupBanned(g, myName)) { toast(root, 'Du wurdest aus dieser Gruppe gesperrt.'); return }
  if (g.joinMode === 'invite') { toast(root, 'Diese Gruppe ist nur auf Einladung zugänglich.'); return }
  if (g.joinMode === 'request') { openJoinRequestModal(root, g); return }
  const res = await joinGroup(id)
  if (res && !res.ok) { toast(root, res.error); return }
  activeGroup = id
  renderApp(root)
}

function openJoinRequestModal(root, g) {
  if (root.querySelector('#mmc-modal')) return
  const overlay = document.createElement('div')
  overlay.className = 'mmc-modal'; overlay.id = 'mmc-modal'
  overlay.innerHTML = `
    <div class="mmc-modal-backdrop" id="mmc-modal-backdrop"></div>
    <div class="mmc-modal-card">
      <h3 class="mmc-modal-title">Beitrittsanfrage senden</h3>
      <p class="mmc-modal-sub">„${esc(g.name)}" erfordert eine Anfrage. Der Host entscheidet, wer beitreten darf.</p>
      <form id="mmc-modal-form">
        <label class="mmc-field">
          <span class="mmc-field-label">Bewerbungstext <span style="opacity:.5">(optional)</span></span>
          <textarea class="mmc-input mmc-textarea" id="mmc-req-text" maxlength="200" rows="3" placeholder="Stell dich kurz vor oder erkläre, warum du beitreten möchtest …"></textarea>
        </label>
        <div class="mmc-auth-error" id="mmc-modal-error" hidden></div>
        <div class="mmc-modal-actions">
          <button type="button" class="mmc-btn-ghost" id="mmc-modal-cancel">Abbrechen</button>
          <button type="submit" class="mmc-auth-submit mmc-auth-submit--sm">Anfrage senden</button>
        </div>
      </form>
    </div>`
  root.appendChild(overlay)
  requestAnimationFrame(() => overlay.classList.add('mmc-modal--open'))
  const close = () => { overlay.classList.remove('mmc-modal--open'); setTimeout(() => overlay.remove(), 200) }
  overlay.querySelector('#mmc-modal-backdrop')?.addEventListener('click', close)
  overlay.querySelector('#mmc-modal-cancel')?.addEventListener('click', close)
  overlay.querySelector('#mmc-modal-form')?.addEventListener('submit', async e => {
    e.preventDefault()
    const text = overlay.querySelector('#mmc-req-text').value.trim()
    const res = await sendJoinRequest(g.id, text)
    if (!res.ok) { const err = overlay.querySelector('#mmc-modal-error'); err.hidden = false; err.textContent = res.error; return }
    close()
    toast(root, 'Anfrage gesendet! Der Host wird sie prüfen.')
    renderGroupList(root.querySelector('#mmc-main'), root)
  })
  requestAnimationFrame(() => overlay.querySelector('#mmc-req-text')?.focus())
}

/* ── Server: group chat ────────────────────────────────────────── */
/* ── In-Gruppe: Kategorie-Icon-Leiste (ganz links) ─────────────── */
function fillCatRail(root) {
  const rail = root.querySelector('#mmc-catrail'); if (!rail) return
  const g = getGroups().find(x => x.id === activeGroup)
  const activeCat = g ? g.category : serverCategory
  const myName = me()
  // Map category → has unread (non-muted) groups where I'm a member
  const catHasUnread = id => groupsIn(id).some(gr => {
    if (!gr.members.includes(myName)) return false
    if (isMuted(gr.id)) return false
    groupDefaults(gr)
    return unreadCountGroup(gr) > 0
  })
  rail.innerHTML = `
    <button class="mmc-crb" id="mmc-catrail-home" title="Freunde / Startseite">${ICON.people}</button>
    <div class="mmc-rail-sep"></div>
    ${CATEGORIES.map(c => `
      <button class="mmc-crb ${c.id === activeCat ? 'is-active' : ''}" data-cat="${c.id}" title="${esc(c.name)}">
        ${ICON[c.icon]}
        ${catHasUnread(c.id) ? '<span class="mmc-rail-dot"></span>' : ''}
      </button>
    `).join('')}`
  rail.querySelector('#mmc-catrail-home')?.addEventListener('click', () => {
    friendsMode = true; homeSection = 'friends'; activeGroup = null; activeDM = null; renderApp(root)
  })
  rail.querySelectorAll('.mmc-crb[data-cat]').forEach(b => b.addEventListener('click', () => {
    serverCategory = b.dataset.cat; activeGroup = null; renderApp(root)
  }))
}

/* ── In-Gruppe: Kanal-/Talk-Spalte (Mitte) ─────────────────────── */
async function _leaveGroupUI(root) {
  const g = getGroups().find(x => x.id === activeGroup); if (!g) return
  if (isOwner(g)) return
  await leaveGroup(activeGroup)
  activeGroup = null
  renderApp(root)
}

function fillGroupChannels(root) {
  const box = root.querySelector('#mmc-col2-body'); if (!box) return
  const g = getGroups().find(x => x.id === activeGroup); if (!g) return
  groupDefaults(g)
  // Ensure activeChannel is valid
  if (!activeChannel || !g.channels.find(c => c.id === activeChannel)) {
    activeChannel = g.channels[0]?.id || null
  }
  const myName = getSession().username
  const cat = catById(g.category)
  const rooms = g.voiceRooms || []
  const owner = isOwner(g)
  const mod = isMod(g)
  const managing = owner || mod
  const pendingReqs = groupRequestsFor(g.id).filter(r => r.status !== 'declined')
  const pendingReps = reportsForGroup(g.id)
  const totalPending = pendingReqs.length + pendingReps.length
  const repBadge = mod && !owner && pendingReps.length > 0 ? `<span class="mmc-req-badge">${pendingReps.length}</span>` : ''
  const allBadge = owner && totalPending > 0 ? `<span class="mmc-req-badge">${totalPending}</span>` : repBadge

  const rolePill = owner
    ? `<div class="mmc-role-pill mmc-role-pill--owner">${ICON.crown} Host</div>`
    : mod
      ? `<div class="mmc-role-pill mmc-role-pill--mod">${ICON.shield} Moderator</div>`
      : `<div class="mmc-role-pill mmc-role-pill--member">Mitglied</div>`

  const canInvite = managing || (g.joinMode !== 'invite')
  const roleActions = managing ? `
    <div class="mmc-role-actions">
      <button class="mmc-role-action-btn" id="mmc-ra-manage">${ICON.manage} Gruppe verwalten${allBadge}</button>
      <button class="mmc-role-action-btn" id="mmc-ra-members">${ICON.people} Mitglieder</button>
    </div>` : `
    <div class="mmc-role-actions">
      ${canInvite ? `<button class="mmc-role-action-btn" id="mmc-ra-invite">${ICON.link} Einladen</button>` : ''}
      <button class="mmc-role-action-btn mmc-role-action-btn--danger" id="mmc-ra-leave">${ICON.door} Gruppe verlassen</button>
    </div>`

  const groupMuted = isMuted(g.id)
  const bellIcon = groupMuted
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`

  const evtHead = fmtEvent(g)
  const rsvpListHead = g.rsvp || []
  const didRsvpHead = rsvpListHead.some(u => u.toLowerCase() === myName.toLowerCase())

  box.innerHTML = `
    <div class="mmc-server-head mmc-group-head2">
      <button class="mmc-back" id="mmc-group-back" title="Zurück zur Übersicht">${ICON.back}</button>
      <div class="mmc-gh2-info">
        <div class="mmc-server-name">${esc(g.name)}</div>
        <div class="mmc-server-tag">${esc(cat.name)} · ${g.members.length} Mitglieder</div>
        ${evtHead ? `<div class="mmc-gh2-evt${evtHead.past ? ' mmc-group-evt--past' : ''}">${ICON.calendar} <span>${esc(evtHead.text)}</span>${evtHead.past ? ' <span class="mmc-evt-past-tag">vorbei</span>' : ''}</div>` : ''}
        ${rsvpListHead.length > 0 ? `<div class="mmc-rsvp-count">${rsvpListHead.length} ${rsvpListHead.length === 1 ? 'fährt' : 'fahren'} mit</div>` : ''}
        ${rolePill}
      </div>
      <button class="mmc-bell-btn${groupMuted ? ' is-muted' : ''}" id="mmc-group-bell" title="${groupMuted ? 'Stummschaltung aufheben' : 'Gruppe stummschalten'}">${bellIcon}</button>
    </div>
    ${(g.eventAt || g.meetingPoint) ? `<div class="mmc-gh2-actions">
      ${g.eventAt ? (evtHead?.past && !didRsvpHead ? '' : `<button class="mmc-rsvp-btn${didRsvpHead ? ' mmc-rsvp-btn--on' : ''}" id="mmc-head-rsvp"${evtHead?.past ? ' disabled' : ''}>${didRsvpHead ? '✓ Angemeldet' : 'Ich fahre mit'}</button>`) : ''}
      ${g.meetingPoint ? `<button class="mmc-map-btn" id="mmc-head-map">${ICON.mappin} Karte</button>` : ''}
    </div>` : ''}
    <div class="mmc-chan-head">
      <span>Textkanäle</span>
      ${managing ? `<button class="mmc-chan-add" id="mmc-text-chan-add" title="Textkanal erstellen">+</button>` : ''}
    </div>
    <div class="mmc-tc-list">
      ${g.channels.map(ch => {
        const chUnread = unreadCountChannel(g, ch.id)
        const chMuted = groupMuted
        return `
        <div class="mmc-tc-row ${activeChannel === ch.id ? 'is-active' : ''}${!chMuted && chUnread > 0 ? ' mmc-tc-row--unread' : ''}" data-tc="${esc(ch.id)}">
          <span class="mmc-tc-hash">#</span>
          <span class="mmc-tc-name">${esc(ch.name)}</span>
          ${!chMuted && chUnread > 0 ? `<span class="mmc-unread-badge mmc-unread-badge--ch">${chUnread}</span>` : ''}
          ${managing ? `<button class="mmc-tc-more" data-tc-more="${esc(ch.id)}" title="Kanal verwalten">⋯</button>` : ''}
        </div>`
      }).join('')}
    </div>
    <div class="mmc-chan-head"><span>Sprachkanäle</span><button class="mmc-chan-add" id="mmc-voice-open" title="Talk öffnen">+</button></div>
    <div class="mmc-vc-list">
      ${rooms.length ? rooms.map(r => voiceChannelHtml(r, myName)).join('')
        : '<div class="mmc-dm-empty">Noch kein Talk offen — mit + starten</div>'}
    </div>
    ${roleActions}`

  box.querySelector('#mmc-group-back')?.addEventListener('click', () => { activeGroup = null; activeChannel = null; renderApp(root) })
  box.querySelector('#mmc-group-bell')?.addEventListener('click', e => { e.stopPropagation(); openMuteMenu(root, g.id, false) })
  box.querySelector('#mmc-head-rsvp')?.addEventListener('click', async () => {
    await toggleRsvp(activeGroup); fillGroupChannels(root)
  })
  box.querySelector('#mmc-head-map')?.addEventListener('click', () => {
    const gCur = getGroups().find(x => x.id === activeGroup)
    if (gCur?.meetingPoint) _openMapForPoint(gCur.meetingPoint)
  })
  box.querySelector('#mmc-ra-manage')?.addEventListener('click', () => openManagePanel(root))
  box.querySelector('#mmc-ra-members')?.addEventListener('click', () => openManagePanel(root, 'mitglieder'))
  box.querySelector('#mmc-ra-leave')?.addEventListener('click', () => _leaveGroupUI(root))
  box.querySelector('#mmc-ra-invite')?.addEventListener('click', async () => {
    const gCur = getGroups().find(x => x.id === activeGroup); if (!gCur) return
    const inv = await createInvite(activeGroup, { validityDays: 7, maxUses: 0 })
    navigator.clipboard?.writeText(inv.code).catch(() => {})
    toast(root, `Code „${inv.code}" erstellt und kopiert (7 Tage, unbegrenzte Nutzungen).`)
  })
  box.querySelector('#mmc-text-chan-add')?.addEventListener('click', () => openCreateChannel(root))
  box.querySelector('#mmc-voice-open')?.addEventListener('click', () => openVoiceRoom(root))

  box.querySelectorAll('.mmc-tc-row[data-tc]').forEach(row => row.addEventListener('click', e => {
    if (e.target.dataset.tcMore) return
    activeChannel = row.dataset.tc
    subscribeToChannel(activeChannel, null)
    fillGroupChannels(root)
    renderGroupChatMain(root)
  }))

  box.querySelectorAll('[data-tc-more]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation()
    const channelId = btn.dataset.tcMore
    document.querySelectorAll('.mmc-ch-menu').forEach(x => x.remove())
    const gCur = getGroups().find(x => x.id === activeGroup); if (!gCur) return
    groupDefaults(gCur)
    const ch = gCur.channels.find(c => c.id === channelId); if (!ch) return
    const canDel = gCur.channels.length > 1

    const menu = document.createElement('div')
    menu.className = 'mmc-ch-menu'
    menu.innerHTML = `
      <button class="mmc-um-item" data-chact="rename">Umbenennen</button>
      <button class="mmc-um-item mmc-um-logout${canDel ? '' : ' mmc-ch-menu-disabled'}" data-chact="delete" ${canDel ? '' : 'disabled'}>Löschen</button>`
    const rect = btn.getBoundingClientRect()
    menu.style.top = (rect.bottom + 4) + 'px'
    menu.style.left = Math.max(8, rect.left - 140) + 'px'
    document.body.appendChild(menu)
    requestAnimationFrame(() => menu.classList.add('is-open'))
    const closeMenu = ev => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeMenu) } }
    setTimeout(() => document.addEventListener('click', closeMenu), 0)

    menu.querySelector('[data-chact="rename"]')?.addEventListener('click', () => {
      menu.remove()
      openConfirmModal(root, {
        title: 'Kanal umbenennen',
        confirmLabel: 'Umbenennen',
        inputPlaceholder: 'Neuer Kanalname',
        inputValue: ch.name,
        onConfirm: newName => {
          if (!newName) return
          const slugged = slug(newName)
          if (!slugged) { toast(root, 'Ungültiger Kanalname.'); return }
          const grs = getGroups(); const gg = grs.find(x => x.id === activeGroup); if (!gg) return
          groupDefaults(gg)
          const channel = gg.channels.find(c => c.id === channelId); if (!channel) return
          channel.name = slugged
          setGroups(grs)
          fillGroupChannels(root)
          if (activeChannel === channelId) renderGroupChatMain(root)
        },
      })
    })

    menu.querySelector('[data-chact="delete"]')?.addEventListener('click', () => {
      menu.remove()
      if (!canDel) return
      openConfirmModal(root, {
        title: `#${ch.name} löschen?`,
        text: 'Alle Nachrichten in diesem Kanal gehen verloren.',
        confirmLabel: 'Löschen',
        isDanger: true,
        onConfirm: () => {
          const grs = getGroups(); const gg = grs.find(x => x.id === activeGroup); if (!gg) return
          groupDefaults(gg)
          gg.channels = gg.channels.filter(c => c.id !== channelId)
          setGroups(grs)
          if (activeChannel === channelId) activeChannel = gg.channels[0]?.id || null
          fillGroupChannels(root)
          renderGroupChatMain(root)
        },
      })
    })
  }))

  box.querySelectorAll('.mmc-vc-row[data-vc]').forEach(row => row.addEventListener('click', () => toggleVoiceRoom(root, row.dataset.vc)))
  box.querySelectorAll('.mmc-vc-member[data-user]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation(); openUserProfile(root, el.dataset.user)
  }))
}

const MIC_OFF_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4M8 23h8"/></svg>`

function voiceChannelHtml(r, myName) {
  const full = r.members.length >= r.capacity
  const mine = r.members.includes(myName)
  const activeRoom = currentRoomId() === r.id
  return `
    <div class="mmc-vc ${mine ? 'is-in' : ''}" data-vc-room="${r.id}">
      <div class="mmc-vc-row ${full && !mine ? 'is-full' : ''}" data-vc="${r.id}" title="${mine ? 'Talk verlassen' : (full ? 'Talk ist voll' : 'Talk beitreten')}">
        <span class="mmc-vc-ic">${ICON.speaker}</span>
        <span class="mmc-vc-name">${esc(r.title)}</span>
        <span class="mmc-vc-count">${r.members.length}/${r.capacity}</span>
      </div>
      ${r.members.map(m => {
        const vp = r.voiceParticipants?.[m] || {}
        const speaking = !!vp.speaking
        const muted = !!vp.muted
        return `
        <div class="mmc-vc-member ${m === myName ? '' : 'mmc-vc-member--clickable'}${speaking ? ' is-speaking' : ''}" ${m === myName ? '' : `data-user="${esc(m)}"`}>
          <div class="mmc-avatar mmc-avatar--xs${speaking ? ' mmc-avatar--speaking' : ''}" style="background:${avatarColor(m)}">${avatarInner(m)}</div>
          <span>${esc(displayName(m))}${m === myName ? ' (du)' : ''}</span>
          ${muted ? `<span class="mmc-vc-muted" title="Stummgeschaltet">${MIC_OFF_ICON}</span>` : ''}
        </div>`
      }).join('')}
    </div>`
}

async function toggleVoiceRoom(root, roomId) {
  const groups = getGroups(); const g = groups.find(x => x.id === activeGroup); if (!g) return
  const r = (g.voiceRooms || []).find(x => x.id === roomId); if (!r) return
  const myName = getSession().username
  const session = getSession()
  const prefs = getPrefs()

  if (inVoiceRoom() && currentRoomId() === roomId) {
    // Raum verlassen
    await leaveVoiceRoom()
    r.members = r.members.filter(m => m !== myName)
    setGroups(groups)
    fillGroupChannels(root)
    return
  }

  if (r.members.length >= r.capacity && !r.members.includes(myName)) return

  // Anderen Raum ggf. verlassen
  if (inVoiceRoom()) await leaveVoiceRoom()

  const userId = session.id || session.username
  const res = await joinVoiceRoom(roomId, userId, myName, prefs, participants => {
    // Teilnehmerliste live aktualisieren
    const gs = getGroups(); const gCur = gs.find(x => x.id === activeGroup); if (!gCur) return
    const rCur = (gCur.voiceRooms || []).find(x => x.id === roomId); if (!rCur) return
    rCur.voiceParticipants = {}
    for (const p of participants) {
      rCur.voiceParticipants[p.username] = { muted: p.muted, speaking: p.speaking }
    }
    // Mitgliederliste aus Presence ableiten
    rCur.members = participants.map(p => p.username)
    setGroups(gs)
    fillGroupChannels(root)
  })

  if (!res.ok) {
    toast(root, res.error || 'Mikrofon-Zugriff fehlgeschlagen.')
    return
  }

  if (!r.members.includes(myName)) r.members.push(myName)
  setGroups(groups)
  fillGroupChannels(root)
}

/* ── In-Gruppe: Chat (rechter Hauptbereich) ────────────────────── */
function renderGroupChatMain(root) {
  const main = root.querySelector('#mmc-main'); if (!main) return
  const g = getGroups().find(x => x.id === activeGroup)
  if (!g) { activeGroup = null; renderApp(root); return }
  groupDefaults(g)
  if (!activeChannel || !g.channels.find(c => c.id === activeChannel)) {
    activeChannel = g.channels[0]?.id || null
  }
  const ch = g.channels.find(c => c.id === activeChannel)
  const msgs = ch?.messages || []
  const chName = ch?.name || 'allgemein'
  subscribeToChannel(activeChannel, null)
  // Remember last-read timestamp BEFORE marking as read (for NEU line)
  const prevReadTs = lastReadTs(g.id, activeChannel)
  markChannelRead(g.id, activeChannel)
  // Also refresh channel list badges
  fillGroupChannels(root)
  main.innerHTML = `
    <header class="mmc-chat-head">
      <span class="mmc-chat-title">#${esc(chName)}</span>
      <span class="mmc-chat-desc">${esc(g.name)} · Chat</span>
    </header>
    <div class="mmc-messages" id="mmc-messages"></div>
    ${composeHtml('Nachricht an #' + esc(chName))}`
  const box = main.querySelector('#mmc-messages')
  box.style.backgroundImage = `linear-gradient(rgba(10,10,10,0.80), rgba(10,10,10,0.84)), url('${commBg}')`
  box.style.backgroundRepeat = 'no-repeat, repeat'
  box.style.backgroundSize = 'cover, 480px auto'
  const emptyCtx = { title: chName, text: `Das ist der Anfang von #${chName}. Sag Hallo 👋`, avatar: g.name, hash: true }
  renderMessagesInto(root, box, msgs, emptyCtx, g, prevReadTs)
  bindComposeExtras(main, root)
  main.querySelector('#mmc-compose-form')?.addEventListener('submit', async e => {
    e.preventDefault()
    const input = main.querySelector('#mmc-compose-input')
    const form  = main.querySelector('#mmc-compose-form')
    const text  = input.value.trim()
    const image = form?._pendingAttachment || null
    if (!text && !image) return
    if (!OFFLINE_MODE && getSession()?.guest) { toast(root, 'Bitte melde dich an, um Nachrichten zu senden.'); return }
    await sendGroupMessage(activeGroup, activeChannel, text, replyingTo, image)
    input.value = ''; input.style.height = 'auto'
    form?._clearAttach?.()
    const rb = main.querySelector('#mmc-reply-bar')
    if (rb) { rb.hidden = true; rb.innerHTML = '' }
    replyingTo = null
    const gg = getGroups().find(x => x.id === activeGroup)
    if (gg) { groupDefaults(gg); const ch = gg.channels.find(c => c.id === activeChannel); renderMessagesInto(root, main.querySelector('#mmc-messages'), ch?.messages || [], { title: ch?.name || '', text: '', avatar: gg.name, hash: true }, gg) }
    input.focus()
  })
  requestAnimationFrame(() => main.querySelector('#mmc-compose-input')?.focus())
}
/* ── Einstellungs-Panel (Discord-Stil) ──────────────────────────── */
function openSettingsPanel(root) {
  if (root.querySelector('#mmc-settings-panel')) return

  const CATS = [
    { id: 'profil',          label: 'Mein Profil' },
    { id: 'datenschutz',     label: 'Datenschutz' },
    { id: 'benachrichtigungen', label: 'Benachrichtigungen' },
    { id: 'darstellung',     label: 'Darstellung' },
  ]
  let activeSettingsTab = 'profil'

  // Read available garage bikes from quiz answers
  function getGarageBikes() {
    const bikes = []
    try {
      const primary = localStorage.getItem('mm_primary_bike')
      if (primary) bikes.push(primary)
      const answers = JSON.parse(localStorage.getItem('motoMatchAnswers') || 'null')
    } catch {}
    return [...new Set(bikes)].filter(Boolean)
  }

  const overlay = document.createElement('div')
  overlay.id = 'mmc-settings-panel'
  overlay.className = 'mmc-settings-overlay'
  root.appendChild(overlay)

  const renderPanel = () => {
    const prof = getMyProfile()
    const prefs = getPrefs()
    const myName = me()
    const blocked = getBlocked()
    const mutes = getMutes()
    const mutedChats = Object.keys(mutes).filter(k => isMuted(k))
    const garageBikes = getGarageBikes()

    const navHtml = CATS.map(c => `
      <button class="mmc-sp-nav-item${c.id === activeSettingsTab ? ' is-active' : ''}" data-sp-cat="${c.id}">${esc(c.label)}</button>
    `).join('')

    let bodyHtml = ''

    if (activeSettingsTab === 'profil') {
      const colorSwatches = AVATAR_PALETTE.map(c => `
        <button type="button" class="mmc-sp-swatch${(prof.avatarColor || '') === c ? ' is-selected' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>
      `).join('')
      const bikeOptions = garageBikes.length
        ? garageBikes.map(b => `<option value="${esc(b)}"${prof.bikeText === b ? ' selected' : ''}>${esc(b)}</option>`).join('')
        : ''
      bodyHtml = `
        <h2 class="mmc-sp-heading">Mein Profil</h2>
        <form id="mmc-sp-profile-form" class="mmc-sp-form">
          <div class="mmc-sp-avatar-row">
            <div class="mmc-avatar mmc-sp-avatar" id="mmc-sp-avatar-preview" style="background:${avatarColor(myName)}">${avatarInner(myName)}</div>
            <div class="mmc-sp-swatch-grid">${colorSwatches}
              <button type="button" class="mmc-sp-swatch mmc-sp-swatch--clear${!prof.avatarColor ? ' is-selected' : ''}" data-color="" title="Automatisch">auto</button>
            </div>
          </div>
          <label class="mmc-field">
            <span class="mmc-field-label">Anzeigename</span>
            <input class="mmc-input" id="mmc-sp-displayname" type="text" maxlength="40" placeholder="${esc(myName)}" value="${esc(prof.displayName || '')}">
          </label>
          <label class="mmc-field">
            <span class="mmc-field-label">Benutzername (fest)</span>
            <input class="mmc-input" type="text" value="${esc(myName)}" disabled style="opacity:.4">
          </label>
          <label class="mmc-field">
            <span class="mmc-field-label">Status-Text <span style="opacity:.4">(erscheint unter deinem Namen)</span></span>
            <input class="mmc-input" id="mmc-sp-statustext" type="text" maxlength="60" placeholder="z. B. Unterwegs auf zwei Rädern 🏍️" value="${esc(prof.statusText || '')}">
          </label>
          <label class="mmc-field">
            <span class="mmc-field-label">Über mich <span style="opacity:.4">(max. 190 Zeichen)</span></span>
            <textarea class="mmc-input mmc-sp-bio" id="mmc-sp-bio" maxlength="190" rows="3" placeholder="Erzähl etwas über dich...">${esc(prof.bio || '')}</textarea>
            <span class="mmc-sp-charcount" id="mmc-sp-bio-count">${(prof.bio || '').length}/190</span>
          </label>
          <div class="mmc-sp-section-label">Motorrad im Profil</div>
          <label class="mmc-sp-toggle-row">
            <span>Mein Motorrad im Profil zeigen</span>
            <input type="checkbox" class="mmc-sp-toggle" id="mmc-sp-showbike"${prof.showBike ? ' checked' : ''}>
          </label>
          <div id="mmc-sp-bike-wrap" ${prof.showBike ? '' : 'hidden'}>
            ${garageBikes.length ? `
              <label class="mmc-field">
                <span class="mmc-field-label">Motorrad aus deiner Garage</span>
                <select class="mmc-input" id="mmc-sp-bike-select">
                  <option value="">Freitext eingeben…</option>
                  ${bikeOptions}
                </select>
              </label>` : ''}
            <label class="mmc-field">
              <span class="mmc-field-label">${garageBikes.length ? 'Oder freier Text' : 'Mein Motorrad'}</span>
              <input class="mmc-input" id="mmc-sp-biketext" type="text" maxlength="60" placeholder="z. B. Honda CB500F" value="${esc(prof.bikeText || '')}">
            </label>
          </div>
          <div class="mmc-sp-actions">
            <button type="submit" class="mmc-auth-submit mmc-auth-submit--sm">Speichern</button>
          </div>
        </form>`
    }

    if (activeSettingsTab === 'datenschutz') {
      const dmPol = prof.dmPolicy || 'all'
      bodyHtml = `
        <h2 class="mmc-sp-heading">Datenschutz</h2>
        <div class="mmc-sp-section-label">Direktnachrichten</div>
        <label class="mmc-field">
          <span class="mmc-field-label">Wer darf mir Direktnachrichten senden?</span>
          <select class="mmc-input" id="mmc-sp-dmpolicy">
            <option value="all"${dmPol === 'all' ? ' selected' : ''}>Alle</option>
            <option value="friends"${dmPol === 'friends' ? ' selected' : ''}>Nur Freunde</option>
          </select>
        </label>
        <div class="mmc-sp-section-label" style="margin-top:20px">Onlinestatus</div>
        <label class="mmc-sp-toggle-row">
          <div>
            <span>Onlinestatus anzeigen</span>
            <div style="font-size:12px;opacity:.5;margin-top:2px">Wenn deaktiviert, erscheinst du für andere als offline.</div>
          </div>
          <input type="checkbox" class="mmc-sp-toggle" id="mmc-sp-showonline"${prof.showOnline !== false ? ' checked' : ''}>
        </label>
        <div class="mmc-sp-section-label" style="margin-top:20px">Blockierte Nutzer</div>
        ${blocked.length ? blocked.map(b => `
          <div class="mmc-manage-row">
            <div class="mmc-avatar mmc-avatar--sm" style="background:${avatarColor(b)}">${avatarInner(b)}</div>
            <div class="mmc-manage-meta"><strong>${esc(displayName(b))}</strong></div>
            <button class="mmc-manage-ic" data-unblock="${esc(b)}" title="Entblocken">${ICON.undo}</button>
          </div>`).join('')
          : `<div class="mmc-friends-empty"><p>Keine blockierten Nutzer.</p></div>`}
        <div class="mmc-sp-privacy-save">
          <button type="button" class="mmc-auth-submit mmc-auth-submit--sm" id="mmc-sp-privacy-save">Speichern</button>
        </div>`
    }

    if (activeSettingsTab === 'benachrichtigungen') {
      const hasMutes = mutedChats.length > 0
      bodyHtml = `
        <h2 class="mmc-sp-heading">Benachrichtigungen</h2>
        <div class="mmc-sp-section-label">Töne</div>
        <label class="mmc-sp-toggle-row" style="opacity:.5;pointer-events:none" title="Kommt bald">
          <div>
            <span>Sounds aktivieren</span>
            <div style="font-size:12px;opacity:.7;margin-top:2px">kommt bald</div>
          </div>
          <input type="checkbox" class="mmc-sp-toggle" id="mmc-sp-sounds" disabled${prefs.notifySounds !== false ? ' checked' : ''}>
        </label>
        <div class="mmc-sp-section-label" style="margin-top:16px">Desktop-Benachrichtigungen</div>
        <label class="mmc-sp-toggle-row" style="opacity:.5;pointer-events:none" title="Kommt bald">
          <div>
            <span>Desktop-Benachrichtigungen</span>
            <div style="font-size:12px;opacity:.7;margin-top:2px">kommt bald</div>
          </div>
          <input type="checkbox" class="mmc-sp-toggle" id="mmc-sp-desktop" disabled${prefs.notifyDesktop !== false ? ' checked' : ''}>
        </label>
        ${hasMutes ? `
        <div class="mmc-sp-section-label" style="margin-top:20px">Stummgeschaltete Chats</div>
        ${mutedChats.map(k => {
          if (k.startsWith('dm/')) {
            return `<div class="mmc-manage-row">
              <div class="mmc-manage-meta"><strong>${esc('DM: ' + k.replace('dm/', ''))}</strong></div>
              <button class="mmc-manage-ic" data-unmute="${esc(k)}" title="Stummschaltung aufheben">${ICON.bell}</button>
            </div>`
          }
          const grp = getGroups().find(g => g.id === k)
          if (!grp) { removeMute(k); return '' }
          return `<div class="mmc-manage-row">
            <div class="mmc-manage-meta"><strong>${esc('Gruppe: ' + grp.name)}</strong></div>
            <button class="mmc-manage-ic" data-unmute="${esc(k)}" title="Stummschaltung aufheben">${ICON.bell}</button>
          </div>`
        }).join('')}` : ''}
        <div class="mmc-sp-actions" style="margin-top:20px">
          <button type="button" class="mmc-auth-submit mmc-auth-submit--sm" id="mmc-sp-notif-save">Speichern</button>
        </div>`
    }

    if (activeSettingsTab === 'darstellung') {
      bodyHtml = `
        <h2 class="mmc-sp-heading">Darstellung</h2>
        <div class="mmc-friends-empty"><p>Darstellungsoptionen kommen bald.</p></div>`
    }

    overlay.innerHTML = `
      <div class="mmc-sp-backdrop"></div>
      <div class="mmc-sp-shell">
        <nav class="mmc-sp-nav">
          <div class="mmc-sp-nav-head">Benutzereinstellungen</div>
          ${navHtml}
          <div class="mmc-sp-nav-sep"></div>
          <button class="mmc-sp-nav-item mmc-sp-nav-danger" id="mmc-sp-logout">Abmelden</button>
        </nav>
        <div class="mmc-sp-content">
          <button class="mmc-sp-close" id="mmc-sp-close" aria-label="Schließen">✕</button>
          ${bodyHtml}
        </div>
      </div>`

    requestAnimationFrame(() => overlay.classList.add('is-open'))

    // Nav switching — use mousedown so it fires before a potential submit blur,
    // and guard against propagated events from the form-submit rerender
    let navLocked = false
    overlay.querySelectorAll('[data-sp-cat]').forEach(btn => {
      btn.addEventListener('click', e => {
        if (navLocked) return
        activeSettingsTab = btn.dataset.spCat
        renderPanel()
      })
    })

    overlay.querySelector('#mmc-sp-close')?.addEventListener('click', close)
    overlay.querySelector('.mmc-sp-backdrop')?.addEventListener('click', close)
    overlay.querySelector('#mmc-sp-logout')?.addEventListener('click', async () => { close(); await logout(); resetNavState(); renderAuth(root) })

    // Profil tab
    if (activeSettingsTab === 'profil') {
      const bioEl = overlay.querySelector('#mmc-sp-bio')
      const countEl = overlay.querySelector('#mmc-sp-bio-count')
      bioEl?.addEventListener('input', () => { if (countEl) countEl.textContent = `${bioEl.value.length}/190` })

      const showBikeToggle = overlay.querySelector('#mmc-sp-showbike')
      const bikeWrap = overlay.querySelector('#mmc-sp-bike-wrap')
      showBikeToggle?.addEventListener('change', () => { if (bikeWrap) bikeWrap.hidden = !showBikeToggle.checked })

      const bikeSelect = overlay.querySelector('#mmc-sp-bike-select')
      const bikeTextEl = overlay.querySelector('#mmc-sp-biketext')
      bikeSelect?.addEventListener('change', () => { if (bikeSelect.value && bikeTextEl) bikeTextEl.value = bikeSelect.value })

      // Avatar color swatches
      overlay.querySelectorAll('.mmc-sp-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
          overlay.querySelectorAll('.mmc-sp-swatch').forEach(s => s.classList.remove('is-selected'))
          sw.classList.add('is-selected')
          const c = sw.dataset.color
          const preview = overlay.querySelector('#mmc-sp-avatar-preview')
          if (preview) preview.style.background = c || colorFor(myName)
        })
      })

      overlay.querySelector('#mmc-sp-profile-form')?.addEventListener('submit', async e => {
        e.preventDefault()
        navLocked = true; setTimeout(() => { navLocked = false }, 300)
        const selectedSwatch = overlay.querySelector('.mmc-sp-swatch.is-selected')
        await setMyProfile({
          displayName: overlay.querySelector('#mmc-sp-displayname')?.value.trim() || '',
          bio: overlay.querySelector('#mmc-sp-bio')?.value.trim() || '',
          statusText: overlay.querySelector('#mmc-sp-statustext')?.value.trim() || '',
          avatarColor: selectedSwatch?.dataset.color || '',
          showBike: overlay.querySelector('#mmc-sp-showbike')?.checked || false,
          bikeText: overlay.querySelector('#mmc-sp-biketext')?.value.trim() || '',
        })
        toast(root, 'Profil gespeichert.')
        // Refresh userbar to reflect display name / color
        const bar = root.querySelector('.mmc-userbar')
        if (bar) { bar.outerHTML = userbarHtml(getSession(), getPrefs()); bindApp(root) }
        renderPanel()
      })
    }

    // Datenschutz tab
    if (activeSettingsTab === 'datenschutz') {
      overlay.querySelectorAll('[data-unblock]').forEach(btn => {
        btn.addEventListener('click', async () => { await toggleBlock(btn.dataset.unblock); toast(root, `${btn.dataset.unblock} entblockt.`); renderPanel() })
      })
      overlay.querySelector('#mmc-sp-privacy-save')?.addEventListener('click', async () => {
        await setMyProfile({
          dmPolicy: overlay.querySelector('#mmc-sp-dmpolicy')?.value || 'all',
          showOnline: overlay.querySelector('#mmc-sp-showonline')?.checked !== false,
        })
        toast(root, 'Datenschutzeinstellungen gespeichert.')
      })
    }

    // Benachrichtigungen tab
    if (activeSettingsTab === 'benachrichtigungen') {
      overlay.querySelectorAll('[data-unmute]').forEach(btn => {
        btn.addEventListener('click', () => { removeMute(btn.dataset.unmute); toast(root, 'Stummschaltung aufgehoben.'); renderPanel() })
      })
      overlay.querySelector('#mmc-sp-notif-save')?.addEventListener('click', () => {
        const p = getPrefs()
        p.notifySounds = overlay.querySelector('#mmc-sp-sounds')?.checked !== false
        p.notifyDesktop = overlay.querySelector('#mmc-sp-desktop')?.checked !== false
        setPrefs(p)
        toast(root, 'Benachrichtigungseinstellungen gespeichert.')
      })
    }
  }

  const close = () => {
    overlay.classList.remove('is-open')
    setTimeout(() => overlay.remove(), 200)
    document.removeEventListener('keydown', onEsc)
  }
  const onEsc = e => { if (e.key === 'Escape') close() }
  document.addEventListener('keydown', onEsc)

  renderPanel()
}

/* ── Gruppen-Verwaltungspanel (Owner/Mod) ───────────────────────── */
function openManagePanel(root, initialTab = null) {
  if (root.querySelector('#mmc-manage-panel')) return
  const g = getGroups().find(x => x.id === activeGroup); if (!g) return
  groupDefaults(g)
  const ownerAccess = isOwner(g)
  let activeTab = initialTab || (groupRequestsFor(g.id).length > 0 ? 'requests' : 'members')

  const overlay = document.createElement('div')
  overlay.className = 'mmc-modal'; overlay.id = 'mmc-manage-panel'
  root.appendChild(overlay)

  const renderPanel = () => {
    const gCurrent = getGroups().find(x => x.id === activeGroup)
    if (!gCurrent) { overlay.remove(); return }
    groupDefaults(gCurrent)
    const reqs    = groupRequestsFor(gCurrent.id)
    const reps    = reportsForGroup(gCurrent.id)
    const tabs = [
      { id: 'requests', label: `Anfragen${reqs.length ? ` (${reqs.length})` : ''}`,  show: gCurrent.joinMode === 'request' || reqs.length > 0 },
      { id: 'reports',  label: `Meldungen${reps.length ? ` (${reps.length})` : ''}`, show: true },
      { id: 'members',  label: 'Mitglieder', show: true },
      { id: 'einladen', label: 'Einladen', show: true },
      { id: 'settings', label: 'Einstellungen', show: ownerAccess },
    ].filter(t => t.show)
    if (!tabs.find(t => t.id === activeTab)) activeTab = tabs[0]?.id || 'members'

    let bodyHtml = ''

    if (activeTab === 'requests') {
      bodyHtml = reqs.length
        ? reqs.map(r => `
          <div class="mmc-manage-row">
            <div class="mmc-avatar mmc-avatar--sm" style="background:${avatarColor(r.from)}">${avatarInner(r.from)}</div>
            <div class="mmc-manage-meta">
              <strong>${esc(displayName(r.from))}</strong>
              ${r.text ? `<p class="mmc-manage-sub">${esc(r.text)}</p>` : '<p class="mmc-manage-sub" style="opacity:.4">Kein Bewerbungstext</p>'}
            </div>
            <button class="mmc-req-btn mmc-req-accept" data-accept="${r.id}" title="Annehmen">✓</button>
            <button class="mmc-req-btn mmc-req-decline" data-decline="${r.id}" title="Ablehnen">✕</button>
          </div>`).join('')
        : `<div class="mmc-friends-empty"><p>Keine offenen Beitrittsanfragen.</p></div>`
    }

    if (activeTab === 'reports') {
      bodyHtml = reps.length
        ? reps.map(r => `
          <div class="mmc-manage-row mmc-report-row">
            <div class="mmc-avatar mmc-avatar--sm" style="background:${avatarColor(r.msgAuthor)}">${avatarInner(r.msgAuthor)}</div>
            <div class="mmc-manage-meta">
              <strong>${esc(displayName(r.msgAuthor))}</strong>
              <p class="mmc-manage-sub mmc-report-text">${esc(r.msgText)}</p>
              <span class="mmc-manage-sub" style="opacity:.45;font-size:.78em">Gemeldet von ${esc(displayName(r.reportedBy))}</span>
            </div>
            <div class="mmc-manage-actions">
              <button class="mmc-manage-ic mmc-manage-ic--danger" data-rep-delete="${r.id}" data-rep-msg="${r.msgId}" title="Nachricht löschen">${ICON.ban}</button>
              <button class="mmc-manage-ic" data-rep-dismiss="${r.id}" title="Meldung verwerfen">✕</button>
            </div>
          </div>`).join('')
        : `<div class="mmc-friends-empty"><p>Keine offenen Meldungen.</p></div>`
    }

    if (activeTab === 'members') {
      const myName = me()
      bodyHtml = gCurrent.members.map(m => {
        const mIsOwner = m.toLowerCase() === gCurrent.createdBy.toLowerCase()
        const mIsMod   = (gCurrent.moderators || []).some(x => x.toLowerCase() === m.toLowerCase())
        const isMe     = m.toLowerCase() === myName.toLowerCase()
        return `
          <div class="mmc-manage-row">
            <div class="mmc-avatar mmc-avatar--sm" style="background:${avatarColor(m)}">${avatarInner(m)}</div>
            <div class="mmc-manage-meta">
              <strong>${esc(displayName(m))}${isMe ? ' (du)' : ''}</strong>
              <span class="mmc-role-badge ${mIsOwner ? 'mmc-role-owner' : mIsMod ? 'mmc-role-mod' : 'mmc-role-member'}">
                ${mIsOwner ? ICON.crown + ' Host' : mIsMod ? ICON.shield + ' Mod' : 'Mitglied'}
              </span>
            </div>
            ${!isMe && !mIsOwner ? `
              <div class="mmc-manage-actions">
                ${ownerAccess ? `<button class="mmc-manage-ic ${mIsMod ? 'is-active' : ''}" data-toggle-mod="${esc(m)}" title="${mIsMod ? 'Mod entfernen' : 'Zum Mod machen'}">${ICON.shield}</button>` : ''}
                <button class="mmc-manage-ic" data-kick="${esc(m)}" title="Kicken">✕</button>
                <button class="mmc-manage-ic mmc-manage-ic--danger" data-ban="${esc(m)}" title="${ICON.ban} Sperren">${ICON.ban}</button>
              </div>` : ''}
          </div>`
      }).join('')
      if (gCurrent.banned?.length) {
        bodyHtml += `<div class="mmc-manage-section">Gesperrte Nutzer</div>`
        bodyHtml += gCurrent.banned.map(b => `
          <div class="mmc-manage-row mmc-manage-row--banned">
            <div class="mmc-avatar mmc-avatar--sm" style="background:${avatarColor(b)};opacity:.5">${avatarInner(b)}</div>
            <div class="mmc-manage-meta"><strong>${esc(displayName(b))}</strong><span style="opacity:.5;font-size:.8em">Gesperrt</span></div>
            <button class="mmc-manage-ic" data-unban="${esc(b)}" title="Entsperren">${ICON.undo}</button>
          </div>`).join('')
      }
    }

    if (activeTab === 'einladen') {
      const activeInvs = activeInvitesForGroup(gCurrent.id)
      bodyHtml = `
        <div class="mmc-invite-create">
          <h4 class="mmc-manage-section">Neuen Einladungscode erstellen</h4>
          <form class="mmc-invite-create-form" id="mmc-invite-create-form">
            <div class="mmc-invite-options">
              <label class="mmc-field">
                <span class="mmc-field-label">Gültigkeit</span>
                <select class="mmc-input" id="mmc-inv-validity">
                  <option value="1">1 Tag</option>
                  <option value="7" selected>7 Tage</option>
                  <option value="0">Unbegrenzt</option>
                </select>
              </label>
              <label class="mmc-field">
                <span class="mmc-field-label">Max. Nutzungen</span>
                <select class="mmc-input" id="mmc-inv-maxuses">
                  <option value="1">1×</option>
                  <option value="10">10×</option>
                  <option value="0" selected>Unbegrenzt</option>
                </select>
              </label>
            </div>
            <button type="submit" class="mmc-auth-submit mmc-auth-submit--sm">Code erstellen</button>
          </form>
        </div>
        <h4 class="mmc-manage-section">Aktive Codes</h4>
        ${activeInvs.length ? activeInvs.map(inv => `
          <div class="mmc-manage-row mmc-invite-row" data-code="${esc(inv.code)}">
            <div class="mmc-invite-code">${esc(inv.code)}</div>
            <div class="mmc-manage-meta">
              <span class="mmc-manage-sub">${fmtExpiry(inv.expiresAt)} · ${inv.maxUses === null ? `${inv.uses} Nutzungen` : `${inv.uses}/${inv.maxUses}`}</span>
            </div>
            <div class="mmc-manage-actions">
              <button class="mmc-manage-ic" data-copy-code="${esc(inv.code)}" title="Code kopieren">${ICON.clipboard}</button>
              <button class="mmc-manage-ic mmc-manage-ic--danger" data-revoke-code="${esc(inv.code)}" title="Widerrufen">✕</button>
            </div>
          </div>`).join('')
          : `<div class="mmc-friends-empty"><p>Keine aktiven Einladungscodes.</p></div>`}`
    }

    if (activeTab === 'settings') {
      const isEventCat = EVENT_CATS.has(gCurrent.category)
      const nowDtLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
      const currentDtLocal = gCurrent.eventAt
        ? new Date(gCurrent.eventAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)
        : ''
      bodyHtml = `
        <form id="mmc-settings-form" class="mmc-settings-form">
          <label class="mmc-field">
            <span class="mmc-field-label">Gruppenname</span>
            <input class="mmc-input" id="mmc-set-name" type="text" maxlength="48" value="${esc(gCurrent.name)}" required>
          </label>
          <label class="mmc-field">
            <span class="mmc-field-label">Beschreibung</span>
            <input class="mmc-input" id="mmc-set-desc" type="text" maxlength="120" value="${esc(gCurrent.desc || '')}">
          </label>
          ${isEventCat ? `
          <label class="mmc-field">
            <span class="mmc-field-label">Datum &amp; Uhrzeit <span style="opacity:.5">(optional)</span></span>
            <input class="mmc-input" id="mmc-set-eventat" type="datetime-local" value="${esc(currentDtLocal)}" min="${esc(nowDtLocal)}">
          </label>
          <label class="mmc-field">
            <span class="mmc-field-label">Treffpunkt <span style="opacity:.5">(optional, max. 80 Zeichen)</span></span>
            <input class="mmc-input" id="mmc-set-meetingpoint" type="text" maxlength="80" value="${esc(gCurrent.meetingPoint || '')}" placeholder="z. B. Parkplatz Titisee, B31">
          </label>` : ''}
          <label class="mmc-field">
            <span class="mmc-field-label">Beitrittsmodus</span>
            <select class="mmc-input" id="mmc-set-joinmode">
              <option value="open"    ${gCurrent.joinMode === 'open'    ? 'selected' : ''}>🔓 Offen</option>
              <option value="request" ${gCurrent.joinMode === 'request' ? 'selected' : ''}>📋 Anfrage</option>
              <option value="invite"  ${gCurrent.joinMode === 'invite'  ? 'selected' : ''}>🔒 Nur Einladung</option>
            </select>
          </label>
          <div class="mmc-modal-actions">
            <button type="submit" class="mmc-auth-submit mmc-auth-submit--sm">Änderungen speichern</button>
          </div>
        </form>
        <div class="mmc-manage-danger">
          <div class="mmc-manage-section">Gefahrenzone</div>
          <button class="mmc-danger-btn" id="mmc-delete-group">Gruppe löschen</button>
        </div>`
    }

    overlay.innerHTML = `
      <div class="mmc-modal-backdrop" id="mmc-manage-backdrop"></div>
      <div class="mmc-modal-card mmc-manage-card">
        <div class="mmc-manage-header">
          <h3 class="mmc-modal-title">${ICON.manage} ${esc(gCurrent.name)} verwalten</h3>
          <button class="mmc-manage-close" id="mmc-manage-close">✕</button>
        </div>
        <div class="mmc-tabs mmc-manage-tabs">
          ${tabs.map(t => `<button class="mmc-tab ${activeTab === t.id ? 'is-active' : ''}" data-mtab="${t.id}">${t.label}</button>`).join('')}
        </div>
        <div class="mmc-manage-body">${bodyHtml}</div>
      </div>`
    requestAnimationFrame(() => overlay.classList.add('mmc-modal--open'))

    const close = () => { overlay.classList.remove('mmc-modal--open'); setTimeout(() => overlay.remove(), 200); fillGroupChannels(root) }
    overlay.querySelector('#mmc-manage-backdrop')?.addEventListener('click', close)
    overlay.querySelector('#mmc-manage-close')?.addEventListener('click', close)
    overlay.querySelectorAll('[data-mtab]').forEach(b => b.addEventListener('click', () => { activeTab = b.dataset.mtab; renderPanel() }))

    // Anfragen
    overlay.querySelectorAll('[data-accept]').forEach(b => b.addEventListener('click', async () => { await acceptGroupRequest(b.dataset.accept); renderPanel(); fillGroupChannels(root) }))
    overlay.querySelectorAll('[data-decline]').forEach(b => b.addEventListener('click', async () => { await declineGroupRequest(b.dataset.decline); renderPanel() }))

    // Mitglieder
    overlay.querySelectorAll('[data-kick]').forEach(b => b.addEventListener('click', () => {
      const member = b.dataset.kick
      openConfirmModal(root, {
        title: `${member} entfernen?`,
        text: 'Die Person kann der Gruppe danach wieder beitreten.',
        confirmLabel: 'Entfernen',
        isDanger: true,
        onConfirm: async () => { await kickMember(activeGroup, member); renderPanel(); fillGroupChannels(root) },
      })
    }))
    overlay.querySelectorAll('[data-ban]').forEach(b => b.addEventListener('click', () => {
      const member = b.dataset.ban
      openConfirmModal(root, {
        title: `${member} sperren?`,
        text: 'Die Person kann dieser Gruppe nicht mehr beitreten.',
        confirmLabel: 'Sperren',
        isDanger: true,
        onConfirm: async () => { await banMember(activeGroup, member); renderPanel(); fillGroupChannels(root) },
      })
    }))
    overlay.querySelectorAll('[data-unban]').forEach(b => b.addEventListener('click', async () => {
      await unbanMember(activeGroup, b.dataset.unban)
      renderPanel()
    }))
    overlay.querySelectorAll('[data-toggle-mod]').forEach(b => b.addEventListener('click', async () => {
      await toggleMod(activeGroup, b.dataset.toggleMod); renderPanel(); fillGroupChannels(root)
    }))

    // Meldungen: Nachricht löschen
    overlay.querySelectorAll('[data-rep-delete]').forEach(b => b.addEventListener('click', async () => {
      await deleteGroupMessage(activeGroup, b.dataset.repMsg)
      await dismissReport(b.dataset.repDelete)
      const main = root.querySelector('#mmc-main')
      const msgBox = main?.querySelector('#mmc-messages')
      if (msgBox) {
        const updated = getGroups().find(g => g.id === activeGroup)
        if (updated) { groupDefaults(updated); renderMessagesInto(root, msgBox, channelMsgs(updated, activeChannel), { title: updated.name, text: '', avatar: updated.name, hash: !!activeChannel }, updated) }
      }
      renderPanel()
    }))

    // Meldungen: Nur Meldung verwerfen (Nachricht bleibt)
    overlay.querySelectorAll('[data-rep-dismiss]').forEach(b => b.addEventListener('click', async () => {
      await dismissReport(b.dataset.repDismiss); renderPanel()
    }))

    // Einladen-Tab
    overlay.querySelector('#mmc-invite-create-form')?.addEventListener('submit', async e => {
      e.preventDefault()
      const validityDays = parseInt(overlay.querySelector('#mmc-inv-validity').value, 10)
      const maxUses = parseInt(overlay.querySelector('#mmc-inv-maxuses').value, 10)
      const inv = await createInvite(activeGroup, { validityDays, maxUses })
      navigator.clipboard?.writeText(inv.code).catch(() => {})
      toast(root, `Code „${inv.code}" erstellt und kopiert.`)
      renderPanel()
    })
    overlay.querySelectorAll('[data-copy-code]').forEach(b => b.addEventListener('click', () => {
      const code = b.dataset.copyCode
      navigator.clipboard?.writeText(code).catch(() => {})
      toast(root, `Code „${code}" kopiert.`)
    }))
    overlay.querySelectorAll('[data-revoke-code]').forEach(b => b.addEventListener('click', async () => {
      await revokeInvite(b.dataset.revokeCode); renderPanel()
    }))

    // Einstellungen speichern
    overlay.querySelector('#mmc-settings-form')?.addEventListener('submit', async e => {
      e.preventDefault()
      const name = overlay.querySelector('#mmc-set-name').value.trim()
      if (name.length < 3) { toast(root, 'Name muss mind. 3 Zeichen haben.'); return }
      const patch = {
        name,
        desc: overlay.querySelector('#mmc-set-desc').value.trim(),
        joinMode: overlay.querySelector('#mmc-set-joinmode').value,
      }
      const dtVal = overlay.querySelector('#mmc-set-eventat')?.value
      if (dtVal !== undefined) {
        patch.eventAt = dtVal ? new Date(dtVal).getTime() : null
        patch.meetingPoint = overlay.querySelector('#mmc-set-meetingpoint')?.value.trim() || ''
      }
      await updateGroup(activeGroup, patch)
      toast(root, 'Einstellungen gespeichert.'); fillGroupChannels(root); renderPanel()
    })

    // Gruppe löschen
    overlay.querySelector('#mmc-delete-group')?.addEventListener('click', () => {
      openConfirmModal(root, {
        title: `„${gCurrent.name}" löschen?`,
        text: 'Alle Kanäle und Nachrichten gehen unwiederbringlich verloren.',
        confirmLabel: 'Gruppe löschen',
        isDanger: true,
        onConfirm: async () => {
          await deleteGroup(activeGroup)
          activeGroup = null; close(); renderApp(root)
        },
      })
    })
  }

  renderPanel()
}

function openVoiceRoom(root) {
  if (root.querySelector('#mmc-modal')) return
  const overlay = document.createElement('div')
  overlay.className = 'mmc-modal'; overlay.id = 'mmc-modal'
  overlay.innerHTML = `
    <div class="mmc-modal-backdrop" id="mmc-modal-backdrop"></div>
    <div class="mmc-modal-card">
      <h3 class="mmc-modal-title">Sprachraum öffnen</h3>
      <p class="mmc-modal-sub">Andere Mitglieder können beitreten, bis der Raum voll ist.</p>
      <form id="mmc-modal-form">
        <label class="mmc-field">
          <span class="mmc-field-label">Name des Raums</span>
          <input class="mmc-input" id="mmc-vr-name" type="text" maxlength="40" placeholder="z. B. Routenplanung" required>
        </label>
        <label class="mmc-field">
          <span class="mmc-field-label">Kapazität</span>
          <select class="mmc-input" id="mmc-vr-cap">
            <option value="2">2 Personen</option>
            <option value="4" selected>4 Personen</option>
            <option value="6">6 Personen</option>
            <option value="10">10 Personen</option>
          </select>
        </label>
        <div class="mmc-auth-error" id="mmc-modal-error" hidden></div>
        <div class="mmc-modal-actions">
          <button type="button" class="mmc-btn-ghost" id="mmc-modal-cancel">Abbrechen</button>
          <button type="submit" class="mmc-auth-submit mmc-auth-submit--sm">Öffnen</button>
        </div>
      </form>
    </div>`
  root.appendChild(overlay)
  requestAnimationFrame(() => overlay.classList.add('mmc-modal--open'))
  const close = () => { overlay.classList.remove('mmc-modal--open'); setTimeout(() => overlay.remove(), 200) }
  overlay.querySelector('#mmc-modal-backdrop')?.addEventListener('click', close)
  overlay.querySelector('#mmc-modal-cancel')?.addEventListener('click', close)
  overlay.querySelector('#mmc-modal-form')?.addEventListener('submit', e => {
    e.preventDefault()
    const title = overlay.querySelector('#mmc-vr-name').value.trim()
    const capacity = parseInt(overlay.querySelector('#mmc-vr-cap').value, 10) || 4
    const errEl = overlay.querySelector('#mmc-modal-error')
    if (title.length < 2) { errEl.hidden = false; errEl.textContent = 'Bitte gib einen Namen ein.'; return }
    const groups = getGroups(); const g = groups.find(x => x.id === activeGroup); if (!g) return
    ;(g.voiceRooms ||= []).push({ id: 'vr-' + Date.now(), title, capacity, members: [getSession().username] })
    setGroups(groups)
    close()
    fillGroupChannels(root)
  })
  requestAnimationFrame(() => overlay.querySelector('#mmc-vr-name')?.focus())
}

/* ── Wiederverwendbares Bestätigungs-Modal ──────────────────────── */
/**
 * opts: { title, text?, confirmLabel, isDanger?, inputPlaceholder?, inputValue?, onConfirm(value) }
 * Wenn inputPlaceholder gesetzt ist, wird ein Textfeld angezeigt und value wird als string übergeben.
 * Ohne Textfeld wird onConfirm() ohne Argument aufgerufen.
 */
function openConfirmModal(root, opts) {
  const { title, text, confirmLabel, isDanger, inputPlaceholder, inputValue, onConfirm } = opts
  if (root.querySelector('#mmc-confirm-modal')) return
  const overlay = document.createElement('div')
  overlay.className = 'mmc-modal'; overlay.id = 'mmc-confirm-modal'
  overlay.innerHTML = `
    <div class="mmc-modal-backdrop" id="mmc-confirm-backdrop"></div>
    <div class="mmc-modal-card">
      <h3 class="mmc-modal-title">${esc(title)}</h3>
      ${text ? `<p class="mmc-modal-sub">${esc(text)}</p>` : ''}
      ${inputPlaceholder !== undefined ? `
      <label class="mmc-field">
        <input class="mmc-input" id="mmc-confirm-input" type="text" maxlength="48"
          placeholder="${esc(inputPlaceholder)}" value="${esc(inputValue || '')}">
      </label>` : ''}
      <div class="mmc-modal-actions">
        <button type="button" class="mmc-btn-ghost" id="mmc-confirm-cancel">Abbrechen</button>
        <button type="button" class="mmc-auth-submit mmc-auth-submit--sm${isDanger ? ' mmc-auth-submit--danger' : ''}" id="mmc-confirm-ok">${esc(confirmLabel)}</button>
      </div>
    </div>`
  root.appendChild(overlay)
  requestAnimationFrame(() => overlay.classList.add('mmc-modal--open'))
  const close = () => { overlay.classList.remove('mmc-modal--open'); setTimeout(() => overlay.remove(), 200) }
  setTimeout(() => overlay.querySelector('#mmc-confirm-backdrop')?.addEventListener('click', close), 0)
  overlay.querySelector('#mmc-confirm-cancel')?.addEventListener('click', close)
  overlay.querySelector('#mmc-confirm-ok')?.addEventListener('click', () => {
    const val = overlay.querySelector('#mmc-confirm-input')?.value ?? undefined
    close()
    onConfirm(val)
  })
  if (inputPlaceholder !== undefined) {
    requestAnimationFrame(() => overlay.querySelector('#mmc-confirm-input')?.focus())
    overlay.querySelector('#mmc-confirm-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); overlay.querySelector('#mmc-confirm-ok')?.click() }
      if (e.key === 'Escape') { e.preventDefault(); close() }
    })
  }
}

/* ── Textkanal erstellen ────────────────────────────────────────── */
function openCreateChannel(root) {
  if (root.querySelector('#mmc-modal')) return
  const overlay = document.createElement('div')
  overlay.className = 'mmc-modal'; overlay.id = 'mmc-modal'
  overlay.innerHTML = `
    <div class="mmc-modal-backdrop" id="mmc-modal-backdrop"></div>
    <div class="mmc-modal-card">
      <h3 class="mmc-modal-title">Textkanal erstellen</h3>
      <p class="mmc-modal-sub">Name wird automatisch zu Kleinbuchstaben-mit-Bindestrichen normalisiert.</p>
      <form id="mmc-modal-form">
        <label class="mmc-field">
          <span class="mmc-field-label">Kanalname</span>
          <input class="mmc-input" id="mmc-ch-name" type="text" maxlength="24" placeholder="z. B. touren" required>
        </label>
        <div class="mmc-auth-error" id="mmc-modal-error" hidden></div>
        <div class="mmc-modal-actions">
          <button type="button" class="mmc-btn-ghost" id="mmc-modal-cancel">Abbrechen</button>
          <button type="submit" class="mmc-auth-submit mmc-auth-submit--sm">Erstellen</button>
        </div>
      </form>
    </div>`
  root.appendChild(overlay)
  requestAnimationFrame(() => overlay.classList.add('mmc-modal--open'))
  const close = () => { overlay.classList.remove('mmc-modal--open'); setTimeout(() => overlay.remove(), 200) }
  overlay.querySelector('#mmc-modal-backdrop')?.addEventListener('click', close)
  overlay.querySelector('#mmc-modal-cancel')?.addEventListener('click', close)
  overlay.querySelector('#mmc-modal-form')?.addEventListener('submit', e => {
    e.preventDefault()
    const nameRaw = overlay.querySelector('#mmc-ch-name').value.trim()
    const name = slug(nameRaw)
    const errEl = overlay.querySelector('#mmc-modal-error')
    if (!name) { errEl.hidden = false; errEl.textContent = 'Bitte gib einen gültigen Namen ein.'; return }
    const groups = getGroups(); const g = groups.find(x => x.id === activeGroup); if (!g) return
    groupDefaults(g)
    if (g.channels.some(c => c.name === name)) { errEl.hidden = false; errEl.textContent = 'Ein Kanal mit diesem Namen existiert bereits.'; return }
    const newCh = { id: 'c-' + Date.now(), name, messages: [] }
    g.channels.push(newCh)
    setGroups(groups)
    activeChannel = newCh.id
    close()
    fillGroupChannels(root)
    renderGroupChatMain(root)
  })
  requestAnimationFrame(() => overlay.querySelector('#mmc-ch-name')?.focus())
}

/* ── Shared message list renderer ──────────────────────────────── */
function renderMessagesInto(root, box, msgs, empty, groupCtx = null, prevReadTs = 0) {
  if (!box) return
  if (!msgs.length) {
    box.innerHTML = `
      <div class="mmc-empty">
        <div class="mmc-empty-hash">${empty.hash ? '#' : `<div class="mmc-avatar mmc-avatar--lg" style="background:${colorFor(empty.avatar || empty.title)}">${initials(displayName(empty.avatar || empty.title))}</div>`}</div>
        <h3>${empty.hash ? 'Willkommen in #' + esc(empty.title) : esc(empty.title)}</h3>
        <p>${esc(empty.text)}</p>
      </div>`
    return
  }
  const myName = me()
  const clickable = m => !m.system && m.author.toLowerCase() !== myName.toLowerCase()

  const canDeleteMsg = m => {
    if (m.system) return false
    if (groupCtx) {
      if (m.author.toLowerCase() === myName.toLowerCase()) return true
      return canManage(groupCtx)
    }
    return !!activeDM && m.author.toLowerCase() === myName.toLowerCase()
  }
  const canReportMsg = m => {
    if (!groupCtx || m.system) return false
    return m.author.toLowerCase() !== myName.toLowerCase() && !canManage(groupCtx)
  }

  const FIVE_MIN = 5 * 60 * 1000
  let prevAuthor = null, prevTs = 0, prevDay = null
  const parts = []
  // Find the first unread message (by others, after prevReadTs)
  let neuInserted = false
  const firstUnreadIdx = prevReadTs > 0
    ? msgs.findIndex(m => m.ts > prevReadTs && m.author.toLowerCase() !== myName.toLowerCase())
    : -1

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i]
    const mDay = new Date(m.ts).toDateString()

    // Insert NEU divider before first unread message
    if (!neuInserted && firstUnreadIdx >= 0 && i === firstUnreadIdx) {
      parts.push(`<div class="mmc-new-sep" id="mmc-new-sep"><span>NEU</span></div>`)
      neuInserted = true
    }

    if (mDay !== prevDay) {
      parts.push(`<div class="mmc-date-sep"><span>${fmtDateSep(m.ts)}</span></div>`)
      prevDay = mDay
      prevAuthor = null
    }

    // Collapsed blocked messages (only in group chats, not own messages)
    if (groupCtx && !m.system && m.author.toLowerCase() !== myName.toLowerCase() && isBlocked(m.author)) {
      parts.push(`<div class="mmc-blocked-msg" data-blocked-id="${esc(m.id)}">
        <span class="mmc-blocked-label">1 blockierte Nachricht</span>
        <button class="mmc-blocked-show" data-blocked-show="${esc(m.id)}">Anzeigen</button>
      </div>`)
      prevAuthor = null; prevTs = 0
      continue
    }

    const grouped = !m.system
      && m.author === prevAuthor
      && (m.ts - prevTs) < FIVE_MIN

    const isOwn = !m.system && m.author.toLowerCase() === myName.toLowerCase()
    const del = canDeleteMsg(m)
    const rep = canReportMsg(m)
    const actions = !m.system ? `
      <div class="mmc-msg-actions">
        <button class="mmc-msg-act mmc-msg-act--react" data-react-open="${esc(m.id)}" title="Reaktion hinzufügen">${ICON.react}</button>
        ${!isOwn ? `<button class="mmc-msg-act mmc-msg-act--reply" data-reply-msg="${esc(m.id)}" data-reply-author="${esc(m.author)}" data-reply-text="${esc(m.text)}" title="Antworten">${ICON.reply}</button>` : ''}
        ${isOwn ? `<button class="mmc-msg-act mmc-msg-act--edit" data-edit-msg="${esc(m.id)}" title="Bearbeiten">${ICON.pencil}</button>` : ''}
        ${del ? `<button class="mmc-msg-act mmc-msg-act--del" data-del-msg="${esc(m.id)}" title="Nachricht löschen">${ICON.trash}</button>` : ''}
        ${rep ? `<button class="mmc-msg-act mmc-msg-act--rep" data-rep-msg="${esc(m.id)}" data-rep-author="${esc(m.author)}" data-rep-text="${esc(m.text)}" title="Melden">${ICON.report}</button>` : ''}
      </div>` : ''

    const pills = reactionPillsHtml(m.reactions, myName)
    const editLabel = m.editedTs ? ` <span class="mmc-edited">(bearbeitet)</span>` : ''
    const imgHtml = m.image ? `<img class="mmc-msg-image" src="${esc(m.image)}" alt="Anhang" loading="lazy" data-img-src="${esc(m.image)}">` : ''
    const replyQuote = m.replyTo ? `
      <div class="mmc-reply-quote" data-reply-to="${esc(m.replyTo.id)}">
        <span class="mmc-reply-quote-author">${esc(displayName(m.replyTo.author))}</span>
        <span class="mmc-reply-quote-text">${esc((m.replyTo.text || '').slice(0, 80))}${(m.replyTo.text || '').length > 80 ? '…' : ''}</span>
      </div>` : ''

    if (grouped) {
      parts.push(`
        <div class="mmc-msg mmc-msg--cont${m.system ? ' mmc-msg--system' : ''}" data-msg-id="${esc(m.id)}">
          <div class="mmc-msg-avatar-ph" aria-hidden="true"><span class="mmc-msg-cont-time">${fmtTimeShort(m.ts)}${editLabel}</span></div>
          <div class="mmc-msg-body">
            ${replyQuote}
            <div class="mmc-msg-text">${renderText(m.text)}</div>
            ${imgHtml}
            ${pills}
          </div>
          ${actions}
        </div>`)
    } else {
      parts.push(`
        <div class="mmc-msg${m.system ? ' mmc-msg--system' : ''}" data-msg-id="${esc(m.id)}">
          <div class="mmc-avatar mmc-avatar--sm ${clickable(m) ? 'mmc-avatar--clickable' : ''}" ${clickable(m) ? `data-user="${esc(m.author)}"` : ''} style="background:${avatarColor(m.author)}">${avatarInner(m.author)}</div>
          <div class="mmc-msg-body">
            <div class="mmc-msg-head">
              <span class="mmc-msg-author${clickable(m) ? ' mmc-msg-author--clickable' : ''}" ${clickable(m) ? `data-user="${esc(m.author)}"` : ''}>${esc(displayName(m.author))}</span>
              <span class="mmc-msg-time">${fmtTime(m.ts)}${editLabel}</span>
            </div>
            ${replyQuote}
            <div class="mmc-msg-text">${renderText(m.text)}</div>
            ${imgHtml}
            ${pills}
          </div>
          ${actions}
        </div>`)
    }

    if (!m.system) { prevAuthor = m.author; prevTs = m.ts }
    else prevAuthor = null
  }

  box.innerHTML = parts.join('')
  const neuEl = box.querySelector('#mmc-new-sep')
  if (neuEl) {
    requestAnimationFrame(() => neuEl.scrollIntoView({ block: 'center' }))
  } else {
    box.scrollTop = box.scrollHeight
  }

  box.querySelectorAll('[data-user]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation(); openUserProfile(root, el.dataset.user)
  }))

  // Bild-Vollansicht beim Klick
  box.querySelectorAll('[data-img-src]').forEach(img => img.addEventListener('click', () => {
    const ov = document.createElement('div')
    ov.className = 'mmc-img-lightbox'
    ov.innerHTML = `<div class="mmc-img-lightbox-backdrop"></div><img class="mmc-img-lightbox-img" src="${esc(img.dataset.imgSrc)}" alt="">`
    document.body.appendChild(ov)
    requestAnimationFrame(() => ov.classList.add('is-open'))
    const close = () => { ov.classList.remove('is-open'); setTimeout(() => ov.remove(), 200) }
    ov.querySelector('.mmc-img-lightbox-backdrop').addEventListener('click', close)
    ov.querySelector('.mmc-img-lightbox-img').addEventListener('click', e => e.stopPropagation())
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey) } })
  }))

  // Reaktions-Picker öffnen
  box.querySelectorAll('[data-react-open]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation()
    openReactPicker(root, box, btn, btn.dataset.reactOpen, msgs, empty, groupCtx)
  }))

  // Reaktions-Pill toggeln
  box.querySelectorAll('[data-react-emoji]').forEach(pill => {
    const msgEl = pill.closest('[data-msg-id]')
    const msgId = msgEl?.dataset.msgId
    if (!msgId) return
    pill.addEventListener('click', e => {
      e.stopPropagation()
      if (groupCtx) {
        toggleReactionInGroup(groupCtx.id, msgId, pill.dataset.reactEmoji)
        const updated = getGroups().find(g => g.id === groupCtx.id)
        if (updated) { groupDefaults(updated); renderMessagesInto(root, box, channelMsgs(updated, activeChannel), empty, updated) }
      } else if (activeDM) {
        toggleReactionInDM(activeDM, msgId, pill.dataset.reactEmoji)
        renderMessagesInto(root, box, getDMs()[activeDM] || [], empty, null)
      }
    })
  })

  // Antworten-Button → Reply-Bar anzeigen
  box.querySelectorAll('[data-reply-msg]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation()
    replyingTo = { id: btn.dataset.replyMsg, author: btn.dataset.replyAuthor, text: btn.dataset.replyText }
    const replyBar = box.parentElement?.querySelector('#mmc-reply-bar')
    if (replyBar) {
      replyBar.hidden = false
      replyBar.innerHTML = `
        <div class="mmc-reply-bar-inner">
          <span class="mmc-reply-bar-icon">↩</span>
          <div class="mmc-reply-bar-text">Antwort an <strong>${esc(displayName(replyingTo.author))}</strong>: <em>${esc(replyingTo.text.slice(0, 60))}${replyingTo.text.length > 60 ? '…' : ''}</em></div>
          <button class="mmc-reply-bar-close" id="mmc-reply-cancel" title="Abbrechen">✕</button>
        </div>`
      replyBar.querySelector('#mmc-reply-cancel')?.addEventListener('click', () => {
        replyingTo = null; replyBar.hidden = true; replyBar.innerHTML = ''
      })
    }
    box.parentElement?.querySelector('#mmc-compose-input')?.focus()
  }))

  // Zitat-Klick → Originalnachricht scrollen + blinken
  box.querySelectorAll('[data-reply-to]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation()
    const target = box.querySelector(`[data-msg-id="${el.dataset.replyTo}"]`)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target.classList.add('mmc-msg--blink')
      setTimeout(() => target.classList.remove('mmc-msg--blink'), 1500)
    }
  }))

  // Bearbeiten-Button → Inline-Edit
  box.querySelectorAll('[data-edit-msg]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation()
    const msgId = btn.dataset.editMsg
    const msgEl = box.querySelector(`[data-msg-id="${msgId}"]`)
    const textEl = msgEl?.querySelector('.mmc-msg-text')
    const origMsg = msgs.find(m => m.id === msgId)
    if (!msgEl || !textEl || !origMsg) return
    const actionsEl = msgEl.querySelector('.mmc-msg-actions')
    if (actionsEl) actionsEl.style.display = 'none'
    const ta = document.createElement('textarea')
    ta.className = 'mmc-edit-input'; ta.value = origMsg.text
    textEl.replaceWith(ta); ta.focus(); ta.select()
    const cancel = () => {
      const div = document.createElement('div')
      div.className = 'mmc-msg-text'; div.innerHTML = renderText(origMsg.text)
      ta.replaceWith(div)
      if (actionsEl) actionsEl.style.removeProperty('display')
    }
    const save = async () => {
      const newText = ta.value.trim()
      if (!newText || newText === origMsg.text) { cancel(); return }
      if (groupCtx) {
        await editMessageInGroup(groupCtx.id, msgId, newText)
        const updated = getGroups().find(g => g.id === groupCtx.id)
        if (updated) { groupDefaults(updated); renderMessagesInto(root, box, channelMsgs(updated, activeChannel), empty, updated) }
      } else if (activeDM) {
        await editMessageInDM(activeDM, msgId, newText)
        renderMessagesInto(root, box, getDMs()[activeDM] || [], empty, null)
      }
    }
    ta.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); save() }
      if (ev.key === 'Escape') { ev.preventDefault(); cancel() }
    })
  }))

  if (groupCtx) {
    box.querySelectorAll('[data-del-msg]').forEach(btn => btn.addEventListener('click', async e => {
      e.stopPropagation()
      await deleteGroupMessage(groupCtx.id, btn.dataset.delMsg)
      const updated = getGroups().find(g => g.id === groupCtx.id)
      if (updated) { groupDefaults(updated); renderMessagesInto(root, box, channelMsgs(updated, activeChannel), empty, updated) }
    }))

    box.querySelectorAll('[data-rep-msg]').forEach(btn => btn.addEventListener('click', async e => {
      e.stopPropagation()
      const res = await reportMessage(groupCtx.id, btn.dataset.repMsg, btn.dataset.repAuthor, btn.dataset.repText, activeChannel)
      toast(root, res.ok ? 'Nachricht gemeldet — ein Moderator wird sie prüfen.' : res.error)
      btn.disabled = true; btn.style.opacity = '.3'
    }))
  }

  if (!groupCtx && activeDM) {
    box.querySelectorAll('[data-del-msg]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation()
      const msgId = btn.dataset.delMsg
      openConfirmModal(root, {
        title: 'Nachricht löschen?',
        text: 'Diese Aktion kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        isDanger: true,
        onConfirm: async () => {
          await deleteDMMessage(activeDM, msgId)
          renderMessagesInto(root, box, getDMs()[activeDM] || [], empty, null)
        },
      })
    }))
  }

  // Expand blocked message on click
  box.querySelectorAll('[data-blocked-show]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation()
    const msgId = btn.dataset.blockedShow
    const wrapper = btn.closest('[data-blocked-id]')
    if (!wrapper) return
    const m = msgs.find(x => x.id === msgId)
    if (!m) return
    const clickable = !m.system && m.author.toLowerCase() !== myName.toLowerCase()
    const pills = reactionPillsHtml(m.reactions, myName)
    const expanded = document.createElement('div')
    expanded.className = 'mmc-msg mmc-msg--blocked-expanded'
    expanded.dataset.msgId = m.id
    expanded.innerHTML = `
      <div class="mmc-avatar mmc-avatar--sm ${clickable ? 'mmc-avatar--clickable' : ''}" ${clickable ? `data-user="${esc(m.author)}"` : ''} style="background:${avatarColor(m.author)};opacity:.55">${avatarInner(m.author)}</div>
      <div class="mmc-msg-body" style="opacity:.65">
        <div class="mmc-msg-head">
          <span class="mmc-msg-author">${esc(displayName(m.author))}</span>
          <span class="mmc-msg-time">${fmtTime(m.ts)}</span>
        </div>
        <div class="mmc-msg-text">${renderText(m.text)}</div>
        ${pills}
      </div>`
    expanded.querySelectorAll('[data-user]').forEach(el => el.addEventListener('click', ev => {
      ev.stopPropagation(); openUserProfile(root, el.dataset.user)
    }))
    wrapper.replaceWith(expanded)
  }))
}

/* ══════════════════════════════════════════════════════════════════
   RIGHT PANEL — Jetzt aktiv
   ══════════════════════════════════════════════════════════════════ */
/* Nach Freund-Aktionen (annehmen/ablehnen/hinzufügen) die Seitenleiste + Badges neu ziehen */
function refreshFriendsChrome(root) {
  fillHomeColumn(root)
  fillActive(root)
}

function fillActive(root) {
  const el = root.querySelector('#mmc-active')
  const mmc = root.querySelector('.mmc')
  if (!el) return
  // „Jetzt aktiv" nur auf der Freunde-Ansicht (nicht bei Nachrichten/DM)
  if (homeSection !== 'friends' || activeDM) {
    el.innerHTML = ''
    mmc?.classList.add('mmc--noactive') // Spalte kollabieren, kein Leerraum rechts
    return
  }
  mmc?.classList.remove('mmc--noactive')
  el.innerHTML = `
    <h3 class="mmc-active-title">Jetzt aktiv</h3>
    <div class="mmc-active-empty">
      <h4>Bisher ist alles ruhig …</h4>
      <p>Wenn ein Freund aktiv wird, siehst du es hier.</p>
    </div>`
}

/* ── Mute-Popover ───────────────────────────────────────────────── */
function openMuteMenu(root, key, isDM) {
  document.querySelectorAll('.mmc-mute-pop').forEach(x => x.remove())
  const muted = isMuted(key)
  const options = muted
    ? [{ label: 'Stummschaltung aufheben', value: 'unmute' }]
    : [
        { label: '8 Stunden', value: '8h' },
        { label: '1 Woche', value: '1w' },
        { label: 'Für immer', value: 'forever' },
      ]

  const pop = document.createElement('div')
  pop.className = 'mmc-mute-pop'
  pop.innerHTML = `
    <div class="mmc-mute-pop-title">${muted ? 'Stummgeschaltet' : 'Stummschalten'}</div>
    ${options.map(o => `<button class="mmc-um-item" data-mute-val="${o.value}">${o.label}</button>`).join('')}`

  const anchor = root.querySelector('#mmc-group-bell') || root.querySelector('#mmc-dm-bell')
  document.body.appendChild(pop)
  if (anchor) {
    const r = anchor.getBoundingClientRect()
    pop.style.top = (r.bottom + 4) + 'px'
    pop.style.left = Math.max(8, r.right - pop.offsetWidth || r.left) + 'px'
  }
  requestAnimationFrame(() => {
    if (anchor) {
      const r = anchor.getBoundingClientRect()
      pop.style.left = Math.max(8, r.right - pop.offsetWidth) + 'px'
    }
    pop.classList.add('is-open')
  })

  const close = () => { pop.remove(); document.removeEventListener('click', onDoc) }
  const onDoc = ev => { if (!pop.contains(ev.target) && ev.target !== anchor) close() }
  setTimeout(() => document.addEventListener('click', onDoc), 0)

  pop.querySelectorAll('[data-mute-val]').forEach(btn => btn.addEventListener('click', () => {
    const val = btn.dataset.muteVal
    if (val === 'unmute') {
      removeMute(key)
      toast(root, 'Stummschaltung aufgehoben.')
    } else {
      const until = val === 'forever' ? 'forever'
        : val === '8h' ? Date.now() + 8 * 3600_000
        : Date.now() + 7 * 86400_000
      setMute(key, until)
      toast(root, val === 'forever' ? 'Für immer stummgeschaltet.' : val === '8h' ? '8 Stunden stummgeschaltet.' : '1 Woche stummgeschaltet.')
    }
    close()
    if (isDM) {
      const main = root.querySelector('#mmc-main')
      if (main && activeDM) renderDMView(main, root)
    } else {
      fillGroupChannels(root)
      fillCatRail(root)
    }
  }))
}

/* ── Karte-Tab mit Treffpunkt öffnen ───────────────────────────── */
function _openMapForPoint(point) {
  const karteBtn = document.querySelector('.konf-tb-wrap .tb-btn[data-tab="karte"]')
  if (karteBtn) {
    karteBtn.click()
    const fill = () => {
      const input = document.getElementById('kv-search-input')
      if (input) {
        input.value = point
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }))
      }
    }
    setTimeout(fill, 350)
  }
}

/* ── Small toast ───────────────────────────────────────────────── */
function toast(root, text) {
  root.querySelector('.mmc-toast')?.remove()
  const t = document.createElement('div')
  t.className = 'mmc-toast'; t.textContent = text
  root.querySelector('.mmc')?.appendChild(t)
  requestAnimationFrame(() => t.classList.add('is-show'))
  setTimeout(() => { t.classList.remove('is-show'); setTimeout(() => t.remove(), 250) }, 2200)
}

/* ── Create a group / entry within the active category ─────────── */
function openCreateGroup(root) {
  if (root.querySelector('#mmc-modal')) return
  const cat = catById(serverCategory)
  const isEvent = EVENT_CATS.has(serverCategory)
  const overlay = document.createElement('div')
  overlay.className = 'mmc-modal'
  overlay.id = 'mmc-modal'
  overlay.innerHTML = `
    <div class="mmc-modal-backdrop" id="mmc-modal-backdrop"></div>
    <div class="mmc-modal-card">
      <h3 class="mmc-modal-title">${esc(cat.verbNew)}</h3>
      <p class="mmc-modal-sub">In der Kategorie „${esc(cat.name)}". Andere können beitreten.</p>
      <form id="mmc-modal-form">
        <label class="mmc-field">
          <span class="mmc-field-label">Name</span>
          <input class="mmc-input" id="mmc-new-name" type="text" maxlength="48" placeholder="z. B. Schwarzwald Sonntagstour" required>
        </label>
        <label class="mmc-field">
          <span class="mmc-field-label">Beschreibung <span style="opacity:.5">(optional)</span></span>
          <input class="mmc-input" id="mmc-new-desc" type="text" maxlength="120" placeholder="Worum geht es?">
        </label>
        ${isEvent ? `
        <label class="mmc-field">
          <span class="mmc-field-label">Datum &amp; Uhrzeit <span style="opacity:.5">(optional)</span></span>
          <input class="mmc-input" id="mmc-new-eventat" type="datetime-local" min="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}">
        </label>
        <label class="mmc-field">
          <span class="mmc-field-label">Treffpunkt <span style="opacity:.5">(optional, max. 80 Zeichen)</span></span>
          <input class="mmc-input" id="mmc-new-meetingpoint" type="text" maxlength="80" placeholder="z. B. Parkplatz Titisee, B31">
        </label>` : ''}
        <label class="mmc-field">
          <span class="mmc-field-label">Beitrittsmodus</span>
          <select class="mmc-input" id="mmc-new-joinmode">
            <option value="open">🔓 Offen — jeder kann sofort beitreten</option>
            <option value="request">📋 Anfrage — Host muss zustimmen</option>
            <option value="invite">🔒 Nur Einladung — kein freier Beitritt</option>
          </select>
        </label>
        <div class="mmc-auth-error" id="mmc-modal-error" hidden></div>
        <div class="mmc-modal-actions">
          <button type="button" class="mmc-btn-ghost" id="mmc-modal-cancel">Abbrechen</button>
          <button type="submit" class="mmc-auth-submit mmc-auth-submit--sm">Erstellen</button>
        </div>
      </form>
    </div>
  `
  root.appendChild(overlay)
  requestAnimationFrame(() => overlay.classList.add('mmc-modal--open'))

  const close = () => { overlay.classList.remove('mmc-modal--open'); setTimeout(() => overlay.remove(), 200) }
  overlay.querySelector('#mmc-modal-backdrop')?.addEventListener('click', close)
  overlay.querySelector('#mmc-modal-cancel')?.addEventListener('click', close)

  overlay.querySelector('#mmc-modal-form')?.addEventListener('submit', async e => {
    e.preventDefault()
    const name = overlay.querySelector('#mmc-new-name').value.trim()
    const desc = overlay.querySelector('#mmc-new-desc').value.trim()
    const errEl = overlay.querySelector('#mmc-modal-error')
    if (name.length < 3) { errEl.hidden = false; errEl.textContent = 'Bitte gib einen Namen ein (mind. 3 Zeichen).'; return }
    const joinMode = overlay.querySelector('#mmc-new-joinmode').value || 'open'
    let eventAt, meetingPoint
    if (isEvent) {
      const dtVal = overlay.querySelector('#mmc-new-eventat')?.value
      if (dtVal) eventAt = new Date(dtVal).getTime()
      meetingPoint = overlay.querySelector('#mmc-new-meetingpoint')?.value.trim() || ''
    }
    const res = await createGroup({ category: serverCategory, name, desc, joinMode, eventAt, meetingPoint })
    if (!res.ok) { errEl.hidden = false; errEl.textContent = res.error || 'Fehler beim Erstellen.'; return }
    activeGroup = res.group.id; activeChannel = res.group.channels[0]?.id || null
    close()
    fillCol2(root)
    fillMain(root)
  })

  requestAnimationFrame(() => overlay.querySelector('#mmc-new-name')?.focus())
}
