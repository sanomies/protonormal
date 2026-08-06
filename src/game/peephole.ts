// Door peepholes. The room registers every door's position at load;
// LocalPlayer checks reach and toggles the video overlay via the store.

let spots: { x: number; z: number }[] = []

export function addPeepholeSpot(x: number, z: number): void {
  spots.push({ x, z })
}

export function clearPeepholeSpots(): void {
  spots = []
}

// Read-only view for debugging/tests.
export function getPeepholeSpots(): readonly { x: number; z: number }[] {
  return spots
}

export function peepholeInReach(x: number, z: number, radius: number): boolean {
  for (const spot of spots) {
    const dx = spot.x - x
    const dz = spot.z - z
    if (dx * dx + dz * dz < radius * radius) return true
  }
  return false
}
