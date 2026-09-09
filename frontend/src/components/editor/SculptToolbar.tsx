import { useEffect, useMemo, useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { useMeshEditStore } from '../../stores/meshEditStore'
import { useShapeGhostStore } from '../../stores/shapeGhostStore'
import { useOverlayVisibilityStore } from '../../stores/overlayVisibilityStore'
import { useEditingModeStore } from '../../stores/editingModeStore'

export function SculptToolbar() {
  const { engine } = useEngine()
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
    () => (node?.components.mesh?.shapes ?? []) as readonly { id: string; name: string }[],
    [node?.components.mesh?.shapes],
  )
  const hasShapes = shapes.length > 0

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

  // Auto-select first shape if none active (deferred)
  useEffect(() => {
    if (hasShapes && !activeShapeId) {
      const first = shapes[0]
      if (first) setActiveShapeId(first.id)
    }
  }, [hasShapes, activeShapeId, shapes, setActiveShapeId])

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
          {shapes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
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
          {shapes
            .filter((s) => s.id !== activeShapeId)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
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
