import { useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { useMeshEditStore } from '../../stores/meshEditStore'
import { useEditingModeStore } from '../../stores/editingModeStore'
import { collectBones } from '../../engine/riggingQueries'

const WEIGHT_PAINT_TOOLS: readonly { id: string; label: string; shortcut: string }[] = [
  { id: 'paint', label: 'Paint', shortcut: '1' },
  { id: 'smooth', label: 'Smooth', shortcut: '2' },
  { id: 'fill', label: 'Fill', shortcut: '3' },
  { id: 'blur', label: 'Blur', shortcut: '4' },
  { id: 'autoWeights', label: 'Auto', shortcut: '5' },
]

export function WeightPaintToolbar() {
  const { engine } = useEngine()
  const mode = useEditingModeStore((state) => state.mode)
  const meshEditTool = useMeshEditStore((state) => state.meshEditTool)
  const weightPaintTool = useMeshEditStore((state) => state.weightPaintTool)
  const selectedBoneId = useMeshEditStore((state) => state.selectedBoneId)
  const brushRadius = useMeshEditStore((state) => state.brushRadius)
  const brushStrength = useMeshEditStore((state) => state.brushStrength)
  const heatmapVisible = useMeshEditStore((state) => state.heatmapVisible)
  const setWeightPaintTool = useMeshEditStore((state) => state.setWeightPaintTool)
  const setSelectedBoneId = useMeshEditStore((state) => state.setSelectedBoneId)
  const setBrushRadius = useMeshEditStore((state) => state.setBrushRadius)
  const setBrushStrength = useMeshEditStore((state) => state.setBrushStrength)
  const toggleHeatmap = useMeshEditStore((state) => state.toggleHeatmap)
  const [, setTick] = useState(0)

  useEngineEvent((event) => {
    if (
      event.type === 'NodeCreated' ||
      event.type === 'NodeRemoved' ||
      event.type === 'NodeRenamed'
    ) {
      setTick((t) => t + 1)
    }
  })

  if (mode !== 'weightPaint' && meshEditTool !== 'weightPaint') {
    return null
  }

  const slide = engine.getActiveSlide()
  if (!slide) {
    return null
  }

  const bones = collectBones(slide.scene.root)

  return (
    <div className="weight-paint-toolbar">
      <div className="weight-paint-toolbar__section">
        <label className="weight-paint-toolbar__label">Bone</label>
        <select
          className="weight-paint-toolbar__select"
          value={selectedBoneId ?? ''}
          onChange={(e) => setSelectedBoneId(e.target.value || null)}
        >
          <option value="">Select bone...</option>
          {bones.map((bone) => (
            <option key={bone.id} value={bone.id}>
              {bone.name}
            </option>
          ))}
        </select>
      </div>

      <div className="weight-paint-toolbar__separator" />

      <div className="weight-paint-toolbar__section">
        <label className="weight-paint-toolbar__label">Tool</label>
        <div className="weight-paint-toolbar__tools">
          {WEIGHT_PAINT_TOOLS.map((tool) => (
            <button
              key={tool.id}
              className={`weight-paint-toolbar__tool${
                weightPaintTool === tool.id ? ' weight-paint-toolbar__tool--active' : ''
              }`}
              title={`${tool.label} (${tool.shortcut})`}
              onClick={() =>
                setWeightPaintTool(tool.id as 'paint' | 'smooth' | 'fill' | 'blur' | 'autoWeights')
              }
            >
              {tool.label}
            </button>
          ))}
        </div>
      </div>

      <div className="weight-paint-toolbar__separator" />

      <div className="weight-paint-toolbar__section">
        <label className="weight-paint-toolbar__label">Radius: {brushRadius.toFixed(1)}</label>
        <input
          className="weight-paint-toolbar__slider"
          type="range"
          min="1"
          max="100"
          step="1"
          value={brushRadius}
          onChange={(e) => setBrushRadius(parseFloat(e.target.value))}
        />
      </div>

      <div className="weight-paint-toolbar__section">
        <label className="weight-paint-toolbar__label">
          Strength: {(brushStrength * 100).toFixed(0)}%
        </label>
        <input
          className="weight-paint-toolbar__slider"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={brushStrength}
          onChange={(e) => setBrushStrength(parseFloat(e.target.value))}
        />
      </div>

      <div className="weight-paint-toolbar__separator" />

      <div className="weight-paint-toolbar__section">
        <label className="weight-paint-toolbar__toggle">
          <input type="checkbox" checked={heatmapVisible} onChange={toggleHeatmap} />
          Heatmap
        </label>
      </div>

      {!selectedBoneId && (
        <>
          <div className="weight-paint-toolbar__separator" />
          <span className="weight-paint-toolbar__warning">Select a bone to paint</span>
        </>
      )}
      {selectedBoneId && weightPaintTool === 'paint' && (
        <>
          <div className="weight-paint-toolbar__separator" />
          <span className="weight-paint-toolbar__hint">Shift+drag to erase</span>
        </>
      )}
    </div>
  )
}
