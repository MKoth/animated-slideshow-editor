export interface EmbeddedAsset {
  readonly id: string
  readonly name: string
  readonly data: string
  readonly mimeType: string
  readonly metadata?: Readonly<Record<string, unknown>>
}
