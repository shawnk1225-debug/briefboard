import { setFullScreen } from '../canvas/fullScreen'
import { useStore } from '../store/store'
import { CollapseIcon, ExpandIcon } from './icons'

export function FullScreenButton() {
  const on = useStore((s) => s.fullScreen)
  const label = on ? 'Exit full screen' : 'Full screen'
  return (
    <button className="icon-btn" aria-label={label} aria-pressed={on} title={label} onClick={() => setFullScreen(!on)}>
      {on ? <CollapseIcon /> : <ExpandIcon />}
    </button>
  )
}
