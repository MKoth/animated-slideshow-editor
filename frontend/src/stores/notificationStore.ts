import { create } from 'zustand'

export interface AppNotification {
  id: number
  message: string
}

const NOTIFICATION_DURATION_MS = 3000

let nextId = 1

interface NotificationState {
  notifications: AppNotification[]
  notify: (message: string) => void
  dismiss: (id: number) => void
}

export const useNotificationStore = create<NotificationState>()((set) => ({
  notifications: [],
  notify: (message) => {
    const id = nextId++
    set((state) => ({ notifications: [...state.notifications, { id, message }] }))
    setTimeout(() => {
      set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) }))
    }, NOTIFICATION_DURATION_MS)
  },
  dismiss: (id) =>
    set((state) => ({ notifications: state.notifications.filter((n) => n.id !== id) })),
}))
