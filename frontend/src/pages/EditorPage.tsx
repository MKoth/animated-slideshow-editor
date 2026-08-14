import { useEffect } from 'react'
import { useEngine } from '../app/useEngine'
import { DocumentTitle } from '../components/editor/DocumentTitle'
import { EditorLayout } from '../components/editor/EditorLayout'
import { MissingAssetsDialog } from '../components/missingAssets/MissingAssetsDialog'
import { ProjectsDialog } from '../components/projects/ProjectsDialog'
import { RecoveryDialog } from '../components/recovery/RecoveryDialog'
import { registerClipboardShortcuts } from '../shortcuts/clipboardShortcuts'
import { registerProvisionalShortcuts } from '../shortcuts/provisionalShortcuts'
import { registerSaveShortcut } from '../shortcuts/saveShortcuts'
import { useKeyboardShortcuts } from '../shortcuts/useKeyboardShortcuts'

export function EditorPage() {
  useKeyboardShortcuts()
  const { engine, dispatch, persistence } = useEngine()

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
      <MissingAssetsDialog />
      <ProjectsDialog />
    </>
  )
}
