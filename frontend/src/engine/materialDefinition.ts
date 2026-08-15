import type { MaterialParameterDefault } from './materialResolution'

export class MaterialDefinition {
  readonly id: string
  readonly name: string
  readonly parameters: readonly MaterialParameterDefault[]
  readonly shaderId: string | null

  constructor(
    id: string,
    name: string,
    parameters: readonly MaterialParameterDefault[] = [],
    shaderId: string | null = null,
  ) {
    this.id = id
    this.name = name
    this.parameters = Object.freeze([...parameters])
    this.shaderId = shaderId
    Object.freeze(this)
  }
}
