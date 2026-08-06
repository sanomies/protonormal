// Wire protocol between the browser client and the RoomDO Durable Object.
// This file is compiled by BOTH tsconfig.app.json and tsconfig.worker.json,
// so it must not reference DOM-only or workerd-only types.

export const MAX_PLAYERS = 8
export const POSITION_SEND_HZ = 15
export const MAX_NICK_LENGTH = 24
export const ROOM_CODE_LENGTH = 5
// No 0/O, 1/I/L and no vowels, so codes stay unambiguous over voice and
// never spell anything unfortunate.
export const ROOM_CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXYZ23456789'
export const ROOM_CODE_RE = /^[BCDFGHJKMNPQRSTVWXYZ23456789]{5}$/

// WebSocket close codes (4xxx = application-defined). The server closes with
// these after accepting, because the browser WebSocket API can't read the
// status of a rejected HTTP upgrade.
export const CLOSE_ROOM_FULL = 4001

export function randomRoomCode(): string {
  const bytes = new Uint8Array(ROOM_CODE_LENGTH)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length]).join('')
}

export interface PeerInfo {
  id: string
  nick: string
}

export type Vec3 = [number, number, number]

export type TrackRole = 'mic' | 'instrument'

// Structural copy of the DOM's RTCIceCandidateInit — the worker tsconfig has
// no DOM lib, and the DO only relays this value opaquely anyway.
export interface IceCandidateInit {
  candidate?: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

// `mids` maps each SDP m-line's mid to what the sender is putting on that
// transceiver, so the receiver can route ontrack events without guessing.
export type SignalPayload =
  | { kind: 'offer'; sdp: string; mids: Record<string, TrackRole> }
  | { kind: 'answer'; sdp: string; mids: Record<string, TrackRole> }
  | { kind: 'ice'; candidate: IceCandidateInit | null }

// Lamps are identified by index (room lights sorted by name, so every client
// derives the same order from the same model). `held` distinguishes carrying
// (continuous position stream) from a release — a released lamp falls, and
// every client simulates the identical fall locally, so only the release
// point crosses the wire. `on` is the lamp's toggle state.
export type C2S =
  | { t: 'pos'; p: Vec3; ry: number }
  | { t: 'signal'; to: string; data: SignalPayload }
  | { t: 'state'; micMuted?: boolean; instrumentOn?: boolean }
  | { t: 'lamp'; i: number; p: Vec3; held: boolean; on: boolean }

export type S2C =
  | { t: 'welcome'; id: string; peers: PeerInfo[] }
  | { t: 'peer-joined'; peer: PeerInfo }
  | { t: 'peer-left'; id: string }
  | { t: 'pos'; id: string; p: Vec3; ry: number }
  | { t: 'signal'; from: string; data: SignalPayload }
  | { t: 'state'; id: string; micMuted?: boolean; instrumentOn?: boolean }
  | { t: 'lamp'; id: string; i: number; p: Vec3; held: boolean; on: boolean }
  | { t: 'error'; code: 'room-full' | 'bad-request'; message: string }
