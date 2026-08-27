import { useState } from 'react'
import type { SceneNode } from '../../engine'
import type { ChartComponent, DataKeyframe, DataPoint } from '../../engine/components'
import type { DispatchCommand } from '../../engine/commands'
import { SetChartComponentCommand } from '../../engine/commands'
import { runCommand } from './sectionHelpers'

function mergeChart(node: SceneNode, patch: Partial<ChartComponent>): ChartComponent {
  const c = node.components.chart!
  return { ...c, ...patch }
}

interface DataKeyframesPanelProps {
  target: SceneNode
  dispatch: DispatchCommand
  notify: (message: string) => void
  playing: boolean
  currentTime: number
}

export function DataKeyframesPanel({
  target,
  dispatch,
  notify,
  playing,
  currentTime,
}: DataKeyframesPanelProps) {
  const chart = target.components.chart
  const keyframes = chart?.dataKeyframes ?? []
  const [newKeyframeTime, setNewKeyframeTime] = useState<string>(String(Math.floor(currentTime)))
  const [newPointLabel, setNewPointLabel] = useState('')
  const [newPointValue, setNewPointValue] = useState('')

  if (!chart) return null

  const apply = (patch: Partial<ChartComponent>) => {
    runCommand(notify, () => {
      const updated = mergeChart(target, patch)
      return dispatch(new SetChartComponentCommand({ nodeId: target.id, chart: updated }))
    })
  }

  const handleAddKeyframe = () => {
    const time = Number(newKeyframeTime)
    if (!Number.isFinite(time) || time < 0) {
      notify('Keyframe time must be a non-negative number')
      return
    }

    const existingKeyframe = keyframes.find((kf) => kf.time === time)
    if (existingKeyframe) {
      notify(`A keyframe already exists at time ${time}`)
      return
    }

    const dataPoints: DataPoint[] = []
    if (newPointLabel.trim()) {
      const value = Number(newPointValue)
      if (!Number.isFinite(value)) {
        notify('Point value must be a number')
        return
      }
      dataPoints.push({ label: newPointLabel.trim(), value })
    }

    const newKeyframe: DataKeyframe = { time, dataPoints }
    const newKeyframes = [...keyframes, newKeyframe].sort((a, b) => a.time - b.time)
    apply({ dataKeyframes: newKeyframes })
    setNewKeyframeTime(String(Math.floor(currentTime)))
    setNewPointLabel('')
    setNewPointValue('')
  }

  const handleDeleteKeyframe = (index: number) => {
    const newKeyframes = keyframes.filter((_, i) => i !== index)
    apply({ dataKeyframes: newKeyframes })
  }

  const handleUpdateTime = (index: number, rawTime: string) => {
    const time = Number(rawTime)
    if (!Number.isFinite(time) || time < 0) {
      return
    }

    const existingKeyframe = keyframes.find((kf, i) => i !== index && kf.time === time)
    if (existingKeyframe) {
      notify(`A keyframe already exists at time ${time}`)
      return
    }

    const newKeyframes = keyframes.map((kf, i) => (i === index ? { ...kf, time } : kf))
    newKeyframes.sort((a, b) => a.time - b.time)
    apply({ dataKeyframes: newKeyframes })
  }

  const handleAddPoint = (keyframeIndex: number) => {
    const label = prompt('Enter point label:')
    if (!label || !label.trim()) return

    const valueStr = prompt('Enter point value:')
    const value = Number(valueStr)
    if (!Number.isFinite(value)) {
      notify('Point value must be a number')
      return
    }

    const keyframe = keyframes[keyframeIndex]
    if (!keyframe) return

    const newPoint: DataPoint = { label: label.trim(), value }
    const newDataPoints = [...keyframe.dataPoints, newPoint]
    const newKeyframes = keyframes.map((kf, i) =>
      i === keyframeIndex ? { ...kf, dataPoints: newDataPoints } : kf,
    )
    apply({ dataKeyframes: newKeyframes })
  }

  const handleUpdatePointValue = (keyframeIndex: number, pointIndex: number, rawValue: string) => {
    const value = Number(rawValue)
    if (!Number.isFinite(value)) return

    const keyframe = keyframes[keyframeIndex]
    if (!keyframe) return

    const newDataPoints = keyframe.dataPoints.map((dp, i) =>
      i === pointIndex ? { ...dp, value } : dp,
    )
    const newKeyframes = keyframes.map((kf, i) =>
      i === keyframeIndex ? { ...kf, dataPoints: newDataPoints } : kf,
    )
    apply({ dataKeyframes: newKeyframes })
  }

  const handleDeletePoint = (keyframeIndex: number, pointIndex: number) => {
    const keyframe = keyframes[keyframeIndex]
    if (!keyframe) return

    const newDataPoints = keyframe.dataPoints.filter((_, i) => i !== pointIndex)
    const newKeyframes = keyframes.map((kf, i) =>
      i === keyframeIndex ? { ...kf, dataPoints: newDataPoints } : kf,
    )
    apply({ dataKeyframes: newKeyframes })
  }

  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">Data Keyframes</h3>

      {keyframes.length === 0 && (
        <p className="inspector-section__notice">
          No data keyframes. Add keyframes to animate data transitions.
        </p>
      )}

      {keyframes.map((keyframe, kfIndex) => (
        <div
          key={kfIndex}
          className="data-keyframe-row"
          style={{ borderLeft: '2px solid #4e79a7', paddingLeft: '8px', marginBottom: '8px' }}
        >
          <div className="inspector-field">
            <label className="inspector-field__label" htmlFor={`kf-time-${kfIndex}`}>
              Time
            </label>
            <input
              id={`kf-time-${kfIndex}`}
              className="inspector-field__input"
              type="number"
              aria-label="Keyframe time"
              disabled={playing}
              value={keyframe.time}
              onChange={(e) => handleUpdateTime(kfIndex, e.target.value)}
              min={0}
              step={0.1}
            />
            <button
              className="inspector-field__remove"
              aria-label="Delete keyframe"
              disabled={playing}
              onClick={() => handleDeleteKeyframe(kfIndex)}
            >
              ×
            </button>
          </div>

          {keyframe.dataPoints.length === 0 && (
            <p className="inspector-section__notice" style={{ margin: '4px 0' }}>
              No data points. Add points to define the chart state.
            </p>
          )}

          {keyframe.dataPoints.map((point, ptIndex) => (
            <div key={ptIndex} className="inspector-field" style={{ marginLeft: '8px' }}>
              <label className="inspector-field__label" htmlFor={`pt-label-${kfIndex}-${ptIndex}`}>
                {point.label}
              </label>
              <input
                id={`pt-value-${kfIndex}-${ptIndex}`}
                className="inspector-field__input"
                type="number"
                aria-label={`Value for ${point.label}`}
                disabled={playing}
                value={point.value}
                onChange={(e) => handleUpdatePointValue(kfIndex, ptIndex, e.target.value)}
                style={{ width: '60px' }}
              />
              <button
                className="inspector-field__remove"
                aria-label={`Delete point ${point.label}`}
                disabled={playing}
                onClick={() => handleDeletePoint(kfIndex, ptIndex)}
              >
                ×
              </button>
            </div>
          ))}

          <button
            className="inspector-field__add"
            disabled={playing}
            onClick={() => handleAddPoint(kfIndex)}
            style={{ marginLeft: '8px' }}
          >
            Add Point
          </button>
        </div>
      ))}

      <div
        className="inspector-section"
        style={{ borderTop: '1px solid #333', paddingTop: '8px', marginTop: '8px' }}
      >
        <h4 className="inspector-section__subtitle">Add New Keyframe</h4>

        <div className="inspector-field">
          <label className="inspector-field__label" htmlFor="new-kf-time">
            Time
          </label>
          <input
            id="new-kf-time"
            className="inspector-field__input"
            type="number"
            aria-label="New keyframe time"
            disabled={playing}
            value={newKeyframeTime}
            onChange={(e) => setNewKeyframeTime(e.target.value)}
            min={0}
            step={0.1}
          />
        </div>

        <div className="inspector-field">
          <label className="inspector-field__label" htmlFor="new-pt-label">
            Label
          </label>
          <input
            id="new-pt-label"
            className="inspector-field__input"
            type="text"
            aria-label="New point label"
            disabled={playing}
            value={newPointLabel}
            onChange={(e) => setNewPointLabel(e.target.value)}
            placeholder="e.g. Q1"
          />
        </div>

        <div className="inspector-field">
          <label className="inspector-field__label" htmlFor="new-pt-value">
            Value
          </label>
          <input
            id="new-pt-value"
            className="inspector-field__input"
            type="number"
            aria-label="New point value"
            disabled={playing}
            value={newPointValue}
            onChange={(e) => setNewPointValue(e.target.value)}
            placeholder="0"
          />
        </div>

        <button className="inspector-field__add" disabled={playing} onClick={handleAddKeyframe}>
          Add Keyframe
        </button>
      </div>
    </section>
  )
}
