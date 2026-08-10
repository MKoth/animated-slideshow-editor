import { useEffect } from 'react'
import { EditorLayout } from '../components/editor/EditorLayout'
import { registerProvisionalShortcuts } from '../shortcuts/provisionalShortcuts'
import { useKeyboardShortcuts } from '../shortcuts/useKeyboardShortcuts'

export function EditorPage() {
  useKeyboardShortcuts()

  useEffect(() => {
    const dispose = registerProvisionalShortcuts()
    return dispose
  }, [])

  return <EditorLayout />
}
