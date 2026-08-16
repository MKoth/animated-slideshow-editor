import type { EnginePublic, Scene, SceneNode } from '../engine'
import type { AnimationProperty } from '../engine'
import { DeleteKeyframesCommand } from '../engine/commands'
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

/** Group refs by their node property target, preserving first-seen order. */
export function groupRefsByTarget<Ref extends { nodeId: string; property: AnimationProperty }, T>(
  refs: readonly Ref[],
  itemOf: (ref: Ref) => T,
): { readonly nodeId: string; readonly property: AnimationProperty; readonly items: T[] }[] {
  const groups = new Map<string, { nodeId: string; property: AnimationProperty; items: T[] }>()
  for (const ref of refs) {
    const key = `${ref.nodeId}\u0000${ref.property}`
    const entry = groups.get(key)
    if (entry) {
      entry.items.push(itemOf(ref))
    } else {
      groups.set(key, { nodeId: ref.nodeId, property: ref.property, items: [itemOf(ref)] })
    }
  }
  return [...groups.values()]
}

export function keyframeRefsOfScene(engine: EnginePublic, scene: Scene): KeyframeRef[] {
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

function allKeyframeRefs(engine: EnginePublic): KeyframeRef[] {
  const refs: KeyframeRef[] = []
  for (const slide of engine.project?.slides ?? []) {
    refs.push(...keyframeRefsOfScene(engine, slide.scene))
  }
  return refs
}

export function selectedKeyframeRefs(engine: EnginePublic): KeyframeRef[] {
  const selectedIds = useSelectionStore.getState().selectedKeyframeIds
  if (selectedIds.length === 0) {
    return []
  }
  const wanted = new Set(selectedIds)
  return allKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
}

export function deleteSelectedKeyframes(engine: EnginePublic, dispatch: DispatchCommand): boolean {
  const refs = selectedKeyframeRefs(engine)
  if (refs.length === 0) {
    return false
  }
  const commands = groupRefsByTarget(refs, (ref) => ref.keyframeId).map(
    (group) =>
      new DeleteKeyframesCommand({
        target: { kind: 'node', nodeId: group.nodeId, property: group.property },
        keyframeIds: group.items,
      }),
  )
  dispatchKeyframeCommands(dispatch, commands)
  useSelectionStore.getState().clearKeyframes()
  return true
}

export function pruneKeyframeSelection(engine: EnginePublic): void {
  const valid = new Set(allKeyframeRefs(engine).map((ref) => ref.keyframeId))
  useSelectionStore.getState().pruneKeyframes(valid)
}
