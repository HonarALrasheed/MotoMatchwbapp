/**
 * ══════════════════════════════════════════════════════════════════
 *  MotoMatch — Community (Discord-Stil)
 *  - Server/Kanäle in einer Sidebar, Chat pro Kanal, DMs und Sprach-Talks
 *  - Nutzer können eigene Gruppen und Kanäle erstellen und löschen
 *
 *  BACKEND: Supabase (Auth, Postgres, Realtime). Konten, Profile,
 *  Gruppen, Mitgliedschaften und Nachrichten liegen serverseitig;
 *  Änderungen kommen per Realtime-Subscriptions (inkl. Presence für
 *  "Jetzt aktiv") live an — der gesamte Datenzugriff läuft über
 *  ./community-api.js. In localStorage bleiben nur lokale
 *  UI-Präferenzen (Lese-Status, Mute-Einstellungen o.Ä.).
 *
 *  OFFLINE_MODE (aus ./supabase.js) ist der explizite Fallback für die
 *  Entwicklung ohne Supabase-Keys: Anmeldung und Daten laufen dann
 *  gegen lokale Demo-/Seed-Daten statt gegen das Backend.
 * ══════════════════════════════════════════════════════════════════
 */

import commBg from '../assets/community-bg.jpeg'
import { esc } from './util.js'
import { HAS_STICKER_API, searchStickerApi, trendingStickerApi } from './stickers.js'
import {
  joinVoiceRoom, leaveVoiceRoom, toggleVoiceMute, toggleVoiceDeafen,
  inVoiceRoom, currentRoomId, listAudioDevices, switchMicrophone, switchSpeaker, setOutputVolume,
  watchVoiceRoom, unwatchAllVoiceRooms, toggleScreenShare, getScreenShareEl,
} from './voice.js'
import { enablePushNotifications, disablePushNotifications } from './push.js'
// Zentrale, plattformweite Authentifizierung (geteilt mit der Haupt-Website)
import { getSession, login, register, loginGuest, logout, ensureDemoUsers, renderGoogleButton, initSupabaseAuth, requestPasswordReset } from './auth.js'
import { openAccount } from './account.js'
import { supabase, OFFLINE_MODE } from './supabase.js'
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
  createChannel, deleteChannel, createVoiceRoom, deleteVoiceRoom,
  // Gruppen-Anfragen
  getGroupRequests, groupRequestsFor, myGroupRequest,
  sendJoinRequest, acceptGroupRequest, declineGroupRequest,
  // Einladungen
  getInvites, createInvite, revokeInvite, redeemInvite, activeInvitesForGroup,
  // Nachrichten (Gruppen)
  ATTACH_MAX, ATTACH_MAX_LOCAL,
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
  subscribeToChannel, unsubscribeAll, onNewMessage, onMessageChanged, onFriendRequest, onNewGroup,
  // Presence ("Jetzt aktiv")
  subscribeToPresence, updatePresenceStatus, onPresenceChange, getOnlinePresence, unsubscribePresence,
  // Kanal-/Talk-Liste einer Gruppe live halten (wer hat was erstellt/gelöscht)
  subscribeGroupLiveUpdates, unsubscribeGroupLiveUpdates,
  // Typing-Indikatoren
  sendChannelTyping, subscribeDMTyping, unsubscribeDMTyping, sendDMTyping,
  // Direktanrufe (Signalisierung)
  dmCallRoomId, subscribeToUserEvents, sendUserEvent,
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
  _syncMuteToServer(key, untilTs)
}
function removeMute(key) {
  const mutes = getMutes()
  delete mutes[key]
  setMutes(mutes)
  _unsyncMuteFromServer(key)
}

/**
 * Mute-Zustand zusätzlich serverseitig spiegeln (notification_mutes), damit
 * api/push-trigger.js gemutete DMs/Gruppen nicht anstößt — der lokale
 * localStorage-Lesepfad für die UI bleibt unverändert, das hier ist nur ein
 * Nebenher-Schreiben (fire-and-forget, blockiert die UI nicht).
 */
function _syncMuteToServer(key, untilTs) {
  if (OFFLINE_MODE || !supabase) return
  const session = getSession(); if (!session?.uid) return
  supabase.from('notification_mutes').upsert({
    user_id: session.uid,
    mute_key: key,
    until: untilTs === 'forever' ? null : new Date(untilTs).toISOString(),
  }, { onConflict: 'user_id,mute_key' }).then(() => {})
}
function _unsyncMuteFromServer(key) {
  if (OFFLINE_MODE || !supabase) return
  const session = getSession(); if (!session?.uid) return
  supabase.from('notification_mutes').delete().eq('user_id', session.uid).eq('mute_key', key).then(() => {})
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
  // Aufrunden: 6 Tage 23:59 sind noch "7 Tage" Restlaufzeit, nicht 6.
  const h = Math.ceil(ms / 3600_000)
  if (h < 24) return `${h} Std.`
  const d = Math.ceil(h / 24)
  return d === 1 ? '1 Tag' : `${d} Tage`
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
  { id: 'touren',      name: 'Touren',         icon: 'route',   noun: 'Tour',        gender: 'f', verbNew: 'Tour erstellen' },
  { id: 'events',      name: 'Events',         icon: 'flag',    noun: 'Event',       gender: 'n', verbNew: 'Event erstellen' },
  { id: 'gruppen',     name: 'Gruppen',        icon: 'people',  noun: 'Gruppe',      gender: 'f', verbNew: 'Gruppe erstellen' },
  { id: 'stammtische', name: 'Stammtische',    icon: 'cup',     noun: 'Stammtisch',  gender: 'm', verbNew: 'Stammtisch erstellen' },
  { id: 'rennstrecke', name: 'Rennstrecke',    icon: 'flag',    noun: 'Track-Day',   gender: 'm', verbNew: 'Track-Day erstellen' },
  { id: 'schrauber',   name: 'Schrauber-Treff',icon: 'wrench',  noun: 'Treffen',     gender: 'n', verbNew: 'Treffen erstellen' },
  { id: 'forum',       name: 'Forum',          icon: 'chat',    noun: 'Thema',       gender: 'n', verbNew: 'Thema erstellen' },
]
const catById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[0]

/* Artikel-Lookup nach Genus (m/f/n) für Kategorie-Sätze */
const ARTICLE_DAT_INDEF = { m: 'einem', f: 'einer', n: 'einem' }
const datIndef = gender => ARTICLE_DAT_INDEF[gender] || 'einem'
const OWN_PHRASE_AKK = { m: 'deinen eigenen', f: 'deine eigene', n: 'dein eigenes' }
const ownPhrase = gender => OWN_PHRASE_AKK[gender] || 'dein eigenes'
// "erstelle ___ Tour/Stammtisch/Thema!" ist Akkusativ, nicht Nominativ — bei
// Maskulinum weichen die Formen voneinander ab ("den ersten", nicht "der erste").
const FIRST_AKK = { m: 'den ersten', f: 'die erste', n: 'das erste' }
const firstAkk = gender => FIRST_AKK[gender] || 'das erste'

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
  // Führende Zierzeichen abschneiden statt das Wort zu verwerfen: sonst wird
  // aus "QA-Testtour (wird gelöscht)" das Badge "Q(" (Klammer als Initiale)
  // bzw. "QG" (Wort übersprungen) — richtig sind die ersten beiden Wörter.
  const p = name.trim().split(/\s+/)
    .map(w => w.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean)
  const ini = ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase()
  return ini || name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase() || '?'
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
/**
 * `mentionNames` (optional): Set aus lowercase-Usernamen, die im aktuellen
 * Kontext gültige @Mentions sind (nur Gruppenkanäle — DM-Aufrufe lassen das
 * weg, dann verhält sich die Funktion exakt wie vorher). Nur echte Treffer
 * gegen diese Liste werden hervorgehoben, kein blindes Highlighten von "@x".
 */
function renderText(text, mentionNames = null) {
  // Kein Lookbehind (?<!…): WebKit kennt es erst ab iOS/Safari 16.4, davor
  // ist schon das Regex-Literal ein SyntaxError — und der reisst beim Parsen
  // das komplette Modul mit, die Community bliebe auf aelteren iPhones leer.
  // Ersatz: das Zeichen vor dem @ wird als Gruppe 1 mitgematcht (leer am
  // Textanfang) und beim Zusammensetzen wieder uebersprungen.
  const re = /(https?:\/\/[^\s<>"']+)|(^|[^\p{L}\p{N}_@-])@([\p{L}\p{N}_-]{1,32})/gu
  let result = '', last = 0, match
  while ((match = re.exec(text)) !== null) {
    // Bei einem Mention-Treffer gehoert das erste Zeichen noch zum Text davor.
    const lead = match[1] ? '' : (match[2] || '')
    result += esc(text.slice(last, match.index + lead.length)).replace(/\n/g, '<br>')
    if (match[1]) {
      const url = match[1]
      result += `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="mmc-link">${esc(url)}</a>`
    } else if (mentionNames?.has(match[3].toLowerCase())) {
      const isMe = match[3].toLowerCase() === me().toLowerCase()
      // Gespeichert/erkannt wird der rohe Username (eindeutig, s. _resolveMentions
      // in community-api.js), angezeigt wird der ggf. abweichende Anzeigename —
      // sonst würde z. B. "@lil_wold2021" statt "@Max" im Chat auftauchen.
      result += `<span class="mmc-mention${isMe ? ' mmc-mention--me' : ''}">@${esc(displayName(match[3]))}</span>`
    } else {
      result += esc(match[0].slice(lead.length))
    }
    last = match.index + match[0].length
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

  // Jeder Einstieg in den Community-Tab startet auf "Freunde" — egal ob man
  // vorher auf einer Kategorie oder in einem Gruppen-/DM-Chat war. friendsMode
  // & Co. sind Modul-State und ueberleben den Tab-Wechsel sonst, mountCommunity
  // laeuft aber bei jedem Klick auf den Tab neu (siehe bike-detail.js). Push-
  // Deep-Links (?dm=/?group=&channel=) weiter unten ueberschreiben das bei
  // Bedarf wieder — die sollen weiter direkt in die passende Unterhaltung
  // springen statt auf Freunde zu landen.
  friendsMode = true; homeSection = 'friends'; discoverOpen = false
  activeGroup = null; activeChannel = null; activeDM = null

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

  // Bearbeitung/Löschung/Reaktion einer Nachricht: nur den offenen Chat neu zeichnen
  // (nicht den ganzen Header/Compose neu bauen — das würde "gelesen"-Markierungen
  // unnötig erneut auslösen).
  onMessageChanged((channelId, dmUsers) => {
    const main = root.querySelector('#mmc-main'); if (!main) return
    const box = main.querySelector('#mmc-messages'); if (!box) return
    if (channelId && activeGroup && activeChannel === channelId) {
      const g = getGroups().find(x => x.id === activeGroup); if (!g) return
      groupDefaults(g)
      const ch = g.channels.find(c => c.id === channelId); if (!ch) return
      const emptyCtx = { title: ch.name, text: `Das ist der Anfang von #${ch.name}. Sag Hallo 👋`, avatar: g.name, hash: true }
      renderMessagesInto(root, box, ch.messages, emptyCtx, g)
    } else if (dmUsers && activeDM) {
      const isThisDM = (activeDM.toLowerCase() === dmUsers.user1.toLowerCase()) ||
                       (activeDM.toLowerCase() === dmUsers.user2.toLowerCase())
      if (isThisDM) {
        renderMessagesInto(root, box, getDMs()[activeDM] || [], { title: displayName(activeDM), text: '', avatar: activeDM }, null)
      }
    }
  })

  onFriendRequest(() => refreshFriendsChrome(root))

  // Neue Gruppe (von mir oder jemand anderem erstellt): Übersicht sofort aktualisieren
  onNewGroup(() => {
    // fillRail statt fillCol2: die Uebersicht baut ihre linke Spalte seit dem
    // Zusammenlegen aus .mmc-catrail — und nur dort sitzen die
    // Ungelesen-Punkte, die eine neue Gruppe ausloesen kann.
    if (!activeGroup && !friendsMode) { fillRail(root); fillMain(root) }
  })

  // "Jetzt aktiv": Presence-Channel abonnieren (Gäste tracken sich nicht)
  onPresenceChange(() => { if (typeof refreshFriendsChrome === 'function') refreshFriendsChrome(root) })
  if (session && !session.guest) {
    subscribeToPresence(getPrefs().status || 'online')
    // Anruf-Signale gelten app-weit, nicht nur im offenen Chat.
    subscribeToUserEvents((type, payload) => _handleCallEvent(root, type, payload))
  }

  // Deep-Link aus einer Push-Benachrichtigung (?dm=<username>): die richtige
  // Unterhaltung direkt öffnen, statt nur auf der Übersicht zu landen.
  if (session) {
    const dmParam = new URLSearchParams(window.location.search).get('dm')
    if (dmParam) {
      friendsMode = true; homeSection = 'friends'; activeGroup = null
      activeDM = dmParam
      clearUnread(activeDM)
      subscribeToChannel(null, activeDM)
      const url = new URL(window.location.href)
      url.searchParams.delete('dm')
      window.history.replaceState(window.history.state, '', url)
    }
    // Deep-Link aus einer @Mention-Push (?group=<id>&channel=<id>)
    const groupParam = new URLSearchParams(window.location.search).get('group')
    const channelParam = new URLSearchParams(window.location.search).get('channel')
    if (groupParam && channelParam) {
      friendsMode = false; activeGroup = groupParam; activeChannel = channelParam
      subscribeToChannel(activeChannel, null)
      const url = new URL(window.location.href)
      url.searchParams.delete('group'); url.searchParams.delete('channel')
      window.history.replaceState(window.history.state, '', url)
    }
  }

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
          <button type="button" class="mmc-skip" id="mmc-skip" title="Als Gast ansehen — Lesen ja, Schreiben nur angemeldet">Überspringen →</button>
          ${qrSvg()}
          <h3 class="mmc-qr-title">Mit QR-Code einloggen</h3>
          <p class="mmc-qr-text">App-Login kommt bald. Bis dahin: melde dich links mit deinem Benutzernamen an.</p>
        </div>
      </div>
      <div class="mmc-auth-brand"><span class="mmc-auth-logo">◆</span> MotoMatch Community</div>
    </div>
  `

  root.querySelector('#mmc-forgot')?.addEventListener('click', () => {
    openConfirmModal(root, {
      title: 'Passwort zurücksetzen',
      text: 'Wir schicken dir einen Link an deine E-Mail-Adresse.',
      confirmLabel: 'Link senden',
      inputPlaceholder: 'du@mail.de',
      onConfirm: async email => {
        const res = await requestPasswordReset(email)
        // Kein Konto-Leak: außer beim Formatfehler immer dieselbe Antwort —
        // gleiche Linie wie der Reset-Dialog der Hauptseite in auth.js.
        if (!res.ok && /gültige E-Mail/.test(res.error)) {
          openInfoModal(root, 'Passwort zurücksetzen', res.error)
          return
        }
        openInfoModal(root, 'Passwort zurücksetzen',
          'Falls diese E-Mail registriert ist, hast du eine Mail mit dem Link bekommen.')
      },
    })
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
let discoverOpen = false     // true → "Server entdecken"-Ansicht statt normalem Freunde-Inhalt (nur relevant bei friendsMode)
let replyingTo = null        // { id, author, text } der Nachricht, auf die geantwortet wird
let _voiceWatchers = {}      // { [roomId]: cleanupFn } — live "wer ist im Talk"-Beobachtung
/* Wie die Presence-Änderung angezeigt wird, hängt an der GERADE sichtbaren
   Ansicht (Gruppenkarten vs. Kanal-Sidebar), nicht am Watcher: Watcher
   überleben einen Ansichtswechsel, damit sie nicht bei jedem Klick neu
   aufgebaut werden. Der Callback wird deshalb hier zentral gehalten und beim
   Wechsel überschrieben — sonst schriebe ein Watcher aus der Übersicht
   weiterhin in längst ersetztes DOM. */
let _onVoiceWatchUpdate = () => {}
const _vcPrevMembers = new Map() // roomId -> zuletzt gerenderte Mitgliederliste, für Join/Leave-Animation in voiceChannelHtml()
let _typingUsers = {}        // { username: timeoutId } — wer gerade im aktuell offenen Chat tippt
let _lastTypingSentAt = 0    // Throttle fürs Senden eigener Typing-Pings

/** Navigations-Zustand auf Standard zurücksetzen — wichtig beim Konto-Wechsel
 *  (Login/Logout) im selben Tab, damit der neue Nutzer nicht in der Navigation
 *  landet, wo der vorherige Nutzer aufgehört hat. Standard ist die Freunde-
 *  Seite (friendsMode = true), aus der man dann in die Kategorien wechselt —
 *  dieselbe Landing-Regel wie beim Tab-Wechsel oben in mountCommunity(). */
function resetNavState() {
  homeSection = 'friends'; friendsTab = 'all'; activeDM = null
  serverCategory = 'touren'; activeGroup = null; activeChannel = null; friendsMode = true
  discoverOpen = false
  replyingTo = null
}

/* ── Mobile-Navigations-Stack (<768px) ────────────────────────────
 * Unter der Breakpoint-Schwelle zeigt der Grid immer nur eine Spalte
 * auf voller Breite (siehe main.css). Welche, steuert die Klasse
 * "mmc--detail" auf dem .mmc-Root: ohne Klasse = Liste (Kategorien/
 * Kanäle/Freunde), mit Klasse = Hauptinhalt (Chat/Kartenliste). Auf
 * Desktop (≥768px) bleiben beide Spalten unabhängig von der Klasse
 * sichtbar — sie wirkt nur innerhalb der Media Query. */
function mobileShowDetail(root) { root.querySelector('.mmc')?.classList.add('mmc--detail') }
function mobileShowList(root) { root.querySelector('.mmc')?.classList.remove('mmc--detail') }
/** Zurück-Pfeil fürs Hauptpanel — nur unterhalb der Mobile-Breakpoint sichtbar (siehe .mmc-mback in main.css). */
function mobileBackHtml() { return `<button type="button" class="mmc-back mmc-mback" id="mmc-list-back" title="Zurück">${ICON.back}</button>` }
function bindMobileBack(main, root) { main.querySelector('#mmc-list-back')?.addEventListener('click', () => mobileShowList(root)) }

/**
 * Zur Community-Anmeldung wechseln: beendet die aktuelle Sitzung (auch eine
 * Gast-Sitzung, die sonst weiter als „angemeldet" gilt) und zeigt den
 * Anmeldebildschirm. Genutzt vom Abmelden-Weg und dort, wo eine Aktion ein
 * echtes Konto braucht (z. B. Sprach-Talks).
 */
async function goToAuth(root) {
  await logout()
  resetNavState()
  renderAuth(root)
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
  screen:  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  attach:  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
  download: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  doc:      '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
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
  phone:   '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
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

/** Entfernt den "Noch keine Nachrichten"-Platzhalter, falls vorhanden (vor dem Anhängen der ersten Live-Nachricht) */
function _clearEmptyState(box) {
  box.querySelector('.mmc-empty')?.remove()
}

/** Neue Nachricht direkt an den Gruppen-Chat anhängen (ohne komplette Neurendition) */
function _appendMessageToGroupChat(root, msg) {
  const box = (root || _rootRef)?.querySelector('#mmc-messages')
  if (!box || !activeGroup) return
  // Eigene Nachrichten werden schon optimistisch per renderMessagesInto() gezeigt;
  // das Realtime-Echo des eigenen INSERTs würde sie sonst ein zweites Mal anhängen.
  if (box.querySelector(`[data-msg-id="${msg.id}"]`)) return
  _clearEmptyState(box)
  const g = getGroups().find(x => x.id === activeGroup)
  if (!g) return
  groupDefaults(g)
  const mentionNames = new Set((g.members || []).map(u => u.toLowerCase()))

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
  const imgHtml = attachmentHtml(msg)
  const replyQuote = msg.replyTo ? `
    <div class="mmc-reply-quote" data-reply-to="${esc(msg.replyTo.id)}">
      <span class="mmc-reply-quote-author">${esc(displayName(msg.replyTo.author))}</span>
      <span class="mmc-reply-quote-text">${esc((msg.replyTo.text || '').slice(0, 80))}${(msg.replyTo.text || '').length > 80 ? '…' : ''}</span>
    </div>` : ''

  const msgHtml = `
    <div class="mmc-msg mmc-msg--enter${msg.system ? ' mmc-msg--system' : ''}" data-msg-id="${esc(msg.id)}">
      <div class="mmc-avatar mmc-avatar--sm ${clickable ? 'mmc-avatar--clickable' : ''}" ${clickable ? `data-user="${esc(msg.author)}"` : ''} style="background:${avatarColor(msg.author)}">${avatarInner(msg.author)}</div>
      <div class="mmc-msg-body">
        <div class="mmc-msg-head">
          <span class="mmc-msg-author${clickable ? ' mmc-msg-author--clickable' : ''}" ${clickable ? `data-user="${esc(msg.author)}"` : ''}>${esc(displayName(msg.author))}</span>
          <span class="mmc-msg-time">${fmtTime(msg.ts)}</span>
        </div>
        ${replyQuote}
        <div class="mmc-msg-text">${renderText(msg.text, mentionNames)}</div>
        ${imgHtml}
        ${pills}
      </div>
      ${actions}
    </div>`

  box.insertAdjacentHTML('beforeend', msgHtml)

  // Event-Listener für die neue Nachricht binden
  const newMsgEl = box.querySelector(`[data-msg-id="${msg.id}"]`)
  if (newMsgEl) {
    const emptyCtx = { title: g.channels?.find(c => c.id === activeChannel)?.name || '', text: '', avatar: g.name, hash: true }
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
      openReactPicker(root || _rootRef, box, e.currentTarget, e.currentTarget.dataset.reactOpen, msgs, emptyCtx, g)
    })
    newMsgEl.querySelector('[data-del-msg]')?.addEventListener('click', e => {
      e.stopPropagation()
      openConfirmModal(root || _rootRef, {
        title: 'Nachricht löschen?',
        text: 'Diese Aktion kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        isDanger: true,
        onConfirm: async () => {
          await deleteGroupMessage(g.id, msg.id)
          const updated = getGroups().find(x => x.id === g.id)
          if (updated) { groupDefaults(updated); renderMessagesInto(root || _rootRef, box, channelMsgs(updated, activeChannel), emptyCtx, updated) }
        },
      })
    })
    newMsgEl.querySelector('[data-edit-msg]')?.addEventListener('click', e => {
      e.stopPropagation()
      const textEl = newMsgEl.querySelector('.mmc-msg-text')
      const actionsEl = newMsgEl.querySelector('.mmc-msg-actions')
      if (!textEl) return
      if (actionsEl) actionsEl.style.display = 'none'
      const ta = document.createElement('textarea')
      ta.className = 'mmc-edit-input'; ta.value = msg.text
      textEl.replaceWith(ta); ta.focus(); ta.select()
      const cancel = () => {
        const div = document.createElement('div')
        div.className = 'mmc-msg-text'; div.innerHTML = renderText(msg.text, mentionNames)
        ta.replaceWith(div)
        if (actionsEl) actionsEl.style.removeProperty('display')
      }
      const save = async () => {
        const newText = ta.value.trim()
        if (!newText || newText === msg.text) { cancel(); return }
        await editMessageInGroup(g.id, msg.id, newText)
        const updated = getGroups().find(x => x.id === g.id)
        if (updated) { groupDefaults(updated); renderMessagesInto(root || _rootRef, box, channelMsgs(updated, activeChannel), emptyCtx, updated) }
      }
      ta.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); save() }
        if (ev.key === 'Escape') { ev.preventDefault(); cancel() }
      })
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
  const box = (root || _rootRef)?.querySelector('#mmc-messages')
  if (!box || !activeDM) return
  // Eigene Nachrichten werden schon optimistisch per renderMessagesInto() gezeigt;
  // das Realtime-Echo des eigenen INSERTs würde sie sonst ein zweites Mal anhängen.
  if (box.querySelector(`[data-msg-id="${msg.id}"]`)) return
  _clearEmptyState(box)

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
  const imgHtml = attachmentHtml(msg)

  const msgHtml = `
    <div class="mmc-msg mmc-msg--enter${msg.system ? ' mmc-msg--system' : ''}" data-msg-id="${esc(msg.id)}">
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
    newMsgEl.querySelector('[data-edit-msg]')?.addEventListener('click', e => {
      e.stopPropagation()
      const textEl = newMsgEl.querySelector('.mmc-msg-text')
      const actionsEl = newMsgEl.querySelector('.mmc-msg-actions')
      if (!textEl) return
      if (actionsEl) actionsEl.style.display = 'none'
      const ta = document.createElement('textarea')
      ta.className = 'mmc-edit-input'; ta.value = msg.text
      textEl.replaceWith(ta); ta.focus(); ta.select()
      const cancel = () => {
        const div = document.createElement('div')
        div.className = 'mmc-msg-text'; div.innerHTML = renderText(msg.text)
        ta.replaceWith(div)
        if (actionsEl) actionsEl.style.removeProperty('display')
      }
      const save = async () => {
        const newText = ta.value.trim()
        if (!newText || newText === msg.text) { cancel(); return }
        await editMessageInDM(activeDM, msg.id, newText)
        renderMessagesInto(root || _rootRef, box, getDMs()[activeDM] || [], { title: displayName(activeDM), text: '', avatar: activeDM }, null)
      }
      ta.addEventListener('keydown', ev => {
        if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); save() }
        if (ev.key === 'Escape') { ev.preventDefault(); cancel() }
      })
    })
  }

  // Automatisch nach unten scrollen
  box.scrollTop = box.scrollHeight
}

/* ── Typing-Indikator ─────────────────────────────────────────────
   Rein transient (Broadcast, kein Schema) — verschwindet automatisch
   ~3s nach dem letzten Ping der jeweiligen Person, kein explizites
   "hat aufgehört zu tippen"-Event nötig. */
function _clearTyping(root) {
  for (const t of Object.values(_typingUsers)) clearTimeout(t)
  _typingUsers = {}
  _renderTypingIndicator(root)
}
function _onTypingReceived(root, username) {
  if (!username || username.toLowerCase() === me().toLowerCase()) return
  clearTimeout(_typingUsers[username])
  _typingUsers[username] = setTimeout(() => {
    delete _typingUsers[username]
    _renderTypingIndicator(root)
  }, 3000)
  _renderTypingIndicator(root)
}
function _renderTypingIndicator(root) {
  const el = (root || _rootRef)?.querySelector('#mmc-typing')
  if (!el) return
  const shown = Object.keys(_typingUsers).map(displayName)
  if (!shown.length) { el.textContent = ''; el.classList.remove('is-visible'); return }
  const text = shown.length === 1 ? `${shown[0]} schreibt gerade…`
    : shown.length === 2 ? `${shown[0]} und ${shown[1]} schreiben gerade…`
    : `${shown[0]}, ${shown[1]} und ${shown.length - 2} weitere schreiben gerade…`
  el.textContent = text
  el.classList.add('is-visible')
}
/** Throttled eigenen Typing-Ping senden (max. alle 2,5s), fürs `input`-Event der Compose-Box. */
function _pingTyping(sendFn) {
  const now = Date.now()
  if (now - _lastTypingSentAt < 2500) return
  _lastTypingSentAt = now
  sendFn()
}

/** Lesbare Groessenangabe fuer Anhaenge, deutsches Dezimalkomma. */
function fileSizeLabel(bytes) {
  if (!bytes && bytes !== 0) return ''
  return bytes >= 1024 * 1024
    ? (bytes / 1024 / 1024).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' MB'
    : Math.max(1, Math.round(bytes / 1024)) + ' KB'
}

/** Kuerzel fuer die Meta-Zeile: bevorzugt die Dateiendung, sonst der MIME-Subtyp. */
function fileExtLabel(name = '', type = '') {
  const fromName = /\.([a-z0-9]{1,6})$/i.exec(name)?.[1]
  if (fromName) return fromName.toUpperCase()
  const sub = (type.split('/')[1] || '').split(/[+;]/)[0]
  return sub ? sub.toUpperCase() : 'DATEI'
}

/* Farbakzent nach Dateityp — macht die Karte auf einen Blick unterscheidbar. */
const FILE_TONE = {
  PDF: 'pdf', ZIP: 'zip', RAR: 'zip', '7Z': 'zip',
  DOC: 'doc', DOCX: 'doc', TXT: 'doc', RTF: 'doc',
  XLS: 'sheet', XLSX: 'sheet', CSV: 'sheet',
  MP3: 'media', WAV: 'media', M4A: 'media', MP4: 'media', MOV: 'media',
}

/**
 * Anhang einer Nachricht. Bilder bleiben inline (mit Lightbox), alles andere
 * wird zu einer Datei-Karte mit Download. Aeltere Nachrichten tragen nur
 * msg.image (data-URL, immer ein Bild) — die werden hier mit uebersetzt.
 */
function attachmentHtml(msg) {
  const att = msg.attachment || (msg.image ? { url: msg.image, type: 'image/*', name: 'Anhang' } : null)
  if (!att?.url) return ''

  if (att.sticker) {
    // Freigestellte Grafik — ohne Rahmen und ohne Lightbox, wie im Messenger
    return `<img class="mmc-msg-sticker" src="${esc(att.url)}" alt="${esc(att.name || 'Sticker')}" loading="lazy">`
  }
  if ((att.type || '').startsWith('image/')) {
    return `<img class="mmc-msg-image" src="${esc(att.url)}" alt="${esc(att.name || 'Anhang')}" loading="lazy" data-img-src="${esc(att.url)}">`
  }
  const name = att.name || 'Datei'
  const ext  = fileExtLabel(name, att.type || '')
  const size = fileSizeLabel(att.size)
  const tone = FILE_TONE[ext] || 'plain'
  return `
    <a class="mmc-msg-file" href="${esc(att.url)}" download="${esc(name)}" title="${esc(name)} herunterladen">
      <span class="mmc-msg-file-ic mmc-msg-file-ic--${tone}">${ICON.doc}</span>
      <span class="mmc-msg-file-meta">
        <span class="mmc-msg-file-name">${esc(name)}</span>
        <span class="mmc-msg-file-sub">${esc(ext)}${size ? ' · ' + esc(size) : ''}</span>
      </span>
      <span class="mmc-msg-file-dl">${ICON.download}</span>
    </a>`
}

/**
 * Sperrt die Eingabezeile waehrend des Sendens (Upload kann dauern) und gibt
 * eine Funktion zum Entsperren zurueck.
 */
function _composeBusy(form) {
  if (!form) return () => {}
  const send = form.querySelector('.mmc-send')
  form.classList.add('is-busy')
  if (send) send.disabled = true
  return () => {
    form.classList.remove('is-busy')
    if (send) send.disabled = false
  }
}

/* Shared compose bar: attachment (left) + input + emoji (right of input) + send */
const REACTION_EMOJIS  = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🏍️', '👋']

/* ── Sticker ──────────────────────────────────────────────────────
   Keine Bilddateien, sondern grosse Emoji — das haelt das Bundle klein und
   funktioniert offline. Jeder Eintrag traegt Stichworte, ueber die beim
   Tippen vorgeschlagen und im Picker gesucht wird.
   ────────────────────────────────────────────────────────────────── */
const STICKERS = [
  { s: '🏍️', k: ['motorrad', 'bike', 'maschine', 'fahren', 'ride', 'moped'] },
  { s: '🛵', k: ['roller', 'scooter', 'vespa'] },
  { s: '🏁', k: ['ziel', 'rennen', 'race', 'start', 'finish', 'strecke'] },
  { s: '🪖', k: ['helm', 'schutz', 'kopf'] },
  { s: '🧤', k: ['handschuhe', 'schutz'] },
  { s: '🥾', k: ['stiefel', 'boots', 'schuhe'] },
  { s: '🧰', k: ['werkzeug', 'schrauben', 'werkstatt', 'reparatur'] },
  { s: '🛠️', k: ['werkzeug', 'schrauben', 'basteln', 'wartung', 'reparatur'] },
  { s: '🔧', k: ['schluessel', 'schrauben', 'werkstatt', 'wartung'] },
  { s: '⛽', k: ['tanken', 'sprit', 'benzin', 'tankstelle'] },
  { s: '🛞', k: ['reifen', 'rad', 'gummi'] },
  { s: '🔋', k: ['batterie', 'akku', 'strom', 'elektro'] },
  { s: '🗺️', k: ['karte', 'route', 'tour', 'navigation', 'planen'] },
  { s: '🧭', k: ['kompass', 'richtung', 'navigation', 'orientierung'] },
  { s: '📍', k: ['treffpunkt', 'ort', 'standort', 'hier'] },
  { s: '🛣️', k: ['strasse', 'autobahn', 'route', 'weg'] },
  { s: '🌄', k: ['berge', 'alpen', 'aussicht', 'sonnenaufgang', 'tour'] },
  { s: '🏔️', k: ['berge', 'alpen', 'pass', 'gipfel'] },
  { s: '🌲', k: ['wald', 'natur', 'schwarzwald', 'baum'] },
  { s: '🌊', k: ['meer', 'kueste', 'wasser', 'see'] },
  { s: '☀️', k: ['sonne', 'wetter', 'schoen', 'sommer'] },
  { s: '🌧️', k: ['regen', 'wetter', 'nass', 'schlecht'] },
  { s: '❄️', k: ['schnee', 'kalt', 'winter', 'eis'] },
  { s: '🌬️', k: ['wind', 'wetter', 'kalt'] },
  { s: '🌡️', k: ['temperatur', 'warm', 'kalt', 'wetter'] },
  { s: '⚡', k: ['blitz', 'schnell', 'power', 'strom'] },
  { s: '🔥', k: ['feuer', 'geil', 'stark', 'hot', 'krass', 'top'] },
  { s: '💨', k: ['schnell', 'gas', 'speed', 'weg'] },
  { s: '🚀', k: ['schnell', 'rakete', 'abgehen', 'speed'] },
  { s: '🏆', k: ['sieg', 'pokal', 'gewonnen', 'erster', 'best'] },
  { s: '🥇', k: ['erster', 'gold', 'sieg', 'best'] },
  { s: '🎉', k: ['party', 'feiern', 'glueckwunsch', 'juhu', 'hurra'] },
  { s: '🎊', k: ['party', 'feiern', 'konfetti'] },
  { s: '🥳', k: ['party', 'feiern', 'geburtstag', 'juhu'] },
  { s: '🍻', k: ['prost', 'bier', 'stammtisch', 'treffen', 'feierabend'] },
  { s: '☕', k: ['kaffee', 'pause', 'stammtisch', 'morgen', 'treffen'] },
  { s: '🍕', k: ['pizza', 'essen', 'hunger', 'pause'] },
  { s: '🍔', k: ['burger', 'essen', 'hunger', 'pause'] },
  { s: '😂', k: ['lachen', 'lustig', 'witzig', 'haha', 'lol'] },
  { s: '🤣', k: ['lachen', 'lustig', 'haha', 'lol', 'rofl'] },
  { s: '😅', k: ['schwitzen', 'knapp', 'ups', 'haha'] },
  { s: '😎', k: ['cool', 'sonnenbrille', 'lassig', 'chill'] },
  { s: '🤙', k: ['cool', 'passt', 'shaka', 'gruss'] },
  { s: '👍', k: ['daumen', 'ok', 'gut', 'passt', 'ja', 'top'] },
  { s: '👎', k: ['daumen', 'schlecht', 'nein', 'nope'] },
  { s: '🙌', k: ['jubel', 'super', 'endlich', 'yeah'] },
  { s: '👏', k: ['applaus', 'klatschen', 'respekt', 'bravo'] },
  { s: '🤝', k: ['deal', 'abgemacht', 'hand', 'einig'] },
  { s: '✌️', k: ['peace', 'gruss', 'zwei', 'tschuess'] },
  { s: '👋', k: ['hallo', 'winken', 'tschuess', 'servus', 'moin'] },
  { s: '❤️', k: ['herz', 'liebe', 'love', 'toll'] },
  { s: '💯', k: ['hundert', 'volle', 'top', 'genau', 'stark'] },
  { s: '🤔', k: ['denken', 'hmm', 'ueberlegen', 'frage', 'unsicher'] },
  { s: '😮', k: ['wow', 'ueberrascht', 'oha', 'krass'] },
  { s: '😱', k: ['schock', 'oh nein', 'krass', 'panik'] },
  { s: '😴', k: ['muede', 'schlafen', 'gute nacht', 'nacht'] },
  { s: '🥶', k: ['kalt', 'frieren', 'winter', 'eisig'] },
  { s: '🥵', k: ['heiss', 'schwitzen', 'sommer', 'warm'] },
  { s: '🤦', k: ['facepalm', 'oh mann', 'peinlich', 'ups'] },
  { s: '😭', k: ['weinen', 'traurig', 'schade', 'heul'] },
  { s: '😤', k: ['sauer', 'genervt', 'wut', 'aergern'] },
  { s: '🫡', k: ['salut', 'jawohl', 'verstanden', 'ok'] },
  { s: '🙏', k: ['danke', 'bitte', 'daumen druecken', 'hoffen'] },
  { s: '⏰', k: ['zeit', 'uhr', 'wecker', 'spaet', 'puenktlich'] },
  { s: '📅', k: ['termin', 'datum', 'kalender', 'planen', 'wann'] },
  { s: '✅', k: ['fertig', 'erledigt', 'haken', 'ja', 'passt'] },
  { s: '❌', k: ['nein', 'falsch', 'abgesagt', 'nope'] },
  { s: '⚠️', k: ['achtung', 'warnung', 'vorsicht', 'gefahr'] },
  { s: '🚧', k: ['baustelle', 'sperrung', 'achtung', 'umleitung'] },
  { s: '📸', k: ['foto', 'bild', 'kamera', 'knipsen'] },
  { s: '🎥', k: ['video', 'film', 'kamera', 'aufnahme'] },
  { s: '🎵', k: ['musik', 'song', 'lied', 'hoeren'] },
  { s: '💰', k: ['geld', 'preis', 'kosten', 'teuer', 'kaufen'] },
  { s: '🧊', k: ['eis', 'kalt', 'chill', 'cool'] },
  { s: '💪', k: ['stark', 'kraft', 'power', 'geschafft'] },
]

/* Favoriten halten beide Sorten: Emoji-Sticker als { emoji } und Bild-Sticker
   als { id, url, preview, desc }. Schluessel ist emoji ?? id. */
const LS_STICKER_FAV = 'mm_comm_sticker_favs_v2'

function stickerFavs() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_STICKER_FAV) || '[]')
    return Array.isArray(raw) ? raw.filter(x => x && (x.emoji || x.url)) : []
  } catch { return [] }
}
function stickerKey(item) { return item.emoji || item.id || item.url }
function isFav(item, favs = stickerFavs()) {
  const k = stickerKey(item)
  return favs.some(f => stickerKey(f) === k)
}
function toggleStickerFav(item) {
  const favs = stickerFavs()
  const k = stickerKey(item)
  const next = favs.some(f => stickerKey(f) === k)
    ? favs.filter(f => stickerKey(f) !== k)
    : [item, ...favs]
  try { localStorage.setItem(LS_STICKER_FAV, JSON.stringify(next.slice(0, 40))) } catch {}
  return next
}

/** Sticker nach Suchbegriff filtern (Stichworte, Prefix reicht). */
function searchStickers(q) {
  const needle = q.trim().toLowerCase()
  if (!needle) return STICKERS
  return STICKERS.filter(e => e.s === needle || e.k.some(k => k.includes(needle)))
}

/**
 * Vorschlaege zum getippten Text — wie bei TikTok, wo waehrend des Schreibens
 * passende Sticker auftauchen. Gewichtet: exakte Stichworte vor Teiltreffern,
 * Favoriten zuerst.
 */
function suggestStickers(text, limit = 8) {
  const words = text.toLowerCase().match(/[\p{L}]{3,}/gu) || []
  if (!words.length) return []
  const favs = stickerFavs()
  const scored = []
  for (const e of STICKERS) {
    let score = 0
    for (const w of words) {
      for (const k of e.k) {
        if (k === w) score += 3
        else if (k.startsWith(w) || w.startsWith(k)) score += 2
        else if (k.includes(w)) score += 1
      }
    }
    if (score) scored.push({ ...e, score: score + (isFav({ emoji: e.s }, favs) ? 1 : 0) })
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}
function composeHtml(placeholder) {
  return `
    <div class="mmc-compose">
      <div class="mmc-typing" id="mmc-typing"></div>
      <div class="mmc-reply-bar" id="mmc-reply-bar" hidden></div>
      <div class="mmc-attach-preview" id="mmc-attach-preview" hidden>
        <img class="mmc-attach-thumb" id="mmc-attach-thumb" src="" alt="" hidden>
        <span class="mmc-attach-fileic" id="mmc-attach-fileic" hidden>${ICON.attach}</span>
        <div class="mmc-attach-info">
          <div class="mmc-attach-name" id="mmc-attach-name"></div>
          <div class="mmc-attach-size" id="mmc-attach-size"></div>
        </div>
        <button type="button" class="mmc-attach-rm" id="mmc-attach-rm" title="Anhang entfernen" aria-label="Anhang entfernen">✕</button>
      </div>
      <div class="mmc-sticker-suggest" id="mmc-sticker-suggest" hidden></div>
      <form class="mmc-compose-form" id="mmc-compose-form">
        <input type="file" id="mmc-file-input" style="display:none" aria-hidden="true" tabindex="-1">
        <button type="button" class="mmc-compose-ic" id="mmc-attach" title="Datei anhängen" aria-label="Datei anhängen">${ICON.attach}</button>
        <textarea class="mmc-compose-input" id="mmc-compose-input" rows="1" placeholder="${placeholder}" autocomplete="off"></textarea>
        <button type="button" class="mmc-compose-ic mmc-emoji" id="mmc-emoji" title="Sticker" aria-label="Sticker">${ICON.smiley}</button>
        <button class="mmc-send" type="submit" aria-label="Senden">${ICON.send}</button>
      </form>
    </div>`
}
function bindComposeExtras(scope, root, sendTypingFn, mentionableUsers = []) {
  const fileInput  = scope.querySelector('#mmc-file-input')
  const preview    = scope.querySelector('#mmc-attach-preview')
  const thumb      = scope.querySelector('#mmc-attach-thumb')
  const fileIc     = scope.querySelector('#mmc-attach-fileic')
  const nameEl     = scope.querySelector('#mmc-attach-name')
  const sizeEl     = scope.querySelector('#mmc-attach-size')
  const form       = scope.querySelector('#mmc-compose-form')
  // Online geht die Datei in Supabase Storage (25 MB), offline als data-URL
  // in localStorage — dort ist bei 2 MB Schluss. Grenzen kommen aus der API,
  // damit Pruefung und Upload nicht auseinanderlaufen.
  const MAX_BYTES  = OFFLINE_MODE ? ATTACH_MAX_LOCAL : ATTACH_MAX

  const clearAttach = () => {
    if (form) form._pendingAttachment = null
    if (fileInput) fileInput.value = ''
    if (preview) preview.hidden = true
    if (thumb) {
      if (thumb.dataset.objurl) { URL.revokeObjectURL(thumb.dataset.objurl); delete thumb.dataset.objurl }
      thumb.src = ''; thumb.hidden = true
    }
    if (fileIc) fileIc.hidden = true
  }
  if (form) form._clearAttach = clearAttach

  scope.querySelector('#mmc-attach')?.addEventListener('click', () => fileInput?.click())
  scope.querySelector('#mmc-attach-rm')?.addEventListener('click', clearAttach)

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0]; if (!file) return
    if (file.size > MAX_BYTES) {
      toast(root, `Datei zu groß (max. ${fileSizeLabel(MAX_BYTES)}).`)
      fileInput.value = ''
      return
    }
    const isImage = (file.type || '').startsWith('image/')
    // Die Datei selbst weiterreichen — erst beim Senden wird hochgeladen
    // bzw. (offline) in eine data-URL gewandelt.
    if (form) form._pendingAttachment = {
      file,
      name: file.name,
      // Ohne Typ (manche Dateien liefern keinen) faellt die Anzeige auf die
      // Datei-Karte zurueck — das ist der unschaedlichere Fall.
      type: file.type || 'application/octet-stream',
      size: file.size,
    }
    if (nameEl) nameEl.textContent = file.name
    if (sizeEl) sizeEl.textContent = fileSizeLabel(file.size)
    if (fileIc) fileIc.hidden = isImage
    if (preview) preview.hidden = false
    // Vorschau nur fuer Bilder — als Objekt-URL, damit auch 20-MB-Fotos nicht
    // erst komplett in Base64 durch den Speicher muessen.
    if (thumb) {
      if (thumb.dataset.objurl) { URL.revokeObjectURL(thumb.dataset.objurl); delete thumb.dataset.objurl }
      thumb.hidden = !isImage
      if (isImage) { const u = URL.createObjectURL(file); thumb.dataset.objurl = u; thumb.src = u }
      else thumb.src = ''
    }
  })

  // Auto-resize textarea
  const textarea = scope.querySelector('#mmc-compose-input')
  if (textarea) {
    const resize = () => {
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, 130) + 'px'
    }
    textarea.addEventListener('input', resize)
    if (sendTypingFn) {
      textarea.addEventListener('input', () => { if (textarea.value.trim()) _pingTyping(sendTypingFn) })
    }

    // @Mention-Autocomplete-Zustand. Bleibt bei tokenStart -1 hängen, wenn
    // mentionableUsers leer ist (DM-Compose) — der keydown-Handler unten
    // bleibt dadurch für beide Fälle identisch, ohne DMs extra abzweigen zu müssen.
    let mentionMatches = [], mentionActive = 0, tokenStart = -1, tokenEnd = -1
    let renderMentionPop = () => {}, selectMention = () => {}
    const compose = scope.querySelector('.mmc-compose')
    const closeMentionPop = () => {
      compose?.querySelector('.mmc-mention-pop')?.remove()
      tokenStart = -1; tokenEnd = -1; mentionMatches = []
    }

    if (mentionableUsers.length) {
      // Nur Usernamen aus einem tokenisierbaren Zeichensatz sind mentionable —
      // register() erlaubt Leerzeichen/Sonderzeichen, die sich in "@wort" nicht
      // sauber abgrenzen ließen. Betrifft bei den bisherigen Namen niemanden.
      const validUsers = mentionableUsers.filter(u => /^[\p{L}\p{N}_-]+$/u.test(u))

      renderMentionPop = () => {
        compose.querySelector('.mmc-mention-pop')?.remove()
        const pop = document.createElement('div')
        pop.className = 'mmc-mention-pop'
        pop.innerHTML = mentionMatches.length
          ? mentionMatches.map((u, i) => `
            <button type="button" class="mmc-mention-item${i === mentionActive ? ' is-active' : ''}" data-user="${esc(u)}">
              <span class="mmc-avatar mmc-avatar--dm" style="background:${avatarColor(u)}">${avatarInner(u)}</span>
              <span>${esc(displayName(u))}</span>
            </button>`).join('')
          : `<div class="mmc-mention-empty">Kein passendes Mitglied.</div>`
        compose.appendChild(pop)
        pop.querySelectorAll('[data-user]').forEach(btn => btn.addEventListener('click', () => selectMention(btn.dataset.user)))
      }
      selectMention = username => {
        textarea.value = textarea.value.slice(0, tokenStart) + '@' + username + ' ' + textarea.value.slice(tokenEnd)
        const caret = tokenStart + username.length + 2
        closeMentionPop()
        textarea.focus()
        textarea.selectionStart = textarea.selectionEnd = caret
        textarea.dispatchEvent(new Event('input'))
      }
      const updateMentionMatches = () => {
        const caret = textarea.selectionStart
        const before = textarea.value.slice(0, caret)
        // Ohne Lookbehind, s. renderText(): Gruppe 1 ist das Zeichen vor dem @,
        // Gruppe 2 der angefangene Name — das Token selbst ist '@' + Gruppe 2.
        const m = before.match(/(^|[^\p{L}\p{N}_@-])@([\p{L}\p{N}_-]{0,32})$/u)
        if (!m) { closeMentionPop(); return }
        tokenStart = caret - (m[2].length + 1)
        tokenEnd = caret
        const partial = m[2].toLowerCase()
        // Sowohl gegen den rohen Usernamen als auch den (evtl. abweichenden)
        // Anzeigenamen matchen — eingefügt wird trotzdem der Username (s.
        // selectMention), damit _resolveMentions() in community-api.js ihn
        // wiederfindet; renderText() zeigt dafür beim Highlighten den
        // Anzeigenamen an, damit der gesendete Text nicht kryptisch aussieht.
        mentionMatches = validUsers.filter(u =>
          u.toLowerCase().startsWith(partial) || displayName(u).toLowerCase().startsWith(partial)
        ).slice(0, 8)
        mentionActive = 0
        renderMentionPop()
      }
      textarea.addEventListener('input', updateMentionMatches)
      // Caret per Maus/Pfeiltasten bewegt, ohne dass 'input' feuert — Popover ggf. neu bewerten/schließen
      textarea.addEventListener('click', () => { if (tokenStart !== -1) updateMentionMatches() })
      document.addEventListener('click', ev => {
        if (tokenStart !== -1 && !ev.target.closest('.mmc-mention-pop') && ev.target !== textarea) closeMentionPop()
      })
    }

    // Enter = senden, Shift+Enter = Zeilenumbruch — @Mention-Popover hat Vorrang, wenn offen
    textarea.addEventListener('keydown', e => {
      if (tokenStart !== -1 && mentionMatches.length) {
        if (e.key === 'ArrowDown') { e.preventDefault(); mentionActive = (mentionActive + 1) % mentionMatches.length; renderMentionPop(); return }
        if (e.key === 'ArrowUp')   { e.preventDefault(); mentionActive = (mentionActive - 1 + mentionMatches.length) % mentionMatches.length; renderMentionPop(); return }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(mentionMatches[mentionActive]); return }
        if (e.key === 'Escape') { e.preventDefault(); closeMentionPop(); return }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        scope.querySelector('#mmc-compose-form')?.requestSubmit()
        requestAnimationFrame(resize)
      }
    })
  }

  /* ── Sticker: Vorschlaege beim Tippen ─────────────────────────
     Mit Sticker-API echte Bild-Sticker zum getippten Text, sonst die
     eingebauten Emoji-Sticker. */
  const suggestBox = scope.querySelector('#mmc-sticker-suggest')
  if (suggestBox && textarea) {
    let suggestSeq = 0
    let suggestTimer = null

    const showSuggest = html => {
      if (!html) { suggestBox.hidden = true; suggestBox.innerHTML = ''; return }
      suggestBox.innerHTML = html
      suggestBox.hidden = false
    }

    const renderSuggest = async () => {
      const text = textarea.value
      if (!HAS_STICKER_API) {
        const hits = suggestStickers(text)
        showSuggest(hits.map(e => stickerSugHtml({ emoji: e.s, desc: e.k[0] })).join(''))
        return
      }
      const q = stickerQueryFrom(text)
      if (!q) { showSuggest(''); return }
      const seq = ++suggestSeq
      const hits = await searchStickerApi(q, 8)
      // Antworten koennen sich ueberholen — nur die zur letzten Eingabe zaehlt
      if (seq !== suggestSeq) return
      showSuggest(hits.map(stickerSugHtml).join(''))
    }

    textarea.addEventListener('input', () => {
      clearTimeout(suggestTimer)
      // Ohne Verzoegerung fragt jeder Tastendruck die API an
      suggestTimer = setTimeout(renderSuggest, HAS_STICKER_API ? 350 : 0)
    })
    suggestBox.addEventListener('click', ev => {
      const btn = ev.target.closest('[data-sticker]'); if (!btn) return
      pickSticker(scope, JSON.parse(btn.dataset.sticker))
      showSuggest('')
    })
  }

  /* ── Sticker-Picker: Suche + Favoriten + Trending ────────────── */
  scope.querySelector('#mmc-emoji')?.addEventListener('click', e => {
    e.stopPropagation()
    const compose = scope.querySelector('.mmc-compose')
    const existing = compose.querySelector('.mmc-emoji-pop')
    if (existing) { existing.remove(); return }

    const pop = document.createElement('div')
    pop.className = 'mmc-emoji-pop'
    pop.innerHTML = `
      <input class="mmc-sticker-search" id="mmc-sticker-search" type="search"
             placeholder="Sticker suchen …" autocomplete="off" spellcheck="false">
      <div class="mmc-sticker-body" id="mmc-sticker-body"></div>`
    compose.appendChild(pop)

    const body   = pop.querySelector('#mmc-sticker-body')
    const search = pop.querySelector('#mmc-sticker-search')
    let seq = 0, timer = null

    const section = (title, items, favs) => !items.length ? '' : `
      <div class="mmc-sticker-head">${esc(title)}</div>
      <div class="mmc-sticker-grid${items[0].emoji ? '' : ' mmc-sticker-grid--img'}">
        ${items.map(it => stickerTileHtml(it, isFav(it, favs))).join('')}
      </div>`

    const renderPicker = async () => {
      const favs = stickerFavs()
      const q = search.value.trim()

      if (!HAS_STICKER_API) {
        const hits = searchStickers(q).map(e => ({ emoji: e.s, desc: e.k[0] }))
        body.innerHTML = [
          section('Favoriten', favs.filter(f => hits.some(h => stickerKey(h) === stickerKey(f))), favs),
          section(q ? 'Treffer' : 'Alle', hits.filter(h => !isFav(h, favs)), favs),
          hits.length ? '' : '<div class="mmc-sticker-empty">Nichts gefunden.</div>',
        ].join('')
        return
      }

      const mySeq = ++seq
      body.innerHTML = `${section('Favoriten', q ? [] : favs, favs)}<div class="mmc-sticker-empty">Lädt …</div>`
      const hits = await (q ? searchStickerApi(q) : trendingStickerApi())
      if (mySeq !== seq) return
      body.innerHTML = [
        section('Favoriten', q ? [] : favs, favs),
        section(q ? 'Treffer' : 'Trending', hits, favs),
        hits.length || (!q && favs.length) ? '' : '<div class="mmc-sticker-empty">Nichts gefunden.</div>',
      ].join('')
    }
    renderPicker()

    search.addEventListener('input', () => {
      clearTimeout(timer)
      timer = setTimeout(renderPicker, HAS_STICKER_API ? 300 : 0)
    })
    // Enter im Suchfeld darf die Nachricht nicht abschicken
    search.addEventListener('keydown', ev => { if (ev.key === 'Enter') ev.preventDefault() })

    body.addEventListener('click', ev => {
      const favBtn = ev.target.closest('[data-fav]')
      if (favBtn) {
        // Favorit umschalten, Picker offen lassen
        ev.stopPropagation()
        toggleStickerFav(JSON.parse(favBtn.dataset.fav))
        renderPicker()
        return
      }
      const btn = ev.target.closest('[data-sticker]'); if (!btn) return
      pickSticker(scope, JSON.parse(btn.dataset.sticker))
      pop.remove()
    })

    const onDoc = ev => { if (!pop.contains(ev.target) && ev.target.id !== 'mmc-emoji') { pop.remove(); document.removeEventListener('click', onDoc) } }
    setTimeout(() => { document.addEventListener('click', onDoc); search.focus() }, 0)
  })
}

/* ── Sticker-Darstellung ─────────────────────────────────────────── */

/** Kachel in der Vorschlagsleiste. */
function stickerSugHtml(it) {
  const data = esc(JSON.stringify(it))
  return it.emoji
    ? `<button type="button" class="mmc-sticker-sug" data-sticker="${data}" title="${esc(it.desc || '')}">${it.emoji}</button>`
    : `<button type="button" class="mmc-sticker-sug mmc-sticker-sug--img" data-sticker="${data}" title="${esc(it.desc || '')}">
         <img src="${esc(it.preview)}" alt="${esc(it.desc || 'Sticker')}" loading="lazy"></button>`
}

/** Kachel im Picker, inkl. Favoriten-Stern. */
function stickerTileHtml(it, fav) {
  const data = esc(JSON.stringify(it))
  const label = fav ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'
  const inner = it.emoji
    ? `<button type="button" class="mmc-emoji-item" data-sticker="${data}" title="${esc(it.desc || '')}">${it.emoji}</button>`
    : `<button type="button" class="mmc-emoji-item mmc-emoji-item--img" data-sticker="${data}" title="${esc(it.desc || 'Sticker')}">
         <img src="${esc(it.preview)}" alt="${esc(it.desc || 'Sticker')}" loading="lazy"></button>`
  return `
    <span class="mmc-sticker-cell">
      ${inner}
      <button type="button" class="mmc-sticker-fav${fav ? ' is-on' : ''}" data-fav="${data}"
              title="${label}" aria-label="${label}">★</button>
    </span>`
}

/**
 * Auswahl eines Stickers. Bild-Sticker gehen wie bei TikTok sofort als eigene
 * Nachricht raus (ueber das Formular, damit Gast-Pruefung und Fehlerbehandlung
 * greifen); Emoji-Sticker landen im Text.
 */
function pickSticker(scope, it) {
  const textarea = scope.querySelector('#mmc-compose-input')
  if (it.emoji) { insertSticker(textarea, it.emoji); return }

  const form = scope.querySelector('#mmc-compose-form')
  if (!form) return
  const ext = /\.(webp|gif|png)(\?|$)/i.exec(it.url)?.[1]?.toLowerCase() || 'webp'
  form._pendingAttachment = {
    url: it.url,
    name: (it.desc || 'sticker') + '.' + ext,
    type: 'image/' + ext,
    size: 0,
    sticker: true,
  }
  form.requestSubmit()
}

/**
 * Suchbegriff fuer die Sticker-Vorschlaege: die letzten sinntragenden Woerter.
 * Ganze Saetze liefern kaum Treffer, einzelne Stichworte schon.
 */
function stickerQueryFrom(text) {
  const words = (text.toLowerCase().match(/[\p{L}]{3,}/gu) || [])
    .filter(w => !STOPWORDS.has(w))
  return words.slice(-2).join(' ')
}
const STOPWORDS = new Set([
  'und', 'oder', 'aber', 'der', 'die', 'das', 'den', 'dem', 'ein', 'eine', 'einen',
  'ich', 'du', 'er', 'sie', 'es', 'wir', 'ihr', 'mir', 'mich', 'dir', 'dich',
  'ist', 'sind', 'war', 'hat', 'habe', 'haben', 'wird', 'werden', 'kann', 'noch',
  'nicht', 'auch', 'schon', 'mal', 'was', 'wie', 'wer', 'wo', 'wann', 'warum',
  'mit', 'ohne', 'fuer', 'für', 'von', 'zum', 'zur', 'auf', 'aus', 'bei', 'nach',
])

/** Sticker an der Cursorposition einfuegen. */
function insertSticker(textarea, sticker) {
  if (!textarea) return
  const start = textarea.selectionStart, end = textarea.selectionEnd
  textarea.value = textarea.value.slice(0, start) + sticker + textarea.value.slice(end)
  textarea.selectionStart = textarea.selectionEnd = start + sticker.length
  textarea.focus()
  textarea.dispatchEvent(new Event('input'))
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

  // Voice-Room-Watcher gehören nur zur "In-Gruppe"-Ansicht — überall sonst aufräumen
  if (!activeGroup) {
    if (Object.keys(_voiceWatchers).length) { unwatchAllVoiceRooms(); _voiceWatchers = {}; _cancelAllEmptyTalkCleanups() }
    unsubscribeGroupLiveUpdates()
  }
  // DM-Typing-Abo gehört nur zur offenen DM-Ansicht
  if (!activeDM) { unsubscribeDMTyping(); _clearTyping(root) }

  if (activeGroup) {
    // In einer Gruppe: 3 Spalten (Kategorie-Icons | Talks+Kanal | Chat)
    root.innerHTML = `
      <div class="mmc mmc--ingroup">
        <nav class="mmc-catrail" id="mmc-catrail"></nav>
        <div class="mmc-col2">
          <div class="mmc-col2-body" id="mmc-col2-body"></div>
          <!-- Userbar nur hier: erst in einer Gruppe, wo man die Kanaele sieht -->
          ${userbarHtml(session, prefs)}
        </div>
        <main class="mmc-main" id="mmc-main"></main>
      </div>`
    fillRail(root)
    fillGroupChannels(root)
    renderGroupChatMain(root)
  } else if (friendsMode) {
    // Freunde-Seite: Icon-Leiste | Home-Spalte (Freunde/Nachrichten/DMs) | Inhalt | Jetzt aktiv
    root.innerHTML = `
      <div class="mmc mmc--friends">
        <nav class="mmc-catrail" id="mmc-friends-rail"></nav>
        <div class="mmc-col2">
          <div class="mmc-col2-body" id="mmc-home-body"></div>
        </div>
        <main class="mmc-main" id="mmc-main"></main>
        <aside class="mmc-active" id="mmc-active"></aside>
      </div>`
    fillRail(root)
    fillHomeColumn(root)
    fillMain(root)
    fillActive(root)
  } else {
    // Übersicht: Kategorie-Leiste | Gruppen-Karten.
    // Die Leiste war hier frueher aus Spalte 2 nachgebaut (col2ServerHtml mit
    // .mmc-nav-item/.mmc-cat). Sie sah anders aus als die echte Leiste der
    // anderen beiden Ansichten und kannte keine Ungelesen-Punkte — beim
    // Kategoriewechsel sprang deshalb die ganze linke Spalte um. Jetzt
    // ueberall dieselbe .mmc-catrail.
    root.innerHTML = `
      <div class="mmc mmc--overview">
        <nav class="mmc-catrail" id="mmc-catrail"></nav>
        <main class="mmc-main" id="mmc-main"></main>
      </div>`
    fillRail(root)
    fillMain(root)
  }
  bindApp(root)
}

/**
 * Kleines Label neben Icon-Buttons (Kategorie-Leiste und Kategorien-Liste).
 * Als eigenes, fix positioniertes Element statt ::after, weil beide Listen
 * overflow-y:auto haben — ein Pseudo-Element neben dem Icon waere dort
 * abgeschnitten. Delegiert am Root, ueberlebt also das Neuzeichnen innen.
 */
function bindIconTooltips(root) {
  if (root._mmcTipBound) return
  root._mmcTipBound = true

  // Die Ansichten setzen root.innerHTML neu — das raeumt das Tooltip-Element
  // mit weg. Die Listener am Root ueberleben, also wird es bei Bedarf einfach
  // wieder eingehaengt.
  const tipEl = document.createElement('div')
  tipEl.className = 'mmc-tip'
  const tip = () => {
    if (!tipEl.isConnected) root.appendChild(tipEl)
    return tipEl
  }

  const show = el => {
    const label = el.dataset.label
    if (!label) return
    tip().textContent = label
    const r = el.getBoundingClientRect()
    tipEl.style.left = `${Math.round(r.right + 10)}px`
    tipEl.style.top = `${Math.round(r.top + r.height / 2)}px`
    tipEl.classList.add('is-visible')
  }
  const hide = () => tipEl.classList.remove('is-visible')

  root.addEventListener('pointerover', e => {
    const el = e.target.closest?.('[data-label]')
    if (el && root.contains(el)) show(el); else hide()
  })
  root.addEventListener('pointerout', e => {
    if (e.target.closest?.('[data-label]')) hide()
  })
  root.addEventListener('focusin', e => {
    const el = e.target.closest?.('[data-label]')
    if (el) show(el)
  })
  root.addEventListener('focusout', hide)
  root.addEventListener('click', hide)
}

/**
 * Touch-Ersatz fuer .mmc-msg:hover .mmc-msg-actions: Long-Press auf eine
 * Nachricht oeffnet die Aktionsleiste (react/reply/edit/loeschen/melden).
 * Delegiert am Root wie bindIconTooltips, weil #mmc-messages bei jedem
 * Kanal-/DM-Wechsel neu erzeugt wird (ein Listener direkt am Element wuerde
 * den naechsten Wechsel nicht ueberleben).
 */
function bindMsgLongPress(root) {
  if (root._mmcLongPressBound) return
  root._mmcLongPressBound = true

  const HOLD_MS = 450
  const MOVE_TOLERANCE = 10
  let timer = null
  let pressEl = null
  let pointerId = null
  let startX = 0, startY = 0
  let firedByLongPress = false

  const closeOpen = except => {
    root.querySelectorAll('.mmc-msg--actions-open').forEach(el => {
      if (el !== except) el.classList.remove('mmc-msg--actions-open')
    })
  }
  const endPress = () => {
    if (timer) { clearTimeout(timer); timer = null }
    pressEl?.classList.remove('mmc-msg--pressing')
    pressEl = null
    pointerId = null
  }

  // Nur Touch/Pen: Maus hat schon :hover, dafuer braucht es keinen Long-Press.
  root.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return
    const msgEl = e.target.closest('.mmc-msg')
    if (!msgEl || !root.contains(msgEl)) return
    if (!msgEl.querySelector('.mmc-msg-actions')) return  // Systemnachricht ohne Aktionen
    if (e.target.closest('.mmc-msg-actions')) return      // schon offene Buttons nicht kapern

    endPress()             // falls ein zweiter Finger einen laufenden Press abbricht
    firedByLongPress = false
    pointerId = e.pointerId
    pressEl = msgEl
    startX = e.clientX; startY = e.clientY
    msgEl.classList.add('mmc-msg--pressing')
    timer = setTimeout(() => {
      timer = null
      firedByLongPress = true
      closeOpen(msgEl)
      msgEl.classList.add('mmc-msg--actions-open')
      msgEl.classList.remove('mmc-msg--pressing')
      navigator.vibrate?.(8)
    }, HOLD_MS)
  })

  // Abbruch bei Bewegung, damit Scrollen nie vom Long-Press blockiert wird.
  root.addEventListener('pointermove', e => {
    if (e.pointerId !== pointerId || !pressEl) return
    if (Math.abs(e.clientX - startX) > MOVE_TOLERANCE || Math.abs(e.clientY - startY) > MOVE_TOLERANCE) {
      endPress()
    }
  })
  root.addEventListener('pointerup', e => { if (e.pointerId === pointerId) endPress() })
  root.addEventListener('pointercancel', e => { if (e.pointerId === pointerId) endPress() })

  // Android schickt bei Long-Press sonst zusaetzlich ein natives Kontextmenue.
  root.addEventListener('contextmenu', e => {
    if (e.target.closest('.mmc-msg')) e.preventDefault()
  })

  // Faengt den Ghost-Click ab, den Touch nach dem Long-Press noch nachschickt
  // (sonst wuerde z. B. der Avatar-Klick direkt hinter dem Oeffnen feuern),
  // und schliesst eine offene Aktionsleiste beim Antippen woanders.
  root.addEventListener('click', e => {
    if (firedByLongPress) {
      firedByLongPress = false
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (!e.target.closest('.mmc-msg-actions')) closeOpen()
  }, true)
}

/* ── Userbar events ────────────────────────────────────────────── */
function bindApp(root) {
  bindIconTooltips(root)
  bindMsgLongPress(root)
  root.querySelector('#mmc-user-id')?.addEventListener('click', e => { e.stopPropagation(); openUserMenu(root) })
  root.querySelector('#mmc-logout')?.addEventListener('click', () => goToAuth(root))

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
  const selectedDevId = isIn ? (prefs.micDeviceId || '') : (prefs.sinkDeviceId || '')

  // Nur die Ausgabelautstärke ist im Browser tatsächlich regelbar (Lautstärke
  // der Wiedergabe-Elemente). Für die Eingabe gibt es keine entsprechende
  // Stellschraube — ein Regler dafür schrieb bisher nur einen Wert in die
  // Einstellungen, ohne das Mikrofon zu beeinflussen, und wird deshalb nicht
  // mehr angeboten (echte Mikrofon-Verstärkung bräuchte einen WebAudio-Gain
  // in der Publish-Kette).
  const volSection = isIn ? '' : `
    <div class="mmc-am-sep"></div>
    <div class="mmc-am-vol">
      <div class="mmc-am-title">Ausgabelautstärke</div>
      <input type="range" class="mmc-am-slider" min="0" max="100" value="${prefs.outVol ?? 100}">
    </div>`

  const pop = document.createElement('div')
  pop.className = 'mmc-audiomenu'; pop.dataset.type = type
  pop.innerHTML = `
    <div class="mmc-am-title mmc-am-title--head">${isIn ? 'Eingabegerät' : 'Ausgabegerät'}</div>
    <div class="mmc-am-device-list" id="mmc-am-devlist">
      <div class="mmc-am-sub">Geräte werden geladen …</div>
    </div>
    ${volSection}`
  anchor.appendChild(pop)
  requestAnimationFrame(() => pop.classList.add('is-open'))

  const close = () => { pop.remove(); document.removeEventListener('click', onDoc) }
  const onDoc = ev => { if (!pop.contains(ev.target) && !ev.target.closest('.mmc-uc-group')) close() }
  setTimeout(() => document.addEventListener('click', onDoc), 0)

  pop.querySelector('.mmc-am-slider')?.addEventListener('input', e => {
    const p = getPrefs(); p.outVol = +e.target.value; setPrefs(p)
    setOutputVolume(p.outVol)   // sofort hörbar, nicht erst beim nächsten Beitritt
  })

  /**
   * Geräteliste in das Popover zeichnen. `prompt` nur auf ausdrücklichen Klick:
   * ohne erteilte Mikrofon-Freigabe liefert der Browser Geräte ohne Namen, und
   * das Nachfordern der Freigabe öffnet einen Systemdialog — den soll ein
   * Menü-Öffnen nicht auslösen.
   */
  const renderDevices = async ({ prompt = false } = {}) => {
    const devList = pop.querySelector('#mmc-am-devlist')
    if (!devList) return
    if (prompt) devList.innerHTML = '<div class="mmc-am-sub">Geräte werden geladen …</div>'

    const { inputs, outputs } = await listAudioDevices({ prompt })
    if (!pop.isConnected) return
    const devices = isIn ? inputs : outputs
    if (!devices.length) {
      devList.innerHTML = '<div class="mmc-am-sub">Keine Geräte gefunden.</div>'
      return
    }

    // Ohne Freigabe sind alle Namen leer — dann ist die Liste nicht
    // unterscheidbar, also lieber ehrlich benennen und die Freigabe anbieten.
    const unnamed = devices.every(d => !d.label)
    devList.innerHTML = devices.map(d => `
      <button class="mmc-am-device${d.deviceId === selectedDevId ? ' is-selected' : ''}" data-dev="${esc(d.deviceId)}">
        ${d.deviceId === selectedDevId ? '✓ ' : ''}${esc(d.label || (isIn ? 'Standard-Mikrofon' : 'Standard-Ausgabe'))}
      </button>`).join('')
      + (unnamed
        ? `<button class="mmc-am-device mmc-am-grant" id="mmc-am-grant">Gerätenamen anzeigen …</button>`
        : '')

    devList.querySelector('#mmc-am-grant')?.addEventListener('click', () => renderDevices({ prompt: true }))

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
  }
  renderDevices()
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
      updatePresenceStatus(p.status)
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
  pop.querySelector('[data-act="logout"]')?.addEventListener('click', () => { close(); goToAuth(root) })
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


function groupsIn(catId) { return getGroups().filter(g => g.category === catId) }

/**
 * Die Kategorie-Leiste links — fuer **alle** Ansichten dieselbe.
 *
 * Vorher gab es sie dreimal: fillFriendsRail() fuer die Freunde-Seite,
 * fillCatRail() fuer die Gruppenansicht und in der Uebersicht einen Nachbau
 * aus Spalte 2 (.mmc-nav-item/.mmc-cat, 46px, Radius 14 statt .mmc-crb).
 * Beim Wechsel zwischen Kategorien tauschte damit nicht nur der aktive
 * Eintrag, sondern die ganze Leiste — samt Ungelesen-Punkten, die es nur in
 * einer der drei Fassungen gab.
 *
 * Eine Fassung, ein Aussehen: Startknopf oben (aktiv im Freunde-Modus),
 * Trennlinie, Kategorien mit Ungelesen-Punkt. Welche aktiv ist, ergibt sich
 * aus dem Zustand, nicht aus der Ansicht.
 */
function fillRail(root) {
  const rail = root.querySelector('.mmc-catrail'); if (!rail) return
  const g = getGroups().find(x => x.id === activeGroup)
  const activeCat = g ? g.category : (friendsMode ? null : serverCategory)
  const myName = me()
  const catHasUnread = id => groupsIn(id).some(gr => {
    if (!gr.members.includes(myName)) return false
    if (isMuted(gr.id)) return false
    groupDefaults(gr)
    return unreadCountGroup(gr) > 0
  })
  rail.innerHTML = `
    <button class="mmc-crb ${friendsMode ? 'is-active' : ''}" data-rail-home
            aria-label="Freunde / Startseite" data-label="Freunde / Startseite">${ICON.people}</button>
    <div class="mmc-rail-sep"></div>
    ${CATEGORIES.map(c => `
      <button class="mmc-crb ${c.id === activeCat ? 'is-active' : ''}" data-cat="${c.id}"
              aria-label="${esc(c.name)}" data-label="${esc(c.name)}">
        ${ICON[c.icon]}
        ${catHasUnread(c.id) ? '<span class="mmc-rail-dot"></span>' : ''}
      </button>
    `).join('')}`
  rail.querySelector('[data-rail-home]')?.addEventListener('click', () => {
    friendsMode = true; homeSection = 'friends'; activeGroup = null; activeDM = null; discoverOpen = false; renderApp(root)
  })
  rail.querySelectorAll('.mmc-crb[data-cat]').forEach(b => b.addEventListener('click', () => {
    friendsMode = false; serverCategory = b.dataset.cat; activeGroup = null; activeDM = null; discoverOpen = false; renderApp(root)
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
    <button type="button" class="mmc-back mmc-mback" id="mmc-home-back" title="Zurück zur Übersicht">${ICON.back}</button>
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
  box.querySelector('#mmc-home-back')?.addEventListener('click', () => { friendsMode = false; renderApp(root) })
  box.querySelectorAll('.mmc-nav-item[data-section]').forEach(el => el.addEventListener('click', () => {
    homeSection = el.dataset.section; activeDM = null; discoverOpen = false; fillHomeColumn(root); fillMain(root); fillActive(root); mobileShowDetail(root)
  }))
  box.querySelectorAll('.mmc-dm[data-dm]').forEach(el => el.addEventListener('click', () => {
    activeDM = el.dataset.dm; clearUnread(activeDM)
    subscribeToChannel(null, activeDM)
    fillHomeColumn(root, box.querySelector('#mmc-dm-search')?.value || ''); fillMain(root); fillActive(root); mobileShowDetail(root)
  }))
  box.querySelector('#mmc-dm-add')?.addEventListener('click', () => {
    homeSection = 'friends'; friendsTab = 'add'; activeDM = null; discoverOpen = false; fillHomeColumn(root); fillMain(root); fillActive(root); mobileShowDetail(root)
  })
  const searchInput = box.querySelector('#mmc-dm-search')
  searchInput?.addEventListener('input', e => fillHomeColumn(root, e.target.value))
  if (searchQuery) { searchInput.focus(); searchInput.setSelectionRange(searchQuery.length, searchQuery.length) }
}

/* ── Freunde-Modus: Nachrichten (DM-Anfragen von Nicht-Freunden / Spam) ── */
function renderRequests(main, root) {
  main.innerHTML = `
    <header class="mmc-main-head">
      ${mobileBackHtml()}
      ${ICON.mail}<span class="mmc-main-title">Nachrichten</span>
      <div class="mmc-tabs">
        <button class="mmc-tab is-active" data-rtab="anfragen">Anfragen</button>
        <button class="mmc-tab" data-rtab="spam">Spam</button>
      </div>
    </header>
    <div class="mmc-main-body" id="mmc-req-body"></div>`
  bindMobileBack(main, root)
  const body = main.querySelector('#mmc-req-body')
  const renderTab = t => { body.innerHTML = `<div class="mmc-friends-empty"><p>${t === 'spam' ? 'Kein Spam vorhanden.' : 'Nachrichtenanfragen sind noch nicht aktiv — Direktnachrichten erreichen dich vorerst direkt.'}</p></div>` }
  renderTab('anfragen')
  main.querySelectorAll('[data-rtab]').forEach(b => b.addEventListener('click', () => {
    main.querySelectorAll('[data-rtab]').forEach(x => x.classList.remove('is-active'))
    b.classList.add('is-active'); renderTab(b.dataset.rtab)
  }))
}


/* ══════════════════════════════════════════════════════════════════
   MAIN CONTENT
   ══════════════════════════════════════════════════════════════════ */
function fillMain(root) {
  const main = root.querySelector('#mmc-main')
  if (!main) return

  if (friendsMode) {
    if (activeDM) renderDMView(main, root)
    else if (discoverOpen) renderDiscoverView(main, root)
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
      ${mobileBackHtml()}
      ${ICON.people}<span class="mmc-main-title">Freunde</span>
      <div class="mmc-tabs">
        ${tabs.map(([k, l]) => `<button class="mmc-tab ${friendsTab === k ? 'is-active' : ''} ${k === 'add' ? 'mmc-tab-add' : ''}" data-tab="${k}">${l}${k === 'pending' && pendingCount ? ` <span class="mmc-tab-count">${pendingCount}</span>` : ''}</button>`).join('')}
      </div>
    </header>
    <div class="mmc-main-body" id="mmc-friends-body"></div>
  `
  bindMobileBack(main, root)
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
      discoverOpen = true; fillMain(root)
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

/* ── Server entdecken (Discovery) ──────────────────────────────────
 * Zeigt öffentlich sichtbare Server (joinMode "open"/"request") über
 * alle Kategorien, denen der Nutzer noch nicht beigetreten ist. Nur
 * auf Einladung zugängliche Server werden hier bewusst nicht gelistet. */
function discoverableGroups() {
  const myName = me()
  return getGroups()
    .filter(g => !g.members.includes(myName))
    .filter(g => !isGroupBanned(g, myName))
    .filter(g => (g.joinMode || 'open') !== 'invite')
}

function lastActivityAt(g) {
  groupDefaults(g)
  let last = g.createdAt || 0
  for (const ch of g.channels) {
    const m = ch.messages[ch.messages.length - 1]
    if (m && m.ts > last) last = m.ts
  }
  return last
}

function renderDiscoverView(main, root) {
  const myName = me()
  const pool = discoverableGroups()
  main.innerHTML = `
    <header class="mmc-main-head">
      ${mobileBackHtml()}
      ${ICON.compass}<span class="mmc-main-title">Server entdecken</span>
    </header>
    <div class="mmc-main-body" id="mmc-discover-body"></div>`
  bindMobileBack(main, root)
  const body = main.querySelector('#mmc-discover-body')

  const sections = CATEGORIES
    .map(cat => ({ cat, list: pool.filter(g => g.category === cat.id).sort((a, b) => lastActivityAt(b) - lastActivityAt(a)) }))
    .filter(({ list }) => list.length)

  body.innerHTML = sections.length
    ? `<p class="mmc-cat-intro">Entdecke offene Server über alle Kategorien, denen du noch nicht beigetreten bist.</p>
       ${sections.map(({ cat, list }) => `
         <div class="mmc-friends-count">${esc(cat.name)} — ${list.length}</div>
         <div class="mmc-group-grid">${list.map(g => groupCardHtml(g, myName)).join('')}</div>
       `).join('')}`
    : `<div class="mmc-friends-empty"><p>Aktuell gibt es nichts Neues zu entdecken — du bist bereits überall dabei!</p></div>`

  body.querySelectorAll('[data-join]').forEach(b => b.addEventListener('click', async e => { e.stopPropagation(); await _joinGroupUI(root, b.dataset.join) }))
  body.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { activeGroup = b.dataset.open; renderApp(root) }))
  body.querySelectorAll('[data-cancel-req]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation()
    const groupId = b.dataset.cancelReq
    const req = myGroupRequest(groupId)
    if (req) await declineGroupRequest(req.id)
    renderDiscoverView(main, root)
  }))
  body.querySelectorAll('[data-rsvp]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation()
    await toggleRsvp(b.dataset.rsvp)
    renderDiscoverView(main, root)
  }))
  body.querySelectorAll('[data-mappoint]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation()
    _openMapForPoint(b.dataset.mappoint)
  }))

  _watchTalksForCards(body, pool)
}

/* ── DM chat ───────────────────────────────────────────────────── */
function renderDMView(main, root) {
  const name = activeDM
  _clearTyping(root)
  subscribeDMTyping(name, username => _onTypingReceived(root, username))
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
      ${mobileBackHtml()}
      <div class="mmc-avatar mmc-avatar--dm" style="background:${avatarColor(name)}">${avatarInner(name)}<span class="mmc-presence"></span></div>
      <span class="mmc-chat-title">${esc(displayName(name))}</span>
      <button class="mmc-bell-btn" id="mmc-dm-call" title="${esc(displayName(name))} anrufen">${ICON.phone}</button>
      <button class="mmc-bell-btn${dmMuted ? ' is-muted' : ''}" id="mmc-dm-bell" title="${dmMuted ? 'Stummschaltung aufheben' : 'Chat stummschalten'}">${bellIcon}</button>
    </header>
    <div class="mmc-messages" id="mmc-messages"></div>
    ${composeHtml('Nachricht an @' + esc(name))}`
  bindMobileBack(main, root)
  main.querySelector('#mmc-dm-bell')?.addEventListener('click', e => { e.stopPropagation(); openMuteMenu(root, dmKey, true) })
  main.querySelector('#mmc-dm-call')?.addEventListener('click', e => { e.stopPropagation(); _startCall(root, name) })
  renderMessagesInto(root, main.querySelector('#mmc-messages'), (getDMs()[name]) || [], {
    title: displayName(name), text: `Das ist der Anfang deiner Unterhaltung mit ${displayName(name)}.`, avatar: name,
  }, null, prevReadTs)
  bindComposeExtras(main, root, () => sendDMTyping(name))
  main.querySelector('#mmc-compose-form')?.addEventListener('submit', async e => {
    e.preventDefault()
    const input = main.querySelector('#mmc-compose-input')
    const form  = main.querySelector('#mmc-compose-form')
    const text  = input.value.trim()
    const attachment = form?._pendingAttachment || null
    if (!text && !attachment) return
    // Gäste dürfen nicht schreiben (Online-Modus)
    if (!OFFLINE_MODE && getSession()?.guest) { toast(root, 'Bitte melde dich an, um Nachrichten zu senden.'); return }
    const done = _composeBusy(form, true)
    const res = await sendDM(name, text, replyingTo, attachment)
    done()
    if (res && res.ok === false) { toast(root, res.error || 'Senden fehlgeschlagen.'); return }
    // Text kam durch, der Anhang nicht — das muss man sehen, sonst glaubt man,
    // der Sticker sei beim Gegenüber angekommen.
    if (res?.warn) toast(root, res.warn)
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
      ${mobileBackHtml()}
      ${ICON[cat.icon]}<span class="mmc-main-title">${esc(cat.name)}</span>
      <div class="mmc-tabs" style="margin-left:auto">
        <button class="mmc-tab mmc-tab-add" id="mmc-group-create">+ ${esc(cat.verbNew)}</button>
      </div>
    </header>
    <div class="mmc-main-body">
      <div class="mmc-invite-redeem" id="mmc-invite-redeem-box">
        <form class="mmc-invite-redeem-form" id="mmc-invite-redeem-form" autocomplete="off">
          <input class="mmc-input mmc-invite-redeem-input" id="mmc-invite-code-input" type="text" maxlength="48" placeholder="Einladungscode oder Name suchen …" autocomplete="off" spellcheck="false">
          <button type="submit" class="mmc-auth-submit mmc-auth-submit--sm">Einlösen</button>
        </form>
        <div class="mmc-invite-suggest" id="mmc-invite-suggest"></div>
        <div class="mmc-invite-redeem-msg" id="mmc-invite-redeem-msg" hidden></div>
      </div>
      <p class="mmc-cat-intro">Tritt ${datIndef(cat.gender)} bestehenden ${esc(cat.noun)} bei oder erstelle ${ownPhrase(cat.gender)}.</p>
      ${groups.length
        ? `<div class="mmc-group-grid">${groups.map(g => groupCardHtml(g, myName)).join('')}</div>`
        : `<div class="mmc-friends-empty"><p>Noch nichts in ${esc(cat.name)} — erstelle ${firstAkk(cat.gender)} ${esc(cat.noun)}!</p></div>`}
    </div>`
  bindMobileBack(main, root)

  /* ── Einladungscode einlösen ODER nach Gruppennamen suchen ──────────
   * Dasselbe Feld für beides: Wer einen Code hat, tippt ihn ein und drückt
   * Einlösen; wer nur den Namen kennt, bekommt schon beim Tippen Treffer
   * angeboten — über alle Kategorien hinweg, nicht nur die gerade offene,
   * denn welche Kategorie eine Gruppe hat, weiß man beim Suchen selten. */
  const inviteInput   = main.querySelector('#mmc-invite-code-input')
  const inviteMsgEl   = main.querySelector('#mmc-invite-redeem-msg')
  const inviteSuggest = main.querySelector('#mmc-invite-suggest')

  const showInviteMsg = (text, ok) => {
    inviteMsgEl.hidden = false
    inviteMsgEl.className = `mmc-invite-redeem-msg mmc-invite-redeem-msg--${ok ? 'ok' : 'err'}`
    inviteMsgEl.textContent = text
  }

  const findGroupsByName = term => {
    const q = term.trim().toLowerCase()
    if (q.length < 2) return []
    return getGroups()
      .filter(g => g.name.toLowerCase().includes(q))
      .filter(g => !isGroupBanned(g, myName))
      .slice(0, 8)
  }

  const renderInviteSuggestions = matches => {
    if (!matches.length) { inviteSuggest.innerHTML = ''; return }
    inviteSuggest.innerHTML = matches.map(g => {
      const joined = g.members.includes(myName)
      const gCat = catById(g.category)
      const action = joined ? 'Öffnen'
        : g.joinMode === 'invite'  ? 'Nur Einladung'
        : g.joinMode === 'request' ? 'Anfragen'
        : 'Beitreten'
      return `
        <button type="button" class="mmc-suggest-item" data-found-group="${esc(g.id)}">
          <span class="mmc-suggest-badge" style="background:${colorFor(g.name)}">${initials(g.name)}</span>
          <span class="mmc-suggest-main">
            <span class="mmc-suggest-name">${esc(g.name)}</span>
            <span class="mmc-suggest-sub">${esc(gCat.name)} · ${g.members.length} ${g.members.length === 1 ? 'Mitglied' : 'Mitglieder'}</span>
          </span>
          <span class="mmc-suggest-action">${action}</span>
        </button>`
    }).join('')

    inviteSuggest.querySelectorAll('[data-found-group]').forEach(btn => btn.addEventListener('click', async () => {
      const g = getGroups().find(x => x.id === btn.dataset.foundGroup); if (!g) return
      // Treffer kann aus einer anderen Kategorie stammen — dorthin mitwechseln,
      // sonst landet man nach dem Beitritt in einer Liste ohne die Gruppe.
      serverCategory = g.category
      if (g.members.includes(myName)) { activeGroup = g.id; renderApp(root) }
      else await _joinGroupUI(root, g.id)
    }))
  }

  inviteInput?.addEventListener('input', () => {
    inviteMsgEl.hidden = true
    renderInviteSuggestions(findGroupsByName(inviteInput.value))
  })

  main.querySelector('#mmc-invite-redeem-form')?.addEventListener('submit', async e => {
    e.preventDefault()
    const entry = inviteInput.value.trim()
    if (!entry) return
    const res = await redeemInvite(entry)
    if (res.ok) {
      showInviteMsg(`Du bist „${res.group.name}" beigetreten.`, true)
      inviteInput.value = ''
      inviteSuggest.innerHTML = ''
      toast(root, `Du bist „${res.group.name}" beigetreten.`)
      activeGroup = res.group.id
      renderApp(root)
      return
    }
    // Nur wenn der Code schlicht unbekannt ist, war die Eingabe womöglich ein
    // Name. Bei abgelaufenen, aufgebrauchten oder gesperrten Codes den genauen
    // Grund zeigen — sonst hieße es fälschlich „nicht gefunden".
    if (res.reason !== 'unknown_code') { showInviteMsg(res.error, false); return }

    const matches = findGroupsByName(entry)
    if (matches.length) {
      inviteMsgEl.hidden = true
      renderInviteSuggestions(matches)
      return
    }
    showInviteMsg(`Kein Einladungscode und keine Gruppe zu „${entry}" gefunden.`, false)
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

  _watchTalksForCards(main, groups)
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

  // "Gerade im Talk": Das Element steht immer im Markup (ggf. hidden), damit
  // _refreshGroupLiveBadges() es bei Presence-Änderungen nur noch ein-/ausblenden
  // muss, statt die ganze Karte neu zu bauen.
  const liveCount = talkHeadcount(g)
  const liveTalk = `<div class="mmc-group-live" data-live-group="${esc(g.id)}"${liveCount ? '' : ' hidden'}>` +
    `${ICON.speaker}<span>${liveCount === 1 ? '1 Person im Talk' : `${liveCount} Personen im Talk`}</span></div>`

  return `
    <div class="mmc-group-card">
      <div class="mmc-group-top">
        <div class="mmc-group-badge" style="background:${colorFor(g.name)}">${initials(g.name)}</div>
        <div class="mmc-group-info">
          <div class="mmc-group-name${!muted && unreadCount > 0 ? ' mmc-group-name--unread' : ''}">${esc(g.name)}</div>
          <div class="mmc-group-meta">${ICON.users}<span>${g.members.length} ${g.members.length === 1 ? 'Mitglied' : 'Mitglieder'} · von ${esc(displayName(g.createdBy))}</span></div>
        </div>
        <span class="mmc-mode-badge" title="${mode.label}">${mode.icon}</span>
        ${canManage(g) && reqCount > 0 ? `<span class="mmc-req-badge">${reqCount}</span>` : ''}
        ${unreadCount > 0 ? `<span class="mmc-unread-badge${muted ? ' mmc-unread-badge--muted' : ''}">${unreadCount}</span>` : ''}
        ${muted ? `<span class="mmc-mute-icon" title="Stummgeschaltet">${ICON.belloff}</span>` : ''}
      </div>
      <div class="mmc-group-desc">${esc(g.desc || (last ? last.text : ''))}</div>
      ${liveTalk}
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
    fillMain(root)
  })
  requestAnimationFrame(() => overlay.querySelector('#mmc-req-text')?.focus())
}

/* ── Server: group chat ────────────────────────────────────────── */

/* ── In-Gruppe: Kanal-/Talk-Spalte (Mitte) ─────────────────────── */
async function _leaveGroupUI(root) {
  const g = getGroups().find(x => x.id === activeGroup); if (!g) return
  if (isOwner(g)) return
  await leaveGroup(activeGroup)
  activeGroup = null
  renderApp(root)
}

/**
 * Hält die Live-Beobachtung ("wer ist gerade im Talk") synchron mit den
 * gerade sichtbaren Talks: startet Watcher für neu sichtbare Räume, stoppt
 * sie für verschwundene und für den Raum, dem man selbst beigetreten ist
 * (dessen Mitgliederliste kommt dann direkt aus dem joinVoiceRoom()-Callback
 * in toggleVoiceRoom).
 *
 * `entries` ist bewusst nicht an eine einzelne Gruppe gebunden: In der
 * Kategorie-Übersicht werden die Talks mehrerer Gruppen gleichzeitig
 * beobachtet, damit ein laufender Talk schon auf der Karte sichtbar ist und
 * nicht erst, nachdem man die Gruppe geöffnet hat.
 *
 * @param {{groupId: string, roomId: string}[]} entries - sichtbare Talks
 * @param {Function} onUpdate - nach jeder Presence-Änderung aufgerufen
 */
function _syncVoiceWatchers(entries, onUpdate) {
  _onVoiceWatchUpdate = onUpdate
  const wanted = new Map(entries.map(e => [e.roomId, e.groupId]))

  for (const id of Object.keys(_voiceWatchers)) {
    if (!wanted.has(id) || currentRoomId() === id) {
      _voiceWatchers[id](); delete _voiceWatchers[id]
      // Ohne Watcher wüsste der Timer nicht mehr, ob der Talk noch leer ist.
      _cancelEmptyTalkCleanup(id)
    }
  }

  for (const [roomId, groupId] of wanted) {
    if (currentRoomId() === roomId || _voiceWatchers[roomId]) continue
    _voiceWatchers[roomId] = watchVoiceRoom(roomId, participants => {
      const gCur = getGroups().find(x => x.id === groupId); if (!gCur) return
      const rCur = (gCur.voiceRooms || []).find(x => x.id === roomId); if (!rCur) return
      rCur.members = participants.map(p => p.username)
      rCur.voiceParticipants = {}
      for (const p of participants) rCur.voiceParticipants[p.username] = { muted: p.muted, speaking: false }
      if (rCur.members.length) _cancelEmptyTalkCleanup(roomId)
      else _scheduleEmptyTalkCleanup(groupId, roomId)
      _onVoiceWatchUpdate()
    })
  }
}

/* ── Leere Talks räumen sich selbst auf ───────────────────────────
 * Sonst sammeln sich ungenutzte Sprachkanäle an, die niemand wieder
 * wegräumt. Gelöscht wird erst nach einer Schonfrist: ein gerade geöffneter
 * Talk soll nicht verschwinden, bevor überhaupt jemand beitreten konnte, und
 * ein kurzer Verbindungsabbruch soll ihn nicht kosten. */
const EMPTY_TALK_TTL_MS = 2 * 60 * 1000
const _emptyTalkTimers = new Map()   // roomId -> timeoutId

function _cancelEmptyTalkCleanup(roomId) {
  const t = _emptyTalkTimers.get(roomId)
  if (t !== undefined) { clearTimeout(t); _emptyTalkTimers.delete(roomId) }
}

function _cancelAllEmptyTalkCleanups() {
  for (const t of _emptyTalkTimers.values()) clearTimeout(t)
  _emptyTalkTimers.clear()
}

/**
 * Darf dieser Client den Talk wirklich löschen? Die RLS-Policy `vr_delete`
 * (supabase/schema.sql) erlaubt es nur Ersteller, Host oder Mod. Jeder andere
 * würde den Talk zwar lokal entfernen und das auch an alle broadcasten, die
 * Zeile bliebe aber in der Datenbank — der Talk wäre nach dem nächsten Laden
 * wieder da. Deshalb hier dieselbe Bedingung wie in der Policy prüfen.
 */
function _mayDeleteTalk(g, room) {
  if (OFFLINE_MODE) return true          // rein lokale Daten, keine RLS im Spiel
  if (canManage(g)) return true          // Host/Mod
  return !!room.createdBy && room.createdBy === getSession()?.id
}

function _scheduleEmptyTalkCleanup(groupId, roomId) {
  if (_emptyTalkTimers.has(roomId)) return
  _emptyTalkTimers.set(roomId, setTimeout(async () => {
    _emptyTalkTimers.delete(roomId)
    const g = getGroups().find(x => x.id === groupId); if (!g) return
    const r = (g.voiceRooms || []).find(x => x.id === roomId); if (!r) return
    // Inzwischen doch wieder jemand drin (oder ich selbst)? Dann bleibt er.
    if (r.members?.length || currentRoomId() === roomId) return
    if (!_mayDeleteTalk(g, r)) return
    await deleteVoiceRoom(groupId, roomId)
    _onVoiceWatchUpdate()
  }, EMPTY_TALK_TTL_MS))
}

/** Wie viele Leute sitzen gerade in den Talks dieser Gruppe? */
function talkHeadcount(g) {
  return (g.voiceRooms || []).reduce((n, r) => n + (r.members?.length || 0), 0)
}

/**
 * Aktualisiert nur die "X im Talk"-Anzeigen der Gruppenkarten, statt die
 * Liste neu zu zeichnen — ein Neuaufbau bei jeder Presence-Änderung würde
 * Scrollposition und offene Menüs verlieren und sichtbar ruckeln.
 */
function _refreshGroupLiveBadges(scope) {
  for (const el of scope.querySelectorAll('[data-live-group]')) {
    const g = getGroups().find(x => x.id === el.dataset.liveGroup)
    const n = g ? talkHeadcount(g) : 0
    el.hidden = !n
    const label = el.querySelector('span')
    if (label) label.textContent = n === 1 ? '1 Person im Talk' : `${n} Personen im Talk`
  }
}

/** Talks aller sichtbaren Gruppen beobachten und deren Karten live halten. */
function _watchTalksForCards(scope, groups) {
  _syncVoiceWatchers(
    groups.flatMap(g => (g.voiceRooms || []).map(r => ({ groupId: g.id, roomId: r.id }))),
    () => _refreshGroupLiveBadges(scope),
  )
}

/**
 * Hält Kanal-/Talk-LISTE einer Gruppe live: wenn ein anderes Mitglied einen
 * Text- oder Sprachkanal erstellt oder löscht, poppt er auch bei mir sofort
 * auf/weg, statt erst nach einem Reload sichtbar zu werden (siehe
 * subscribeGroupLiveUpdates in community-api.js — weder channels noch
 * voice_rooms haben postgres_changes-Replikation). Ohne das würden Nachrichten
 * in einem frisch erstellten, mir noch unbekannten Kanal auch stillschweigend
 * verworfen (_handleNewMessage findet keinen passenden Kanal).
 */
function _syncGroupLiveUpdates(root, g) {
  subscribeGroupLiveUpdates(g.id, (type, payload) => {
    const gCur = getGroups().find(x => x.id === g.id); if (!gCur) return
    switch (type) {
      case 'room_created': {
        gCur.voiceRooms ||= []
        if (gCur.voiceRooms.some(r => r.id === payload.room.id)) return
        gCur.voiceRooms.push({ ...payload.room, members: [] })
        break
      }
      case 'room_deleted': {
        const before = (gCur.voiceRooms || []).length
        gCur.voiceRooms = (gCur.voiceRooms || []).filter(r => r.id !== payload.roomId)
        _vcPrevMembers.delete(payload.roomId)
        // Falls ich selbst gerade drin war (Talk von Host/Mod gelöscht): Mikro/Peers aufräumen.
        if (currentRoomId() === payload.roomId) leaveVoiceRoom()
        if (gCur.voiceRooms.length === before) return
        break
      }
      case 'channel_created': {
        gCur.channels ||= []
        if (gCur.channels.some(c => c.id === payload.channel.id)) return
        gCur.channels.push({ ...payload.channel, messages: [] })
        break
      }
      case 'channel_deleted': {
        const before = (gCur.channels || []).length
        gCur.channels = (gCur.channels || []).filter(c => c.id !== payload.channelId)
        if (gCur.channels.length === before) return
        if (activeGroup === gCur.id && activeChannel === payload.channelId) {
          activeChannel = gCur.channels[0]?.id || null
          if (activeChannel) renderGroupChatMain(root)
        }
        break
      }
      case 'typing': {
        // Kein fillGroupChannels() — nur die Indikator-Zeile aktualisieren, kein Re-Render der Sidebar
        if (activeGroup === gCur.id && activeChannel === payload.channelId) _onTypingReceived(root, payload.username)
        return
      }
      default: return
    }
    if (activeGroup === gCur.id) fillGroupChannels(root)
  })
}

function fillGroupChannels(root) {
  const box = root.querySelector('#mmc-col2-body'); if (!box) return
  const g = getGroups().find(x => x.id === activeGroup); if (!g) return
  groupDefaults(g)
  // Ensure activeChannel is valid
  if (!activeChannel || !g.channels.find(c => c.id === activeChannel)) {
    activeChannel = g.channels[0]?.id || null
  }
  _syncVoiceWatchers(
    (g.voiceRooms || []).map(r => ({ groupId: g.id, roomId: r.id })),
    () => { if (activeGroup === g.id) fillGroupChannels(root) },
  )
  _syncGroupLiveUpdates(root, g)
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
        <div class="mmc-server-tag">${esc(cat.name)} · ${g.members.length} ${g.members.length === 1 ? 'Mitglied' : 'Mitglieder'}</div>
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
      ${rooms.length ? rooms.map(r => voiceChannelHtml(r, myName, managing)).join('')
        : '<div class="mmc-dm-empty">Noch kein Talk offen — mit + starten</div>'}
    </div>
    ${roleActions}`

  // Verlassende Talk-Teilnehmer erst nach ihrer Austritts-Animation entfernen
  box.querySelectorAll('.mmc-vc-member--leave').forEach(el => el.addEventListener('animationend', () => el.remove(), { once: true }))

  // Screen-Share-Video-Elemente (leben in voice.js) in ihre Kacheln einhängen —
  // außer eins hängt gerade in einer offenen Lightbox, die bleibt Besitzerin,
  // bis sie selbst schließt (sonst würde ein Re-Render sie mitten im
  // Vollbild zurück in die kleine Kachel reißen).
  box.querySelectorAll('[data-screenshare]').forEach(el => {
    const videoEl = getScreenShareEl(el.dataset.screenshare)
    if (videoEl && !videoEl.closest('.mmc-share-lightbox')) el.appendChild(videoEl)
  })
  box.querySelectorAll('[data-screenshare]').forEach(el => el.addEventListener('click', () => {
    openScreenShareLightbox(el.dataset.screenshare, el.dataset.screenshareName)
  }))
  box.querySelectorAll('[data-vc-share]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation()
    const roomId = btn.dataset.vcShare
    const nowSharing = btn.classList.contains('is-active')
    const res = await toggleScreenShare(!nowSharing)
    if (!res.ok && !res.cancelled) {
      openInfoModal(root, 'Bildschirm teilen fehlgeschlagen', res.error || 'Bitte erneut versuchen.')
    }
    if (res.ok) fillGroupChannels(root)
  }))

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
    mobileShowDetail(root)
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

  box.querySelectorAll('.mmc-vc-row[data-vc]').forEach(row => row.addEventListener('click', e => {
    if (e.target.closest('[data-vc-more]')) return
    toggleVoiceRoom(root, row.dataset.vc)
  }))
  box.querySelectorAll('.mmc-vc-member[data-user]').forEach(el => el.addEventListener('click', e => {
    e.stopPropagation(); openUserProfile(root, el.dataset.user)
  }))
  box.querySelectorAll('[data-vc-more]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation()
    const roomId = btn.dataset.vcMore
    const gCur = getGroups().find(x => x.id === activeGroup); if (!gCur) return
    const r = (gCur.voiceRooms || []).find(x => x.id === roomId); if (!r) return
    openConfirmModal(root, {
      title: `Talk „${r.title}" löschen?`,
      text: r.members.length ? 'Aktive Teilnehmer werden aus dem Talk geworfen.' : undefined,
      confirmLabel: 'Löschen',
      isDanger: true,
      onConfirm: async () => {
        if (currentRoomId() === roomId) await leaveVoiceRoom()
        await deleteVoiceRoom(activeGroup, roomId)
        fillGroupChannels(root)
      },
    })
  }))
}

const MIC_OFF_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4M8 23h8"/></svg>`

// 3-Balken-Signalanzeige; `lit` = wie viele Balken (0-3) aktiv eingefärbt sind, Rest gedimmt
function signalIcon(lit) {
  const op = n => n <= lit ? '1' : '0.3'
  return `<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><rect x="0.5" y="9.5" width="3" height="5" rx="0.5" opacity="${op(1)}"/><rect x="6.5" y="6" width="3" height="8.5" rx="0.5" opacity="${op(2)}"/><rect x="12.5" y="2" width="3" height="12.5" rx="0.5" opacity="${op(3)}"/></svg>`
}

function voiceChannelHtml(r, myName, managing) {
  const full = r.members.length >= r.capacity
  const mine = r.members.includes(myName)
  const activeRoom = currentRoomId() === r.id
  // Gäste können Talks nicht betreten (das Token braucht ein echtes Konto,
  // s. toggleVoiceRoom) — das gehört an den Button, nicht in einen Dialog nach
  // dem Klick.
  const needsAccount = !OFFLINE_MODE && !!getSession()?.guest
  const joinLabel = needsAccount ? 'Anmelden' : (mine ? 'Verlassen' : (full ? 'Voll' : 'Beitreten'))
  const rowTitle = needsAccount ? 'Für Talks brauchst du ein MotoMatch-Konto'
    : (mine ? 'Talk verlassen' : (full ? 'Talk ist voll' : 'Talk beitreten — Mikrofonzugriff wird benötigt'))

  // Vorherige Mitgliederliste dieses Raums, um Beitritte/Austritte zu erkennen
  // und gezielt nur die betroffene Zeile zu animieren (nicht die ganze Liste).
  const prevMembers = _vcPrevMembers.get(r.id) || []
  const prevSet = new Set(prevMembers)
  const curSet = new Set(r.members)
  const leaving = prevMembers.filter(m => !curSet.has(m))
  _vcPrevMembers.set(r.id, r.members.slice())

  const memberRow = (m, isGhost) => {
    const vp = r.voiceParticipants?.[m] || {}
    const speaking = !isGhost && !!vp.speaking
    const muted = !!vp.muted
    const quality = vp.quality
    const isNew = !isGhost && !prevSet.has(m)
    const qualityBadge = (!isGhost && (quality === 'poor' || quality === 'lost'))
      ? `<span class="mmc-vc-quality mmc-vc-quality--${quality}" title="${quality === 'lost' ? 'Verbindung unterbrochen' : 'Schwache Verbindung'}">${signalIcon(quality === 'poor' ? 1 : 0)}</span>`
      : ''
    const rowClass = isGhost ? 'mmc-vc-member--leave' : (m === myName ? '' : 'mmc-vc-member--clickable')
    return `
        <div class="mmc-vc-member ${rowClass}${speaking ? ' is-speaking' : ''}${isNew ? ' mmc-vc-member--enter' : ''}" ${(!isGhost && m !== myName) ? `data-user="${esc(m)}"` : ''}>
          <div class="mmc-avatar mmc-avatar--xs${speaking ? ' mmc-avatar--speaking' : ''}" style="background:${avatarColor(m)}">${avatarInner(m)}</div>
          <span>${esc(displayName(m))}${(!isGhost && m === myName) ? ' (du)' : ''}</span>
          ${qualityBadge}
          ${muted ? `<span class="mmc-vc-muted" title="Stummgeschaltet">${MIC_OFF_ICON}</span>` : ''}
        </div>`
  }

  // Screen-Share-Sektion nur, wenn ich über dieses Client tatsächlich per
  // LiveKit verbunden bin (nicht nur per Presence als "Mitglied" gelistet —
  // z. B. wenn derselbe Account auf einem anderen Gerät im Talk ist).
  const iAmSharing = !!r.voiceParticipants?.[myName]?.screenSharing
  const sharingMembers = activeRoom ? r.members.filter(m => !!r.voiceParticipants?.[m]?.screenSharing) : []
  const shareSection = activeRoom ? `
    <div class="mmc-vc-share">
      <button class="mmc-vc-share-btn${iAmSharing ? ' is-active' : ''}" data-vc-share="${r.id}">
        ${ICON.screen}<span>${iAmSharing ? 'Teilen beenden' : 'Bildschirm teilen'}</span>
      </button>
      ${sharingMembers.map(m => {
        const vp = r.voiceParticipants[m]
        const label = `${displayName(m)}${m === myName ? ' (du)' : ''} teilt den Bildschirm`
        return `
        <div class="mmc-vc-share-tile" data-screenshare="${esc(vp.id)}" data-screenshare-name="${esc(label)}" title="Vollbild ansehen">
          <span class="mmc-vc-share-label">${esc(label)}</span>
        </div>`
      }).join('')}
    </div>` : ''

  return `
    <div class="mmc-vc ${mine ? 'is-in' : ''}" data-vc-room="${r.id}">
      <div class="mmc-vc-row ${full && !mine ? 'is-full' : ''}" data-vc="${r.id}" title="${esc(rowTitle)}">
        <span class="mmc-vc-ic">${ICON.speaker}</span>
        <span class="mmc-vc-name">${esc(r.title)}</span>
        <span class="mmc-vc-count">${r.members.length}/${r.capacity}</span>
        <span class="mmc-vc-joinlabel${mine ? ' mmc-vc-joinlabel--in' : ''}">${joinLabel}</span>
        ${managing ? `<button class="mmc-tc-more" data-vc-more="${esc(r.id)}" title="Talk löschen">⋯</button>` : ''}
      </div>
      ${r.members.map(m => memberRow(m, false)).join('')}
      ${leaving.map(m => memberRow(m, true)).join('')}
      ${shareSection}
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

  // Talks brauchen ein echtes Konto: das Token für den Sprachserver wird
  // serverseitig gegen die Supabase-Session ausgestellt, die eine Gast-Sitzung
  // nicht hat. Hier abfangen, statt Gäste erst durch Mikrofon-Abfrage und
  // Verbindungsversuch laufen zu lassen, um dann abzubrechen.
  if (!OFFLINE_MODE && session.guest) {
    openInfoModal(root, 'Für Talks brauchst du ein Konto',
      'Sprach-Talks laufen über deinen MotoMatch-Account — als Gast lässt sich kein Talk betreten.',
      { label: 'Anmelden', onClick: () => goToAuth(root) })
    return
  }

  // Anderen Raum ggf. verlassen
  if (inVoiceRoom()) await leaveVoiceRoom()

  const userId = session.id || session.username
  const res = await joinVoiceRoom(roomId, userId, myName, prefs, participants => {
    // Teilnehmerliste live aktualisieren
    const gs = getGroups(); const gCur = gs.find(x => x.id === activeGroup); if (!gCur) return
    const rCur = (gCur.voiceRooms || []).find(x => x.id === roomId); if (!rCur) return
    rCur.voiceParticipants = {}
    for (const p of participants) {
      rCur.voiceParticipants[p.username] = { id: p.id, muted: p.muted, speaking: p.speaking, quality: p.quality, screenSharing: p.screenSharing }
    }
    // Mitgliederliste aus Presence ableiten
    rCur.members = participants.map(p => p.username)
    setGroups(gs)
    fillGroupChannels(root)
  })

  if (!res.ok) {
    // code 'auth' = keine gültige Sitzung mehr (z. B. abgelaufen) — dann direkt
    // zur Anmeldung anbieten, statt nur zu melden, dass sie fehlt.
    openInfoModal(root, 'Talk beitreten fehlgeschlagen',
      res.error || 'Mikrofon-Zugriff fehlgeschlagen. Bitte erlaube den Mikrofonzugriff für diese Seite in deinen Browser-Einstellungen und versuche es erneut.',
      res.code === 'auth' ? { label: 'Anmelden', onClick: () => goToAuth(root) } : null)
    return
  }

  // Gespeicherte Wiedergabelautstärke auf den frischen Talk anwenden.
  setOutputVolume(prefs.outVol ?? 100)

  if (!r.members.includes(myName)) r.members.push(myName)
  setGroups(groups)
  fillGroupChannels(root)
}

/** Screen-Share einer Person im Vollbild-Overlay zeigen (analog zur Bild-Lightbox). */
function openScreenShareLightbox(participantId, label) {
  const videoEl = getScreenShareEl(participantId)
  if (!videoEl) return
  const ov = document.createElement('div')
  ov.className = 'mmc-share-lightbox'
  ov.innerHTML = `
    <div class="mmc-share-lightbox-backdrop"></div>
    <div class="mmc-share-lightbox-body">
      <div class="mmc-share-lightbox-label">${esc(label)}</div>
    </div>`
  document.body.appendChild(ov)
  ov.querySelector('.mmc-share-lightbox-body').prepend(videoEl)
  requestAnimationFrame(() => ov.classList.add('is-open'))
  const close = () => {
    ov.classList.remove('is-open')
    setTimeout(() => {
      // Video zurück in seine Kachel hängen, falls die noch existiert (Person teilt evtl. nicht mehr)
      const freshTile = document.querySelector(`[data-screenshare="${CSS.escape(participantId)}"]`)
      if (freshTile) freshTile.appendChild(videoEl)
      ov.remove()
    }, 200)
  }
  ov.querySelector('.mmc-share-lightbox-backdrop').addEventListener('click', close)
  ov.querySelector('.mmc-share-lightbox-body').addEventListener('click', e => e.stopPropagation())
  document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey) } })
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
  _clearTyping(root)
  // Remember last-read timestamp BEFORE marking as read (for NEU line)
  const prevReadTs = lastReadTs(g.id, activeChannel)
  markChannelRead(g.id, activeChannel)
  // Also refresh channel list badges
  fillGroupChannels(root)
  main.innerHTML = `
    <header class="mmc-chat-head">
      ${mobileBackHtml()}
      <span class="mmc-chat-title">#${esc(chName)}</span>
      <span class="mmc-chat-desc">${esc(g.name)} · Chat</span>
    </header>
    <div class="mmc-messages" id="mmc-messages"></div>
    ${composeHtml('Nachricht an #' + esc(chName))}`
  bindMobileBack(main, root)
  const box = main.querySelector('#mmc-messages')
  const emptyCtx = { title: chName, text: `Das ist der Anfang von #${chName}. Sag Hallo 👋`, avatar: g.name, hash: true }
  renderMessagesInto(root, box, msgs, emptyCtx, g, prevReadTs)
  bindComposeExtras(main, root, () => sendChannelTyping(activeGroup, activeChannel), g.members || [])
  main.querySelector('#mmc-compose-form')?.addEventListener('submit', async e => {
    e.preventDefault()
    const input = main.querySelector('#mmc-compose-input')
    const form  = main.querySelector('#mmc-compose-form')
    const text  = input.value.trim()
    const attachment = form?._pendingAttachment || null
    if (!text && !attachment) return
    if (!OFFLINE_MODE && getSession()?.guest) { toast(root, 'Bitte melde dich an, um Nachrichten zu senden.'); return }
    // Grosse Anhaenge brauchen einen Moment — Formular solange sperren,
    // sonst schickt ein zweiter Klick dieselbe Datei nochmal hoch.
    const done = _composeBusy(form, true)
    const res = await sendGroupMessage(activeGroup, activeChannel, text, replyingTo, attachment)
    done()
    if (res && res.ok === false) { toast(root, res.error || 'Senden fehlgeschlagen.'); return }
    if (res?.warn) toast(root, res.warn)
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
        <label class="mmc-sp-toggle-row">
          <div>
            <span>Desktop-Benachrichtigungen</span>
            <div style="font-size:12px;opacity:.7;margin-top:2px">Für neue DMs und Freundschaftsanfragen, auch wenn der Tab zu ist</div>
          </div>
          <input type="checkbox" class="mmc-sp-toggle" id="mmc-sp-desktop"${prefs.notifyDesktop !== false ? ' checked' : ''}>
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
    overlay.querySelector('#mmc-sp-logout')?.addEventListener('click', () => {
      close()
      openConfirmModal(root, {
        title: 'Abmelden?',
        text: 'Du musst dich danach neu anmelden.',
        confirmLabel: 'Abmelden',
        isDanger: true,
        onConfirm: () => goToAuth(root),
      })
    })

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
      overlay.querySelector('#mmc-sp-notif-save')?.addEventListener('click', async () => {
        const p = getPrefs()
        p.notifySounds = overlay.querySelector('#mmc-sp-sounds')?.checked !== false
        const wantsDesktop = overlay.querySelector('#mmc-sp-desktop')?.checked !== false
        p.notifyDesktop = wantsDesktop
        setPrefs(p)

        if (wantsDesktop) {
          const res = await enablePushNotifications()
          if (!res.ok) { toast(root, res.error || 'Desktop-Benachrichtigungen konnten nicht aktiviert werden.'); return }
        } else {
          await disablePushNotifications()
        }
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
                <button class="mmc-manage-ic mmc-manage-ic--danger" data-ban="${esc(m)}" title="Sperren">${ICON.ban}</button>
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
  overlay.querySelector('#mmc-modal-form')?.addEventListener('submit', async e => {
    e.preventDefault()
    const title = overlay.querySelector('#mmc-vr-name').value.trim()
    const capacity = parseInt(overlay.querySelector('#mmc-vr-cap').value, 10) || 4
    const errEl = overlay.querySelector('#mmc-modal-error')
    if (title.length < 2) { errEl.hidden = false; errEl.textContent = 'Bitte gib einen Namen ein.'; return }
    const res = await createVoiceRoom(activeGroup, title, capacity)
    if (!res.ok) { errEl.hidden = false; errEl.textContent = res.error || 'Fehler beim Erstellen.'; return }
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

/* ── Info-Hinweis (bleibt bis zum Wegklicken sichtbar) ── */
/**
 * Hinweis-Dialog. `action` (optional, `{ label, onClick }`) ergänzt eine
 * Schaltfläche, die den Hinweis auflöst statt ihn nur zu bestätigen — ohne sie
 * wäre z. B. „melde dich an" eine Sackgasse, in der der Anmelde-Weg erst
 * gesucht werden muss.
 */
function openInfoModal(root, title, text, action = null) {
  document.querySelectorAll('#mmc-info-modal').forEach(x => x.remove())
  const overlay = document.createElement('div')
  overlay.className = 'mmc-modal'; overlay.id = 'mmc-info-modal'
  overlay.innerHTML = `
    <div class="mmc-modal-backdrop" id="mmc-info-backdrop"></div>
    <div class="mmc-modal-card">
      <h3 class="mmc-modal-title">${esc(title)}</h3>
      <p class="mmc-modal-sub">${esc(text)}</p>
      <div class="mmc-modal-actions">
        ${action
          ? `<button type="button" class="mmc-btn-ghost" id="mmc-info-ok">Abbrechen</button>
             <button type="button" class="mmc-auth-submit mmc-auth-submit--sm" id="mmc-info-action">${esc(action.label)}</button>`
          : `<button type="button" class="mmc-auth-submit mmc-auth-submit--sm" id="mmc-info-ok">Verstanden</button>`}
      </div>
    </div>`
  root.appendChild(overlay)
  requestAnimationFrame(() => overlay.classList.add('mmc-modal--open'))
  const close = () => { overlay.classList.remove('mmc-modal--open'); setTimeout(() => overlay.remove(), 200) }
  overlay.querySelector('#mmc-info-backdrop')?.addEventListener('click', close)
  overlay.querySelector('#mmc-info-ok')?.addEventListener('click', close)
  overlay.querySelector('#mmc-info-action')?.addEventListener('click', () => { close(); action.onClick() })
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
  overlay.querySelector('#mmc-modal-form')?.addEventListener('submit', async e => {
    e.preventDefault()
    const nameRaw = overlay.querySelector('#mmc-ch-name').value.trim()
    const name = slug(nameRaw)
    const errEl = overlay.querySelector('#mmc-modal-error')
    if (!name) { errEl.hidden = false; errEl.textContent = 'Bitte gib einen gültigen Namen ein.'; return }
    const groups = getGroups(); const g = groups.find(x => x.id === activeGroup); if (!g) return
    groupDefaults(g)
    if (g.channels.some(c => c.name === name)) { errEl.hidden = false; errEl.textContent = 'Ein Kanal mit diesem Namen existiert bereits.'; return }
    const result = await createChannel(activeGroup, name)
    if (!result.ok) { errEl.hidden = false; errEl.textContent = result.error || 'Fehler beim Erstellen.'; return }
    activeChannel = result.channel.id
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
  const mentionNames = groupCtx ? new Set((groupCtx.members || []).map(u => u.toLowerCase())) : null

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
    const imgHtml = attachmentHtml(m)
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
            <div class="mmc-msg-text">${renderText(m.text, mentionNames)}</div>
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
            <div class="mmc-msg-text">${renderText(m.text, mentionNames)}</div>
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
      div.className = 'mmc-msg-text'; div.innerHTML = renderText(origMsg.text, mentionNames)
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
    box.querySelectorAll('[data-del-msg]').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation()
      const msgId = btn.dataset.delMsg
      openConfirmModal(root, {
        title: 'Nachricht löschen?',
        text: 'Diese Aktion kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        isDanger: true,
        onConfirm: async () => {
          await deleteGroupMessage(groupCtx.id, msgId)
          const updated = getGroups().find(g => g.id === groupCtx.id)
          if (updated) { groupDefaults(updated); renderMessagesInto(root, box, channelMsgs(updated, activeChannel), empty, updated) }
        },
      })
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
        <div class="mmc-msg-text">${renderText(m.text, mentionNames)}</div>
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

  const presence = getOnlinePresence()
  const onlineFriends = getFriends().filter(f => presence[f] && presence[f] !== 'invisible')

  if (!onlineFriends.length) {
    el.innerHTML = `
      <h3 class="mmc-active-title">Jetzt aktiv</h3>
      <div class="mmc-active-empty">
        <h4>Bisher ist alles ruhig …</h4>
        <p>Wenn ein Freund aktiv wird, siehst du es hier.</p>
      </div>`
    return
  }

  el.innerHTML = `
    <h3 class="mmc-active-title">Jetzt aktiv</h3>
    <div class="mmc-active-list">
      ${onlineFriends.map(f => {
        const st = statusMeta(presence[f])
        return `
        <button class="mmc-active-item" data-active-friend="${esc(f)}">
          <div class="mmc-avatar mmc-avatar--sm" style="background:${avatarColor(f)}">${avatarInner(f)}<span class="mmc-presence" style="background:${st.color}"></span></div>
          <div class="mmc-active-item-meta">
            <div class="mmc-active-item-name">${esc(displayName(f))}</div>
            <div class="mmc-active-item-status">${esc(st.label)}</div>
          </div>
        </button>`
      }).join('')}
    </div>`

  el.querySelectorAll('[data-active-friend]').forEach(btn => btn.addEventListener('click', () => {
    activeDM = btn.dataset.activeFriend
    clearUnread(activeDM)
    subscribeToChannel(null, activeDM)
    fillHomeColumn(root); fillMain(root); fillActive(root)
  }))
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
      fillRail(root)
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

/* ══════════════════════════════════════════════════════════════════
   DIREKTANRUFE ZWISCHEN FREUNDEN
   Der Anruf läuft über denselben LiveKit-Weg wie ein Gruppen-Talk, nur ohne
   Raum in der Datenbank: die Raum-ID leitet sich aus beiden Nutzer-IDs ab und
   wird serverseitig gegen die Freundschaft geprüft (api/livekit-token.js).
   Das Klingeln selbst läuft über `user:<uid>`-Broadcasts, damit ein Anruf auch
   ankommt, wenn der Chat gerade nicht offen ist.
   ══════════════════════════════════════════════════════════════════ */
/** null | { peer, roomId, state: 'outgoing'|'incoming'|'active', since } */
let _call = null
let _callBarEl = null
let _callTickTimer = null

function _callPeerName(peer) { return displayName(peer) }

/** Anrufleiste liegt an document.body, damit sie Ansichtswechsel überlebt. */
function _renderCallBar(root) {
  if (!_call) {
    _callBarEl?.remove(); _callBarEl = null
    if (_callTickTimer) { clearInterval(_callTickTimer); _callTickTimer = null }
    return
  }
  if (!_callBarEl) {
    _callBarEl = document.createElement('div')
    _callBarEl.className = 'mmc-callbar'
    document.body.appendChild(_callBarEl)
    requestAnimationFrame(() => _callBarEl?.classList.add('is-open'))
  }

  const name = esc(_callPeerName(_call.peer))
  const prefs = getPrefs()
  let statusText, actions
  if (_call.state === 'incoming') {
    statusText = 'Eingehender Anruf'
    actions = `
      <button class="mmc-call-btn mmc-call-btn--accept" id="mmc-call-accept">Annehmen</button>
      <button class="mmc-call-btn mmc-call-btn--decline" id="mmc-call-decline">Ablehnen</button>`
  } else if (_call.state === 'outgoing') {
    statusText = 'Klingelt …'
    actions = `<button class="mmc-call-btn mmc-call-btn--decline" id="mmc-call-hangup">Abbrechen</button>`
  } else {
    const secs = Math.max(0, Math.floor((Date.now() - _call.since) / 1000))
    statusText = `Im Gespräch · ${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
    actions = `
      <button class="mmc-call-btn${prefs.muted ? ' is-active' : ''}" id="mmc-call-mute">${prefs.muted ? 'Stumm aus' : 'Stumm'}</button>
      <button class="mmc-call-btn mmc-call-btn--decline" id="mmc-call-hangup">Auflegen</button>`
  }

  _callBarEl.innerHTML = `
    <div class="mmc-avatar mmc-avatar--dm" style="background:${avatarColor(_call.peer)}">${avatarInner(_call.peer)}</div>
    <div class="mmc-call-meta">
      <div class="mmc-call-name">${name}</div>
      <div class="mmc-call-status">${esc(statusText)}</div>
    </div>
    <div class="mmc-call-actions">${actions}</div>`

  _callBarEl.querySelector('#mmc-call-accept')?.addEventListener('click', () => _acceptCall(root))
  _callBarEl.querySelector('#mmc-call-decline')?.addEventListener('click', () => _declineCall(root))
  _callBarEl.querySelector('#mmc-call-hangup')?.addEventListener('click', () => _endCall(root, true))
  _callBarEl.querySelector('#mmc-call-mute')?.addEventListener('click', () => {
    const p = getPrefs(); p.muted = !p.muted; setPrefs(p)
    toggleVoiceMute(p.muted)
    _renderCallBar(root)
  })

  // Gesprächsdauer sekündlich nachziehen, aber nur während eines Gesprächs.
  if (_call.state === 'active' && !_callTickTimer) {
    _callTickTimer = setInterval(() => _renderCallBar(root), 1000)
  } else if (_call.state !== 'active' && _callTickTimer) {
    clearInterval(_callTickTimer); _callTickTimer = null
  }
}

/** Anruf starten (aus dem DM-Kopf). */
async function _startCall(root, peer) {
  if (_call) { toast(root, 'Du bist bereits in einem Anruf.'); return }
  if (!OFFLINE_MODE && getSession()?.guest) {
    openInfoModal(root, 'Für Anrufe brauchst du ein Konto',
      'Anrufe laufen über deinen MotoMatch-Account — als Gast lässt sich nicht telefonieren.',
      { label: 'Anmelden', onClick: () => goToAuth(root) })
    return
  }
  const roomId = dmCallRoomId(peer)
  if (!roomId) { toast(root, 'Anruf nicht möglich — Konto der Person nicht gefunden.'); return }

  _call = { peer, roomId, state: 'outgoing', since: Date.now() }
  _renderCallBar(root)

  const res = await joinVoiceRoom(roomId, getSession().id || getSession().username, me(), getPrefs(),
    participants => _onCallParticipants(root, participants))
  if (!res.ok) {
    _call = null; _renderCallBar(root)
    openInfoModal(root, 'Anruf fehlgeschlagen', res.error || 'Bitte erneut versuchen.',
      res.code === 'auth' ? { label: 'Anmelden', onClick: () => goToAuth(root) } : null)
    return
  }
  setOutputVolume(getPrefs().outVol ?? 100)
  await sendUserEvent(peer, 'call_invite', { roomId })
}

/** Teilnehmerliste des Anrufs — sobald die Gegenseite da ist, läuft das Gespräch. */
function _onCallParticipants(root, participants) {
  if (!_call) return
  const others = participants.filter(p => p.username?.toLowerCase() !== me().toLowerCase())
  if (others.length && _call.state !== 'active') {
    _call.state = 'active'; _call.since = Date.now()
    _renderCallBar(root)
  } else if (!others.length && _call.state === 'active') {
    // Gegenseite hat aufgelegt.
    toast(root, `${_callPeerName(_call.peer)} hat aufgelegt.`)
    _endCall(root, false)
  }
}

async function _acceptCall(root) {
  if (!_call || _call.state !== 'incoming') return
  const peer = _call.peer
  _call.state = 'outgoing'   // verbinden…
  _renderCallBar(root)
  const res = await joinVoiceRoom(_call.roomId, getSession().id || getSession().username, me(), getPrefs(),
    participants => _onCallParticipants(root, participants))
  if (!res.ok) {
    _call = null; _renderCallBar(root)
    openInfoModal(root, 'Anruf fehlgeschlagen', res.error || 'Bitte erneut versuchen.')
    await sendUserEvent(peer, 'call_decline', {})
    return
  }
  setOutputVolume(getPrefs().outVol ?? 100)
  _call.state = 'active'; _call.since = Date.now()
  _renderCallBar(root)
}

async function _declineCall(root) {
  if (!_call) return
  const peer = _call.peer
  _call = null; _renderCallBar(root)
  await sendUserEvent(peer, 'call_decline', {})
}

/** Auflegen. `notify` = der Gegenseite Bescheid geben (bei eigenem Auflegen). */
async function _endCall(root, notify) {
  if (!_call) return
  const { peer, state } = _call
  _call = null
  _renderCallBar(root)
  if (inVoiceRoom()) await leaveVoiceRoom()
  if (notify) await sendUserEvent(peer, state === 'outgoing' ? 'call_cancel' : 'call_end', {})
  fillGroupChannels?.(root)
}

/** Signale der Gegenseite verarbeiten. */
function _handleCallEvent(root, type, payload) {
  const from = payload?.from
  if (!from) return
  if (type === 'call_invite') {
    // Schon im Gespräch? Dann besetzt melden, statt den laufenden Anruf zu stören.
    if (_call) { sendUserEvent(from, 'call_decline', {}); return }
    _call = { peer: from, roomId: payload.roomId, state: 'incoming', since: Date.now() }
    _renderCallBar(root)
    return
  }
  if (!_call || _call.peer?.toLowerCase() !== from.toLowerCase()) return
  if (type === 'call_cancel') {
    toast(root, `Verpasster Anruf von ${_callPeerName(from)}.`)
    _call = null; _renderCallBar(root)
  } else if (type === 'call_decline') {
    toast(root, `${_callPeerName(from)} hat abgelehnt.`)
    _endCall(root, false)
  } else if (type === 'call_end') {
    _endCall(root, false)
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
    fillRail(root)
    fillMain(root)
  })

  requestAnimationFrame(() => overlay.querySelector('#mmc-new-name')?.focus())
}
