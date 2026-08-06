import type { SignalPayload, TrackRole } from '../../shared/protocol'
import type { AudioEngine } from '../audio/AudioEngine'
import { mungeInstrumentOpus } from './sdp'

// STUN only for v1: connects typical home NATs. Symmetric-NAT pairs need a
// TURN relay — designed in (pass different iceServers) but not deployed.
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] },
]

interface PeerConn {
  pc: RTCPeerConnection
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  settingRemoteAnswer: boolean
  micTx: RTCRtpTransceiver | null
  instrTx: RTCRtpTransceiver | null
  // Authoritative mid → role map for this connection, merged from both
  // sides' signaling metadata. Track order in SDP is unspecified; this isn't.
  midRoles: Record<string, TrackRole>
}

// Full mesh, one RTCPeerConnection per remote peer, at most 7. Each
// connection carries exactly two audio transceivers created in fixed order
// (mic, instrument), so after the initial offer/answer every later change —
// mute, instrument on/off, synth↔guitar switch — is replaceTrack() with no
// renegotiation. The perfect-negotiation skeleton stays as insurance.
export class PeerManager {
  private conns = new Map<string, PeerConn>()
  private micTrack: MediaStreamTrack | null = null
  private micStream: MediaStream | null = null
  private instrTrack: MediaStreamTrack | null = null
  private selfId = ''

  constructor(
    private sendSignal: (to: string, data: SignalPayload) => void,
    private audio: AudioEngine,
    private iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS,
  ) {}

  setSelfId(id: string): void {
    this.selfId = id
  }

  setMic(stream: MediaStream): void {
    this.micStream = stream
    this.micTrack = stream.getAudioTracks()[0] ?? null
    for (const conn of this.conns.values()) {
      void conn.micTx?.sender.replaceTrack(this.micTrack)
    }
  }

  setMicEnabled(enabled: boolean): void {
    if (this.micTrack) this.micTrack.enabled = enabled
  }

  setInstrumentTrack(track: MediaStreamTrack | null): void {
    this.instrTrack = track
    for (const conn of this.conns.values()) {
      void conn.instrTx?.sender.replaceTrack(track)
    }
  }

  // "The newcomer offers": we just joined and got the roster, so we offer to
  // every existing peer. Existing peers create their side lazily on our offer.
  connectToPeers(peerIds: string[]): void {
    for (const id of peerIds) this.initiate(id)
  }

  handleSignal(from: string, data: SignalPayload): void {
    void this.handleSignalAsync(from, data)
  }

  removePeer(peerId: string): void {
    const conn = this.conns.get(peerId)
    if (conn) {
      conn.pc.close()
      this.conns.delete(peerId)
    }
    this.audio.removePeer(peerId)
  }

  dispose(): void {
    for (const id of [...this.conns.keys()]) this.removePeer(id)
  }

  private initiate(peerId: string): void {
    const conn = this.newConn(peerId)
    // Fixed order defines the m-lines: index 0 mic, index 1 instrument. The
    // instrument slot exists even when nothing plays, so enabling it later
    // never renegotiates.
    conn.micTx = this.micTrack
      ? conn.pc.addTransceiver(this.micTrack, {
          direction: 'sendrecv',
          streams: this.micStream ? [this.micStream] : [],
        })
      : conn.pc.addTransceiver('audio', { direction: 'sendrecv' })
    conn.instrTx = this.instrTrack
      ? conn.pc.addTransceiver(this.instrTrack, { direction: 'sendrecv' })
      : conn.pc.addTransceiver('audio', { direction: 'sendrecv' })
    // addTransceiver queues onnegotiationneeded, which sends the offer.
  }

  private newConn(peerId: string): PeerConn {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers })
    const conn: PeerConn = {
      pc,
      // Any deterministic asymmetric rule works; ids are UUIDs.
      polite: this.selfId > peerId,
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswer: false,
      micTx: null,
      instrTx: null,
      midRoles: {},
    }
    this.conns.set(peerId, conn)

    pc.onicecandidate = (e) => {
      this.sendSignal(peerId, { kind: 'ice', candidate: e.candidate ? e.candidate.toJSON() : null })
    }

    pc.ontrack = (e) => {
      const mid = e.transceiver.mid
      const role: TrackRole = (mid != null ? conn.midRoles[mid] : undefined) ?? 'mic'
      const stream = e.streams[0] ?? new MediaStream([e.track])
      if (role === 'instrument' && 'jitterBufferTarget' in e.receiver) {
        // Trade a little resilience for latency on music (Chrome 124+/FF 115+).
        e.receiver.jitterBufferTarget = 40
      }
      this.audio.addRemoteTrack(peerId, role, stream)
    }

    pc.onnegotiationneeded = () => {
      void this.sendOffer(peerId, conn)
    }

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce()
    }

    return conn
  }

  private instrumentMid(conn: PeerConn): string | null {
    for (const [mid, role] of Object.entries(conn.midRoles)) {
      if (role === 'instrument') return mid
    }
    return null
  }

  private captureMids(conn: PeerConn): Record<string, TrackRole> {
    if (conn.micTx?.mid != null) conn.midRoles[conn.micTx.mid] = 'mic'
    if (conn.instrTx?.mid != null) conn.midRoles[conn.instrTx.mid] = 'instrument'
    return conn.midRoles
  }

  private async sendOffer(peerId: string, conn: PeerConn): Promise<void> {
    try {
      conn.makingOffer = true
      const offer = await conn.pc.createOffer()
      // Mids aren't assigned to transceivers until setLocalDescription, but
      // they already exist in the SDP text — and we created the instrument
      // transceiver second, so it's the second m-line. Find its mid there.
      let sdp = offer.sdp ?? ''
      const midFromSdp = secondAudioMid(sdp)
      if (midFromSdp != null) sdp = mungeInstrumentOpus(sdp, midFromSdp)
      await conn.pc.setLocalDescription({ type: 'offer', sdp })
      this.sendSignal(peerId, { kind: 'offer', sdp, mids: this.captureMids(conn) })
    } catch (err) {
      console.error('offer failed', err)
    } finally {
      conn.makingOffer = false
    }
  }

  private async handleSignalAsync(from: string, data: SignalPayload): Promise<void> {
    // Answerer side comes into existence on the first offer.
    const conn = this.conns.get(from) ?? this.newConn(from)
    const pc = conn.pc

    try {
      if (data.kind === 'ice') {
        try {
          await pc.addIceCandidate(data.candidate ?? undefined)
        } catch (err) {
          if (!conn.ignoreOffer) throw err
        }
        return
      }

      Object.assign(conn.midRoles, data.mids)
      const instrMid = this.instrumentMid(conn)

      if (data.kind === 'offer') {
        const readyForOffer =
          !conn.makingOffer && (pc.signalingState === 'stable' || conn.settingRemoteAnswer)
        conn.ignoreOffer = !conn.polite && !readyForOffer
        if (conn.ignoreOffer) return

        // Munging the REMOTE offer makes OUR encoder honor the params; the
        // remote munges our answer's copy on their side symmetrically.
        let sdp = data.sdp
        if (instrMid != null) sdp = mungeInstrumentOpus(sdp, instrMid)
        await pc.setRemoteDescription({ type: 'offer', sdp })

        this.adoptTransceivers(conn)
        const answer = await pc.createAnswer()
        let asdp = answer.sdp ?? ''
        if (instrMid != null) asdp = mungeInstrumentOpus(asdp, instrMid)
        await pc.setLocalDescription({ type: 'answer', sdp: asdp })
        this.sendSignal(from, { kind: 'answer', sdp: asdp, mids: this.captureMids(conn) })
      } else {
        conn.settingRemoteAnswer = true
        let sdp = data.sdp
        if (instrMid != null) sdp = mungeInstrumentOpus(sdp, instrMid)
        await pc.setRemoteDescription({ type: 'answer', sdp })
        conn.settingRemoteAnswer = false
      }
    } catch (err) {
      conn.settingRemoteAnswer = false
      console.error('signaling failed', err)
    }
  }

  // After setRemoteDescription(offer) the offer's m-lines exist as our
  // transceivers with direction recvonly. Claim them by role, attach our
  // tracks, and flip to sendrecv BEFORE answering, or we'd answer recv-only.
  private adoptTransceivers(conn: PeerConn): void {
    for (const tx of conn.pc.getTransceivers()) {
      if (tx.mid == null) continue
      const role = conn.midRoles[tx.mid]
      if (role === 'mic') {
        conn.micTx = tx
        tx.direction = 'sendrecv'
        void tx.sender.replaceTrack(this.micTrack)
      } else if (role === 'instrument') {
        conn.instrTx = tx
        tx.direction = 'sendrecv'
        void tx.sender.replaceTrack(this.instrTrack)
      }
    }
  }
}

function secondAudioMid(sdp: string): string | null {
  const lines = sdp.split('\r\n')
  let audioSections = 0
  let inSecond = false
  for (const line of lines) {
    if (line.startsWith('m=audio')) {
      audioSections++
      inSecond = audioSections === 2
    } else if (line.startsWith('m=')) {
      inSecond = false
    } else if (inSecond && line.startsWith('a=mid:')) {
      return line.slice('a=mid:'.length).trim()
    }
  }
  return null
}
