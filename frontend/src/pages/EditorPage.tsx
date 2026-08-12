import { useEffect } from 'react'
import { useAssetUsageGuard } from '../app/useAssetUsageGuard'
import { useEngine } from '../app/useEngine'
import { EditorLayout } from '../components/editor/EditorLayout'
import { registerProvisionalShortcuts } from '../shortcuts/provisionalShortcuts'
import { useKeyboardShortcuts } from '../shortcuts/useKeyboardShortcuts'

export function EditorPage() {
  useKeyboardShortcuts()
  const { engine } = useEngine()
  useAssetUsageGuard(engine)

  useEffect(() => {
    const dispose = registerProvisionalShortcuts()
    return dispose
  }, [])

  return <EditorLayout />
}
