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
let _remoteVideoEls = new Map() // identity -> HTMLVideoElement (Screen-Share)
let _localVideoEl = null        // eigener Screen-Share-Preview
let _preferredMicId = null
let _preferredSinkId = null
let _outVolume = 1              // 0…1, gilt für alle Remote-Audio-Elemente

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

  // Das LiveKit-Token wird serverseitig gegen die Supabase-Session ausgestellt
  // (api/livekit-token.js) — ohne Session gibt es keinen Talk-Zugang. `code`
  // mitgeben, damit das UI diesen Fall gezielt behandeln kann (Anmelde-Angebot)
  // statt die Fehlermeldung nach Text zu erraten.
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { ok: false, code: 'auth', error: 'Bitte melde dich an, um einem Talk beizutreten.' }

  let token
  try {
    const res = await fetch('/api/livekit-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ roomId }),
    })
    const body = await res.json().catch(() => ({}))
    // Statuscode mitgeben: ohne ihn sah ein 404 (Endpoint gar nicht da) im UI
    // exakt aus wie ein 403 (kein Zugriff) — beides nur "fehlgeschlagen".
    if (!res.ok) return { ok: false, error: body.error || `Talk-Zugang fehlgeschlagen (HTTP ${res.status}).` }
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
  _remoteVideoEls = new Map()
  _localVideoEl = null

  room
    .on(RoomEvent.ParticipantConnected, _notifyUpdate)
    .on(RoomEvent.ParticipantDisconnected, participant => {
      _remoteAudioEls.get(participant.identity)?.remove()
      _remoteAudioEls.delete(participant.identity)
      _remoteVideoEls.get(participant.identity)?.remove()
      _remoteVideoEls.delete(participant.identity)
      _notifyUpdate()
    })
    .on(RoomEvent.ActiveSpeakersChanged, _notifyUpdate)
    .on(RoomEvent.ConnectionQualityChanged, _notifyUpdate)
    .on(RoomEvent.TrackMuted, _notifyUpdate)
    .on(RoomEvent.TrackUnmuted, _notifyUpdate)
    .on(RoomEvent.LocalTrackPublished, publication => {
      if (publication.source === Track.Source.ScreenShare) {
        const el = publication.track.attach()
        el.autoplay = true; el.muted = true; el.playsInline = true
        _localVideoEl = el
      }
      _notifyUpdate()
    })
    .on(RoomEvent.LocalTrackUnpublished, publication => {
      if (publication.source === Track.Source.ScreenShare) {
        publication.track?.detach().forEach(el => el.remove())
        _localVideoEl = null
      }
      _notifyUpdate()
    })
    .on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach()
        el.style.display = 'none'
        el.muted = _deafened
        el.volume = _outVolume
        document.body.appendChild(el)
        _remoteAudioEls.set(participant.identity, el)
        _notifyUpdate()
        return
      }
      if (track.source === Track.Source.ScreenShare) {
        const el = track.attach()
        el.autoplay = true; el.playsInline = true
        _remoteVideoEls.set(participant.identity, el)
        _notifyUpdate()
      }
    })
    .on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      track.detach().forEach(el => el.remove())
      if (track.kind === Track.Kind.Audio) {
        _remoteAudioEls.delete(participant.identity)
      } else if (track.source === Track.Source.ScreenShare) {
        _remoteVideoEls.delete(participant.identity)
        _notifyUpdate()
      }
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

  // Mit dem Beitritt ist die Mikrofon-Freigabe erteilt: ab jetzt liefert
  // enumerateDevices() echte Gerätenamen, der Cache von vorher enthält noch
  // die namenlosen Einträge.
  invalidateAudioDeviceCache()

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

/**
 * Wiedergabelautstärke der anderen Teilnehmer setzen (0…100). Wirkt sofort auf
 * alle laufenden Streams und gilt auch für später dazukommende.
 */
export function setOutputVolume(percent) {
  _outVolume = Math.max(0, Math.min(100, Number(percent) || 0)) / 100
  for (const el of _remoteAudioEls.values()) el.volume = _outVolume
}

/** Kopfhörer deafen/undeafen (muted aller Remote-Streams + eigenes Mikro). */
export function toggleVoiceDeafen(deafened, muted) {
  _deafened = deafened
  for (const el of _remoteAudioEls.values()) el.muted = deafened
  toggleVoiceMute(muted)
}

/** Bildschirm teilen an-/ausschalten. */
export async function toggleScreenShare(enabled) {
  if (!_room) return { ok: false, error: 'Kein aktiver Talk.' }
  try {
    await _room.localParticipant.setScreenShareEnabled(enabled)
    return { ok: true }
  } catch (err) {
    // Nutzer hat den Browser-Auswahldialog abgebrochen — kein echter Fehler.
    if (err?.name === 'NotAllowedError') return { ok: false, cancelled: true }
    return { ok: false, error: 'Bildschirmfreigabe fehlgeschlagen.' }
  }
}

/**
 * Das <video>-Element für den Screen-Share einer Person holen (zum Einhängen
 * ins UI). `participantId` ist '__local' für die eigene Freigabe oder die
 * LiveKit-Identity aus dem onUpdate()-Callback von joinVoiceRoom().
 * @returns {HTMLVideoElement|null}
 */
export function getScreenShareEl(participantId) {
  if (participantId === '__local') return _localVideoEl
  return _remoteVideoEls.get(participantId) || null
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

/* Gerätelisten-Cache. enumerateDevices() selbst ist billig (~2 ms), aber
   LiveKits getLocalDevices() ruft bei fehlenden Gerätenamen intern
   getUserMedia() auf — das öffnet die Mikrofon-Abfrage und kostet spürbar
   Zeit, und zwar auch beim Ausgabegeräte-Menü. Das darf ein bloßes
   Menü-Öffnen nicht auslösen, deshalb wird ohne Berechtigungsanfrage
   gelesen und das Ergebnis gecacht. */
let _deviceCache = null
navigator.mediaDevices?.addEventListener?.('devicechange', () => { _deviceCache = null })

/** Cache verwerfen, z. B. nachdem die Mikrofon-Freigabe erteilt wurde (dann gibt es Namen). */
export function invalidateAudioDeviceCache() { _deviceCache = null }

/**
 * Verfügbare Audio-Geräte auflisten.
 * @param {{prompt?: boolean}} [opts] - prompt: true fordert die Berechtigung
 *   aktiv an (nur auf ausdrückliche Nutzeraktion), damit Gerätenamen sichtbar
 *   werden. Standard false: liefert sofort, ohne Berechtigungsdialog.
 * @returns {Promise<{inputs: MediaDeviceInfo[], outputs: MediaDeviceInfo[]}>}
 */
export async function listAudioDevices({ prompt = false } = {}) {
  if (_deviceCache && !prompt) return _deviceCache
  try {
    // Nacheinander statt parallel: zwei gleichzeitige getLocalDevices mit
    // prompt=true können zwei Berechtigungsabfragen auslösen.
    const inputs  = await Room.getLocalDevices('audioinput', prompt)
    const outputs = await Room.getLocalDevices('audiooutput', prompt)
    _deviceCache = { inputs, outputs }
    return _deviceCache
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
      quality: _room.localParticipant.connectionQuality,
      screenSharing: _room.localParticipant.isScreenShareEnabled,
    },
    ...Array.from(_room.remoteParticipants.values()).map(p => ({
      id: p.identity,
      username: p.name || p.identity,
      muted: !p.isMicrophoneEnabled,
      speaking: p.isSpeaking,
      quality: p.connectionQuality,
      screenSharing: p.isScreenShareEnabled,
    })),
  ]
  _onParticipantUpdate(participants)
}

function _cleanup() {
  if (!_room && !_roomId) return

  for (const el of _remoteAudioEls.values()) el.remove()
  _remoteAudioEls.clear()
  for (const el of _remoteVideoEls.values()) el.remove()
  _remoteVideoEls.clear()
  _localVideoEl?.remove()
  _localVideoEl = null

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
