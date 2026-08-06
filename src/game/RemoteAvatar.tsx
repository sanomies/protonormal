import { Billboard, Text } from '@react-three/drei'
import { useFrame, useLoader } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import {
  DoubleSide,
  type Group,
  type Mesh,
  MeshLambertMaterial,
  NearestFilter,
  SRGBColorSpace,
  TextureLoader,
} from 'three'
import { getSession } from '../session'
import type { PeerUI } from '../state/store'
import { INTERP_DELAY_MS } from './interpolation'
import backUrl from '../assets/characters/sano/sanoman-back.png'
import frontUrl from '../assets/characters/sano/sanoman-front.png'
import sideUrl from '../assets/characters/sano/sanoman-side.png'

// Audio sources sit at head height, not at the feet the avatar is placed by.
const HEAD_Y = 1.5
const SPRITE_HEIGHT = 1.85

// DOOM-style sprite character: a flat plane that always faces the viewer,
// swapping between front/back/side artwork depending on which way the
// player is facing relative to the line of sight. The side art faces
// screen-left; it's mirrored when the player faces the other way.
export function RemoteAvatar({ peer }: { peer: PeerUI }): React.JSX.Element {
  const group = useRef<Group>(null)
  const sprite = useRef<Mesh>(null)

  const [front, back, side] = useLoader(TextureLoader, [frontUrl, backUrl, sideUrl])
  const materials = useMemo(() => {
    for (const t of [front, back, side]) {
      t.colorSpace = SRGBColorSpace
      t.magFilter = NearestFilter
    }
    const make = (map: typeof front): MeshLambertMaterial =>
      new MeshLambertMaterial({ map, alphaTest: 0.5, side: DoubleSide })
    return { front: make(front), back: make(back), side: make(side) }
  }, [front, back, side])
  const width = SPRITE_HEIGHT * (front.image.width / front.image.height)

  useFrame(({ camera }) => {
    const session = getSession()
    const pose = session?.buffers.get(peer.id)?.sample(performance.now() - INTERP_DELAY_MS)
    if (!pose || !group.current || !sprite.current) return
    group.current.position.set(pose.p[0], pose.p[1], pose.p[2])
    session?.audio.updatePeerPosition(peer.id, pose.p[0], pose.p[1] + HEAD_Y, pose.p[2])

    // Cylindrical billboard: the plane yaws toward the camera but stays
    // upright, so it never tilts when viewed from above.
    const dx = camera.position.x - pose.p[0]
    const dz = camera.position.z - pose.p[2]
    sprite.current.rotation.y = Math.atan2(dx, dz)

    // Pick artwork from where they face relative to our line of sight.
    const len = Math.hypot(dx, dz) || 1
    const fwdX = -Math.sin(pose.ry)
    const fwdZ = -Math.cos(pose.ry)
    const dot = (fwdX * dx + fwdZ * dz) / len
    const cross = (fwdX * dz - fwdZ * dx) / len
    let material = materials.side
    let mirror = cross > 0 ? -1 : 1
    if (dot > 0.5) {
      material = materials.front
      mirror = 1
    } else if (dot < -0.5) {
      material = materials.back
      mirror = 1
    }
    if (sprite.current.material !== material) sprite.current.material = material
    sprite.current.scale.set(mirror * width, SPRITE_HEIGHT, 1)
  })

  const label =
    peer.nick + (peer.micMuted ? ' (mic off)' : '') + (peer.instrumentOn ? ' ♪' : '')

  return (
    <group ref={group}>
      <mesh ref={sprite} position={[0, SPRITE_HEIGHT / 2, 0]} material={materials.front}>
        <planeGeometry args={[1, 1]} />
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
