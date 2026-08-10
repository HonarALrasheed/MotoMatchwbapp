/**
 * MotoMatch Voice — WebRTC P2P-Mesh für Sprachkanäle
 *
 * Signaling Online:  Supabase Realtime Broadcast pro Raum-ID
 * Signaling Offline: BroadcastChannel (gleicher Browser, mehrere Tabs)
 * STUN:              stun:stun.l.google.com:19302
 * TURN (optional):   VITE_TURN_URL / VITE_TURN_USER / VITE_TURN_CREDENTIAL
 *
 * EINSCHRÄNKUNG: Ohne TURN-Server scheitern Verbindungen hinter
 * symmetrischem NAT (viele Firmen-/Mobilnetze). TURN-Keys eintragen in .env:
 *   VITE_TURN_URL=turn:xxx.metered.ca:443?transport=tcp
 *   VITE_TURN_USER=...
 *   VITE_TURN_CREDENTIAL=...
 * Kostenlos z. B. bei https://dashboard.metered.ca (Free Tier reicht).
 */

import { supabase, OFFLINE_MODE } from './supabase.js'

/* ── ICE-Server-Konfiguration (STUN + optionaler TURN aus Env) ────── */
function _buildIceServers() {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }]
  const url  = import.meta.env.VITE_TURN_URL
  const user = import.meta.env.VITE_TURN_USER
  const cred = import.meta.env.VITE_TURN_CREDENTIAL
  if (url && user && cred) {
    servers.push({ urls: url, username: user, credential: cred })
    console.info('[Voice] TURN-Server konfiguriert:', url)
  }
  return servers
}

/* ── State ─────────────────────────────────────────────────────────── */
let _localStream = null
let _peers = {}           // { [peerId]: { pc: RTCPeerConnection, audio: HTMLAudioElement, analyser: AnalyserNode } }
let _sigChannel = null    // Supabase Realtime Channel ODER BroadcastChannel
let _bcChannel = null     // BroadcastChannel (Offline-Fallback)
let _roomId = null
let _myId = null          // userId (Supabase UID oder Fallback)
let _myUsername = null
let _onParticipantUpdate = null  // callback(participants: [{id, username, muted, speaking}])
let _speaking = {}        // { [peerId]: bool }
let _remoteMuted = {}     // { [peerId]: bool }
let _speakTimers = {}
let _audioCtx = null
let _localAnalyser = null
let _localSpeakTimer = null
let _preferredMicId = null
let _preferredSinkId = null

/* ── Öffentliche API ────────────────────────────────────────────────── */

/**
 * Sprachraum beitreten.
 * @param {string} roomId  - ID des Sprachraums
 * @param {string} userId  - eigene User-ID
 * @param {string} username - eigener Anzeigename
 * @param {{ muted: boolean, deafened: boolean }} prefs
 * @param {Function} onUpdate - callback mit aktueller Teilnehmerliste
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function joinVoiceRoom(roomId, userId, username, prefs, onUpdate) {
  if (_roomId) await leaveVoiceRoom()

  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: _preferredMicId ? { ideal: _preferredMicId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
  } catch (err) {
    return { ok: false, error: 'Mikrofon-Zugriff verweigert. Bitte erlaube Mikrofonzugriff im Browser.' }
  }

  _localStream = stream
  _roomId = roomId
  _myId = userId
  _myUsername = username
  _onParticipantUpdate = onUpdate
  _peers = {}
  _speaking = {}
  _remoteMuted = {}

  // Lautstärke-Analyse für lokales Mikrofon
  _setupLocalAnalyser(stream, prefs.muted)

  // Stummschalten initial anwenden
  _applyMute(prefs.muted)
  _applyDeafen(prefs.deafened)

  await _setupSignaling(roomId)

  // Anderen mitteilen, dass wir da sind → sie initiieren Offers zu uns
  _broadcast({ type: 'join', from: _myId, username: _myUsername, muted: !!prefs.muted })

  return { ok: true }
}

/** Sprachraum verlassen und alles aufräumen. */
export async function leaveVoiceRoom() {
  if (!_roomId) return
  _broadcast({ type: 'leave', from: _myId })
  _cleanup()
}

/** Mikrofon stumm-/entstumm-schalten. */
export function toggleVoiceMute(muted) {
  _applyMute(muted)
  _broadcast({ type: 'muted', from: _myId, muted })
}

/** Kopfhörer deafen/undeafen (muted aller Remote-Streams + eigenes Mikro). */
export function toggleVoiceDeafen(deafened, muted) {
  _applyDeafen(deafened)
  _applyMute(muted)
  _broadcast({ type: 'muted', from: _myId, muted })
}

/** Sind wir aktuell in einem Raum? */
export function inVoiceRoom() { return !!_roomId }
export function currentRoomId() { return _roomId }

/**
 * Verfügbare Audio-Geräte auflisten.
 * @returns {Promise<{inputs: MediaDeviceInfo[], outputs: MediaDeviceInfo[]}>}
 */
export async function listAudioDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return {
      inputs:  devices.filter(d => d.kind === 'audioinput'),
      outputs: devices.filter(d => d.kind === 'audiooutput'),
    }
  } catch {
    return { inputs: [], outputs: [] }
  }
}

/**
 * Mikrofon wechseln (auch während eines laufenden Calls).
 */
export async function switchMicrophone(deviceId) {
  _preferredMicId = deviceId
  if (!_localStream || !_roomId) return

  let newStream
  try {
    newStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
  } catch { return }

  const [newTrack] = newStream.getAudioTracks()
  const prefs = _getMuteState()
  newTrack.enabled = !prefs.muted

  // In alle Peer-Connections ersetzen
  for (const { pc } of Object.values(_peers)) {
    const sender = pc.getSenders().find(s => s.track?.kind === 'audio')
    if (sender) sender.replaceTrack(newTrack)
  }

  // Alten Track stoppen
  _localStream.getAudioTracks().forEach(t => t.stop())
  _localStream = newStream
  _setupLocalAnalyser(newStream, prefs.muted)
}

/**
 * Ausgabegerät wechseln (setSinkId, wo unterstützt).
 * @returns {boolean} true wenn erfolgreich
 */
export async function switchSpeaker(deviceId) {
  _preferredSinkId = deviceId
  let success = true
  for (const { audio } of Object.values(_peers)) {
    if (typeof audio.setSinkId === 'function') {
      try { await audio.setSinkId(deviceId) } catch { success = false }
    } else {
      success = false
    }
  }
  return success
}

/* ── Private Implementierung ────────────────────────────────────────── */

function _getMuteState() {
  const prefs = JSON.parse(localStorage.getItem('mm_comm_prefs_v1') || '{}')
  return { muted: !!prefs.muted, deafened: !!prefs.deafened }
}

function _applyMute(muted) {
  if (!_localStream) return
  _localStream.getAudioTracks().forEach(t => { t.enabled = !muted })
}

function _applyDeafen(deafened) {
  for (const { audio } of Object.values(_peers)) {
    audio.muted = deafened
  }
}

async function _setupSignaling(roomId) {
  if (!OFFLINE_MODE && supabase) {
    await _setupSupabaseSignaling(roomId)
  } else {
    _setupBroadcastChannelSignaling(roomId)
  }
}

async function _setupSupabaseSignaling(roomId) {
  const channelName = `voice:${roomId}`
  _sigChannel = supabase.channel(channelName, {
    config: { broadcast: { self: false }, presence: { key: _myId } },
  })

  _sigChannel
    .on('broadcast', { event: 'signal' }, ({ payload }) => _handleSignal(payload))
    .on('presence', { event: 'join' }, ({ newPresences }) => {
      for (const p of newPresences) {
        if (p.key !== _myId) _notifyUpdate()
      }
    })
    .on('presence', { event: 'leave' }, ({ leftPresences }) => {
      for (const p of leftPresences) {
        if (p.key !== _myId) {
          _removePeer(p.key)
          _notifyUpdate()
        }
      }
    })

  await _sigChannel.subscribe(async status => {
    if (status !== 'SUBSCRIBED') return
    await _sigChannel.track({ username: _myUsername, muted: _getMuteState().muted })
  })
}

/* BroadcastChannel-Signaling für lokale Zwei-Tab-Tests (kein Backend nötig).
   Alle Tabs im gleichen Browser und gleicher Origin empfangen die Nachrichten. */
function _setupBroadcastChannelSignaling(roomId) {
  _bcChannel = new BroadcastChannel(`mm-voice:${roomId}`)
  _bcChannel.onmessage = ({ data }) => _handleSignal(data)
  console.info('[Voice] BroadcastChannel-Signaling aktiv (lokaler Zwei-Tab-Test).')
}

function _broadcast(payload) {
  if (_bcChannel) {
    _bcChannel.postMessage(payload)
  } else if (_sigChannel) {
    _sigChannel.send({ type: 'broadcast', event: 'signal', payload })
  }
}

async function _handleSignal(msg) {
  if (!msg || msg.from === _myId) return

  switch (msg.type) {
    case 'join': {
      // Neuer Teilnehmer → wir machen ein Offer
      const pc = await _createPeer(msg.from, msg.username)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      _broadcast({ type: 'offer', from: _myId, to: msg.from, sdp: offer, username: _myUsername })
      if (msg.muted != null) _remoteMuted[msg.from] = msg.muted
      _notifyUpdate()
      break
    }
    case 'offer': {
      if (msg.to !== _myId) return
      const pc = await _createPeer(msg.from, msg.username)
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      _broadcast({ type: 'answer', from: _myId, to: msg.from, sdp: answer })
      break
    }
    case 'answer': {
      if (msg.to !== _myId) return
      const peer = _peers[msg.from]
      if (peer) await peer.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
      break
    }
    case 'ice': {
      if (msg.to !== _myId) return
      const peer = _peers[msg.from]
      if (peer && msg.candidate) {
        try { await peer.pc.addIceCandidate(new RTCIceCandidate(msg.candidate)) } catch {}
      }
      break
    }
    case 'muted': {
      _remoteMuted[msg.from] = !!msg.muted
      _notifyUpdate()
      break
    }
    case 'leave': {
      _removePeer(msg.from)
      _notifyUpdate()
      break
    }
  }
}

async function _createPeer(peerId, peerUsername) {
  if (_peers[peerId]) return _peers[peerId].pc

  const pc = new RTCPeerConnection({ iceServers: _buildIceServers() })

  // Lokalen Track hinzufügen
  if (_localStream) {
    _localStream.getAudioTracks().forEach(t => pc.addTrack(t, _localStream))
  }

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      _broadcast({ type: 'ice', from: _myId, to: peerId, candidate: candidate.toJSON() })
    }
  }

  const audio = document.createElement('audio')
  audio.autoplay = true
  audio.style.display = 'none'
  document.body.appendChild(audio)

  // Ausgabegerät anwenden, falls bereits gewählt
  if (_preferredSinkId && typeof audio.setSinkId === 'function') {
    try { await audio.setSinkId(_preferredSinkId) } catch {}
  }

  // Deafen-Status anwenden
  const { deafened } = _getMuteState()
  audio.muted = deafened

  let analyser = null

  pc.ontrack = ({ streams }) => {
    const stream = streams[0]
    if (!stream) return
    audio.srcObject = stream
    analyser = _setupRemoteAnalyser(stream, peerId)
    _peers[peerId] = { ...(_peers[peerId] || {}), pc, audio, analyser }
    _notifyUpdate()
  }

  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
      _removePeer(peerId)
      _notifyUpdate()
    }
  }

  _peers[peerId] = { pc, audio, analyser, username: peerUsername }
  return pc
}

function _removePeer(peerId) {
  const peer = _peers[peerId]
  if (!peer) return
  try { peer.pc.close() } catch {}
  peer.audio.srcObject = null
  peer.audio.remove()
  clearInterval(_speakTimers[peerId])
  delete _peers[peerId]
  delete _speaking[peerId]
  delete _remoteMuted[peerId]
  delete _speakTimers[peerId]
}

function _setupRemoteAnalyser(stream, peerId) {
  try {
    if (!_audioCtx) _audioCtx = new AudioContext()
    const src = _audioCtx.createMediaStreamSource(stream)
    const analyser = _audioCtx.createAnalyser()
    analyser.fftSize = 512
    src.connect(analyser)
    const buf = new Uint8Array(analyser.frequencyBinCount)

    const timer = setInterval(() => {
      analyser.getByteFrequencyData(buf)
      const vol = buf.reduce((a, b) => a + b, 0) / buf.length
      const isSpeaking = vol > 8
      if (_speaking[peerId] !== isSpeaking) {
        _speaking[peerId] = isSpeaking
        _notifyUpdate()
      }
    }, 100)
    _speakTimers[peerId] = timer
    return analyser
  } catch {
    return null
  }
}

function _setupLocalAnalyser(stream, muted) {
  try {
    if (!_audioCtx) _audioCtx = new AudioContext()
    if (_localSpeakTimer) clearInterval(_localSpeakTimer)
    const src = _audioCtx.createMediaStreamSource(stream)
    _localAnalyser = _audioCtx.createAnalyser()
    _localAnalyser.fftSize = 512
    src.connect(_localAnalyser)
    const buf = new Uint8Array(_localAnalyser.frequencyBinCount)

    _localSpeakTimer = setInterval(() => {
      if (_getMuteState().muted) { _speaking['__local'] = false; return }
      _localAnalyser.getByteFrequencyData(buf)
      const vol = buf.reduce((a, b) => a + b, 0) / buf.length
      const isSpeaking = vol > 8
      if (_speaking['__local'] !== isSpeaking) {
        _speaking['__local'] = isSpeaking
        _notifyUpdate()
      }
    }, 100)
  } catch {}
}

function _notifyUpdate() {
  if (!_onParticipantUpdate) return
  const participants = [
    { id: '__local', username: _myUsername, muted: _getMuteState().muted, speaking: !!_speaking['__local'] },
    ...Object.entries(_peers).map(([id, p]) => ({
      id,
      username: p.username || id,
      muted: !!_remoteMuted[id],
      speaking: !!_speaking[id],
    })),
  ]
  _onParticipantUpdate(participants)
}

function _cleanup() {
  if (_localSpeakTimer) clearInterval(_localSpeakTimer)
  for (const id of Object.keys(_peers)) _removePeer(id)

  if (_localStream) {
    _localStream.getTracks().forEach(t => t.stop())
    _localStream = null
  }

  if (_sigChannel) {
    _sigChannel.unsubscribe()
    _sigChannel = null
  }
  if (_bcChannel) {
    _bcChannel.close()
    _bcChannel = null
  }

  _roomId = null
  _myId = null
  _myUsername = null
  _onParticipantUpdate = null
  _speaking = {}
  _remoteMuted = {}
}

/* ── beforeunload: aufräumen beim Seitenwechsel ─────────────────────── */
window.addEventListener('beforeunload', () => {
  if (_roomId) {
    _broadcast({ type: 'leave', from: _myId })
    _cleanup()
  }
})
