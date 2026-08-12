import { useEffect } from 'react'
import { useAssetUsageGuard } from '../app/useAssetUsageGuard'
import { useEngine } from '../app/useEngine'
import { EditorLayout } from '../components/editor/EditorLayout'
import { registerClipboardShortcuts } from '../shortcuts/clipboardShortcuts'
import { registerProvisionalShortcuts } from '../shortcuts/provisionalShortcuts'
import { useKeyboardShortcuts } from '../shortcuts/useKeyboardShortcuts'

export function EditorPage() {
  useKeyboardShortcuts()
  const { engine, dispatch } = useEngine()
  useAssetUsageGuard(engine)

  useEffect(() => {
    const disposeClipboard = registerClipboardShortcuts(() => ({ engine, dispatch }))
    const disposeProvisional = registerProvisionalShortcuts()
    return () => {
      disposeClipboard()
      disposeProvisional()
    }
  }, [engine, dispatch])

  return <EditorLayout />
}
