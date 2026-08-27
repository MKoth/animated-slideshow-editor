import { describe, expect, it } from 'vitest'
import type { DataKeyframe, DataPoint, VisualConfig } from '../../engine/components'
import {
  createChartComponent,
  validateChartType,
  setChartDirty,
  sortDataKeyframes,
  addDataKeyframe,
  setChartDataSourceId,
  setChartVisualConfig,
} from '../../engine/chartComponent'

const defaultVisualConfig: VisualConfig = {
  colors: [],
  axisLabels: { x: '', y: '' },
  legendPosition: 'right',
  padding: 0,
  fontFamily: 'sans-serif',
  fontSize: 12,
}

const samplePoints: DataPoint[] = [
  { label: 'A', value: 10 },
  { label: 'B', value: 20 },
]

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

    it('defaults dataKeyframes to empty array', () => {
      const component = createChartComponent('area', 'ds-1')
      expect(component.dataKeyframes).toEqual([])
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

    it('sets dirty when data keyframes are added', () => {
      const component = createChartComponent('bar', 'ds-1')
      expect(component._dirty).toBe(false)
      addDataKeyframe(component, { time: 1, dataPoints: samplePoints })
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

    it('sets dirty when sortDataKeyframes is called', () => {
      const component = createChartComponent('line', 'ds-1')
      addDataKeyframe(component, { time: 2, dataPoints: samplePoints })
      addDataKeyframe(component, { time: 1, dataPoints: samplePoints })
      component._dirty = false
      sortDataKeyframes(component)
      expect(component._dirty).toBe(true)
    })

    it('does not set dirty when nothing changes', () => {
      const component = createChartComponent('bar', 'ds-1')
      expect(component._dirty).toBe(false)
      // No mutation — dirty should remain false
      expect(component._dirty).toBe(false)
    })
  })

  describe('data keyframe sorting', () => {
    it('sorts data keyframes by time after insertion', () => {
      const component = createChartComponent('line', 'ds-1')
      addDataKeyframe(component, { time: 3, dataPoints: samplePoints })
      addDataKeyframe(component, { time: 1, dataPoints: samplePoints })
      addDataKeyframe(component, { time: 2, dataPoints: samplePoints })

      const times = component.dataKeyframes.map((kf) => kf.time)
      expect(times).toEqual([1, 2, 3])
    })

    it('maintains sort order when keyframes are inserted out of order', () => {
      const component = createChartComponent('bar', 'ds-1')
      addDataKeyframe(component, { time: 10, dataPoints: samplePoints })
      addDataKeyframe(component, { time: 5, dataPoints: samplePoints })
      addDataKeyframe(component, { time: 15, dataPoints: samplePoints })
      addDataKeyframe(component, { time: 1, dataPoints: samplePoints })

      const times = component.dataKeyframes.map((kf) => kf.time)
      expect(times).toEqual([1, 5, 10, 15])
    })

    it('preserves data points in sorted keyframes', () => {
      const component = createChartComponent('line', 'ds-1')
      const kf1: DataKeyframe = { time: 2, dataPoints: [{ label: 'X', value: 5 }] }
      const kf2: DataKeyframe = { time: 1, dataPoints: [{ label: 'Y', value: 10 }] }
      addDataKeyframe(component, kf1)
      addDataKeyframe(component, kf2)

      expect(component.dataKeyframes[0].time).toBe(1)
      expect(component.dataKeyframes[0].dataPoints[0].label).toBe('Y')
      expect(component.dataKeyframes[1].time).toBe(2)
      expect(component.dataKeyframes[1].dataPoints[0].label).toBe('X')
    })

    it('handles duplicate times by preserving insertion order', () => {
      const component = createChartComponent('bar', 'ds-1')
      addDataKeyframe(component, { time: 1, dataPoints: [{ label: 'A', value: 1 }] })
      addDataKeyframe(component, { time: 1, dataPoints: [{ label: 'B', value: 2 }] })

      expect(component.dataKeyframes).toHaveLength(2)
      expect(component.dataKeyframes[0].dataPoints[0].label).toBe('A')
      expect(component.dataKeyframes[1].dataPoints[0].label).toBe('B')
    })

    it('sorts initial keyframes provided at creation', () => {
      const unsorted: DataKeyframe[] = [
        { time: 5, dataPoints: samplePoints },
        { time: 1, dataPoints: samplePoints },
        { time: 3, dataPoints: samplePoints },
      ]
      const component = createChartComponent('line', 'ds-1', undefined, unsorted)
      const times = component.dataKeyframes.map((kf) => kf.time)
      expect(times).toEqual([1, 3, 5])
    })
  })
})
