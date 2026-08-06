import { useEffect, useState } from 'react'
import { PRESET_OPTIONS, type PresetId } from '../audio/synth/presets'
import { getSession } from '../session'
import { useStore, type InstrumentSource } from '../state/store'

// Computer-keyboard piano (A–K white keys, W/E/T/Y/U blacks), C4 base.
const KEY_TO_OFFSET: Record<string, number> = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12,
  KeyO: 13,
  KeyL: 14,
  KeyP: 15,
  Semicolon: 16,
}

export function InstrumentPanel(): React.JSX.Element {
  const source = useStore((s) => s.instrumentSource)
  const preset = useStore((s) => s.preset)
  const monitor = useStore((s) => s.monitor)
  const [octave, setOctave] = useState(0)

  // While the menu is open (pointer unlocked), the letter rows play notes —
  // handy for testing without a MIDI keyboard. Locked pointer = WASD moves,
  // so the listener bails immediately then.
  useEffect(() => {
    if (source !== 'midi') return
    const base = 60 + octave * 12
    const down = (e: KeyboardEvent): void => {
      if (document.pointerLockElement || e.repeat) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      if (e.code === 'KeyZ') return setOctave((o) => Math.max(-2, o - 1))
      if (e.code === 'KeyX') return setOctave((o) => Math.min(2, o + 1))
      const offset = KEY_TO_OFFSET[e.code]
      if (offset !== undefined) getSession()?.instrument?.noteOn(base + offset, 96)
    }
    const up = (e: KeyboardEvent): void => {
      const offset = KEY_TO_OFFSET[e.code]
      if (offset !== undefined) getSession()?.instrument?.noteOff(base + offset)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [source, octave])

  return (
    <div className="instrument-panel">
      <div className="panel-row">
        <label>
          Instrument
          <select
            value={source}
            onChange={(e) => {
              void getSession()?.setInstrumentSource(e.target.value as InstrumentSource)
            }}
          >
            <option value="none">Off</option>
            <option value="midi">MIDI keyboard → synth</option>
            <option value="input">Audio input</option>
          </select>
        </label>
        {source === 'midi' && (
          <label>
            Sound
            <select
              value={preset}
              onChange={(e) => getSession()?.setPreset(e.target.value as PresetId)}
            >
              {PRESET_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {source !== 'none' && (
        <div className="panel-row">
          <label className="check">
            <input
              type="checkbox"
              checked={monitor}
              onChange={(e) => getSession()?.setMonitor(e.target.checked)}
            />
            Hear my own instrument
          </label>
        </div>
      )}

      {source === 'midi' && <MidiStatus octave={octave} />}
    </div>
  )
}

function MidiStatus({ octave }: { octave: number }): React.JSX.Element {
  const midiAvailable = useStore((s) => s.midiAvailable)
  const midiInputs = useStore((s) => s.midiInputs)
  const midiInputId = useStore((s) => s.midiInputId)
  const midiActivity = useStore((s) => s.midiActivity)
  const instrumentReady = useStore((s) => s.instrumentReady)
  const [now, setNow] = useState(Date.now())

  // Only ticks while the menu is open; drives the activity dot decay.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 300)
    return () => clearInterval(t)
  }, [])

  const active = now - midiActivity < 700

  return (
    <div className="midi-status">
      <div className="status-row">
        <span className={active ? 'dot speaking' : 'dot'} />
        {midiAvailable !== true ? (
          <>
            <span>
              {midiAvailable === false
                ? 'MIDI access blocked — click the 🎹/lock icon in the address bar, allow MIDI, then'
                : 'Waiting for MIDI permission — look for a prompt or 🎹 icon in the address bar, then'}
            </span>
            <button type="button" onClick={() => void getSession()?.retryMidi()}>
              Retry
            </button>
          </>
        ) : midiInputs.length === 0 ? (
          <span>No MIDI device detected — plug one in (it attaches automatically)</span>
        ) : (
          <span>{active ? 'Receiving MIDI!' : 'Press a key on your keyboard…'}</span>
        )}
      </div>
      {midiAvailable === true && midiInputs.length > 0 && (
        <label>
          MIDI input
          <select
            value={midiInputId ?? ''}
            onChange={(e) => getSession()?.setMidiInput(e.target.value || null)}
          >
            <option value="">All inputs</option>
            {midiInputs.map((input) => (
              <option key={input.id} value={input.id}>
                {input.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="hint">
        {instrumentReady ? 'Sound loaded.' : 'Loading samples…'} Keyboard fallback: A–K keys
        while this menu is open (Z/X octave, now C{4 + octave}).
      </p>
    </div>
  )
}
