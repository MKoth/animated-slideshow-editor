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
  const handleClick = () => {
    useNotificationStore.getState().notify('Not implemented yet.')
  }

  return (
    <div className="toolbar">
      {TOOLBAR_BUTTONS.map((label) => (
        <button key={label} className="toolbar__button" onClick={handleClick}>
          {label}
        </button>
      ))}
    </div>
  )
}
