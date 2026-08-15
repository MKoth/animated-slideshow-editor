import type { MaterialParameterDefault } from './materialResolution'

export class MaterialDefinition {
  readonly id: string
  readonly name: string
  readonly parameters: readonly MaterialParameterDefault[]

  constructor(id: string, name: string, parameters: readonly MaterialParameterDefault[] = []) {
    this.id = id
    this.name = name
    this.parameters = Object.freeze([...parameters])
    Object.freeze(this)
  }
}
