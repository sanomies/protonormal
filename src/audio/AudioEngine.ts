import type { TrackRole } from '../../shared/protocol'
import { SpatialSource } from './SpatialSource'

interface PeerLevel {
  volume: number
  muted: boolean
}

// One AudioContext for everything — spatialized remote peers, the local
// synth, and WebRTC capture — so nodes can interconnect freely. Must be
// constructed from a user gesture (the Join click) for autoplay policy.
export class AudioEngine {
  readonly ctx: AudioContext
  readonly master: GainNode
  private sources = new Map<string, Partial<Record<TrackRole, SpatialSource>>>()
  private levels = new Map<string, PeerLevel>()

  constructor() {
    this.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
    this.master = this.ctx.createGain()
    this.master.connect(this.ctx.destination)
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume()
  }

  addRemoteTrack(peerId: string, role: TrackRole, stream: MediaStream): void {
    const byRole = this.sources.get(peerId) ?? {}
    // A renegotiated/replaced track supersedes the old chain for this role.
    byRole[role]?.dispose()
    const source = new SpatialSource(this, stream, role === 'mic')
    byRole[role] = source
    this.sources.set(peerId, byRole)
    this.applyLevel(peerId)
  }

  removePeer(peerId: string): void {
    const byRole = this.sources.get(peerId)
    if (byRole) {
      byRole.mic?.dispose()
      byRole.instrument?.dispose()
      this.sources.delete(peerId)
    }
    this.levels.delete(peerId)
  }

  setPeerLevel(peerId: string, volume: number, muted: boolean): void {
    this.levels.set(peerId, { volume, muted })
    this.applyLevel(peerId)
  }

  private applyLevel(peerId: string): void {
    const byRole = this.sources.get(peerId)
    if (!byRole) return
    const level = this.levels.get(peerId) ?? { volume: 1, muted: false }
    const gain = level.muted ? 0 : level.volume
    byRole.mic?.setGain(gain)
    byRole.instrument?.setGain(gain)
  }

  updatePeerPosition(peerId: string, x: number, y: number, z: number): void {
    const byRole = this.sources.get(peerId)
    if (!byRole) return
    byRole.mic?.setPosition(x, y, z)
    byRole.instrument?.setPosition(x, y, z)
  }

  // 0..~1 RMS of the peer's voice, for speaking indicators.
  getMicLevel(peerId: string): number {
    return this.sources.get(peerId)?.mic?.getLevel() ?? 0
  }

  updateListener(
    px: number,
    py: number,
    pz: number,
    fx: number,
    fy: number,
    fz: number,
    ux: number,
    uy: number,
    uz: number,
  ): void {
    const l = this.ctx.listener
    const t = this.ctx.currentTime
    const T = 0.05
    l.positionX.setTargetAtTime(px, t, T)
    l.positionY.setTargetAtTime(py, t, T)
    l.positionZ.setTargetAtTime(pz, t, T)
    l.forwardX.setTargetAtTime(fx, t, T)
    l.forwardY.setTargetAtTime(fy, t, T)
    l.forwardZ.setTargetAtTime(fz, t, T)
    l.upX.setTargetAtTime(ux, t, T)
    l.upY.setTargetAtTime(uy, t, T)
    l.upZ.setTargetAtTime(uz, t, T)
  }

  async dispose(): Promise<void> {
    for (const id of [...this.sources.keys()]) this.removePeer(id)
    await this.ctx.close().catch(() => {})
  }
}
