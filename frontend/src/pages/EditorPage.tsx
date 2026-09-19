import { useEffect } from 'react'
import { useEngine } from '../app/useEngine'
import { DocumentTitle } from '../components/editor/DocumentTitle'
import { EditorLayout } from '../components/editor/EditorLayout'
import { MissingAssetsDialog } from '../components/missingAssets/MissingAssetsDialog'
import { ObjectTimelineModal } from '../components/panels/ObjectTimelineModal'
import { ProjectsDialog } from '../components/projects/ProjectsDialog'
import { RecoveryDialog } from '../components/recovery/RecoveryDialog'
import { registerClipboardShortcuts } from '../shortcuts/clipboardShortcuts'
import { registerMeshEditShortcuts } from '../shortcuts/meshEditShortcuts'
import { registerObjectTimelineShortcut } from '../shortcuts/objectTimelineShortcut'
import { registerProvisionalShortcuts } from '../shortcuts/provisionalShortcuts'
import { registerSaveShortcut } from '../shortcuts/saveShortcuts'
import { registerUndoRedoShortcuts } from '../shortcuts/undoRedoShortcuts'
import { useKeyboardShortcuts } from '../shortcuts/useKeyboardShortcuts'

export function EditorPage() {
  useKeyboardShortcuts()
  const { engine, dispatch, persistence, dispatcher } = useEngine()

  useEffect(() => {
    const disposeClipboard = registerClipboardShortcuts(() => ({ engine, dispatch }))
    const disposeProvisional = registerProvisionalShortcuts()
    const disposeSave = registerSaveShortcut(() => ({ save: () => persistence.save() }))
    const disposeMeshEdit = registerMeshEditShortcuts()
    const disposeObjectTimeline = registerObjectTimelineShortcut()
    const disposeUndoRedo = dispatcher
      ? registerUndoRedoShortcuts(() => ({ dispatcher }))
      : () => {}
    return () => {
      disposeClipboard()
      disposeProvisional()
      disposeSave()
      disposeMeshEdit()
      disposeObjectTimeline()
      disposeUndoRedo()
    }
  }, [engine, dispatch, persistence, dispatcher])

  return (
    <>
      <DocumentTitle />
      <EditorLayout />
      <ObjectTimelineModal />
      <RecoveryDialog />
      <MissingAssetsDialog />
      <ProjectsDialog />
    </>
  )
}
