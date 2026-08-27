import type { ChartComponent, ChartType, VisualConfig } from './components'

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
  dataLabels?: string[],
  axisMin?: number,
  axisMax?: number,
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

  return {
    kind: 'chart',
    chartType,
    dataSourceId,
    visualConfig: mergedVisualConfig,
    dataLabels: dataLabels ? [...dataLabels] : [],
    axisMin,
    axisMax,
    _dirty: false,
  }
}

export function setChartDirty(component: ChartComponent): void {
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

export function addDataLabel(component: ChartComponent, label: string): void {
  if (!component.dataLabels.includes(label)) {
    component.dataLabels = [...component.dataLabels, label]
    component._dirty = true
  }
}

export function removeDataLabel(component: ChartComponent, label: string): void {
  component.dataLabels = component.dataLabels.filter((l) => l !== label)
  component._dirty = true
}

export function setChartAxisBounds(
  component: ChartComponent,
  axisMin?: number,
  axisMax?: number,
): void {
  component.axisMin = axisMin
  component.axisMax = axisMax
  component._dirty = true
}
