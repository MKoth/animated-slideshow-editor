import { useUiStore } from '../../stores/uiStore'
import { BackendStatus } from './BackendStatus'
import { PingButton } from './PingButton'

export function StatusBar() {
  const theme = useUiStore((state) => state.theme)
  const toggleTheme = useUiStore((state) => state.toggleTheme)

  return (
    <footer className="status-bar">
      <div className="status-bar__left">
        <span>Ready</span>
        <BackendStatus />
        <PingButton />
      </div>
      <div className="status-bar__right">
        <span>Zoom: 100%</span>
        <span>FPS: --</span>
        <button className="theme-toggle" onClick={toggleTheme}>
          {theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
        </button>
      </div>
    </footer>
  )
}
