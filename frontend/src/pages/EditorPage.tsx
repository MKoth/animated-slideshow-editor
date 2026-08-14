import { useEffect } from 'react'
import { useAssetUsageGuard } from '../app/useAssetUsageGuard'
import { useEngine } from '../app/useEngine'
import { DocumentTitle } from '../components/editor/DocumentTitle'
import { EditorLayout } from '../components/editor/EditorLayout'
import { RecoveryDialog } from '../components/recovery/RecoveryDialog'
import { registerClipboardShortcuts } from '../shortcuts/clipboardShortcuts'
import { registerProvisionalShortcuts } from '../shortcuts/provisionalShortcuts'
import { registerSaveShortcut } from '../shortcuts/saveShortcuts'
import { useKeyboardShortcuts } from '../shortcuts/useKeyboardShortcuts'

export function EditorPage() {
  useKeyboardShortcuts()
  const { engine, dispatch, persistence } = useEngine()
  useAssetUsageGuard(engine)

  useEffect(() => {
    const disposeClipboard = registerClipboardShortcuts(() => ({ engine, dispatch }))
    const disposeProvisional = registerProvisionalShortcuts()
    const disposeSave = registerSaveShortcut(() => ({ save: () => persistence.save() }))
    return () => {
      disposeClipboard()
      disposeProvisional()
      disposeSave()
    }
  }, [engine, dispatch, persistence])

  return (
    <>
      <DocumentTitle />
      <EditorLayout />
      <RecoveryDialog />
    </>
  )
}
