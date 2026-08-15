import type { Engine } from '../internal'
import type { Command } from './command'
import type { MaterialOverrides } from '../materialInstance'

export interface AssignMaterialParameters {
  readonly nodeId: string
  readonly materialDefinitionId: string
}

export interface AssignMaterialInverse {
  readonly nodeId: string
  readonly previousMaterialDefinitionId: string
  readonly previousOverrides: MaterialOverrides
}

export class AssignMaterialCommand implements Command<AssignMaterialInverse> {
  readonly type = 'AssignMaterial'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #materialDefinitionId: string

  constructor(input: AssignMaterialParameters) {
    this.#nodeId = input.nodeId
    this.#materialDefinitionId = input.materialDefinitionId
    this.parameters = {
      nodeId: input.nodeId,
      materialDefinitionId: input.materialDefinitionId,
    }
  }

  validate(engine: Engine): void {
    engine.getNode(this.#nodeId)
    engine.getMaterialDefinition(this.#materialDefinitionId)
  }

  execute(engine: Engine): AssignMaterialInverse {
    const node = engine.getNode(this.#nodeId)
    const inverse: AssignMaterialInverse = {
      nodeId: this.#nodeId,
      previousMaterialDefinitionId: node.material.materialDefinitionId,
      previousOverrides: { ...node.material.overrides },
    }
    engine.assignMaterial(this.#nodeId, this.#materialDefinitionId)
    return inverse
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
