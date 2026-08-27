import type { DataPoint } from './components'

export interface EvaluatedData {
  readonly from: readonly DataPoint[]
  readonly to: readonly DataPoint[]
  readonly t: number
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
  if (a.from.length !== b.from.length) return false
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
