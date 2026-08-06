import { useEffect, useState } from 'react'
import { MAX_NICK_LENGTH, randomRoomCode, ROOM_CODE_RE } from '../../shared/protocol'
import { MidiManager, type MidiInputInfo } from '../audio/midi'
import { PRESET_OPTIONS, type PresetId } from '../audio/synth/presets'
import { startSession } from '../session'
import { useStore, type InstrumentSource } from '../state/store'

interface DeviceOption {
  deviceId: string
  label: string
}

export function JoinScreen(): React.JSX.Element {
  const phase = useStore((s) => s.phase)
  const error = useStore((s) => s.error)
  const storedNick = useStore((s) => s.nick)

  const [nick, setNick] = useState(storedNick)
  const [code, setCode] = useState(() => {
    const fromUrl = new URLSearchParams(location.search).get('room')?.toUpperCase() ?? ''
    return ROOM_CODE_RE.test(fromUrl) ? fromUrl : ''
  })
  const [mics, setMics] = useState<DeviceOption[]>([])
  const [inputs, setInputs] = useState<DeviceOption[]>([])
  const [micId, setMicId] = useState('')
  const [inputId, setInputId] = useState('')
  const [source, setSource] = useState<InstrumentSource>(
    MidiManager.supported ? 'midi' : 'none',
  )
  const [preset, setPreset] = useState<PresetId>('grand-piano')
  const [devicesLoaded, setDevicesLoaded] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const [midiDevices, setMidiDevices] = useState<MidiInputInfo[]>([])
  const [midiInputId, setMidiInputId] = useState('')

  const joining = phase === 'connecting'

  // Lists MIDI inputs for the picker. Called on mount (resolves silently if
  // permission was already granted) and again from a click gesture when the
  // user picks the MIDI option — Chrome only shows the permission prompt
  // while a gesture is fresh.
  async function probeMidi(): Promise<void> {
    if (!MidiManager.supported) return
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false })
      const list = (): MidiInputInfo[] =>
        [...access.inputs.values()].map((i) => ({ id: i.id, name: i.name ?? 'MIDI input' }))
      setMidiDevices(list())
      access.onstatechange = () => setMidiDevices(list())
    } catch {
      setMidiDevices([])
    }
  }

  useEffect(() => {
    void probeMidi()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Labels are only exposed after a permission grant, so this asks for the
  // mic once and immediately releases it.
  async function loadDevices(): Promise<void> {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
      for (const t of probe.getTracks()) t.stop()
    } catch {
      setLocalError('Microphone permission is needed to list devices.')
      return
    }
    const all = await navigator.mediaDevices.enumerateDevices()
    const audioIn = all
      .filter((d) => d.kind === 'audioinput')
      .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Audio input' }))
    setMics(audioIn)
    setInputs(audioIn)
    setDevicesLoaded(true)
    setLocalError(null)
  }

  useEffect(() => {
    setNick(storedNick)
  }, [storedNick])

  async function join(): Promise<void> {
    // Fire inside the click so a pending permission prompt can appear; the
    // session's own init() then resolves instantly from the grant.
    if (source === 'midi') void probeMidi()
    const trimmed = nick.trim()
    if (!trimmed) {
      setLocalError('Pick a nickname first.')
      return
    }
    const roomCode = code.trim().toUpperCase()
    if (!ROOM_CODE_RE.test(roomCode)) {
      setLocalError('Room codes are 5 letters/digits — create one if you need a room.')
      return
    }
    setLocalError(null)
    history.replaceState(null, '', `/?room=${roomCode}`)
    await startSession({
      code: roomCode,
      nick: trimmed,
      micDeviceId: micId || undefined,
      instrumentSource: source,
      instrumentDeviceId: inputId || undefined,
      midiInputId: midiInputId || null,
      preset,
    })
  }

  return (
    <div className="join-screen">
      <div className="join-card">
        <h1>Band Practice</h1>
        <p className="tagline">Walk in, talk, and play together.</p>

        <div className="banner">
          🎧 Use headphones. Instrument audio has echo cancellation off — on
          speakers, everyone will hear themselves back.
        </div>

        {(error ?? localError) && <div className="error">{error ?? localError}</div>}

        <label>
          Nickname
          <input
            value={nick}
            maxLength={MAX_NICK_LENGTH}
            onChange={(e) => setNick(e.target.value)}
            placeholder="Your name"
            disabled={joining}
          />
        </label>

        <label>
          Room code
          <div className="row">
            <input
              value={code}
              maxLength={5}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. XK4TP"
              disabled={joining}
            />
            <button
              type="button"
              onClick={() => setCode(randomRoomCode())}
              disabled={joining}
            >
              New room
            </button>
          </div>
        </label>

        <label>
          Instrument
          <select
            value={source}
            onChange={(e) => {
              const value = e.target.value as InstrumentSource
              setSource(value)
              // Surface the permission prompt on this gesture (see join()).
              if (value === 'midi') void probeMidi()
            }}
            disabled={joining}
          >
            <option value="none">None — just talking</option>
            <option value="midi" disabled={!MidiManager.supported}>
              MIDI keyboard → built-in synth
              {MidiManager.supported ? '' : ' (browser unsupported)'}
            </option>
            <option value="input">Audio input (guitar, interface…)</option>
          </select>
        </label>

        {source === 'midi' && (
          <>
            <label>
              MIDI input
              <select
                value={midiInputId}
                onChange={(e) => setMidiInputId(e.target.value)}
                disabled={joining}
              >
                <option value="">
                  {midiDevices.length === 0
                    ? 'No devices detected yet — allow MIDI access'
                    : 'All inputs'}
                </option>
                {midiDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sound
              <select
                value={preset}
                onChange={(e) => setPreset(e.target.value as PresetId)}
                disabled={joining}
              >
                {PRESET_OPTIONS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {!devicesLoaded ? (
          <button type="button" className="ghost" onClick={() => void loadDevices()}>
            Choose microphone{source === 'input' ? ' & instrument input' : ''}…
          </button>
        ) : (
          <>
            <label>
              Microphone
              <select value={micId} onChange={(e) => setMicId(e.target.value)}>
                <option value="">System default</option>
                {mics.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            {source === 'input' && (
              <label>
                Instrument input
                <select value={inputId} onChange={(e) => setInputId(e.target.value)}>
                  <option value="">System default</option>
                  {inputs.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        <button className="primary" onClick={() => void join()} disabled={joining}>
          {joining ? 'Joining…' : 'Join room'}
        </button>

        <p className="fine-print">
          Works best in Chrome/Edge. Firefox: no problem. Safari: no MIDI.
          Share the room code — or the URL after joining.
        </p>
      </div>
    </div>
  )
}
