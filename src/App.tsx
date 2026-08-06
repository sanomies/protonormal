import { Scene } from './game/Scene'
import { useStore } from './state/store'
import { Hud } from './ui/Hud'
import { JoinScreen } from './ui/JoinScreen'
import { PeepholeOverlay } from './ui/PeepholeOverlay'

export default function App(): React.JSX.Element {
  const phase = useStore((s) => s.phase)
  if (phase !== 'in-room') return <JoinScreen />
  return (
    <>
      <Scene />
      <Hud />
      <PeepholeOverlay />
    </>
  )
}
