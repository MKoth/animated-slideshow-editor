import type { Engine } from '../internal'
import type { Command } from './command'
import type { CircleComponent } from '../circleComponent'
import { requireCircleAngle, requireCircleSegments, requireRadius } from '../circleComponent'

export interface SetCircleComponentParameters {
  readonly nodeId: string
  readonly circle: CircleComponent
}

export interface SetCircleComponentInverse {
  readonly nodeId: string
  readonly oldCircle: CircleComponent
}

export class SetCircleComponentCommand implements Command<SetCircleComponentInverse> {
  readonly type = 'SetCircleComponent'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #circle: CircleComponent

  constructor(input: SetCircleComponentParameters) {
    this.#nodeId = input.nodeId
    this.#circle = input.circle
    this.parameters = { nodeId: input.nodeId, circle: input.circle }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.components.circle) {
      throw new Error(`Node "${this.#nodeId}" does not have a circle component`)
    }
    requireRadius(this.#circle.radius, 'Circle radius')
    requireCircleAngle(this.#circle.startAngle, 'Circle startAngle')
    requireCircleAngle(this.#circle.endAngle, 'Circle endAngle')
    if (this.#circle.segments !== undefined) {
      requireCircleSegments(this.#circle.segments, 'Circle segments')
    }
  }

  execute(engine: Engine): SetCircleComponentInverse {
    const node = engine.getNode(this.#nodeId)
    const oldCircle = node.components.circle!
    engine.setCircleComponent(this.#nodeId, this.#circle)
    return { nodeId: this.#nodeId, oldCircle }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
