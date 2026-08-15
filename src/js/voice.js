/**
 * MotoMatch Voice — LiveKit-basierte Sprachkanäle
 *
 * Ersetzt das frühere handgebaute WebRTC-Mesh (RTCPeerConnection pro Teilnehmer
 * + eigenes Supabase-Broadcast-Signaling) durch LiveKit: ein SFU-Server relayt
 * Audio, statt dass jeder Client mit jedem einzeln verbindet. Das ist der
 * Unterschied zwischen "funktioniert bei zwei Leuten im selben WLAN" und
 * "funktioniert" — das alte Mesh hatte nie einen TURN-Server konfiguriert
 * (VITE_TURN_* war immer leer) und scheiterte damit hinter jedem symmetrischen
 * NAT (viele Firmen-/Mobilfunknetze). LiveKit bringt TURN, Reconnect-Handling,
 * Geräte-Umschaltung und Sprech-Erkennung serverseitig mit.
 *
 * Die "wer ist im Raum, ohne selbst beizutreten"-Anzeige (watchVoiceRoom) bleibt
 * unverändert auf Supabase-Realtime-Presence — sie ist unabhängig vom
 * Audio-Transport und funktioniert bereits korrekt.
 *
 * EINSCHRÄNKUNG: Ohne Supabase-Backend (OFFLINE_MODE) gibt es keinen Weg, ein
 * LiveKit-Token zu holen (der Token-Endpoint braucht eine echte Session) —
 * Sprachchat ist daher im Demo-/Offline-Modus nicht verfügbar.
 */

import { Room, RoomEvent, Track } from 'livekit-client'
import { supabase, OFFLINE_MODE } from './supabase.js'

/* ── State ─────────────────────────────────────────────────────────── */
let _room = null
let _roomId = null
let _myUsername = null
let _onParticipantUpdate = null
let _presenceChan = null        // leichter Presence-Eintrag für watchVoiceRoom(), s.u.
let _deafened = false
let _remoteAudioEls = new Map() // identity -> HTMLAudioElement
let _preferredMicId = null
let _preferredSinkId = null

/* ── Öffentliche API ────────────────────────────────────────────────── */

/**
 * Sprachraum beitreten.
 * @param {string} roomId  - ID des Sprachraums (== voice_rooms.id)
 * @param {string} userId  - eigene User-ID
 * @param {string} username - eigener Anzeigename
 * @param {{ muted: boolean, deafened: boolean }} prefs
 * @param {Function} onUpdate - callback mit aktueller Teilnehmerliste
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function joinVoiceRoom(roomId, userId, username, prefs, onUpdate) {
  if (_room) await leaveVoiceRoom()

  if (OFFLINE_MODE || !supabase) {
    return { ok: false, error: 'Sprachchat benötigt eine Online-Verbindung (im Demo-Modus nicht verfügbar).' }
  }

  const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL
  if (!LIVEKIT_URL) {
    return { ok: false, error: 'Sprachchat ist noch nicht konfiguriert.' }
  }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, error: 'Bitte melde dich an, um einem Talk beizutreten.' }

  let token
  try {
    const res = await fetch('/api/livekit-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ roomId }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: body.error || 'Talk-Zugang fehlgeschlagen.' }
    token = body.token
  } catch {
    return { ok: false, error: 'Talk-Zugang fehlgeschlagen (Netzwerkfehler).' }
  }

  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })

  _roomId = roomId
  _myUsername = username
  _onParticipantUpdate = onUpdate
  _deafened = !!prefs.deafened
  _remoteAudioEls = new Map()

  room
    .on(RoomEvent.ParticipantConnected, _notifyUpdate)
    .on(RoomEvent.ParticipantDisconnected, participant => {
      _remoteAudioEls.get(participant.identity)?.remove()
      _remoteAudioEls.delete(participant.identity)
      _notifyUpdate()
    })
    .on(RoomEvent.ActiveSpeakersChanged, _notifyUpdate)
    .on(RoomEvent.TrackMuted, _notifyUpdate)
    .on(RoomEvent.TrackUnmuted, _notifyUpdate)
    .on(RoomEvent.LocalTrackPublished, _notifyUpdate)
    .on(RoomEvent.LocalTrackUnpublished, _notifyUpdate)
    .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      // Nur Audio automatisch abspielen — Video (Screen-Share) hat noch keine
      // eigene Kachel-UI und wird hier bewusst nicht angehängt.
      if (track.kind !== Track.Kind.Audio) return
      const el = track.attach()
      el.style.display = 'none'
      el.muted = _deafened
      document.body.appendChild(el)
      _remoteAudioEls.set(participant.identity, el)
      _notifyUpdate()
    })
    .on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      track.detach().forEach(el => el.remove())
      _remoteAudioEls.delete(participant.identity)
    })
    .on(RoomEvent.Disconnected, () => _cleanup())

  try {
    await room.connect(LIVEKIT_URL, token)
    await room.localParticipant.setMicrophoneEnabled(!prefs.muted, {
      deviceId: _preferredMicId ? { ideal: _preferredMicId } : undefined,
    })
  } catch (err) {
    try { room.disconnect() } catch {}
    _roomId = null; _onParticipantUpdate = null
    if (err?.name === 'NotAllowedError' || /permission|denied/i.test(err?.message || '')) {
      return { ok: false, error: 'Mikrofon-Zugriff verweigert. Bitte erlaube Mikrofonzugriff im Browser.' }
    }
    return { ok: false, error: 'Verbindung zum Talk fehlgeschlagen. Bitte erneut versuchen.' }
  }

  _room = room

  // Leichter Presence-Eintrag auf demselben Kanal, den watchVoiceRoom() (Sidebar
  // ohne Beitritt) beobachtet — unabhängig vom LiveKit-Transport.
  _presenceChan = supabase.channel(`voice:${roomId}`, { config: { presence: { key: userId } } })
  _presenceChan.subscribe(async status => {
    if (status === 'SUBSCRIBED') await _presenceChan.track({ username, muted: !!prefs.muted })
  })

  _notifyUpdate()
  return { ok: true }
}

/** Sprachraum verlassen und alles aufräumen. */
export async function leaveVoiceRoom() {
  _cleanup()
}

/** Mikrofon stumm-/entstumm-schalten. */
export function toggleVoiceMute(muted) {
  if (!_room) return
  _room.localParticipant.setMicrophoneEnabled(!muted, {
    deviceId: _preferredMicId ? { ideal: _preferredMicId } : undefined,
  })
  _presenceChan?.track?.({ username: _myUsername, muted })
}

/** Kopfhörer deafen/undeafen (muted aller Remote-Streams + eigenes Mikro). */
export function toggleVoiceDeafen(deafened, muted) {
  _deafened = deafened
  for (const el of _remoteAudioEls.values()) el.muted = deafened
  toggleVoiceMute(muted)
}

/** Bildschirm teilen an-/ausschalten (Transport ist da — Video-Kachel-UI folgt separat). */
export async function toggleScreenShare(enabled) {
  if (!_room) return { ok: false, error: 'Kein aktiver Talk.' }
  try {
    await _room.localParticipant.setScreenShareEnabled(enabled)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Bildschirmfreigabe fehlgeschlagen.' }
  }
}

/** Sind wir aktuell in einem Raum? */
export function inVoiceRoom() { return !!_roomId }
export function currentRoomId() { return _roomId }

/* ── Reine Beobachtung eines Voice-Rooms (kein Mikrofon, kein LiveKit-Join) ──
   Nutzt denselben Presence-Channel wie ein echter Beitritt, tritt ihm aber
   nur passiv bei (kein .track()), damit auch Nicht-Teilnehmer live sehen,
   wer gerade im Call ist — z. B. während sie nur die Gruppenansicht offen
   haben. Mehrere Räume können gleichzeitig beobachtet werden. Unverändert
   gegenüber der Mesh-Implementierung — rein Presence-basiert, kein
   Audio-Transport beteiligt. */
let _watchers = {}  // { [roomId]: cleanupFn }

/**
 * Live-Teilnehmerliste eines Voice-Rooms beobachten, ohne selbst beizutreten.
 * @param {string} roomId
 * @param {Function} onUpdate - callback([{username, muted}])
 * @returns {Function} cleanup — muss beim Verlassen der Ansicht aufgerufen werden
 */
export function watchVoiceRoom(roomId, onUpdate) {
  if (_watchers[roomId]) _watchers[roomId].cleanup()

  const emit = state => {
    const participants = Object.values(state).flat().map(p => ({
      username: p.username, muted: !!p.muted,
    }))
    onUpdate(participants)
  }

  if (!OFFLINE_MODE && supabase) {
    const channel = supabase.channel(`voice:${roomId}`, {
      config: { presence: { key: 'watch-' + Math.random().toString(36).slice(2) } },
    })
    channel.on('presence', { event: 'sync' }, () => emit(channel.presenceState()))
    channel.subscribe()
    const cleanup = () => { try { supabase.removeChannel(channel) } catch {}; delete _watchers[roomId] }
    _watchers[roomId] = { cleanup }
    return cleanup
  }

  // Offline-Fallback: kein Presence verfügbar, Voice-Rooms sind im Demo-Modus
  // ohnehin nicht nutzbar (siehe joinVoiceRoom).
  onUpdate([])
  return () => {}
}

/** Alle aktiven Watcher aufräumen (z. B. beim Gruppen-/Ansichtswechsel). */
export function unwatchAllVoiceRooms() {
  for (const w of Object.values(_watchers)) w.cleanup()
  _watchers = {}
}

/**
 * Verfügbare Audio-Geräte auflisten. Nutzt LiveKits Helfer statt roher
 * enumerateDevices() — fragt bei Bedarf Berechtigungen an und filtert
 * Dummy-Geräte (leere deviceId vor erteilter Berechtigung).
 * @returns {Promise<{inputs: MediaDeviceInfo[], outputs: MediaDeviceInfo[]}>}
 */
export async function listAudioDevices() {
  try {
    const [inputs, outputs] = await Promise.all([
      Room.getLocalDevices('audioinput'),
      Room.getLocalDevices('audiooutput'),
    ])
    return { inputs, outputs }
  } catch {
    return { inputs: [], outputs: [] }
  }
}

/** Mikrofon wechseln (auch während eines laufenden Calls). */
export async function switchMicrophone(deviceId) {
  _preferredMicId = deviceId
  if (!_room) return
  try { await _room.switchActiveDevice('audioinput', deviceId) } catch {}
}

/**
 * Ausgabegerät wechseln (setSinkId, wo unterstützt).
 * @returns {boolean} true wenn erfolgreich
 */
export async function switchSpeaker(deviceId) {
  _preferredSinkId = deviceId
  if (!_room) return true
  try { return await _room.switchActiveDevice('audiooutput', deviceId) } catch { return false }
}

/* ── Private Implementierung ────────────────────────────────────────── */

function _notifyUpdate() {
  if (!_onParticipantUpdate || !_room) return
  const participants = [
    {
      id: '__local',
      username: _myUsername,
      muted: !_room.localParticipant.isMicrophoneEnabled,
      speaking: _room.localParticipant.isSpeaking,
    },
    ...Array.from(_room.remoteParticipants.values()).map(p => ({
      id: p.identity,
      username: p.name || p.identity,
      muted: !p.isMicrophoneEnabled,
      speaking: p.isSpeaking,
    })),
  ]
  _onParticipantUpdate(participants)
}

function _cleanup() {
  if (!_room && !_roomId) return

  for (const el of _remoteAudioEls.values()) el.remove()
  _remoteAudioEls.clear()

  if (_presenceChan) { try { supabase.removeChannel(_presenceChan) } catch {}; _presenceChan = null }

  const room = _room
  _room = null
  _roomId = null
  _myUsername = null
  _onParticipantUpdate = null
  _deafened = false

  if (room) { try { room.disconnect() } catch {} }
}

/* ── beforeunload: aufräumen beim Seitenwechsel ─────────────────────── */
window.addEventListener('beforeunload', () => { _cleanup() })
