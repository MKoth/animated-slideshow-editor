import type { EngineReadOnly, Scene, SceneNode } from '../engine'
import type { AnimationProperty } from '../engine'
import { DeleteKeyframeCommand } from '../engine/commands'
import type { DispatchCommand } from '../engine/commands'
import { dispatchKeyframeCommands } from '../engine/keyframeEdit'
import { useSelectionStore } from '../stores/selectionStore'
import { animatablePropertiesOf } from './keyframeActions'

export interface KeyframeRef {
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly keyframeId: string
  readonly time: number
}

export function keyframeRefsOfScene(engine: EngineReadOnly, scene: Scene): KeyframeRef[] {
  const refs: KeyframeRef[] = []
  const nodes: SceneNode[] = []
  const walk = (node: SceneNode): void => {
    nodes.push(node)
    for (const child of node.children) {
      if (child.components.camera) {
        continue
      }
      walk(child)
    }
  }
  walk(scene.root)
  nodes.push(scene.camera)
  for (const node of nodes) {
    for (const property of animatablePropertiesOf(node)) {
      for (const keyframe of engine.getKeyframes(node.id, property)) {
        refs.push({ nodeId: node.id, property, keyframeId: keyframe.id, time: keyframe.time })
      }
    }
  }
  return refs
}

function allKeyframeRefs(engine: EngineReadOnly): KeyframeRef[] {
  const refs: KeyframeRef[] = []
  for (const slide of engine.project?.slides ?? []) {
    refs.push(...keyframeRefsOfScene(engine, slide.scene))
  }
  return refs
}

export function selectedKeyframeRefs(engine: EngineReadOnly): KeyframeRef[] {
  const selectedIds = useSelectionStore.getState().selectedKeyframeIds
  if (selectedIds.length === 0) {
    return []
  }
  const wanted = new Set(selectedIds)
  return allKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
}

export function deleteSelectedKeyframes(
  engine: EngineReadOnly,
  dispatch: DispatchCommand,
): boolean {
  const refs = selectedKeyframeRefs(engine)
  if (refs.length === 0) {
    return false
  }
  dispatchKeyframeCommands(
    dispatch,
    refs.map((ref) => new DeleteKeyframeCommand(ref)),
  )
  useSelectionStore.getState().clearKeyframes()
  return true
}

export function pruneKeyframeSelection(engine: EngineReadOnly): void {
  const valid = new Set(allKeyframeRefs(engine).map((ref) => ref.keyframeId))
  useSelectionStore.getState().pruneKeyframes(valid)
}
