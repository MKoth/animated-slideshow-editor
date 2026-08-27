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
