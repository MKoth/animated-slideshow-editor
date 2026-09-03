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
  readonly bone?: { readonly kind: 'bone'; readonly length?: number }
  readonly mesh?: {
    readonly kind: 'mesh'
    readonly mesh: {
      readonly vertices: readonly { readonly x: number; readonly y: number }[]
      readonly faces: readonly { readonly v0: number; readonly v1: number; readonly v2: number }[]
      readonly uvs: readonly { readonly u: number; readonly v: number }[]
      readonly boneWeights?: readonly (readonly {
        readonly boneId: string
        readonly weight: number
      }[])[]
      readonly bindPose?: Readonly<Record<string, TransformJSON>>
    }
  }
  readonly ghost?: { readonly kind: 'ghost' }
  readonly table?: {
    readonly kind: 'table'
    readonly columns: readonly {
      readonly width: number | 'auto'
      readonly minWidth?: number
    }[]
    readonly gap?: number
    readonly borderWidth?: number
    readonly borderColor?: string
    readonly borderRadius?: number
    readonly padding?: number
  }
  readonly tableRow?: {
    readonly kind: 'tableRow'
    readonly borderColor?: string
    readonly background?: string
    readonly borderRadius?: number
  }
  readonly tableCell?: {
    readonly kind: 'tableCell'
    readonly colSpan?: number
    readonly rowSpan?: number
    readonly borderColor?: string
    readonly background?: string
    readonly padding?: number
    readonly borderRadius?: number
  }
  readonly chart?: {
    readonly kind: 'chart'
    readonly chartType: string
    readonly dataSourceId: string
    readonly visualConfig?: {
      readonly colors?: readonly string[]
      readonly axisLabels?: { readonly x: string; readonly y: string }
      readonly legendPosition?: string
      readonly padding?: number
      readonly fontFamily?: string
      readonly fontSize?: number
    }
    readonly dataLabels?: readonly string[]
    readonly axisMin?: number
    readonly axisMax?: number
  }
  readonly circle?: {
    readonly kind: 'circle'
    readonly radius: number
    readonly startAngle: number
    readonly endAngle: number
    readonly segments?: number
  }
}

export type MaterialJSON = {
  readonly definitionId: string
  readonly overrides: Readonly<Record<string, MaterialOverrideJSON>>
  readonly textureId?: string
  readonly uvScale?: { readonly u: number; readonly v: number }
  readonly uvOffset?: { readonly u: number; readonly v: number }
  readonly fitMode?: string
}

export type FullscreenShaderJSON = {
  readonly shaderDefinitionId: string
  readonly overrides: Readonly<Record<string, MaterialOverrideJSON>>
}

export type NodeJSON = {
  readonly id: string
  readonly name: string
  readonly semanticName?: string
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

export type DataLabelTrackJSON = {
  readonly label: string
  readonly keyframes: readonly KeyframeJSON[]
}

export type CircleTrackJSON = {
  readonly property: string
  readonly keyframes: readonly KeyframeJSON[]
}

export type TableTrackJSON = {
  readonly property: string
  readonly keyframes: readonly KeyframeJSON[]
}

export type VisibleTrackJSON = {
  readonly keyframes: readonly KeyframeJSON[]
}

export type NodeAnimationJSON = {
  readonly nodeId: string
  readonly tracks: readonly PropertyTrackJSON[]
  readonly materialTracks?: readonly MaterialTrackJSON[]
  readonly dataLabelTracks?: readonly DataLabelTrackJSON[]
  readonly circleTracks?: readonly CircleTrackJSON[]
  readonly tableTracks?: readonly TableTrackJSON[]
  readonly visibleTrack?: VisibleTrackJSON
}

export type SlideAnimationJSON = {
  readonly nodes: readonly NodeAnimationJSON[]
}

export type AudioSegmentJSON = {
  readonly id: string
  readonly text: string
  readonly audioClipId: string
  readonly audioAssetId?: string
  readonly order: number
}

export type PrompterPartJSON = {
  readonly id: string
  readonly text: string
  readonly startTime: number
  readonly endTime: number
  readonly duration: number
  readonly audioClipId?: string
  readonly audioAssetId?: string
  readonly promptId?: string
  readonly status?: string
  readonly segments?: readonly AudioSegmentJSON[]
}

export type PrompterJSON = {
  readonly parts: readonly PrompterPartJSON[]
}

export type AudioClipJSON = {
  readonly id: string
  readonly assetId: string
  readonly trackId: string
  readonly timelineStart: number
  readonly sourceStart: number
  readonly sourceEnd: number
  readonly volume: number
  readonly muted: boolean
  readonly fadeIn?: number
  readonly fadeOut?: number
  readonly playbackRate: number
}

export type SlideAudioJSON = {
  readonly clips: readonly AudioClipJSON[]
}

export type SlideJSON = {
  readonly id: string
  readonly name: string
  readonly duration: number
  readonly scene: SceneJSON
  readonly animation?: SlideAnimationJSON
  readonly fullscreenShader?: FullscreenShaderJSON
  readonly prompter?: PrompterJSON
  readonly audio?: SlideAudioJSON
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

export type EmbeddedDataPointJSON = {
  readonly label: string
  readonly value: number
  readonly series?: string
  readonly tooltip?: string
  readonly color?: string
}

export type EmbeddedDataSourceJSON = {
  readonly id: string
  readonly name: string
  readonly data_points: readonly EmbeddedDataPointJSON[]
}

export type EmbeddedFlowchartNodeJSON = {
  readonly id: string
  readonly label: string
}

export type EmbeddedFlowchartEdgeJSON = {
  readonly from: string
  readonly to: string
}

export type EmbeddedFlowchartDataSourceJSON = {
  readonly id: string
  readonly name: string
  readonly flowchart: {
    readonly nodes: readonly EmbeddedFlowchartNodeJSON[]
    readonly edges: readonly EmbeddedFlowchartEdgeJSON[]
  }
}

export type LessonLibraryJSON = {
  readonly assets?: readonly EmbeddedAssetJSON[]
  readonly materials?: readonly EmbeddedMaterialJSON[]
  readonly shaders?: readonly EmbeddedShaderJSON[]
  readonly data_sources?: readonly (EmbeddedDataSourceJSON | EmbeddedFlowchartDataSourceJSON)[]
  readonly clips?: readonly ClipJSON[]
  readonly clipCollections?: readonly ClipCollectionJSON[]
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
  readonly visibleAnimation?: ClipChannelJSON
  readonly circleChannelAnimations?: Readonly<Record<string, ClipChannelJSON>>
}

export type ClipInstanceJSON = {
  readonly id: string
  readonly clipId: string
  readonly startTime: number
  readonly speed: number
  readonly enabled: boolean
  readonly paramOverrides?: Readonly<Record<string, number>>
}

export type ClipCollectionJSON = {
  readonly id: string
  readonly name: string
  readonly bindings: Readonly<Record<string, string>>
  readonly sourceNodeId?: string
}

export type IKChainJSON = {
  readonly id: string
  readonly slideId?: string
  readonly boneIds: readonly string[]
  readonly target: {
    readonly position: { readonly x: number; readonly y: number }
    readonly nodeId?: string
  }
  readonly poleTarget: {
    readonly position: { readonly x: number; readonly y: number }
    readonly nodeId?: string
  } | null
  readonly ghostNodeId?: string | null
  readonly poleGhostNodeId?: string | null
}

export type IKManagerJSON = {
  /** Map of slideId to IK chain IDs belonging to that slide. */
  readonly slides: Record<string, readonly string[]>
  readonly chains: readonly IKChainJSON[]
}

export type ConstraintParamsJSON = {
  readonly minRotation?: number
  readonly maxRotation?: number
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
  readonly version: 1 | 2
  readonly project: LessonProjectJSON
  readonly slides: readonly SlideJSON[]
  readonly clips?: readonly ClipJSON[]
  readonly clipCollections?: readonly ClipCollectionJSON[]
  readonly library?: LessonLibraryJSON
  readonly ikChains?: IKManagerJSON
  readonly constraints?: ConstraintManagerJSON
}
