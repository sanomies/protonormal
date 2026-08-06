// Carryable room lamps. The FBX room registers its point lights here;
// LocalPlayer drives pickup/carry/drop/toggle and Session applies remote
// updates. Like collision, deliberately a plain module: one room, one
// registry.
//
// A released lamp falls under gravity. The fall is simulated locally on
// every client from the same release point, so it needs no position stream.

import { Mesh, type MeshBasicMaterial, PointLight, Vector3 } from 'three'
import type { Vec3 } from '../../shared/protocol'
import { supportHeightAt } from './collision'

export interface LampSnapshot {
  i: number
  p: Vec3
  held: boolean
  on: boolean
}

interface LampEntry {
  light: PointLight
  // Parent-local target for remote carry interpolation, null when settled.
  remoteTarget: Vector3 | null
  // Vertical velocity while falling, null when at rest or held.
  fallVel: number | null
  on: boolean
  // Mounted fixtures (ceiling/wall lamps) can be toggled but not carried —
  // taking the light while its housing stays on the wall looks broken.
  fixed: boolean
  // Pure light sources without a bulb visual (Room adds no bulb to
  // free-floating lights): nothing to see, so nothing to grab or click.
  ghost: boolean
}

const GRAVITY = 9.8
// How far above its support surface (floor, tabletop…) a lamp rests.
const REST_OFFSET = 0.1
// Collision radius while carried/falling.
export const LAMP_RADIUS = 0.12
const BULB_ON = 0xff7a30
const BULB_OFF = 0x33221a

let lamps: LampEntry[] = []
// Index of the lamp the local player is carrying, -1 = none.
let carried = -1
// Last known state per lamp, re-announced when a new peer joins so their
// room matches ours (the DO itself is a stateless relay). Outlives the lamp
// registry: peers re-announce right when we join, which is usually before
// our copy of the room has finished loading.
const known = new Map<number, { p: Vec3; held: boolean; on: boolean }>()

const tmp = new Vector3()

export function setLamps(lights: PointLight[]): void {
  lamps = lights.map((light) => {
    light.getWorldPosition(tmp)
    const fixed = tmp.y > 2 || (light.parent as Mesh | null)?.isMesh === true
    const ghost = !light.children.some((c) => c.name === 'lampBulb')
    return { light, remoteTarget: null, fallVel: null, on: true, fixed, ghost }
  })
  carried = -1
  // Replay state that arrived while the model was still loading. Released
  // lamps get a zero-velocity fall: if they're already resting on their
  // support (floor or furniture) it lands immediately, otherwise it settles.
  // Mounted fixtures and pure sources only ever replay their on/off state —
  // their position is authored, not networked.
  for (const [i, s] of known) {
    const lamp = lamps[i]
    if (!lamp) continue
    applyOn(lamp, s.on)
    if (lamp.fixed || lamp.ghost) continue
    setWorldPos(lamp, s.p[0], s.p[1], s.p[2])
    if (!s.held) lamp.fallVel = 0
  }
}

// Full reset between room visits (setLamps([]) on unmount keeps `known`, so
// a React remount mid-session can't lose synced state).
export function resetLamps(): void {
  lamps = []
  carried = -1
  known.clear()
}

export function carriedLamp(): number {
  return carried
}

export function lampOn(i: number): boolean {
  return lamps[i]?.on ?? true
}

export function lampWorldPos(i: number): Vec3 | null {
  const lamp = lamps[i]
  if (!lamp) return null
  lamp.light.getWorldPosition(tmp)
  return [round3(tmp.x), round3(tmp.y), round3(tmp.z)]
}

// Nearest carryable lamp (fixtures excluded — they only respond to clicks).
export function nearestLampWithin(x: number, z: number, radius: number): number {
  let best = -1
  let bestD = radius * radius
  for (let i = 0; i < lamps.length; i++) {
    if (lamps[i]!.fixed || lamps[i]!.ghost) continue
    lamps[i]!.light.getWorldPosition(tmp)
    const dx = tmp.x - x
    const dz = tmp.z - z
    const d = dx * dx + dz * dz
    if (d < bestD) {
      best = i
      bestD = d
    }
  }
  return best
}

// The lamp closest to the aim ray (for click-to-toggle while pointer-locked).
const toLamp = new Vector3()
export function lampAlongRay(
  origin: Vector3,
  dir: Vector3,
  maxDist: number,
  maxOffAxis: number,
): number {
  let best = -1
  let bestOff = maxOffAxis
  for (let i = 0; i < lamps.length; i++) {
    if (lamps[i]!.ghost) continue
    lamps[i]!.light.getWorldPosition(tmp)
    toLamp.copy(tmp).sub(origin)
    const along = toLamp.dot(dir)
    if (along < 0.2 || along > maxDist) continue
    const offAxis = toLamp.addScaledVector(dir, -along).length()
    if (offAxis < bestOff) {
      best = i
      bestOff = offAxis
    }
  }
  return best
}

export function pickUp(i: number): LampSnapshot | null {
  const lamp = lamps[i]
  const p = lampWorldPos(i)
  if (!lamp || !p) return null
  carried = i
  lamp.remoteTarget = null
  lamp.fallVel = null
  known.set(i, { p, held: true, on: lamp.on })
  return { i, p, held: true, on: lamp.on }
}

export function dropCarried(): LampSnapshot | null {
  if (carried < 0) return null
  const i = carried
  carried = -1
  const lamp = lamps[i]
  const p = lampWorldPos(i)
  if (!lamp || !p) return null
  lamp.fallVel = 0
  known.set(i, { p, held: false, on: lamp.on })
  return { i, p, held: false, on: lamp.on }
}

export function toggleLamp(i: number): LampSnapshot | null {
  const lamp = lamps[i]
  const p = lampWorldPos(i)
  if (!lamp || !p) return null
  applyOn(lamp, !lamp.on)
  known.set(i, { p, held: carried === i, on: lamp.on })
  return { i, p, held: carried === i, on: lamp.on }
}

// Moves the carried lamp; world coords, converted into the (scaled) model
// space the light actually lives in.
export function setLampWorldPos(i: number, x: number, y: number, z: number): void {
  const lamp = lamps[i]
  if (!lamp) return
  setWorldPos(lamp, x, y, z)
}

export function applyRemoteLamp(i: number, p: Vec3, held: boolean, on: boolean): void {
  // Record even when the room hasn't loaded yet — setLamps replays it.
  known.set(i, { p, held, on })
  // Someone else grabbed it out of our hands — last picker wins.
  if (carried === i && held) carried = -1
  const lamp = lamps[i]
  if (!lamp) return
  applyOn(lamp, on)
  // Mounted fixtures and pure sources never move — a toggle event carries
  // held:false, which must not read as "released, let it fall".
  if (lamp.fixed || lamp.ghost) return
  if (held) {
    // Carried by a peer: ease toward the streamed position.
    lamp.fallVel = null
    tmp.set(p[0], p[1], p[2])
    lamp.light.parent?.worldToLocal(tmp)
    lamp.remoteTarget = (lamp.remoteTarget ?? new Vector3()).copy(tmp)
  } else {
    // Released: snap to the release point and let gravity take it. The fall
    // simulation lands it on whatever support is underneath.
    lamp.remoteTarget = null
    setWorldPos(lamp, p[0], p[1], p[2])
    lamp.fallVel = 0
  }
}

// Per-frame integration: eases remotely-carried lamps, drops falling ones.
export function updateLamps(dt: number): void {
  const k = 1 - Math.exp(-14 * dt)
  for (let i = 0; i < lamps.length; i++) {
    const lamp = lamps[i]!
    if (lamp.remoteTarget) {
      lamp.light.position.lerp(lamp.remoteTarget, k)
      // Model space is centimeters; snap within half a unit.
      if (lamp.light.position.distanceToSquared(lamp.remoteTarget) < 0.25) {
        lamp.light.position.copy(lamp.remoteTarget)
        lamp.remoteTarget = null
      }
      continue
    }
    if (lamp.fallVel === null) continue
    lamp.fallVel += GRAVITY * dt
    lamp.light.getWorldPosition(tmp)
    // Copy out before setWorldPos reuses the shared tmp vector.
    const wx = tmp.x
    const wz = tmp.z
    // Land on the highest surface underneath — tabletop, locker, or floor.
    const rest = supportHeightAt(wx, wz, tmp.y, LAMP_RADIUS) + REST_OFFSET
    const y = Math.max(rest, tmp.y - lamp.fallVel * dt)
    setWorldPos(lamp, wx, y, wz)
    if (y <= rest) {
      lamp.fallVel = null
      // Every client lands it at the same spot; record for re-announces.
      known.set(i, { p: [round3(wx), round3(rest), round3(wz)], held: false, on: lamp.on })
    }
  }
}

// Everything we know (touched lamps only), for catching up a new peer.
export function knownLamps(): LampSnapshot[] {
  const out: LampSnapshot[] = []
  for (const [i, s] of known) {
    // For the lamp in our hands, send where it is right now.
    const held = s.held && i === carried
    const p = held ? (lampWorldPos(i) ?? s.p) : s.p
    out.push({ i, p, held, on: s.on })
  }
  return out
}

function setWorldPos(lamp: LampEntry, x: number, y: number, z: number): void {
  tmp.set(x, y, z)
  lamp.light.parent?.worldToLocal(tmp)
  lamp.light.position.copy(tmp)
}

function applyOn(lamp: LampEntry, on: boolean): void {
  lamp.on = on
  const full = (lamp.light.userData.onIntensity as number | undefined) ?? lamp.light.intensity
  lamp.light.intensity = on ? full : 0
  const bulb = lamp.light.children.find((c) => c.name === 'lampBulb')
  if (bulb instanceof Mesh) (bulb.material as MeshBasicMaterial).color.setHex(on ? BULB_ON : BULB_OFF)
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}
