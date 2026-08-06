import type { AudioEngine } from './AudioEngine'

// One graph regardless of what the instrument is:
//
//   synth output ──┐
//                  ├─▶ gain ─┬─▶ MediaStreamAudioDestinationNode → WebRTC track
//   raw device  ───┘         └─▶ monitorGain → master (hear yourself)
//
// Routing a raw device (guitar interface) through here rather than sending
// its track directly unifies level control, monitoring and source switching;
// serious players direct-monitor on their interface anyway.
export class InstrumentBus {
  readonly gain: GainNode
  private monitorGain: GainNode
  private captureDest: MediaStreamAudioDestinationNode
  private sourceNode: AudioNode | null = null
  private inputStream: MediaStream | null = null

  constructor(private engine: AudioEngine) {
    const ctx = engine.ctx
    this.gain = ctx.createGain()
    this.captureDest = ctx.createMediaStreamDestination()
    this.monitorGain = ctx.createGain()
    this.monitorGain.gain.value = 0
    this.gain.connect(this.captureDest)
    this.gain.connect(this.monitorGain)
    this.monitorGain.connect(engine.master)
  }

  // The track is live from construction; it just carries silence until a
  // source is connected. PeerManager decides when to actually send it.
  get track(): MediaStreamTrack | null {
    return this.captureDest.stream.getAudioTracks()[0] ?? null
  }

  // For a synth: pass its output node. Ownership of the node stays with the
  // caller; the bus only wires it up.
  connectSourceNode(node: AudioNode): void {
    this.clearSource()
    this.sourceNode = node
    node.connect(this.gain)
  }

  // For a guitar/audio interface: capture the device raw — every browser
  // "enhancement" (AEC, noise suppression, AGC) actively ruins instruments.
  async useInputDevice(deviceId: string | undefined): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      },
    })
    this.clearSource()
    this.inputStream = stream
    const node = this.engine.ctx.createMediaStreamSource(stream)
    this.sourceNode = node
    node.connect(this.gain)
  }

  clearSource(): void {
    this.sourceNode?.disconnect()
    this.sourceNode = null
    if (this.inputStream) {
      for (const t of this.inputStream.getTracks()) t.stop()
      this.inputStream = null
    }
  }

  setMonitor(on: boolean): void {
    this.monitorGain.gain.setTargetAtTime(on ? 1 : 0, this.engine.ctx.currentTime, 0.02)
  }

  setLevel(value: number): void {
    this.gain.gain.setTargetAtTime(value, this.engine.ctx.currentTime, 0.02)
  }

  dispose(): void {
    this.clearSource()
    this.gain.disconnect()
    this.monitorGain.disconnect()
  }
}
