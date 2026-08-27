import type { DataKeyframe, DataPoint } from './components'
import type { DataSourceDefinition } from './dataSourceDefinition'

export interface EvaluatedData {
  readonly from: readonly DataPoint[]
  readonly to: readonly DataPoint[]
  readonly t: number
}

const EMPTY_POINTS: readonly DataPoint[] = []

export function evaluateData(
  dataKeyframes: readonly DataKeyframe[],
  dataSourceDefinition: DataSourceDefinition | undefined,
  time: number,
): EvaluatedData {
  if (dataKeyframes.length === 0) {
    const points = [...(dataSourceDefinition?.dataPoints ?? EMPTY_POINTS)]
    return { from: points, to: points, t: 0 }
  }

  const first = dataKeyframes[0]
  const last = dataKeyframes[dataKeyframes.length - 1]

  if (time < first.time) {
    return { from: [...first.dataPoints], to: [...first.dataPoints], t: 0 }
  }

  if (time > last.time) {
    return { from: [...last.dataPoints], to: [...last.dataPoints], t: 0 }
  }

  if (dataKeyframes.length === 1) {
    return { from: [...first.dataPoints], to: [...first.dataPoints], t: 0 }
  }

  for (let i = 0; i < dataKeyframes.length - 1; i += 1) {
    const from = dataKeyframes[i]
    const to = dataKeyframes[i + 1]
    if (from.time === to.time) {
      if (time === from.time) {
        return { from: [...to.dataPoints], to: [...to.dataPoints], t: 0 }
      }
      continue
    }
    if (time === from.time) {
      return { from: [...from.dataPoints], to: [...from.dataPoints], t: 0 }
    }
    if (time > from.time && time < to.time) {
      const t = (time - from.time) / (to.time - from.time)
      return { from: [...from.dataPoints], to: [...to.dataPoints], t }
    }
  }

  return { from: [...last.dataPoints], to: [...last.dataPoints], t: 0 }
}

export function interpolateDataPoints(data: EvaluatedData): DataPoint[] {
  const { from, to, t } = data
  if (from.length === 0 && to.length === 0) {
    return []
  }

  const fromMap = new Map<string, DataPoint>()
  for (const point of from) {
    fromMap.set(point.label, point)
  }

  const toMap = new Map<string, DataPoint>()
  for (const point of to) {
    toMap.set(point.label, point)
  }

  const allLabels = new Set<string>()
  for (const point of to) {
    allLabels.add(point.label)
  }
  for (const point of from) {
    allLabels.add(point.label)
  }

  const result: DataPoint[] = []
  for (const label of allLabels) {
    const fromPoint = fromMap.get(label)
    const toPoint = toMap.get(label)

    if (fromPoint && toPoint) {
      const interpolatedValue = fromPoint.value + (toPoint.value - fromPoint.value) * t
      result.push({
        label,
        value: interpolatedValue,
        series: toPoint.series ?? fromPoint.series,
        tooltip: toPoint.tooltip ?? fromPoint.tooltip,
        color: toPoint.color ?? fromPoint.color,
      })
    } else if (toPoint) {
      result.push({ ...toPoint })
    } else if (fromPoint) {
      result.push({ ...fromPoint })
    }
  }

  return result
}

export function evaluatedDataEqual(a: EvaluatedData, b: EvaluatedData): boolean {
  if (a.t !== b.t) return false
  if (a.from.length !== b.to.length) return false
  if (a.to.length !== b.to.length) return false

  for (let i = 0; i < a.from.length; i++) {
    const af = a.from[i]
    const bf = b.from[i]
    if (!af || !bf) return false
    if (af.label !== bf.label || af.value !== bf.value) return false
  }

  for (let i = 0; i < a.to.length; i++) {
    const at = a.to[i]
    const bt = b.to[i]
    if (!at || !bt) return false
    if (at.label !== bt.label || at.value !== bt.value) return false
  }

  return true
}
