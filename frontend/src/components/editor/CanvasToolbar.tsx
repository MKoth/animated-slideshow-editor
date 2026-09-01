import { useEditingModeStore, type EditingMode } from '../../stores/editingModeStore'
import { useMeshEditStore } from '../../stores/meshEditStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useBoneEditStore } from '../../stores/boneEditStore'
import { useOverlayVisibilityStore } from '../../stores/overlayVisibilityStore'

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
  const boneEditing = useBoneEditStore((state) => state.isEditing)
  const selectedBoneId = useBoneEditStore((state) => state.selectedBoneId)
  const meshVisible = useOverlayVisibilityStore((state) => state.meshVisible)
  const bonesVisible = useOverlayVisibilityStore((state) => state.bonesVisible)
  const toggleMeshVisible = useOverlayVisibilityStore((state) => state.toggleMeshVisible)
  const toggleBonesVisible = useOverlayVisibilityStore((state) => state.toggleBonesVisible)

  const handleModeChange = (newMode: EditingMode) => {
    // exit bone edit when switching to other modes
    if (boneEditing) {
      useBoneEditStore.getState().exit()
    }
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

  const handleBoneEditToggle = () => {
    if (boneEditing) {
      useBoneEditStore.getState().exit()
      return
    }
    // enter bone edit: try to use selected bone if any; otherwise null and user will pick by clicking
    const selectedId = useSelectionStore.getState().selectedIds[0] ?? null
    useBoneEditStore.getState().enter(selectedId)
    // clear other editing modes
    if (meshEditNodeId) {
      useMeshEditStore.getState().exitMeshEdit()
    }
    if (mode !== 'default') {
      exitMode()
    }
  }

  const displayMode = boneEditing
    ? ('boneEdit' as EditingMode)
    : meshEditNodeId
      ? meshEditTool === 'weightPaint'
        ? 'weightPaint'
        : 'meshEdit'
      : mode

  const displayLabel = boneEditing
    ? selectedBoneId
      ? `Bone Edit: ${selectedBoneId.slice(0, 8)}`
      : 'Bone Edit'
    : (MODE_LABELS[displayMode as EditingMode] ?? displayMode)

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
        <button
          className={`canvas-toolbar__button${boneEditing ? ' canvas-toolbar__button--active' : ''}`}
          onClick={handleBoneEditToggle}
          title="Edit bone joints (drag head/tail)"
        >
          {boneEditing ? 'Exit Bone Edit' : 'Edit Bone'}
        </button>
      </div>
      <div className="canvas-toolbar__buttons" style={{ marginTop: 4 }}>
        <label
          className="canvas-toolbar__toggle"
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}
        >
          <input type="checkbox" checked={meshVisible} onChange={toggleMeshVisible} />
          Mesh
        </label>
        <label
          className="canvas-toolbar__toggle"
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}
        >
          <input type="checkbox" checked={bonesVisible} onChange={toggleBonesVisible} />
          Bones
        </label>
        {boneEditing && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 8 }}>
            Click bone, then drag head/tail. Esc to exit.
          </span>
        )}
      </div>
      <div className="canvas-toolbar__indicator">
        <span className="canvas-toolbar__indicator-label">Mode:</span>
        <span
          className={`canvas-toolbar__indicator-value${
            displayMode !== 'default' ? ' canvas-toolbar__indicator-value--active' : ''
          }`}
        >
          {displayLabel}
        </span>
      </div>
    </div>
  )
}
