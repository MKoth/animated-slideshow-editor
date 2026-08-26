export interface DataPoint {
  readonly label: string
  readonly value: number
  readonly series?: string
  readonly tooltip?: string
  readonly color?: string
}

export interface DataSourceDefinitionJSON {
  readonly id: string
  readonly name: string
  readonly data_points: readonly {
    readonly label: string
    readonly value: number
    readonly series?: string
    readonly tooltip?: string
    readonly color?: string
  }[]
}

export class DataSourceDefinition {
  readonly id: string
  readonly name: string
  readonly dataPoints: readonly DataPoint[]

  constructor(id: string, name: string, dataPoints: readonly DataPoint[]) {
    if (typeof id !== 'string' || id === '') {
      throw new Error('DataSourceDefinition id must be a non-empty string')
    }
    if (typeof name !== 'string' || name === '') {
      throw new Error('DataSourceDefinition name must be a non-empty string')
    }
    const labels = new Set<string>()
    const validatedPoints: DataPoint[] = []
    for (const point of dataPoints) {
      if (typeof point.label !== 'string' || point.label === '') {
        throw new Error('Data point label must be a non-empty string')
      }
      if (typeof point.value !== 'number' || !Number.isFinite(point.value)) {
        throw new Error(`Data point "${point.label}" value must be a finite number`)
      }
      if (labels.has(point.label)) {
        throw new Error(`Duplicate data point label: "${point.label}"`)
      }
      labels.add(point.label)
      validatedPoints.push({
        label: point.label,
        value: point.value,
        ...(point.series !== undefined ? { series: point.series } : {}),
        ...(point.tooltip !== undefined ? { tooltip: point.tooltip } : {}),
        ...(point.color !== undefined ? { color: point.color } : {}),
      })
    }
    this.id = id
    this.name = name
    this.dataPoints = Object.freeze(validatedPoints.map((p) => Object.freeze({ ...p })))
    Object.freeze(this)
  }

  getByLabel(label: string): DataPoint | undefined {
    return this.dataPoints.find((point) => point.label === label)
  }

  groupBySeries(): Map<string, readonly DataPoint[]> {
    const groups = new Map<string, readonly DataPoint[]>()
    for (const point of this.dataPoints) {
      const key = point.series ?? ''
      const existing = groups.get(key)
      if (existing) {
        groups.set(key, [...existing, point])
      } else {
        groups.set(key, [point])
      }
    }
    return groups
  }

  toJSON(): DataSourceDefinitionJSON {
    return {
      id: this.id,
      name: this.name,
      data_points: this.dataPoints.map((point) => ({
        label: point.label,
        value: point.value,
        ...(point.series !== undefined ? { series: point.series } : {}),
        ...(point.tooltip !== undefined ? { tooltip: point.tooltip } : {}),
        ...(point.color !== undefined ? { color: point.color } : {}),
      })),
    }
  }

  static fromJSON(json: DataSourceDefinitionJSON): DataSourceDefinition {
    return new DataSourceDefinition(
      json.id,
      json.name,
      json.data_points.map((point) => ({
        label: point.label,
        value: point.value,
        ...(point.series !== undefined ? { series: point.series } : {}),
        ...(point.tooltip !== undefined ? { tooltip: point.tooltip } : {}),
        ...(point.color !== undefined ? { color: point.color } : {}),
      })),
    )
  }
}
