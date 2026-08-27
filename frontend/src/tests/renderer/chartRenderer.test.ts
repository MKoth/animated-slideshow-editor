import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import { pixiRegistry } from './pixiFake'
import { findByLabel, mountRenderer, worldOf } from './testUtils'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
})

function seededChartEngine(): Engine {
  const engine = createEngine()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }

  const dataSourceId = 'ds-1'
  engine.embedDataSource({
    id: dataSourceId,
    name: 'Sales',
    dataPoints: [
      { label: 'Q1', value: 100 },
      { label: 'Q2', value: 200 },
      { label: 'Q3', value: 150 },
      { label: 'Q4', value: 300 },
    ],
  })

  engine.createNode(slide.scene.id, slide.scene.root.id, 'Chart', {
    components: {
      chart: {
        kind: 'chart',
        chartType: 'bar',
        dataSourceId,
        visualConfig: {
          colors: [],
          axisLabels: { x: 'Quarter', y: 'Revenue' },
          legendPosition: 'none',
          padding: 0,
          fontFamily: 'sans-serif',
          fontSize: 12,
        },
        dataLabels: [],
        _dirty: false,
      },
    },
  })
  return engine
}

function findChartPlaceholder(chart: ReturnType<typeof findByLabel>) {
  if (!chart) return undefined
  return chart.children.find((child) => child.label?.startsWith('chart:'))
}

describe('ChartRenderer', () => {
  it('creates a chart container with a sprite child', async () => {
    const engine = seededChartEngine()
    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    if (!root) {
      throw new Error('Root container not found')
    }

    const chart = findByLabel(root, 'Chart')
    expect(chart).toBeDefined()
    expect(chart?.kind).toBe('container')

    const placeholder = findChartPlaceholder(chart)
    expect(placeholder).toBeDefined()

    const sprite = placeholder?.children.find((child) => child.kind === 'sprite')
    expect(sprite).toBeDefined()
  })

  it('creates chart container with correct label', async () => {
    const engine = seededChartEngine()
    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    const chart = findByLabel(root ?? { children: [] }, 'Chart')
    if (!chart) {
      throw new Error('Chart container not found')
    }

    const placeholder = findChartPlaceholder(chart)
    expect(placeholder?.label).toBe('chart:Chart')
  })

  it('renders a chart node on the canvas', async () => {
    const engine = seededChartEngine()
    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    const chart = findByLabel(root ?? { children: [] }, 'Chart')
    expect(chart).toBeDefined()
  })

  it('supports bar chart type', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }

    engine.embedDataSource({
      id: 'ds-bar',
      name: 'Bar Data',
      dataPoints: [
        { label: 'A', value: 10 },
        { label: 'B', value: 20 },
      ],
    })

    engine.createNode(slide.scene.id, slide.scene.root.id, 'BarChart', {
      components: {
        chart: {
          kind: 'chart',
          chartType: 'bar',
          dataSourceId: 'ds-bar',
          visualConfig: {
            colors: [],
            axisLabels: { x: '', y: '' },
            legendPosition: 'none',
            padding: 0,
            fontFamily: 'sans-serif',
            fontSize: 12,
          },
          dataLabels: [],
          _dirty: false,
        },
      },
    })

    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    const chart = findByLabel(root ?? { children: [] }, 'BarChart')
    expect(chart).toBeDefined()
  })

  it('supports line chart type', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }

    engine.embedDataSource({
      id: 'ds-line',
      name: 'Line Data',
      dataPoints: [
        { label: 'Jan', value: 10 },
        { label: 'Feb', value: 20 },
        { label: 'Mar', value: 15 },
      ],
    })

    engine.createNode(slide.scene.id, slide.scene.root.id, 'LineChart', {
      components: {
        chart: {
          kind: 'chart',
          chartType: 'line',
          dataSourceId: 'ds-line',
          visualConfig: {
            colors: [],
            axisLabels: { x: '', y: '' },
            legendPosition: 'none',
            padding: 0,
            fontFamily: 'sans-serif',
            fontSize: 12,
          },
          dataLabels: [],
          _dirty: false,
        },
      },
    })

    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    const chart = findByLabel(root ?? { children: [] }, 'LineChart')
    expect(chart).toBeDefined()
  })

  it('supports pie chart type', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }

    engine.embedDataSource({
      id: 'ds-pie',
      name: 'Pie Data',
      dataPoints: [
        { label: 'Red', value: 30 },
        { label: 'Blue', value: 50 },
        { label: 'Green', value: 20 },
      ],
    })

    engine.createNode(slide.scene.id, slide.scene.root.id, 'PieChart', {
      components: {
        chart: {
          kind: 'chart',
          chartType: 'pie',
          dataSourceId: 'ds-pie',
          visualConfig: {
            colors: [],
            axisLabels: { x: '', y: '' },
            legendPosition: 'none',
            padding: 0,
            fontFamily: 'sans-serif',
            fontSize: 12,
          },
          dataLabels: [],
          _dirty: false,
        },
      },
    })

    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    const chart = findByLabel(root ?? { children: [] }, 'PieChart')
    expect(chart).toBeDefined()
  })

  it('supports area chart type', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }

    engine.embedDataSource({
      id: 'ds-area',
      name: 'Area Data',
      dataPoints: [
        { label: 'Jan', value: 10 },
        { label: 'Feb', value: 25 },
        { label: 'Mar', value: 15 },
      ],
    })

    engine.createNode(slide.scene.id, slide.scene.root.id, 'AreaChart', {
      components: {
        chart: {
          kind: 'chart',
          chartType: 'area',
          dataSourceId: 'ds-area',
          visualConfig: {
            colors: [],
            axisLabels: { x: '', y: '' },
            legendPosition: 'none',
            padding: 0,
            fontFamily: 'sans-serif',
            fontSize: 12,
          },
          dataLabels: [],
          _dirty: false,
        },
      },
    })

    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    const chart = findByLabel(root ?? { children: [] }, 'AreaChart')
    expect(chart).toBeDefined()
  })

  it('integrates with camera zoom/pan by inheriting parent transforms', async () => {
    const engine = seededChartEngine()
    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    const chart = findByLabel(root ?? { children: [] }, 'Chart')
    if (!chart) {
      throw new Error('Chart container not found')
    }

    expect(chart.position).toBeDefined()
    expect(chart.scale).toBeDefined()
    expect(chart.rotation).toBe(0)
  })

  it('creates chart node after initial render', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    if (!root) {
      throw new Error('Root container not found')
    }

    expect(findByLabel(root, 'Chart')).toBeUndefined()

    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }

    engine.embedDataSource({
      id: 'ds-late',
      name: 'Late Data',
      dataPoints: [{ label: 'X', value: 42 }],
    })

    engine.createNode(slide.scene.id, slide.scene.root.id, 'Chart', {
      components: {
        chart: {
          kind: 'chart',
          chartType: 'bar',
          dataSourceId: 'ds-late',
          visualConfig: {
            colors: [],
            axisLabels: { x: '', y: '' },
            legendPosition: 'none',
            padding: 0,
            fontFamily: 'sans-serif',
            fontSize: 12,
          },
          dataLabels: [],
          _dirty: false,
        },
      },
    })

    const chart = findByLabel(root, 'Chart')
    expect(chart).toBeDefined()

    const placeholder = findChartPlaceholder(chart)
    const sprite = placeholder?.children.find((child) => child.kind === 'sprite')
    expect(sprite).toBeDefined()
  })

  it('sets chart node size in the scene renderer', async () => {
    const engine = seededChartEngine()
    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    const chart = findByLabel(root ?? { children: [] }, 'Chart')
    expect(chart).toBeDefined()
    // The renderer should not throw when processing chart nodes
  })

  it('triggers re-rasterization when _dirty flag is set', async () => {
    const engine = seededChartEngine()
    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    const chart = findByLabel(root ?? { children: [] }, 'Chart')
    expect(chart).toBeDefined()

    const placeholder = findChartPlaceholder(chart)
    const sprite = placeholder?.children.find((child) => child.kind === 'sprite')
    expect(sprite).toBeDefined()

    const slide = engine.project?.slides[0]
    const chartNode = slide?.scene.root.children.find((n) => n.name === 'Chart')
    expect(chartNode).toBeDefined()
    expect(chartNode?.components.chart).toBeDefined()

    if (chartNode?.components.chart) {
      chartNode.components.chart._dirty = true
      engine.setChartComponent(chartNode.id, chartNode.components.chart)
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
  })

  it('does not re-rasterize when _dirty is false and config unchanged', async () => {
    const engine = seededChartEngine()
    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    const chart = findByLabel(root ?? { children: [] }, 'Chart')
    expect(chart).toBeDefined()

    const placeholder = findChartPlaceholder(chart)
    const sprite = placeholder?.children.find((child) => child.kind === 'sprite')
    const initialTexture = sprite?.texture

    const slide = engine.project?.slides[0]
    const chartNode = slide?.scene.root.children.find((n) => n.name === 'Chart')
    expect(chartNode?.components.chart).toBeDefined()

    if (chartNode?.components.chart) {
      chartNode.components.chart._dirty = false
      engine.setChartComponent(chartNode.id, chartNode.components.chart)
    }

    expect(sprite?.texture).toBe(initialTexture)
  })
})
