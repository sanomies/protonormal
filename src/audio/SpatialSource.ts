import type { AudioEngine } from './AudioEngine'

// Playback chain for one remote track:
//   MediaStream → (muted <audio> keepalive) → source → gain → panner → master
export class SpatialSource {
  // Chrome quirk (w3c/webrtc-pc#2564): a remote WebRTC track that isn't
  // attached to a media element may render silence into Web Audio. The
  // muted, never-mounted element costs nothing and makes the graph reliable.
  private keepalive: HTMLAudioElement
  private source: MediaStreamAudioSourceNode
  private gain: GainNode
  private panner: PannerNode
  private analyser: AnalyserNode | null = null
  private levelBuf: Float32Array<ArrayBuffer> | null = null

  constructor(
    private engine: AudioEngine,
    stream: MediaStream,
    withAnalyser: boolean,
  ) {
    const ctx = engine.ctx
    this.keepalive = new Audio()
    this.keepalive.srcObject = stream
    this.keepalive.muted = true
    void this.keepalive.play().catch(() => {})

    this.source = ctx.createMediaStreamSource(stream)
    this.gain = ctx.createGain()
    this.panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 1,
      maxDistance: 30,
      rolloffFactor: 1.5,
    })
    this.source.connect(this.gain)
    this.gain.connect(this.panner)
    this.panner.connect(engine.master)

    if (withAnalyser) {
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 256
      this.levelBuf = new Float32Array(this.analyser.fftSize)
      // Tap post-source so per-peer volume doesn't hide the speaking dot.
      this.source.connect(this.analyser)
    }
  }

  setGain(value: number): void {
    this.gain.gain.setTargetAtTime(value, this.engine.ctx.currentTime, 0.03)
  }

  setPosition(x: number, y: number, z: number): void {
    const t = this.engine.ctx.currentTime
    const T = 0.05
    this.panner.positionX.setTargetAtTime(x, t, T)
    this.panner.positionY.setTargetAtTime(y, t, T)
    this.panner.positionZ.setTargetAtTime(z, t, T)
  }

  getLevel(): number {
    if (!this.analyser || !this.levelBuf) return 0
    this.analyser.getFloatTimeDomainData(this.levelBuf)
    let sum = 0
    for (let i = 0; i < this.levelBuf.length; i++) sum += this.levelBuf[i]! ** 2
    return Math.sqrt(sum / this.levelBuf.length)
  }

  dispose(): void {
    this.source.disconnect()
    this.gain.disconnect()
    this.panner.disconnect()
    this.analyser?.disconnect()
    this.keepalive.pause()
    this.keepalive.srcObject = null
  }
}
