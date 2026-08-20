import { createBlankProject, createEngine } from './engine'
import type { EnginePublic, BlankProjectResult } from './engine'

export { createEngine, createBlankProject }
export type { EnginePublic, BlankProjectResult }
export type { EngineEvent } from './events'
export type { SlideActivated } from './events'
export type { ProjectLoaded } from './events'
export type { SlideShaderChanged } from './events'
export type { SlideShaderUniformChanged } from './events'
export type { EventListener, Unsubscribe } from './events'
export type { SceneNode } from './sceneNode'
export type { Scene } from './scene'
export type { Slide } from './slide'
export type { Project, ProjectMetadata, CreateProjectInput } from './project'
export type { Transform } from './transform'
export { normalizeRotation } from './transform'
export { reconcileMissingAssets } from './missingAssets'
export {
  collectReferencedDefinitionIds,
  collectReferencedMaterialIds,
  collectReferencedShaderIds,
} from './missingAssets'
export type { MissingAssetReference, MissingAssetsReport } from './missingAssets'
export type {
  NodeComponents,
  CameraComponent,
  AssetInstanceComponent,
  TextComponent,
  TextAlignment,
} from './components'
export type { AssetDefinition } from './assetDefinition'
export type { EmbeddedAsset } from './embeddedAsset'
export type { EmbeddedMaterialDefinition, EmbeddedMaterialParameter } from './embeddedMaterial'
export type { EmbeddedShaderDefinition } from './embeddedShader'
export type { FullscreenShaderReference } from './fullscreenShader'
export {
  DEFAULT_MATERIAL_DEFINITION_ID,
  DEFAULT_MATERIAL_NAME,
  defaultMaterial,
} from './materialInstance'
export type { MaterialInstance, MaterialOverrides, MaterialOverrideValue } from './materialInstance'
export {
  DEFAULT_OPACITY_MULTIPLIER,
  DEFAULT_TINT,
  OPACITY_MULTIPLIER_PARAMETER_KEY,
  RESERVED_TIME_UNIFORM,
  TINT_PARAMETER_KEY,
  effectiveMaterialScratch,
  resolveMaterial,
  resolveParameterValue,
  uniformValuesEqual,
} from './materialResolution'
export type {
  EffectiveMaterialScratch,
  MaterialParameterDefault,
  MaterialParameterDefaultValue,
} from './materialResolution'
export type {
  LessonJSON,
  LessonProjectJSON,
  LessonLibraryJSON,
  EmbeddedAssetJSON,
  EmbeddedMaterialJSON,
  EmbeddedShaderJSON,
  MaterialJSON,
  FullscreenShaderJSON,
  SlideJSON,
  SceneJSON,
  NodeJSON,
  NodeComponentsJSON,
  TransformJSON,
  KeyframeJSON,
  PropertyTrackJSON,
  NodeAnimationJSON,
  SlideAnimationJSON,
  ClipJSON,
  ClipParamJSON,
  ClipChannelJSON,
  ClipChannelDefJSON,
} from './json'
export {
  LESSON_VERSION,
  deserialize,
  deserializeWithClips,
  serialize,
  upgrade,
  validate,
} from './lessonSerializer'
export type { DeserializeResult } from './lessonSerializer'
export { CommandDispatcher, UndoStack, createCommandSystem } from './commands'
export type {
  Command,
  CommandResult,
  CommandLogger,
  CommandSystem,
  UndoStackEntry,
} from './commands'
export {
  CreateProjectCommand,
  CreateSlideCommand,
  DeleteSlideCommand,
  CreateNodeCommand,
  DeleteNodeCommand,
  ReparentNodeCommand,
  SetParentCommand,
  MoveNodeCommand,
  RotateNodeCommand,
  ScaleNodeCommand,
  SetVisibilityCommand,
  RenameNodeCommand,
  SetOpacityCommand,
  AssignMaterialCommand,
  OverrideMaterialParameterCommand,
  ClearMaterialOverrideCommand,
  SetFullscreenShaderCommand,
  OverrideFullscreenUniformCommand,
  CreateAssetInstanceCommand,
  DuplicateNodeCommand,
  ChangeZOrderCommand,
  ReorderNodeCommand,
  AddKeyframeCommand,
  DeleteKeyframesCommand,
  MoveKeyframesCommand,
  SetKeyframeValueCommand,
  ScaleKeyframesCommand,
  PasteKeyframesCommand,
  DuplicateKeyframesCommand,
  SetKeyframeInterpolationCommand,
  SetKeyframeTangentsCommand,
  CreateClipCommand,
  DeleteClipCommand,
  RenameClipCommand,
  DuplicateClipCommand,
  SetClipDurationCommand,
  SetClipCategoryCommand,
  SetClipParamDefaultCommand,
  SetClipChannelParamLinkCommand,
  AddClipKeyframeCommand,
  DeleteClipKeyframesCommand,
  MoveClipKeyframesCommand,
  SetClipKeyframeValueCommand,
  ScaleClipKeyframesCommand,
  PasteClipKeyframesCommand,
  DuplicateClipKeyframesCommand,
  SetClipKeyframeInterpolationCommand,
  SetClipKeyframeTangentsCommand,
} from './commands'
export type {
  CreateProjectInverse,
  CreateProjectParameters,
  CreateSlideInverse,
  CreateSlideParameters,
  DeleteSlideInverse,
  DeleteSlideParameters,
  CreateNodeInverse,
  CreateNodeParameters,
  DeleteNodeInverse,
  DeleteNodeParameters,
  ReparentNodeInverse,
  ReparentNodeParameters,
  MoveNodeInverse,
  MoveNodeParameters,
  RotateNodeInverse,
  RotateNodeParameters,
  ScaleNodeInverse,
  ScaleNodeParameters,
  SetVisibilityInverse,
  SetVisibilityParameters,
  RenameNodeInverse,
  RenameNodeParameters,
  SetOpacityInverse,
  SetOpacityParameters,
  AssignMaterialInverse,
  AssignMaterialParameters,
  OverrideMaterialParameterInverse,
  OverrideMaterialParameterParameters,
  ClearMaterialOverrideInverse,
  ClearMaterialOverrideParameters,
  SetFullscreenShaderInverse,
  SetFullscreenShaderParameters,
  OverrideFullscreenUniformInverse,
  OverrideFullscreenUniformParameters,
  CreateAssetInstanceInverse,
  CreateAssetInstanceParameters,
  DuplicateNodeInverse,
  DuplicateNodeParameters,
  ChangeZOrderInverse,
  ChangeZOrderParameters,
  ZOrderMode,
  ReorderNodeInverse,
  ReorderNodeParameters,
  AddKeyframeInverse,
  AddKeyframeParameters,
  DeleteKeyframesInverse,
  DeleteKeyframesParameters,
  MoveKeyframesInverse,
  MoveKeyframesParameters,
  SetKeyframeValueInverse,
  SetKeyframeValueParameters,
  ScaleKeyframesInverse,
  ScaleKeyframesParameters,
  PasteKeyframesInverse,
  PasteKeyframesParameters,
  DuplicateKeyframesInverse,
  DuplicateKeyframesParameters,
  SetKeyframeInterpolationInverse,
  SetKeyframeInterpolationParameters,
  SetKeyframeTangentsInverse,
  SetKeyframeTangentsParameters,
  CreateClipInverse,
  CreateClipParameters,
  DeleteClipInverse,
  DeleteClipParameters,
  RenameClipInverse,
  RenameClipParameters,
  DuplicateClipInverse,
  DuplicateClipParameters,
  SetClipDurationInverse,
  SetClipDurationParameters,
  SetClipCategoryInverse,
  SetClipCategoryParameters,
  SetClipParamDefaultInverse,
  SetClipParamDefaultParameters,
  SetClipChannelParamLinkInverse,
  SetClipChannelParamLinkParameters,
  AddClipKeyframeInverse,
  AddClipKeyframeParameters,
  DeleteClipKeyframesInverse,
  DeleteClipKeyframesParameters,
  MoveClipKeyframesInverse,
  MoveClipKeyframesParameters,
  SetClipKeyframeValueInverse,
  SetClipKeyframeValueParameters,
  ScaleClipKeyframesInverse,
  ScaleClipKeyframesParameters,
  PasteClipKeyframesInverse,
  PasteClipKeyframesParameters,
  DuplicateClipKeyframesInverse,
  DuplicateClipKeyframesParameters,
  SetClipKeyframeInterpolationInverse,
  SetClipKeyframeInterpolationParameters,
  SetClipKeyframeTangentsInverse,
  SetClipKeyframeTangentsParameters,
} from './commands'
export {
  ANIMATABLE_PROPERTIES,
  BONE_ANIMATABLE_PROPERTIES,
  requireAnimatableForNode,
  requireKeyframeTime,
  requireKeyframeValue,
} from './animation'
export type { AnimationProperty, Keyframe } from './animation'
export type {
  KeyframeMove,
  KeyframeMoveResult,
  KeyframeTangents,
  PastePayload,
  PastePayloadKeyframe,
} from './animation'
export type { KeyframeTarget, KeyframeTrackRef, ClipChannelTarget } from './keyframeTarget'
export { isParameterTarget, isPropertyTarget, isClipChannelTarget } from './keyframeTarget'
export type { ClipDefinition, ClipChannel, ClipParam, ClipChannelDef } from './clipDefinition'
export { newClipId } from './clipDefinition'
export type { EvaluatedNodeState, EvaluatedNodeScratch } from './animation'
export { evaluatedNodeScratch } from './animation'
export type { EvaluatedMaterialOverridesScratch } from './animation'
export { evaluatedMaterialOverridesScratch } from './animation'
export type { AnimatableParameter } from './animatableParameters'
export { getAnimatableParameters } from './animatableParameters'
export type { VertexBoneWeight, MeshData } from './mesh'
export { SetVertexWeightsCommand } from './commands'
export type { SetVertexWeightsInverse, SetVertexWeightsParameters } from './commands'
export { SmoothWeightsCommand } from './commands'
export type { SmoothWeightsInverse, SmoothWeightsParameters } from './commands'
export { evaluateMeshDeformation } from './meshDeformationEvaluator'
export type { DeformedMeshResult } from './meshDeformationEvaluator'
