export type TransformJSON = {
  readonly x: number
  readonly y: number
  readonly rotation: number
  readonly scaleX: number
  readonly scaleY: number
}

export type NodeComponentsJSON = {
  readonly camera?: { readonly kind: 'camera' }
  readonly assetInstance?: { readonly kind: 'assetInstance'; readonly assetDefinitionId: string }
  readonly text?: {
    readonly kind: 'text'
    readonly content: string
    readonly fontSize: number
    readonly alignment: string
  }
}

export type NodeJSON = {
  readonly id: string
  readonly name: string
  readonly parentId: string | null
  readonly transform: TransformJSON
  readonly visible: boolean
  readonly opacity?: number
  readonly components: NodeComponentsJSON
}

export type SceneJSON = {
  readonly id: string
  readonly nodes: readonly NodeJSON[]
}

export type SlideJSON = {
  readonly id: string
  readonly name: string
  readonly duration: number
  readonly scene: SceneJSON
}

export type ProjectMetadataJSON = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly author: string
  readonly createdAt: string
  readonly updatedAt: string
}

export type ProjectJSON = {
  readonly metadata: ProjectMetadataJSON
  readonly settings?: Readonly<Record<string, unknown>>
  readonly slides: readonly SlideJSON[]
}

export type AssetDefinitionJSON = {
  readonly id: string
  readonly name: string
}

export type LessonJSON = {
  readonly project: ProjectJSON
  readonly library: {
    readonly assetDefinitions: readonly AssetDefinitionJSON[]
  }
}
