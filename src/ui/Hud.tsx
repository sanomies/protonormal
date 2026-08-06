import { getSession } from '../session'
import { FOV_MAX, FOV_MIN, setFov, setPsxHeavy, useStore } from '../state/store'
import { InstrumentPanel } from './InstrumentPanel'
import { PlayerList } from './PlayerList'

export function Hud(): React.JSX.Element {
  const panelOpen = useStore((s) => s.panelOpen)
  const roomCode = useStore((s) => s.roomCode)
  const micMuted = useStore((s) => s.micMuted)
  const fov = useStore((s) => s.fov)
  const lampNearby = useStore((s) => s.lampNearby)
  const carryingLamp = useStore((s) => s.carryingLamp)
  const psxHeavy = useStore((s) => s.psxHeavy)

  return (
    <div className="hud">
      <div className="hud-top">
        <span className="room-chip" title="Copy invite link">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(`${location.origin}/?room=${roomCode ?? ''}`)
            }}
          >
            Room {roomCode} ⧉
          </button>
        </span>
        {micMuted && <span className="mic-chip">mic off</span>}
      </div>

      {panelOpen ? (
        <div className="panel">
          <div className="panel-head">
            <strong>Menu</strong>
            <span className="hint">click the room to walk (WASD + mouse)</span>
          </div>

          <div className="panel-row">
            <button type="button" onClick={() => getSession()?.setMicMuted(!micMuted)}>
              {micMuted ? 'Unmute mic' : 'Mute mic'}
            </button>
            <button type="button" className="danger" onClick={() => getSession()?.leave()}>
              Leave room
            </button>
          </div>

          <div className="panel-row">
            <label>
              Field of view — {fov}°
              <input
                type="range"
                min={FOV_MIN}
                max={FOV_MAX}
                step={1}
                value={fov}
                onChange={(e) => setFov(Number(e.target.value))}
              />
            </label>
          </div>

          <label className="check">
            <input
              type="checkbox"
              checked={psxHeavy}
              onChange={(e) => setPsxHeavy(e.target.checked)}
            />
            Extra crunchy PSX
          </label>

          <InstrumentPanel />
          <PlayerList />

          <p className="hint">🎧 headphones strongly recommended</p>
        </div>
      ) : (
        <div className="hud-bottom">
          {carryingLamp
            ? 'E — drop lamp · click — on/off · '
            : lampNearby
              ? 'E — pick up lamp · click — on/off · '
              : ''}
          Esc — menu & mixer
        </div>
      )}
    </div>
  )
}
