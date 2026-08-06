import { useFBX, useGLTF } from '@react-three/drei'
import { useEffect, useMemo } from 'react'
import {
  Box3,
  DoubleSide,
  Group,
  Light,
  Mesh,
  MeshBasicMaterial,
  type MeshPhongMaterial,
  NearestFilter,
  PointLight,
  SphereGeometry,
  SpotLight,
  Vector3,
} from 'three'
import { useStore } from '../state/store'
import { setColliders, type AABB } from './collision'
import { setLamps } from './lamps'
import { setSnapDefine } from './PsxEffects'

// Drop your export at src/assets/room.glb or src/assets/room.fbx and it
// replaces the placeholder automatically (the globs are resolved at build
// time; GLB wins if both exist). Convention for collision: include hidden box
// meshes named col_* — they become invisible AABB colliders. An FBX without
// col_* meshes gets colliders derived from its geometry instead (perimeter
// walls plus furniture-sized meshes).
const glbModules = import.meta.glob<{ default: string }>('../assets/room.glb', {
  query: '?url',
  eager: true,
})
const fbxModules = import.meta.glob<{ default: string }>('../assets/room.fbx', {
  query: '?url',
  eager: true,
})
const GLB_URL = glbModules['../assets/room.glb']?.default ?? null
const FBX_URL = fbxModules['../assets/room.fbx']?.default ?? null

export function Room(): React.JSX.Element {
  if (GLB_URL) return <GltfRoom url={GLB_URL} />
  if (FBX_URL) return <FbxRoom url={FBX_URL} />
  return <PlaceholderRoom />
}

function GltfRoom({ url }: { url: string }): React.JSX.Element {
  const { scene } = useGLTF(url)

  useEffect(() => {
    const boxes: AABB[] = []
    scene.updateMatrixWorld(true)
    scene.traverse((obj) => {
      if (obj instanceof Mesh && obj.name.startsWith('col_')) {
        obj.visible = false
        const box = new Box3().setFromObject(obj)
        boxes.push({
          minX: box.min.x,
          minZ: box.min.z,
          maxX: box.max.x,
          maxZ: box.max.z,
          minY: box.min.y,
          maxY: box.max.y,
        })
      }
    })
    setColliders(boxes)
    return () => setColliders([])
  }, [scene])

  return <primitive object={scene} />
}

function FbxRoom({ url }: { url: string }): React.JSX.Element {
  const scene = useFBX(url)

  const colliders = useMemo(() => {
    // FBX files are typically authored in centimeters and FBXLoader keeps the
    // file's units, so a room-sized bounding box means the model needs a
    // 0.01 scale. Reset first so the normalization is idempotent.
    scene.scale.setScalar(1)
    scene.position.set(0, 0, 0)
    scene.updateMatrixWorld(true)
    const rawSize = new Box3().setFromObject(scene).getSize(new Vector3())
    const unitScale = Math.max(rawSize.x, rawSize.z) > 60 ? 0.01 : 1
    scene.scale.setScalar(unitScale)
    scene.updateMatrixWorld(true)

    // Center the room on the origin with the floor at y=0 so the player
    // spawns inside regardless of where the export placed its origin.
    const bounds = new Box3().setFromObject(scene)
    const center = bounds.getCenter(new Vector3())
    scene.position.set(-center.x, -bounds.min.y, -center.z)
    scene.updateMatrixWorld(true)

    // The room shell is modeled with outward-facing normals, so single-sided
    // materials vanish when viewed from inside; FBX phong exports also carry
    // hot specular that blows out under our lights. Lights authored in the
    // FBX keep their placement, but the export flattens Blender's
    // inverse-square falloff to linear and its intensity to centimeter-scale
    // values — restore physical falloff and re-tune the energy, or the lamps
    // wash out the whole room.
    const roomBox = new Box3().setFromObject(scene)
    const roomW = (roomBox.max.x - roomBox.min.x) * SHELL_COVER
    const roomD = (roomBox.max.z - roomBox.min.z) * SHELL_COVER
    const lights: PointLight[] = []
    const spots: SpotLight[] = []
    scene.traverse((obj) => {
      if (obj instanceof SpotLight) {
        // Authored ceiling/fixture spotlights: same energy conversion as the
        // point lamps.
        obj.userData.rawIntensity ??= obj.intensity
        obj.scale.setScalar(1)
        obj.decay = 1.4
        obj.intensity = (obj.userData.rawIntensity as number) * unitScale * SPOT_BOOST
        obj.angle = 0.65
        obj.penumbra = 0.5
        obj.castShadow = true
        obj.shadow.mapSize.set(512, 512)
        obj.shadow.camera.near = 0.1
        obj.shadow.normalBias = 0.05
        spots.push(obj)
        return
      }
      if (obj instanceof PointLight) {
        obj.userData.rawIntensity ??= obj.intensity
        // Hanging pendants are authored with the bulb at the shade's narrow
        // apex, where it pokes through and spills light at the ceiling.
        // Sink lights in the pendant band into the wide part of the shade
        // so the cone shadows the top and throws everything downward.
        obj.userData.rawY ??= obj.position.y
        obj.position.y = obj.userData.rawY as number
        const probe = new Vector3()
        obj.getWorldPosition(probe)
        if (probe.y > 2 && probe.y < 2.7) {
          obj.getWorldScale(probe)
          obj.position.y -= 0.22 / (probe.y || 1)
        }
        // FBX exports carry the lamp's editor size as a transform scale;
        // three ignores it for lighting, but anything parented to the light
        // (our bulb) would inherit it — and its bounding box would inflate
        // the room bounds the colliders are derived from.
        obj.scale.setScalar(1)
        // Much softer than physical (2): Blender's lamps have a radius and
        // its GI bounces light everywhere, so the pool is a broad gentle
        // gradient that reaches the whole room instead of a hotspot with
        // black corners. Low decay + low peak energy approximates that.
        obj.decay = 1.4
        obj.intensity = (obj.userData.rawIntensity as number) * unitScale * LAMP_BOOST
        // What toggleLamp restores when a lamp is switched back on.
        obj.userData.onIntensity = obj.intensity
        obj.castShadow = true
        // Small map + wide PCF radius = the soft smudged shadows of an
        // area light, not the razor-edged wedges of a point light.
        obj.shadow.mapSize.set(256, 256)
        obj.shadow.radius = 14
        obj.shadow.camera.near = 0.1
        obj.shadow.normalBias = 0.08
        lights.push(obj)
        return
      }
      if (obj instanceof Light) {
        obj.userData.rawIntensity ??= obj.intensity
        obj.intensity = (obj.userData.rawIntensity as number) * unitScale
        return
      }
      if (!(obj instanceof Mesh)) return
      if (obj.name === 'lampBulb') return
      // FBXLoader can deliver a material array with no geometry groups
      // (every polygon uses the same material) — three draws nothing for a
      // group-less array, leaving invisible walls. Collapse to the one
      // material actually in use.
      if (Array.isArray(obj.material) && obj.geometry.groups.length === 0) {
        obj.material = obj.material[0]!
      }
      // The room shell is lit on its back faces (normals point outward), so
      // if it casts shadows, the shadow normalBias pushes samples the wrong
      // way and the whole shell self-shadows into darkness. The same
      // applies to standalone full-length wall planes (room-wide in one
      // axis, paper-thin in the other). They have nothing to cast onto
      // anyway — only receive.
      const b = new Box3().setFromObject(obj)
      const spanX = b.max.x - b.min.x
      const spanZ = b.max.z - b.min.z
      const isShell =
        (spanX > roomW && spanZ > roomD) ||
        (spanX > roomW && spanZ < 0.3) ||
        (spanZ > roomD && spanX < 0.3)
      obj.castShadow = !isShell
      obj.receiveShadow = true
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const mat of mats as MeshPhongMaterial[]) {
        mat.side = DoubleSide
        // Zero, not merely low: with lamp-strength lights even a faint
        // specular term blooms into white plastic glints.
        if (mat.specular) mat.specular.setScalar(0)
        // PSX consoles had no texture filtering.
        if (mat.map) mat.map.magFilter = NearestFilter
        // Blender exports the color texture again as the transparency
        // texture, which three reads as an alphaMap (green channel!) — dark
        // artwork pixels count as transparent. It arrives as a separate
        // texture instance wrapping the same image, so drop any alphaMap on
        // color-mapped materials; the color map's real PNG alpha still cuts
        // out silhouettes. (A dedicated grayscale alpha texture would be
        // lost — Blender's FBX path doesn't produce those.)
        if (mat.alphaMap && mat.map) mat.alphaMap = null
        // Alpha textures arrive as blended, which renders cutouts (posters,
        // the standees) ghostly and z-fighty; alpha-tested is crisp.
        if (mat.transparent) {
          mat.transparent = false
          mat.alphaTest = 0.5
          mat.depthWrite = true
        }
        setSnapDefine(mat, useStore.getState().psxHeavy)
      }
    })

    // Aim spotlights straight down in room space — the fixture's own FBX
    // rotation must not tilt the beam (a rotated ceiling lamp was firing
    // its cone up through the roof).
    for (const spot of spots) {
      spot.target.position.copy(spot.position)
      spot.target.position.y -= 1 / unitScale
      spot.parent?.add(spot.target)
    }

    // A small glowing bulb per lamp so the light source is a visible,
    // grabbable object. Child of the light, so it tags along when carried;
    // it must not cast shadows or it would occlude its own light entirely.
    // Sized from the light's WORLD scale — fixture lights inherit large
    // scales from their housing meshes, which the light's own scale reset
    // doesn't touch.
    scene.updateMatrixWorld(true)
    for (const light of lights) {
      if (light.children.some((c) => c.name === 'lampBulb')) continue
      const mat = new MeshBasicMaterial({ color: 0xff7a30 })
      // Exempt from PSX vertex snapping — a bulb-sized mesh collapses into
      // jagged streaks on the coarse snap grid.
      mat.defines = { PSX_NO_SNAP: '' }
      const worldScale = light.getWorldScale(new Vector3()).x || 1
      const bulb = new Mesh(new SphereGeometry(0.09 / worldScale, 16, 12), mat)
      bulb.name = 'lampBulb'
      light.add(bulb)
    }

    return deriveColliders(scene)
  }, [scene])

  useEffect(() => {
    setColliders(colliders)
    return () => setColliders([])
  }, [colliders])

  useEffect(() => {
    const lights: PointLight[] = []
    scene.traverse((obj) => {
      if (obj instanceof PointLight) lights.push(obj)
    })
    // Sorted by name so lamp indices agree across every client in the room.
    lights.sort((a, b) => a.name.localeCompare(b.name))
    setLamps(lights)
    return () => setLamps([])
  }, [scene])

  return <primitive object={scene} />
}

// Taste factor on top of the unit conversion: with physical (decay 2)
// falloff the exported wattage reads too dim, so the lamps get a fixed boost.
// Tuned against the Blender reference render under AgX tone mapping.
// Kept below the range where AgX starts bleaching the lamp color to white —
// brightness comes from toneMappingExposure instead.
const LAMP_BOOST = 5
// Spot cones concentrate their energy; they read dimmer than point lamps at
// the same wattage, so they get a bigger conversion factor.
const SPOT_BOOST = 15

// Thresholds for guessing which meshes should block movement when the model
// has no explicit col_* boxes.
const SHELL_COVER = 0.8 // footprint share above which a mesh is the room shell
const MIN_PROP_HEIGHT = 0.3 // anything flatter is walkable (rugs, floor decals)
const WALK_UNDER = 1.2 // anything whose bottom is higher is wall-mounted
const PERIMETER_T = 0.5

function deriveColliders(scene: Group): AABB[] {
  const explicit: AABB[] = []
  const candidates: { box: Box3; aabb: AABB }[] = []
  const room = new Box3().setFromObject(scene)

  scene.traverse((obj) => {
    if (!(obj instanceof Mesh)) return
    const b = new Box3().setFromObject(obj)
    const aabb = {
      minX: b.min.x,
      minZ: b.min.z,
      maxX: b.max.x,
      maxZ: b.max.z,
      minY: b.min.y,
      maxY: b.max.y,
    }
    if (obj.name.startsWith('col_')) {
      obj.visible = false
      explicit.push(aabb)
      return
    }
    const coversRoom =
      b.max.x - b.min.x > (room.max.x - room.min.x) * SHELL_COVER &&
      b.max.z - b.min.z > (room.max.z - room.min.z) * SHELL_COVER
    if (coversRoom) return // walls/floor/ceiling — the perimeter boxes handle it
    if (b.max.y - b.min.y < MIN_PROP_HEIGHT) return
    if (b.min.y > WALK_UNDER) return
    // Cords and curve objects span huge boxes of mostly empty space — a
    // cable across the room must not become a wall.
    if (/nurbs|bezier|curve|cord|cable|wire|rope|path/i.test(obj.name)) return
    candidates.push({ box: b, aabb })
  })

  // A mesh containing the center of an authored col_* box is hand-modeled:
  // the authored boxes replace its solid block (this is how a shelf gets a
  // hollow interior with per-board surfaces). Everything else keeps its
  // auto-derived box, so partial authoring is fine.
  const derived = candidates
    .filter((c) => !explicit.some((e) => coversCollider(c.box, e)))
    .map((c) => c.aabb)

  const wall = { minY: room.min.y, maxY: room.max.y }
  return [
    { minX: room.min.x - PERIMETER_T, maxX: room.max.x + PERIMETER_T, minZ: room.min.z - PERIMETER_T, maxZ: room.min.z, ...wall },
    { minX: room.min.x - PERIMETER_T, maxX: room.max.x + PERIMETER_T, minZ: room.max.z, maxZ: room.max.z + PERIMETER_T, ...wall },
    { minX: room.min.x - PERIMETER_T, maxX: room.min.x, minZ: room.min.z, maxZ: room.max.z, ...wall },
    { minX: room.max.x, maxX: room.max.x + PERIMETER_T, minZ: room.min.z, maxZ: room.max.z, ...wall },
    ...explicit,
    ...derived,
  ]
}

const COVER_SLACK = 0.05
function coversCollider(meshBox: Box3, col: AABB): boolean {
  const cx = (col.minX + col.maxX) / 2
  const cy = (col.minY + col.maxY) / 2
  const cz = (col.minZ + col.maxZ) / 2
  return (
    cx > meshBox.min.x - COVER_SLACK &&
    cx < meshBox.max.x + COVER_SLACK &&
    cy > meshBox.min.y - COVER_SLACK &&
    cy < meshBox.max.y + COVER_SLACK &&
    cz > meshBox.min.z - COVER_SLACK &&
    cz < meshBox.max.z + COVER_SLACK
  )
}

// 14 × 10 m practice room with walls and a few obstacles, so movement and
// spatial audio are testable before any real assets exist.
const W = 7
const D = 5
const WALL_T = 0.3

interface Prop {
  pos: [number, number, number]
  size: [number, number, number]
  color: string
  collide: boolean
}

const PROPS: Prop[] = [
  // Backline: two amps against the north wall and a mixer table in the corner.
  { pos: [-3, 0.45, -4.2], size: [0.7, 0.9, 0.5], color: '#1d1d24', collide: true },
  { pos: [3, 0.45, -4.2], size: [0.7, 0.9, 0.5], color: '#1d1d24', collide: true },
  { pos: [-5.8, 0.4, 3.8], size: [1.6, 0.8, 0.8], color: '#33333e', collide: true },
  // Sofa for the audience.
  { pos: [5.9, 0.35, 2.5], size: [0.9, 0.7, 2.2], color: '#4a3540', collide: true },
]

function PlaceholderRoom(): React.JSX.Element {
  useEffect(() => {
    const wall = { minY: 0, maxY: 3 }
    const walls: AABB[] = [
      { minX: -W - WALL_T, maxX: W + WALL_T, minZ: -D - WALL_T, maxZ: -D, ...wall },
      { minX: -W - WALL_T, maxX: W + WALL_T, minZ: D, maxZ: D + WALL_T, ...wall },
      { minX: -W - WALL_T, maxX: -W, minZ: -D, maxZ: D, ...wall },
      { minX: W, maxX: W + WALL_T, minZ: -D, maxZ: D, ...wall },
    ]
    const props: AABB[] = PROPS.filter((p) => p.collide).map((p) => ({
      minX: p.pos[0] - p.size[0] / 2,
      maxX: p.pos[0] + p.size[0] / 2,
      minZ: p.pos[2] - p.size[2] / 2,
      maxZ: p.pos[2] + p.size[2] / 2,
      minY: p.pos[1] - p.size[1] / 2,
      maxY: p.pos[1] + p.size[1] / 2,
    }))
    setColliders([...walls, ...props])
    return () => setColliders([])
  }, [])

  const wallMeshes = useMemo(
    () => [
      { pos: [0, 1.5, -D - WALL_T / 2] as const, size: [W * 2 + WALL_T * 2, 3, WALL_T] as const },
      { pos: [0, 1.5, D + WALL_T / 2] as const, size: [W * 2 + WALL_T * 2, 3, WALL_T] as const },
      { pos: [-W - WALL_T / 2, 1.5, 0] as const, size: [WALL_T, 3, D * 2] as const },
      { pos: [W + WALL_T / 2, 1.5, 0] as const, size: [WALL_T, 3, D * 2] as const },
    ],
    [],
  )

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[W * 2, D * 2]} />
        <meshStandardMaterial color="#26262e" />
      </mesh>
      {/* Rug marks the jam spot — also a visual anchor for spatial audio tests. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, -1]}>
        <circleGeometry args={[2.4, 32]} />
        <meshStandardMaterial color="#463240" />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 3, 0]}>
        <planeGeometry args={[W * 2, D * 2]} />
        <meshStandardMaterial color="#1a1a20" />
      </mesh>
      {wallMeshes.map((w, i) => (
        <mesh key={i} position={new Vector3(...w.pos)}>
          <boxGeometry args={[...w.size]} />
          <meshStandardMaterial color="#31313c" />
        </mesh>
      ))}
      {PROPS.map((p, i) => (
        <mesh key={i} position={p.pos}>
          <boxGeometry args={p.size} />
          <meshStandardMaterial color={p.color} />
        </mesh>
      ))}
    </group>
  )
}
