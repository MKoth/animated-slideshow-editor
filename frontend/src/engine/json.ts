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

export type MaterialJSON = {
  readonly definitionId: string
  readonly overrides: Readonly<Record<string, string | number>>
}

export type FullscreenShaderJSON = {
  readonly shaderDefinitionId: string
  readonly overrides: Readonly<Record<string, string | number>>
}

export type NodeJSON = {
  readonly id: string
  readonly name: string
  readonly parentId: string | null
  readonly transform: TransformJSON
  readonly visible: boolean
  readonly opacity?: number
  readonly material?: MaterialJSON
  readonly components: NodeComponentsJSON
}

export type SceneJSON = {
  readonly id: string
  readonly nodes: readonly NodeJSON[]
}

export type KeyframeJSON = {
  readonly id: string
  readonly time: number
  readonly value: number
}

export type PropertyTrackJSON = {
  readonly property: string
  readonly keyframes: readonly KeyframeJSON[]
}

export type NodeAnimationJSON = {
  readonly nodeId: string
  readonly tracks: readonly PropertyTrackJSON[]
}

export type SlideAnimationJSON = {
  readonly nodes: readonly NodeAnimationJSON[]
}

export type SlideJSON = {
  readonly id: string
  readonly name: string
  readonly duration: number
  readonly scene: SceneJSON
  readonly animation?: SlideAnimationJSON
  readonly fullscreenShader?: FullscreenShaderJSON
}

export type LessonProjectJSON = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly author: string
  readonly createdAt: string
  readonly modifiedAt: string
  readonly settings?: Readonly<Record<string, unknown>>
}

export type EmbeddedAssetJSON = {
  readonly id: string
  readonly name: string
  readonly data: string
  readonly mimeType: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export type MaterialParameterJSON = {
  readonly key: string
  readonly kind: string
  readonly default: string | number | boolean | readonly number[]
}

export type EmbeddedMaterialJSON = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly tags: readonly string[]
  readonly created_at: string
  readonly updated_at: string
  readonly parameters: readonly MaterialParameterJSON[]
  readonly shader_id?: string | null
}

export type EmbeddedShaderJSON = {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly tags: readonly string[]
  readonly created_at: string
  readonly updated_at: string
  readonly source: string
  readonly default_uniforms: readonly Readonly<Record<string, unknown>>[]
  readonly is_builtin: boolean
}

export type LessonLibraryJSON = {
  readonly assets?: readonly EmbeddedAssetJSON[]
  readonly materials?: readonly EmbeddedMaterialJSON[]
  readonly shaders?: readonly EmbeddedShaderJSON[]
}

export type LessonJSON = {
  readonly version: 1
  readonly project: LessonProjectJSON
  readonly slides: readonly SlideJSON[]
  readonly library?: LessonLibraryJSON
}
