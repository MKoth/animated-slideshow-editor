import { useState } from 'react'
import type { SceneNode } from '../../engine'
import type { EnginePublic } from '../../engine'
import type { ChartComponent, ChartType, VisualConfig } from '../../engine/components'
import type { DispatchCommand } from '../../engine/commands'
import { SetChartComponentCommand } from '../../engine/commands'
import { runCommand } from './sectionHelpers'

function mergeChart(node: SceneNode, patch: Partial<ChartComponent>): ChartComponent {
  const c = node.components.chart!
  return { ...c, ...patch }
}

function getDataSourceLabels(engine: EnginePublic, dataSourceId: string): string[] {
  const ds = engine.embeddedDataSources.find((d) => d.id === dataSourceId)
  if (ds && 'dataPoints' in ds) {
    return ds.dataPoints.map((p) => p.label)
  }
  return []
}

export function ChartInspectorSection({
  target,
  engine,
  dispatch,
  notify,
  playing,
}: {
  target: SceneNode
  engine: EnginePublic
  dispatch: DispatchCommand
  notify: (message: string) => void
  playing: boolean
}) {
  const chart = target.components.chart
  const [selectedLabel, setSelectedLabel] = useState('')

  if (!chart) return null

  const apply = (patch: Partial<ChartComponent>) => {
    runCommand(notify, () => {
      const updated = mergeChart(target, patch)
      return dispatch(new SetChartComponentCommand({ nodeId: target.id, chart: updated }))
    })
  }

  const applyVisual = (patch: Partial<VisualConfig>) => {
    apply({ visualConfig: { ...chart.visualConfig, ...patch } })
  }

  const commitChartType = (event: React.ChangeEvent<HTMLSelectElement>) => {
    apply({ chartType: event.target.value as ChartType })
  }

  const commitDataSource = (event: React.ChangeEvent<HTMLSelectElement>) => {
    apply({ dataSourceId: event.target.value })
  }

  const commitAxisLabelX = (event: React.ChangeEvent<HTMLInputElement>) => {
    applyVisual({ axisLabels: { ...chart.visualConfig.axisLabels, x: event.target.value } })
  }

  const commitAxisLabelY = (event: React.ChangeEvent<HTMLInputElement>) => {
    applyVisual({ axisLabels: { ...chart.visualConfig.axisLabels, y: event.target.value } })
  }

  const commitLegendPosition = (event: React.ChangeEvent<HTMLSelectElement>) => {
    applyVisual({ legendPosition: event.target.value as VisualConfig['legendPosition'] })
  }

  const commitColor = (index: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const colors = [...chart.visualConfig.colors]
    colors[index] = event.target.value
    applyVisual({ colors })
  }

  const addColor = () => {
    applyVisual({ colors: [...chart.visualConfig.colors, '#000000'] })
  }

  const removeColor = (index: number) => {
    const colors = chart.visualConfig.colors.filter((_, i) => i !== index)
    applyVisual({ colors })
  }

  const commitAxisMin = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value === '' ? undefined : Number(event.target.value)
    apply({ axisMin: value, axisMax: chart.axisMax })
  }

  const commitAxisMax = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value === '' ? undefined : Number(event.target.value)
    apply({ axisMin: chart.axisMin, axisMax: value })
  }

  const handleAddDataField = () => {
    if (!selectedLabel) {
      notify('Please select a label first')
      return
    }
    if (chart.dataLabels.includes(selectedLabel)) {
      notify(`Data field "${selectedLabel}" already exists`)
      return
    }
    apply({ dataLabels: [...chart.dataLabels, selectedLabel] })
    setSelectedLabel('')
  }

  const handleRemoveDataField = (label: string) => {
    apply({ dataLabels: chart.dataLabels.filter((l) => l !== label) })
  }

  const dataSources = engine.embeddedDataSources.filter((ds) => !('nodes' in ds && 'edges' in ds))
  const availableLabels = chart.dataSourceId ? getDataSourceLabels(engine, chart.dataSourceId) : []
  const unusedLabels = availableLabels.filter((l) => !chart.dataLabels.includes(l))

  return (
    <section className="inspector-section">
      <h3 className="inspector-section__title">Chart</h3>

      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="chart-type">
          Chart Type
        </label>
        <select
          id="chart-type"
          className="inspector-field__input inspector-field__select"
          aria-label="Chart Type"
          disabled={playing}
          value={chart.chartType}
          onChange={commitChartType}
        >
          <option value="bar">Bar</option>
          <option value="line">Line</option>
          <option value="pie">Pie</option>
          <option value="area">Area</option>
        </select>
      </div>

      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="chart-data-source">
          Data Source
        </label>
        <select
          id="chart-data-source"
          className="inspector-field__input inspector-field__select"
          aria-label="Data Source"
          disabled={playing}
          value={chart.dataSourceId}
          onChange={commitDataSource}
        >
          <option value="">None</option>
          {dataSources.map((ds) => (
            <option key={ds.id} value={ds.id}>
              {ds.name}
            </option>
          ))}
        </select>
      </div>

      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="chart-axis-x">
          X Axis Label
        </label>
        <input
          id="chart-axis-x"
          className="inspector-field__input"
          type="text"
          aria-label="X Axis Label"
          disabled={playing}
          value={chart.visualConfig.axisLabels.x}
          onChange={commitAxisLabelX}
        />
      </div>

      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="chart-axis-y">
          Y Axis Label
        </label>
        <input
          id="chart-axis-y"
          className="inspector-field__input"
          type="text"
          aria-label="Y Axis Label"
          disabled={playing}
          value={chart.visualConfig.axisLabels.y}
          onChange={commitAxisLabelY}
        />
      </div>

      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="chart-axis-min">
          Y Axis Min
        </label>
        <input
          id="chart-axis-min"
          className="inspector-field__input"
          type="number"
          aria-label="Y Axis Min"
          disabled={playing}
          value={chart.axisMin ?? ''}
          onChange={commitAxisMin}
          placeholder="auto"
        />
      </div>

      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="chart-axis-max">
          Y Axis Max
        </label>
        <input
          id="chart-axis-max"
          className="inspector-field__input"
          type="number"
          aria-label="Y Axis Max"
          disabled={playing}
          value={chart.axisMax ?? ''}
          onChange={commitAxisMax}
          placeholder="auto"
        />
      </div>

      <div className="inspector-field">
        <label className="inspector-field__label" htmlFor="chart-legend-position">
          Legend Position
        </label>
        <select
          id="chart-legend-position"
          className="inspector-field__input inspector-field__select"
          aria-label="Legend Position"
          disabled={playing}
          value={chart.visualConfig.legendPosition}
          onChange={commitLegendPosition}
        >
          <option value="top">Top</option>
          <option value="bottom">Bottom</option>
          <option value="left">Left</option>
          <option value="right">Right</option>
          <option value="none">None</option>
        </select>
      </div>

      <div className="inspector-field">
        <label className="inspector-field__label">Colors</label>
        {chart.visualConfig.colors.map((color, i) => (
          <div key={i} className="inspector-field__row">
            <input
              className="inspector-field__color"
              type="color"
              aria-label={`Color ${i + 1}`}
              value={color}
              disabled={playing}
              onChange={(e) => commitColor(i, e)}
            />
            <button
              className="inspector-field__remove"
              aria-label={`Remove color ${i + 1}`}
              disabled={playing}
              onClick={() => removeColor(i)}
            >
              ×
            </button>
          </div>
        ))}
        <button className="inspector-field__add" disabled={playing} onClick={addColor}>
          Add Color
        </button>
      </div>

      <div
        className="inspector-section"
        style={{ borderTop: '1px solid #333', paddingTop: '8px', marginTop: '8px' }}
      >
        <h4 className="inspector-section__subtitle">Data Fields</h4>

        {chart.dataLabels.length === 0 && (
          <p className="inspector-section__notice">
            No data fields. Add fields to animate chart data.
          </p>
        )}

        {chart.dataLabels.map((label) => (
          <div key={label} className="inspector-field">
            <label className="inspector-field__label">{label}</label>
            <button
              className="inspector-field__remove"
              aria-label={`Remove data field ${label}`}
              disabled={playing}
              onClick={() => handleRemoveDataField(label)}
            >
              ×
            </button>
          </div>
        ))}

        {unusedLabels.length > 0 && (
          <div className="inspector-field">
            <label className="inspector-field__label" htmlFor="add-data-field">
              Add Field
            </label>
            <select
              id="add-data-field"
              className="inspector-field__input inspector-field__select"
              aria-label="Select label to add"
              disabled={playing}
              value={selectedLabel}
              onChange={(e) => setSelectedLabel(e.target.value)}
            >
              <option value="">Select label...</option>
              {unusedLabels.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
            <button
              className="inspector-field__add"
              disabled={playing || !selectedLabel}
              onClick={handleAddDataField}
            >
              Add
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
