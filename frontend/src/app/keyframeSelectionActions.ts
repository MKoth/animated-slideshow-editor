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

export interface MaterialKeyframeRef {
  readonly nodeId: string
  readonly parameter: string
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

/** Group refs by their node parameter target, preserving first-seen order. */
export function groupMaterialRefsByTarget<Ref extends { nodeId: string; parameter: string }, T>(
  refs: readonly Ref[],
  itemOf: (ref: Ref) => T,
): { readonly nodeId: string; readonly parameter: string; readonly items: T[] }[] {
  const groups = new Map<string, { nodeId: string; parameter: string; items: T[] }>()
  for (const ref of refs) {
    const key = `${ref.nodeId}\u0000${ref.parameter}`
    const entry = groups.get(key)
    if (entry) {
      entry.items.push(itemOf(ref))
    } else {
      groups.set(key, { nodeId: ref.nodeId, parameter: ref.parameter, items: [itemOf(ref)] })
    }
  }
  return [...groups.values()]
}

function collectNodes(scene: Scene): SceneNode[] {
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
  return nodes
}

export function keyframeRefsOfScene(engine: EnginePublic, scene: Scene): KeyframeRef[] {
  const refs: KeyframeRef[] = []
  for (const node of collectNodes(scene)) {
    for (const property of animatablePropertiesOf(node)) {
      for (const keyframe of engine.getKeyframes(node.id, property)) {
        refs.push({ nodeId: node.id, property, keyframeId: keyframe.id, time: keyframe.time })
      }
    }
  }
  return refs
}

export function materialKeyframeRefsOfScene(
  engine: EnginePublic,
  scene: Scene,
): MaterialKeyframeRef[] {
  const refs: MaterialKeyframeRef[] = []
  for (const node of collectNodes(scene)) {
    const definition = engine.getMaterialDefinition(node.material.materialDefinitionId)
    for (const parameter of definition.parameters) {
      if (engine.hasMaterialTrack(node.id, parameter.key)) {
        for (const keyframe of engine.getMaterialKeyframes(node.id, parameter.key)) {
          refs.push({
            nodeId: node.id,
            parameter: parameter.key,
            keyframeId: keyframe.id,
            time: keyframe.time,
          })
        }
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

function allMaterialKeyframeRefs(engine: EnginePublic): MaterialKeyframeRef[] {
  const refs: MaterialKeyframeRef[] = []
  for (const slide of engine.project?.slides ?? []) {
    refs.push(...materialKeyframeRefsOfScene(engine, slide.scene))
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

export function selectedMaterialKeyframeRefs(engine: EnginePublic): MaterialKeyframeRef[] {
  const selectedIds = useSelectionStore.getState().selectedKeyframeIds
  if (selectedIds.length === 0) {
    return []
  }
  const wanted = new Set(selectedIds)
  return allMaterialKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
}

type DeleteTarget =
  | { kind: 'property'; nodeId: string; property: AnimationProperty; items: string[] }
  | { kind: 'parameter'; nodeId: string; parameter: string; items: string[] }

export function deleteSelectedKeyframes(engine: EnginePublic, dispatch: DispatchCommand): boolean {
  const propertyRefs = selectedKeyframeRefs(engine)
  const materialRefs = selectedMaterialKeyframeRefs(engine)
  if (propertyRefs.length === 0 && materialRefs.length === 0) {
    return false
  }
  const targets: DeleteTarget[] = []
  for (const group of groupRefsByTarget(propertyRefs, (ref) => ref.keyframeId)) {
    targets.push({
      kind: 'property',
      nodeId: group.nodeId,
      property: group.property,
      items: group.items,
    })
  }
  for (const group of groupMaterialRefsByTarget(materialRefs, (ref) => ref.keyframeId)) {
    targets.push({
      kind: 'parameter',
      nodeId: group.nodeId,
      parameter: group.parameter,
      items: group.items,
    })
  }
  const deleteCommands = targets.map((target) => {
    if (target.kind === 'property') {
      return new DeleteKeyframesCommand({
        target: { kind: 'node', nodeId: target.nodeId, property: target.property },
        keyframeIds: target.items,
      })
    }
    return new DeleteKeyframesCommand({
      target: { kind: 'node', nodeId: target.nodeId, parameter: target.parameter },
      keyframeIds: target.items,
    })
  })
  dispatchKeyframeCommands(dispatch, deleteCommands)
  useSelectionStore.getState().clearKeyframes()
  return true
}

export function pruneKeyframeSelection(engine: EnginePublic): void {
  const validPropertyKeys = new Set(allKeyframeRefs(engine).map((ref) => ref.keyframeId))
  const validMaterialKeys = new Set(allMaterialKeyframeRefs(engine).map((ref) => ref.keyframeId))
  const valid = new Set([...validPropertyKeys, ...validMaterialKeys])
  useSelectionStore.getState().pruneKeyframes(valid)
}
