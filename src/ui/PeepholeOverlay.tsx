import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import videoUrl from '../video/door-eye-video.mp4'

const FADE_MS = 700

// Looking through the front-door peephole: a looping video in a circular
// vignette that fades in when opened (E at the door) and fades back out on
// E/Esc. The element stays mounted through the fade-out so the transition
// can finish before the video unloads.
export function PeepholeOverlay(): React.JSX.Element | null {
  const open = useStore((s) => s.peepholeOpen)
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (open) {
      setMounted(true)
      // Two frames so the browser commits opacity:0 before transitioning.
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => setVisible(true)),
      )
      return () => cancelAnimationFrame(raf)
    }
    setVisible(false)
    const timer = setTimeout(() => setMounted(false), FADE_MS)
    return () => clearTimeout(timer)
  }, [open])

  if (!mounted) return null
  return (
    <div className={visible ? 'peephole visible' : 'peephole'}>
      <video ref={video} src={videoUrl} autoPlay loop playsInline />
    </div>
  )
}
