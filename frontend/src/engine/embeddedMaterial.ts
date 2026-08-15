export interface EmbeddedMaterialParameter {
  readonly key: string
  readonly kind: string
  readonly default: string | number | boolean | readonly number[]
}

export interface EmbeddedMaterialDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly tags: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
  readonly parameters: readonly EmbeddedMaterialParameter[]
  readonly shaderId: string | null
}
