import { useEditingModeStore, type EditingMode } from '../../stores/editingModeStore'
import { useMeshEditStore } from '../../stores/meshEditStore'
import { useSelectionStore } from '../../stores/selectionStore'

const RIGGING_BUTTONS: readonly { mode: EditingMode; label: string }[] = [
  { mode: 'rigging', label: 'Rigging Mode' },
  { mode: 'boneCreation', label: 'Create Bone' },
  { mode: 'ikTarget', label: 'Create IK Target' },
  { mode: 'poleVector', label: 'Create Pole Vector' },
  { mode: 'meshEdit', label: 'Enter Mesh Edit' },
  { mode: 'weightPaint', label: 'Enter Weight Paint' },
]

const MODE_LABELS: Record<EditingMode, string> = {
  default: 'Default',
  boneCreation: 'Bone Creation',
  ikTarget: 'IK Target Placement',
  poleVector: 'Pole Vector Placement',
  meshEdit: 'Mesh Edit',
  weightPaint: 'Weight Paint',
  rigging: 'Rigging',
}

export function CanvasToolbar() {
  const mode = useEditingModeStore((state) => state.mode)
  const setMode = useEditingModeStore((state) => state.setMode)
  const exitMode = useEditingModeStore((state) => state.exitMode)
  const meshEditNodeId = useMeshEditStore((state) => state.meshEditNodeId)
  const meshEditTool = useMeshEditStore((state) => state.meshEditTool)

  const handleModeChange = (newMode: EditingMode) => {
    if (mode === newMode) {
      exitMode()
      if (newMode === 'meshEdit' || newMode === 'weightPaint') {
        useMeshEditStore.getState().exitMeshEdit()
      }
      return
    }

    setMode(newMode)

    if (newMode === 'meshEdit' || newMode === 'weightPaint') {
      const selectedId = useSelectionStore.getState().selectedIds[0]
      if (selectedId) {
        useMeshEditStore.getState().enterMeshEdit(selectedId)
        if (newMode === 'weightPaint') {
          useMeshEditStore.getState().setMeshEditTool('weightPaint')
        }
      }
    }
  }

  const displayMode = meshEditNodeId
    ? meshEditTool === 'weightPaint'
      ? 'weightPaint'
      : 'meshEdit'
    : mode

  return (
    <div className="canvas-toolbar">
      <div className="canvas-toolbar__buttons">
        {RIGGING_BUTTONS.map(({ mode: buttonMode, label }) => {
          const isActive = displayMode === buttonMode
          return (
            <button
              key={buttonMode}
              className={`canvas-toolbar__button${isActive ? ' canvas-toolbar__button--active' : ''}`}
              onClick={() => handleModeChange(buttonMode)}
            >
              {label}
            </button>
          )
        })}
      </div>
      <div className="canvas-toolbar__indicator">
        <span className="canvas-toolbar__indicator-label">Mode:</span>
        <span
          className={`canvas-toolbar__indicator-value${
            displayMode !== 'default' ? ' canvas-toolbar__indicator-value--active' : ''
          }`}
        >
          {MODE_LABELS[displayMode]}
        </span>
      </div>
    </div>
  )
}
