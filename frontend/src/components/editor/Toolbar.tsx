import { useEngine } from '../../app/useEngine'
import { useNotificationStore } from '../../stores/notificationStore'

const TOOLBAR_BUTTONS = [
  'New Project',
  'Open',
  'Save',
  'Undo',
  'Redo',
  'Play',
  'Pause',
  'Stop',
  'AI Assistant',
] as const

export function Toolbar() {
  const { persistence } = useEngine()

  const handleClick = (label: string) => {
    if (label === 'Save') {
      persistence.save()
      return
    }
    useNotificationStore.getState().notify('Not implemented yet.')
  }

  return (
    <div className="toolbar">
      {TOOLBAR_BUTTONS.map((label) => (
        <button key={label} className="toolbar__button" onClick={() => handleClick(label)}>
          {label}
        </button>
      ))}
    </div>
  )
}
