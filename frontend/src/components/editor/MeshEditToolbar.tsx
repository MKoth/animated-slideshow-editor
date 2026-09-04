import { useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { useMeshEditStore, type MeshEditTool } from '../../stores/meshEditStore'
import { useEditingModeStore } from '../../stores/editingModeStore'

const MESH_EDIT_TOOLS: readonly { id: MeshEditTool; label: string; shortcut?: string }[] = [
  { id: 'select', label: 'Select', shortcut: 'V' },
  { id: 'delete', label: 'Delete', shortcut: 'D' },
  { id: 'extrude', label: 'Extrude', shortcut: 'E' },
  { id: 'subdivide', label: 'Subdivide', shortcut: 'S' },
  { id: 'mirror', label: 'Mirror', shortcut: 'M' },
  { id: 'weightPaint', label: 'Weight Paint', shortcut: 'W' },
  { id: 'sculpt', label: 'Sculpt', shortcut: 'C' },
]

export function MeshEditToolbar() {
  const mode = useEditingModeStore((state) => state.mode)
  const meshEditNodeId = useMeshEditStore((state) => state.meshEditNodeId)
  const meshEditTool = useMeshEditStore((state) => state.meshEditTool)
  const setMeshEditTool = useMeshEditStore((state) => state.setMeshEditTool)
  const { engine } = useEngine()
  const [, setTick] = useState(0)

  useEngineEvent((event) => {
    if (
      event.type === 'MeshChanged' ||
      event.type === 'NodeCreated' ||
      event.type === 'NodeRemoved'
    ) {
      setTick((t) => t + 1)
    }
  })

  // Show when in meshEdit or weightPaint mode, or when meshEditNodeId is set (covers both)
  const isMeshEditing = mode === 'meshEdit' || mode === 'weightPaint' || !!meshEditNodeId
  if (!isMeshEditing || !meshEditNodeId) return null
  // Don't show when weightPaint toolbar is active? Still show tool selector — keep visible to allow switching
  // But hide if no mesh? Check
  const activeSlide = engine.getActiveSlide()
  if (!activeSlide) return null
  const node = (() => {
    try {
      return activeSlide.scene.getNode(meshEditNodeId)
    } catch {
      return null
    }
  })()
  if (!node?.components.mesh) return null

  const shapes = node.components.mesh.shapes ?? []
  const isFrozen = shapes.length > 0
  const frozenMessage = 'Remove Shapes to edit topology'

  return (
    <div className="weight-paint-toolbar" aria-label="Mesh Edit toolbar">
      <div className="weight-paint-toolbar__section">
        <label className="weight-paint-toolbar__label">Mesh Edit Tool</label>
        <div className="weight-paint-toolbar__tools">
          {MESH_EDIT_TOOLS.map((tool) => {
            const isActive = meshEditTool === tool.id
            const isTopologyTool =
              tool.id === 'delete' ||
              tool.id === 'extrude' ||
              tool.id === 'subdivide' ||
              tool.id === 'mirror'
            const disabled = isTopologyTool && isFrozen
            return (
              <button
                key={tool.id}
                className={`weight-paint-toolbar__tool${
                  isActive ? ' weight-paint-toolbar__tool--active' : ''
                }`}
                title={
                  disabled
                    ? frozenMessage
                    : tool.shortcut
                      ? `${tool.label} (${tool.shortcut})`
                      : tool.label
                }
                disabled={disabled}
                aria-pressed={isActive}
                onClick={() => {
                  if (disabled) return
                  setMeshEditTool(tool.id)
                }}
              >
                {tool.label}
              </button>
            )
          })}
        </div>
      </div>
      {isFrozen && (
        <>
          <div className="weight-paint-toolbar__separator" />
          <span className="weight-paint-toolbar__warning" title={frozenMessage}>
            Topology locked — sculpt & weight paint remain
          </span>
        </>
      )}
    </div>
  )
}
