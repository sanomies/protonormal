import { getSession } from '../session'
import { useStore } from '../state/store'

export function PlayerList(): React.JSX.Element {
  const peers = useStore((s) => s.peers)
  const nick = useStore((s) => s.nick)
  const list = Object.values(peers)

  return (
    <div className="player-list">
      <div className="player-row self">
        <span className="dot" />
        <span className="name">{nick} (you)</span>
      </div>
      {list.length === 0 && <p className="hint">Nobody else here yet — share the room link.</p>}
      {list.map((peer) => (
        <div key={peer.id} className="player-row">
          <span className={peer.speaking ? 'dot speaking' : 'dot'} />
          <span className="name">
            {peer.nick}
            {peer.micMuted ? ' ·mic off' : ''}
            {peer.instrumentOn ? ' ·♪' : ''}
          </span>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={peer.localMuted ? 0 : peer.volume}
            disabled={peer.localMuted}
            onChange={(e) => getSession()?.setPeerVolume(peer.id, Number(e.target.value))}
          />
          <button
            type="button"
            onClick={() => getSession()?.setPeerMuted(peer.id, !peer.localMuted)}
          >
            {peer.localMuted ? 'Unmute' : 'Mute'}
          </button>
        </div>
      ))}
    </div>
  )
}
