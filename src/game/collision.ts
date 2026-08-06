// Flat-floor collision: the player is a circle in the XZ plane tested against
// static AABBs. Deliberately no physics engine — one room with axis-aligned
// walls doesn't justify a WASM bundle. Escape hatch if the room ever grows
// stairs or ramps: swap this module for a rapier character controller.

export interface AABB {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
  // Vertical span. Player collision stays height-blind (the collider
  // derivation already filters player-relevant boxes); the span exists for
  // carried/falling objects, which need to land on tables and slide along
  // walls but pass over low furniture.
  minY: number
  maxY: number
}

let colliders: AABB[] = []

export function setColliders(list: AABB[]): void {
  colliders = list
}

// Read-only view for debugging/tests.
export function getColliders(): readonly AABB[] {
  return colliders
}

function collides(x: number, z: number, r: number): boolean {
  for (const b of colliders) {
    const cx = Math.max(b.minX, Math.min(x, b.maxX))
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ))
    const dx = x - cx
    const dz = z - cz
    if (dx * dx + dz * dz < r * r) return true
  }
  return false
}

// True when the circle overlaps any collider — e.g. the room model loaded
// around a player standing where its furniture is.
export function isBlocked(x: number, z: number, r: number): boolean {
  return collides(x, z, r)
}

// Nearest free spot to (x, z), searched in growing rings. Falls back to the
// origin-ish input if everything within ~6 m is solid (shouldn't happen in a
// sane room).
export function findFreeSpot(x: number, z: number, r: number): [number, number] {
  if (!collides(x, z, r)) return [x, z]
  for (let ring = 0.4; ring <= 6; ring += 0.4) {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2
      const nx = x + Math.cos(a) * ring
      const nz = z + Math.sin(a) * ring
      if (!collides(nx, nz, r)) return [nx, nz]
    }
  }
  return [x, z]
}

function collidesAt(x: number, z: number, r: number, yLow: number, yHigh: number): boolean {
  for (const b of colliders) {
    if (b.maxY < yLow || b.minY > yHigh) continue
    const cx = Math.max(b.minX, Math.min(x, b.maxX))
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ))
    const dx = x - cx
    const dz = z - cz
    if (dx * dx + dz * dz < r * r) return true
  }
  return false
}

// Carried-object variant of resolveMovement: only boxes overlapping the
// object's vertical span block it, so a lamp held high glides over a table
// but never passes through a wall.
export function resolveObjectMovement(
  x: number,
  z: number,
  dx: number,
  dz: number,
  r: number,
  yLow: number,
  yHigh: number,
): [number, number] {
  // Already inside something (geometry loaded around it) — don't trap it,
  // let it move until clear.
  if (collidesAt(x, z, r, yLow, yHigh)) return [x + dx, z + dz]
  let nx = x + dx
  if (collidesAt(nx, z, r, yLow, yHigh)) nx = x
  let nz = z + dz
  if (collidesAt(nx, nz, r, yLow, yHigh)) nz = z
  return [nx, nz]
}

// Highest support surface under (x, z), considering only tops at or below y:
// the floor (0), or the top of any collider the circle overlaps. What a
// falling object lands on.
export function supportHeightAt(x: number, z: number, y: number, r: number): number {
  let top = 0
  for (const b of colliders) {
    if (b.maxY > y + 0.001 || b.maxY <= top) continue
    const cx = Math.max(b.minX, Math.min(x, b.maxX))
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ))
    const dx = x - cx
    const dz = z - cz
    if (dx * dx + dz * dz < r * r) top = b.maxY
  }
  return top
}

// Axes resolve independently, which is what produces wall sliding: a blocked
// X still lets the Z component through.
export function resolveMovement(
  x: number,
  z: number,
  dx: number,
  dz: number,
  radius: number,
): [number, number] {
  let nx = x + dx
  if (collides(nx, z, radius)) nx = x
  let nz = z + dz
  if (collides(nx, nz, radius)) nz = z
  return [nx, nz]
}
