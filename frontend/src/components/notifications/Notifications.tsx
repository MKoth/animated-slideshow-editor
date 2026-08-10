import { useNotificationStore } from '../../stores/notificationStore'

export function Notifications() {
  const notifications = useNotificationStore((state) => state.notifications)
  const dismiss = useNotificationStore((state) => state.dismiss)

  return (
    <div className="notifications" aria-live="polite">
      {notifications.map((notification) => (
        <div key={notification.id} className="notification">
          <span className="notification__message">{notification.message}</span>
          <button className="notification__dismiss" onClick={() => dismiss(notification.id)}>
            Dismiss
          </button>
        </div>
      ))}
    </div>
  )
}
