// Drifting smoke: a handful of big, faint, camera-facing planes with a
// procedural soft-blob alpha texture. Lambert material so the wisps pick up
// the lamps — smoke glows warm near a light and disappears into dark
// corners, instead of reading as flat gray sprites.

import { useFrame, useThree } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  CanvasTexture,
  Group,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
} from 'three'

const COUNT = 44
const BOUNDS = 5.2

interface Wisp {
  mesh: Mesh
  vx: number
  vz: number
  spin: number
  bobPhase: number
  baseY: number
  baseOpacity: number
}

// FBM value noise — turbulent interiors and irregular silhouettes are what
// separate smoke from "transparent circles" (standard procedural-cloud
// technique: noise-distorted boundary × fractal interior).
function hash2(x: number, y: number, seed: number): number {
  const v = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453
  return v - Math.floor(v)
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const sx = xf * xf * (3 - 2 * xf)
  const sy = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

function fbm(x: number, y: number, seed: number): number {
  let amp = 0.5
  let freq = 1
  let sum = 0
  for (let o = 0; o < 4; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 13.7)
    amp *= 0.5
    freq *= 2
  }
  return sum
}

const smoothstep = (e0: number, e1: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

function makeSmokeTexture(seed: number): CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(size, size)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px / size) * 2 - 1
      const v = (py / size) * 2 - 1
      const r = Math.hypot(u, v)
      // Noise-wobbled boundary radius — kills the circular silhouette.
      // Sampling in (cos, sin) space keeps it seamless around the rim.
      const cs = r > 1e-5 ? u / r : 1
      const sn = r > 1e-5 ? v / r : 0
      const edge = fbm(cs * 1.6 + seed, sn * 1.6 + seed * 1.3, seed)
      const radius = 0.5 + 0.4 * edge
      const mask = smoothstep(radius, radius * 0.35, r)
      // Turbulent interior, leveled so it has real structure.
      const body = smoothstep(0.32, 0.78, fbm(u * 2.4 + seed * 2.1, v * 2.4 + seed * 3.7, seed + 5))
      const alpha = mask * (0.25 + 0.75 * body)
      const i = (py * size + px) * 4
      img.data[i] = 255
      img.data[i + 1] = Math.round(alpha * 255)
      img.data[i + 2] = 255
      img.data[i + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return new CanvasTexture(canvas)
}

// Deterministic pseudo-random so every client shows similar smoke.
function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

export function Smoke(): React.JSX.Element {
  const group = useRef<Group>(null)
  const camera = useThree((s) => s.camera)

  const wisps = useMemo<Wisp[]>(() => {
    // A few baked variants so neighboring puffs never look identical.
    const textures = [1, 2, 3, 4, 5].map((s) => makeSmokeTexture(s * 17.31))
    const geometry = new PlaneGeometry(1, 1)
    return Array.from({ length: COUNT }, (_, i) => {
      // Dim tint keeps even lamp-adjacent wisps below the bloom threshold.
      const baseOpacity = 0.055 + rand(i) * 0.05
      const material = new MeshLambertMaterial({
        color: 0x9a8d82,
        alphaMap: textures[Math.floor(rand(i + 50) * textures.length)]!,
        transparent: true,
        opacity: baseOpacity,
        depthWrite: false,
      })
      const mesh = new Mesh(geometry, material)
      // Small overlapping puffs read as a haze layer, not visible discs.
      const scale = 1.3 + rand(i + 40) * 1.8
      mesh.scale.setScalar(scale)
      const baseY = 0.4 + rand(i + 60) * 1.7
      mesh.position.set(
        (rand(i + 10) * 2 - 1) * BOUNDS,
        baseY,
        (rand(i + 20) * 2 - 1) * BOUNDS,
      )
      return {
        mesh,
        vx: (rand(i + 70) - 0.5) * 0.16,
        vz: (rand(i + 80) - 0.5) * 0.16,
        spin: (rand(i + 90) - 0.5) * 0.1,
        bobPhase: rand(i + 30) * Math.PI * 2,
        baseY,
        baseOpacity,
      }
    })
  }, [])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    for (const w of wisps) {
      const p = w.mesh.position
      p.x += w.vx * dt
      p.z += w.vz * dt
      p.y = w.baseY + Math.sin(t * 0.13 + w.bobPhase) * 0.25
      // Drift out one side, wrap in on the other.
      if (p.x > BOUNDS) p.x = -BOUNDS
      if (p.x < -BOUNDS) p.x = BOUNDS
      if (p.z > BOUNDS) p.z = -BOUNDS
      if (p.z < -BOUNDS) p.z = BOUNDS
      // Billboard with a slow roll.
      w.mesh.quaternion.copy(camera.quaternion)
      w.mesh.rotateZ(t * w.spin)
      // Fade out wisps that drift onto the camera so they never blanket
      // the whole view.
      const dist = camera.position.distanceTo(p)
      const fade = Math.min(1, Math.max(0, (dist - 0.6) / 1.6))
      const mat = w.mesh.material as MeshLambertMaterial
      if (Math.abs(mat.opacity - w.baseOpacity * fade) > 0.002) {
        mat.opacity = w.baseOpacity * fade
      }
    }
  })

  return (
    <group ref={group}>
      {wisps.map((w, i) => (
        <primitive key={i} object={w.mesh} />
      ))}
    </group>
  )
}
