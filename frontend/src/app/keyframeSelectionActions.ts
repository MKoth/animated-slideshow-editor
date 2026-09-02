import type { EnginePublic, Scene, SceneNode } from '../engine'
import type { AnimationProperty, CircleAnimationProperty } from '../engine'
import type { KeyframeTarget } from '../engine'
import {
  DeleteKeyframesCommand,
  PasteKeyframesCommand,
  DuplicateKeyframesCommand,
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
export function groupCircleRefsByTarget<Ref extends { nodeId: string; property: CircleAnimationProperty }, T>(
  refs: readonly Ref[],
  itemOf: (ref: Ref) => T,
): { readonly nodeId: string; readonly property: CircleAnimationProperty; readonly items: T[] }[] {
  const groups = new Map<string, { nodeId: string; property: CircleAnimationProperty; items: T[] }>()
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

export function circleKeyframeRefsOfScene(
  engine: EnginePublic,
  scene: Scene,
): CircleKeyframeRef[] {
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

type DeleteTarget =
  | { kind: 'property'; nodeId: string; property: AnimationProperty; items: string[] }
  | { kind: 'parameter'; nodeId: string; parameter: string; items: string[] }
  | { kind: 'dataLabel'; nodeId: string; label: string; items: string[] }
  | { kind: 'circle'; nodeId: string; property: CircleAnimationProperty; items: string[] }

export function deleteSelectedKeyframes(engine: EnginePublic, dispatch: DispatchCommand): boolean {
  const propertyRefs = selectedKeyframeRefs(engine)
  const materialRefs = selectedMaterialKeyframeRefs(engine)
  const dataLabelRefs = selectedDataLabelKeyframeRefs(engine)
  const circleRefs = selectedCircleKeyframeRefs(engine)
  if (
    propertyRefs.length === 0 &&
    materialRefs.length === 0 &&
    dataLabelRefs.length === 0 &&
    circleRefs.length === 0
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
  const deleteCommands = targets.map((target) => {
    if (target.kind === 'property') {
      return new DeleteKeyframesCommand({
        target: { kind: 'node', nodeId: target.nodeId, property: target.property },
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

export function pruneKeyframeSelection(engine: EnginePublic): void {
  const validPropertyKeys = new Set(allKeyframeRefs(engine).map((ref) => ref.keyframeId))
  const validMaterialKeys = new Set(allMaterialKeyframeRefs(engine).map((ref) => ref.keyframeId))
  const validDataLabelKeys = new Set(allDataLabelKeyframeRefs(engine).map((ref) => ref.keyframeId))
  const validCircleKeys = new Set(allCircleKeyframeRefs(engine).map((ref) => ref.keyframeId))
  const valid = new Set([...validPropertyKeys, ...validMaterialKeys, ...validDataLabelKeys, ...validCircleKeys])
  useTimelineSelectionStore.getState().pruneSelection(valid)
}

// ---------------------------------------------------------------------------
// Clipboard operations (Spec 07 R10)
// ---------------------------------------------------------------------------

/**
 * Copy the selected keyframes to the keyframe clipboard. Captures relative
 * times, values, interpolation, and tangents against the earliest selected
 * keyframe as origin. Supports both node property and material parameter
 * keyframes.
 */
export function copyKeyframes(engine: EnginePublic): void {
  const propertyRefs = selectedKeyframeRefs(engine)
  const materialRefs = selectedMaterialKeyframeRefs(engine)
  if (propertyRefs.length === 0 && materialRefs.length === 0) {
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
    })
  }

  useKeyframeClipboardStore.getState().copy(targets, globalEarliest)
}

/**
 * Paste keyframes from the clipboard at the current playhead. Defaults to
 * the source target; if exactly one different property/parameter is
 * currently selected, pastes onto that instead. Issues PasteKeyframesCommand
 * per target, wrapped in a TransactionCommand when multiple targets exist.
 */
export function pasteKeyframes(engine: EnginePublic, dispatch: DispatchCommand): void {
  const { targets } = useKeyframeClipboardStore.getState()
  if (targets.length === 0) {
    return
  }

  const rawAtTime = resolvePlayheadTime(engine)
  const gridEnabled = useTimelineViewStore.getState().gridSnapEnabled
  const atTime = snapToFrameGrid(rawAtTime, gridEnabled)
  const overrideTarget = resolvePasteTargetOverride(engine)

  const commands = targets.map((clipTarget) => {
    const target = overrideTarget ?? clipTarget.target
    return new PasteKeyframesCommand({ target, payload: clipTarget.payload, atTime })
  })

  dispatchKeyframeCommands(dispatch, commands)
  useTimelineSelectionStore.getState().clearSelection()
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

  return null
}
