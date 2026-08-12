import { useEffect } from 'react'
import { formatCombo, getShortcutHandler } from './shortcutRegistry'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return
      }
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
