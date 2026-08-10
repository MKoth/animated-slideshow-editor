import { useEffect } from 'react'
import { formatCombo, getShortcutHandler } from './shortcutRegistry'

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const combo = formatCombo(event)
      if (!combo) {
        return
      }
      const shortcutHandler = getShortcutHandler(combo)
      if (!shortcutHandler) {
        return
      }
      event.preventDefault()
      shortcutHandler(event)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
