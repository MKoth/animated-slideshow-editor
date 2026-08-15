export interface EmbeddedShaderDefinition {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly tags: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
  readonly source: string
  readonly defaultUniforms: readonly Readonly<Record<string, unknown>>[]
  readonly isBuiltin: boolean
}
