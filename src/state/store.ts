import { create } from 'zustand'
import type { MidiInputInfo } from '../audio/midi'
import type { PresetId } from '../audio/synth/presets'

export type Phase = 'join' | 'connecting' | 'in-room'
export type InstrumentSource = 'none' | 'midi' | 'input'

export interface PeerUI {
  id: string
  nick: string
  micMuted: boolean
  instrumentOn: boolean
  // Local playback gain for this peer (applies to voice + instrument).
  volume: number
  localMuted: boolean
  speaking: boolean
}

export interface AppState {
  phase: Phase
  error: string | null
  selfId: string | null
  roomCode: string | null
  nick: string
  peers: Record<string, PeerUI>
  micMuted: boolean
  instrumentSource: InstrumentSource
  instrumentOn: boolean
  preset: PresetId
  monitor: boolean
  // null = not yet probed, false = unsupported/denied.
  midiAvailable: boolean | null
  midiInputs: MidiInputInfo[]
  // null = listen to all MIDI inputs.
  midiInputId: string | null
  // Timestamp of the last incoming MIDI message, for the activity dot.
  midiActivity: number
  // False while sampled instruments are still downloading.
  instrumentReady: boolean
  panelOpen: boolean
  // Camera field of view in degrees, user-adjustable from the menu.
  fov: number
  // PSX rendering is always on; this picks the heavier flavor (chunkier
  // pixels, wobblier verts, coarser color) over the default.
  psxHeavy: boolean
  // Drive the "E — pick up / put down lamp" hint.
  lampNearby: boolean
  carryingLamp: boolean
}

export const FOV_MIN = 60
export const FOV_MAX = 110
const FOV_DEFAULT = 90

function storedFov(): number {
  const v = Number(localStorage.getItem('bp:fov'))
  return Number.isFinite(v) && v >= FOV_MIN && v <= FOV_MAX ? v : FOV_DEFAULT
}

// Deliberately a dumb store: Session and the UI mutate it via setState, so
// there is a single writer path and no action indirection to trace through.
export const useStore = create<AppState>(() => ({
  phase: 'join',
  error: null,
  selfId: null,
  roomCode: null,
  nick: localStorage.getItem('bp:nick') ?? '',
  peers: {},
  micMuted: false,
  instrumentSource: 'none',
  instrumentOn: false,
  preset: 'grand-piano',
  monitor: true,
  midiAvailable: null,
  midiInputs: [],
  midiInputId: null,
  midiActivity: 0,
  instrumentReady: false,
  panelOpen: false,
  fov: storedFov(),
  psxHeavy: localStorage.getItem('bp:psx-heavy') === '1',
  lampNearby: false,
  carryingLamp: false,
}))

export function setFov(fov: number): void {
  const clamped = Math.min(FOV_MAX, Math.max(FOV_MIN, Math.round(fov)))
  localStorage.setItem('bp:fov', String(clamped))
  useStore.setState({ fov: clamped })
}

export function setPsxHeavy(psxHeavy: boolean): void {
  localStorage.setItem('bp:psx-heavy', psxHeavy ? '1' : '0')
  useStore.setState({ psxHeavy })
}

export function upsertPeer(peer: { id: string; nick: string }): void {
  useStore.setState((s) => ({
    peers: {
      ...s.peers,
      [peer.id]: s.peers[peer.id] ?? {
        id: peer.id,
        nick: peer.nick,
        micMuted: false,
        instrumentOn: false,
        volume: 1,
        localMuted: false,
        speaking: false,
      },
    },
  }))
}

export function patchPeer(id: string, patch: Partial<PeerUI>): void {
  useStore.setState((s) => {
    const peer = s.peers[id]
    if (!peer) return s
    return { peers: { ...s.peers, [id]: { ...peer, ...patch } } }
  })
}

export function removePeerFromStore(id: string): void {
  useStore.setState((s) => {
    const peers = { ...s.peers }
    delete peers[id]
    return { peers }
  })
}

export function resetToJoin(error: string | null): void {
  useStore.setState({
    phase: 'join',
    error,
    selfId: null,
    peers: {},
    panelOpen: false,
    instrumentOn: false,
    micMuted: false,
    lampNearby: false,
    carryingLamp: false,
  })
}
