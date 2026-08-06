import { Canvas, useThree } from '@react-three/fiber'
import { Suspense, useEffect } from 'react'
import { AgXToneMapping, PerspectiveCamera } from 'three'
import { useStore } from '../state/store'
import { LocalPlayer } from './LocalPlayer'
import { PostEffects, PsxVertexSnap } from './PsxEffects'
import { RemoteAvatar } from './RemoteAvatar'
import { Room } from './Room'
import { Smoke } from './Smoke'

// The Canvas camera prop is initial-only; this applies menu changes live.
function CameraFov(): null {
  const fov = useStore((s) => s.fov)
  const camera = useThree((s) => s.camera)
  useEffect(() => {
    if (camera instanceof PerspectiveCamera) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  }, [camera, fov])
  return null
}

export function Scene(): React.JSX.Element {
  const peers = useStore((s) => s.peers)
  const psx = useStore((s) => s.psx)
  return (
    <Canvas
      shadows
      // Low internal resolution + no AA: the buffer upscales to chunky PSX
      // pixels (styles.css sets image-rendering: pixelated on the canvas).
      dpr={psx ? 0.5 : [1, 2]}
      // AgX is what Blender renders with — soft, desaturating highlight
      // rolloff instead of ACES's hotter look.
      gl={{ antialias: false, toneMapping: AgXToneMapping, toneMappingExposure: 0.9 }}
      camera={{ fov: useStore.getState().fov, near: 0.1, far: 120, position: [0, 1.6, 3.5] }}
    >
      <color attach="background" args={['#0b0b10']} />
      {/* Fog ranges sit inside the 12 m room so haze is visible across it;
          the warm tint keeps it reading as smoke, not darkness. */}
      <fog attach="fog" args={['#170d07', 2.5, 20]} />
      {/* Whisper of fill standing in for the bounce light Blender gets from
          GI; the room's own lamps carry the lighting. */}
      <ambientLight intensity={0.11} color="#c9805a" />
      <CameraFov />
      <PsxVertexSnap />
      <PostEffects />
      <Suspense fallback={null}>
        <Room />
        <Smoke />
        <LocalPlayer />
        {Object.values(peers).map((peer) => (
          <RemoteAvatar key={peer.id} peer={peer} />
        ))}
      </Suspense>
    </Canvas>
  )
}
