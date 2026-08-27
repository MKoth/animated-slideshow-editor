import type { ChartComponent } from './components'
import { createChartComponent } from './chartComponent'

export function defaultChartComponent(dataSourceId?: string): ChartComponent {
  return createChartComponent('bar', dataSourceId ?? '', { legendPosition: 'none' })
}
