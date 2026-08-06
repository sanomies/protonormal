import { Billboard, Text } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { Color, type Group } from 'three'
import { getSession } from '../session'
import type { PeerUI } from '../state/store'
import { INTERP_DELAY_MS } from './interpolation'

// Audio sources sit at head height, not at the feet the avatar is placed by.
const HEAD_Y = 1.5

export function RemoteAvatar({ peer }: { peer: PeerUI }): React.JSX.Element {
  const group = useRef<Group>(null)

  const color = useMemo(() => {
    // Stable per-player color from the id.
    let hash = 0
    for (let i = 0; i < peer.id.length; i++) hash = (hash * 31 + peer.id.charCodeAt(i)) | 0
    return new Color().setHSL(((hash >>> 0) % 360) / 360, 0.55, 0.55)
  }, [peer.id])

  useFrame(() => {
    const session = getSession()
    const pose = session?.buffers.get(peer.id)?.sample(performance.now() - INTERP_DELAY_MS)
    if (!pose || !group.current) return
    group.current.position.set(pose.p[0], pose.p[1], pose.p[2])
    group.current.rotation.y = pose.ry
    session?.audio.updatePeerPosition(peer.id, pose.p[0], pose.p[1] + HEAD_Y, pose.p[2])
  })

  const label =
    peer.nick + (peer.micMuted ? ' (mic off)' : '') + (peer.instrumentOn ? ' ♪' : '')

  return (
    <group ref={group}>
      <mesh position={[0, 0.85, 0]}>
        <capsuleGeometry args={[0.28, 0.75, 6, 14]} />
        <meshStandardMaterial color={color} />
      </mesh>
      <mesh position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.19, 20, 14]} />
        <meshStandardMaterial color={color} />
      </mesh>
      {/* Flat "nose" so which way they face is readable at a glance. */}
      <mesh position={[0, 1.55, -0.17]}>
        <boxGeometry args={[0.07, 0.07, 0.1]} />
        <meshStandardMaterial color="#15151a" />
      </mesh>
      <Billboard position={[0, 2.15, 0]}>
        {peer.speaking && (
          <mesh position={[0, 0, -0.001]}>
            <circleGeometry args={[0.3, 24]} />
            <meshBasicMaterial color="#3ddc84" transparent opacity={0.25} />
          </mesh>
        )}
        <Text
          fontSize={0.17}
          color={peer.speaking ? '#3ddc84' : 'white'}
          outlineWidth={0.012}
          outlineColor="#000000"
          anchorY="middle"
        >
          {label}
        </Text>
      </Billboard>
    </group>
  )
}
