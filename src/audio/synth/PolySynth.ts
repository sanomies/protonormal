import type { RawVoice } from './types'

interface Voice {
  osc1: OscillatorNode
  osc2: OscillatorNode
  filter: BiquadFilterNode
  gain: GainNode
}

// Two detuned saws → lowpass → ADSR. Not a piano substitute — it's the
// zero-download preset that plays instantly while sampled instruments load.
export class PolySynth implements RawVoice {
  readonly ready = Promise.resolve()
  private voices = new Map<number, Voice>()
  private output: GainNode

  constructor(
    private ctx: AudioContext,
    destination: AudioNode,
  ) {
    this.output = ctx.createGain()
    // Headroom: 10-note chords must not clip the capture stream.
    this.output.gain.value = 0.5
    this.output.connect(destination)
  }

  on(midi: number, velocity: number): void {
    this.off(midi)
    const ctx = this.ctx
    const t = ctx.currentTime
    const freq = 440 * 2 ** ((midi - 69) / 12)
    const vel = Math.max(0.05, Math.min(1, velocity / 127))

    const osc1 = ctx.createOscillator()
    osc1.type = 'sawtooth'
    osc1.frequency.value = freq
    osc1.detune.value = -6
    const osc2 = ctx.createOscillator()
    osc2.type = 'sawtooth'
    osc2.frequency.value = freq
    osc2.detune.value = 6

    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.Q.value = 1
    // Brighter with harder playing, capped below harshness.
    filter.frequency.value = Math.min(9000, freq * (2 + 6 * vel))

    const gain = ctx.createGain()
    const peak = 0.28 * vel
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(peak, t + 0.005)
    gain.gain.setTargetAtTime(peak * 0.6, t + 0.005, 0.15)

    osc1.connect(filter)
    osc2.connect(filter)
    filter.connect(gain)
    gain.connect(this.output)
    osc1.start(t)
    osc2.start(t)

    this.voices.set(midi, { osc1, osc2, filter, gain })
  }

  off(midi: number): void {
    const v = this.voices.get(midi)
    if (!v) return
    this.voices.delete(midi)
    const t = this.ctx.currentTime
    v.gain.gain.cancelScheduledValues(t)
    v.gain.gain.setTargetAtTime(0, t, 0.07)
    // setTargetAtTime never reaches zero; stop well past audibility.
    v.osc1.stop(t + 0.6)
    v.osc2.stop(t + 0.6)
  }

  allOff(): void {
    for (const midi of [...this.voices.keys()]) this.off(midi)
  }

  dispose(): void {
    this.allOff()
    this.output.disconnect()
  }
}
