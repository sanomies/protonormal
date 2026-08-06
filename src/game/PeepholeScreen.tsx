import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  type PerspectiveCamera,
  SRGBColorSpace,
  VideoTexture,
} from 'three'
import { useStore } from '../state/store'
import videoUrl from '../video/door-eye-video.mp4'

// The peephole video, rendered inside the scene on a camera-attached plane
// so it goes through the whole PSX post chain (low-res, dither, saturation)
// like everything else. Contain-fit against the frustum, so the full frame
// is visible with black bars; opacity eases for the fade in/out and the
// audio fades with it.
const FADE_RATE = 5.5

export function PeepholeScreen(): React.JSX.Element {
  const open = useStore((s) => s.peepholeOpen)
  const group = useRef<Group>(null)
  const backdrop = useRef<Mesh>(null)
  const screen = useRef<Mesh>(null)
  const fade = useRef(0)

  const { video, materials } = useMemo(() => {
    const video = document.createElement('video')
    video.src = videoUrl
    video.loop = true
    video.playsInline = true
    const texture = new VideoTexture(video)
    texture.colorSpace = SRGBColorSpace
    const common = { transparent: true, opacity: 0, depthTest: false, depthWrite: false }
    const materials = {
      backdrop: new MeshBasicMaterial({ color: 0x000000, ...common }),
      screen: new MeshBasicMaterial({ map: texture, ...common }),
    }
    // The fullscreen quad must not wobble with the PSX vertex snap.
    materials.backdrop.defines = { PSX_NO_SNAP: '' }
    materials.screen.defines = { PSX_NO_SNAP: '' }
    return { video, materials }
  }, [])

  useEffect(() => {
    if (open) void video.play().catch(() => {})
  }, [open, video])
  useEffect(() => () => video.pause(), [video])

  useFrame(({ camera }, dt) => {
    const target = open ? 1 : 0
    fade.current += (target - fade.current) * (1 - Math.exp(-dt * FADE_RATE))
    if (!open && fade.current < 0.01) {
      fade.current = 0
      if (!video.paused) video.pause()
    }
    materials.backdrop.opacity = fade.current
    materials.screen.opacity = fade.current
    video.volume = Math.min(1, Math.max(0, fade.current))

    const g = group.current
    if (!g || !backdrop.current || !screen.current) return
    g.visible = fade.current > 0.005
    if (!g.visible) return
    // Ride the camera; fill the frustum at 1m.
    g.position.copy(camera.position)
    g.quaternion.copy(camera.quaternion)
    const cam = camera as PerspectiveCamera
    const h = 2 * Math.tan((cam.fov * Math.PI) / 360)
    const w = h * cam.aspect
    const aspect =
      video.videoWidth > 0 ? video.videoWidth / video.videoHeight : 16 / 9
    let sw = w
    let sh = w / aspect
    if (sh > h) {
      sh = h
      sw = h * aspect
    }
    backdrop.current.scale.set(w * 1.1, h * 1.1, 1)
    screen.current.scale.set(sw, sh, 1)
  })

  return (
    <group ref={group} visible={false}>
      <mesh ref={backdrop} material={materials.backdrop} position={[0, 0, -1.001]} renderOrder={90}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={screen} material={materials.screen} position={[0, 0, -1]} renderOrder={91}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  )
}
