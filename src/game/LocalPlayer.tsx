import { PointerLockControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { Vector3 } from 'three'
import { getSession } from '../session'
import { useStore } from '../state/store'
import {
  findFreeSpot,
  isBlocked,
  resolveMovement,
  resolveObjectMovement,
  supportHeightAt,
} from './collision'
import {
  carriedLamp,
  dropCarried,
  LAMP_RADIUS,
  lampAlongRay,
  lampOn,
  lampWorldPos,
  nearestLampWithin,
  pickUp,
  setLampWorldPos,
  toggleLamp,
  updateLamps,
} from './lamps'

const EYE_HEIGHT = 1.6
const RADIUS = 0.35
const SPEED = 4
const UP = new Vector3(0, 1, 0)
// Lamp carrying: how far you can grab from, and where the lamp rides.
const LAMP_REACH = 2
const CARRY_DIST = 0.7
const CARRY_DROP = 0.35

export function LocalPlayer(): React.JSX.Element {
  const keys = useRef<Record<string, boolean>>({})
  const vel = useRef(new Vector3())
  const fwd = useRef(new Vector3())
  const right = useRef(new Vector3())
  const aim = useMemo(() => new Vector3(), [])
  const camera = useThree((s) => s.camera)

  useEffect(() => {
    camera.position.set(0, EYE_HEIGHT, 3.5)
    const down = (e: KeyboardEvent): void => {
      keys.current[e.code] = true
      if (e.code === 'KeyE' && !e.repeat && document.pointerLockElement != null) {
        const session = getSession()
        const dropped = dropCarried()
        if (dropped) {
          session?.room.sendLampEvent(dropped.i, dropped.p, false, dropped.on)
        } else {
          const near = nearestLampWithin(camera.position.x, camera.position.z, LAMP_REACH)
          if (near >= 0) {
            const snap = pickUp(near)
            if (snap) session?.room.sendLampEvent(snap.i, snap.p, true, snap.on)
          }
        }
      }
    }
    // Click while locked = flick the lamp under the crosshair on/off.
    const click = (e: MouseEvent): void => {
      if (e.button !== 0 || document.pointerLockElement == null) return
      camera.getWorldDirection(aim)
      const i = lampAlongRay(camera.position, aim, 4, 0.4)
      if (i < 0) return
      const snap = toggleLamp(i)
      if (snap) getSession()?.room.sendLampEvent(snap.i, snap.p, snap.held, snap.on)
    }
    const up = (e: KeyboardEvent): void => {
      keys.current[e.code] = false
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('mousedown', click)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('mousedown', click)
    }
  }, [camera])

  useFrame((_, rawDt) => {
    // Tab-switch frames arrive with giant deltas; clamp so we don't teleport.
    const dt = Math.min(rawDt, 0.1)

    // The room model loads after spawn — if its furniture materialized on
    // top of us, step out to the nearest free spot instead of being stuck.
    if (isBlocked(camera.position.x, camera.position.z, RADIUS)) {
      const [fx, fz] = findFreeSpot(camera.position.x, camera.position.z, RADIUS)
      camera.position.x = fx
      camera.position.z = fz
    }
    const locked = document.pointerLockElement != null
    const k = keys.current
    const f = locked ? Number(k['KeyW'] ?? false) - Number(k['KeyS'] ?? false) : 0
    const s = locked ? Number(k['KeyD'] ?? false) - Number(k['KeyA'] ?? false) : 0

    camera.getWorldDirection(fwd.current)
    const fx = fwd.current.x
    const fz = fwd.current.z
    fwd.current.y = 0
    if (fwd.current.lengthSq() > 0) fwd.current.normalize()
    // fwd × up = the camera's right-hand direction.
    right.current.crossVectors(fwd.current, UP)

    const target = new Vector3()
      .addScaledVector(fwd.current, f)
      .addScaledVector(right.current, s)
    if (target.lengthSq() > 0) target.normalize().multiplyScalar(SPEED)

    // Exponential approach: snappy start, no instant stops.
    const blend = 1 - Math.exp(-12 * dt)
    vel.current.lerp(target, blend)

    const [nx, nz] = resolveMovement(
      camera.position.x,
      camera.position.z,
      vel.current.x * dt,
      vel.current.z * dt,
      RADIUS,
    )
    camera.position.set(nx, EYE_HEIGHT, nz)

    // Lamps: ease remotely-moved ones, drop falling ones, keep a carried one
    // riding in front of the camera, and surface the pickup hint.
    updateLamps(dt)
    const held = carriedLamp()
    if (held >= 0) {
      camera.getWorldDirection(fwd.current)
      const lx = camera.position.x + fwd.current.x * CARRY_DIST
      const ly = Math.min(2.7, Math.max(0.2, camera.position.y - CARRY_DROP + fwd.current.y * CARRY_DIST))
      const lz = camera.position.z + fwd.current.z * CARRY_DIST
      const cur = lampWorldPos(held)
      if (cur) {
        // Slide the lamp along walls and furniture at its carry height, and
        // keep it from being pushed down through whatever it hangs over.
        const [rx, rz] = resolveObjectMovement(
          cur[0],
          cur[2],
          lx - cur[0],
          lz - cur[2],
          LAMP_RADIUS,
          ly - LAMP_RADIUS,
          ly + LAMP_RADIUS,
        )
        const ry = Math.max(ly, supportHeightAt(rx, rz, cur[1] + 0.05, LAMP_RADIUS) + 0.1)
        setLampWorldPos(held, rx, ry, rz)
      }
      const p = lampWorldPos(held)
      if (p) getSession()?.room.updateCarriedLamp(held, p, lampOn(held))
    }
    const carrying = held >= 0
    const nearby =
      !carrying && nearestLampWithin(camera.position.x, camera.position.z, LAMP_REACH) >= 0
    const ui = useStore.getState()
    if (ui.carryingLamp !== carrying || ui.lampNearby !== nearby) {
      useStore.setState({ carryingLamp: carrying, lampNearby: nearby })
    }

    const session = getSession()
    if (session) {
      const yaw = Math.atan2(-fx, -fz)
      session.room.updateLocalPose(round3(nx), 0, round3(nz), round3(yaw))
      camera.getWorldDirection(fwd.current)
      session.audio.updateListener(
        nx,
        EYE_HEIGHT,
        nz,
        fwd.current.x,
        fwd.current.y,
        fwd.current.z,
        0,
        1,
        0,
      )
    }
  })

  return (
    <PointerLockControls
      onLock={() => useStore.setState({ panelOpen: false })}
      onUnlock={() => useStore.setState({ panelOpen: true })}
    />
  )
}

// Trim JSON payload size; sub-millimeter precision is noise.
function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}
