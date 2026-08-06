import { CLOSE_ROOM_FULL, type S2C } from '../shared/protocol'
import { AudioEngine } from './audio/AudioEngine'
import { InstrumentBus } from './audio/InstrumentBus'
import { MidiManager } from './audio/midi'
import { createInstrument, type PresetId } from './audio/synth/presets'
import type { Instrument } from './audio/synth/types'
import { SnapshotBuffer } from './game/interpolation'
import { applyRemoteLamp, knownLamps, resetLamps } from './game/lamps'
import { PeerManager } from './net/PeerManager'
import { RoomConnection } from './net/RoomConnection'
import {
  patchPeer,
  removePeerFromStore,
  resetToJoin,
  upsertPeer,
  useStore,
  type InstrumentSource,
} from './state/store'

export interface JoinOptions {
  code: string
  nick: string
  micDeviceId?: string
  instrumentSource: InstrumentSource
  instrumentDeviceId?: string
  // undefined/null = listen to all MIDI inputs.
  midiInputId?: string | null
  preset: PresetId
}

// Owns every non-React object for one visit to a room. The zustand store is
// the read model for the UI; this class is the single writer.
export class Session {
  readonly audio = new AudioEngine()
  readonly buffers = new Map<string, SnapshotBuffer>()
  readonly midi = new MidiManager()
  bus!: InstrumentBus
  peers!: PeerManager
  room!: RoomConnection
  instrument: Instrument | null = null
  private micStream: MediaStream | null = null
  private speakingTimer: ReturnType<typeof setInterval> | null = null
  private ended = false

  async join(opts: JoinOptions): Promise<void> {
    useStore.setState({
      phase: 'connecting',
      error: null,
      nick: opts.nick,
      roomCode: opts.code,
      instrumentSource: opts.instrumentSource,
      preset: opts.preset,
    })
    localStorage.setItem('bp:nick', opts.nick)

    await this.audio.resume()

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(opts.micDeviceId ? { deviceId: { exact: opts.micDeviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    const micTrack = this.micStream.getAudioTracks()[0]
    if (micTrack) micTrack.contentHint = 'speech'

    this.bus = new InstrumentBus(this.audio)
    this.peers = new PeerManager((to, data) => this.room.sendSignal(to, data), this.audio)
    this.peers.setMic(this.micStream)
    // Selection must land before init() attaches listeners.
    this.midi.setInput(opts.midiInputId ?? null)
    useStore.setState({ midiInputId: opts.midiInputId ?? null })
    await this.setInstrumentSource(opts.instrumentSource, opts.instrumentDeviceId)

    this.room = new RoomConnection({
      onMessage: (msg) => this.onMessage(msg),
      onClose: (code) => this.onSocketClose(code),
    })
    this.room.connect(opts.code, opts.nick)

    this.speakingTimer = setInterval(() => this.pollSpeaking(), 150)
  }

  private onMessage(msg: S2C): void {
    switch (msg.t) {
      case 'welcome': {
        useStore.setState({ phase: 'in-room', selfId: msg.id })
        this.peers.setSelfId(msg.id)
        for (const peer of msg.peers) {
          upsertPeer(peer)
          this.buffers.set(peer.id, new SnapshotBuffer())
        }
        this.peers.connectToPeers(msg.peers.map((p) => p.id))
        const s = useStore.getState()
        this.room.sendState({ micMuted: s.micMuted, instrumentOn: s.instrumentOn })
        break
      }
      case 'peer-joined': {
        upsertPeer(msg.peer)
        this.buffers.set(msg.peer.id, new SnapshotBuffer())
        // Their PC is created lazily when their offer arrives; re-announce our
        // state and pose so the newcomer's world is correct from the start.
        const s = useStore.getState()
        this.room.sendState({ micMuted: s.micMuted, instrumentOn: s.instrumentOn })
        this.room.nudgePose()
        // Lamps live client-side (the DO is stateless), so anyone who knows a
        // lamp's position repeats it; duplicates converge on the same values.
        for (const lamp of knownLamps()) {
          this.room.sendLampEvent(lamp.i, lamp.p, lamp.held, lamp.on)
        }
        break
      }
      case 'peer-left':
        this.peers.removePeer(msg.id)
        this.buffers.delete(msg.id)
        removePeerFromStore(msg.id)
        break
      case 'pos':
        this.buffers.get(msg.id)?.push(msg.p, msg.ry)
        break
      case 'signal':
        this.peers.handleSignal(msg.from, msg.data)
        break
      case 'state':
        patchPeer(msg.id, {
          ...(msg.micMuted !== undefined ? { micMuted: msg.micMuted } : {}),
          ...(msg.instrumentOn !== undefined ? { instrumentOn: msg.instrumentOn } : {}),
        })
        break
      case 'lamp':
        applyRemoteLamp(msg.i, msg.p, msg.held, msg.on)
        break
      case 'error':
        // The close that follows carries the code; nothing to do here.
        break
    }
  }

  private onSocketClose(code: number): void {
    const wasConnecting = useStore.getState().phase === 'connecting'
    const message =
      code === CLOSE_ROOM_FULL
        ? 'That room is full (8 players max).'
        : wasConnecting
          ? 'Could not connect to the room.'
          : 'Disconnected from the room.'
    this.terminate(message)
  }

  // ---- UI-facing controls ----

  setMicMuted(muted: boolean): void {
    // enabled=false keeps the track negotiated but sends silence — no
    // renegotiation, instant unmute.
    this.peers.setMicEnabled(!muted)
    useStore.setState({ micMuted: muted })
    this.room.sendState({ micMuted: muted })
  }

  setMonitor(on: boolean): void {
    this.bus.setMonitor(on)
    useStore.setState({ monitor: on })
  }

  setPeerVolume(id: string, volume: number): void {
    patchPeer(id, { volume })
    const peer = useStore.getState().peers[id]
    this.audio.setPeerLevel(id, volume, peer?.localMuted ?? false)
  }

  setPeerMuted(id: string, localMuted: boolean): void {
    patchPeer(id, { localMuted })
    const peer = useStore.getState().peers[id]
    this.audio.setPeerLevel(id, peer?.volume ?? 1, localMuted)
  }

  async setInstrumentSource(source: InstrumentSource, deviceId?: string): Promise<void> {
    this.instrument?.dispose()
    this.instrument = null
    this.midi.setHandlers(null)
    this.bus.clearSource()

    let on = false
    if (source === 'midi') {
      await this.initMidi()
      this.wireInstrument(useStore.getState().preset)
      // Synth players need to hear themselves; guitarists should
      // direct-monitor on their interface instead (lower latency).
      this.setMonitor(true)
      on = true
    } else if (source === 'input') {
      await this.bus.useInputDevice(deviceId)
      this.setMonitor(false)
      on = true
    }

    this.peers.setInstrumentTrack(on ? this.bus.track : null)
    useStore.setState({ instrumentSource: source, instrumentOn: on })
    this.room?.sendState({ instrumentOn: on })
  }

  setPreset(preset: PresetId): void {
    useStore.setState({ preset })
    if (useStore.getState().instrumentSource !== 'midi') return
    this.instrument?.dispose()
    this.wireInstrument(preset)
  }

  // For when the browser's MIDI permission prompt was missed or a keyboard
  // was plugged in late.
  async retryMidi(): Promise<void> {
    await this.initMidi()
  }

  setMidiInput(id: string | null): void {
    this.midi.setInput(id)
    useStore.setState({ midiInputId: id })
  }

  private async initMidi(): Promise<void> {
    this.midi.onActivity = () => {
      const last = useStore.getState().midiActivity
      const now = Date.now()
      // Throttle: playing sends dozens of messages a second.
      if (now - last > 250) useStore.setState({ midiActivity: now })
    }
    this.midi.onDevicesChanged = (inputs) => useStore.setState({ midiInputs: inputs })
    const available = await this.midi.init()
    useStore.setState({ midiAvailable: available, midiInputs: this.midi.inputs() })
  }

  private wireInstrument(preset: PresetId): void {
    useStore.setState({ instrumentReady: false })
    const instrument = createInstrument(this.audio.ctx, this.bus.gain, preset)
    this.instrument = instrument
    void instrument.ready.then(() => {
      // A quick preset flip may have superseded this instrument mid-load.
      if (this.instrument === instrument) useStore.setState({ instrumentReady: true })
    })
    this.midi.setHandlers({
      noteOn: (n, v) => this.instrument?.noteOn(n, v),
      noteOff: (n) => this.instrument?.noteOff(n),
      sustain: (s) => this.instrument?.setSustain(s),
      allNotesOff: () => this.instrument?.allNotesOff(),
    })
  }

  leave(): void {
    this.terminate(null)
  }

  private pollSpeaking(): void {
    const peers = useStore.getState().peers
    for (const id of Object.keys(peers)) {
      const speaking = this.audio.getMicLevel(id) > 0.015
      if (peers[id]!.speaking !== speaking) patchPeer(id, { speaking })
    }
  }

  private terminate(error: string | null): void {
    if (this.ended) return
    this.ended = true
    if (this.speakingTimer) clearInterval(this.speakingTimer)
    this.room?.close()
    this.peers?.dispose()
    this.midi.dispose()
    this.instrument?.dispose()
    this.bus?.dispose()
    if (this.micStream) for (const t of this.micStream.getTracks()) t.stop()
    void this.audio.dispose()
    this.buffers.clear()
    resetLamps()
    if (document.pointerLockElement) document.exitPointerLock()
    if (current === this) current = null
    resetToJoin(error)
  }
}

let current: Session | null = null

export function getSession(): Session | null {
  return current
}

export async function startSession(opts: JoinOptions): Promise<void> {
  if (current) return
  const session = new Session()
  current = session
  try {
    await session.join(opts)
  } catch (err) {
    current = null
    const message =
      err instanceof DOMException && err.name === 'NotAllowedError'
        ? 'Microphone access is required to join — allow it and try again.'
        : `Could not join: ${err instanceof Error ? err.message : String(err)}`
    // terminate() resets the store; pass the friendlier message after.
    try {
      session.leave()
    } catch {
      /* already torn down */
    }
    resetToJoin(message)
  }
}
