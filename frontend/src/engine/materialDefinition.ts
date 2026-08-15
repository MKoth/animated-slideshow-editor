export class MaterialDefinition {
  readonly id: string
  readonly name: string

  constructor(id: string, name: string) {
    this.id = id
    this.name = name
    Object.freeze(this)
  }
}
