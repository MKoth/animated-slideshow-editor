import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import { serialize, deserialize, validate } from '../../engine/lessonSerializer'
import type { LessonJSON } from '../../engine/json'
import type { TableComponent, ChartComponent } from '../../engine/components'
import { createChartComponent } from '../../engine/chartComponent'
import type { EmbeddedDataSourceDefinition } from '../../engine/embeddedDataSource'

function engineWithProject() {
  const engine = createEngine()
  engine.createProject({ name: 'P' })
  engine.createSlide('S1')
  return engine
}

describe('TableComponent serialization', () => {
  it('round-trips a table component through the lesson file', () => {
    const engine = engineWithProject()
    const slide = engine.project!.slides[0]
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Table')
    const table: TableComponent = {
      kind: 'table',
      columns: [{ width: 100 }, { width: 'auto' }],
      gap: 5,
      borderWidth: 2,
      borderColor: '#ff0000',
      borderRadius: 0,
      padding: 0,
    }
    engine.setTableComponent(node.id, table)

    const json = JSON.parse(serialize(engine.project as never)) as LessonJSON
    const nodeJson = json.slides[0]?.scene.nodes.find((n) => n.id === node.id)
    expect(nodeJson?.components.table).toEqual({
      kind: 'table',
      columns: [{ width: 100 }, { width: 'auto' }],
      gap: 5,
      borderWidth: 2,
      borderColor: '#ff0000',
      borderRadius: 0,
      padding: 0,
    })

    const restored = deserialize(JSON.stringify(json))
    const restoredSlide = restored.slides[0]
    const restoredNode = restoredSlide.scene.root.children.find((n) => n.name === 'Table')
    expect(restoredNode).toBeDefined()
    expect(restoredNode!.components.table).toBeDefined()
    expect(restoredNode!.components.table!).toEqual({
      kind: 'table',
      columns: [{ width: 100 }, { width: 'auto' }],
      gap: 5,
      borderWidth: 2,
      borderColor: '#ff0000',
      borderRadius: 0,
      padding: 0,
    })
  })

  it('round-trips table with default values', () => {
    const engine = engineWithProject()
    const slide = engine.project!.slides[0]
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Table')
    const table: TableComponent = {
      kind: 'table',
      columns: [{ width: 100 }],
      gap: 0,
      borderWidth: 1,
      borderColor: '#000000',
      borderRadius: 0,
      padding: 0,
    }
    engine.setTableComponent(node.id, table)

    const json = JSON.parse(serialize(engine.project as never)) as LessonJSON
    const restored = deserialize(JSON.stringify(json))
    const restoredNode = restored.slides[0].scene.root.children.find((n) => n.name === 'Table')
    expect(restoredNode!.components.table!).toEqual(table)
  })

  it('round-trips table with minWidth on dimensions', () => {
    const engine = engineWithProject()
    const slide = engine.project!.slides[0]
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Table')
    const table: TableComponent = {
      kind: 'table',
      columns: [{ width: 'auto', minWidth: 50 }],
      gap: 0,
      borderWidth: 1,
      borderColor: '#000000',
      borderRadius: 0,
      padding: 0,
    }
    engine.setTableComponent(node.id, table)

    const json = JSON.parse(serialize(engine.project as never)) as LessonJSON
    const restored = deserialize(JSON.stringify(json))
    const restoredNode = restored.slides[0].scene.root.children.find((n) => n.name === 'Table')
    expect(restoredNode!.components.table!).toEqual(table)
  })

  it('validates table component in lesson JSON', () => {
    const json: LessonJSON = {
      version: 1,
      project: { id: 'p', name: 'P', description: '', author: '', createdAt: 't', modifiedAt: 't' },
      slides: [
        {
          id: 's1',
          name: 'S1',
          duration: 10,
          scene: {
            id: 'sc1',
            nodes: [
              {
                id: 'root',
                name: 'Root',
                parentId: null,
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: {},
              },
              {
                id: 'cam',
                name: 'Camera',
                parentId: 'root',
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: { camera: { kind: 'camera' } },
              },
              {
                id: 'table',
                name: 'Table',
                parentId: 'root',
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: {
                  table: {
                    kind: 'table',
                    columns: [{ width: 100 }],
                  },
                },
              },
            ],
          },
        },
      ],
    }
    expect(validate(json)).toEqual([])
  })
})

describe('ChartComponent serialization', () => {
  it('round-trips a chart component through the lesson file', () => {
    const engine = engineWithProject()
    const slide = engine.project!.slides[0]
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Chart')
    const chart: ChartComponent = createChartComponent(
      'bar',
      'ds-1',
      {
        colors: ['#ff0000', '#00ff00'],
        axisLabels: { x: 'Time', y: 'Value' },
        legendPosition: 'bottom',
        padding: 10,
        fontFamily: 'Arial',
        fontSize: 14,
      },
      ['Label1', 'Label2'],
      0,
      100,
    )
    engine.setChartComponent(node.id, chart)

    const json = JSON.parse(serialize(engine.project as never)) as LessonJSON
    const nodeJson = json.slides[0]?.scene.nodes.find((n) => n.id === node.id)
    expect(nodeJson?.components.chart).toBeDefined()
    expect(nodeJson?.components.chart?.kind).toBe('chart')
    expect(nodeJson?.components.chart?.chartType).toBe('bar')
    expect(nodeJson?.components.chart?.dataSourceId).toBe('ds-1')
    expect(nodeJson?.components.chart?.dataLabels).toEqual(['Label1', 'Label2'])
    expect(nodeJson?.components.chart?.axisMin).toBe(0)
    expect(nodeJson?.components.chart?.axisMax).toBe(100)
    expect(nodeJson?.components.chart?.visualConfig).toEqual({
      colors: ['#ff0000', '#00ff00'],
      axisLabels: { x: 'Time', y: 'Value' },
      legendPosition: 'bottom',
      padding: 10,
      fontFamily: 'Arial',
      fontSize: 14,
    })

    const restored = deserialize(JSON.stringify(json))
    const restoredSlide = restored.slides[0]
    const restoredNode = restoredSlide.scene.root.children.find((n) => n.name === 'Chart')
    expect(restoredNode).toBeDefined()
    expect(restoredNode!.components.chart).toBeDefined()
    expect(restoredNode!.components.chart!.chartType).toBe('bar')
    expect(restoredNode!.components.chart!.dataSourceId).toBe('ds-1')
    expect(restoredNode!.components.chart!.dataLabels).toEqual(['Label1', 'Label2'])
    expect(restoredNode!.components.chart!.axisMin).toBe(0)
    expect(restoredNode!.components.chart!.axisMax).toBe(100)
    expect(restoredNode!.components.chart!.visualConfig).toEqual({
      colors: ['#ff0000', '#00ff00'],
      axisLabels: { x: 'Time', y: 'Value' },
      legendPosition: 'bottom',
      padding: 10,
      fontFamily: 'Arial',
      fontSize: 14,
    })
  })

  it('round-trips chart with all chart types', () => {
    const chartTypes = ['bar', 'line', 'pie', 'area', 'flowchart'] as const
    for (const chartType of chartTypes) {
      const engine = engineWithProject()
      const slide = engine.project!.slides[0]
      const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Chart')
      const chart = createChartComponent(chartType, 'ds-1')
      engine.setChartComponent(node.id, chart)

      const json = JSON.parse(serialize(engine.project as never)) as LessonJSON
      const restored = deserialize(JSON.stringify(json))
      const restoredNode = restored.slides[0].scene.root.children.find((n) => n.name === 'Chart')
      expect(restoredNode!.components.chart!.chartType).toBe(chartType)
    }
  })

  it('round-trips chart data point overrides (dataLabels)', () => {
    const engine = engineWithProject()
    const slide = engine.project!.slides[0]
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Chart')
    const chart = createChartComponent('line', 'ds-1', undefined, [
      'override-label-1',
      'override-label-2',
    ])
    engine.setChartComponent(node.id, chart)

    const json = JSON.parse(serialize(engine.project as never)) as LessonJSON
    const restored = deserialize(JSON.stringify(json))
    const restoredNode = restored.slides[0].scene.root.children.find((n) => n.name === 'Chart')
    expect(restoredNode!.components.chart!.dataLabels).toEqual([
      'override-label-1',
      'override-label-2',
    ])
  })

  it('round-trips chart with no optional fields', () => {
    const engine = engineWithProject()
    const slide = engine.project!.slides[0]
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Chart')
    const chart = createChartComponent('pie', 'ds-1')
    engine.setChartComponent(node.id, chart)

    const json = JSON.parse(serialize(engine.project as never)) as LessonJSON
    const restored = deserialize(JSON.stringify(json))
    const restoredNode = restored.slides[0].scene.root.children.find((n) => n.name === 'Chart')
    expect(restoredNode!.components.chart!.chartType).toBe('pie')
    expect(restoredNode!.components.chart!.dataSourceId).toBe('ds-1')
    expect(restoredNode!.components.chart!.dataLabels).toEqual([])
    expect(restoredNode!.components.chart!.axisMin).toBeUndefined()
    expect(restoredNode!.components.chart!.axisMax).toBeUndefined()
  })
})

describe('DataKeyframes serialization', () => {
  it('round-trips data label tracks alongside property tracks', () => {
    const engine = engineWithProject()
    const slide = engine.project!.slides[0]
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Node')

    engine.addKeyframe({ kind: 'node', nodeId: node.id, property: 'positionX' }, 1, 10)
    engine.addKeyframe({ kind: 'node', nodeId: node.id, property: 'positionX' }, 3, 30)
    engine.addKeyframe({ kind: 'dataLabel', nodeId: node.id, label: 'revenue' }, 1, 100)
    engine.addKeyframe({ kind: 'dataLabel', nodeId: node.id, label: 'revenue' }, 3, 300)
    engine.addKeyframe({ kind: 'dataLabel', nodeId: node.id, label: 'cost' }, 2, 50)

    const json = engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    expect(restored.getKeyframes(node.id, 'positionX')).toHaveLength(2)
    expect(restored.getDataLabelKeyframes(node.id, 'revenue')).toHaveLength(2)
    expect(restored.getDataLabelKeyframes(node.id, 'cost')).toHaveLength(1)
    expect(restored.getDataLabelKeyframes(node.id, 'revenue')[0]?.value).toBe(100)
    expect(restored.getDataLabelKeyframes(node.id, 'revenue')[1]?.value).toBe(300)
    expect(restored.getDataLabelKeyframes(node.id, 'cost')[0]?.value).toBe(50)
  })

  it('serializes data label tracks in lesson JSON', () => {
    const engine = engineWithProject()
    const slide = engine.project!.slides[0]
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Node')

    engine.addKeyframe({ kind: 'dataLabel', nodeId: node.id, label: 'metric1' }, 0, 42)
    engine.addKeyframe({ kind: 'dataLabel', nodeId: node.id, label: 'metric1' }, 5, 84)

    const json = engine.toJSON()
    const slideJson = json.slides[0]
    const nodeAnimation = slideJson?.animation?.nodes.find((n) => n.nodeId === node.id)
    expect(nodeAnimation?.dataLabelTracks).toBeDefined()
    expect(nodeAnimation?.dataLabelTracks).toHaveLength(1)
    expect(nodeAnimation?.dataLabelTracks?.[0]?.label).toBe('metric1')
    expect(nodeAnimation?.dataLabelTracks?.[0]?.keyframes).toHaveLength(2)
    expect(nodeAnimation?.dataLabelTracks?.[0]?.keyframes[0]?.value).toBe(42)
    expect(nodeAnimation?.dataLabelTracks?.[0]?.keyframes[1]?.value).toBe(84)
  })

  it('preserves data label keyframe ids, times, and interpolation', () => {
    const engine = engineWithProject()
    const slide = engine.project!.slides[0]
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Node')

    engine.addKeyframe({ kind: 'dataLabel', nodeId: node.id, label: 'metric' }, 1, 10)
    const kf = engine.getDataLabelKeyframes(node.id, 'metric')[0]
    if (!kf) throw new Error('expected keyframe')

    engine.moveKeyframes({ kind: 'dataLabel', nodeId: node.id, label: 'metric' }, [
      { keyframeId: kf.id, newTime: 2 },
    ])
    engine.setKeyframeInterpolation(
      { kind: 'dataLabel', nodeId: node.id, label: 'metric' },
      kf.id,
      'bezier',
    )

    const json = engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    const restoredKf = restored.getDataLabelKeyframes(node.id, 'metric')[0]
    expect(restoredKf?.id).toBe(kf.id)
    expect(restoredKf?.time).toBe(2)
    expect(restoredKf?.value).toBe(10)
    expect(restoredKf?.interpolation).toBe('bezier')
  })

  it('validate accepts data label tracks', () => {
    const json: LessonJSON = {
      version: 1,
      project: { id: 'p', name: 'P', description: '', author: '', createdAt: 't', modifiedAt: 't' },
      slides: [
        {
          id: 's1',
          name: 'S1',
          duration: 10,
          scene: {
            id: 'sc1',
            nodes: [
              {
                id: 'root',
                name: 'Root',
                parentId: null,
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: {},
              },
              {
                id: 'cam',
                name: 'Camera',
                parentId: 'root',
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: { camera: { kind: 'camera' } },
              },
            ],
          },
          animation: {
            nodes: [
              {
                nodeId: 'root',
                tracks: [],
                dataLabelTracks: [
                  {
                    label: 'revenue',
                    keyframes: [
                      { id: 'k1', time: 0, value: 100 },
                      { id: 'k2', time: 5, value: 200 },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    }
    expect(validate(json)).toEqual([])
  })
})

describe('full round-trip with table, chart, and data keyframes', () => {
  it('creates table + chart with data keyframes, saves to .lesson, reloads with identical state', () => {
    const engine = engineWithProject()

    const ds: EmbeddedDataSourceDefinition = {
      id: 'ds-sales',
      name: 'Sales Data',
      dataPoints: [
        { label: 'Q1-Revenue', value: 100, series: 'Revenue' },
        { label: 'Q2-Revenue', value: 200, series: 'Revenue' },
        { label: 'Q1-Cost', value: 50, series: 'Cost' },
        { label: 'Q2-Cost', value: 80, series: 'Cost' },
      ],
    }
    engine.embedDataSource(ds)

    const slide = engine.project!.slides[0]
    const tableNode = engine.createNode(slide.scene.id, slide.scene.root.id, 'SalesTable')
    const table: TableComponent = {
      kind: 'table',
      columns: [{ width: 100 }, { width: 'auto' }, { width: 80 }],
      gap: 2,
      borderWidth: 1,
      borderColor: '#333333',
      borderRadius: 0,
      padding: 0,
    }
    engine.setTableComponent(tableNode.id, table)

    const chartNode = engine.createNode(slide.scene.id, slide.scene.root.id, 'SalesChart')
    const chart: ChartComponent = createChartComponent(
      'bar',
      'ds-sales',
      {
        colors: ['#4CAF50', '#F44336'],
        axisLabels: { x: 'Quarter', y: 'Amount' },
        legendPosition: 'right',
        padding: 8,
        fontFamily: 'Arial',
        fontSize: 12,
      },
      ['Q1-revenue', 'Q2-revenue'],
      0,
      250,
    )
    engine.setChartComponent(chartNode.id, chart)

    engine.addKeyframe({ kind: 'node', nodeId: tableNode.id, property: 'positionX' }, 0, 100)
    engine.addKeyframe({ kind: 'node', nodeId: tableNode.id, property: 'positionX' }, 5, 200)
    engine.addKeyframe({ kind: 'node', nodeId: chartNode.id, property: 'opacity' }, 0, 0)
    engine.addKeyframe({ kind: 'node', nodeId: chartNode.id, property: 'opacity' }, 3, 1)
    engine.addKeyframe({ kind: 'dataLabel', nodeId: chartNode.id, label: 'Q1-revenue' }, 0, 100)
    engine.addKeyframe({ kind: 'dataLabel', nodeId: chartNode.id, label: 'Q1-revenue' }, 5, 100)
    engine.addKeyframe({ kind: 'dataLabel', nodeId: chartNode.id, label: 'Q2-revenue' }, 0, 200)
    engine.addKeyframe({ kind: 'dataLabel', nodeId: chartNode.id, label: 'Q2-revenue' }, 5, 200)

    const savedJson = engine.toJSON()
    const savedText = JSON.stringify(savedJson)

    const restored = createEngine()
    restored.restoreFromJSON(JSON.parse(savedText))

    expect(restored.toJSON()).toEqual(savedJson)

    const restoredSlide = restored.project!.slides[0]
    const restoredTable = restoredSlide.scene.root.children.find((n) => n.name === 'SalesTable')
    const restoredChart = restoredSlide.scene.root.children.find((n) => n.name === 'SalesChart')

    expect(restoredTable).toBeDefined()
    expect(restoredTable!.components.table).toBeDefined()
    expect(restoredTable!.components.table!).toEqual(table)

    expect(restoredChart).toBeDefined()
    expect(restoredChart!.components.chart).toBeDefined()
    expect(restoredChart!.components.chart!.chartType).toBe('bar')
    expect(restoredChart!.components.chart!.dataSourceId).toBe('ds-sales')
    expect(restoredChart!.components.chart!.dataLabels).toEqual(['Q1-revenue', 'Q2-revenue'])
    expect(restoredChart!.components.chart!.axisMin).toBe(0)
    expect(restoredChart!.components.chart!.axisMax).toBe(250)
    expect(restoredChart!.components.chart!.visualConfig).toEqual({
      colors: ['#4CAF50', '#F44336'],
      axisLabels: { x: 'Quarter', y: 'Amount' },
      legendPosition: 'right',
      padding: 8,
      fontFamily: 'Arial',
      fontSize: 12,
    })

    if (!restoredTable || !restoredChart) {
      throw new Error('expected table and chart nodes')
    }

    expect(restored.getKeyframes(restoredTable.id, 'positionX')).toHaveLength(2)
    expect(restored.getKeyframes(restoredTable.id, 'positionX')[0]?.value).toBe(100)
    expect(restored.getKeyframes(restoredTable.id, 'positionX')[1]?.value).toBe(200)

    expect(restored.getKeyframes(restoredChart.id, 'opacity')).toHaveLength(2)
    expect(restored.getKeyframes(restoredChart.id, 'opacity')[0]?.value).toBe(0)
    expect(restored.getKeyframes(restoredChart.id, 'opacity')[1]?.value).toBe(1)

    expect(restored.getDataLabelKeyframes(restoredChart.id, 'Q1-revenue')).toHaveLength(2)
    expect(restored.getDataLabelKeyframes(restoredChart.id, 'Q1-revenue')[0]?.value).toBe(100)
    expect(restored.getDataLabelKeyframes(restoredChart.id, 'Q1-revenue')[1]?.value).toBe(100)
    expect(restored.getDataLabelKeyframes(restoredChart.id, 'Q2-revenue')).toHaveLength(2)
    expect(restored.getDataLabelKeyframes(restoredChart.id, 'Q2-revenue')[0]?.value).toBe(200)
    expect(restored.getDataLabelKeyframes(restoredChart.id, 'Q2-revenue')[1]?.value).toBe(200)
  })

  it('backward compatibility: old .lesson files without chart/table components still load', () => {
    const json: LessonJSON = {
      version: 1,
      project: { id: 'p', name: 'P', description: '', author: '', createdAt: 't', modifiedAt: 't' },
      slides: [
        {
          id: 's1',
          name: 'S1',
          duration: 10,
          scene: {
            id: 'sc1',
            nodes: [
              {
                id: 'root',
                name: 'Root',
                parentId: null,
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: {},
              },
              {
                id: 'cam',
                name: 'Camera',
                parentId: 'root',
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: { camera: { kind: 'camera' } },
              },
              {
                id: 'text',
                name: 'Text',
                parentId: 'root',
                transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: {
                  text: { kind: 'text', content: 'Hello', fontSize: 24, alignment: 'left' },
                },
              },
            ],
          },
        },
      ],
    }
    const restored = deserialize(JSON.stringify(json))
    expect(restored.slides).toHaveLength(1)
    expect(restored.slides[0].scene.root.children).toHaveLength(2)
    const textNode = restored.slides[0].scene.root.children.find((n) => n.name === 'Text')
    expect(textNode).toBeDefined()
    expect(textNode!.components.text).toBeDefined()
    expect(textNode!.components.text!.content).toBe('Hello')
  })
})
