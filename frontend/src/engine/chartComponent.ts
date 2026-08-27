import type { ChartComponent, ChartType, DataKeyframe, VisualConfig } from './components'

const VALID_CHART_TYPES: readonly ChartType[] = ['bar', 'line', 'pie', 'area', 'flowchart']

export function validateChartType(value: unknown): value is ChartType {
  return typeof value === 'string' && (VALID_CHART_TYPES as readonly string[]).includes(value)
}

export const DEFAULT_VISUAL_CONFIG: VisualConfig = Object.freeze({
  colors: [],
  axisLabels: { x: '', y: '' },
  legendPosition: 'right',
  padding: 0,
  fontFamily: 'sans-serif',
  fontSize: 12,
})

export function createChartComponent(
  chartType: ChartType,
  dataSourceId: string,
  visualConfig?: Partial<VisualConfig>,
  dataKeyframes?: DataKeyframe[],
): ChartComponent {
  if (!validateChartType(chartType)) {
    throw new Error(`Invalid chart type: "${String(chartType)}"`)
  }

  const mergedVisualConfig: VisualConfig = {
    ...DEFAULT_VISUAL_CONFIG,
    ...visualConfig,
    ...(visualConfig?.axisLabels
      ? { axisLabels: { ...DEFAULT_VISUAL_CONFIG.axisLabels, ...visualConfig.axisLabels } }
      : {}),
  }

  const sortedKeyframes = dataKeyframes ? sortDataKeyframesArray(dataKeyframes) : []

  return {
    kind: 'chart',
    chartType,
    dataSourceId,
    visualConfig: mergedVisualConfig,
    dataKeyframes: sortedKeyframes,
    _dirty: false,
  }
}

export function setChartDirty(component: ChartComponent): void {
  component._dirty = true
}

function sortDataKeyframesArray(keyframes: readonly DataKeyframe[]): DataKeyframe[] {
  return [...keyframes].sort((a, b) => a.time - b.time)
}

export function sortDataKeyframes(component: ChartComponent): void {
  const sorted = sortDataKeyframesArray(component.dataKeyframes)
  component.dataKeyframes = sorted
  component._dirty = true
}

export function setChartDataSourceId(component: ChartComponent, dataSourceId: string): void {
  component.dataSourceId = dataSourceId
  component._dirty = true
}

export function setChartVisualConfig(
  component: ChartComponent,
  visualConfig: Partial<VisualConfig>,
): void {
  const merged: VisualConfig = {
    ...DEFAULT_VISUAL_CONFIG,
    ...component.visualConfig,
    ...visualConfig,
    ...(visualConfig.axisLabels
      ? { axisLabels: { ...component.visualConfig.axisLabels, ...visualConfig.axisLabels } }
      : {}),
  }
  ;(component as { visualConfig: VisualConfig }).visualConfig = merged
  component._dirty = true
}

export function addDataKeyframe(component: ChartComponent, keyframe: DataKeyframe): void {
  component.dataKeyframes = [...component.dataKeyframes, keyframe]
  sortDataKeyframes(component)
  component._dirty = true
}
