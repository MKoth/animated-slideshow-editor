import type { Engine } from '../internal'
import type { Command } from './command'
import { requireFiniteNumber } from '../guards'

export interface ScaleNodeParameters {
  readonly nodeId: string
  readonly scaleX: number
  readonly scaleY: number
}

export interface ScaleNodeInverse {
  readonly nodeId: string
  readonly oldScaleX: number
  readonly oldScaleY: number
}

export class ScaleNodeCommand implements Command<ScaleNodeInverse> {
  readonly type = 'ScaleNode'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #scaleX: number
  readonly #scaleY: number

  constructor(input: ScaleNodeParameters) {
    this.#nodeId = input.nodeId
    this.#scaleX = input.scaleX
    this.#scaleY = input.scaleY
    this.parameters = { nodeId: input.nodeId, scaleX: this.#scaleX, scaleY: this.#scaleY }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    requireFiniteNumber(this.#scaleX, 'ScaleX')
    requireFiniteNumber(this.#scaleY, 'ScaleY')
  }

  execute(engine: Engine): ScaleNodeInverse {
    const node = engine.getNode(this.#nodeId)
    const { transform } = node
    // Scale Group / Rig Handle is empty Group Node - force uniform scale to keep skinning local (single Gm)
    const c = node.components as Record<string, unknown>
    const isGroup =
      !c.mesh &&
      !c.bone &&
      !c.text &&
      !c.circle &&
      !c.assetInstance &&
      !c.table &&
      !c.tableRow &&
      !c.tableCell &&
      !c.chart &&
      !c.camera &&
      node.children.length > 0
    let scaleX = this.#scaleX
    let scaleY = this.#scaleY
    if (isGroup && Math.abs(scaleX - scaleY) > 1e-6) {
      // Use the axis that actually changed, fallback to average
      if (Math.abs(scaleX - transform.scaleX) > 1e-6) {
        scaleY = scaleX
      } else if (Math.abs(scaleY - transform.scaleY) > 1e-6) {
        scaleX = scaleY
      } else {
        const avg = (scaleX + scaleY) / 2
        scaleX = avg
        scaleY = avg
      }
    }
    engine.setTransform(this.#nodeId, {
      ...transform,
      scaleX,
      scaleY,
    })
    return { nodeId: this.#nodeId, oldScaleX: transform.scaleX, oldScaleY: transform.scaleY }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
