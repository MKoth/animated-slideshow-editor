import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import { serialize, deserialize, validate } from '../../engine/lessonSerializer'
import type { LessonJSON } from '../../engine/json'
import type {
  EmbeddedDataSourceDefinition,
  EmbeddedFlowchartDataSourceDefinition,
} from '../../engine/embeddedDataSource'

function engineWithProject() {
  const engine = createEngine()
  engine.createProject({ name: 'P' })
  engine.createSlide('S1')
  return engine
}

describe('data source serialization round-trip', () => {
  it('round-trips a flat data source through the lesson file', () => {
    const engine = engineWithProject()
    const ds: EmbeddedDataSourceDefinition = {
      id: 'ds-1',
      name: 'Sales Data',
      dataPoints: [
        { label: 'Q1', value: 100, series: 'Revenue', tooltip: 'First quarter', color: '#ff0000' },
        { label: 'Q2', value: 200, series: 'Revenue' },
        { label: 'Q3', value: 150, series: 'Cost' },
      ],
    }
    engine.embedDataSource(ds)

    const json = JSON.parse(serialize(engine.project as never)) as LessonJSON
    expect(json.library?.data_sources).toHaveLength(1)

    const restored = deserialize(JSON.stringify(json))
    expect(restored.embeddedDataSources).toHaveLength(1)
    expect(restored.embeddedDataSources[0].id).toBe('ds-1')
    expect(restored.embeddedDataSources[0].name).toBe('Sales Data')
  })

  it('round-trips a flowchart data source through the lesson file', () => {
    const engine = engineWithProject()
    const fc: EmbeddedFlowchartDataSourceDefinition = {
      id: 'fc-1',
      name: 'Process Flow',
      nodes: [
        { id: 'n1', label: 'Start' },
        { id: 'n2', label: 'Process' },
        { id: 'n3', label: 'End' },
      ],
      edges: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
      ],
    }
    engine.embedDataSource(fc)

    const json = JSON.parse(serialize(engine.project as never)) as LessonJSON
    expect(json.library?.data_sources).toHaveLength(1)

    const restored = deserialize(JSON.stringify(json))
    expect(restored.embeddedDataSources).toHaveLength(1)
    expect(restored.embeddedDataSources[0].id).toBe('fc-1')
    expect(restored.embeddedDataSources[0].name).toBe('Process Flow')
  })

  it('round-trips multiple data sources', () => {
    const engine = engineWithProject()
    const ds: EmbeddedDataSourceDefinition = {
      id: 'ds-1',
      name: 'Chart Data',
      dataPoints: [{ label: 'A', value: 10 }],
    }
    const fc: EmbeddedFlowchartDataSourceDefinition = {
      id: 'fc-1',
      name: 'Flow',
      nodes: [
        { id: 'n1', label: 'Start' },
        { id: 'n2', label: 'End' },
      ],
      edges: [{ from: 'n1', to: 'n2' }],
    }
    engine.embedDataSource(ds)
    engine.embedDataSource(fc)

    const json = JSON.parse(serialize(engine.project as never)) as LessonJSON
    expect(json.library?.data_sources).toHaveLength(2)

    const restored = deserialize(JSON.stringify(json))
    expect(restored.embeddedDataSources).toHaveLength(2)
  })

  it('upserts data sources by id on embed', () => {
    const engine = engineWithProject()
    const ds1: EmbeddedDataSourceDefinition = {
      id: 'ds-1',
      name: 'V1',
      dataPoints: [{ label: 'A', value: 10 }],
    }
    const ds2: EmbeddedDataSourceDefinition = {
      id: 'ds-1',
      name: 'V2',
      dataPoints: [{ label: 'A', value: 20 }],
    }
    engine.embedDataSource(ds1)
    engine.embedDataSource(ds2)

    const json = JSON.parse(serialize(engine.project as never)) as LessonJSON
    expect(json.library?.data_sources).toHaveLength(1)
    expect(json.library?.data_sources?.[0]).toEqual({
      id: 'ds-1',
      name: 'V2',
      data_points: [{ label: 'A', value: 20 }],
    })
  })

  it('preserves data point optional fields through round-trip', () => {
    const engine = engineWithProject()
    const ds: EmbeddedDataSourceDefinition = {
      id: 'ds-1',
      name: 'Chart',
      dataPoints: [
        { label: 'A', value: 10, series: 'S1', tooltip: 'Tip A', color: '#ff0000' },
        { label: 'B', value: 20 },
      ],
    }
    engine.embedDataSource(ds)

    const json = JSON.parse(serialize(engine.project as never)) as LessonJSON
    const restored = deserialize(JSON.stringify(json))

    const restoredDs = restored.embeddedDataSources[0] as EmbeddedDataSourceDefinition
    expect(restoredDs.dataPoints[0].series).toBe('S1')
    expect(restoredDs.dataPoints[0].tooltip).toBe('Tip A')
    expect(restoredDs.dataPoints[0].color).toBe('#ff0000')
    expect(restoredDs.dataPoints[1].series).toBeUndefined()
  })

  it('preserves flowchart nodes and edges through round-trip', () => {
    const engine = engineWithProject()
    const fc: EmbeddedFlowchartDataSourceDefinition = {
      id: 'fc-1',
      name: 'Flow',
      nodes: [
        { id: 'n1', label: 'Start' },
        { id: 'n2', label: 'Process' },
        { id: 'n3', label: 'End' },
      ],
      edges: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
      ],
    }
    engine.embedDataSource(fc)

    const json = JSON.parse(serialize(engine.project as never)) as LessonJSON
    const restored = deserialize(JSON.stringify(json))

    const restoredFc = restored.embeddedDataSources[0] as EmbeddedFlowchartDataSourceDefinition
    expect(restoredFc.nodes).toEqual([
      { id: 'n1', label: 'Start' },
      { id: 'n2', label: 'Process' },
      { id: 'n3', label: 'End' },
    ])
    expect(restoredFc.edges).toEqual([
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3' },
    ])
  })

  it('produces no library section when no data sources embedded', () => {
    const engine = engineWithProject()
    const json = JSON.parse(serialize(engine.project as never)) as LessonJSON
    expect(json.library).toBeUndefined()
  })
})

describe('data source validation', () => {
  it('rejects duplicate data source ids', () => {
    const json: LessonJSON = {
      version: 1,
      project: { id: 'p', name: 'P', description: '', author: '', createdAt: '', modifiedAt: '' },
      slides: [],
      library: {
        data_sources: [
          { id: 'ds-1', name: 'A', data_points: [{ label: 'A', value: 1 }] },
          { id: 'ds-1', name: 'B', data_points: [{ label: 'B', value: 2 }] },
        ],
      },
    }
    const errors = validate(json)
    expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/already exists/)]))
  })

  it('rejects data source without data_points or flowchart', () => {
    const json = {
      version: 1,
      project: { id: 'p', name: 'P', description: '', author: '', createdAt: '', modifiedAt: '' },
      slides: [],
      library: {
        data_sources: [{ id: 'ds-1', name: 'A' }],
      },
    } as unknown as LessonJSON
    const errors = validate(json)
    expect(errors).toEqual(
      expect.arrayContaining([expect.stringMatching(/data_points or.*flowchart/)]),
    )
  })

  it('rejects flat data source with duplicate labels', () => {
    const json: LessonJSON = {
      version: 1,
      project: { id: 'p', name: 'P', description: '', author: '', createdAt: '', modifiedAt: '' },
      slides: [],
      library: {
        data_sources: [
          {
            id: 'ds-1',
            name: 'A',
            data_points: [
              { label: 'X', value: 1 },
              { label: 'X', value: 2 },
            ],
          },
        ],
      },
    }
    const errors = validate(json)
    expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/duplicate.*label/)]))
  })

  it('rejects flowchart with unknown node reference', () => {
    const json: LessonJSON = {
      version: 1,
      project: { id: 'p', name: 'P', description: '', author: '', createdAt: '', modifiedAt: '' },
      slides: [],
      library: {
        data_sources: [
          {
            id: 'fc-1',
            name: 'F',
            flowchart: {
              nodes: [{ id: 'n1', label: 'A' }],
              edges: [{ from: 'n1', to: 'n2' }],
            },
          },
        ],
      },
    }
    const errors = validate(json)
    expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/unknown node/)]))
  })

  it('rejects flowchart with duplicate node ids', () => {
    const json: LessonJSON = {
      version: 1,
      project: { id: 'p', name: 'P', description: '', author: '', createdAt: '', modifiedAt: '' },
      slides: [],
      library: {
        data_sources: [
          {
            id: 'fc-1',
            name: 'F',
            flowchart: {
              nodes: [
                { id: 'n1', label: 'A' },
                { id: 'n1', label: 'B' },
              ],
              edges: [],
            },
          },
        ],
      },
    }
    const errors = validate(json)
    expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/duplicate.*node.*id/)]))
  })

  it('rejects flowchart with a cycle', () => {
    const json: LessonJSON = {
      version: 1,
      project: { id: 'p', name: 'P', description: '', author: '', createdAt: '', modifiedAt: '' },
      slides: [],
      library: {
        data_sources: [
          {
            id: 'fc-1',
            name: 'F',
            flowchart: {
              nodes: [
                { id: 'n1', label: 'A' },
                { id: 'n2', label: 'B' },
                { id: 'n3', label: 'C' },
              ],
              edges: [
                { from: 'n1', to: 'n2' },
                { from: 'n2', to: 'n3' },
                { from: 'n3', to: 'n1' },
              ],
            },
          },
        ],
      },
    }
    const errors = validate(json)
    expect(errors).toEqual(expect.arrayContaining([expect.stringMatching(/cycle/)]))
  })
})
