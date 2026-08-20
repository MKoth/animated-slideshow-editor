import type { MaterialOverrideValue } from './materialInstance'
import type { InterpolationType, KeyframeTangent, KeyframeValue } from './keyframe'

export type MaterialOverrideJSON = MaterialOverrideValue

export type TransformJSON = {
  readonly x: number
  readonly y: number
  readonly rotation: number
  readonly scaleX: number
  readonly scaleY: number
}

export type PivotJSON = {
  readonly x: number
  readonly y: number
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
  readonly bone?: { readonly kind: 'bone' }
}

export type MaterialJSON = {
  readonly definitionId: string
  readonly overrides: Readonly<Record<string, MaterialOverrideJSON>>
}

export type FullscreenShaderJSON = {
  readonly shaderDefinitionId: string
  readonly overrides: Readonly<Record<string, MaterialOverrideJSON>>
}

export type NodeJSON = {
  readonly id: string
  readonly name: string
  readonly parentId: string | null
  readonly transform: TransformJSON
  readonly localPivot?: PivotJSON
  readonly visible: boolean
  readonly opacity?: number
  readonly material?: MaterialJSON
  readonly components: NodeComponentsJSON
  readonly clipInstances?: readonly ClipInstanceJSON[]
}

export type SceneJSON = {
  readonly id: string
  readonly nodes: readonly NodeJSON[]
}

export type KeyframeJSON = {
  readonly id: string
  readonly time: number
  readonly value: KeyframeValue
  readonly interpolation?: InterpolationType
  readonly tangentIn?: KeyframeTangent
  readonly tangentOut?: KeyframeTangent
}

export type PropertyTrackJSON = {
  readonly property: string
  readonly keyframes: readonly KeyframeJSON[]
}

export type MaterialTrackJSON = {
  readonly parameter: string
  readonly keyframes: readonly KeyframeJSON[]
}

export type NodeAnimationJSON = {
  readonly nodeId: string
  readonly tracks: readonly PropertyTrackJSON[]
  readonly materialTracks?: readonly MaterialTrackJSON[]
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
  readonly clips?: readonly ClipJSON[]
}

export type ClipParamJSON = {
  readonly key: string
  readonly label: string
  readonly kind: string
  readonly default: number
}

export type ClipChannelJSON = {
  readonly keyframes: readonly KeyframeJSON[]
}

export type ClipChannelDefJSON = {
  readonly property: string
  readonly paramKey?: string
  readonly linkMode?: string
  readonly materialParameter?: string
}

export type ClipJSON = {
  readonly id: string
  readonly name: string
  readonly duration: number
  readonly category?: string
  readonly params: readonly ClipParamJSON[]
  readonly channels: readonly ClipChannelDefJSON[]
  readonly channelAnimations?: Readonly<Record<string, ClipChannelJSON>>
  readonly materialChannelAnimations?: Readonly<Record<string, ClipChannelJSON>>
}

export type ClipInstanceJSON = {
  readonly id: string
  readonly clipId: string
  readonly startTime: number
  readonly speed: number
  readonly enabled: boolean
  readonly paramOverrides?: Readonly<Record<string, number>>
}

export type IKChainJSON = {
  readonly id: string
  readonly boneIds: readonly string[]
  readonly target: {
    readonly position: { readonly x: number; readonly y: number }
    readonly nodeId?: string
  }
  readonly poleTarget: { readonly position: { readonly x: number; readonly y: number } } | null
}

export type IKManagerJSON = {
  /** Map of slideId to IK chain IDs belonging to that slide. */
  readonly slides: Record<string, readonly string[]>
  readonly chains: readonly IKChainJSON[]
}

export type ConstraintParamsJSON = {
  readonly minRotation?: number
  readonly maxRotation?: number
  readonly minX?: number
  readonly maxX?: number
  readonly minY?: number
  readonly maxY?: number
  readonly targetX?: number
  readonly targetY?: number
  readonly targetNodeId?: string
  readonly minDistance?: number
  readonly maxDistance?: number
  readonly positionInfluence?: number
  readonly rotationInfluence?: number
  readonly scaleInfluence?: number
}

export type ConstraintJSON = {
  readonly id: string
  readonly type: string
  readonly priority: number
  readonly params: ConstraintParamsJSON
}

export type ConstraintManagerJSON = {
  readonly nodeConstraints: Record<string, readonly ConstraintJSON[]>
}

export type LessonJSON = {
  readonly version: 1
  readonly project: LessonProjectJSON
  readonly slides: readonly SlideJSON[]
  readonly clips?: readonly ClipJSON[]
  readonly library?: LessonLibraryJSON
  readonly ikChains?: IKManagerJSON
  readonly constraints?: ConstraintManagerJSON
}
