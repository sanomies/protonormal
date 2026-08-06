// What the MIDI layer and UI program against, whatever makes the sound.
export interface Instrument {
  readonly ready: Promise<void>
  noteOn(midi: number, velocity: number): void
  noteOff(midi: number): void
  setSustain(on: boolean): void
  allNotesOff(): void
  dispose(): void
}

// The minimal sound-maker the sustain-pedal wrapper drives.
export interface RawVoice {
  readonly ready: Promise<void>
  on(midi: number, velocity: number): void
  off(midi: number): void
  allOff(): void
  dispose(): void
}
