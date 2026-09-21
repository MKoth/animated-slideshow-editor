import { useEffect, useMemo, useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { useMeshEditStore } from '../../stores/meshEditStore'
import { useShapeGhostStore } from '../../stores/shapeGhostStore'
import { useOverlayVisibilityStore } from '../../stores/overlayVisibilityStore'
import { useEditingModeStore } from '../../stores/editingModeStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { CreateShapeCommand, DuplicateShapeCommand } from '../../engine/commands'
import { groupShapesByCategory, uniqueShapeName, type Shape } from '../../engine/shape'
import { useShapePreviewStore } from '../../stores/shapePreviewStore'

export function SculptToolbar() {
  const { engine, dispatch } = useEngine()
  const mode = useEditingModeStore((state) => state.mode)
  const meshEditNodeId = useMeshEditStore((state) => state.meshEditNodeId)
  const meshEditTool = useMeshEditStore((state) => state.meshEditTool)
  const sculptRadius = useMeshEditStore((state) => state.sculptRadius)
  const sculptStrength = useMeshEditStore((state) => state.sculptStrength)
  const sculptFalloff = useMeshEditStore((state) => state.sculptFalloff)
  const activeShapeId = useMeshEditStore((state) => state.activeShapeId)
  const setSculptRadius = useMeshEditStore((state) => state.setSculptRadius)
  const setSculptStrength = useMeshEditStore((state) => state.setSculptStrength)
  const setSculptFalloff = useMeshEditStore((state) => state.setSculptFalloff)
  const setActiveShapeId = useMeshEditStore((state) => state.setActiveShapeId)
  const ghostShapeId = useShapeGhostStore((state) => state.ghostShapeId)
  const setGhost = useShapeGhostStore((state) => state.setGhost)
  const vertexSize = useOverlayVisibilityStore((state) => state.vertexSize)
  const setVertexSize = useOverlayVisibilityStore((state) => state.setVertexSize)
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

  const scene = engine.getActiveSlide()?.scene ?? null
  const node = (() => {
    if (!meshEditNodeId || !scene) return null
    try {
      return scene.getNode(meshEditNodeId)
    } catch {
      return null
    }
  })()
  const shapes = useMemo(
    () => (node?.components.mesh?.shapes ?? []) as readonly Shape[],
    [node?.components.mesh?.shapes],
  )
  const categories = useMemo(
    () => node?.components.mesh?.shapeCategories ?? [],
    [node?.components.mesh?.shapeCategories],
  )
  const shapeGroups = useMemo(() => groupShapesByCategory(shapes, categories), [shapes, categories])
  const hasShapes = shapes.length > 0
  const nodeId = node?.id ?? null

  // Clear stale ghost if its shape was deleted or now equals active
  useEffect(() => {
    if (!ghostShapeId) return
    if (!node) {
      setGhost(null)
      return
    }
    const exists = shapes.some((s) => s.id === ghostShapeId)
    if (!exists || ghostShapeId === activeShapeId) {
      setGhost(null)
    }
  }, [ghostShapeId, activeShapeId, shapes, setGhost, node])

  // Clear ghost when node changes (per-mesh ghost, same-mesh only)
  useEffect(() => {
    if (!meshEditNodeId && ghostShapeId) {
      setGhost(null)
    }
  }, [meshEditNodeId, ghostShapeId, setGhost])

  // Auto-select first shape if none active (deferred) — prefer the shape
  // already selected (previewed) in the Inspector for this node.
  useEffect(() => {
    if (!hasShapes || activeShapeId) return
    const preview = useShapePreviewStore.getState()
    const inspected =
      preview.previewNodeId === nodeId && preview.previewShapeId
        ? shapes.find((s) => s.id === preview.previewShapeId)
        : undefined
    const next = inspected ?? shapes[0]
    if (next) setActiveShapeId(next.id)
  }, [hasShapes, activeShapeId, shapes, setActiveShapeId, nodeId])

  // A stale Inspector Preview on a different shape would pin the canvas to that
  // shape while strokes commit to the active one — drop it while sculpting.
  useEffect(() => {
    if (!activeShapeId || !nodeId) return
    const preview = useShapePreviewStore.getState()
    if (
      preview.previewNodeId === nodeId &&
      preview.previewShapeId &&
      preview.previewShapeId !== activeShapeId
    ) {
      useShapePreviewStore.getState().clearPreview()
    }
  }, [activeShapeId, nodeId])

  const handleAddShape = () => {
    if (!meshEditNodeId) return
    const selected =
      activeShapeId && shapes.some((s) => s.id === activeShapeId) ? activeShapeId : null
    const result = selected
      ? dispatch(new DuplicateShapeCommand({ nodeId: meshEditNodeId, shapeId: selected }))
      : dispatch(
          new CreateShapeCommand({
            nodeId: meshEditNodeId,
            name: uniqueShapeName('Shape', shapes, null),
            categoryId: null,
          }),
        )
    if (!result.ok) {
      useNotificationStore.getState().notify(result.error.message)
      return
    }
    const newShapeId = (result.inverse as { shapeId?: string })?.shapeId
    if (newShapeId) setActiveShapeId(newShapeId)
  }

  if (mode !== 'meshEdit' && (meshEditTool as string) !== 'sculpt') {
    if ((meshEditTool as string) !== 'sculpt') return null
  }
  if ((meshEditTool as string) !== 'sculpt') return null
  if (!meshEditNodeId) return null
  if (!scene) return null
  if (!node?.components.mesh) return null

  return (
    <div className="weight-paint-toolbar" aria-label="Sculpt toolbar">
      <div className="weight-paint-toolbar__section">
        <label className="weight-paint-toolbar__label" htmlFor="sculpt-shape-select">
          Shape
        </label>
        <select
          id="sculpt-shape-select"
          className="weight-paint-toolbar__select"
          value={activeShapeId ?? ''}
          onChange={(e) => setActiveShapeId(e.target.value || null)}
          disabled={!hasShapes}
        >
          {!hasShapes && <option value="">No Shapes — Create one</option>}
          {shapeGroups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.shapes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          className="weight-paint-toolbar__tool"
          aria-label="Add Shape"
          title="Add Shape — duplicates the selected Shape, otherwise creates a new one"
          onClick={handleAddShape}
        >
          +
        </button>
      </div>

      <div className="weight-paint-toolbar__separator" />

      <div className="weight-paint-toolbar__section">
        <label className="weight-paint-toolbar__label">Radius: {sculptRadius.toFixed(0)}px</label>
        <input
          className="weight-paint-toolbar__slider"
          type="range"
          min={1}
          max={100}
          step={1}
          value={sculptRadius}
          onChange={(e) => setSculptRadius(parseFloat(e.target.value))}
          aria-label="Sculpt radius"
        />
      </div>

      <div className="weight-paint-toolbar__section">
        <label className="weight-paint-toolbar__label">
          Strength: {(sculptStrength * 100).toFixed(0)}%
        </label>
        <input
          className="weight-paint-toolbar__slider"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={sculptStrength}
          onChange={(e) => setSculptStrength(parseFloat(e.target.value))}
          aria-label="Sculpt strength"
        />
      </div>

      <div className="weight-paint-toolbar__section">
        <label className="weight-paint-toolbar__label">Falloff: {sculptFalloff.toFixed(1)}</label>
        <input
          className="weight-paint-toolbar__slider"
          type="range"
          min={0.2}
          max={3}
          step={0.1}
          value={sculptFalloff}
          onChange={(e) => setSculptFalloff(parseFloat(e.target.value))}
          aria-label="Sculpt falloff"
        />
      </div>

      <div className="weight-paint-toolbar__separator" />
      <span className="weight-paint-toolbar__hint">Drag to push • Shift to invert (pull)</span>

      <div className="weight-paint-toolbar__separator" />
      <div className="weight-paint-toolbar__section">
        <label className="weight-paint-toolbar__label" htmlFor="sculpt-vertex-size">
          Vertex Size: {vertexSize}px
        </label>
        <input
          id="sculpt-vertex-size"
          className="weight-paint-toolbar__slider"
          type="range"
          min={2}
          max={12}
          step={1}
          value={vertexSize}
          onChange={(e) => setVertexSize(parseFloat(e.target.value))}
          aria-label="Vertex size"
        />
      </div>

      <div className="weight-paint-toolbar__separator" />
      <div className="weight-paint-toolbar__section">
        <label className="weight-paint-toolbar__label" htmlFor="sculpt-ghost-select">
          Ghost
        </label>
        <select
          id="sculpt-ghost-select"
          className="weight-paint-toolbar__select"
          value={ghostShapeId ?? ''}
          onChange={(e) => setGhost(e.target.value || null)}
          disabled={shapes.length < 2}
          title={
            shapes.length < 2
              ? 'Create at least 2 Shapes to compare'
              : 'Ghost shape (half-transparent behind)'
          }
          aria-label="Ghost shape"
        >
          <option value="">Off</option>
          {shapeGroups.map((group) => {
            const ghostOptions = group.shapes.filter((s) => s.id !== activeShapeId)
            if (ghostOptions.length === 0) return null
            return (
              <optgroup key={group.label} label={group.label}>
                {ghostOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            )
          })}
        </select>
      </div>

      {!hasShapes && (
        <>
          <div className="weight-paint-toolbar__separator" />
          <span className="weight-paint-toolbar__warning">Create a Shape to sculpt</span>
        </>
      )}
    </div>
  )
}
