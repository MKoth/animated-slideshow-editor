import { useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { useMeshEditStore } from '../../stores/meshEditStore'
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

  if (mode !== 'meshEdit' && (meshEditTool as string) !== 'sculpt') {
    // Also show when meshEditTool is sculpt even if editingMode is not meshEdit (meshEditNodeId drives)
    // WeightPaintToolbar checks both mode and meshEditTool; follow same pattern but ensure sculpt visible when tool is sculpt
    if ((meshEditTool as string) !== 'sculpt') return null
  }
  if ((meshEditTool as string) !== 'sculpt') return null
  if (!meshEditNodeId) return null

  const scene = engine.getActiveSlide()?.scene ?? null
  if (!scene) return null
  const node = (() => {
    try {
      return scene.getNode(meshEditNodeId)
    } catch {
      return null
    }
  })()
  if (!node?.components.mesh) return null

  const shapes = (node.components.mesh.shapes ?? []) as readonly { id: string; name: string }[]
  const hasShapes = shapes.length > 0

  // Auto-select first shape if none active
  if (hasShapes && !activeShapeId) {
    const first = shapes[0]
    if (first) {
      // Defer to avoid render side-effect
      queueMicrotask(() => setActiveShapeId(first.id))
    }
  }

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

      {!hasShapes && (
        <>
          <div className="weight-paint-toolbar__separator" />
          <span className="weight-paint-toolbar__warning">Create a Shape to sculpt</span>
        </>
      )}
    </div>
  )
}
