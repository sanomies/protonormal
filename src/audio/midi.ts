export interface NoteHandlers {
  noteOn(midi: number, velocity: number): void
  noteOff(midi: number): void
  sustain(on: boolean): void
  allNotesOff(): void
}

export interface MidiInputInfo {
  id: string
  name: string
}

// By default listens to every connected MIDI input; setInput() narrows to
// one device. Chromium and Firefox only; Safari has never shipped Web MIDI.
export class MidiManager {
  private access: MIDIAccess | null = null
  private handlers: NoteHandlers | null = null
  // null = listen to all inputs.
  private selectedId: string | null = null
  // Diagnostics hooks: any incoming message (even non-note), and hot-plugs.
  onActivity: (() => void) | null = null
  onDevicesChanged: ((inputs: MidiInputInfo[]) => void) | null = null

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
  }

  async init(): Promise<boolean> {
    if (!MidiManager.supported) return false
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false })
    } catch {
      return false
    }
    this.attachAll()
    // Hot-plugged keyboards start working without a rejoin.
    this.access.onstatechange = () => {
      this.attachAll()
      this.onDevicesChanged?.(this.inputs())
    }
    this.onDevicesChanged?.(this.inputs())
    return true
  }

  setHandlers(handlers: NoteHandlers | null): void {
    this.handlers = handlers
  }

  setInput(id: string | null): void {
    this.selectedId = id
    this.attachAll()
  }

  inputs(): MidiInputInfo[] {
    if (!this.access) return []
    return [...this.access.inputs.values()].map((i) => ({
      id: i.id,
      name: i.name ?? 'MIDI input',
    }))
  }

  private attachAll(): void {
    if (!this.access) return
    for (const input of this.access.inputs.values()) {
      input.onmidimessage =
        this.selectedId === null || input.id === this.selectedId
          ? (e) => this.handle(e)
          : null
    }
  }

  private handle(e: MIDIMessageEvent): void {
    this.onActivity?.()
    const data = e.data
    if (!data || data.length < 2) return
    const status = data[0]! & 0xf0
    const d1 = data[1]!
    const d2 = data.length > 2 ? data[2]! : 0

    if (status === 0x90 && d2 > 0) {
      this.handlers?.noteOn(d1, d2)
    } else if (status === 0x80 || (status === 0x90 && d2 === 0)) {
      this.handlers?.noteOff(d1)
    } else if (status === 0xb0 && d1 === 64) {
      this.handlers?.sustain(d2 >= 64)
    } else if (status === 0xb0 && (d1 === 120 || d1 === 123)) {
      this.handlers?.allNotesOff()
    }
  }

  dispose(): void {
    if (this.access) {
      for (const input of this.access.inputs.values()) input.onmidimessage = null
      this.access.onstatechange = null
    }
    this.access = null
    this.handlers = null
  }
}
