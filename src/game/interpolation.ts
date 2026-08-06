import type { Vec3 } from '../../shared/protocol'

// Remote avatars render this far in the past so there is nearly always a
// newer snapshot to interpolate toward at 15 Hz updates + network jitter.
export const INTERP_DELAY_MS = 120

interface Snapshot {
  t: number
  p: Vec3
  ry: number
}

export interface Pose {
  p: Vec3
  ry: number
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

export class SnapshotBuffer {
  private buf: Snapshot[] = []

  push(p: Vec3, ry: number): void {
    this.buf.push({ t: performance.now(), p, ry })
    const cutoff = performance.now() - 2000
    while (this.buf.length > 2 && this.buf[0]!.t < cutoff) this.buf.shift()
  }

  // Clamp instead of extrapolating: standing avatars that overshoot look far
  // worse than avatars that lag an extra frame.
  sample(renderTime: number): Pose | null {
    const buf = this.buf
    if (buf.length === 0) return null
    const first = buf[0]!
    const last = buf[buf.length - 1]!
    if (renderTime <= first.t) return { p: first.p, ry: first.ry }
    if (renderTime >= last.t) return { p: last.p, ry: last.ry }
    for (let i = buf.length - 2; i >= 0; i--) {
      const a = buf[i]!
      if (a.t > renderTime) continue
      const b = buf[i + 1]!
      const t = (renderTime - a.t) / Math.max(1, b.t - a.t)
      return {
        p: [
          a.p[0] + (b.p[0] - a.p[0]) * t,
          a.p[1] + (b.p[1] - a.p[1]) * t,
          a.p[2] + (b.p[2] - a.p[2]) * t,
        ],
        ry: lerpAngle(a.ry, b.ry, t),
      }
    }
    return { p: last.p, ry: last.ry }
  }
}
