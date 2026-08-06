import { ElectricPiano, Soundfont, SplendidGrandPiano, type Smplr } from 'smplr'
import { PolySynth } from './PolySynth'
import type { Instrument, RawVoice } from './types'

export type PresetId = 'grand-piano' | 'e-piano' | 'organ' | 'synth'

export const PRESET_OPTIONS: { id: PresetId; label: string }[] = [
  { id: 'grand-piano', label: 'Grand piano' },
  { id: 'e-piano', label: 'Electric piano' },
  { id: 'organ', label: 'Organ' },
  { id: 'synth', label: 'Analog synth' },
]

// Pedal semantics live here once, so every preset behaves the same: while
// the pedal is down, note-offs are deferred; releasing the pedal flushes
// them. Re-striking a sustained note releases the ringing copy first.
class WithSustain implements Instrument {
  private pedal = false
  private held = new Set<number>()

  constructor(private raw: RawVoice) {}

  get ready(): Promise<void> {
    return this.raw.ready
  }

  noteOn(midi: number, velocity: number): void {
    if (this.held.has(midi)) {
      this.raw.off(midi)
      this.held.delete(midi)
    }
    this.raw.on(midi, velocity)
  }

  noteOff(midi: number): void {
    if (this.pedal) this.held.add(midi)
    else this.raw.off(midi)
  }

  setSustain(on: boolean): void {
    this.pedal = on
    if (!on) {
      for (const midi of this.held) this.raw.off(midi)
      this.held.clear()
    }
  }

  allNotesOff(): void {
    this.held.clear()
    this.raw.allOff()
  }

  dispose(): void {
    this.allNotesOff()
    this.raw.dispose()
  }
}

function smplrVoice(inst: Smplr): RawVoice {
  return {
    ready: inst.ready,
    on: (midi, velocity) => void inst.start({ note: midi, velocity }),
    off: (midi) => inst.stop(midi),
    allOff: () => inst.stop(),
    dispose: () => inst.stop(),
  }
}

export function createInstrument(
  ctx: AudioContext,
  destination: AudioNode,
  preset: PresetId,
): Instrument {
  switch (preset) {
    case 'grand-piano':
      return new WithSustain(smplrVoice(SplendidGrandPiano(ctx, { destination })))
    case 'e-piano':
      return new WithSustain(smplrVoice(ElectricPiano(ctx, { instrument: 'CP80', destination })))
    case 'organ':
      return new WithSustain(
        smplrVoice(Soundfont(ctx, { instrument: 'drawbar_organ', destination })),
      )
    case 'synth':
      return new WithSustain(new PolySynth(ctx, destination))
  }
}
