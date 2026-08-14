import { createEngine } from './engine'
import type { EnginePublic } from './engine'

export { createEngine }
export type { EnginePublic }
export type { EngineEvent } from './events'
export type { SlideActivated } from './events'
export type { ProjectLoaded } from './events'
export type { EventListener, Unsubscribe } from './events'
export type { SceneNode } from './sceneNode'
export type { Scene } from './scene'
export type { Slide } from './slide'
export type { Project, ProjectMetadata, CreateProjectInput } from './project'
export type { Transform } from './transform'
export { normalizeRotation } from './transform'
export { countAssetUsage } from './assetUsage'
export { reconcileMissingAssets } from './missingAssets'
export type { MissingAssetReference, MissingAssetsReport } from './missingAssets'
export type {
  NodeComponents,
  CameraComponent,
  AssetInstanceComponent,
  TextComponent,
  TextAlignment,
} from './components'
export type { AssetDefinition } from './assetDefinition'
export type {
  LessonJSON,
  LessonProjectJSON,
  SlideJSON,
  SceneJSON,
  NodeJSON,
  NodeComponentsJSON,
  TransformJSON,
  KeyframeJSON,
  PropertyTrackJSON,
  NodeAnimationJSON,
  SlideAnimationJSON,
} from './json'
export { LESSON_VERSION, deserialize, serialize, upgrade, validate } from './lessonSerializer'
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
  MoveNodeCommand,
  RotateNodeCommand,
  ScaleNodeCommand,
  SetVisibilityCommand,
  RenameNodeCommand,
  SetOpacityCommand,
  CreateAssetInstanceCommand,
  DuplicateNodeCommand,
  ChangeZOrderCommand,
  ReorderNodeCommand,
  AddKeyframeCommand,
  DeleteKeyframeCommand,
  MoveKeyframeCommand,
  SetKeyframeValueCommand,
  BatchMoveKeyframesCommand,
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
  DeleteKeyframeInverse,
  DeleteKeyframeParameters,
  MoveKeyframeInverse,
  MoveKeyframeParameters,
  SetKeyframeValueInverse,
  SetKeyframeValueParameters,
  BatchMoveKeyframesInverse,
  BatchMoveKeyframesInverseMove,
  BatchMoveKeyframesParameters,
} from './commands'
export {
  ANIMATABLE_PROPERTIES,
  requireAnimatableForNode,
  requireKeyframeTime,
  requireKeyframeValue,
} from './animation'
export type { AnimationProperty, Keyframe } from './animation'
export type { KeyframeMove, KeyframeMoveResult } from './animation'
export type { EvaluatedNodeState, EvaluatedNodeScratch } from './animation'
export { evaluatedNodeScratch } from './animation'
