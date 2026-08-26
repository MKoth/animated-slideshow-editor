import { describe, expect, it } from 'vitest'
import { DataSourceDefinition } from '../../engine/dataSourceDefinition'
import {
  FlowchartDataSourceDefinition,
  type FlowchartNode,
} from '../../engine/flowchartDataSourceDefinition'

describe('DataSourceDefinition', () => {
  it('creates a definition with data points', () => {
    const ds = new DataSourceDefinition('ds-1', 'Sales Data', [
      { label: 'Q1', value: 100 },
      { label: 'Q2', value: 200 },
    ])

    expect(ds.id).toBe('ds-1')
    expect(ds.name).toBe('Sales Data')
    expect(ds.dataPoints).toHaveLength(2)
    expect(ds.dataPoints[0].label).toBe('Q1')
    expect(ds.dataPoints[0].value).toBe(100)
  })

  it('creates a definition with optional fields', () => {
    const ds = new DataSourceDefinition('ds-1', 'Chart Data', [
      { label: 'A', value: 10, series: 'Series 1', tooltip: 'Tooltip A', color: '#ff0000' },
    ])

    const point = ds.dataPoints[0]
    expect(point.series).toBe('Series 1')
    expect(point.tooltip).toBe('Tooltip A')
    expect(point.color).toBe('#ff0000')
  })

  it('defaults optional fields to undefined', () => {
    const ds = new DataSourceDefinition('ds-1', 'Chart Data', [{ label: 'A', value: 10 }])

    const point = ds.dataPoints[0]
    expect(point.series).toBeUndefined()
    expect(point.tooltip).toBeUndefined()
    expect(point.color).toBeUndefined()
  })

  it('rejects duplicate labels', () => {
    expect(
      () =>
        new DataSourceDefinition('ds-1', 'Chart Data', [
          { label: 'A', value: 10 },
          { label: 'A', value: 20 },
        ]),
    ).toThrow(/duplicate.*label/i)
  })

  it('rejects non-string label', () => {
    expect(
      () =>
        new DataSourceDefinition('ds-1', 'Chart Data', [
          { label: 123 as unknown as string, value: 10 },
        ]),
    ).toThrow(/label/i)
  })

  it('rejects empty label', () => {
    expect(
      () => new DataSourceDefinition('ds-1', 'Chart Data', [{ label: '', value: 10 }]),
    ).toThrow(/label/i)
  })

  it('rejects non-number value', () => {
    expect(
      () =>
        new DataSourceDefinition('ds-1', 'Chart Data', [
          { label: 'A', value: 'not a number' as unknown as number },
        ]),
    ).toThrow(/value/i)
  })

  it('rejects non-finite value', () => {
    expect(
      () => new DataSourceDefinition('ds-1', 'Chart Data', [{ label: 'A', value: NaN }]),
    ).toThrow(/value/i)
  })

  it('is immutable after creation', () => {
    const ds = new DataSourceDefinition('ds-1', 'Chart Data', [{ label: 'A', value: 10 }])

    expect(() => {
      ;(ds as { id: string }).id = 'changed'
    }).toThrow()
    expect(() => {
      ;(ds as { name: string }).name = 'changed'
    }).toThrow()
    expect(() => {
      ;(ds.dataPoints as unknown as { label: string }[])[0].label = 'changed'
    }).toThrow()
  })

  it('groups data points by series', () => {
    const ds = new DataSourceDefinition('ds-1', 'Chart Data', [
      { label: 'Q1-Rev', value: 100, series: 'Revenue' },
      { label: 'Q2-Rev', value: 200, series: 'Revenue' },
      { label: 'Q1-Cost', value: 50, series: 'Cost' },
      { label: 'Q2-Cost', value: 80, series: 'Cost' },
    ])

    const groups = ds.groupBySeries()
    expect(groups.size).toBe(2)
    expect(groups.get('Revenue')).toHaveLength(2)
    expect(groups.get('Cost')).toHaveLength(2)
    expect(groups.get('Revenue')?.[0].label).toBe('Q1-Rev')
    expect(groups.get('Revenue')?.[1].label).toBe('Q2-Rev')
  })

  it('treats undefined series as empty string group', () => {
    const ds = new DataSourceDefinition('ds-1', 'Chart Data', [
      { label: 'A', value: 10 },
      { label: 'B', value: 20 },
    ])

    const groups = ds.groupBySeries()
    expect(groups.size).toBe(1)
    expect(groups.get('')).toHaveLength(2)
  })

  it('looks up data point by label', () => {
    const ds = new DataSourceDefinition('ds-1', 'Chart Data', [
      { label: 'Q1', value: 100 },
      { label: 'Q2', value: 200 },
    ])

    expect(ds.getByLabel('Q1')).toEqual({ label: 'Q1', value: 100 })
    expect(ds.getByLabel('Q2')).toEqual({ label: 'Q2', value: 200 })
    expect(ds.getByLabel('missing')).toBeUndefined()
  })

  it('serializes to JSON', () => {
    const ds = new DataSourceDefinition('ds-1', 'Chart Data', [
      { label: 'A', value: 10, series: 'S1', tooltip: 'Tip', color: '#ff0000' },
    ])

    const json = ds.toJSON()
    expect(json).toEqual({
      id: 'ds-1',
      name: 'Chart Data',
      data_points: [{ label: 'A', value: 10, series: 'S1', tooltip: 'Tip', color: '#ff0000' }],
    })
  })

  it('round-trips through JSON', () => {
    const original = new DataSourceDefinition('ds-1', 'Chart Data', [
      { label: 'A', value: 10, series: 'S1', tooltip: 'Tip', color: '#ff0000' },
      { label: 'B', value: 20 },
    ])

    const restored = DataSourceDefinition.fromJSON(original.toJSON())
    expect(restored.id).toBe(original.id)
    expect(restored.name).toBe(original.name)
    expect(restored.dataPoints).toEqual(original.dataPoints)
  })
})

describe('FlowchartDataSourceDefinition', () => {
  it('creates a flowchart with nodes and edges', () => {
    const ds = new FlowchartDataSourceDefinition(
      'fc-1',
      'Process Flow',
      [
        { id: 'n1', label: 'Start' },
        { id: 'n2', label: 'Process' },
        { id: 'n3', label: 'End' },
      ],
      [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
      ],
    )

    expect(ds.id).toBe('fc-1')
    expect(ds.name).toBe('Process Flow')
    expect(ds.nodes).toHaveLength(3)
    expect(ds.edges).toHaveLength(2)
  })

  it('rejects duplicate node ids', () => {
    expect(
      () =>
        new FlowchartDataSourceDefinition(
          'fc-1',
          'Flow',
          [
            { id: 'n1', label: 'A' },
            { id: 'n1', label: 'B' },
          ],
          [],
        ),
    ).toThrow(/duplicate.*node.*id/i)
  })

  it('rejects edge referencing unknown node', () => {
    expect(
      () =>
        new FlowchartDataSourceDefinition(
          'fc-1',
          'Flow',
          [{ id: 'n1', label: 'A' }],
          [{ from: 'n1', to: 'n2' }],
        ),
    ).toThrow(/unknown.*node/i)
  })

  it('rejects edge from unknown node', () => {
    expect(
      () =>
        new FlowchartDataSourceDefinition(
          'fc-1',
          'Flow',
          [{ id: 'n1', label: 'A' }],
          [{ from: 'n2', to: 'n1' }],
        ),
    ).toThrow(/unknown.*node/i)
  })

  it('rejects cycles', () => {
    expect(
      () =>
        new FlowchartDataSourceDefinition(
          'fc-1',
          'Flow',
          [
            { id: 'n1', label: 'A' },
            { id: 'n2', label: 'B' },
            { id: 'n3', label: 'C' },
          ],
          [
            { from: 'n1', to: 'n2' },
            { from: 'n2', to: 'n3' },
            { from: 'n3', to: 'n1' },
          ],
        ),
    ).toThrow(/cycle/i)
  })

  it('allows self-loops', () => {
    const ds = new FlowchartDataSourceDefinition(
      'fc-1',
      'Flow',
      [{ id: 'n1', label: 'A' }],
      [{ from: 'n1', to: 'n1' }],
    )

    expect(ds.edges).toHaveLength(1)
  })

  it('is immutable after creation', () => {
    const ds = new FlowchartDataSourceDefinition(
      'fc-1',
      'Flow',
      [{ id: 'n1', label: 'A' }],
      [{ from: 'n1', to: 'n1' }],
    )

    expect(() => {
      ;(ds as { id: string }).id = 'changed'
    }).toThrow()
    expect(() => {
      ;(ds as unknown as { nodes: FlowchartNode[] }).nodes.push({ id: 'n2', label: 'B' })
    }).toThrow()
    expect(() => {
      ;(ds as unknown as { edges: { from: string; to: string }[] }).edges.push({
        from: 'n1',
        to: 'n1',
      })
    }).toThrow()
  })

  it('serializes to JSON', () => {
    const ds = new FlowchartDataSourceDefinition(
      'fc-1',
      'Flow',
      [
        { id: 'n1', label: 'Start' },
        { id: 'n2', label: 'End' },
      ],
      [{ from: 'n1', to: 'n2' }],
    )

    const json = ds.toJSON()
    expect(json).toEqual({
      id: 'fc-1',
      name: 'Flow',
      flowchart: {
        nodes: [
          { id: 'n1', label: 'Start' },
          { id: 'n2', label: 'End' },
        ],
        edges: [{ from: 'n1', to: 'n2' }],
      },
    })
  })

  it('round-trips through JSON', () => {
    const original = new FlowchartDataSourceDefinition(
      'fc-1',
      'Flow',
      [
        { id: 'n1', label: 'Start' },
        { id: 'n2', label: 'Process' },
        { id: 'n3', label: 'End' },
      ],
      [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
      ],
    )

    const restored = FlowchartDataSourceDefinition.fromJSON(original.toJSON())
    expect(restored.id).toBe(original.id)
    expect(restored.name).toBe(original.name)
    expect(restored.nodes).toEqual(original.nodes)
    expect(restored.edges).toEqual(original.edges)
  })
})
