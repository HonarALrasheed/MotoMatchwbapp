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

async function _loadProfiles() {
  const { data } = await supabase.from('profiles').select('*')
  if (!data) return
  _profileCache = {}
  for (const p of data) {
    _profileCache[p.username] = {
      displayName:    p.display_name,
      bio:            p.bio,
      statusText:     p.status_text,
      avatarColor:    p.avatar_color,
      avatarImg:      p.avatar,
      showBike:       p.show_bike,
      bikeText:       p.bike_text,
      dmPolicy:       p.dm_policy,
      showOnline:     p.show_online,
      notifySounds:   p.notif_sounds,
      notifyDesktop:  p.notif_desktop,
      _uid:           p.id,
    }
  }
}

async function _loadGroups() {
  const baseSelect = `
    id, name, description, category, join_mode, created_at,
    created_by:profiles!groups_created_by_fkey(username),
    channels(id, name, position),
    group_members(user_id, role, profiles(username)),
    group_bans(user_id, profiles!group_bans_user_id_fkey(username))
  `
  const voiceSelect = baseSelect + ', voice_rooms(id, title, capacity)'
  const eventSelect = voiceSelect + ', event_at, meeting_point, group_rsvps(profiles(username))'
  // event_at/meeting_point/group_rsvps und voice_rooms werden per Migration nachgerüstet
  // (supabase/schema.sql) — falls sie in dieser Supabase-Instanz noch fehlen, fällt der
  // Embed stufenweise sauber zurück, statt das komplette Gruppen-Laden zu blockieren
  // (siehe früherer group_bans-Bug).
  let { data: groups, error } = await supabase
    .from('groups').select(eventSelect).order('created_at', { ascending: false })
  if (error) {
    console.warn('[API] event_at/meeting_point/group_rsvps nicht ladbar (Migration evtl. noch nicht ausgeführt):', error.message)
    ;({ data: groups, error } = await supabase
      .from('groups').select(voiceSelect).order('created_at', { ascending: false }))
  }
  if (error) {
    console.warn('[API] voice_rooms nicht ladbar (Tabelle fehlt evtl. noch — Migration ausführen):', error.message)
    ;({ data: groups } = await supabase
      .from('groups').select(baseSelect).order('created_at', { ascending: false }))
  }
  if (!groups) return

  const allMsgs = {}
  if (groups.length) {
    const channelIds = groups.flatMap(g => (g.channels || []).map(c => c.id))
    if (channelIds.length) {
      let { data: msgs, error: msgsError } = await supabase
        .from('messages')
        .select('id, channel_id, author_id, text, reply_to_id, reactions, mentions, edited_at, created_at, profiles(username)')
        .in('channel_id', channelIds)
        .order('created_at', { ascending: true })
      if (msgsError) {
        // mentions-Spalte evtl. noch nicht migriert (supabase/schema.sql) — ohne
        // Fallback würde die komplette Nachrichten-Abfrage fehlschlagen, nicht nur
        // die Mention-Auflösung. Degradiert sauber statt den ganzen Chat leerzuräumen.
        console.warn('[API] mentions nicht ladbar (Migration evtl. noch nicht ausgeführt):', msgsError.message)
        ;({ data: msgs } = await supabase
          .from('messages')
          .select('id, channel_id, author_id, text, reply_to_id, reactions, edited_at, created_at, profiles(username)')
          .in('channel_id', channelIds)
          .order('created_at', { ascending: true }))
      }
      for (const m of (msgs || [])) {
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
      id: v.id, title: v.title, capacity: v.capacity, members: [],
    })),
    ...(g.event_at     ? { eventAt: new Date(g.event_at).getTime() } : {}),
    ...(g.meeting_point ? { meetingPoint: g.meeting_point } : {}),
    rsvp:       (g.group_rsvps || []).map(r => r.profiles?.username).filter(Boolean),
    messages:   [],
  }))
}

function _mapMessage(m) {
  return {
    id:       m.id,
    author:   m.profiles?.username || '?',
    text:     m.text,
    ts:       new Date(m.created_at).getTime(),
    reactions: m.reactions || {},
    ...(m.edited_at ? { editedTs: new Date(m.edited_at).getTime() } : {}),
    ...(m.reply_to_id ? { replyTo: { id: m.reply_to_id } } : {}),
    // Rohe uuids durchreichen, keine Username-Auflösung hier — _loadProfiles()
    // und _loadGroups() laufen parallel (initCommunityData), Auflösung an dieser
    // Stelle könnte je nach Timing leer laufen. Hervorhebung im UI nutzt ohnehin
    // text + aktuelle Mitgliederliste, nicht dieses Feld (s. renderText in community.js).
    ...(m.mentions?.length ? { mentions: m.mentions } : {}),
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
  const { data } = await supabase
    .from('messages')
    .select('id, dm_thread, author_id, text, reply_to_id, reactions, edited_at, created_at, profiles(username)')
    .not('dm_thread', 'is', null)
    .order('created_at', { ascending: true })
  _dms = {}
  for (const m of (data || [])) {
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
  const re = /(?<![\p{L}\p{N}_@-])@([\p{L}\p{N}_-]{1,32})/gu
  const lowerMembers = members.map(u => u.toLowerCase())
  const ids = new Set()
  let match
  while ((match = re.exec(text)) !== null) {
    const idx = lowerMembers.indexOf(match[1].toLowerCase())
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
  try { await chan.send({ type: 'broadcast', event, payload }) } catch {}
  if (!reused) { try { supabase.removeChannel(chan) } catch {} }
}

export function unsubscribeAll() {
  if (!supabase) return
  unsubscribePresence()
  unsubscribeGroupLiveUpdates()
  unsubscribeDMTyping()
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
    reactions: row.reactions || {},
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
  const patch = {
    text: row.text,
    reactions: row.reactions || {},
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
   PROFIL
   ══════════════════════════════════════════════════════════════════ */

/**
 * Community-Profil eines Nutzers — ergänzt um echten Namen/Avatar aus dem
 * zentralen Konto (auth.js), damit Community denselben Namen/dasselbe Bild
 * zeigt wie Account/Rest der Plattform:
 *  - eigenes Profil: immer live aus currentUser() (funktioniert online & offline,
 *    auch bevor die erste Synchronisierung mit Supabase durchgelaufen ist)
 *  - fremde Profile online: kommen aus der Supabase-`profiles`-Tabelle
 *    (avatar-Spalte, per _loadProfiles() synchron gehalten)
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
    lsWrite(LS_PROFILE, _profileCache); return
  }
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
  const { error } = await supabase.from('profiles').update(dbPatch).eq('id', _myUid)
  if (error?.code === 'PGRST204') {
    // `avatar`-Spalte fehlt noch (Migration aus supabase/schema.sql nicht ausgeführt) —
    // ohne sie erneut speichern, damit die übrigen Felder nicht mitscheitern.
    console.warn('[Community] Profilbild wird nicht gespeichert — Spalte `avatar` fehlt in Supabase. Siehe supabase/schema.sql.')
    const { avatar, ...rest } = dbPatch
    await supabase.from('profiles').update(rest).eq('id', _myUid)
  }
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
  let { data: gRow, error: gErr } = await supabase.from('groups').insert({
    name, description: desc, category, join_mode: joinMode || 'open', created_by: _myUid,
    event_at: eventAt ? new Date(eventAt).toISOString() : null,
    meeting_point: meetingPoint || null,
  }).select().single()
  if (gErr) {
    // Migration (event_at/meeting_point-Spalten) evtl. noch nicht ausgeführt — ohne die
    // Felder nochmal versuchen, statt die komplette Gruppenerstellung zu blockieren.
    ;({ data: gRow, error: gErr } = await supabase.from('groups').insert({
      name, description: desc, category, join_mode: joinMode || 'open', created_by: _myUid,
    }).select().single())
    if (!gErr) console.warn('[API] event_at/meeting_point nicht gespeichert (Migration evtl. noch nicht ausgeführt):', 'siehe supabase/schema.sql')
  }
  if (gErr) return { ok: false, error: gErr.message }

  // Muss VOR dem Channel-Insert passieren: die "channels_insert"-RLS-Policy verlangt
  // bereits einen group_members-Eintrag mit Rolle owner/mod für diese Gruppe.
  const { error: gmErr } = await supabase.from('group_members').insert({
    group_id: gRow.id, user_id: _myUid, role: 'owner',
  })
  if (gmErr) { await supabase.from('groups').delete().eq('id', gRow.id); return { ok: false, error: gmErr.message } }

  const { data: cRow, error: cErr } = await supabase.from('channels').insert({
    group_id: gRow.id, name: 'allgemein', position: 0,
  }).select().single()
  if (cErr) { await supabase.from('groups').delete().eq('id', gRow.id); return { ok: false, error: cErr.message } }

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
  _groups = _groups.filter(g => g.id !== groupId)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return }
  await supabase.from('groups').delete().eq('id', groupId)
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

  const room = { id: data.id, title: data.title, capacity: data.capacity, members: [] }
  ;(g.voiceRooms ||= []).push(room)
  _broadcastGroupLiveEvent(groupId, 'room_created', { room: { id: room.id, title: room.title, capacity: room.capacity } })
  return { ok: true, room }
}

export async function deleteVoiceRoom(groupId, roomId) {
  const g = _groups.find(x => x.id === groupId)
  if (g) g.voiceRooms = (g.voiceRooms || []).filter(r => r.id !== roomId)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return }
  await supabase.from('voice_rooms').delete().eq('id', roomId)
  _broadcastGroupLiveEvent(groupId, 'room_deleted', { roomId })
}

export async function updateGroup(groupId, patch) {
  const g = _groups.find(x => x.id === groupId)
  if (!g) return
  Object.assign(g, patch)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return }
  const dbPatch = {}
  if ('name'         in patch) dbPatch.name          = patch.name
  if ('desc'         in patch) dbPatch.description   = patch.desc
  if ('joinMode'     in patch) dbPatch.join_mode      = patch.joinMode
  if ('eventAt'      in patch) dbPatch.event_at       = patch.eventAt ? new Date(patch.eventAt).toISOString() : null
  if ('meetingPoint' in patch) dbPatch.meeting_point  = patch.meetingPoint || null
  if (!Object.keys(dbPatch).length) return

  const { error } = await supabase.from('groups').update(dbPatch).eq('id', groupId)
  if (error && ('event_at' in dbPatch || 'meeting_point' in dbPatch)) {
    // Migration (event_at/meeting_point-Spalten) evtl. noch nicht ausgeführt — Rest der
    // Änderung (Name/Beschreibung/Beitrittsmodus) trotzdem speichern.
    delete dbPatch.event_at; delete dbPatch.meeting_point
    console.warn('[API] event_at/meeting_point nicht gespeichert (Migration evtl. noch nicht ausgeführt):', 'siehe supabase/schema.sql')
    if (Object.keys(dbPatch).length) await supabase.from('groups').update(dbPatch).eq('id', groupId)
  }
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
  if (error) { g.members.pop(); return { ok: false, error: error.message } }
  return { ok: true }
}

export async function leaveGroup(groupId) {
  const g = _groups.find(x => x.id === groupId)
  if (!g) return
  g.members = g.members.filter(m => m !== _myUsername)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return }
  await supabase.from('group_members').delete()
    .eq('group_id', groupId).eq('user_id', _myUid)
}

export async function kickMember(groupId, username) {
  const g = _groups.find(x => x.id === groupId); if (!g) return
  g.members = g.members.filter(m => m.toLowerCase() !== username.toLowerCase())
  g.moderators = (g.moderators || []).filter(m => m.toLowerCase() !== username.toLowerCase())
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return }
  const uid = _usernameToUid(username); if (!uid) return
  await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', uid)
}

export async function banMember(groupId, username) {
  const g = _groups.find(x => x.id === groupId); if (!g) return
  g.members    = g.members.filter(m => m.toLowerCase() !== username.toLowerCase())
  g.moderators = (g.moderators || []).filter(m => m.toLowerCase() !== username.toLowerCase())
  g.banned     = Array.from(new Set([...(g.banned || []), username]))
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return }
  const uid = _usernameToUid(username); if (!uid) return
  await supabase.from('group_members').delete().eq('group_id', groupId).eq('user_id', uid)
  await supabase.from('group_bans').insert({ group_id: groupId, user_id: uid, banned_by: _myUid })
}

export async function unbanMember(groupId, username) {
  const g = _groups.find(x => x.id === groupId); if (!g) return
  g.banned = (g.banned || []).filter(b => b.toLowerCase() !== username.toLowerCase())
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return }
  const uid = _usernameToUid(username); if (!uid) return
  await supabase.from('group_bans').delete().eq('group_id', groupId).eq('user_id', uid)
}

export async function toggleMod(groupId, username) {
  const g = _groups.find(x => x.id === groupId); if (!g) return
  g.moderators = g.moderators || []
  const idx = g.moderators.findIndex(m => m.toLowerCase() === username.toLowerCase())
  const isMod = idx >= 0
  if (isMod) g.moderators.splice(idx, 1)
  else g.moderators.push(username)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return }
  const uid = _usernameToUid(username); if (!uid) return
  await supabase.from('group_members').update({ role: isMod ? 'member' : 'mod' })
    .eq('group_id', groupId).eq('user_id', uid)
}

export function isGroupBanned(g, username) {
  return (g.banned || []).some(b => b.toLowerCase() === username.toLowerCase())
}

export async function toggleRsvp(groupId) {
  const myName = _myUsername
  const g = _groups.find(x => x.id === groupId); if (!g) return
  g.rsvp = g.rsvp || []
  const idx = g.rsvp.findIndex(u => u.toLowerCase() === myName.toLowerCase())
  const wasOn = idx >= 0
  if (wasOn) g.rsvp.splice(idx, 1)
  else g.rsvp.push(myName)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return }

  if (wasOn) {
    const { error } = await supabase.from('group_rsvps').delete().eq('group_id', groupId).eq('user_id', _myUid)
    if (error) console.warn('[API] RSVP nicht gespeichert (group_rsvps evtl. noch nicht migriert):', error.message)
  } else {
    const { error } = await supabase.from('group_rsvps').insert({ group_id: groupId, user_id: _myUid })
    if (error) console.warn('[API] RSVP nicht gespeichert (group_rsvps evtl. noch nicht migriert):', error.message)
  }
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
  const g = _groups.find(x => x.id === groupId); if (!g) return
  g.channels = (g.channels || []).filter(c => c.id !== channelId)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return }
  await supabase.from('channels').delete().eq('id', channelId)
  _broadcastGroupLiveEvent(groupId, 'channel_deleted', { channelId })
}

/* ── Nachrichten in Gruppen ──────────────────────────────────────── */
export async function sendGroupMessage(groupId, channelId, text, replyTo = null, image = null) {
  const myName = _myUsername
  const g = _groups.find(x => x.id === groupId); if (!g) return { ok: false }
  const ch = g.channels?.find(c => c.id === channelId) || g.channels?.[0]; if (!ch) return { ok: false }

  if (OFFLINE_MODE || !_myUid) {
    const msg = {
      id: 'm-' + Date.now(), author: myName, text, ts: Date.now(), reactions: {},
      ...(replyTo ? { replyTo: { ...replyTo } } : {}),
      ...(image    ? { image }                   : {}),
    }
    ch.messages.push(msg); lsWrite(LS_GROUPS, _groups)
    return { ok: true, msg }
  }
  let { data, error } = await supabase.from('messages').insert({
    channel_id: ch.id, author_id: _myUid, text,
    reply_to_id: replyTo?.id || null,
    mentions: _resolveMentions(text, g.members || []),
  }).select().single()
  if (error?.code === '42703' || error?.code === 'PGRST204') {
    // mentions-Spalte evtl. noch nicht migriert (supabase/schema.sql) — ohne
    // Fallback könnte man gar keine Gruppennachrichten mehr senden, nicht nur
    // Mentions wären betroffen. 42703 = Postgres "undefined column" (SELECT-Pfad),
    // PGRST204 = PostgRESTs eigener Schema-Cache kennt die Spalte nicht (INSERT-Pfad).
    console.warn('[API] mentions nicht speicherbar (Migration evtl. noch nicht ausgeführt):', error.message)
    ;({ data, error } = await supabase.from('messages').insert({
      channel_id: ch.id, author_id: _myUid, text,
      reply_to_id: replyTo?.id || null,
    }).select().single())
  }
  if (error) return { ok: false, error: error.message }
  const msg = _mapMessage({ ...data, profiles: { username: myName } })
  // Realtime liefert die Nachricht zurück, aber wir fügen sie sofort ein (optimistic)
  if (!ch.messages.some(m => m.id === msg.id)) ch.messages.push(msg)
  return { ok: true, msg }
}

export async function editMessageInGroup(groupId, msgId, newText) {
  const g = _groups.find(x => x.id === groupId); if (!g) return
  let msg = null
  for (const ch of (g.channels || [])) { msg = ch.messages.find(m => m.id === msgId); if (msg) break }
  if (!msg) return
  msg.text = newText; msg.editedTs = Date.now()
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return }
  await supabase.from('messages').update({ text: newText, edited_at: new Date().toISOString() }).eq('id', msgId)
}

export async function deleteGroupMessage(groupId, msgId) {
  const g = _groups.find(x => x.id === groupId); if (!g) return
  for (const ch of (g.channels || [])) ch.messages = ch.messages.filter(m => m.id !== msgId)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); lsWrite(LS_MSG_REPORTS, _msgReports.filter(r => !(r.groupId === groupId && r.msgId === msgId))); return }
  await supabase.from('messages').delete().eq('id', msgId)
}

export async function toggleReactionInGroup(groupId, msgId, emoji) {
  const myName = _myUsername
  const g = _groups.find(x => x.id === groupId); if (!g) return
  let msg = null
  for (const ch of (g.channels || [])) { msg = ch.messages.find(x => x.id === msgId); if (msg) break }
  if (!msg) return
  if (!msg.reactions) msg.reactions = {}
  const users = msg.reactions[emoji] || []
  if (users.includes(myName)) {
    msg.reactions[emoji] = users.filter(u => u !== myName)
    if (!msg.reactions[emoji].length) delete msg.reactions[emoji]
  } else {
    msg.reactions[emoji] = [...users, myName]
  }
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); return }
  await supabase.from('messages').update({ reactions: msg.reactions }).eq('id', msgId)
}

/* ── Nachrichten-Meldungen ──────────────────────────────────────── */
export function getMsgReports() { return _msgReports }
export function reportsForGroup(groupId) { return _msgReports.filter(r => r.groupId === groupId) }

export async function reportMessage(groupId, msgId, msgAuthor, msgText, channelId = null) {
  const myName = _myUsername
  if (_msgReports.some(r => r.groupId === groupId && r.msgId === msgId && r.reportedBy === myName))
    return { ok: false, error: 'Du hast diese Nachricht bereits gemeldet.' }
  const report = { id: 'rp-' + Date.now(), groupId, channelId, msgId, msgAuthor, msgText, reportedBy: myName, ts: Date.now() }
  _msgReports.push(report)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_MSG_REPORTS, _msgReports); return { ok: true } }
  await supabase.from('message_reports').insert({
    message_id: msgId, group_id: groupId, reported_by: _myUid,
  })
  return { ok: true }
}

export async function dismissReport(reportId) {
  _msgReports = _msgReports.filter(r => r.id !== reportId)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_MSG_REPORTS, _msgReports); return }
  await supabase.from('message_reports').delete().eq('id', reportId)
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
  const { error } = await supabase.from('group_join_requests').insert({
    group_id: groupId, from_user: _myUid, text: text || '',
  })
  if (error) return { ok: false, error: error.message }
  _groupRequests.push({ id: 'gr-' + Date.now(), groupId, from: myName, text: text || '', ts: Date.now() })
  return { ok: true }
}

export async function acceptGroupRequest(reqId) {
  const r = _groupRequests.find(x => x.id === reqId); if (!r) return
  const g = _groups.find(x => x.id === r.groupId)
  if (g && !g.members.includes(r.from)) g.members.push(r.from)
  _groupRequests = _groupRequests.filter(x => x.id !== reqId)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); lsWrite(LS_GROUP_REQUESTS, _groupRequests); return }
  const uid = _usernameToUid(r.from)
  if (uid) await supabase.from('group_members').insert({ group_id: r.groupId, user_id: uid, role: 'member' })
  await supabase.from('group_join_requests').delete().eq('id', reqId)
}

export async function declineGroupRequest(reqId) {
  _groupRequests = _groupRequests.filter(x => x.id !== reqId)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUP_REQUESTS, _groupRequests); return }
  await supabase.from('group_join_requests').delete().eq('id', reqId)
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
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_INVITES, _invites); return inv }
  await supabase.from('invites').insert({
    code, group_id: groupId, created_by: _myUid,
    expires_at: inv.expiresAt ? new Date(inv.expiresAt).toISOString() : null,
    max_uses: inv.maxUses,
  })
  return inv
}

export async function revokeInvite(code) {
  _invites = _invites.filter(i => i.code !== code)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_INVITES, _invites); return }
  await supabase.from('invites').delete().eq('code', code)
}

export async function redeemInvite(rawCode) {
  const myName = _myUsername
  const inv = _invites.find(i => i.code.toLowerCase() === rawCode.toLowerCase())
  if (!inv) return { ok: false, error: 'Einladungscode unbekannt.' }
  if (inv.expiresAt && Date.now() > inv.expiresAt) return { ok: false, error: 'Dieser Einladungscode ist abgelaufen.' }
  if (inv.maxUses !== null && inv.uses >= inv.maxUses) return { ok: false, error: 'Dieser Einladungscode wurde bereits zu oft verwendet.' }
  const g = _groups.find(x => x.id === inv.groupId)
  if (!g) return { ok: false, error: 'Die Gruppe existiert nicht mehr.' }
  if (isGroupBanned(g, myName)) return { ok: false, error: 'Du wurdest aus dieser Gruppe gesperrt.' }
  if (g.members.some(m => m.toLowerCase() === myName.toLowerCase())) return { ok: false, error: 'Du bist bereits Mitglied dieser Gruppe.' }
  g.members.push(myName); inv.uses++
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_GROUPS, _groups); lsWrite(LS_INVITES, _invites); return { ok: true, group: g } }
  await supabase.from('group_members').insert({ group_id: g.id, user_id: _myUid, role: 'member' })
  await supabase.from('invites').update({ uses: inv.uses }).eq('code', rawCode)
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

export async function sendDM(to, text, replyTo = null, image = null) {
  const myName = _myUsername
  const blockedByRecipient = isBlockedBy(to)
  const ignoredByRecipient = (_ignored[to] || []).some(x => x.toLowerCase() === myName.toLowerCase())

  const msg = { id: 'd-' + Date.now(), author: myName, text, ts: Date.now() }
  if (replyTo) msg.replyTo = { ...replyTo }
  if (image)   msg.image   = image

  ;(_dms[myName] ||= {})[to] = [...((_dms[myName])[to] || []), msg]
  if (!blockedByRecipient) {
    ;(_dms[to] ||= {})[myName] = [...((_dms[to])[myName] || []), msg]
    if (!ignoredByRecipient) _markUnreadCache(to, myName)
  }

  if (OFFLINE_MODE || !_myUid) {
    lsWrite(LS_DMS, _dms); lsWrite(LS_UNREAD, _unread); return
  }
  if (blockedByRecipient) return
  const thread = _dmThread(myName, to)
  if (!thread) return
  const { data } = await supabase.from('messages').insert({
    dm_thread: thread, author_id: _myUid, text,
    reply_to_id: replyTo?.id || null,
  }).select().single()
  if (data) msg.id = data.id
}

export async function editMessageInDM(peer, msgId, newText) {
  const myName = _myUsername
  for (const [a, b] of [[myName, peer], [peer, myName]]) {
    const msg = (_dms[a]?.[b] || []).find(m => m.id === msgId)
    if (msg) { msg.text = newText; msg.editedTs = Date.now() }
  }
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_DMS, _dms); return }
  await supabase.from('messages').update({ text: newText, edited_at: new Date().toISOString() }).eq('id', msgId)
}

export async function deleteDMMessage(peer, msgId) {
  const myName = _myUsername
  for (const [a, b] of [[myName, peer], [peer, myName]]) {
    if (_dms[a]?.[b]) _dms[a][b] = _dms[a][b].filter(m => m.id !== msgId)
  }
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_DMS, _dms); return }
  await supabase.from('messages').delete().eq('id', msgId)
}

export async function toggleReactionInDM(peer, msgId, emoji) {
  const myName = _myUsername
  for (const [a, b] of [[myName, peer], [peer, myName]]) {
    const msg = (_dms[a]?.[b] || []).find(x => x.id === msgId)
    if (!msg) continue
    if (!msg.reactions) msg.reactions = {}
    const users = msg.reactions[emoji] || []
    if (users.includes(myName)) {
      msg.reactions[emoji] = users.filter(u => u !== myName)
      if (!msg.reactions[emoji].length) delete msg.reactions[emoji]
    } else {
      msg.reactions[emoji] = [...users, myName]
    }
  }
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_DMS, _dms); return }
  const thread = _dmThread(myName, peer)
  if (thread) {
    const msgObj = (_dms[myName]?.[peer] || []).find(x => x.id === msgId)
    if (msgObj) await supabase.from('messages').update({ reactions: msgObj.reactions }).eq('id', msgId)
  }
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
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_FRIENDS, _friends); return }
  const aUid = _usernameToUid(a); const bUid = _usernameToUid(b)
  if (!aUid || !bUid) { lsWrite(LS_FRIENDS, _friends); return }
  const [u1, u2] = [aUid, bUid].sort()
  await supabase.from('friendships').upsert({ user_a: u1, user_b: u2 })
}

export async function removeFriendPair(a, b) {
  _friends[a] = (_friends[a] || []).filter(x => x !== b)
  _friends[b] = (_friends[b] || []).filter(x => x !== a)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_FRIENDS, _friends); return }
  const aUid = _usernameToUid(a); const bUid = _usernameToUid(b)
  if (!aUid || !bUid) return
  const [u1, u2] = [aUid, bUid].sort()
  await supabase.from('friendships').delete().eq('user_a', u1).eq('user_b', u2)
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
    _requests = _requests.filter(r => r.id !== reverse.id)
    await _addFriendPair(myName, toUsername)
    if (OFFLINE_MODE || !_myUid) {
      lsWrite(LS_REQUESTS, _requests)
    } else {
      const toUid = _usernameToUid(toUsername)
      if (toUid) await supabase.from('friend_requests').delete().eq('id', reverse.id)
    }
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
  const r = _requests.find(x => x.id === id); if (!r) return
  _requests = _requests.filter(x => x.id !== id)
  await _addFriendPair(r.from, r.to)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_REQUESTS, _requests); return }
  await supabase.from('friend_requests').delete().eq('id', id)
}

export async function declineRequest(id) {
  _requests = _requests.filter(x => x.id !== id)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_REQUESTS, _requests); return }
  await supabase.from('friend_requests').delete().eq('id', id)
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

export async function toggleBlock(username) {
  const myName = _myUsername
  const list   = _blocked[myName] || []
  const idx    = list.findIndex(x => x.toLowerCase() === username.toLowerCase())
  const nowBlocked = idx < 0
  if (nowBlocked) {
    list.push(username)
    _blocked[myName] = list
    await removeFriendPair(myName, username)
  } else {
    list.splice(idx, 1)
    _blocked[myName] = list
  }
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_BLOCKED, _blocked); return nowBlocked }
  const uid = _usernameToUid(username)
  if (uid) {
    if (nowBlocked) await supabase.from('blocks').insert({ blocker: _myUid, blocked: uid })
    else await supabase.from('blocks').delete().eq('blocker', _myUid).eq('blocked', uid)
  }
  return nowBlocked
}

export function getIgnored() { return (_ignored[_myUsername] || []) }
export function isIgnored(username) { return getIgnored().some(x => x.toLowerCase() === username.toLowerCase()) }

export async function toggleIgnore(username) {
  if (username.toLowerCase() === _myUsername.toLowerCase()) return false
  const myName = _myUsername
  const list = _ignored[myName] || []
  const idx  = list.findIndex(x => x.toLowerCase() === username.toLowerCase())
  const nowIgnored = idx < 0
  if (nowIgnored) list.push(username)
  else list.splice(idx, 1)
  _ignored[myName] = list
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_IGNORED, _ignored); return nowIgnored }
  const uid = _usernameToUid(username)
  if (uid) {
    if (nowIgnored) await supabase.from('ignores').insert({ ignorer: _myUid, ignored: uid })
    else await supabase.from('ignores').delete().eq('ignorer', _myUid).eq('ignored', uid)
  }
  return nowIgnored
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
  const report = { id: 'ur-' + Date.now(), from: myName, reported, reason, text: text || '', ts: Date.now(), status: 'open' }
  _userReports.push(report)
  if (OFFLINE_MODE || !_myUid) { lsWrite(LS_USER_REPORTS, _userReports); return { ok: true } }
  const uid = _usernameToUid(reported)
  if (uid) await supabase.from('user_reports').insert({ from_user: _myUid, reported: uid, reason, text: text || '' })
  return { ok: true }
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
