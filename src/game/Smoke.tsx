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

function makeBlobTexture(): CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.35)')
  g.addColorStop(0.5, 'rgba(255,255,255,0.16)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
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
    const texture = makeBlobTexture()
    const geometry = new PlaneGeometry(1, 1)
    return Array.from({ length: COUNT }, (_, i) => {
      // Dim tint keeps even lamp-adjacent wisps below the bloom threshold.
      const baseOpacity = 0.045 + rand(i) * 0.045
      const material = new MeshLambertMaterial({
        color: 0x9a8d82,
        alphaMap: texture,
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
