import { useNotificationStore } from '../stores/notificationStore'
import { registerShortcut } from './shortcutRegistry'

export const PROVISIONAL_SHORTCUTS = [
  'ctrl+n',
  'ctrl+o',
  'ctrl+s',
  'ctrl+z',
  'ctrl+y',
  'delete',
  'space',
] as const

export function registerProvisionalShortcuts(): () => void {
  const disposers = PROVISIONAL_SHORTCUTS.map((combo) =>
    registerShortcut(combo, () => {
      useNotificationStore.getState().notify('Not implemented yet.')
    }),
  )
  return () => disposers.forEach((dispose) => dispose())
}
