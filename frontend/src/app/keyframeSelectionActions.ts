import type { EnginePublic, Scene, SceneNode } from '../engine'
import type { AnimationProperty, CircleAnimationProperty } from '../engine'
import type { KeyframeTarget } from '../engine'
import {
  DeleteKeyframesCommand,
  PasteKeyframesCommand,
  DuplicateKeyframesCommand,
  SetKeyframeDisabledCommand,
} from '../engine/commands'
import type { DispatchCommand } from '../engine/commands'
import { snapshotOf } from '../engine/keyframe'
import type { PastePayloadKeyframe } from '../engine/animationManager'
import { dispatchKeyframeCommands } from '../engine/keyframeEdit'
import { useTimelineSelectionStore, selectedKeyframeIdsOf } from '../stores/timelineSelectionStore'
import { useKeyframeClipboardStore } from '../stores/keyframeClipboardStore'
import type { KeyframeClipboardTarget } from '../stores/keyframeClipboardStore'
import { usePlaybackController } from '../stores/playbackStore'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { snapToFrameGrid } from '../engine/timelineSnapping'
import { animatablePropertiesOf } from './keyframeActions'
import { SHADOW_PROPERTIES } from '../engine/shadowEffect'
import type { ShadowProperty } from '../engine/shadowEffect'
import type { MorphClipboardMeta, MorphClipboardShapeInfo } from '../stores/keyframeClipboardStore'
import { useNotificationStore } from '../stores/notificationStore'
import { useSelectionStore } from '../stores/selectionStore'
import { evaluatedPropertyValue } from '../engine/keyframeEdit'
import { normalizeRotation } from '../engine/transform'
import { requestPasteDeltaChoices, type PasteDeltaItem } from '../stores/pasteDeltaStore'

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

export interface DataLabelKeyframeRef {
  readonly nodeId: string
  readonly label: string
  readonly keyframeId: string
  readonly time: number
}

export interface CircleKeyframeRef {
  readonly nodeId: string
  readonly property: CircleAnimationProperty
  readonly keyframeId: string
  readonly time: number
}

export interface VisibleKeyframeRef {
  readonly nodeId: string
  readonly keyframeId: string
  readonly time: number
}

export interface ZIndexKeyframeRef {
  readonly nodeId: string
  readonly keyframeId: string
  readonly time: number
}

export interface MorphKeyframeRef {
  readonly nodeId: string
  readonly keyframeId: string
  readonly time: number
}

export interface ShadowKeyframeRef {
  readonly nodeId: string
  readonly property: ShadowProperty
  readonly keyframeId: string
  readonly time: number
  readonly shadow: true
}

export interface SymmetryKeyframeRef {
  readonly nodeId: string
  readonly keyframeId: string
  readonly time: number
  readonly symmetry: true
}

export function groupShadowRefsByTarget<
  Ref extends { nodeId: string; property: ShadowProperty },
  T,
>(
  refs: readonly Ref[],
  itemOf: (ref: Ref) => T,
): { readonly nodeId: string; readonly property: ShadowProperty; readonly items: T[] }[] {
  const groups = new Map<string, { nodeId: string; property: ShadowProperty; items: T[] }>()
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

/** Group refs by their data label target, preserving first-seen order. */
export function groupDataLabelRefsByTarget<Ref extends { nodeId: string; label: string }, T>(
  refs: readonly Ref[],
  itemOf: (ref: Ref) => T,
): { readonly nodeId: string; readonly label: string; readonly items: T[] }[] {
  const groups = new Map<string, { nodeId: string; label: string; items: T[] }>()
  for (const ref of refs) {
    const key = `${ref.nodeId}\u0000${ref.label}`
    const entry = groups.get(key)
    if (entry) {
      entry.items.push(itemOf(ref))
    } else {
      groups.set(key, { nodeId: ref.nodeId, label: ref.label, items: [itemOf(ref)] })
    }
  }
  return [...groups.values()]
}

/** Group refs by their circle target, preserving first-seen order. */
export function groupCircleRefsByTarget<
  Ref extends { nodeId: string; property: CircleAnimationProperty },
  T,
>(
  refs: readonly Ref[],
  itemOf: (ref: Ref) => T,
): { readonly nodeId: string; readonly property: CircleAnimationProperty; readonly items: T[] }[] {
  const groups = new Map<
    string,
    { nodeId: string; property: CircleAnimationProperty; items: T[] }
  >()
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

export function visibleKeyframeRefsOfScene(
  engine: EnginePublic,
  scene: Scene,
): VisibleKeyframeRef[] {
  const refs: VisibleKeyframeRef[] = []
  for (const node of collectNodes(scene)) {
    if (engine.hasVisibleTrack(node.id)) {
      for (const keyframe of engine.getVisibleKeyframes(node.id)) {
        refs.push({ nodeId: node.id, keyframeId: keyframe.id, time: keyframe.time })
      }
    }
  }
  return refs
}

export function zIndexKeyframeRefsOfScene(engine: EnginePublic, scene: Scene): ZIndexKeyframeRef[] {
  const refs: ZIndexKeyframeRef[] = []
  for (const node of collectNodes(scene)) {
    if (engine.hasZIndexTrack(node.id)) {
      for (const keyframe of engine.getZIndexKeyframes(node.id)) {
        refs.push({ nodeId: node.id, keyframeId: keyframe.id, time: keyframe.time })
      }
    }
  }
  return refs
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

export function dataLabelKeyframeRefsOfScene(
  engine: EnginePublic,
  scene: Scene,
): DataLabelKeyframeRef[] {
  const refs: DataLabelKeyframeRef[] = []
  for (const node of collectNodes(scene)) {
    const chart = node.components.chart
    if (!chart) continue
    for (const label of chart.dataLabels) {
      if (engine.hasDataLabelTrack(node.id, label)) {
        for (const keyframe of engine.getDataLabelKeyframes(node.id, label)) {
          refs.push({
            nodeId: node.id,
            label,
            keyframeId: keyframe.id,
            time: keyframe.time,
          })
        }
      }
    }
  }
  return refs
}

export function circleKeyframeRefsOfScene(engine: EnginePublic, scene: Scene): CircleKeyframeRef[] {
  const refs: CircleKeyframeRef[] = []
  for (const node of collectNodes(scene)) {
    if (!node.components.circle) continue
    for (const property of ['radius', 'startAngle', 'endAngle', 'segments'] as const) {
      if (engine.hasCircleTrack(node.id, property)) {
        for (const keyframe of engine.getCircleKeyframes(node.id, property)) {
          refs.push({
            nodeId: node.id,
            property,
            keyframeId: keyframe.id,
            time: keyframe.time,
          })
        }
      }
    }
  }
  return refs
}

export function shadowKeyframeRefsOfScene(engine: EnginePublic, scene: Scene): ShadowKeyframeRef[] {
  const refs: ShadowKeyframeRef[] = []
  for (const node of collectNodes(scene)) {
    for (const property of SHADOW_PROPERTIES) {
      if (engine.hasShadowTrack(node.id, property as ShadowProperty)) {
        for (const keyframe of engine.getShadowKeyframes(node.id, property as ShadowProperty)) {
          refs.push({
            nodeId: node.id,
            property: property as ShadowProperty,
            keyframeId: keyframe.id,
            time: keyframe.time,
            shadow: true as const,
          })
        }
      }
    }
  }
  return refs
}

export function symmetryKeyframeRefsOfScene(
  engine: EnginePublic,
  scene: Scene,
): SymmetryKeyframeRef[] {
  const refs: SymmetryKeyframeRef[] = []
  for (const node of collectNodes(scene)) {
    if (engine.hasSymmetryTrack(node.id)) {
      for (const keyframe of engine.getSymmetryKeyframes(node.id)) {
        refs.push({
          nodeId: node.id,
          keyframeId: keyframe.id,
          time: keyframe.time,
          symmetry: true as const,
        })
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

function allDataLabelKeyframeRefs(engine: EnginePublic): DataLabelKeyframeRef[] {
  const refs: DataLabelKeyframeRef[] = []
  for (const slide of engine.project?.slides ?? []) {
    refs.push(...dataLabelKeyframeRefsOfScene(engine, slide.scene))
  }
  return refs
}

function allCircleKeyframeRefs(engine: EnginePublic): CircleKeyframeRef[] {
  const refs: CircleKeyframeRef[] = []
  for (const slide of engine.project?.slides ?? []) {
    refs.push(...circleKeyframeRefsOfScene(engine, slide.scene))
  }
  return refs
}

function allVisibleKeyframeRefs(engine: EnginePublic): VisibleKeyframeRef[] {
  const refs: VisibleKeyframeRef[] = []
  for (const slide of engine.project?.slides ?? []) {
    refs.push(...visibleKeyframeRefsOfScene(engine, slide.scene))
  }
  return refs
}

function allZIndexKeyframeRefs(engine: EnginePublic): ZIndexKeyframeRef[] {
  const refs: ZIndexKeyframeRef[] = []
  for (const slide of engine.project?.slides ?? []) {
    refs.push(...zIndexKeyframeRefsOfScene(engine, slide.scene))
  }
  return refs
}

function allShadowKeyframeRefs(engine: EnginePublic): ShadowKeyframeRef[] {
  const refs: ShadowKeyframeRef[] = []
  for (const slide of engine.project?.slides ?? []) {
    refs.push(...shadowKeyframeRefsOfScene(engine, slide.scene))
  }
  return refs
}

function allSymmetryKeyframeRefs(engine: EnginePublic): SymmetryKeyframeRef[] {
  const refs: SymmetryKeyframeRef[] = []
  for (const slide of engine.project?.slides ?? []) {
    refs.push(...symmetryKeyframeRefsOfScene(engine, slide.scene))
  }
  return refs
}

export function morphKeyframeRefsOfScene(engine: EnginePublic, scene: Scene): MorphKeyframeRef[] {
  const refs: MorphKeyframeRef[] = []
  for (const node of collectNodes(scene)) {
    if (!node.components.mesh) continue
    for (const kf of engine.getMorphKeyframes(node.id)) {
      refs.push({ nodeId: node.id, keyframeId: kf.id, time: kf.time })
    }
  }
  return refs
}

function allMorphKeyframeRefs(engine: EnginePublic): MorphKeyframeRef[] {
  const refs: MorphKeyframeRef[] = []
  for (const slide of engine.project?.slides ?? []) {
    refs.push(...morphKeyframeRefsOfScene(engine, slide.scene))
  }
  return refs
}

export function selectedShadowKeyframeRefs(engine: EnginePublic): ShadowKeyframeRef[] {
  const selectedIds = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
  if (selectedIds.length === 0) return []
  const wanted = new Set(selectedIds)
  return allShadowKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
}

export function selectedSymmetryKeyframeRefs(engine: EnginePublic): SymmetryKeyframeRef[] {
  const selectedIds = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
  if (selectedIds.length === 0) return []
  const wanted = new Set(selectedIds)
  return allSymmetryKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
}

export function selectedMorphKeyframeRefs(engine: EnginePublic): MorphKeyframeRef[] {
  const selectedIds = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
  if (selectedIds.length === 0) return []
  const wanted = new Set(selectedIds)
  return allMorphKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
}

export function selectedKeyframeRefs(engine: EnginePublic): KeyframeRef[] {
  const selectedIds = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
  if (selectedIds.length === 0) {
    return []
  }
  const wanted = new Set(selectedIds)
  return allKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
}

export function selectedMaterialKeyframeRefs(engine: EnginePublic): MaterialKeyframeRef[] {
  const selectedIds = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
  if (selectedIds.length === 0) {
    return []
  }
  const wanted = new Set(selectedIds)
  return allMaterialKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
}

export function selectedDataLabelKeyframeRefs(engine: EnginePublic): DataLabelKeyframeRef[] {
  const selectedIds = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
  if (selectedIds.length === 0) {
    return []
  }
  const wanted = new Set(selectedIds)
  return allDataLabelKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
}

export function selectedCircleKeyframeRefs(engine: EnginePublic): CircleKeyframeRef[] {
  const selectedIds = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
  if (selectedIds.length === 0) {
    return []
  }
  const wanted = new Set(selectedIds)
  return allCircleKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
}

export function selectedVisibleKeyframeRefs(engine: EnginePublic): VisibleKeyframeRef[] {
  const selectedIds = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
  if (selectedIds.length === 0) {
    return []
  }
  const wanted = new Set(selectedIds)
  return allVisibleKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
}

export function selectedZIndexKeyframeRefs(engine: EnginePublic): ZIndexKeyframeRef[] {
  const selectedIds = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
  if (selectedIds.length === 0) {
    return []
  }
  const wanted = new Set(selectedIds)
  return allZIndexKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
}

type DeleteTarget =
  | { kind: 'property'; nodeId: string; property: AnimationProperty; items: string[] }
  | { kind: 'parameter'; nodeId: string; parameter: string; items: string[] }
  | { kind: 'dataLabel'; nodeId: string; label: string; items: string[] }
  | { kind: 'circle'; nodeId: string; property: CircleAnimationProperty; items: string[] }
  | { kind: 'visible'; nodeId: string; items: string[] }
  | { kind: 'zIndex'; nodeId: string; items: string[] }
  | { kind: 'morph'; nodeId: string; items: string[] }
  | { kind: 'shadow'; nodeId: string; property: ShadowProperty; items: string[] }
  | { kind: 'symmetry'; nodeId: string; items: string[] }

export function deleteSelectedKeyframes(engine: EnginePublic, dispatch: DispatchCommand): boolean {
  const propertyRefs = selectedKeyframeRefs(engine)
  const materialRefs = selectedMaterialKeyframeRefs(engine)
  const dataLabelRefs = selectedDataLabelKeyframeRefs(engine)
  const circleRefs = selectedCircleKeyframeRefs(engine)
  const visibleRefs = selectedVisibleKeyframeRefs(engine)
  const zIndexRefs = selectedZIndexKeyframeRefs(engine)
  const morphRefs = selectedMorphKeyframeRefs(engine)
  const shadowRefs = selectedShadowKeyframeRefs(engine)
  const symmetryRefs = selectedSymmetryKeyframeRefs(engine)
  if (
    propertyRefs.length === 0 &&
    materialRefs.length === 0 &&
    dataLabelRefs.length === 0 &&
    circleRefs.length === 0 &&
    visibleRefs.length === 0 &&
    zIndexRefs.length === 0 &&
    morphRefs.length === 0 &&
    shadowRefs.length === 0 &&
    symmetryRefs.length === 0
  ) {
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
  for (const group of groupDataLabelRefsByTarget(dataLabelRefs, (ref) => ref.keyframeId)) {
    targets.push({
      kind: 'dataLabel',
      nodeId: group.nodeId,
      label: group.label,
      items: group.items,
    })
  }
  for (const group of groupCircleRefsByTarget(circleRefs, (ref) => ref.keyframeId)) {
    targets.push({
      kind: 'circle',
      nodeId: group.nodeId,
      property: group.property,
      items: group.items,
    } as unknown as DeleteTarget)
  }
  {
    const grouped = new Map<string, string[]>()
    for (const ref of visibleRefs) {
      const arr = grouped.get(ref.nodeId) ?? []
      arr.push(ref.keyframeId)
      grouped.set(ref.nodeId, arr)
    }
    for (const [nodeId, items] of grouped) {
      targets.push({ kind: 'visible', nodeId, items })
    }
  }
  {
    const grouped = new Map<string, string[]>()
    for (const ref of zIndexRefs) {
      const arr = grouped.get(ref.nodeId) ?? []
      arr.push(ref.keyframeId)
      grouped.set(ref.nodeId, arr)
    }
    for (const [nodeId, items] of grouped) {
      targets.push({ kind: 'zIndex', nodeId, items })
    }
  }
  {
    const grouped = new Map<string, string[]>()
    for (const ref of morphRefs) {
      const arr = grouped.get(ref.nodeId) ?? []
      arr.push(ref.keyframeId)
      grouped.set(ref.nodeId, arr)
    }
    for (const [nodeId, items] of grouped) {
      targets.push({ kind: 'morph', nodeId, items })
    }
  }
  {
    for (const group of groupShadowRefsByTarget(shadowRefs, (ref) => ref.keyframeId)) {
      targets.push({
        kind: 'shadow',
        nodeId: group.nodeId,
        property: group.property,
        items: group.items,
      })
    }
  }
  {
    const grouped = new Map<string, string[]>()
    for (const ref of symmetryRefs) {
      const arr = grouped.get(ref.nodeId) ?? []
      arr.push(ref.keyframeId)
      grouped.set(ref.nodeId, arr)
    }
    for (const [nodeId, items] of grouped) {
      targets.push({ kind: 'symmetry', nodeId, items })
    }
  }
  const deleteCommands = targets.map((target) => {
    if (target.kind === 'property') {
      return new DeleteKeyframesCommand({
        target: { kind: 'node', nodeId: target.nodeId, property: target.property },
        keyframeIds: target.items,
      })
    }
    if (target.kind === 'visible') {
      return new DeleteKeyframesCommand({
        target: { kind: 'visible', nodeId: target.nodeId },
        keyframeIds: target.items,
      })
    }
    if (target.kind === 'zIndex') {
      return new DeleteKeyframesCommand({
        target: { kind: 'zIndex', nodeId: target.nodeId },
        keyframeIds: target.items,
      })
    }
    if (target.kind === 'morph') {
      return new DeleteKeyframesCommand({
        target: { kind: 'morph', nodeId: target.nodeId },
        keyframeIds: target.items,
      })
    }
    if (target.kind === 'shadow') {
      return new DeleteKeyframesCommand({
        target: { kind: 'shadow', nodeId: target.nodeId, property: target.property },
        keyframeIds: target.items,
      })
    }
    if (target.kind === 'symmetry') {
      return new DeleteKeyframesCommand({
        target: { kind: 'symmetry', nodeId: target.nodeId },
        keyframeIds: target.items,
      })
    }
    if (target.kind === 'dataLabel') {
      return new DeleteKeyframesCommand({
        target: { kind: 'dataLabel', nodeId: target.nodeId, label: target.label },
        keyframeIds: target.items,
      })
    }
    if (target.kind === 'circle') {
      return new DeleteKeyframesCommand({
        target: { kind: 'circle', nodeId: target.nodeId, property: target.property },
        keyframeIds: target.items,
      })
    }
    return new DeleteKeyframesCommand({
      target: { kind: 'node', nodeId: target.nodeId, parameter: target.parameter },
      keyframeIds: target.items,
    })
  })
  dispatchKeyframeCommands(dispatch, deleteCommands)
  useTimelineSelectionStore.getState().clearSelection()
  return true
}

/**
 * Return true if the keyframe with the given id is currently disabled (session-only).
 * Searches all track types; returns false if not found (treat as enabled).
 */
export function isKeyframeDisabled(engine: EnginePublic, keyframeId: string): boolean {
  // Brute-force search across all tracks — cheap for < few hundred keyframes and only on context menu open
  for (const slide of engine.project?.slides ?? []) {
    for (const node of collectNodes(slide.scene)) {
      for (const prop of animatablePropertiesOf(node)) {
        for (const kf of engine.getKeyframes(node.id, prop))
          if (kf.id === keyframeId) return !!kf.disabled
      }
      const definition = engine.getMaterialDefinition(node.material.materialDefinitionId)
      for (const param of definition.parameters) {
        for (const kf of engine.getMaterialKeyframes(node.id, param.key))
          if (kf.id === keyframeId) return !!kf.disabled
      }
      const chart = node.components.chart
      if (chart) {
        for (const label of chart.dataLabels) {
          for (const kf of engine.getDataLabelKeyframes(node.id, label))
            if (kf.id === keyframeId) return !!kf.disabled
        }
      }
      if (node.components.circle) {
        for (const prop of ['radius', 'startAngle', 'endAngle', 'segments'] as const) {
          for (const kf of engine.getCircleKeyframes(node.id, prop))
            if (kf.id === keyframeId) return !!kf.disabled
        }
      }
      if (engine.hasVisibleTrack(node.id)) {
        for (const kf of engine.getVisibleKeyframes(node.id))
          if (kf.id === keyframeId) return !!kf.disabled
      }
      if (engine.hasZIndexTrack(node.id)) {
        for (const kf of engine.getZIndexKeyframes(node.id))
          if (kf.id === keyframeId) return !!kf.disabled
      }
      if (node.components.mesh) {
        for (const kf of engine.getMorphKeyframes(node.id))
          if (kf.id === keyframeId) return !!kf.disabled
      }
      for (const prop of SHADOW_PROPERTIES) {
        if (engine.hasShadowTrack(node.id, prop as ShadowProperty)) {
          for (const kf of engine.getShadowKeyframes(node.id, prop as ShadowProperty))
            if (kf.id === keyframeId) return !!kf.disabled
        }
      }
      if (engine.hasSymmetryTrack(node.id)) {
        for (const kf of engine.getSymmetryKeyframes(node.id))
          if (kf.id === keyframeId) return !!kf.disabled
      }
    }
  }
  return false
}

export function areAllSelectedDisabled(engine: EnginePublic): boolean {
  const ids = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
  if (ids.length === 0) return false
  return ids.every((id) => isKeyframeDisabled(engine, id))
}

export function isSelectionMixedDisabled(engine: EnginePublic): boolean {
  const ids = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
  if (ids.length === 0) return false
  const first = isKeyframeDisabled(engine, ids[0])
  return ids.some((id) => isKeyframeDisabled(engine, id) !== first)
}

/**
 * Set disabled flag for a single keyframe id (resolves its target). Used for single right-click without multi-select.
 */
export function setSingleKeyframeDisabled(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  keyframeId: string,
  disabled: boolean,
): boolean {
  // Find target for this keyframeId
  const allRefs = [
    ...allKeyframeRefs(engine).map((r) => ({
      ...r,
      kind: 'property' as const,
      target: { kind: 'node' as const, nodeId: r.nodeId, property: r.property },
    })),
    ...allMaterialKeyframeRefs(engine).map((r) => ({
      ...r,
      kind: 'parameter' as const,
      target: { kind: 'node' as const, nodeId: r.nodeId, parameter: r.parameter },
    })),
    ...allDataLabelKeyframeRefs(engine).map((r) => ({
      ...r,
      kind: 'dataLabel' as const,
      target: { kind: 'dataLabel' as const, nodeId: r.nodeId, label: r.label },
    })),
    ...allCircleKeyframeRefs(engine).map((r) => ({
      ...r,
      kind: 'circle' as const,
      target: { kind: 'circle' as const, nodeId: r.nodeId, property: r.property },
    })),
    ...allVisibleKeyframeRefs(engine).map((r) => ({
      ...r,
      kind: 'visible' as const,
      target: { kind: 'visible' as const, nodeId: r.nodeId },
    })),
    ...allZIndexKeyframeRefs(engine).map((r) => ({
      ...r,
      kind: 'zIndex' as const,
      target: { kind: 'zIndex' as const, nodeId: r.nodeId },
    })),
    ...allMorphKeyframeRefs(engine).map((r) => ({
      ...r,
      kind: 'morph' as const,
      target: { kind: 'morph' as const, nodeId: r.nodeId },
    })),
    ...allShadowKeyframeRefs(engine).map((r) => ({
      ...r,
      kind: 'shadow' as const,
      target: { kind: 'shadow' as const, nodeId: r.nodeId, property: r.property },
    })),
    ...allSymmetryKeyframeRefs(engine).map((r) => ({
      ...r,
      kind: 'symmetry' as const,
      target: { kind: 'symmetry' as const, nodeId: r.nodeId },
    })),
  ] as unknown as { keyframeId: string; target: import('../engine').KeyframeTarget }[]
  const entry = allRefs.find((r) => r.keyframeId === keyframeId)
  if (!entry) return false
  dispatch(new SetKeyframeDisabledCommand({ target: entry.target, keyframeId, disabled }))
  return true
}

/**
 * Set disabled for the current keyframe selection. Implements "Disable all" rule:
 * if any selected is enabled, disable entire selection; caller should compute desired flag.
 * Returns false if nothing selected.
 */
export function setSelectedKeyframesDisabled(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  disabled: boolean,
): boolean {
  const propertyRefs = selectedKeyframeRefs(engine)
  const materialRefs = selectedMaterialKeyframeRefs(engine)
  const dataLabelRefs = selectedDataLabelKeyframeRefs(engine)
  const circleRefs = selectedCircleKeyframeRefs(engine)
  const visibleRefs = selectedVisibleKeyframeRefs(engine)
  const zIndexRefs = selectedZIndexKeyframeRefs(engine)
  const morphRefs = selectedMorphKeyframeRefs(engine)
  const shadowRefs = selectedShadowKeyframeRefs(engine)
  const symmetryRefs = selectedSymmetryKeyframeRefs(engine)
  if (
    propertyRefs.length === 0 &&
    materialRefs.length === 0 &&
    dataLabelRefs.length === 0 &&
    circleRefs.length === 0 &&
    visibleRefs.length === 0 &&
    zIndexRefs.length === 0 &&
    morphRefs.length === 0 &&
    shadowRefs.length === 0 &&
    symmetryRefs.length === 0
  ) {
    return false
  }
  const commands: import('../engine/commands').SetKeyframeDisabledCommand[] = []
  for (const group of groupRefsByTarget(propertyRefs, (ref) => ref.keyframeId)) {
    for (const id of group.items) {
      commands.push(
        new SetKeyframeDisabledCommand({
          target: { kind: 'node', nodeId: group.nodeId, property: group.property },
          keyframeId: id,
          disabled,
        }),
      )
    }
  }
  for (const group of groupMaterialRefsByTarget(materialRefs, (ref) => ref.keyframeId)) {
    for (const id of group.items) {
      commands.push(
        new SetKeyframeDisabledCommand({
          target: { kind: 'node', nodeId: group.nodeId, parameter: group.parameter },
          keyframeId: id,
          disabled,
        }),
      )
    }
  }
  for (const group of groupDataLabelRefsByTarget(dataLabelRefs, (ref) => ref.keyframeId)) {
    for (const id of group.items) {
      commands.push(
        new SetKeyframeDisabledCommand({
          target: { kind: 'dataLabel', nodeId: group.nodeId, label: group.label },
          keyframeId: id,
          disabled,
        }),
      )
    }
  }
  for (const group of groupCircleRefsByTarget(circleRefs, (ref) => ref.keyframeId)) {
    for (const id of group.items) {
      commands.push(
        new SetKeyframeDisabledCommand({
          target: { kind: 'circle', nodeId: group.nodeId, property: group.property },
          keyframeId: id,
          disabled,
        }),
      )
    }
  }
  {
    const grouped = new Map<string, string[]>()
    for (const ref of visibleRefs) {
      const arr = grouped.get(ref.nodeId) ?? []
      arr.push(ref.keyframeId)
      grouped.set(ref.nodeId, arr)
    }
    for (const [nodeId, items] of grouped) {
      for (const id of items)
        commands.push(
          new SetKeyframeDisabledCommand({
            target: { kind: 'visible', nodeId },
            keyframeId: id,
            disabled,
          }),
        )
    }
  }
  {
    const grouped = new Map<string, string[]>()
    for (const ref of zIndexRefs) {
      const arr = grouped.get(ref.nodeId) ?? []
      arr.push(ref.keyframeId)
      grouped.set(ref.nodeId, arr)
    }
    for (const [nodeId, items] of grouped) {
      for (const id of items)
        commands.push(
          new SetKeyframeDisabledCommand({
            target: { kind: 'zIndex', nodeId },
            keyframeId: id,
            disabled,
          }),
        )
    }
  }
  {
    const grouped = new Map<string, string[]>()
    for (const ref of morphRefs) {
      const arr = grouped.get(ref.nodeId) ?? []
      arr.push(ref.keyframeId)
      grouped.set(ref.nodeId, arr)
    }
    for (const [nodeId, items] of grouped) {
      for (const id of items)
        commands.push(
          new SetKeyframeDisabledCommand({
            target: { kind: 'morph', nodeId },
            keyframeId: id,
            disabled,
          }),
        )
    }
  }
  for (const group of groupShadowRefsByTarget(shadowRefs, (ref) => ref.keyframeId)) {
    for (const id of group.items) {
      commands.push(
        new SetKeyframeDisabledCommand({
          target: { kind: 'shadow', nodeId: group.nodeId, property: group.property },
          keyframeId: id,
          disabled,
        }),
      )
    }
  }
  {
    const grouped = new Map<string, string[]>()
    for (const ref of symmetryRefs) {
      const arr = grouped.get(ref.nodeId) ?? []
      arr.push(ref.keyframeId)
      grouped.set(ref.nodeId, arr)
    }
    for (const [nodeId, items] of grouped) {
      for (const id of items)
        commands.push(
          new SetKeyframeDisabledCommand({
            target: { kind: 'symmetry', nodeId },
            keyframeId: id,
            disabled,
          }),
        )
    }
  }
  dispatchKeyframeCommands(dispatch, commands)
  return true
}

export function pruneKeyframeSelection(engine: EnginePublic): void {
  const validPropertyKeys = new Set(allKeyframeRefs(engine).map((ref) => ref.keyframeId))
  const validMaterialKeys = new Set(allMaterialKeyframeRefs(engine).map((ref) => ref.keyframeId))
  const validDataLabelKeys = new Set(allDataLabelKeyframeRefs(engine).map((ref) => ref.keyframeId))
  const validCircleKeys = new Set(allCircleKeyframeRefs(engine).map((ref) => ref.keyframeId))
  const validVisibleKeys = new Set(allVisibleKeyframeRefs(engine).map((ref) => ref.keyframeId))
  const validZIndexKeys = new Set(allZIndexKeyframeRefs(engine).map((ref) => ref.keyframeId))
  const validMorphKeys = new Set(allMorphKeyframeRefs(engine).map((ref) => ref.keyframeId))
  const validShadowKeys = new Set(allShadowKeyframeRefs(engine).map((ref) => ref.keyframeId))
  const validSymmetryKeys = new Set(allSymmetryKeyframeRefs(engine).map((ref) => ref.keyframeId))
  const valid = new Set([
    ...validPropertyKeys,
    ...validMaterialKeys,
    ...validDataLabelKeys,
    ...validCircleKeys,
    ...validVisibleKeys,
    ...validZIndexKeys,
    ...validMorphKeys,
    ...validShadowKeys,
    ...validSymmetryKeys,
  ])
  useTimelineSelectionStore.getState().pruneSelection(valid)
}

// ---------------------------------------------------------------------------
// Clipboard operations (Spec 07 R10)
// ---------------------------------------------------------------------------

/**
 * Copy the selected keyframes to the keyframe clipboard. Captures relative
 * times, values, interpolation, and tangents against the earliest selected
 * keyframe as origin. Supports node property, material parameter, and morph
 * keyframes (morph carries extra shape/category/topology meta for cross-object validation).
 */
export function copyKeyframes(engine: EnginePublic): void {
  const propertyRefs = selectedKeyframeRefs(engine)
  const materialRefs = selectedMaterialKeyframeRefs(engine)
  const morphRefs = selectedMorphKeyframeRefs(engine)
  if (propertyRefs.length === 0 && materialRefs.length === 0 && morphRefs.length === 0) {
    return
  }

  const targets: KeyframeClipboardTarget[] = []
  let globalEarliest = Infinity

  for (const group of groupRefsByTarget(propertyRefs, (ref) => ref.keyframeId)) {
    const kfRefs = propertyRefs.filter(
      (ref) => ref.nodeId === group.nodeId && ref.property === group.property,
    )
    const sorted = [...kfRefs].sort((a, b) => a.time - b.time)
    const groupOriginTime = sorted[0].time
    if (groupOriginTime < globalEarliest) {
      globalEarliest = groupOriginTime
    }

    const allKeyframes = engine.getKeyframes(group.nodeId, group.property)
    const kfById = new Map(allKeyframes.map((kf) => [kf.id, kf]))

    const keyframes: PastePayloadKeyframe[] = sorted.map((ref) => {
      const kf = kfById.get(ref.keyframeId)
      if (!kf) {
        throw new Error(`Keyframe not found: ${ref.keyframeId}`)
      }
      return {
        time: kf.time - groupOriginTime,
        value: snapshotOf(kf).value,
        interpolation: kf.interpolation,
        tangentIn: { time: kf.tangentIn.time, value: kf.tangentIn.value },
        tangentOut: { time: kf.tangentOut.time, value: kf.tangentOut.value },
      }
    })

    targets.push({
      target: { kind: 'node', nodeId: group.nodeId, property: group.property },
      payload: { keyframes },
      originTime: groupOriginTime,
    })
  }

  for (const group of groupMaterialRefsByTarget(materialRefs, (ref) => ref.keyframeId)) {
    const kfRefs = materialRefs.filter(
      (ref) => ref.nodeId === group.nodeId && ref.parameter === group.parameter,
    )
    const sorted = [...kfRefs].sort((a, b) => a.time - b.time)
    const groupOriginTime = sorted[0].time
    if (groupOriginTime < globalEarliest) {
      globalEarliest = groupOriginTime
    }

    const allKeyframes = engine.getMaterialKeyframes(group.nodeId, group.parameter)
    const kfById = new Map(allKeyframes.map((kf) => [kf.id, kf]))

    const keyframes: PastePayloadKeyframe[] = sorted.map((ref) => {
      const kf = kfById.get(ref.keyframeId)
      if (!kf) {
        throw new Error(`Keyframe not found: ${ref.keyframeId}`)
      }
      return {
        time: kf.time - groupOriginTime,
        value: snapshotOf(kf).value,
        interpolation: kf.interpolation,
        tangentIn: { time: kf.tangentIn.time, value: kf.tangentIn.value },
        tangentOut: { time: kf.tangentOut.time, value: kf.tangentOut.value },
      }
    })

    targets.push({
      target: { kind: 'node', nodeId: group.nodeId, parameter: group.parameter },
      payload: { keyframes },
      originTime: groupOriginTime,
    })
  }

  // Morph — one track per mesh node, grouped by nodeId
  {
    const grouped = new Map<string, MorphKeyframeRef[]>()
    for (const ref of morphRefs) {
      const arr = grouped.get(ref.nodeId) ?? []
      arr.push(ref)
      grouped.set(ref.nodeId, arr)
    }
    for (const [nodeId, refs] of grouped) {
      const sorted = [...refs].sort((a, b) => a.time - b.time)
      const groupOriginTime = sorted[0].time
      if (groupOriginTime < globalEarliest) {
        globalEarliest = groupOriginTime
      }
      const allKeyframes = engine.getMorphKeyframes(nodeId)
      const kfById = new Map(allKeyframes.map((kf) => [kf.id, kf]))
      const keyframes: PastePayloadKeyframe[] = sorted.map((ref) => {
        const kf = kfById.get(ref.keyframeId)
        if (!kf) throw new Error(`Keyframe not found: ${ref.keyframeId}`)
        return {
          time: kf.time - groupOriginTime,
          value: snapshotOf(kf).value,
          interpolation: kf.interpolation,
          tangentIn: { time: kf.tangentIn.time, value: kf.tangentIn.value },
          tangentOut: { time: kf.tangentOut.time, value: kf.tangentOut.value },
        }
      })
      const meta = buildMorphClipboardMeta(engine, nodeId)
      targets.push({
        target: { kind: 'morph', nodeId },
        payload: { keyframes },
        morphMeta: meta,
        originTime: groupOriginTime,
      })
    }
  }

  useKeyframeClipboardStore.getState().copy(targets, globalEarliest)
}

/**
 * Paste keyframes from the clipboard at the current playhead. Defaults to
 * the source target; if exactly one different property/parameter is
 * currently selected, pastes onto that instead. Issues PasteKeyframesCommand
 * per target, wrapped in a TransactionCommand when multiple targets exist.
 * For morph, validates shape names, category, and topology before dispatch.
 * When pasting numeric keyframes cross-node with a non-zero evaluated delta,
 * shows a modal asking per-track Absolute vs Relative (include delta); scale
 * uses ratio (×) with zero guard → additive fallback, opacity clamped 0..1,
 * rotation normalized. Non-numeric tracks always absolute (checkbox disabled).
 */
export async function pasteKeyframes(
  engine: EnginePublic,
  dispatch: DispatchCommand,
): Promise<void> {
  const { targets } = useKeyframeClipboardStore.getState()
  if (targets.length === 0) {
    return
  }

  const rawAtTime = resolvePlayheadTime(engine)
  const gridEnabled = useTimelineViewStore.getState().gridSnapEnabled
  const atTime = snapToFrameGrid(rawAtTime, gridEnabled)
  const overrideTarget = resolvePasteTargetOverride(engine)
  const selectedNodeIds = useSelectionStore.getState().selectedIds

  // For Ctrl+V cross-object paste: if no keyframe override but a single node is selected, retarget all clipboard entries to that node
  let retargetNodeId: string | null = null
  if (!overrideTarget && selectedNodeIds.length === 1) {
    const candidate = selectedNodeIds[0]
    const anyDifferent = targets.some((t) => (t.target as { nodeId?: string }).nodeId !== candidate)
    const allNodeKind = targets.every(
      (t) => 'nodeId' in (t.target as unknown as Record<string, unknown>),
    )
    if (anyDifferent && allNodeKind) {
      retargetNodeId = candidate
    }
  }

  // Build resolved targets + validate compatibility before delta prompt
  const resolvedTargets: import('../engine/keyframeTarget').KeyframeTarget[] = []
  for (const clipTarget of targets) {
    let target: import('../engine/keyframeTarget').KeyframeTarget
    if (overrideTarget) {
      target = overrideTarget
    } else if (retargetNodeId) {
      const src = clipTarget.target as unknown as Record<string, unknown>
      if (src.kind === 'morph') {
        target = { kind: 'morph', nodeId: retargetNodeId }
      } else if (src.kind === 'node' && 'property' in src) {
        target = {
          kind: 'node',
          nodeId: retargetNodeId,
          property: src.property as import('../engine').AnimationProperty,
        }
      } else if (src.kind === 'node' && 'parameter' in src) {
        target = { kind: 'node', nodeId: retargetNodeId, parameter: src.parameter as string }
      } else if (src.kind === 'circle') {
        target = {
          kind: 'circle',
          nodeId: retargetNodeId,
          property: src.property as import('../engine').CircleAnimationProperty,
        }
      } else if (src.kind === 'shadow') {
        target = {
          kind: 'shadow',
          nodeId: retargetNodeId,
          property: src.property as import('../engine/shadowEffect').ShadowProperty,
        }
      } else if (src.kind === 'dataLabel') {
        target = { kind: 'dataLabel', nodeId: retargetNodeId, label: src.label as string }
      } else if (src.kind === 'visible') {
        target = { kind: 'visible', nodeId: retargetNodeId }
      } else if (src.kind === 'zIndex') {
        target = { kind: 'zIndex', nodeId: retargetNodeId }
      } else if (src.kind === 'symmetry') {
        target = { kind: 'symmetry', nodeId: retargetNodeId }
      } else if (src.kind === 'table') {
        target = {
          kind: 'table',
          nodeId: retargetNodeId,
          property: src.property as import('../engine/animationProperties').TableAnimationProperty,
        }
      } else {
        target = clipTarget.target
      }
    } else {
      target = clipTarget.target
    }

    if (overrideTarget || retargetNodeId) {
      const compat = validatePasteCompatibility(clipTarget.target, target)
      if (!compat.ok) {
        useNotificationStore.getState().notify(compat.error)
        return
      }
      try {
        engine.resolveAnimationTarget(target)
      } catch (e) {
        useNotificationStore.getState().notify(e instanceof Error ? e.message : String(e))
        return
      }
    }
    resolvedTargets.push(target)
  }

  // Delta-aware prompt (only on cross-node && any numeric delta≠0)
  const deltaItems = computeDeltaItems(engine, targets, resolvedTargets, atTime)
  let deltaChoices: readonly boolean[] | null = null
  if (needsDeltaPrompt(deltaItems)) {
    const choices = await requestPasteDeltaChoices(deltaItems)
    if (choices === null) {
      // Cancelled → abort paste
      return
    }
    deltaChoices = choices
  }

  const commands: import('../engine/commands').PasteKeyframesCommand[] = []
  for (let i = 0; i < targets.length; i += 1) {
    const clipTarget = targets[i]
    const target = resolvedTargets[i]
    const useDelta = deltaChoices ? (deltaChoices[i] ?? false) : false
    const item = deltaItems[i]
    const propName = propertyNameOf(target)
    // Apply delta to payload if requested (ratio for scale)
    const basePayload = clipTarget.payload
    const transformedPayload =
      item.isNumeric && useDelta
        ? applyDeltaToPayload(basePayload, item.delta, item.ratio, propName, true)
        : basePayload

    if (target.kind === 'morph' && clipTarget.target.kind === 'morph') {
      const validation = validateMorphPaste(
        { ...clipTarget, payload: transformedPayload },
        engine,
        target as import('../engine/keyframeTarget').NodeMorphTarget,
      )
      if (!validation.ok) {
        useNotificationStore.getState().notify(validation.error!)
        return
      }
      commands.push(
        new PasteKeyframesCommand({
          target,
          payload: validation.remappedPayload!,
          atTime,
        }),
      )
    } else if (target.kind === 'morph' || clipTarget.target.kind === 'morph') {
      if (clipTarget.target.kind === 'morph' && target.kind === 'morph') {
        // handled above
      } else {
        useNotificationStore
          .getState()
          .notify('Cannot paste morph keyframes onto a non-morph track or vice versa')
        return
      }
    } else {
      commands.push(new PasteKeyframesCommand({ target, payload: transformedPayload, atTime }))
    }
  }

  try {
    dispatchKeyframeCommands(dispatch, commands)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    useNotificationStore.getState().notify(msg)
    return
  }
  useTimelineSelectionStore.getState().clearSelection()
}

/**
 * Paste clipboard contents onto an explicit lane target at a specific time.
 * Used for lane-click paste ("click on lane and paste if was copied").
 * Supports both single and multiple tracks: if clipboard has multiple targets,
 * each is retargeted to the lane's node (same parameter). Validates morph
 * names/category/topology and that each parameter is present on target node.
 * Returns true if paste was dispatched.
 */
export async function pasteKeyframesAtTarget(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  target: import('../engine/keyframeTarget').KeyframeTarget,
  rawAtTime: number,
): Promise<boolean> {
  const { targets } = useKeyframeClipboardStore.getState()
  if (targets.length === 0) {
    return false
  }
  const gridEnabled = useTimelineViewStore.getState().gridSnapEnabled
  const atTime = snapToFrameGrid(rawAtTime, gridEnabled)

  const laneNodeId = (target as { nodeId?: string }).nodeId
  if (!laneNodeId) {
    useNotificationStore.getState().notify('Cannot determine paste target node')
    return false
  }

  // Build resolved targets (single-track fast path and multi-track unified)
  let resolvedTargets: import('../engine/keyframeTarget').KeyframeTarget[] = []
  const errors: string[] = []

  if (targets.length === 1) {
    const clipTarget = targets[0]
    const compat = validatePasteCompatibility(clipTarget.target, target)
    if (!compat.ok) {
      useNotificationStore.getState().notify(compat.error)
      return false
    }
    try {
      engine.resolveAnimationTarget(target)
    } catch (e) {
      useNotificationStore.getState().notify(e instanceof Error ? e.message : String(e))
      return false
    }
    resolvedTargets = [target]
  } else {
    // Multi-track: retarget each clipboard entry to lane's node
    for (const clipTarget of targets) {
      const src = clipTarget.target
      let newTarget: import('../engine/keyframeTarget').KeyframeTarget | null = null
      if (src.kind === 'morph') {
        newTarget = { kind: 'morph', nodeId: laneNodeId }
      } else if (src.kind === 'node' && 'property' in src) {
        newTarget = {
          kind: 'node',
          nodeId: laneNodeId,
          property: (src as { property: import('../engine').AnimationProperty }).property,
        }
      } else if (src.kind === 'node' && 'parameter' in src) {
        newTarget = {
          kind: 'node',
          nodeId: laneNodeId,
          parameter: (src as { parameter: string }).parameter,
        }
      } else if (src.kind === 'circle') {
        newTarget = {
          kind: 'circle',
          nodeId: laneNodeId,
          property: (src as { property: import('../engine').CircleAnimationProperty }).property,
        }
      } else if (src.kind === 'shadow') {
        newTarget = {
          kind: 'shadow',
          nodeId: laneNodeId,
          property: (src as { property: import('../engine/shadowEffect').ShadowProperty }).property,
        }
      } else if (src.kind === 'dataLabel') {
        newTarget = {
          kind: 'dataLabel',
          nodeId: laneNodeId,
          label: (src as { label: string }).label,
        }
      } else if (src.kind === 'visible') {
        newTarget = { kind: 'visible', nodeId: laneNodeId }
      } else if (src.kind === 'zIndex') {
        newTarget = { kind: 'zIndex', nodeId: laneNodeId }
      } else if (src.kind === 'symmetry') {
        newTarget = { kind: 'symmetry', nodeId: laneNodeId }
      } else if (src.kind === 'table') {
        newTarget = {
          kind: 'table',
          nodeId: laneNodeId,
          property: (
            src as { property: import('../engine/animationProperties').TableAnimationProperty }
          ).property,
        }
      } else {
        errors.push(
          `Unsupported track type "${describeTarget(src as unknown as import('../engine/keyframeTarget').KeyframeTarget)}"`,
        )
        continue
      }
      try {
        engine.resolveAnimationTarget(newTarget)
      } catch (e) {
        errors.push(
          `Target node does not have "${describeTarget(src as unknown as import('../engine/keyframeTarget').KeyframeTarget)}" — ${e instanceof Error ? e.message : String(e)}`,
        )
        continue
      }
      resolvedTargets.push(newTarget)
    }

    if (errors.length > 0) {
      useNotificationStore.getState().notify(errors.join('\n'))
      if (resolvedTargets.length === 0) return false
      if (errors.length > 0 && resolvedTargets.length !== targets.length) {
        return false
      }
    }
    if (resolvedTargets.length === 0) return false
  }

  // Delta-aware prompt (only cross-node && any numeric delta≠0)
  // For single-track case resolvedTargets length 1, for multi-track matches clip count when successful
  // Align delta items with original targets (when single, resolvedTargets is [target]; when multi, we filtered errors earlier so lengths match if we passed)
  // For delta prompt we need items aligned with clipTargets that succeeded; if multi-track had errors we already returned false above.
  // So safe to compute with targets and resolvedTargets when lengths equal.
  let deltaChoices: readonly boolean[] | null = null
  if (targets.length === resolvedTargets.length) {
    const deltaItems = computeDeltaItems(engine, targets, resolvedTargets, atTime)
    if (needsDeltaPrompt(deltaItems)) {
      const choices = await requestPasteDeltaChoices(deltaItems)
      if (choices === null) {
        return false
      }
      deltaChoices = choices
    }
  }

  // Build commands with optional delta transformation
  if (targets.length === 1) {
    const clipTarget = targets[0]
    const dst = resolvedTargets[0]
    const idx = 0
    const useDelta = deltaChoices ? (deltaChoices[idx] ?? false) : false
    const deltaItem = (() => {
      // Recompute item for single to apply; avoid needing to store earlier
      const items = computeDeltaItems(engine, targets, resolvedTargets, atTime)
      return items[0]
    })()
    const propName = propertyNameOf(dst)
    const transformedPayload =
      deltaItem?.isNumeric && useDelta
        ? applyDeltaToPayload(clipTarget.payload, deltaItem.delta, deltaItem.ratio, propName, true)
        : clipTarget.payload

    if (dst.kind === 'morph') {
      const validation = validateMorphPaste(
        { ...clipTarget, payload: transformedPayload },
        engine,
        dst as import('../engine/keyframeTarget').NodeMorphTarget,
      )
      if (!validation.ok) {
        useNotificationStore.getState().notify(validation.error!)
        return false
      }
      try {
        dispatchKeyframeCommands(dispatch, [
          new PasteKeyframesCommand({ target: dst, payload: validation.remappedPayload!, atTime }),
        ])
      } catch (e) {
        useNotificationStore.getState().notify(e instanceof Error ? e.message : String(e))
        return false
      }
      useTimelineSelectionStore.getState().clearSelection()
      return true
    }
    try {
      dispatchKeyframeCommands(dispatch, [
        new PasteKeyframesCommand({ target: dst, payload: transformedPayload, atTime }),
      ])
    } catch (e) {
      useNotificationStore.getState().notify(e instanceof Error ? e.message : String(e))
      return false
    }
    useTimelineSelectionStore.getState().clearSelection()
    return true
  }

  // Multi-track
  const commands: import('../engine/commands').PasteKeyframesCommand[] = []
  const multiDeltaItems = computeDeltaItems(engine, targets, resolvedTargets, atTime)
  for (let i = 0; i < targets.length; i += 1) {
    const clipTarget = targets[i]
    const newTarget = resolvedTargets[i]
    if (!newTarget) continue
    const item = multiDeltaItems[i]
    const useDelta = deltaChoices ? (deltaChoices[i] ?? false) : false
    const propName = propertyNameOf(newTarget)
    const transformedPayload =
      item?.isNumeric && useDelta
        ? applyDeltaToPayload(clipTarget.payload, item.delta, item.ratio, propName, true)
        : clipTarget.payload

    if (newTarget.kind === 'morph') {
      const validation = validateMorphPaste(
        { ...clipTarget, payload: transformedPayload },
        engine,
        newTarget as import('../engine/keyframeTarget').NodeMorphTarget,
      )
      if (!validation.ok) {
        // Should have been caught earlier; but if fails due to delta? treat as error
        useNotificationStore.getState().notify(validation.error!)
        return false
      }
      commands.push(
        new PasteKeyframesCommand({
          target: newTarget,
          payload: validation.remappedPayload!,
          atTime,
        }),
      )
    } else {
      commands.push(
        new PasteKeyframesCommand({ target: newTarget, payload: transformedPayload, atTime }),
      )
    }
  }

  if (commands.length === 0) return false

  try {
    dispatchKeyframeCommands(dispatch, commands)
  } catch (e) {
    useNotificationStore.getState().notify(e instanceof Error ? e.message : String(e))
    return false
  }
  useTimelineSelectionStore.getState().clearSelection()
  return true
}

/**
 * Duplicate the selected keyframes. Issues DuplicateKeyframesCommand per
 * target, wrapped in a TransactionCommand when multiple targets exist.
 * Copied keyframes are placed immediately after the last keyframe.
 * Supports both node property and material parameter keyframes.
 */
export function duplicateKeyframes(engine: EnginePublic, dispatch: DispatchCommand): void {
  const propertyRefs = selectedKeyframeRefs(engine)
  const materialRefs = selectedMaterialKeyframeRefs(engine)
  if (propertyRefs.length === 0 && materialRefs.length === 0) {
    return
  }

  const commands: DuplicateKeyframesCommand[] = []

  for (const group of groupRefsByTarget(propertyRefs, (ref) => ref.keyframeId)) {
    commands.push(
      new DuplicateKeyframesCommand({
        target: { kind: 'node', nodeId: group.nodeId, property: group.property },
        keyframeIds: group.items,
      }),
    )
  }

  for (const group of groupMaterialRefsByTarget(materialRefs, (ref) => ref.keyframeId)) {
    commands.push(
      new DuplicateKeyframesCommand({
        target: { kind: 'node', nodeId: group.nodeId, parameter: group.parameter },
        keyframeIds: group.items,
      }),
    )
  }

  dispatchKeyframeCommands(dispatch, commands)
}

/**
 * Determine the current playhead time from the active slide.
 */
function resolvePlayheadTime(engine: EnginePublic): number {
  const activeSlideId = engine.activeSlideId
  if (!activeSlideId) {
    return 0
  }
  return usePlaybackController.getState().getTime(activeSlideId)
}

/**
 * Determine whether the current selection indicates a single-property or
 * single-parameter override target for paste. Returns the override target
 * or null.
 */
function resolvePasteTargetOverride(engine: EnginePublic): KeyframeTarget | null {
  const selectedIds = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
  if (selectedIds.length !== 1) {
    return null
  }

  const wanted = new Set(selectedIds)

  const propertyRefs = allKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
  if (propertyRefs.length === 1) {
    return {
      kind: 'node',
      nodeId: propertyRefs[0].nodeId,
      property: propertyRefs[0].property,
    }
  }

  const materialRefs = allMaterialKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
  if (materialRefs.length === 1) {
    return {
      kind: 'node',
      nodeId: materialRefs[0].nodeId,
      parameter: materialRefs[0].parameter,
    }
  }

  const morphRefs = allMorphKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
  if (morphRefs.length === 1) {
    return { kind: 'morph', nodeId: morphRefs[0].nodeId }
  }

  const circleRefs = allCircleKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
  if (circleRefs.length === 1) {
    return { kind: 'circle', nodeId: circleRefs[0].nodeId, property: circleRefs[0].property }
  }

  const dataLabelRefs = allDataLabelKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
  if (dataLabelRefs.length === 1) {
    return { kind: 'dataLabel', nodeId: dataLabelRefs[0].nodeId, label: dataLabelRefs[0].label }
  }

  const shadowRefs = allShadowKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
  if (shadowRefs.length === 1) {
    return {
      kind: 'shadow',
      nodeId: shadowRefs[0].nodeId,
      property: shadowRefs[0].property,
    }
  }

  const symmetryRefs = allSymmetryKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
  if (symmetryRefs.length === 1) {
    return { kind: 'symmetry', nodeId: symmetryRefs[0].nodeId }
  }

  const visibleRefs = allVisibleKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
  if (visibleRefs.length === 1) {
    return { kind: 'visible', nodeId: visibleRefs[0].nodeId }
  }

  const zIndexRefs = allZIndexKeyframeRefs(engine).filter((ref) => wanted.has(ref.keyframeId))
  if (zIndexRefs.length === 1) {
    return { kind: 'zIndex', nodeId: zIndexRefs[0].nodeId }
  }

  return null
}

// ---------------------------------------------------------------------------
// Morph cross-object helpers
// ---------------------------------------------------------------------------

function categoryPathFor(
  categories: readonly import('../engine/shapeCategory').ShapeCategory[],
  categoryId: string | null,
): string | null {
  if (categoryId === null) return null
  const byId = new Map(categories.map((c) => [c.id, c] as const))
  const cat = byId.get(categoryId)
  if (!cat) return null
  const parts: string[] = []
  let cur: import('../engine/shapeCategory').ShapeCategory | undefined = cat
  while (cur) {
    parts.unshift(cur.name)
    if (cur.parentId === null) break
    cur = byId.get(cur.parentId)
  }
  return parts.join('/')
}

function buildMorphClipboardMeta(engine: EnginePublic, nodeId: string): MorphClipboardMeta {
  const shapes = engine.getShapes(nodeId)
  const categories = (() => {
    try {
      return engine.getShapeCategories(nodeId)
    } catch {
      return [] as readonly import('../engine/shapeCategory').ShapeCategory[]
    }
  })()
  let vertexCount = 0
  try {
    const node = engine.getNode(nodeId)
    vertexCount = node.components.mesh?.mesh.vertices.length ?? 0
  } catch {
    vertexCount = shapes[0]?.vertices.length ?? 0
  }
  const shapesById: Record<string, MorphClipboardShapeInfo> = {}
  for (const s of shapes) {
    const categoryPath = categoryPathFor(categories, s.categoryId ?? null)
    // For "exact category name" we use full path; fallback to name alone would hide hierarchy mismatch,
    // path is stricter and matches the spec "same category if categorized"
    shapesById[s.id] = {
      name: s.name,
      categoryName: categoryPath ? (categoryPath.split('/').pop() ?? null) : null,
      categoryPath,
    }
  }
  return { vertexCount, shapesById }
}

function describeTarget(target: import('../engine/keyframeTarget').KeyframeTarget): string {
  if (target.kind === 'morph') return 'Morph'
  if (target.kind === 'node' && 'property' in target)
    return String((target as { property: string }).property)
  if (target.kind === 'node' && 'parameter' in target)
    return String((target as { parameter: string }).parameter)
  if (target.kind === 'circle') return String((target as { property: string }).property)
  if (target.kind === 'shadow') return String((target as { property: string }).property)
  if (target.kind === 'symmetry') return 'Symmetry'
  if (target.kind === 'visible') return 'Visible'
  if (target.kind === 'zIndex') return 'Z-Index'
  if (target.kind === 'dataLabel') return String((target as { label: string }).label)
  if (target.kind === 'table') return String((target as { property: string }).property)
  return target.kind
}

function validatePasteCompatibility(
  source: import('../engine/keyframeTarget').KeyframeTarget,
  target: import('../engine/keyframeTarget').KeyframeTarget,
): { ok: true } | { ok: false; error: string } {
  if (source.kind !== target.kind) {
    return {
      ok: false,
      error: `Cannot paste "${describeTarget(source)}" onto "${describeTarget(target)}": track types do not match. Copy and paste must use the same parameter.`,
    }
  }
  // same kind — check parameter identity where applicable
  if (source.kind === 'node' && target.kind === 'node') {
    const sHasProp = 'property' in source
    const tHasProp = 'property' in target
    const sHasParam = 'parameter' in source
    const tHasParam = 'parameter' in target
    if (sHasProp !== tHasProp || sHasParam !== tHasParam) {
      return {
        ok: false,
        error: `Cannot paste "${describeTarget(source)}" onto "${describeTarget(target)}": track types do not match.`,
      }
    }
    // Both have same sub-kind (both property or both parameter) — allow different names (e.g. positionX -> positionY) per existing behavior
    return { ok: true }
  }
  // For other kinds, same kind is sufficient — allow cross-property paste within same track type
  // e.g. circle radius <-> segments, shadow blur <-> offsetX etc. are allowed at paste level; engine will validate value types
  return { ok: true }
}

function validateMorphPaste(
  clipTarget: import('../stores/keyframeClipboardStore').KeyframeClipboardTarget,
  engine: EnginePublic,
  target: import('../engine/keyframeTarget').NodeMorphTarget,
):
  | { ok: true; remappedPayload: import('../engine/animationManager').PastePayload }
  | { ok: false; error: string } {
  const payload = clipTarget.payload
  const meta = clipTarget.morphMeta
  if (!meta) {
    // No meta — legacy clipboard: allow same-node paste without extra checks, but cross-node will be best-effort via IDs
    // For safety, try to build meta from source node if still alive; otherwise fallback to no validation
    return { ok: true, remappedPayload: payload }
  }
  let targetNode: import('../engine').SceneNode
  try {
    targetNode = engine.getNode(target.nodeId)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  if (!targetNode.components.mesh) {
    return {
      ok: false,
      error: `Target node "${targetNode.name}" does not have a mesh — cannot paste morph keyframes.`,
    }
  }
  const targetVertexCount = targetNode.components.mesh.mesh.vertices.length
  if (meta.vertexCount !== targetVertexCount) {
    return {
      ok: false,
      error: `Cannot paste morph keyframes: topology mismatch — source mesh has ${meta.vertexCount} vertices, target mesh "${targetNode.name}" has ${targetVertexCount} vertices. Shapes can only be copied between meshes with the same topology (same vertex count).`,
    }
  }
  let targetShapes: readonly import('../engine/shape').Shape[] = []
  let targetCategories: readonly import('../engine/shapeCategory').ShapeCategory[] = []
  try {
    targetShapes = engine.getShapes(target.nodeId)
  } catch {
    targetShapes = []
  }
  try {
    targetCategories = engine.getShapeCategories(target.nodeId)
  } catch {
    targetCategories = []
  }
  const missingNames: string[] = []
  const categoryMismatches: string[] = []
  // Build lookup from name+categoryPath to target shape id
  const targetShapeByKey = new Map<string, import('../engine/shape').Shape>()
  for (const s of targetShapes) {
    const path = categoryPathFor(targetCategories, s.categoryId ?? null)
    const key = `${s.name}::${path ?? '__none'}`
    targetShapeByKey.set(key, s)
    // also add name-only fallback for error messaging
  }
  const targetNameSet = new Set(targetShapes.map((s) => s.name))
  const targetShapeByName = new Map<string, import('../engine/shape').Shape[]>()
  for (const s of targetShapes) {
    const arr = targetShapeByName.get(s.name) ?? []
    arr.push(s)
    targetShapeByName.set(s.name, arr)
  }

  const remappedKeyframes: import('../engine/animationManager').PastePayloadKeyframe[] = []
  for (const kf of payload.keyframes) {
    const val = kf.value as unknown as {
      fromShapeId: string | null
      toShapeId: string | null
      coefficient: number
    } | null
    if (!val || typeof val !== 'object' || !('coefficient' in (val as Record<string, unknown>))) {
      // scalar legacy — no shape mapping needed
      remappedKeyframes.push(kf)
      continue
    }
    const fromId = (val as { fromShapeId: string | null }).fromShapeId
    const toId = (val as { toShapeId: string | null }).toShapeId
    const coeff = (val as { coefficient: number }).coefficient

    const resolveId = (sourceId: string | null): string | null => {
      if (sourceId === null) return null
      const sourceInfo = meta.shapesById[sourceId]
      if (!sourceInfo) {
        // source shape id not in meta — treat as missing
        missingNames.push(`(unknown shape id ${sourceId})`)
        return null
      }
      const sourceName = sourceInfo.name
      const sourcePath = sourceInfo.categoryPath
      // Check existence by name
      if (!targetNameSet.has(sourceName)) {
        const catSuffix = sourcePath ? ` (category "${sourcePath}")` : ''
        const msg = `"${sourceName}"${catSuffix}`
        if (!missingNames.includes(msg)) missingNames.push(msg)
        return null
      }
      // Find target shape with same name and matching category path
      const key = `${sourceName}::${sourcePath ?? '__none'}`
      const exact = targetShapeByKey.get(key)
      if (exact) return exact.id
      // Name exists but category mismatch — find any with same name
      const candidates = targetShapeByName.get(sourceName) ?? []
      if (candidates.length > 0) {
        const cand = candidates[0]
        const candPath = categoryPathFor(targetCategories, cand.categoryId ?? null)
        const sourceCatDisp = sourcePath ?? 'none'
        const targetCatDisp = candPath ?? 'none'
        const msg = `shape "${sourceName}" category mismatch: source category "${sourceCatDisp}" vs target category "${targetCatDisp}"`
        if (!categoryMismatches.includes(msg)) categoryMismatches.push(msg)
        return null
      }
      const catSuffix = sourcePath ? ` (category "${sourcePath}")` : ''
      const msg = `"${sourceName}"${catSuffix}`
      if (!missingNames.includes(msg)) missingNames.push(msg)
      return null
    }

    const newFromId = resolveId(fromId)
    const newToId = resolveId(toId)

    // If we collected missing/category errors, we will abort after loop; still need to know if this kf requires valid ids
    // If source had non-null but we couldn't resolve, mark error; else use remapped ids (could be null if source was null)
    // For error reporting, we already pushed; continue to next kf to collect all errors
    if ((fromId !== null && newFromId === null) || (toId !== null && newToId === null)) {
      // will be reported via missingNames/categoryMismatches; push placeholder to keep shape but will not be used if error
      remappedKeyframes.push({
        ...kf,
        value: {
          fromShapeId: newFromId,
          toShapeId: newToId,
          coefficient: coeff,
        } as unknown as import('../engine/keyframe').KeyframeValue,
      })
      continue
    }
    remappedKeyframes.push({
      ...kf,
      value: {
        fromShapeId: newFromId,
        toShapeId: newToId,
        coefficient: coeff,
      } as unknown as import('../engine/keyframe').KeyframeValue,
    })
  }

  if (missingNames.length > 0 || categoryMismatches.length > 0) {
    const parts: string[] = []
    if (missingNames.length > 0) {
      parts.push(`missing shapes: ${missingNames.join(', ')}`)
    }
    if (categoryMismatches.length > 0) {
      parts.push(`category mismatches: ${categoryMismatches.join('; ')}`)
    }
    const detail = parts.join(' — ')
    return {
      ok: false,
      error: `Cannot paste morph keyframes: morph names do not match — ${detail}. Shapes must have the same names and, if categorized, be in the same category.`,
    }
  }

  return { ok: true, remappedPayload: { keyframes: remappedKeyframes } }
}

// ---------------------------------------------------------------------------
// Delta-aware paste helpers (Spec delta-aware numeric paste)
// ---------------------------------------------------------------------------

function isScalePropertyTarget(target: import('../engine/keyframeTarget').KeyframeTarget): boolean {
  if (target.kind === 'node' && 'property' in target) {
    const prop = (target as { property: import('../engine').AnimationProperty }).property
    return prop === 'scaleX' || prop === 'scaleY'
  }
  return false
}

function evaluatedNumericForTarget(
  engine: EnginePublic,
  target: import('../engine/keyframeTarget').KeyframeTarget,
  time: number,
): number | null {
  try {
    if (target.kind === 'node' && 'property' in target) {
      const prop = (target as { property: import('../engine').AnimationProperty }).property
      return evaluatedPropertyValue(engine, target.nodeId, prop, time)
    }
    if (target.kind === 'node' && 'parameter' in target) {
      const param = (target as { parameter: string }).parameter
      const overrides = engine.evaluateMaterialOverrides(target.nodeId, time)
      const v = (overrides as Record<string, unknown>)[param]
      return typeof v === 'number' && Number.isFinite(v) ? (v as number) : null
    }
    if (target.kind === 'circle') {
      const circle = engine.evaluateCircle(target.nodeId, time)
      if (!circle) return null
      const prop = (
        target as { property: import('../engine/animationProperties').CircleAnimationProperty }
      ).property
      const v = (circle as unknown as Record<string, unknown>)[prop]
      return typeof v === 'number' && Number.isFinite(v) ? (v as number) : null
    }
    if (target.kind === 'shadow') {
      const shadow = engine.evaluateShadow(target.nodeId, time)
      if (!shadow) return null
      const prop = (target as { property: import('../engine/shadowEffect').ShadowProperty })
        .property
      if (prop === 'color') return null
      const v = (shadow as unknown as Record<string, unknown>)[prop]
      return typeof v === 'number' && Number.isFinite(v) ? (v as number) : null
    }
    if (target.kind === 'zIndex') {
      return engine.evaluateZIndex(target.nodeId, time)
    }
    if (target.kind === 'visible') return null
    if (target.kind === 'morph') return null
    if (target.kind === 'symmetry') return null
    if (target.kind === 'dataLabel') {
      const map = engine.evaluateDataLabels(target.nodeId, time)
      const v = map.get((target as { label: string }).label)
      return typeof v === 'number' && Number.isFinite(v) ? v : null
    }
    if (target.kind === 'table') {
      const table = engine.evaluateTable(target.nodeId, time)
      if (!table) return null
      const prop = (
        target as { property: import('../engine/animationProperties').TableAnimationProperty }
      ).property
      const v = (table as unknown as Record<string, unknown>)[prop]
      return typeof v === 'number' && Number.isFinite(v) ? (v as number) : null
    }
  } catch {
    return null
  }
  return null
}

function payloadIsNumeric(payload: import('../engine/animationManager').PastePayload): boolean {
  if (payload.keyframes.length === 0) return false
  const first = payload.keyframes[0].value
  return typeof first === 'number' && Number.isFinite(first as number)
}

export function computeDeltaItems(
  engine: EnginePublic,
  clipTargets: readonly KeyframeClipboardTarget[],
  resolvedTargets: readonly import('../engine/keyframeTarget').KeyframeTarget[],
  atTime: number,
): PasteDeltaItem[] {
  const items: PasteDeltaItem[] = []
  for (let i = 0; i < clipTargets.length; i += 1) {
    const clip = clipTargets[i]
    const dst = resolvedTargets[i]
    const src = clip.target
    const srcNodeId = (src as { nodeId?: string }).nodeId ?? ''
    const dstNodeId = (dst as { nodeId?: string }).nodeId ?? ''
    const label = describeTarget(
      src as unknown as import('../engine/keyframeTarget').KeyframeTarget,
    )
    const trackLabel = label
    const isNumeric = payloadIsNumeric(clip.payload)
    if (!isNumeric) {
      items.push({
        index: i,
        label,
        trackLabel,
        sourceNodeId: srcNodeId,
        targetNodeId: dstNodeId,
        isNumeric: false,
        delta: null,
        ratio: null,
        sourceValue: null,
        targetValue: null,
        disabledReason: 'Non-numeric track — always absolute',
      })
      continue
    }
    // If same node, no delta context -> disabled relative? We show but delta=0 handled earlier as no prompt.
    // Still compute for display. Fallback to global originTime for legacy clipboard.
    const originTime = clip.originTime ?? useKeyframeClipboardStore.getState().originTime ?? 0
    const srcVal = evaluatedNumericForTarget(
      engine,
      src as unknown as import('../engine/keyframeTarget').KeyframeTarget,
      originTime,
    )
    const dstVal = evaluatedNumericForTarget(engine, dst, atTime)
    if (srcVal === null || dstVal === null) {
      items.push({
        index: i,
        label,
        trackLabel,
        sourceNodeId: srcNodeId,
        targetNodeId: dstNodeId,
        isNumeric: false,
        delta: null,
        ratio: null,
        sourceValue: srcVal,
        targetValue: dstVal,
        disabledReason: 'Cannot evaluate numeric value — absolute only',
      })
      continue
    }
    const delta = dstVal - srcVal
    const isScale =
      isScalePropertyTarget(dst) ||
      isScalePropertyTarget(src as unknown as import('../engine/keyframeTarget').KeyframeTarget)
    let ratio: number | null = null
    if (isScale) {
      if (Math.abs(srcVal) > 1e-9) {
        ratio = dstVal / srcVal
      } else {
        ratio = null // guard zero → fallback additive
      }
    }
    items.push({
      index: i,
      label,
      trackLabel,
      sourceNodeId: srcNodeId,
      targetNodeId: dstNodeId,
      isNumeric: true,
      delta,
      ratio,
      sourceValue: srcVal,
      targetValue: dstVal,
      disabledReason: srcNodeId === dstNodeId ? 'Same object — delta is 0' : undefined,
    })
  }
  return items
}

export function needsDeltaPrompt(items: readonly PasteDeltaItem[]): boolean {
  const EPS = 1e-9
  for (const it of items) {
    if (!it.isNumeric) continue
    if (it.sourceNodeId === it.targetNodeId) continue
    if (it.delta === null) continue
    // For scale with ratio, consider delta not zero or ratio not 1
    const isScaleWithRatio = it.ratio !== null
    if (isScaleWithRatio) {
      if (Math.abs(it.ratio! - 1) > EPS) return true
      if (Math.abs(it.delta) > EPS) return true
    } else {
      if (Math.abs(it.delta) > EPS) return true
    }
  }
  return false
}

export function applyDeltaToPayload(
  payload: import('../engine/animationManager').PastePayload,
  delta: number | null,
  ratio: number | null,
  property: string | undefined,
  useDelta: boolean,
): import('../engine/animationManager').PastePayload {
  if (!useDelta || (delta === null && ratio === null)) return payload
  const isScale = property === 'scaleX' || property === 'scaleY'
  const useRatio = isScale && ratio !== null
  const keyframes = payload.keyframes.map((kf) => {
    const origVal = kf.value
    if (typeof origVal !== 'number' || !Number.isFinite(origVal as number)) {
      return kf
    }
    let newVal: number
    if (useRatio) {
      newVal = (origVal as number) * ratio!
    } else {
      newVal = (origVal as number) + (delta ?? 0)
    }
    if (property === 'opacity') {
      newVal = Math.max(0, Math.min(1, newVal))
    } else if (property === 'rotation') {
      newVal = normalizeRotation(newVal)
    }
    // Tangents: for ratio scale tangent values, for additive keep
    let newTangentIn = kf.tangentIn
    let newTangentOut = kf.tangentOut
    if (useRatio) {
      newTangentIn = { time: kf.tangentIn.time, value: kf.tangentIn.value * ratio! }
      newTangentOut = { time: kf.tangentOut.time, value: kf.tangentOut.value * ratio! }
    }
    return {
      ...kf,
      value: newVal as unknown as import('../engine/keyframe').KeyframeValue,
      tangentIn: newTangentIn,
      tangentOut: newTangentOut,
    }
  })
  return { keyframes }
}

function propertyNameOf(
  target: import('../engine/keyframeTarget').KeyframeTarget,
): string | undefined {
  if (target.kind === 'node' && 'property' in target)
    return (target as { property: string }).property
  if (target.kind === 'node' && 'parameter' in target)
    return (target as { parameter: string }).parameter
  if (target.kind === 'circle') return (target as { property: string }).property
  if (target.kind === 'shadow') return (target as { property: string }).property
  if (target.kind === 'table') return (target as { property: string }).property
  if (target.kind === 'dataLabel') return (target as { label: string }).label
  return undefined
}
