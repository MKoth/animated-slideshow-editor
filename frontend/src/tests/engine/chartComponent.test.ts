import { describe, expect, it } from 'vitest'
import type { VisualConfig } from '../../engine/components'
import {
  createChartComponent,
  validateChartType,
  setChartDirty,
  addDataLabel,
  removeDataLabel,
  setChartDataSourceId,
  setChartVisualConfig,
  setChartAxisBounds,
} from '../../engine/chartComponent'

const defaultVisualConfig: VisualConfig = {
  colors: [],
  axisLabels: { x: '', y: '' },
  legendPosition: 'right',
  padding: 0,
  fontFamily: 'sans-serif',
  fontSize: 12,
}

describe('ChartComponent', () => {
  describe('config validation', () => {
    it('creates a chart component with a valid chart type', () => {
      const component = createChartComponent('bar', 'ds-1')
      expect(component.kind).toBe('chart')
      expect(component.chartType).toBe('bar')
      expect(component.dataSourceId).toBe('ds-1')
    })

    it('rejects an invalid chart type', () => {
      expect(() => createChartComponent('scatter' as never, 'ds-1')).toThrow(/invalid chart type/i)
    })

    it('validates all valid chart types', () => {
      const validTypes = ['bar', 'line', 'pie', 'area', 'flowchart'] as const
      for (const chartType of validTypes) {
        expect(validateChartType(chartType)).toBe(true)
      }
    })

    it('rejects non-string chart types', () => {
      expect(validateChartType(123 as never)).toBe(false)
      expect(validateChartType(undefined as never)).toBe(false)
      expect(validateChartType(null as never)).toBe(false)
    })

    it('applies default visual config when not provided', () => {
      const component = createChartComponent('line', 'ds-1')
      expect(component.visualConfig).toEqual(defaultVisualConfig)
    })

    it('applies custom visual config when provided', () => {
      const customConfig: Partial<VisualConfig> = {
        colors: ['#ff0000', '#00ff00'],
        fontSize: 16,
      }
      const component = createChartComponent('pie', 'ds-1', customConfig)
      expect(component.visualConfig.colors).toEqual(['#ff0000', '#00ff00'])
      expect(component.visualConfig.fontSize).toBe(16)
      expect(component.visualConfig.legendPosition).toBe('right')
    })

    it('defaults dataLabels to empty array', () => {
      const component = createChartComponent('area', 'ds-1')
      expect(component.dataLabels).toEqual([])
    })

    it('initializes _dirty to false', () => {
      const component = createChartComponent('bar', 'ds-1')
      expect(component._dirty).toBe(false)
    })
  })

  describe('dirty flagging', () => {
    it('sets dirty when setChartDirty is called', () => {
      const component = createChartComponent('bar', 'ds-1')
      expect(component._dirty).toBe(false)
      setChartDirty(component)
      expect(component._dirty).toBe(true)
    })

    it('sets dirty when data label is added', () => {
      const component = createChartComponent('bar', 'ds-1')
      expect(component._dirty).toBe(false)
      addDataLabel(component, 'Q1')
      expect(component._dirty).toBe(true)
    })

    it('sets dirty when data source id changes', () => {
      const component = createChartComponent('bar', 'ds-1')
      expect(component._dirty).toBe(false)
      setChartDataSourceId(component, 'ds-2')
      expect(component._dirty).toBe(true)
      expect(component.dataSourceId).toBe('ds-2')
    })

    it('sets dirty when visual config changes', () => {
      const component = createChartComponent('bar', 'ds-1')
      expect(component._dirty).toBe(false)
      setChartVisualConfig(component, { fontSize: 20 })
      expect(component._dirty).toBe(true)
      expect(component.visualConfig.fontSize).toBe(20)
    })

    it('sets dirty when axis bounds change', () => {
      const component = createChartComponent('bar', 'ds-1')
      expect(component._dirty).toBe(false)
      setChartAxisBounds(component, 0, 100)
      expect(component._dirty).toBe(true)
      expect(component.axisMin).toBe(0)
      expect(component.axisMax).toBe(100)
    })

    it('does not set dirty when nothing changes', () => {
      const component = createChartComponent('bar', 'ds-1')
      expect(component._dirty).toBe(false)
      // No mutation — dirty should remain false
      expect(component._dirty).toBe(false)
    })
  })

  describe('data labels', () => {
    it('adds a data label', () => {
      const component = createChartComponent('bar', 'ds-1')
      addDataLabel(component, 'Q1')
      expect(component.dataLabels).toEqual(['Q1'])
    })

    it('does not add duplicate labels', () => {
      const component = createChartComponent('bar', 'ds-1')
      addDataLabel(component, 'Q1')
      addDataLabel(component, 'Q1')
      expect(component.dataLabels).toEqual(['Q1'])
    })

    it('removes a data label', () => {
      const component = createChartComponent('bar', 'ds-1')
      addDataLabel(component, 'Q1')
      addDataLabel(component, 'Q2')
      removeDataLabel(component, 'Q1')
      expect(component.dataLabels).toEqual(['Q2'])
    })

    it('handles removing non-existent label gracefully', () => {
      const component = createChartComponent('bar', 'ds-1')
      removeDataLabel(component, 'Q1')
      expect(component.dataLabels).toEqual([])
    })
  })

  describe('axis bounds', () => {
    it('creates component without axis bounds by default', () => {
      const component = createChartComponent('bar', 'ds-1')
      expect(component.axisMin).toBeUndefined()
      expect(component.axisMax).toBeUndefined()
    })

    it('sets axis bounds', () => {
      const component = createChartComponent('bar', 'ds-1')
      setChartAxisBounds(component, 0, 100)
      expect(component.axisMin).toBe(0)
      expect(component.axisMax).toBe(100)
    })
  })
})
