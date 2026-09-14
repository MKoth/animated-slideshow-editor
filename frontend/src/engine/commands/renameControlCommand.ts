import type { Engine } from '../internal'
import type { Command } from './command'
import { CONTROL_KEY_PATTERN } from '../control'

export interface RenameControlParameters {
  readonly hostNodeId: string
  readonly oldKey: string
  readonly newKey: string
}

export interface RenameControlInverse {
  readonly hostNodeId: string
  readonly oldKey: string
  readonly newKey: string
}

export class RenameControlCommand implements Command<RenameControlInverse> {
  readonly type = 'RenameControl'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #hostNodeId: string
  readonly #oldKey: string
  readonly #newKey: string

  constructor(input: RenameControlParameters) {
    this.#hostNodeId = input.hostNodeId
    this.#oldKey = input.oldKey
    this.#newKey = input.newKey
    this.parameters = { hostNodeId: input.hostNodeId, oldKey: input.oldKey, newKey: input.newKey }
  }

  validate(engine: Engine): void {
    const host = engine.getNode(this.#hostNodeId)
    const controlSet = host.controlSet
    if (!controlSet) throw new Error(`Node "${this.#hostNodeId}" has no controlSet`)
    if (!CONTROL_KEY_PATTERN.test(this.#newKey))
      throw new Error(`Invalid control key "${this.#newKey}"`)
    if (this.#oldKey === this.#newKey) throw new Error('Control key is unchanged')
    if (!controlSet.controls.some((c) => c.key === this.#oldKey))
      throw new Error(`Control "${this.#oldKey}" not found on node "${this.#hostNodeId}"`)
    if (controlSet.controls.some((c) => c.key === this.#newKey))
      throw new Error(`Duplicate control key: ${this.#newKey}`)
    // Also check that no slide has newKey track that would collide
    const project = engine.project
    if (project) {
      for (const slide of project.slides) {
        const anim = slide.animation.node(this.#hostNodeId)
        if (anim?.hasControlTrack(this.#newKey)) {
          throw new Error(`Control track "${this.#newKey}" already exists on slide "${slide.id}"`)
        }
      }
    }
  }

  execute(engine: Engine): RenameControlInverse {
    engine.renameControl(this.#hostNodeId, this.#oldKey, this.#newKey)
    return { hostNodeId: this.#hostNodeId, oldKey: this.#oldKey, newKey: this.#newKey }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
