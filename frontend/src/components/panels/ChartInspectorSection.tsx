import type { SceneNode } from '../../engine'
import type { EnginePublic } from '../../engine'
import type { ChartComponent, ChartType, VisualConfig } from '../../engine/components'
import type { DispatchCommand } from '../../engine/commands'
import { SetChartComponentCommand } from '../../engine/commands'
import { runCommand } from './sectionHelpers'
import { DataKeyframesPanel } from './DataKeyframesPanel'

function mergeChart(node: SceneNode, patch: Partial<ChartComponent>): ChartComponent {
  const c = node.components.chart!
  return { ...c, ...patch }
}

export function ChartInspectorSection({
  target,
  engine,
  dispatch,
  notify,
  playing,
  currentTime,
}: {
  target: SceneNode
  engine: EnginePublic
  dispatch: DispatchCommand
  notify: (message: string) => void
  playing: boolean
  currentTime: number
}) {
  const chart = target.components.chart
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

  const dataSources = engine.embeddedDataSources.filter((ds) => !('nodes' in ds && 'edges' in ds))

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

      <DataKeyframesPanel
        target={target}
        dispatch={dispatch}
        notify={notify}
        playing={playing}
        currentTime={currentTime}
      />
    </section>
  )
}
