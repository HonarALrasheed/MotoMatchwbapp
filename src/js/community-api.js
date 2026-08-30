/**
 * ══════════════════════════════════════════════════════════════════
 *  MotoMatch — Community API Layer
 *
 *  Einzige Zugriffsschicht für Community-Daten.
 *  - Online (Supabase konfiguriert): Postgres + Realtime
 *  - Offline / Demo (keine Keys):    localStorage (identisches Verhalten)
 *
 *  Lesende Funktionen (getGroups, getFriends, …) sind SYNCHRON —
 *  sie lesen aus dem lokalen In-Memory-Cache, der beim App-Start
 *  per initCommunityData() befüllt wird. So müssen Render-Funktionen
 *  in community.js nicht geändert werden.
 *
 *  Schreibende Funktionen (sendDM, sendFriendRequest, …) sind ASYNC
 *  und schreiben parallel in Cache + Supabase.
 * ══════════════════════════════════════════════════════════════════
 */

import { supabase, OFFLINE_MODE } from './supabase.js'
import { report } from './monitoring.js'
import { findUserByUsername, searchUsers, getUserRecord, currentUser } from './auth.js'

/* ── localStorage-Keys (Offline-Modus + UI-Preferences) ─────────── */
const LS_FRIENDS        = 'mm_comm_friends_v2'
const LS_REQUESTS       = 'mm_comm_freqs_v1'
const LS_DMS            = 'mm_comm_dms_v2'
const LS_UNREAD         = 'mm_comm_unread_v1'
const LS_BLOCKED        = 'mm_comm_blocked_v1'
const LS_IGNORED        = 'mm_comm_ignored_v1'
const LS_GROUPS         = 'mm_comm_groups_v2'
const LS_GROUP_REQUESTS = 'mm_comm_group_requests_v1'
const LS_MSG_REPORTS    = 'mm_comm_msg_reports_v1'
const LS_INVITES        = 'mm_comm_invites_v1'
const LS_PROFILE        = 'mm_comm_profile_v1'
const LS_USER_REPORTS   = 'mm_comm_user_reports_v1'

/* ── LS-Helfer (nur intern) ────────────────────────────────────── */
function lsRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback }
}
function lsWrite(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch {}
}

/* ══════════════════════════════════════════════════════════════════
   IN-MEMORY CACHE
   Wird bei initCommunityData() befüllt, bei Schreiboperationen
   aktuell gehalten, und von Realtime-Subscriptions aktualisiert.
   ══════════════════════════════════════════════════════════════════ */

let _myUid     = null  // auth.uid() des angemeldeten Nutzers (null im Offline/Gast-Modus)
let _myUsername = ''   // z. B. 'RiderMax'

/* Kernstrukturen — gespiegelt aus Supabase oder localStorage */
let _profileCache   = {}   // { [username]: profileObj }
let _avatarFetched  = new Set()  // Namen, deren Profilbild schon geholt wurde (auch wenn es keins gab)
let _groups         = []   // Gruppen-Array (mit .channels[].messages)
let _friends        = {}   // { [username]: string[] }
let _requests       = []   // [{ id, from, to, ts }]
let _dms            = {}   // { [username]: { [peer]: message[] } }
let _unread         = {}   // { [username]: string[] }
let _blocked        = {}   // { [username]: string[] }
let _ignored        = {}   // { [username]: string[] }
let _groupRequests  = []
let _invites        = []
let _msgReports     = []
let _userReports    = []

/* Aktive Realtime-Subscriptions */
let _realtimeSubs = []   // per-Chat (wechseln beim Öffnen eines anderen Chats)
let _globalSubs   = []   // Inbox-weit (bleiben aktiv, solange eingeloggt)

/* Presence: wer ist gerade online (per Supabase-Realtime-Presence-Channel) */
let _presenceChannel = null
let _onlinePresence   = {}   // { [username]: statusString }

/* Live-Broadcast für neu erstellte/gelöschte Kanäle/Talks einer Gruppe, siehe
   subscribeGroupLiveUpdates weiter unten. */
let _groupLiveChan        = null
let _groupLiveChanGroupId = null

/* Callback-Hook für community.js, um auf neue Nachrichten zu reagieren */
let _onNewMessage = null
let _onMessageChanged = null  // Bearbeitung/Löschung/Reaktion einer bestehenden Nachricht
let _onFriendRequest = null
let _onPresenceChange = null
let _onNewGroup = null

export function onNewMessage(fn) { _onNewMessage = fn }
export function onMessageChanged(fn) { _onMessageChanged = fn }
export function onPresenceChange(fn) { _onPresenceChange = fn }
export function onFriendRequest(fn) { _onFriendRequest = fn }
export function onNewGroup(fn) { _onNewGroup = fn }

/* ══════════════════════════════════════════════════════════════════
   INIT — wird einmal nach dem Login aufgerufen
   ══════════════════════════════════════════════════════════════════ */
export async function initCommunityData(uid, username) {
  _myUid      = uid
  _myUsername = username

  if (OFFLINE_MODE || !uid) {
    _loadFromLocalStorage()
    return
  }

  try {
    await Promise.all([
      _loadProfiles(),
      _loadGroups(),
      _loadFriendships(),
      _loadFriendRequests(),
      _loadDMs(),
      _loadBlocks(),
      _loadIgnores(),
      _loadGroupRequests(),
      _loadInvites(),
    ])
  } catch (err) {
    console.error('[API] Init-Fehler, falle auf localStorage zurück:', err)
    _loadFromLocalStorage()
    return
  }

  _subscribeGlobalInbox()
}

function _loadFromLocalStorage() {
  _profileCache  = lsRead(LS_PROFILE, {})
  _groups        = lsRead(LS_GROUPS, [])
  _friends       = lsRead(LS_FRIENDS, {})
  _requests      = lsRead(LS_REQUESTS, [])
  _dms           = lsRead(LS_DMS, {})
  _unread        = lsRead(LS_UNREAD, {})
  _blocked       = lsRead(LS_BLOCKED, {})
  _ignored       = lsRead(LS_IGNORED, {})
  _groupRequests = lsRead(LS_GROUP_REQUESTS, [])
  _invites       = lsRead(LS_INVITES, [])
  _msgReports    = lsRead(LS_MSG_REPORTS, [])
  _userReports   = lsRead(LS_USER_REPORTS, [])
}

/* ── Supabase-Loader ────────────────────────────────────────────── */

/*
 * Bewusst ohne `avatar`: die Spalte haelt das Profilbild als base64-Data-URL
 * (siehe supabase/schema.sql) und ist der Groesse nach unbegrenzt. Mit
 * select('*') lud jeder Seitenaufruf saemtliche Bilder aller Nutzer — bei 500
 * Nutzern mit je ~1,5 MB waren das ~750 MB. Bilder kommen jetzt per
 * ensureAvatars() nur fuer die Nutzer nach, die auch wirklich angezeigt werden.
 */
const PROFILE_FIELDS = 'id, username, display_name, bio, status_text, avatar_color, show_bike, bike_text, dm_policy, show_online, notif_sounds, notif_desktop'

async function _loadProfiles() {
  const { data } = await supabase.from('profiles').select(PROFILE_FIELDS)
  if (!data) return
  _profileCache = {}
  _avatarFetched = new Set()
  for (const p of data) {
    _profileCache[p.username] = {
      displayName:    p.display_name,
      bio:            p.bio,
      statusText:     p.status_text,
      avatarColor:    p.avatar_color,
      showBike:       p.show_bike,
      bikeText:       p.bike_text,
      dmPolicy:       p.dm_policy,
      showOnline:     p.show_online,
      notifySounds:   p.notif_sounds,
      notifyDesktop:  p.notif_desktop,
      _uid:           p.id,
    }
  }
  await _loadMyAvatar()
}

/*
 * Das eigene Profilbild wird sofort geholt (genau eine Zeile): getProfile()
 * faellt fuer den eigenen Namen zwar auf currentUser().avatar zurueck, das ist
 * aber ein geraetelokaler Override — auf einem frisch angemeldeten Geraet gibt
 * es ihn nicht, und ohne diese Abfrage saehe man sein eigenes Bild dort nicht.
 */
async function _loadMyAvatar() {
  if (!_myUid || !_myUsername) return
  const { data } = await supabase.from('profiles').select('avatar').eq('id', _myUid).maybeSingle()
  if (data?.avatar) {
    _profileCache[_myUsername] = { ..._profileCache[_myUsername], avatarImg: data.avatar }
  }
}

const AVATAR_BATCH_MAX = 40

/**
 * Profilbilder fuer die uebergebenen Nutzer nachladen (einmalig pro Name).
 * Gibt die Namen zurueck, fuer die jetzt ein Bild im Cache liegt — der Aufrufer
 * kann damit gezielt nachzeichnen, ohne die ganze Ansicht neu zu rendern.
 */
export async function ensureAvatars(usernames) {
  if (OFFLINE_MODE || !supabase) return []
  const open = [...new Set(usernames)].filter(u => u && u !== _myUsername && !_avatarFetched.has(u))
  if (!open.length) return []

  const loaded = []
  // In Haeppchen abfragen: .in() landet als Query-String in der URL, eine
  // unbegrenzt lange Namensliste wuerde die URL sprengen.
  for (let i = 0; i < open.length; i += AVATAR_BATCH_MAX) {
    const todo = open.slice(i, i + AVATAR_BATCH_MAX)
    // Vor dem Await markieren: parallele Aufrufe sollen nicht dieselben Namen holen.
    todo.forEach(u => _avatarFetched.add(u))
    const { data, error } = await supabase.from('profiles').select('username, avatar').in('username', todo)
    if (error) {
      todo.forEach(u => _avatarFetched.delete(u))   // erneut versuchen duerfen
      continue
    }
    for (const row of data || []) {
      if (!row.avatar) continue
      _profileCache[row.username] = { ..._profileCache[row.username], avatarImg: row.avatar }
      loaded.push(row.username)
    }
  }
  return loaded
}

async function _loadGroups() {
  // Ein Select, keine Rückfallkette mehr. voice_rooms, group_rsvps sowie
  // groups.event_at/meeting_point garantiert die Migration
  // a0_bestandsangleichung; fehlt hier etwas, ist die Datenbank nicht auf
  // Stand und das soll auffallen, statt sich als stumm fehlende Termine und
  // verschwundene Sprachkanäle zu tarnen.
  const { data: groups, error } = await supabase
    .from('groups')
    .select(`
      id, name, description, category, join_mode, created_at,
      event_at, meeting_point,
      created_by:profiles!groups_created_by_fkey(username),
      channels(id, name, position),
      group_members(user_id, role, profiles(username)),
      group_bans(user_id, profiles!group_bans_user_id_fkey(username)),
      voice_rooms(id, title, capacity, created_by),
      group_rsvps(profiles(username))
    `)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[API] Gruppen nicht ladbar:', error.message)
    report(error, { where: 'community-api._loadGroups', code: error.code })
    return
  }
  if (!groups) return

  const allMsgs = {}
  if (groups.length) {
    const channelIds = groups.flatMap(g => (g.channels || []).map(c => c.id))
    if (channelIds.length) {
      const msgs = await _selectMessages(q => q.in('channel_id', channelIds), 'channel_id')
      for (const m of msgs) {
        (allMsgs[m.channel_id] ||= []).push(_mapMessage(m))
      }
    }
  }

  _groups = groups.map(g => ({
    id:         g.id,
    name:       g.name,
    desc:       g.description,
    category:   g.category,
    joinMode:   g.join_mode,
    createdBy:  g.created_by?.username || '',
    createdAt:  new Date(g.created_at).getTime(),
    members:    (g.group_members || []).map(m => m.profiles?.username).filter(Boolean),
    moderators: (g.group_members || []).filter(m => m.role === 'mod').map(m => m.profiles?.username).filter(Boolean),
    banned:     (g.group_bans   || []).map(b => b.profiles?.username).filter(Boolean),
    channels:   (g.channels || [])
      .sort((a, b) => a.position - b.position)
      .map(c => ({
        id:       c.id,
        name:     c.name,
        messages: allMsgs[c.id] || [],
      })),
    voiceRooms: (g.voice_rooms || []).map(v => ({
      // createdBy wird für das automatische Aufräumen leerer Talks gebraucht:
      // löschen darf laut RLS nur Ersteller, Host oder Mod (Policy vr_delete).
      id: v.id, title: v.title, capacity: v.capacity, createdBy: v.created_by, members: [],
    })),
    ...(g.event_at     ? { eventAt: new Date(g.event_at).getTime() } : {}),
    ...(g.meeting_point ? { meetingPoint: g.meeting_point } : {}),
    rsvp:       (g.group_rsvps || []).map(r => r.profiles?.username).filter(Boolean),
    messages:   [],
  }))
}

/*
 * Reaktionen kommen als Embed aus message_reactions (eine Zeile je Reaktion),
 * das `mentions`-Feld gibt es nur an Kanalnachrichten. Beides garantieren die
 * Migrationen a0_bestandsangleichung (messages.mentions) und
 * a13_message_reactions (Tabelle + Übernahme der Bestandsdaten).
 *
 * Die alte jsonb-Spalte messages.reactions steht nicht mehr im SELECT: ihr
 * Inhalt ist mit a13 nach message_reactions übernommen, sie wird seither
 * weder gelesen noch geschrieben.
 */
async function _selectMessages(applyFilter, keyField, { mentions = true } = {}) {
  // `profiles!messages_author_id_fkey` statt nur `profiles`: seit
  // message_reactions existiert, gibt es ZWEI Wege von messages nach profiles —
  // den direkten Fremdschlüssel author_id und, über message_reactions als
  // Zwischentabelle, eine many-to-many-Beziehung. PostgREST lehnt den
  // mehrdeutigen Embed mit PGRST201 ab und liefert dann GAR KEINE Nachrichten.
  // Der Verweis auf den Fremdschlüssel macht die Absicht eindeutig.
  const sel = `id, ${keyField}, author_id, text, reply_to_id, edited_at, created_at, profiles!messages_author_id_fkey(username)`
    + (mentions ? ', mentions' : '')
    + ', message_reactions(emoji, profiles(username))'

  const { data, error } = await applyFilter(supabase.from('messages').select(sel))
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[API] Nachrichten nicht ladbar:', error.message)
    report(error, { where: 'community-api._selectMessages', code: error.code })
    return []
  }
  return data || []
}

/**
 * Reaktionen in die Form bringen, die das UI erwartet: { emoji: [username, …] }.
 * Einzige Quelle ist der message_reactions-Embed. Der frühere Rückfall auf die
 * jsonb-Spalte messages.reactions ist weg: a13_message_reactions hat deren
 * Inhalt übernommen, und ein Embed, der fehlt, ist ab jetzt ein echter Fehler
 * und keine Schema-Variante.
 */
function _mapReactions(m) {
  const out = {}
  // `|| []` deckt NICHT mehr einen fehlenden Embed ab, sondern Zeilen, die gar
  // nicht per SELECT kamen: die frisch eingefügte Nachricht aus
  // sendGroupMessage() hat naturgemäß noch keine Reaktionen.
  for (const r of m.message_reactions || []) {
    const name = r.profiles?.username
    if (!name || !r.emoji) continue
    ;(out[r.emoji] ||= []).push(name)
  }
  return out
}

function _mapMessage(m) {
  return {
    id:       m.id,
    author:   m.profiles?.username || '?',
    text:     m.text,
    ts:       new Date(m.created_at).getTime(),
    reactions: _mapReactions(m),
    ...(m.edited_at ? { editedTs: new Date(m.edited_at).getTime() } : {}),
    ...(m.reply_to_id ? { replyTo: { id: m.reply_to_id } } : {}),
    // Rohe uuids durchreichen, keine Username-Auflösung hier — _loadProfiles()
    // und _loadGroups() laufen parallel (initCommunityData), Auflösung an dieser
    // Stelle könnte je nach Timing leer laufen. Hervorhebung im UI nutzt ohnehin
    // text + aktuelle Mitgliederliste, nicht dieses Feld (s. renderText in community.js).
    ...(m.mentions?.length ? { mentions: m.mentions } : {}),
    ...(m.attachment ? { attachment: m.attachment } : {}),
  }
}

async function _loadFriendships() {
  const { data } = await supabase
    .from('friendships')
    .select('user_a, user_b, pa:profiles!friendships_user_a_fkey(username), pb:profiles!friendships_user_b_fkey(username)')
  _friends = {}
  for (const row of (data || [])) {
    const a = row.pa?.username; const b = row.pb?.username
    if (!a || !b) continue
    ;(_friends[a] ||= []).push(b)
    ;(_friends[b] ||= []).push(a)
  }
}

async function _loadFriendRequests() {
  const { data } = await supabase
    .from('friend_requests')
    .select('id, from_user, to_user, created_at, pf:profiles!friend_requests_from_user_fkey(username), pt:profiles!friend_requests_to_user_fkey(username)')
  _requests = (data || []).map(r => ({
    id:   r.id,
    from: r.pf?.username || '',
    to:   r.pt?.username || '',
    ts:   new Date(r.created_at).getTime(),
  }))
}

async function _loadDMs() {
  // mentions gibt es nur an Kanalnachrichten (s. Spaltenkommentar in schema.sql)
  const data = await _selectMessages(q => q.not('dm_thread', 'is', null), 'dm_thread', { mentions: false })
  _dms = {}
  for (const m of data) {
    const parts = m.dm_thread.split(':')
    const aUid = parts[0]; const bUid = parts[1]
    const aName = _uidToUsername(aUid)
    const bName = _uidToUsername(bUid)
    if (!aName || !bName) continue
    const msg = _mapMessage(m)
    ;(_dms[aName] ||= {})[bName] = [...((_dms[aName])[bName] || []), msg]
    ;(_dms[bName] ||= {})[aName] = [...((_dms[bName])[aName] || []), msg]
  }
}

async function _loadBlocks() {
  const { data } = await supabase
    .from('blocks')
    .select('blocker, blocked, pb:profiles!blocks_blocker_fkey(username), pc:profiles!blocks_blocked_fkey(username)')
  _blocked = {}
  for (const row of (data || [])) {
    const er = row.pb?.username; const ed = row.pc?.username
    if (!er || !ed) continue
    ;(_blocked[er] ||= []).push(ed)
  }
}

async function _loadIgnores() {
  const { data } = await supabase
    .from('ignores')
    .select('ignorer, ignored, pi:profiles!ignores_ignorer_fkey(username), pg:profiles!ignores_ignored_fkey(username)')
  _ignored = {}
  for (const row of (data || [])) {
    const er = row.pi?.username; const ed = row.pg?.username
    if (!er || !ed) continue
    ;(_ignored[er] ||= []).push(ed)
  }
}

async function _loadGroupRequests() {
  const { data } = await supabase
    .from('group_join_requests')
    .select('id, group_id, from_user, text, created_at, profiles(username)')
  _groupRequests = (data || []).map(r => ({
    id:      r.id,
    groupId: r.group_id,
    from:    r.profiles?.username || '',
    text:    r.text || '',
    ts:      new Date(r.created_at).getTime(),
  }))
}

/*
 * Unveraendertes select('*') — die Einschraenkung macht seit A4 die Policy
 * invites_select: sie liefert nur noch Codes der Gruppen, in denen man Owner
 * oder Mod ist. Vorher gab dieselbe Abfrage jedem alle Codes aller Gruppen.
 * Wer einen Code EINLOEST, liest ihn deshalb nicht mehr hier, sondern laesst
 * ihn von der RPC redeem_invite() mit Definer-Rechten pruefen.
 */
async function _loadInvites() {
  const { data } = await supabase.from('invites').select('*')
  _invites = (data || []).map(i => ({
    code:      i.code,
    groupId:   i.group_id,
    createdBy: i.created_by,
    createdAt: new Date(i.created_at).getTime(),
    expiresAt: i.expires_at ? new Date(i.expires_at).getTime() : null,
    maxUses:   i.max_uses,
    uses:      i.uses,
  }))
}

/** Erkennt eine vom Server vergebene uuid (im Gegensatz zu lokalen 'rp-…'-IDs). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* ── UID ↔ Username Mapping ─────────────────────────────────────── */
function _uidToUsername(uid) {
  for (const [name, p] of Object.entries(_profileCache)) {
    if (p._uid === uid) return name
  }
  return null
}
function _usernameToUid(username) {
  return _profileCache[username]?._uid || null
}

/**
 * @Mentions aus Nachrichtentext extrahieren und gegen `members` (die
 * tatsächliche Mitgliederliste der Gruppe) auflösen — nur echte Treffer
 * werden zu uuids. Unicode-Zeichensatz (Buchstaben/Ziffern/_/-, kein
 * Leerzeichen), da Usernamen keine Zeichensatz-Beschränkung haben (auth.js).
 */
function _resolveMentions(text, members) {
  // Ohne Lookbehind (WebKit < 16.4 wirft sonst schon beim Parsen), s.
  // renderText() in community.js: Gruppe 1 ist das Zeichen vor dem @,
  // Gruppe 2 der Username.
  const re = /(^|[^\p{L}\p{N}_@-])@([\p{L}\p{N}_-]{1,32})/gu
  const lowerMembers = members.map(u => u.toLowerCase())
  const ids = new Set()
  let match
  while ((match = re.exec(text)) !== null) {
    const idx = lowerMembers.indexOf(match[2].toLowerCase())
    if (idx === -1) continue
    const uid = _usernameToUid(members[idx])
    if (uid) ids.add(uid)
  }
  return [...ids]
}

/* ══════════════════════════════════════════════════════════════════
   REALTIME-SUBSCRIPTIONS
   ══════════════════════════════════════════════════════════════════ */

let _activeChannelId = null  // Kanal-ID, auf den gerade geachtet wird
let _activeDMThread  = null  // dm_thread-String des offenen DMs

export function subscribeToChannel(channelId, dmThread) {
  _activeChannelId = channelId
  _activeDMThread  = dmThread
  // Nachrichten-Live-Push läuft komplett über das globale Inbox-Abo
  // (_subscribeGlobalInbox). Diese Funktion bleibt als API-Signal,
  // welcher Chat gerade offen ist (z. B. für UI-Fokus / gelesen-Marker).
}

/**
 * Globales Abo für ALLE für mich relevanten Message-Inserts.
 * RLS filtert bereits serverseitig auf Zeilen, die ich sehen darf
 * (msg_select_channel / msg_select_dm), sodass ein Filter-loses Abo
 * hier keine fremden Nachrichten liefert.
 * Wird einmal beim Login gestartet, überlebt Chat-Wechsel.
 */
function _subscribeGlobalInbox() {
  if (OFFLINE_MODE || !supabase || !_myUid) return

  // Falls bereits aktiv (z. B. Re-Init nach Reconnect): erst abräumen
  for (const sub of _globalSubs) {
    try { supabase.removeChannel(sub) } catch {}
  }
  _globalSubs = []

  const msgSub = supabase.channel('inbox-messages-' + _myUid)
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'messages',
    }, payload => {
      _handleNewMessage(payload.new)
    })
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'messages',
    }, payload => {
      _handleMessageUpdate(payload.new)
    })
    .on('postgres_changes', {
      event:  'DELETE',
      schema: 'public',
      table:  'messages',
    }, payload => {
      _handleMessageDelete(payload.old)
    })
    .subscribe()
  _globalSubs.push(msgSub)

  // Reaktionen laufen nicht mehr als UPDATE auf messages, sondern als
  // INSERT/DELETE auf message_reactions — ohne dieses Abo sähe man fremde
  // Reaktionen erst nach einem Neuladen. Die Tabelle muss dafür im
  // Supabase-Dashboard unter Database → Replication mit aktiviert sein
  // (s. supabase/schema.sql); ist sie es nicht, bleibt das Abo folgenlos.
  const reactSub = supabase.channel('inbox-reactions-' + _myUid)
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'message_reactions',
    }, payload => {
      _handleReactionChange(payload.new, true)
    })
    .on('postgres_changes', {
      event:  'DELETE',
      schema: 'public',
      table:  'message_reactions',
    }, payload => {
      // payload.old trägt die Primärschlüsselspalten — und das sind hier genau
      // message_id, user_id und emoji. Kein REPLICA IDENTITY FULL nötig.
      _handleReactionChange(payload.old, false)
    })
    .subscribe()
  _globalSubs.push(reactSub)

  const freqSub = supabase.channel('inbox-freq-' + _myUid)
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'friend_requests',
      filter: `to_user=eq.${_myUid}`,
    }, payload => {
      _handleNewFriendRequest(payload.new)
    })
    .subscribe()
  _globalSubs.push(freqSub)

  // Neue Gruppen live anzeigen: wir lauschen auf group_members-INSERTs
  // (nicht auf groups/channels direkt — nur messages, friend_requests und
  // group_members sind in der Supabase-Replication-Publication aktiviert,
  // siehe Kommentar am Ende dieser Datei bzw. in supabase/schema.sql).
  // role === 'owner' markiert genau den Moment, in dem createGroup() eine
  // neue Gruppe fertigstellt (jeder normale Beitritt hat role 'member').
  const gmSub = supabase.channel('inbox-newgroups-' + _myUid)
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'group_members',
    }, payload => {
      if (payload.new.role === 'owner') _handleNewOwnedGroup(payload.new.group_id)
    })
    .subscribe()
  _globalSubs.push(gmSub)
}

/**
 * Presence-Channel abonnieren: meldet mich selbst als „online" (mit Status)
 * und liefert per Callback die Liste aller gerade verbundenen Nutzer.
 * status === 'invisible' → ich tracke mich nicht (erscheine für andere offline).
 */
export function subscribeToPresence(status = 'online') {
  if (OFFLINE_MODE || !supabase || !_myUid || !_myUsername) return
  if (_presenceChannel) { try { supabase.removeChannel(_presenceChannel) } catch {} }

  _presenceChannel = supabase.channel('community-presence', {
    config: { presence: { key: _myUid } },
  })
  _presenceChannel.on('presence', { event: 'sync' }, () => {
    const state = _presenceChannel.presenceState()
    const online = {}
    Object.values(state).forEach(entries => {
      entries.forEach(e => { if (e.username) online[e.username] = e.status || 'online' })
    })
    _onlinePresence = online
    if (_onPresenceChange) _onPresenceChange(_onlinePresence)
  })
  _presenceChannel.subscribe(async subStatus => {
    if (subStatus === 'SUBSCRIBED' && status !== 'invisible') {
      await _presenceChannel.track({ username: _myUsername, status })
    }
  })
}

/** Eigenen Status im Presence-Channel aktualisieren (z. B. bei Statuswechsel im Menü). */
export function updatePresenceStatus(status) {
  if (OFFLINE_MODE || !_presenceChannel) return
  if (status === 'invisible') {
    _presenceChannel.untrack()
  } else {
    _presenceChannel.track({ username: _myUsername, status })
  }
}

/** Map { username: status } aller gerade verbundenen Nutzer (nur Online-Modus). */
export function getOnlinePresence() { return _onlinePresence }

export function unsubscribePresence() {
  if (_presenceChannel) { try { supabase.removeChannel(_presenceChannel) } catch {} }
  _presenceChannel = null
  _onlinePresence = {}
}

/**
 * Live-Updates für eine Gruppe abonnieren: Sprach-/Textkanäle, die ein anderes
 * Mitglied erstellt oder löscht, poppen sofort auf/weg statt erst nach einem
 * Reload sichtbar zu werden — und Nachrichten in einem frisch erstellten Kanal
 * landen nicht mehr im Nichts (_handleNewMessage findet sonst keinen passenden
 * Kanal und verwirft sie stillschweigend). Broadcast statt postgres_changes,
 * weil weder channels noch voice_rooms in der Supabase-Replication-Publication
 * stehen — Broadcast braucht keine Dashboard-Konfiguration.
 * onEvent(type, payload) mit type ∈ 'room_created'|'room_deleted'|'channel_created'|'channel_deleted'|'typing'.
 * Idempotent: erneuter Aufruf mit derselben groupId ist ein No-op.
 */
export function subscribeGroupLiveUpdates(groupId, onEvent) {
  if (OFFLINE_MODE || !supabase) return
  if (_groupLiveChanGroupId === groupId) return
  unsubscribeGroupLiveUpdates()

  _groupLiveChan = supabase.channel(`group-live:${groupId}`, {
    config: { broadcast: { self: false } },
  })
  for (const type of ['room_created', 'room_deleted', 'channel_created', 'channel_deleted', 'typing']) {
    _groupLiveChan.on('broadcast', { event: type }, ({ payload }) => onEvent(type, payload))
  }
  _groupLiveChan.subscribe()
  _groupLiveChanGroupId = groupId
}

export function unsubscribeGroupLiveUpdates() {
  if (_groupLiveChan) { try { supabase.removeChannel(_groupLiveChan) } catch {} }
  _groupLiveChan = null
  _groupLiveChanGroupId = null
}

/**
 * Signalisiert den anderen Mitgliedern im group-live-Kanal, dass ich gerade in
 * `channelId` tippe. Läuft nur, während die Gruppe eh schon per
 * subscribeGroupLiveUpdates() abonniert ist (sonst kein Empfänger) — im
 * Zweifel einfach ein No-op, Tippen ist rein informativ.
 */
export function sendChannelTyping(groupId, channelId) {
  if (_groupLiveChanGroupId !== groupId) return
  _broadcastGroupLiveEvent(groupId, 'typing', { channelId, username: _myUsername })
}

/** An alle anderen gerade zuschauenden Mitglieder senden, dass sich Kanäle/Talks geändert haben. */
async function _broadcastGroupLiveEvent(groupId, event, payload) {
  if (OFFLINE_MODE || !supabase) return
  const reused = _groupLiveChanGroupId === groupId
  const chan = reused ? _groupLiveChan : supabase.channel(`group-live:${groupId}`, {
    config: { broadcast: { self: false } },
  })
  // Kein Empfänger zu haben ist normal; ein Fehler beim Senden ist es nicht —
  // dann sehen die anderen Mitglieder die Änderung schlicht nie.
  try { await chan.send({ type: 'broadcast', event, payload }) }
  catch (err) { report(err, { where: 'community-api._broadcastGroupLiveEvent', event, reused }) }
  if (!reused) { try { supabase.removeChannel(chan) } catch {} }
}

/* ══════════════════════════════════════════════════════════════════
   DIREKTANRUFE — Signalisierung
   Ein Kanal je Nutzer (`user:<uid>`), abonniert solange die Community offen
   ist. Nur darüber erfährt man von einem Anruf, ohne den betreffenden Chat
   geöffnet zu haben. Der Anruf selbst läuft über LiveKit, hier gehen nur die
   Klingel-Signale durch.
   ══════════════════════════════════════════════════════════════════ */
let _userChan = null

/** Raum-ID eines Direktanrufs: beide uuids aufsteigend sortiert, wie in `friendships`. */
export function dmCallRoomId(peerUsername) {
  const other = _usernameToUid(peerUsername)
  if (!_myUid || !other) return null
  return 'dm:' + [_myUid, other].sort().join(':')
}

/** onEvent(type, payload) mit type ∈ 'call_invite'|'call_cancel'|'call_decline'|'call_end'. */
export function subscribeToUserEvents(onEvent) {
  if (OFFLINE_MODE || !supabase || !_myUid || _userChan) return
  _userChan = supabase.channel(`user:${_myUid}`, { config: { broadcast: { self: false } } })
  for (const type of ['call_invite', 'call_cancel', 'call_decline', 'call_end']) {
    _userChan.on('broadcast', { event: type }, ({ payload }) => onEvent(type, payload))
  }
  _userChan.subscribe()
}

export function unsubscribeUserEvents() {
  if (_userChan) { try { supabase.removeChannel(_userChan) } catch {} }
  _userChan = null
}

/** Ein Anruf-Signal an eine bestimmte Person schicken. */
export async function sendUserEvent(toUsername, event, payload = {}) {
  if (OFFLINE_MODE || !supabase) return
  const uid = _usernameToUid(toUsername)
  if (!uid || uid === _myUid) return
  // Eigener Kanal ist `user:<_myUid>` — hier geht es an ein anderes Topic, es
  // kann also nicht zur Kollision mit dem eigenen Abo kommen.
  const chan = supabase.channel(`user:${uid}`)
  try {
    await new Promise(resolve => chan.subscribe(status => { if (status === 'SUBSCRIBED') resolve() }))
    await chan.send({ type: 'broadcast', event, payload: { ...payload, from: _myUsername } })
  } catch (err) {
    // Geht das hier verloren, klingelt es auf der Gegenseite nie und der Anruf
    // stirbt still — für den Anrufer sieht es aus, als würde niemand abheben.
    report(err, { where: 'community-api.sendUserEvent', event })
  }
  try { await supabase.removeChannel(chan) } catch {}
}

export function unsubscribeAll() {
  if (!supabase) return
  unsubscribePresence()
  unsubscribeGroupLiveUpdates()
  unsubscribeDMTyping()
  unsubscribeUserEvents()
  for (const sub of [..._realtimeSubs, ..._globalSubs]) {
    try { supabase.removeChannel(sub) } catch {}
  }
  _realtimeSubs = []
  _globalSubs   = []
}

async function _handleNewMessage(row) {
  // Absender-Username nachschlagen (Profile könnte noch nicht im Cache sein)
  let author = _uidToUsername(row.author_id)
  if (!author) {
    const { data } = await supabase.from('profiles').select('username').eq('id', row.author_id).maybeSingle()
    author = data?.username || '?'
    if (data) _profileCache[author] = { ..._profileCache[author], _uid: row.author_id }
  }
  const msg = {
    id:        row.id,
    author,
    text:      row.text,
    ts:        new Date(row.created_at).getTime(),
    // Eine gerade eingefügte Nachricht hat noch keine Reaktionen; die kommen
    // ab jetzt ausschließlich über message_reactions.
    reactions: {},
    ...(row.reply_to_id ? { replyTo: { id: row.reply_to_id } } : {}),
    ...(row.mentions?.length ? { mentions: row.mentions } : {}),
  }

  if (row.channel_id) {
    for (const g of _groups) {
      const ch = g.channels?.find(c => c.id === row.channel_id)
      if (ch && !ch.messages.some(m => m.id === msg.id)) {
        ch.messages.push(msg)
        break
      }
    }
  } else if (row.dm_thread) {
    const parts = row.dm_thread.split(':')
    const aName = _uidToUsername(parts[0])
    const bName = _uidToUsername(parts[1])
    if (aName && bName) {
      const aArr = (_dms[aName] ||= {})[bName] || []
      const bArr = (_dms[bName] ||= {})[aName] || []
      if (!aArr.some(m => m.id === msg.id)) _dms[aName][bName] = [...aArr, msg]
      if (!bArr.some(m => m.id === msg.id)) _dms[bName][aName] = [...bArr, msg]
      // Unread-Cache setzen, wenn ich der Empfänger bin
      if (row.author_id !== _myUid) {
        const fromName = row.author_id === _usernameToUid(aName) ? aName : bName
        const toName   = fromName === aName ? bName : aName
        if (toName === _myUsername) _markUnreadCache(_myUsername, fromName)
      }
    }
  }

  if (_onNewMessage) {
    // Für DMs: übergebe die beiden Usernames statt der dmThread-ID
    let dmUsers = null
    if (row.dm_thread) {
      const parts = row.dm_thread.split(':')
      const aName = _uidToUsername(parts[0])
      const bName = _uidToUsername(parts[1])
      if (aName && bName) dmUsers = { user1: aName, user2: bName }
    }
    _onNewMessage(msg, row.channel_id, dmUsers)
  }
}

/**
 * Bearbeitung einer bestehenden Nachricht (Text, Reaktionen) live nachziehen —
 * ohne das sieht ein anderes Mitglied eine Bearbeitung/Reaktion erst nach
 * einem Reload. row = payload.new eines UPDATE-Events, enthält immer die
 * volle neue Zeile (unabhängig von REPLICA IDENTITY).
 */
async function _handleMessageUpdate(row) {
  // BEWUSST OHNE `reactions`: die kommen seit message_reactions als eigene
  // INSERT/DELETE-Events (_handleReactionChange). Würde die stale jsonb-Spalte
  // hier weiter durchgereicht, löschte jede Textbearbeitung die Reaktionen
  // lokal wieder weg.
  const patch = {
    text: row.text,
    ...(row.edited_at ? { editedTs: new Date(row.edited_at).getTime() } : {}),
  }
  let found = false
  if (row.channel_id) {
    for (const g of _groups) {
      const ch = g.channels?.find(c => c.id === row.channel_id)
      const msg = ch?.messages.find(m => m.id === row.id)
      if (msg) { Object.assign(msg, patch); found = true; break }
    }
  } else if (row.dm_thread) {
    const parts = row.dm_thread.split(':')
    const aName = _uidToUsername(parts[0])
    const bName = _uidToUsername(parts[1])
    if (aName && bName) {
      const aMsg = _dms[aName]?.[bName]?.find(m => m.id === row.id)
      if (aMsg) { Object.assign(aMsg, patch); found = true }
      const bMsg = _dms[bName]?.[aName]?.find(m => m.id === row.id)
      if (bMsg) Object.assign(bMsg, patch)
    }
  }
  if (!found || !_onMessageChanged) return
  let dmUsers = null
  if (row.dm_thread) {
    const parts = row.dm_thread.split(':')
    const aName = _uidToUsername(parts[0])
    const bName = _uidToUsername(parts[1])
    if (aName && bName) dmUsers = { user1: aName, user2: bName }
  }
  _onMessageChanged(row.channel_id, dmUsers)
}

/**
 * Löschung einer Nachricht live nachziehen. row = payload.old eines
 * DELETE-Events — enthält ohne REPLICA IDENTITY FULL nur die id, daher wird
 * hier bewusst überall gesucht statt sich auf channel_id/dm_thread zu
 * verlassen (dieselbe Strategie wie deleteGroupMessage/deleteDMMessage lokal).
 */
async function _handleMessageDelete(row) {
  const msgId = row.id
  let removedChannelId = null
  let removedDM = null
  for (const g of _groups) {
    for (const ch of (g.channels || [])) {
      const before = ch.messages.length
      ch.messages = ch.messages.filter(m => m.id !== msgId)
      if (ch.messages.length !== before) removedChannelId = ch.id
    }
  }
  for (const aName of Object.keys(_dms)) {
    for (const bName of Object.keys(_dms[aName])) {
      const before = _dms[aName][bName].length
      _dms[aName][bName] = _dms[aName][bName].filter(m => m.id !== msgId)
      if (_dms[aName][bName].length !== before) removedDM = { user1: aName, user2: bName }
    }
  }
  if ((removedChannelId || removedDM) && _onMessageChanged) _onMessageChanged(removedChannelId, removedDM)
}

/**
 * Reaktion eines ANDEREN Nutzers live nachziehen (INSERT oder DELETE auf
 * message_reactions). Die eigene Reaktion steht lokal schon (optimistisch) —
 * das Echo würde sie sonst wieder umschalten.
 *
 * Wie bei _handleMessageDelete wird überall gesucht statt sich auf eine
 * channel_id zu verlassen: die Zeile trägt nur message_id/user_id/emoji.
 * Supabase filtert DELETE-Ereignisse nicht per RLS — eine unbekannte
 * message_id findet hier schlicht nichts und ist damit ein No-op.
 */
async function _handleReactionChange(row, on) {
  if (!row?.message_id || !row.emoji || !row.user_id) return
  if (row.user_id === _myUid) return

  let name = _uidToUsername(row.user_id)
  if (!name) {
    const { data } = await supabase.from('profiles').select('username').eq('id', row.user_id).maybeSingle()
    if (!data) return
    name = data.username
    _profileCache[name] = { ..._profileCache[name], _uid: row.user_id }
  }

  const seen = new Set()
  let changedChannelId = null
  let changedDM = null
  for (const g of _groups) {
    for (const ch of (g.channels || [])) {
      const msg = ch.messages.find(m => m.id === row.message_id)
      if (!msg || seen.has(msg)) continue
      seen.add(msg)
      if (_setReactionLocal(msg, row.emoji, name, on)) changedChannelId = ch.id
    }
  }
  for (const aName of Object.keys(_dms)) {
    for (const bName of Object.keys(_dms[aName])) {
      const msg = (_dms[aName][bName] || []).find(m => m.id === row.message_id)
      if (!msg || seen.has(msg)) continue
      seen.add(msg)
      if (_setReactionLocal(msg, row.emoji, name, on)) changedDM = { user1: aName, user2: bName }
    }
  }
  if ((changedChannelId || changedDM) && _onMessageChanged) _onMessageChanged(changedChannelId, changedDM)
}

async function _handleNewFriendRequest(row) {
  const from = _uidToUsername(row.from_user)
  const to   = _uidToUsername(row.to_user)
  if (!from || !to) return
  if (!_requests.some(r => r.id === row.id)) {
    _requests.push({ id: row.id, from, to, ts: new Date(row.created_at).getTime() })
  }
  if (_onFriendRequest) _onFriendRequest()
}

/**
 * Reagiert auf eine neue Owner-Mitgliedschaft (= eine neue Gruppe wurde
 * gerade fertig erstellt, egal von wem). Lädt die komplette Gruppe nach
 * und fügt sie in den Cache ein. RLS (groups_select_public) erlaubt SELECT
 * für alle — kein Extra-Filter nötig.
 *
 * createGroup() legt den Channel unmittelbar NACH der Owner-Mitgliedschaft
 * an; da wir hier keinen Realtime-Event auf 'channels' bekommen (nur
 * messages/friend_requests/group_members sind repliziert), pollen wir mit
 * kurzen Retries, bis der Channel in der Query auftaucht.
 */
async function _handleNewOwnedGroup(groupId, attempt = 0) {
  if (_groups.some(g => g.id === groupId)) return

  const { data: g } = await supabase
    .from('groups')
    .select(`
      id, name, description, category, join_mode, created_at,
      created_by:profiles!groups_created_by_fkey(username),
      channels(id, name, position),
      group_members(user_id, role, profiles(username)),
      group_bans(user_id, profiles!group_bans_user_id_fkey(username))
    `)
    .eq('id', groupId)
    .maybeSingle()
  if (!g) return
  if (!g.channels?.length && attempt < 5) {
    setTimeout(() => _handleNewOwnedGroup(groupId, attempt + 1), 400)
    return
  }
  if (_groups.some(x => x.id === g.id)) return

  const newGroup = {
    id:         g.id,
    name:       g.name,
    desc:       g.description,
    category:   g.category,
    joinMode:   g.join_mode,
    createdBy:  g.created_by?.username || '',
    createdAt:  new Date(g.created_at).getTime(),
    members:    (g.group_members || []).map(m => m.profiles?.username).filter(Boolean),
    moderators: (g.group_members || []).filter(m => m.role === 'mod').map(m => m.profiles?.username).filter(Boolean),
    banned:     (g.group_bans   || []).map(b => b.profiles?.username).filter(Boolean),
    channels:   (g.channels || [])
      .sort((a, b) => a.position - b.position)
      .map(c => ({ id: c.id, name: c.name, messages: [] })),
    messages:   [],
  }
  _groups.unshift(newGroup)
  if (_onNewGroup) _onNewGroup(newGroup.id, true)
}

/* ══════════════════════════════════════════════════════════════════
   SCHREIBEN MIT ROLLBACK
   ══════════════════════════════════════════════════════════════════ */

/**
 * Sichert ein optimistisches lokales Update gegen die Datenbank ab.
 *
 * Das häufigste Fehlermuster in dieser Datei war: lokal ändern, dann
 * `await supabase…` ohne einen Blick auf das Ergebnis. Die Oberfläche meldete
 * Erfolg, die Datenbank hatte nichts — der Moderator sah den Nutzer
 * verschwinden, der Nutzer blieb Mitglied.
 *
 * Der Rollback ist PFLICHT und deshalb ein eigener Parameter: fehlt er, wirft
 * die Funktion. Wer wirklich nichts zurückzurollen hat, übergibt `() => {}`
 * und begründet das an Ort und Stelle.
 *
 * Vorlage waren joinGroup() und sendFriendRequest() — die beiden Funktionen,
 * die es von Anfang an richtig gemacht haben.
 *
 * @param {string} where Kurzname der Operation; geht in Log und Sentry.
 * @param {() => PromiseLike<{error?: any, data?: any}>} op Der Supabase-Aufruf.
 * @param {() => void} rollback Macht das lokale Update rückgängig.
 * @param {{expectRows?: boolean}} [opts] `expectRows: true` wertet "kein
 *   Treffer" als Fehler. Genau das war BEFUND 1: eine RLS-Policy lässt die
 *   Zeile nicht durch, PostgREST meldet aber keinen Fehler, sondern null
 *   veränderte Zeilen. Dafür muss `op` ein `.select(…)` anhängen, sonst kommen
 *   die veränderten Zeilen gar nicht zurück.
 * @returns {Promise<{ok: true} | {ok: false, error: string}>}
 */
async function write(where, op, rollback, { expectRows = false } = {}) {
  if (typeof rollback !== 'function') {
    throw new TypeError(`write(${where}): Rollback fehlt — er ist Pflicht, nicht optional.`)
  }

  let error = null
  try {
    const res = (await op()) || {}
    error = res.error || null
    if (!error && expectRows && Array.isArray(res.data) && res.data.length === 0) {
      error = { code: 'NO_ROWS', message: 'Die Datenbank hat die Änderung abgelehnt (keine Berechtigung).' }
    }
  } catch (err) {
    // Netzwerkabbruch: supabase-js wirft, statt { error } zu liefern.
    error = err
  }
  if (!error) return { ok: true }

  // Erst zurückrollen, dann melden — die Oberfläche darf keinen Zustand
  // zeigen, den es nicht gibt.
  try { rollback() } catch (rbErr) { report(rbErr, { where: `community-api.${where}.rollback` }) }
  const message = error.message || 'Speichern fehlgeschlagen.'
  console.error('[API]', where, message)
  report(error, { where: `community-api.${where}`, code: error.code })
  return { ok: false, error: message }
}

/* ══════════════════════════════════════════════════════════════════
   PROFIL
   ══════════════════════════════════════════════════════════════════ */

/**
 * Community-Profil eines Nutzers — ergänzt um echten Namen/Avatar aus dem
 * zentralen Konto (auth.js), damit Community denselben Namen/dasselbe Bild
 * zeigt wie Account/Rest der Plattform:
 *  - eigenes Profil: immer live aus currentUser() (funktioniert online & offline,
 *    auch bevor die erste Synchronisierung mit Supabase durchgelaufen ist)
 *  - fremde Profile online: kommen aus der Supabase-`profiles`-Tabelle
 *    (per _loadProfiles() synchron gehalten). avatarImg fehlt hier zunaechst
 *    und wird von ensureAvatars() nur fuer angezeigte Nutzer nachgeladen —
 *    bis dahin greift in der UI der Initialen-Fallback.
 *  - fremde Profile offline: aus der lokalen User-DB (getUserRecord)
 */
export function getProfile(username) {
  const p = _profileCache[username] || {}
  if (username === _myUsername) {
    const me = currentUser()
    if (me) return { ...p, displayName: p.displayName || me.name, avatarImg: p.avatarImg ?? me.avatar ?? null, bio: p.bio || me.bio }
  } else if (OFFLINE_MODE) {
    const rec = getUserRecord(username)
    if (rec) return { ...p, displayName: p.displayName || rec.name, avatarImg: p.avatarImg ?? rec.avatar ?? null, bio: p.bio || rec.bio }
  }
  return p
}

export function getMyProfile() {
  return getProfile(_myUsername)
}

export async function setMyProfile(data) {
  const prev = _profileCache[_myUsername] || {}
  _profileCache[_myUsername] = { ...prev, ...data }
  if (OFFLINE_MODE || !_myUid) {
    lsWrite(LS_PROFILE, _profileCache); return { ok: true }
  }
  const rollback = () => { _profileCache[_myUsername] = prev }
  const dbPatch = {
    display_name:  data.displayName  ?? prev.displayName,
    bio:           data.bio          ?? prev.bio,
    status_text:   data.statusText   ?? prev.statusText,
    avatar_color:  data.avatarColor  ?? prev.avatarColor,
    avatar:        data.avatarImg    ?? prev.avatarImg,
    show_bike:     data.showBike     ?? prev.showBike,
    bike_text:     data.bikeText     ?? prev.bikeText,
    dm_policy:     data.dmPolicy     ?? prev.dmPolicy,
    show_online:   data.showOnline   ?? prev.showOnline,
    notif_sounds:  data.notifySounds ?? prev.notifySounds,
    notif_desktop: data.notifyDesktop ?? prev.notifyDesktop,
  }
  // profiles.avatar garantiert die Migration a0_bestandsangleichung. Der
  // frühere zweite Versuch ohne die Spalte konnte ein gespeichertes Profil
  // melden, dessen Bild nie ankam — jetzt scheitert der Aufruf sichtbar.
  return write('setMyProfile',
    () => supabase.from('profiles').update(dbPatch).eq('id', _myUid),
    rollback)
}

/* ══════════════════════════════════════════════════════════════════
   GRUPPEN
   ══════════════════════════════════════════════════════════════════ */

export function getGroups() { return _groups }

export async function setGroups(groups) {
  _groups = groups
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, groups); return }
  // Nur im Offline-Modus als Ganzes gespeichert;
  // Online wird jede Operation einzeln per Supabase-Aufruf ausgeführt.
}

/**
 * Aufräumen nach einer halb erstellten Gruppe. Bewusst OHNE write(): lokal ist
 * noch nichts passiert (die Gruppe kommt erst am Ende in _groups), es gibt also
 * nichts zurückzurollen. Scheitert das Aufräumen, bleibt eine leere Gruppe ohne
 * Mitglieder und ohne Kanal stehen — die fällt niemandem auf, deshalb muss sie
 * wenigstens gemeldet werden.
 */
async function _cleanupOrphanGroup(groupId) {
  const { error } = await supabase.from('groups').delete().eq('id', groupId)
  if (!error) return
  console.error('[API] Verwaiste Gruppe konnte nicht entfernt werden:', error.message)
  report(error, { where: 'community-api.createGroup.cleanup', code: error.code })
}

export async function createGroup({ name, desc, category, joinMode, eventAt, meetingPoint }) {
  const myName = _myUsername
  if (OFFLINE_MODE || !_myUid) {
    const g = {
      id: 'g-' + Math.random().toString(36).slice(2, 9),
      name, desc, category, joinMode: joinMode || 'open',
      createdBy: myName, createdAt: Date.now(),
      members: [myName], moderators: [], banned: [],
      channels: [{ id: 'c-' + Math.random().toString(36).slice(2, 9), name: 'allgemein', messages: [] }],
      messages: [],
      ...(eventAt     ? { eventAt }     : {}),
      ...(meetingPoint ? { meetingPoint } : {}),
      rsvp: [],
    }
    _groups.unshift(g); lsWrite(LS_GROUPS, _groups)
    return { ok: true, group: g }
  }
  // groups.event_at/meeting_point garantiert die Migration
  // a0_bestandsangleichung. Der frühere zweite Versuch ohne die Felder legte
  // eine Tour ohne Termin und ohne Treffpunkt an und meldete Erfolg — genau
  // die beiden Angaben, wegen derer man eine Tour anlegt.
  const { data: gRow, error: gErr } = await supabase.from('groups').insert({
    name, description: desc, category, join_mode: joinMode || 'open', created_by: _myUid,
    event_at: eventAt ? new Date(eventAt).toISOString() : null,
    meeting_point: meetingPoint || null,
  }).select().single()
  if (gErr) return { ok: false, error: gErr.message }

  // Muss VOR dem Channel-Insert passieren: die "channels_insert"-RLS-Policy verlangt
  // bereits einen group_members-Eintrag mit Rolle owner/mod für diese Gruppe.
  const { error: gmErr } = await supabase.from('group_members').insert({
    group_id: gRow.id, user_id: _myUid, role: 'owner',
  })
  if (gmErr) { await _cleanupOrphanGroup(gRow.id); return { ok: false, error: gmErr.message } }

  const { data: cRow, error: cErr } = await supabase.from('channels').insert({
    group_id: gRow.id, name: 'allgemein', position: 0,
  }).select().single()
  if (cErr) { await _cleanupOrphanGroup(gRow.id); return { ok: false, error: cErr.message } }

  const g = {
    id: gRow.id, name, desc, category, joinMode: joinMode || 'open',
    createdBy: myName, createdAt: new Date(gRow.created_at).getTime(),
    members: [myName], moderators: [], banned: [],
    channels: [{ id: cRow.id, name: 'allgemein', messages: [] }],
    messages: [],
    ...(eventAt     ? { eventAt }     : {}),
    ...(meetingPoint ? { meetingPoint } : {}),
    rsvp: [],
  }
  _groups.unshift(g)
  return { ok: true, group: g }
}

export async function deleteGroup(groupId) {
  const idx = _groups.findIndex(g => g.id === groupId)
  if (idx < 0) return { ok: false, error: 'Gruppe nicht gefunden.' }
  const [removed] = _groups.splice(idx, 1)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return { ok: true } }
  return write('deleteGroup',
    () => supabase.from('groups').delete().eq('id', groupId).select('id'),
    () => { _groups.splice(idx, 0, removed) },
    { expectRows: true })
}

/**
 * Sprachkanal ("Talk") in einer Gruppe erstellen — persistiert in der DB,
 * damit ihn auch andere Mitglieder sehen (nicht nur lokal beim Ersteller).
 */
export async function createVoiceRoom(groupId, title, capacity) {
  const g = _groups.find(x => x.id === groupId)
  if (!g) return { ok: false, error: 'Gruppe nicht gefunden.' }

  if (OFFLINE_MODE || !_myUid) {
    const room = { id: 'vr-' + Date.now(), title, capacity, members: [] }
    ;(g.voiceRooms ||= []).push(room)
    lsWrite(LS_GROUPS, _groups)
    return { ok: true, room }
  }

  const { data, error } = await supabase.from('voice_rooms').insert({
    group_id: groupId, title, capacity, created_by: _myUid,
  }).select().single()
  if (error) return { ok: false, error: error.message }

  const room = { id: data.id, title: data.title, capacity: data.capacity, createdBy: data.created_by, members: [] }
  ;(g.voiceRooms ||= []).push(room)
  _broadcastGroupLiveEvent(groupId, 'room_created', {
    room: { id: room.id, title: room.title, capacity: room.capacity, createdBy: room.createdBy },
  })
  return { ok: true, room }
}

export async function deleteVoiceRoom(groupId, roomId) {
  const g = _groups.find(x => x.id === groupId)
  if (!g) return { ok: false, error: 'Gruppe nicht gefunden.' }
  const rooms = (g.voiceRooms ||= [])
  const idx = rooms.findIndex(r => r.id === roomId)
  if (idx < 0) return { ok: true }   // schon weg
  const [removed] = rooms.splice(idx, 1)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return { ok: true } }

  const res = await write('deleteVoiceRoom',
    () => supabase.from('voice_rooms').delete().eq('id', roomId).select('id'),
    () => { rooms.splice(idx, 0, removed) },
    { expectRows: true })
  // Erst nach dem Erfolg broadcasten: sonst räumen die anderen Mitglieder
  // einen Talk aus ihrer Ansicht, den es noch gibt.
  if (res.ok) _broadcastGroupLiveEvent(groupId, 'room_deleted', { roomId })
  return res
}

export async function updateGroup(groupId, patch) {
  const g = _groups.find(x => x.id === groupId)
  if (!g) return { ok: false, error: 'Gruppe nicht gefunden.' }
  // Vorzustand genau der geänderten Schlüssel merken. `k in g` ist nötig, weil
  // eventAt/meetingPoint optional sind — "war undefined" und "gab es nicht"
  // sind für einen späteren Object.assign nicht dasselbe.
  const before = Object.keys(patch).map(k => [k, k in g, g[k]])
  const rollback = () => {
    for (const [k, had, val] of before) { if (had) g[k] = val; else delete g[k] }
  }
  Object.assign(g, patch)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return { ok: true } }
  const dbPatch = {}
  if ('name'         in patch) dbPatch.name          = patch.name
  if ('desc'         in patch) dbPatch.description   = patch.desc
  if ('joinMode'     in patch) dbPatch.join_mode      = patch.joinMode
  if ('eventAt'      in patch) dbPatch.event_at       = patch.eventAt ? new Date(patch.eventAt).toISOString() : null
  if ('meetingPoint' in patch) dbPatch.meeting_point  = patch.meetingPoint || null
  if (!Object.keys(dbPatch).length) return { ok: true }

  // Wie in createGroup: die Spalten sind seit a0_bestandsangleichung gesetzt.
  // Der frühere Teilerfolg — Name gespeichert, Termin still verworfen — war
  // schlechter als ein klarer Fehlschlag mit Rollback.
  return write('updateGroup',
    () => supabase.from('groups').update(dbPatch).eq('id', groupId),
    rollback)
}

export async function joinGroup(groupId) {
  const g = _groups.find(x => x.id === groupId)
  if (!g) return { ok: false, error: 'Gruppe nicht gefunden.' }
  if (isGroupBanned(g, _myUsername)) return { ok: false, error: 'Du wurdest aus dieser Gruppe gesperrt.' }
  if (g.members.includes(_myUsername)) return { ok: false, error: 'Du bist bereits Mitglied.' }
  g.members.push(_myUsername)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return { ok: true } }
  const { error } = await supabase.from('group_members').insert({
    group_id: groupId, user_id: _myUid, role: 'member',
  })
  if (error) {
    g.members.pop()
    // 42501 = RLS-Verstoß. Seit A4 lässt gm_insert den Selbst-Eintrag nur noch
    // in Gruppen mit join_mode='open' und nur ohne Bann-Eintrag zu. Das UI
    // fängt beides vorher ab (_joinGroupUI in community.js) — hier landet man
    // also nur, wenn der lokale Cache veraltet ist oder jemand am UI vorbei
    // arbeitet. Die rohe englische Postgres-Meldung hilft dann niemandem.
    if (error.code === '42501') {
      return { ok: false, error: 'Dieser Gruppe kannst du nicht einfach beitreten — sie braucht eine Anfrage oder eine Einladung.' }
    }
    return { ok: false, error: error.message }
  }
  return { ok: true }
}

export async function leaveGroup(groupId) {
  const g = _groups.find(x => x.id === groupId)
  if (!g) return { ok: false, error: 'Gruppe nicht gefunden.' }
  const before = g.members
  g.members = g.members.filter(m => m !== _myUsername)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return { ok: true } }
  return write('leaveGroup',
    () => supabase.from('group_members').delete()
      .eq('group_id', groupId).eq('user_id', _myUid).select('id'),
    () => { g.members = before },
    { expectRows: true })
}

export async function kickMember(groupId, username) {
  const g = _groups.find(x => x.id === groupId)
  if (!g) return { ok: false, error: 'Gruppe nicht gefunden.' }
  const low = username.toLowerCase()
  const beforeMembers = g.members
  const beforeMods    = g.moderators
  g.members    = g.members.filter(m => m.toLowerCase() !== low)
  g.moderators = (g.moderators || []).filter(m => m.toLowerCase() !== low)
  const rollback = () => { g.members = beforeMembers; g.moderators = beforeMods }

  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return { ok: true } }
  // Vorher wurde hier nur `return` gemacht — die Liste blieb lokal gefiltert,
  // ohne dass je etwas geschrieben wurde. Genau der Zustand, den der Audit meint.
  const uid = _usernameToUid(username)
  if (!uid) { rollback(); return { ok: false, error: `${username} ist unbekannt.` } }
  return write('kickMember',
    () => supabase.from('group_members').delete()
      .eq('group_id', groupId).eq('user_id', uid).select('id'),
    rollback,
    { expectRows: true })
}

/*
 * Zwei Tabellen, keine Transaktion — PostgREST kennt keine. Die Reihenfolge ist
 * deshalb Absicht: ERST der Bann, DANN der Rauswurf. Bleibt es nach Schritt 1
 * stehen, ist der Nutzer gesperrt, steht aber noch in der Mitgliederliste —
 * sichtbar und mit einem zweiten Versuch zu beheben. Andersherum wäre er
 * spurlos draußen und könnte sofort wieder beitreten.
 * Schritt 1 wird bei einem Fehler in Schritt 2 bewusst NICHT per Gegen-Write
 * zurückgenommen: der könnte selbst scheitern, und eine frühere Mod-Rolle käme
 * dabei ohnehin nur als 'member' zurück.
 */
export async function banMember(groupId, username) {
  const g = _groups.find(x => x.id === groupId)
  if (!g) return { ok: false, error: 'Gruppe nicht gefunden.' }
  const low = username.toLowerCase()
  const beforeMembers = g.members
  const beforeMods    = g.moderators
  const beforeBanned  = g.banned
  g.members    = g.members.filter(m => m.toLowerCase() !== low)
  g.moderators = (g.moderators || []).filter(m => m.toLowerCase() !== low)
  g.banned     = Array.from(new Set([...(g.banned || []), username]))
  const rollbackAll = () => {
    g.members = beforeMembers; g.moderators = beforeMods; g.banned = beforeBanned
  }

  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return { ok: true } }
  const uid = _usernameToUid(username)
  if (!uid) { rollbackAll(); return { ok: false, error: `${username} ist unbekannt.` } }

  const banRes = await write('banMember.ban', async () => {
    const res = await supabase.from('group_bans')
      .insert({ group_id: groupId, user_id: uid, banned_by: _myUid })
    // 23505 = unique_violation: schon gesperrt. Gewünschter Endzustand, kein Fehler.
    return res.error?.code === '23505' ? { error: null } : res
  }, rollbackAll)
  if (!banRes.ok) return banRes

  const kickRes = await write('banMember.kick',
    () => supabase.from('group_members').delete()
      .eq('group_id', groupId).eq('user_id', uid).select('id'),
    () => { g.members = beforeMembers; g.moderators = beforeMods })
  if (!kickRes.ok) {
    return { ok: false, error: `${username} ist gesperrt, konnte aber nicht aus der Mitgliederliste entfernt werden. Bitte erneut versuchen.` }
  }
  return { ok: true }
}

export async function unbanMember(groupId, username) {
  const g = _groups.find(x => x.id === groupId)
  if (!g) return { ok: false, error: 'Gruppe nicht gefunden.' }
  const before = g.banned
  g.banned = (g.banned || []).filter(b => b.toLowerCase() !== username.toLowerCase())
  const rollback = () => { g.banned = before }

  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return { ok: true } }
  const uid = _usernameToUid(username)
  if (!uid) { rollback(); return { ok: false, error: `${username} ist unbekannt.` } }
  return write('unbanMember',
    () => supabase.from('group_bans').delete()
      .eq('group_id', groupId).eq('user_id', uid).select('id'),
    rollback,
    { expectRows: true })
}

export async function toggleMod(groupId, username) {
  const g = _groups.find(x => x.id === groupId)
  if (!g) return { ok: false, error: 'Gruppe nicht gefunden.' }
  g.moderators = g.moderators || []
  const before = [...g.moderators]
  const idx = g.moderators.findIndex(m => m.toLowerCase() === username.toLowerCase())
  const isMod = idx >= 0
  if (isMod) g.moderators.splice(idx, 1)
  else g.moderators.push(username)
  const rollback = () => { g.moderators = before }

  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return { ok: true } }
  const uid = _usernameToUid(username)
  if (!uid) { rollback(); return { ok: false, error: `${username} ist unbekannt.` } }
  return write('toggleMod',
    () => supabase.from('group_members').update({ role: isMod ? 'member' : 'mod' })
      .eq('group_id', groupId).eq('user_id', uid).select('id'),
    rollback,
    { expectRows: true })
}

export function isGroupBanned(g, username) {
  return (g.banned || []).some(b => b.toLowerCase() === username.toLowerCase())
}

export async function toggleRsvp(groupId) {
  const myName = _myUsername
  const g = _groups.find(x => x.id === groupId)
  if (!g) return { ok: false, error: 'Gruppe nicht gefunden.' }
  g.rsvp = g.rsvp || []
  const idx = g.rsvp.findIndex(u => u.toLowerCase() === myName.toLowerCase())
  const wasOn = idx >= 0
  if (wasOn) g.rsvp.splice(idx, 1)
  else g.rsvp.push(myName)
  const rollback = () => {
    if (wasOn) g.rsvp.splice(idx, 0, myName)
    else g.rsvp = g.rsvp.filter(u => u.toLowerCase() !== myName.toLowerCase())
  }
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return { ok: true } }

  // Fehlt die Tabelle group_rsvps noch (Migration nicht gelaufen), wird die
  // Zusage jetzt zurückgerollt statt nur in die Konsole geschrieben — ein
  // "Ich fahre mit", das nur der Anzeigende sieht, ist schlimmer als keins.
  return write('toggleRsvp',
    () => wasOn
      ? supabase.from('group_rsvps').delete().eq('group_id', groupId).eq('user_id', _myUid)
      : supabase.from('group_rsvps').insert({ group_id: groupId, user_id: _myUid }),
    rollback)
}

/* ── Kanäle ──────────────────────────────────────────────────────── */
export async function createChannel(groupId, name) {
  const g = _groups.find(x => x.id === groupId); if (!g) return { ok: false }
  const pos = (g.channels || []).length
  if (OFFLINE_MODE || !_myUid) {
    const ch = { id: 'c-' + Math.random().toString(36).slice(2, 9), name, messages: [] }
    ;(g.channels ||= []).push(ch); lsWrite(LS_GROUPS, _groups)
    return { ok: true, channel: ch }
  }
  const { data, error } = await supabase.from('channels').insert({
    group_id: groupId, name, position: pos,
  }).select().single()
  if (error) return { ok: false, error: error.message }
  const ch = { id: data.id, name, messages: [] }
  ;(g.channels ||= []).push(ch)
  _broadcastGroupLiveEvent(groupId, 'channel_created', { channel: { id: ch.id, name: ch.name } })
  return { ok: true, channel: ch }
}

export async function deleteChannel(groupId, channelId) {
  const g = _groups.find(x => x.id === groupId)
  if (!g) return { ok: false, error: 'Gruppe nicht gefunden.' }
  const channels = (g.channels ||= [])
  const idx = channels.findIndex(c => c.id === channelId)
  if (idx < 0) return { ok: true }   // schon weg
  const [removed] = channels.splice(idx, 1)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return { ok: true } }

  const res = await write('deleteChannel',
    () => supabase.from('channels').delete().eq('id', channelId).select('id'),
    () => { channels.splice(idx, 0, removed) },
    { expectRows: true })
  if (res.ok) _broadcastGroupLiveEvent(groupId, 'channel_deleted', { channelId })
  return res
}

/* ── Nachrichten in Gruppen ──────────────────────────────────────── */
/**
 * @param {{url:string,name:string,type:string,size:number}|null} attachment
 *   Beliebiger Dateityp; url ist eine data:-URL (wie profiles.avatar).
 */
/* ── Anhänge ─────────────────────────────────────────────────────
   Online landen Dateien in Supabase Storage und die Nachricht traegt nur
   die URL — als data:-URL in der Zeile waere bei ein paar MB Schluss
   (Base64 blaeht ~33% auf und die Zeile geht durch jedes SELECT mit).
   Offline bleibt die data:-URL, dort gibt es keinen Storage.
   ────────────────────────────────────────────────────────────────── */
export const ATTACH_BUCKET   = 'chat-attachments'
export const ATTACH_MAX      = 25 * 1024 * 1024  // Storage-Pfad
export const ATTACH_MAX_LOCAL = 2 * 1024 * 1024  // localStorage-Pfad (Quota ~5 MB)

function _fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/** Dateiname fuer den Storage-Pfad entschaerfen (keine Umlaute/Slashes). */
function _safeName(name = 'datei') {
  return name.normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').slice(-80) || 'datei'
}

/**
 * Macht aus dem Compose-Anhang ({ file, name, type, size }) das, was in der
 * Nachricht landet: { url, name, type, size, path? }.
 * @returns {Promise<object|{error:string}|null>}
 */
async function _prepareAttachment(att) {
  if (!att) return null
  if (att.url) return att            // schon fertig (Bestandsdaten/erneutes Senden)
  const { file, name, type, size } = att
  if (!file) return null

  if (OFFLINE_MODE || !_myUid) {
    if (size > ATTACH_MAX_LOCAL) return { error: 'Offline sind maximal 2 MB möglich.' }
    try { return { url: await _fileToDataUrl(file), name, type, size } }
    catch (e) { return { error: e?.message || 'Datei konnte nicht gelesen werden.' } }
  }

  if (size > ATTACH_MAX) return { error: 'Datei zu groß (max. 25 MB).' }
  const path = `${_myUid}/${Date.now()}-${_safeName(name)}`
  const { error } = await supabase.storage
    .from(ATTACH_BUCKET).upload(path, file, { contentType: type, upsert: false })
  if (error) {
    console.warn('[API] Upload fehlgeschlagen:', error.message)
    return { error: 'Upload fehlgeschlagen: ' + error.message }
  }
  const { data } = supabase.storage.from(ATTACH_BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, name, type, size, path }
}

export async function sendGroupMessage(groupId, channelId, text, replyTo = null, attachment = null) {
  const myName = _myUsername
  const g = _groups.find(x => x.id === groupId); if (!g) return { ok: false }
  const ch = g.channels?.find(c => c.id === channelId) || g.channels?.[0]; if (!ch) return { ok: false }

  const att = await _prepareAttachment(attachment)
  if (att?.error) return { ok: false, error: att.error }

  if (OFFLINE_MODE || !_myUid) {
    const msg = {
      id: 'm-' + Date.now(), author: myName, text, ts: Date.now(), reactions: {},
      ...(replyTo ? { replyTo: { ...replyTo } } : {}),
      ...(att     ? { attachment: att }          : {}),
    }
    ch.messages.push(msg); lsWrite(LS_GROUPS, _groups)
    return { ok: true, msg }
  }
  const base = {
    channel_id: ch.id, author_id: _myUid, text,
    reply_to_id: replyTo?.id || null,
  }
  const optional = {
    mentions: _resolveMentions(text, g.members || []),
    ...(att ? { attachment: att } : {}),
  }
  // messages.mentions und messages.attachment garantiert die Migration
  // a0_bestandsangleichung. Der frühere zweite Versuch ohne diese Felder war
  // die schädlichste Stelle der ganzen Ratekette: er schickte die Nachricht
  // ohne Anhang los und meldete Erfolg — der Absender sah den Sticker aus
  // seiner eigenen lokalen Kopie, beim Empfänger kam nichts an.
  const { data, error } = await supabase.from('messages').insert({ ...base, ...optional }).select().single()
  if (error) return { ok: false, error: error.message }
  const msg = _mapMessage({ ...data, profiles: { username: myName } })
  // Realtime liefert die Nachricht zurück, aber wir fügen sie sofort ein (optimistic)
  if (!ch.messages.some(m => m.id === msg.id)) ch.messages.push(msg)
  return { ok: true, msg }
}

export async function editMessageInGroup(groupId, msgId, newText) {
  const g = _groups.find(x => x.id === groupId)
  if (!g) return { ok: false, error: 'Gruppe nicht gefunden.' }
  let msg = null
  for (const ch of (g.channels || [])) { msg = ch.messages.find(m => m.id === msgId); if (msg) break }
  if (!msg) return { ok: false, error: 'Nachricht nicht gefunden.' }
  const rollback = _editMessageLocal(msg, newText)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return { ok: true } }
  return write('editMessageInGroup',
    () => supabase.from('messages')
      .update({ text: newText, edited_at: new Date().toISOString() }).eq('id', msgId).select('id'),
    rollback,
    { expectRows: true })
}

export async function deleteGroupMessage(groupId, msgId) {
  const g = _groups.find(x => x.id === groupId)
  if (!g) return { ok: false, error: 'Gruppe nicht gefunden.' }
  // Position merken, damit die Nachricht bei einem Fehler wieder an ihrer
  // Stelle im Verlauf landet und nicht am Ende.
  const removed = []
  for (const ch of (g.channels || [])) {
    const idx = ch.messages.findIndex(m => m.id === msgId)
    if (idx >= 0) { removed.push({ ch, idx, msg: ch.messages[idx] }); ch.messages.splice(idx, 1) }
  }
  const rollback = () => { for (const r of removed) r.ch.messages.splice(r.idx, 0, r.msg) }

  if (OFFLINE_MODE || !_myUid) {
    lsWrite(LS_GROUPS, _groups)
    lsWrite(LS_MSG_REPORTS, _msgReports.filter(r => !(r.groupId === groupId && r.msgId === msgId)))
    return { ok: true }
  }
  return write('deleteGroupMessage',
    () => supabase.from('messages').delete().eq('id', msgId).select('id'),
    rollback,
    { expectRows: true })
}

/* ── Reaktionen ───────────────────────────────────────────────────
   Im lokalen Cache bleibt die Form { emoji: [username, …] } (so rendert
   community.js), in der Datenbank ist es seit der Migration eine Zeile je
   Reaktion in message_reactions. Der frühere Weg — das ganze reactions-Objekt
   per UPDATE auf messages schreiben — konnte gar nicht funktionieren: die
   Policy msg_update erlaubt UPDATE nur Autor und Mods, eine Reaktion auf eine
   fremde Nachricht traf null Zeilen. Null getroffene Zeilen sind für PostgREST
   kein Fehler, deshalb fiel es nur beim Neuladen auf.
   ────────────────────────────────────────────────────────────────── */

/**
 * Reaktion im lokalen Cache setzen oder entfernen.
 * @returns {boolean} true, wenn sich etwas geändert hat (sonst war der
 *   gewünschte Zustand schon da — wichtig für die Realtime-Pfade, die
 *   doppelt eintreffen können).
 */
function _setReactionLocal(msg, emoji, username, on) {
  if (!msg.reactions) msg.reactions = {}
  const users = msg.reactions[emoji] || []
  if (users.includes(username) === on) return false
  if (on) {
    msg.reactions[emoji] = [...users, username]
  } else {
    const rest = users.filter(u => u !== username)
    if (rest.length) msg.reactions[emoji] = rest
    else delete msg.reactions[emoji]
  }
  return true
}

/**
 * Umschalten im lokalen Cache. Ein zweiter Aufruf mit denselben Argumenten
 * stellt den Ausgangszustand wieder her — genau das ist der Rollback, wenn
 * der Serverschreibvorgang scheitert.
 * @returns {boolean} true, wenn die Reaktion jetzt gesetzt ist.
 */
function _toggleReactionLocal(msg, emoji, username) {
  const on = !(msg.reactions?.[emoji] || []).includes(username)
  _setReactionLocal(msg, emoji, username, on)
  return on
}

/**
 * Die eigene Reaktion in der Datenbank anlegen/entfernen und bei Fehler den
 * lokalen Zustand zurückrollen.
 *
 * Der frühere Rückfall auf `UPDATE messages SET reactions = …` ist weg: die
 * Tabelle garantiert die Migration a13_message_reactions. Der Rückfall war
 * ohnehin nur scheinbar einer — die Policy msg_update erlaubt das UPDATE nur
 * dem Autor oder einem Mod, auf einer fremden Nachricht traf es null Zeilen.
 * Er hat also genau in dem Fall nicht funktioniert, für den es ihn gab.
 */
function _persistReaction(msgId, emoji, on, rollback) {
  return write('toggleReaction', async () => {
    const res = on
      ? await supabase.from('message_reactions').insert({ message_id: msgId, user_id: _myUid, emoji })
      : await supabase.from('message_reactions').delete()
          .eq('message_id', msgId).eq('user_id', _myUid).eq('emoji', emoji)
    // 23505 = unique_violation: die Reaktion steht schon da (Doppelklick,
    // zweiter Tab). Der gewünschte Endzustand ist erreicht, kein Fehler.
    if (res.error && on && res.error.code === '23505') return { error: null }
    return res
  }, rollback, { expectRows: true })
}

export async function toggleReactionInGroup(groupId, msgId, emoji) {
  const myName = _myUsername
  const g = _groups.find(x => x.id === groupId); if (!g) return { ok: false, error: 'Gruppe nicht gefunden.' }
  let msg = null
  for (const ch of (g.channels || [])) { msg = ch.messages.find(x => x.id === msgId); if (msg) break }
  if (!msg) return { ok: false, error: 'Nachricht nicht gefunden.' }

  const on = _toggleReactionLocal(msg, emoji, myName)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return { ok: true } }
  return _persistReaction(msgId, emoji, on, () => _toggleReactionLocal(msg, emoji, myName))
}

/**
 * Text einer Nachricht lokal ersetzen und den passenden Rollback zurückgeben.
 * `editedTs` kann vorher gefehlt haben — dann muss der Rollback es wieder
 * entfernen, nicht auf undefined setzen (renderText prüft auf Anwesenheit).
 */
function _editMessageLocal(msg, newText) {
  const prevText   = msg.text
  const hadEdited  = 'editedTs' in msg
  const prevEdited = msg.editedTs
  msg.text = newText
  msg.editedTs = Date.now()
  return () => {
    msg.text = prevText
    if (hadEdited) msg.editedTs = prevEdited; else delete msg.editedTs
  }
}

/* ── Nachrichten-Meldungen ──────────────────────────────────────── */
export function getMsgReports() { return _msgReports }
export function reportsForGroup(groupId) { return _msgReports.filter(r => r.groupId === groupId) }

export async function reportMessage(groupId, msgId, msgAuthor, msgText, channelId = null) {
  const myName = _myUsername
  if (_msgReports.some(r => r.groupId === groupId && r.msgId === msgId && r.reportedBy === myName))
    return { ok: false, error: 'Du hast diese Nachricht bereits gemeldet.' }
  // `report` schattet hier bewusst nicht den Sentry-Helfer aus monitoring.js —
  // deshalb heißt der Eintrag entry.
  const entry = { id: 'rp-' + Date.now(), groupId, channelId, msgId, msgAuthor, msgText, reportedBy: myName, ts: Date.now() }
  _msgReports.push(entry)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_MSG_REPORTS, _msgReports); return { ok: true } }
  return write('reportMessage',
    () => supabase.from('message_reports').insert({
      message_id: msgId, group_id: groupId, reported_by: _myUid,
    }),
    () => { _msgReports = _msgReports.filter(r => r.id !== entry.id) })
}

export async function dismissReport(reportId) {
  const idx = _msgReports.findIndex(r => r.id === reportId)
  if (idx < 0) return { ok: true }
  const [removed] = _msgReports.splice(idx, 1)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_MSG_REPORTS, _msgReports); return { ok: true } }

  // Online trägt jeder Eintrag eine lokal vergebene 'rp-…'-ID: message_reports
  // wird beim Start gar nicht geladen (siehe _loadGroups — die Liste enthält
  // nur die in dieser Sitzung erzeugten Meldungen), und reportMessage bekommt
  // die vom Server vergebene uuid nie zu sehen. Ein DELETE mit dieser ID würde
  // an der uuid-Prüfung scheitern und das Wegklicken unmöglich machen.
  // Deshalb: nur echte uuids löschen, alles andere bleibt rein lokal.
  if (!UUID_RE.test(reportId)) return { ok: true }
  return write('dismissReport',
    () => supabase.from('message_reports').delete().eq('id', reportId),
    () => { _msgReports.splice(idx, 0, removed) })
}

/* ── Gruppe beitreten / Anfragen ─────────────────────────────────── */
export function getGroupRequests() { return _groupRequests }
export function groupRequestsFor(groupId) { return _groupRequests.filter(r => r.groupId === groupId) }
export function myGroupRequest(groupId) {
  const n = _myUsername
  return _groupRequests.find(r => r.groupId === groupId && r.from.toLowerCase() === n.toLowerCase())
}

export async function sendJoinRequest(groupId, text) {
  const myName = _myUsername
  const g = _groups.find(x => x.id === groupId)
  if (!g) return { ok: false, error: 'Gruppe nicht gefunden.' }
  if (isGroupBanned(g, myName)) return { ok: false, error: 'Du wurdest aus dieser Gruppe gesperrt.' }
  if ((g.members || []).includes(myName)) return { ok: false, error: 'Du bist bereits Mitglied.' }
  if (myGroupRequest(groupId)) return { ok: false, error: 'Anfrage bereits gesendet.' }

  if (OFFLINE_MODE || !_myUid) {
    const req = { id: 'gr-' + Date.now(), groupId, from: myName, text: text || '', ts: Date.now() }
    _groupRequests.push(req); lsWrite(LS_GROUP_REQUESTS, _groupRequests)
    return { ok: true }
  }
  // Die vom Server vergebene uuid mitnehmen. Vorher stand hier eine lokale
  // 'gr-…'-ID; das "Anfrage zurückziehen" schickte die anschließend gegen eine
  // uuid-Spalte (declineGroupRequest → .eq('id', …)) und lief in einen
  // 22P02-Fehler, bis einmal neu geladen wurde. Solange Beitrittsanfragen ohne
  // Wirkung waren, fiel das niemandem auf — seit A4 entscheidet dieser Ablauf
  // tatsächlich über den Zutritt.
  const { data, error } = await supabase.from('group_join_requests').insert({
    group_id: groupId, from_user: _myUid, text: text || '',
  }).select('id').single()
  if (error) return { ok: false, error: error.message }
  _groupRequests.push({ id: data.id, groupId, from: myName, text: text || '', ts: Date.now() })
  return { ok: true }
}

/*
 * Aufnehmen und die Anfrage schliessen laufen in EINER Transaktion — die
 * RPC accept_join_request() ist der Transaktionsrahmen. Vorher waren das zwei
 * getrennte Schreibvorgänge aus dem Browser; scheiterte der zweite, war der
 * Nutzer aufgenommen und die Anfrage stand weiter als offen in der Liste.
 *
 * Die Berechtigungsprüfung (Owner/Mod der Gruppe) steckt jetzt in der
 * Funktion, nicht mehr nur in der group_members-Policy: seit A4 kann sich
 * niemand mehr selbst in eine 'request'-Gruppe eintragen, und der Aufnehmende
 * trägt einen FREMDEN ein.
 */
const ACCEPT_REASONS = {
  unknown_request:   'Anfrage nicht gefunden.',
  not_allowed:       'Dafür fehlen dir die Rechte in dieser Gruppe.',
  banned:            'Dieses Konto ist in der Gruppe gesperrt — erst entsperren.',
  not_authenticated: 'Bitte melde dich an.',
}

export async function acceptGroupRequest(reqId) {
  const r = _groupRequests.find(x => x.id === reqId)
  if (!r) return { ok: false, error: 'Anfrage nicht gefunden.' }
  const g = _groups.find(x => x.id === r.groupId)
  const added = !!g && !g.members.includes(r.from)
  if (added) g.members.push(r.from)
  const beforeReqs = _groupRequests
  _groupRequests = _groupRequests.filter(x => x.id !== reqId)
  const rollbackAll = () => {
    if (added) g.members = g.members.filter(m => m !== r.from)
    _groupRequests = beforeReqs
  }

  if (OFFLINE_MODE || !_myUid) {
    lsWrite(LS_GROUPS, _groups); lsWrite(LS_GROUP_REQUESTS, _groupRequests); return { ok: true }
  }

  const { data, error } = await supabase.rpc('accept_join_request', { request_id: reqId })
  if (error) {
    rollbackAll()
    report(error, { where: 'community-api.acceptGroupRequest', code: error.code })
    return { ok: false, error: 'Anfrage konnte nicht angenommen werden: ' + error.message }
  }
  if (!data?.ok) {
    rollbackAll()
    const reason = data?.reason || 'unknown_request'
    return { ok: false, error: ACCEPT_REASONS[reason] || 'Anfrage konnte nicht angenommen werden.' }
  }
  return { ok: true }
}

export async function declineGroupRequest(reqId) {
  const before = _groupRequests
  if (!before.some(x => x.id === reqId)) return { ok: true }
  _groupRequests = before.filter(x => x.id !== reqId)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUP_REQUESTS, _groupRequests); return { ok: true } }
  return write('declineGroupRequest',
    () => supabase.from('group_join_requests').delete().eq('id', reqId),
    () => { _groupRequests = before })
}

/* ── Einladungen ─────────────────────────────────────────────────── */
export function getInvites() { return _invites }

function genInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let code = ''
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

export async function createInvite(groupId, { validityDays, maxUses }) {
  const code = genInviteCode()
  const now = Date.now()
  const inv = {
    code, groupId, createdBy: _myUid, createdAt: now,
    expiresAt: validityDays === 0 ? null : now + validityDays * 86400_000,
    maxUses: maxUses === 0 ? null : maxUses,
    uses: 0,
  }
  _invites.push(inv)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_INVITES, _invites); return { ok: true, invite: inv } }
  const res = await write('createInvite',
    () => supabase.from('invites').insert({
      code, group_id: groupId, created_by: _myUid,
      expires_at: inv.expiresAt ? new Date(inv.expiresAt).toISOString() : null,
      max_uses: inv.maxUses,
    }),
    () => { _invites = _invites.filter(i => i.code !== code) })
  // Ein Code, der nur lokal existiert, ist schlimmer als kein Code: er lässt
  // sich weitergeben und funktioniert bei niemandem.
  return res.ok ? { ok: true, invite: inv } : res
}

export async function revokeInvite(code) {
  const before = _invites
  if (!before.some(i => i.code === code)) return { ok: true }
  _invites = before.filter(i => i.code !== code)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_INVITES, _invites); return { ok: true } }
  return write('revokeInvite',
    () => supabase.from('invites').delete().eq('code', code).select('code'),
    () => { _invites = before },
    { expectRows: true })
}

/*
 * Fehlerkennungen der RPC redeem_invite() in Klartext. `unknown_code` behält
 * das UI in community.js gesondert im Blick: nur dann war die Eingabe
 * womöglich gar kein Code, sondern ein Gruppenname, und es sucht weiter.
 */
const REDEEM_REASONS = {
  unknown_code:      'Einladungscode unbekannt.',
  no_group:          'Die Gruppe existiert nicht mehr.',
  banned:            'Du wurdest aus dieser Gruppe gesperrt.',
  already_member:    'Du bist bereits Mitglied dieser Gruppe.',
  expired:           'Dieser Einladungscode ist abgelaufen.',
  exhausted:         'Dieser Einladungscode wurde bereits zu oft verwendet.',
  not_authenticated: 'Bitte melde dich an.',
}

export async function redeemInvite(rawCode) {
  const myName = _myUsername

  if (OFFLINE_MODE || !_myUid) {
    // Demo-Modus: kein Supabase, also weiterhin alles lokal. Die Prüfungen
    // stehen hier bewusst doppelt — online macht sie jetzt die Datenbank.
    const inv = _invites.find(i => i.code.toLowerCase() === rawCode.toLowerCase())
    if (!inv) return { ok: false, reason: 'unknown_code', error: REDEEM_REASONS.unknown_code }
    if (inv.expiresAt && Date.now() > inv.expiresAt) return { ok: false, error: REDEEM_REASONS.expired }
    if (inv.maxUses !== null && inv.uses >= inv.maxUses) return { ok: false, error: REDEEM_REASONS.exhausted }
    const g = _groups.find(x => x.id === inv.groupId)
    if (!g) return { ok: false, error: REDEEM_REASONS.no_group }
    if (isGroupBanned(g, myName)) return { ok: false, error: REDEEM_REASONS.banned }
    if (g.members.some(m => m.toLowerCase() === myName.toLowerCase())) {
      return { ok: false, error: REDEEM_REASONS.already_member }
    }
    g.members.push(myName); inv.uses++
    lsWrite(LS_GROUPS, _groups); lsWrite(LS_INVITES, _invites)
    return { ok: true, group: g }
  }

  // Online: EIN Aufruf, der alles in einer Transaktion erledigt — Prüfen,
  // Zähler erhöhen, aufnehmen. Vorher liefen das drei getrennte Anfragen aus
  // dem Browser; `uses` wurde dabei clientseitig gerechnet, zwei gleichzeitige
  // Einlösungen zählten als eine. Und seit invites_select nur noch Owner und
  // Mods sieht, könnte der Einlösende die Zeile gar nicht mehr lesen.
  const { data, error } = await supabase.rpc('redeem_invite', { invite_code: rawCode })
  if (error) {
    report(error, { where: 'community-api.redeemInvite', code: error.code })
    return { ok: false, error: 'Einlösung fehlgeschlagen: ' + error.message }
  }
  if (!data?.ok) {
    const reason = data?.reason || 'unknown_code'
    return { ok: false, reason, error: REDEEM_REASONS[reason] || 'Einlösung fehlgeschlagen.' }
  }

  const g = _groups.find(x => x.id === data.group_id)
  if (!g) {
    // Der Beitritt ist echt, nur der lokale Cache kennt die Gruppe nicht —
    // das UI braucht aber Name und ID. Neu laden statt raten.
    await _loadGroups()
    const fresh = _groups.find(x => x.id === data.group_id)
    if (!fresh) return { ok: false, error: REDEEM_REASONS.no_group }
    if (!fresh.members.includes(myName)) fresh.members.push(myName)
    return { ok: true, group: fresh }
  }
  if (!g.members.some(m => m.toLowerCase() === myName.toLowerCase())) g.members.push(myName)
  const inv = _invites.find(i => i.code.toLowerCase() === rawCode.toLowerCase())
  if (inv) inv.uses++   // nur Anzeige; maßgeblich ist der Zähler in der Datenbank
  return { ok: true, group: g }
}

export function activeInvitesForGroup(groupId) {
  const now = Date.now()
  return _invites.filter(i => i.groupId === groupId && (i.expiresAt === null || i.expiresAt > now))
}

/* ══════════════════════════════════════════════════════════════════
   DIREKTNACHRICHTEN
   ══════════════════════════════════════════════════════════════════ */

export function getDMs() { return (_dms[_myUsername] ||= {}) }

function _dmThread(aUsername, bUsername) {
  const aUid = _usernameToUid(aUsername)
  const bUid = _usernameToUid(bUsername)
  if (!aUid || !bUid) return null
  return [aUid, bUid].sort().join(':')
}

/* ── Typing-Indikator für DMs (eigener Broadcast-Kanal pro Thread,
   analog zu group-live: Realtime-only, kein Schema/keine Persistenz) ── */
let _dmTypingChan = null
let _dmTypingPeer = null

/** Abonnieren, solange ein DM mit `peerUsername` offen ist. Idempotent. */
export function subscribeDMTyping(peerUsername, onTyping) {
  if (OFFLINE_MODE || !supabase) return
  if (_dmTypingPeer === peerUsername) return
  unsubscribeDMTyping()
  const thread = _dmThread(_myUsername, peerUsername)
  if (!thread) return
  _dmTypingChan = supabase.channel(`dm-typing:${thread}`, { config: { broadcast: { self: false } } })
  _dmTypingChan.on('broadcast', { event: 'typing' }, ({ payload }) => onTyping(payload.username))
  _dmTypingChan.subscribe()
  _dmTypingPeer = peerUsername
}

export function unsubscribeDMTyping() {
  if (_dmTypingChan) { try { supabase.removeChannel(_dmTypingChan) } catch {} }
  _dmTypingChan = null
  _dmTypingPeer = null
}

/** Signalisiert dem DM-Partner, dass ich gerade tippe (nur während subscribeDMTyping() für ihn aktiv ist). */
export function sendDMTyping(peerUsername) {
  if (OFFLINE_MODE || !supabase || _dmTypingPeer !== peerUsername || !_dmTypingChan) return
  _dmTypingChan.send({ type: 'broadcast', event: 'typing', payload: { username: _myUsername } }).catch(() => {})
}

export function canSendDM(sender, recipient) {
  const rProf = getProfile(recipient)
  if (!rProf.dmPolicy || rProf.dmPolicy === 'all') return true
  const rFriends = (_friends[recipient] || [])
  return rFriends.some(f => f.toLowerCase() === sender.toLowerCase())
}

/** @param {{url:string,name:string,type:string,size:number}|null} attachment */
export async function sendDM(to, text, replyTo = null, attachment = null) {
  const myName = _myUsername
  const blockedByRecipient = isBlockedBy(to)
  const ignoredByRecipient = (_ignored[to] || []).some(x => x.toLowerCase() === myName.toLowerCase())

  const att = await _prepareAttachment(attachment)
  if (att?.error) return { ok: false, error: att.error }

  const msg = { id: 'd-' + Date.now(), author: myName, text, ts: Date.now() }
  if (replyTo) msg.replyTo    = { ...replyTo }
  if (att)     msg.attachment = att

  ;(_dms[myName] ||= {})[to] = [...((_dms[myName])[to] || []), msg]
  if (!blockedByRecipient) {
    ;(_dms[to] ||= {})[myName] = [...((_dms[to])[myName] || []), msg]
    if (!ignoredByRecipient) _markUnreadCache(to, myName)
  }

  // Die Nachricht steckt lokal in beiden Richtungen — der Rollback muss sie
  // aus beiden wieder entfernen (und die Ungelesen-Markierung mitnehmen, sonst
  // leuchtet ein Punkt für eine Nachricht, die es nicht gibt).
  const removeLocal = () => {
    for (const [a, b] of [[myName, to], [to, myName]]) {
      if (_dms[a]?.[b]) _dms[a][b] = _dms[a][b].filter(m => m.id !== msg.id)
    }
    if (!(_dms[to]?.[myName] || []).length) {
      _unread[to] = (_unread[to] || []).filter(x => x !== myName)
    }
  }

  if (OFFLINE_MODE || !_myUid) {
    lsWrite(LS_DMS, _dms); lsWrite(LS_UNREAD, _unread); return { ok: true }
  }
  // Blockiert: die Nachricht bleibt bewusst in der eigenen Ansicht stehen und
  // geht nicht raus — der Absender soll nicht erfahren, dass er blockiert ist.
  if (blockedByRecipient) return { ok: true }
  const thread = _dmThread(myName, to)
  if (!thread) { removeLocal(); return { ok: false, error: 'Empfänger nicht gefunden.' } }

  const base = { dm_thread: thread, author_id: _myUid, text, reply_to_id: replyTo?.id || null }
  let serverId = null

  // messages.attachment garantiert die Migration a0_bestandsangleichung —
  // dasselbe wie in sendGroupMessage, hier für Direktnachrichten.
  const res = await write('sendDM', async () => {
    const first = await supabase
      .from('messages').insert({ ...base, ...(att ? { attachment: att } : {}) }).select().single()
    if (first.data) serverId = first.data.id
    return first
  }, removeLocal)

  if (!res.ok) return res
  if (serverId) msg.id = serverId
  return { ok: true }
}

export async function editMessageInDM(peer, msgId, newText) {
  const objs = _dmMessageObjects(peer, msgId)
  if (!objs.length) return { ok: false, error: 'Nachricht nicht gefunden.' }
  const undo = objs.map(m => _editMessageLocal(m, newText))
  const rollback = () => { for (const fn of undo) fn() }

  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_DMS, _dms); return { ok: true } }
  return write('editMessageInDM',
    () => supabase.from('messages')
      .update({ text: newText, edited_at: new Date().toISOString() }).eq('id', msgId).select('id'),
    rollback,
    { expectRows: true })
}

export async function deleteDMMessage(peer, msgId) {
  const myName = _myUsername
  // Position je Richtung merken — sonst landet die Nachricht beim Rollback am
  // Ende des Verlaufs statt an ihrer Stelle.
  const removed = []
  for (const [a, b] of [[myName, peer], [peer, myName]]) {
    const arr = _dms[a]?.[b]
    if (!arr) continue
    const idx = arr.findIndex(m => m.id === msgId)
    if (idx < 0) continue
    removed.push({ a, b, idx, msg: arr[idx] })
    _dms[a][b] = arr.filter(m => m.id !== msgId)
  }
  if (!removed.length) return { ok: true }
  const rollback = () => {
    for (const r of removed) {
      const arr = [...(_dms[r.a]?.[r.b] || [])]
      arr.splice(r.idx, 0, r.msg)
      ;(_dms[r.a] ||= {})[r.b] = arr
    }
  }

  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_DMS, _dms); return { ok: true } }
  return write('deleteDMMessage',
    () => supabase.from('messages').delete().eq('id', msgId).select('id'),
    rollback,
    { expectRows: true })
}

/**
 * Alle Cache-Objekte zu einer DM-Nachricht — als Set, weil _dms[a][b] und
 * _dms[b][a] dasselbe Nachrichtenobjekt enthalten (so legen es _loadDMs(),
 * sendDM() und _handleNewMessage() an). Die frühere Schleife über beide
 * Richtungen schaltete die Reaktion deshalb ZWEIMAL um — im Ergebnis passierte
 * lokal gar nichts, und in die Datenbank ging der zurückgedrehte Zustand.
 */
function _dmMessageObjects(peer, msgId) {
  const myName = _myUsername
  const found = new Set()
  for (const [a, b] of [[myName, peer], [peer, myName]]) {
    const msg = (_dms[a]?.[b] || []).find(x => x.id === msgId)
    if (msg) found.add(msg)
  }
  return [...found]
}

export async function toggleReactionInDM(peer, msgId, emoji) {
  const myName = _myUsername
  const objs = _dmMessageObjects(peer, msgId)
  if (!objs.length) return { ok: false, error: 'Nachricht nicht gefunden.' }

  const on = _toggleReactionLocal(objs[0], emoji, myName)
  for (const m of objs.slice(1)) _setReactionLocal(m, emoji, myName, on)
  const rollback = () => {
    for (const m of objs) _setReactionLocal(m, emoji, myName, !on)
  }

  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_DMS, _dms); return { ok: true } }
  return _persistReaction(msgId, emoji, on, rollback)
}

function _markUnreadCache(forUser, fromUser) {
  _unread[forUser] = Array.from(new Set([...(_unread[forUser] || []), fromUser]))
}

export function markUnread(forUser, fromUser) {
  _markUnreadCache(forUser, fromUser)
  if (OFFLINE_MODE) lsWrite(LS_UNREAD, _unread)
}

export function clearUnread(fromUser) {
  _unread[_myUsername] = (_unread[_myUsername] || []).filter(x => x !== fromUser)
  if (OFFLINE_MODE) lsWrite(LS_UNREAD, _unread)
}

export function unreadFrom() { return (_unread[_myUsername] || []) }

/* ══════════════════════════════════════════════════════════════════
   FREUNDE
   ══════════════════════════════════════════════════════════════════ */

export function getFriends() { return (_friends[_myUsername] || []) }

async function _addFriendPair(a, b) {
  ;(_friends[a] ||= []).push(b)
  ;(_friends[b] ||= []).push(a)
  const rollback = () => {
    const ia = _friends[a].lastIndexOf(b); if (ia >= 0) _friends[a].splice(ia, 1)
    const ib = _friends[b].lastIndexOf(a); if (ib >= 0) _friends[b].splice(ib, 1)
  }
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_FRIENDS, _friends); return { ok: true } }
  const aUid = _usernameToUid(a); const bUid = _usernameToUid(b)
  if (!aUid || !bUid) { rollback(); return { ok: false, error: 'Nutzer nicht gefunden.' } }
  const [u1, u2] = [aUid, bUid].sort()
  return write('addFriendPair',
    () => supabase.from('friendships').upsert({ user_a: u1, user_b: u2 }),
    rollback)
}

export async function removeFriendPair(a, b) {
  const beforeA = _friends[a] || []
  const beforeB = _friends[b] || []
  _friends[a] = beforeA.filter(x => x !== b)
  _friends[b] = beforeB.filter(x => x !== a)
  const rollback = () => { _friends[a] = beforeA; _friends[b] = beforeB }

  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_FRIENDS, _friends); return { ok: true } }
  const aUid = _usernameToUid(a); const bUid = _usernameToUid(b)
  // Vorher wurde hier stumm zurückgekehrt — die Freundschaft war lokal weg und
  // in der Datenbank noch da.
  if (!aUid || !bUid) { rollback(); return { ok: false, error: 'Nutzer nicht gefunden.' } }
  const [u1, u2] = [aUid, bUid].sort()
  return write('removeFriendPair',
    () => supabase.from('friendships').delete().eq('user_a', u1).eq('user_b', u2),
    rollback)
}

/* ── Freundschaftsanfragen ───────────────────────────────────────── */
export function getRequests() { return _requests }
export function incomingRequests() { const n = _myUsername; return _requests.filter(r => r.to.toLowerCase() === n.toLowerCase()) }
export function outgoingRequests() { const n = _myUsername; return _requests.filter(r => r.from.toLowerCase() === n.toLowerCase()) }

export async function sendFriendRequest(toUsername) {
  const myName = _myUsername
  if (!toUsername || toUsername.toLowerCase() === myName.toLowerCase()) return { ok: false, error: 'Du kannst dich nicht selbst hinzufügen.' }
  if (isBlocked(toUsername)) return { ok: false, error: `Du hast ${toUsername} blockiert.` }
  if (isBlockedBy(toUsername)) return { ok: false, error: 'Freundschaftsanfrage konnte nicht gesendet werden.' }
  if (getFriends().some(f => f.toLowerCase() === toUsername.toLowerCase())) return { ok: false, error: `${toUsername} ist bereits dein Freund.` }
  if (_requests.some(r => r.from.toLowerCase() === myName.toLowerCase() && r.to.toLowerCase() === toUsername.toLowerCase()))
    return { ok: false, error: 'Anfrage wurde bereits gesendet.' }

  // Prüfe, ob Nutzer existiert
  if (OFFLINE_MODE || !_myUid) {
    const target = findUserByUsername(toUsername)
    if (!target) return { ok: false, error: 'Es gibt keinen Nutzer mit diesem Benutzernamen.' }
  } else {
    const { data } = await supabase.from('profiles').select('id,username').ilike('username', toUsername).maybeSingle()
    if (!data) return { ok: false, error: 'Es gibt keinen Nutzer mit diesem Benutzernamen.' }
    if (!_profileCache[data.username]) _profileCache[data.username] = { _uid: data.id }
  }

  // Umgekehrte Anfrage → direkt annehmen
  const reverse = _requests.find(r => r.from.toLowerCase() === toUsername.toLowerCase() && r.to.toLowerCase() === myName.toLowerCase())
  if (reverse) {
    const beforeReqs = _requests
    _requests = _requests.filter(r => r.id !== reverse.id)
    // Reihenfolge: erst die Freundschaft, dann die Anfrage wegräumen. Scheitert
    // die Freundschaft, ist nichts passiert und die Anfrage steht noch.
    const pairRes = await _addFriendPair(myName, toUsername)
    if (!pairRes.ok) { _requests = beforeReqs; return pairRes }
    if (OFFLINE_MODE || !_myUid) {
      lsWrite(LS_REQUESTS, _requests)
      return { ok: true, autoAccepted: true, username: toUsername }
    }
    // Die Freundschaft steht. Bleibt die Anfrage liegen, ist das kosmetisch —
    // sie verschwindet spätestens beim nächsten Laden, weil sie zu einer
    // bestehenden Freundschaft gehört. Deshalb kein Fehler nach außen.
    await write('sendFriendRequest.cleanup',
      () => supabase.from('friend_requests').delete().eq('id', reverse.id),
      () => { _requests = beforeReqs })
    return { ok: true, autoAccepted: true, username: toUsername }
  }

  const req = { id: 'fr-' + Date.now(), from: myName, to: toUsername, ts: Date.now() }
  _requests.push(req)

  if (OFFLINE_MODE || !_myUid) {
    lsWrite(LS_REQUESTS, _requests)
    return { ok: true, username: toUsername }
  }
  const toUid = _usernameToUid(toUsername)
  if (toUid) {
    const { data, error } = await supabase.from('friend_requests').insert({
      from_user: _myUid, to_user: toUid,
    }).select().single()
    if (data) req.id = data.id
    if (error) {
      _requests = _requests.filter(r => r.id !== req.id)
      return { ok: false, error: error.message }
    }
  }
  return { ok: true, username: toUsername }
}

export async function acceptRequest(id) {
  const r = _requests.find(x => x.id === id)
  if (!r) return { ok: false, error: 'Anfrage nicht gefunden.' }
  const beforeReqs = _requests
  _requests = _requests.filter(x => x.id !== id)

  // Erst die Freundschaft, dann die Anfrage wegräumen — scheitert sie, ist
  // nichts passiert und die Anfrage steht noch da.
  const pairRes = await _addFriendPair(r.from, r.to)
  if (!pairRes.ok) { _requests = beforeReqs; return pairRes }

  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_REQUESTS, _requests); return { ok: true } }
  // Liegengebliebene Anfrage ist kosmetisch (die Freundschaft besteht bereits),
  // deshalb wird sie nur gemeldet, nicht als Fehler nach außen gereicht.
  await write('acceptRequest.cleanup',
    () => supabase.from('friend_requests').delete().eq('id', id),
    () => { _requests = beforeReqs })
  return { ok: true }
}

export async function declineRequest(id) {
  const before = _requests
  if (!before.some(x => x.id === id)) return { ok: true }
  _requests = before.filter(x => x.id !== id)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_REQUESTS, _requests); return { ok: true } }
  return write('declineRequest',
    () => supabase.from('friend_requests').delete().eq('id', id).select('id'),
    () => { _requests = before },
    { expectRows: true })
}

export async function cancelRequest(id) { return declineRequest(id) }

/* ══════════════════════════════════════════════════════════════════
   BLOCKIEREN / IGNORIEREN
   ══════════════════════════════════════════════════════════════════ */

export function getBlocked() { return (_blocked[_myUsername] || []) }
export function isBlocked(username) { return getBlocked().some(x => x.toLowerCase() === username.toLowerCase()) }
export function isBlockedBy(username) {
  return (_blocked[username] || []).some(x => x.toLowerCase() === _myUsername.toLowerCase())
}

/**
 * Blockieren/Entblockieren.
 * @returns {Promise<{ok: boolean, blocked: boolean, error?: string}>} `blocked`
 *   ist der Zustand, der jetzt tatsächlich gilt — im Fehlerfall also der ALTE.
 *   Früher gab die Funktion nur den optimistischen Wunschzustand als boolean
 *   zurück, auch wenn nichts gespeichert wurde.
 */
export async function toggleBlock(username) {
  const myName = _myUsername
  const list   = _blocked[myName] || []
  const idx    = list.findIndex(x => x.toLowerCase() === username.toLowerCase())
  const nowBlocked = idx < 0
  if (nowBlocked) list.push(username)
  else list.splice(idx, 1)
  _blocked[myName] = list
  const rollback = () => {
    if (nowBlocked) {
      const i = list.findIndex(x => x.toLowerCase() === username.toLowerCase())
      if (i >= 0) list.splice(i, 1)
    } else {
      list.splice(idx, 0, username)
    }
  }

  if (OFFLINE_MODE || !_myUid) {
    if (nowBlocked) await removeFriendPair(myName, username)
    lsWrite(LS_BLOCKED, _blocked)
    return { ok: true, blocked: nowBlocked }
  }
  const uid = _usernameToUid(username)
  if (!uid) { rollback(); return { ok: false, blocked: !nowBlocked, error: `${username} ist unbekannt.` } }

  // Erst die Blockade, dann die Freundschaft lösen: die Blockade ist die
  // schützende Handlung, sie darf nicht von der Aufräumarbeit abhängen.
  const res = await write('toggleBlock', async () => {
    if (!nowBlocked) return supabase.from('blocks').delete().eq('blocker', _myUid).eq('blocked', uid)
    const r = await supabase.from('blocks').insert({ blocker: _myUid, blocked: uid })
    // 23505 = unique_violation: schon blockiert. Gewünschter Endzustand.
    return r.error?.code === '23505' ? { error: null } : r
  }, rollback)
  if (!res.ok) return { ...res, blocked: !nowBlocked }

  if (nowBlocked) {
    // Folge, nicht Voraussetzung: bleibt die Freundschaft stehen, gilt die
    // Blockade trotzdem — DMs stoppt bereits die Policy msg_insert_dm.
    const unfriend = await removeFriendPair(myName, username)
    if (!unfriend.ok) {
      return { ok: false, blocked: true, error: `${username} ist blockiert, die Freundschaft konnte aber nicht gelöst werden.` }
    }
  }
  return { ok: true, blocked: nowBlocked }
}

export function getIgnored() { return (_ignored[_myUsername] || []) }
export function isIgnored(username) { return getIgnored().some(x => x.toLowerCase() === username.toLowerCase()) }

/**
 * @returns {Promise<{ok: boolean, ignored: boolean, error?: string}>} `ignored`
 *   ist der Zustand, der jetzt tatsächlich gilt — im Fehlerfall der alte.
 */
export async function toggleIgnore(username) {
  const myName = _myUsername
  if (username.toLowerCase() === myName.toLowerCase()) return { ok: false, ignored: false, error: 'Du kannst dich nicht selbst ignorieren.' }
  const list = _ignored[myName] || []
  const idx  = list.findIndex(x => x.toLowerCase() === username.toLowerCase())
  const nowIgnored = idx < 0
  if (nowIgnored) list.push(username)
  else list.splice(idx, 1)
  _ignored[myName] = list
  const rollback = () => {
    if (nowIgnored) {
      const i = list.findIndex(x => x.toLowerCase() === username.toLowerCase())
      if (i >= 0) list.splice(i, 1)
    } else {
      list.splice(idx, 0, username)
    }
  }

  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_IGNORED, _ignored); return { ok: true, ignored: nowIgnored } }
  const uid = _usernameToUid(username)
  if (!uid) { rollback(); return { ok: false, ignored: !nowIgnored, error: `${username} ist unbekannt.` } }

  const res = await write('toggleIgnore', async () => {
    if (!nowIgnored) return supabase.from('ignores').delete().eq('ignorer', _myUid).eq('ignored', uid)
    const r = await supabase.from('ignores').insert({ ignorer: _myUid, ignored: uid })
    return r.error?.code === '23505' ? { error: null } : r   // schon ignoriert
  }, rollback)
  return res.ok ? { ok: true, ignored: nowIgnored } : { ...res, ignored: !nowIgnored }
}

/* ══════════════════════════════════════════════════════════════════
   NUTZER-MELDUNGEN
   ══════════════════════════════════════════════════════════════════ */

export async function reportUser(reported, reason, text) {
  const myName = _myUsername
  if (reported.toLowerCase() === myName.toLowerCase()) return { ok: false, error: 'Du kannst dich nicht selbst melden.' }
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  if (_userReports.some(r => r.from === myName && r.reported.toLowerCase() === reported.toLowerCase() && r.ts >= todayStart.getTime()))
    return { ok: false, error: 'Du hast diese Person heute bereits gemeldet.' }
  // `entry` statt `report`: report() ist der Sentry-Helfer aus monitoring.js.
  const entry = { id: 'ur-' + Date.now(), from: myName, reported, reason, text: text || '', ts: Date.now(), status: 'open' }
  _userReports.push(entry)
  const rollback = () => { _userReports = _userReports.filter(r => r.id !== entry.id) }
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_USER_REPORTS, _userReports); return { ok: true } }
  const uid = _usernameToUid(reported)
  // Vorher wurde ohne uid stumm { ok: true } gemeldet — die Meldung ging
  // nirgends hin, der Meldende bekam trotzdem eine Bestätigung.
  if (!uid) { rollback(); return { ok: false, error: `${reported} ist unbekannt.` } }
  return write('reportUser',
    () => supabase.from('user_reports').insert({ from_user: _myUid, reported: uid, reason, text: text || '' }),
    rollback)
}

/* ══════════════════════════════════════════════════════════════════
   DEMO-SEED (nur Offline-Modus)
   ══════════════════════════════════════════════════════════════════ */

export function seedGroupsIfEmpty(groups) {
  if (_groups.length === 0) {
    _groups = groups
    lsWrite(LS_GROUPS, _groups)
  }
}

export function seedFriendPairs(myName, friends) {
  if (OFFLINE_MODE) {
    friends.forEach(f => {
      if (!(_friends[myName] || []).includes(f.username)) {
        ;(_friends[myName] ||= []).push(f.username)
        ;(_friends[f.username] ||= []).push(myName)
      }
    })
    lsWrite(LS_FRIENDS, _friends)
  }
}

/* ── Nutzername-Suche (nur Offline, Online via Supabase-Query) ──── */
export async function searchUsersApi(query, { exclude = [] } = {}) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return []
  if (OFFLINE_MODE || !_myUid) {
    return searchUsers(q, { exclude })
  }
  const excl = new Set(exclude.map(x => x.toLowerCase()))
  const { data } = await supabase
    .from('profiles')
    .select('username')
    .ilike('username', `%${q}%`)
    .limit(8)
  return (data || [])
    .map(p => p.username)
    .filter(u => !excl.has(u.toLowerCase()))
}

export async function findUserApi(username) {
  if (OFFLINE_MODE || !_myUid) {
    return findUserByUsername(username)
  }
  const { data } = await supabase.from('profiles').select('username').ilike('username', username).maybeSingle()
  return data ? { username: data.username } : null
}

export function mutualGroupCount(username) {
  const myName = _myUsername
  return _groups.filter(g => g.members.includes(myName) && g.members.includes(username)).length
}
