import type { Engine } from '../internal'
import type { Command } from './command'
import type { ChartComponent } from '../components'

export interface SetChartComponentParameters {
  readonly nodeId: string
  readonly chart: ChartComponent
}

export interface SetChartComponentInverse {
  readonly nodeId: string
  readonly oldChart: ChartComponent
}

export class SetChartComponentCommand implements Command<SetChartComponentInverse> {
  readonly type = 'SetChartComponent'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #chart: ChartComponent

  constructor(input: SetChartComponentParameters) {
    this.#nodeId = input.nodeId
    this.#chart = input.chart
    this.parameters = { nodeId: input.nodeId, chart: input.chart }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.chart) {
      throw new Error(`Node "${this.#nodeId}" does not have a chart component`)
    }
  }

  execute(engine: Engine): SetChartComponentInverse {
    const node = engine.getNode(this.#nodeId)
    const oldChart = node.components.chart!
    engine.setChartComponent(this.#nodeId, this.#chart)
    return { nodeId: this.#nodeId, oldChart }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
