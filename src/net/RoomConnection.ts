import type { C2S, S2C, SignalPayload, Vec3 } from '../../shared/protocol'
import { POSITION_SEND_HZ } from '../../shared/protocol'

export interface RoomEvents {
  onMessage(msg: S2C): void
  onClose(code: number, reason: string): void
}

export class RoomConnection {
  private ws: WebSocket | null = null
  private sendTimer: ReturnType<typeof setInterval> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private pose: { p: Vec3; ry: number } = { p: [0, 0, 0], ry: 0 }
  private poseDirty = false
  private lamp: { i: number; p: Vec3; on: boolean } | null = null
  private lampDirty = false
  private closedByUs = false

  constructor(private events: RoomEvents) {}

  connect(code: string, nick: string): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const url = `${proto}://${location.host}/api/room/${code}/ws?nick=${encodeURIComponent(nick)}`
    const ws = new WebSocket(url)
    this.ws = ws

    ws.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data === 'pong') return
      let msg: S2C
      try {
        msg = JSON.parse(e.data) as S2C
      } catch {
        return
      }
      this.events.onMessage(msg)
    }

    ws.onclose = (e) => {
      this.stopTimers()
      if (!this.closedByUs) this.events.onClose(e.code, e.reason)
    }

    ws.onopen = () => {
      this.sendTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return
        if (this.poseDirty) {
          this.poseDirty = false
          this.send({ t: 'pos', p: this.pose.p, ry: this.pose.ry })
        }
        if (this.lampDirty && this.lamp) {
          this.lampDirty = false
          this.send({ t: 'lamp', i: this.lamp.i, p: this.lamp.p, held: true, on: this.lamp.on })
        }
      }, 1000 / POSITION_SEND_HZ)
      // Answered by the DO runtime's auto-responder without waking it.
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping')
      }, 20_000)
    }
  }

  // Called every frame from the movement loop; the interval above downsamples
  // to the wire rate.
  updateLocalPose(x: number, y: number, z: number, ry: number): void {
    const [px, py, pz] = this.pose.p
    if (px === x && py === y && pz === z && this.pose.ry === ry) return
    this.pose = { p: [x, y, z], ry }
    this.poseDirty = true
  }

  // Force a re-send of the current pose even if unchanged — used when a new
  // peer joins so they learn where standing-still players are.
  nudgePose(): void {
    this.poseDirty = true
  }

  // Called every frame while carrying a lamp; downsampled like the pose.
  updateCarriedLamp(i: number, p: Vec3, on: boolean): void {
    this.lamp = { i, p, on }
    this.lampDirty = true
  }

  // Pickup/drop/toggle are events, not a stream — sent immediately.
  sendLampEvent(i: number, p: Vec3, held: boolean, on: boolean): void {
    if (!held && this.lamp?.i === i) {
      this.lamp = null
      this.lampDirty = false
    }
    this.send({ t: 'lamp', i, p, held, on })
  }

  send(msg: C2S): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  sendSignal(to: string, data: SignalPayload): void {
    this.send({ t: 'signal', to, data })
  }

  sendState(state: { micMuted?: boolean; instrumentOn?: boolean }): void {
    this.send({ t: 'state', ...state })
  }

  close(): void {
    this.closedByUs = true
    this.stopTimers()
    this.ws?.close(1000)
    this.ws = null
  }

  private stopTimers(): void {
    if (this.sendTimer) clearInterval(this.sendTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.sendTimer = null
    this.pingTimer = null
  }
}
