import type {
  CircleAnimationProperty,
  KeyframeTarget,
  MaterialParameterDefault,
  SceneNode,
  Slide,
} from '../engine'
import { CIRCLE_ANIMATABLE_PROPERTIES } from '../engine'
import { TABLE_ANIMATABLE_PROPERTIES } from '../engine/animationProperties'
import type { TableAnimationProperty } from '../engine/animationProperties'
import { SHADOW_LABELS, SHADOW_PROPERTIES } from '../engine/shadowEffect'
import type { ShadowProperty } from '../engine/shadowEffect'
import type { Control } from '../engine/control'
import { inSegment } from '../engine/timeSegmentExtraction'
import { animatablePropertiesOf } from './keyframeActions'
import {
  CIRCLE_LABELS,
  MORPH_LABEL,
  PROPERTY_LABELS,
  SYMMETRY_LABEL,
  VISIBLE_LABEL,
  ZINDEX_LABEL,
  materialParametersOf,
} from '../components/panels/timelineTracks'

export interface MaterialDefinitionLike {
  readonly id: string
  readonly parameters: readonly MaterialParameterDefault[]
}

export interface RangeTrackTime {
  readonly id: string
  readonly time: number
}

/** One keyframe track on a node (every `KeyframeTarget` family). */
export interface RangeTrackSnapshot {
  readonly nodeId: string
  /** Stable per-node key, e.g. `property:positionX`, `morph`, `material:roughness`. */
  readonly trackKey: string
  readonly target: KeyframeTarget
  readonly label: string
  readonly times: readonly RangeTrackTime[]
}

/** A node in the range scope with all of its tracks. */
export interface RangeNodeSnapshot {
  readonly nodeId: string
  readonly nodeName: string
  readonly depth: number
  readonly tracks: readonly RangeTrackSnapshot[]
}

/** Checkbox-state key for a track. */
export function rangeTrackCheckKey(nodeId: string, trackKey: string): string {
  return `${nodeId}${trackKey}`
}

function pushIfNonEmpty(
  tracks: RangeTrackSnapshot[],
  nodeId: string,
  trackKey: string,
  target: KeyframeTarget,
  label: string,
  times: readonly RangeTrackTime[],
): void {
  if (times.length === 0) {
    return
  }
  tracks.push({ nodeId, trackKey, target, label, times })
}

function snapshotNodeTracks(
  node: SceneNode,
  slide: Slide,
  materialDefinitions: readonly MaterialDefinitionLike[],
): RangeTrackSnapshot[] {
  const tracks: RangeTrackSnapshot[] = []
  const nodeId = node.id
  const animation = slide.animation.node(nodeId)
  if (!animation) {
    return tracks
  }
  const timesOf = (
    keyframes: readonly { readonly id: string; readonly time: number }[],
  ): RangeTrackTime[] => keyframes.map((keyframe) => ({ id: keyframe.id, time: keyframe.time }))

  // Rig controls first (matches timeline lane order).
  for (const key of animation.controlTrackKeys()) {
    const control = (node.controlSet?.controls as readonly Control[] | undefined)?.find(
      (entry) => entry.key === key,
    )
    pushIfNonEmpty(
      tracks,
      nodeId,
      `control:${key}`,
      { kind: 'control', nodeId, controlKey: key },
      control?.label ?? key,
      timesOf(animation.controlKeyframes(key)),
    )
  }
  // Uniform animated properties.
  for (const property of animatablePropertiesOf(node)) {
    pushIfNonEmpty(
      tracks,
      nodeId,
      `property:${property}`,
      { kind: 'node', nodeId, property },
      PROPERTY_LABELS[property] ?? property,
      timesOf(animation.keyframes(property)),
    )
  }
  pushIfNonEmpty(
    tracks,
    nodeId,
    'zIndex',
    { kind: 'zIndex', nodeId },
    ZINDEX_LABEL,
    timesOf(animation.zIndexKeyframes()),
  )
  pushIfNonEmpty(
    tracks,
    nodeId,
    'morph',
    { kind: 'morph', nodeId },
    MORPH_LABEL,
    timesOf(animation.morphKeyframes()),
  )
  pushIfNonEmpty(
    tracks,
    nodeId,
    'symmetry',
    { kind: 'symmetry', nodeId },
    SYMMETRY_LABEL,
    timesOf(animation.symmetryKeyframes()),
  )
  // Material parameters: definition order first, then orphan tracks.
  const materialParams = materialParametersOf(node, materialDefinitions)
  for (const parameter of materialParams) {
    pushIfNonEmpty(
      tracks,
      nodeId,
      `material:${parameter.key}`,
      { kind: 'node', nodeId, parameter: parameter.key },
      parameter.key,
      timesOf(animation.materialKeyframes(parameter.key)),
    )
  }
  for (const key of animation.materialTrackParameterKeys()) {
    if (materialParams.some((parameter) => parameter.key === key)) {
      continue
    }
    pushIfNonEmpty(
      tracks,
      nodeId,
      `material:${key}`,
      { kind: 'node', nodeId, parameter: key },
      key,
      timesOf(animation.materialKeyframes(key)),
    )
  }
  // Chart data labels.
  const chartLabels = node.components.chart?.dataLabels ?? []
  const labelKeys = [...chartLabels]
  for (const label of animation.dataLabelTrackLabels()) {
    if (!labelKeys.includes(label)) {
      labelKeys.push(label)
    }
  }
  for (const label of labelKeys) {
    pushIfNonEmpty(
      tracks,
      nodeId,
      `dataLabel:${label}`,
      { kind: 'dataLabel', nodeId, label },
      label,
      timesOf(animation.dataLabelKeyframes(label)),
    )
  }
  // Circle + shadow + table tracks.
  for (const property of CIRCLE_ANIMATABLE_PROPERTIES) {
    pushIfNonEmpty(
      tracks,
      nodeId,
      `circle:${property}`,
      { kind: 'circle', nodeId, property: property as CircleAnimationProperty },
      CIRCLE_LABELS[property as CircleAnimationProperty] ?? property,
      timesOf(animation.circleKeyframes(property as CircleAnimationProperty)),
    )
  }
  for (const property of SHADOW_PROPERTIES as readonly ShadowProperty[]) {
    pushIfNonEmpty(
      tracks,
      nodeId,
      `shadow:${property}`,
      { kind: 'shadow', nodeId, property },
      SHADOW_LABELS[property] ?? property,
      timesOf(animation.shadowKeyframes(property)),
    )
  }
  for (const property of TABLE_ANIMATABLE_PROPERTIES) {
    pushIfNonEmpty(
      tracks,
      nodeId,
      `table:${property}`,
      { kind: 'table', nodeId, property: property as TableAnimationProperty },
      property === 'borderRadius' ? 'Border Radius' : 'Padding',
      timesOf(animation.tableKeyframes(property as TableAnimationProperty)),
    )
  }
  pushIfNonEmpty(
    tracks,
    nodeId,
    'visible',
    { kind: 'visible', nodeId },
    VISIBLE_LABEL,
    timesOf(animation.visibleKeyframes()),
  )
  return tracks
}

/**
 * Pre-order snapshot (root first) of every node in the subtree with all of
 * its keyframe tracks. Only tracks holding at least one keyframe are listed;
 * consumers additionally hide tracks with zero keyframes in their range.
 */
export function snapshotRangeNodes(
  root: SceneNode,
  slide: Slide,
  materialDefinitions: readonly MaterialDefinitionLike[],
): RangeNodeSnapshot[] {
  const snapshots: RangeNodeSnapshot[] = []
  const visit = (node: SceneNode, depth: number): void => {
    snapshots.push({
      nodeId: node.id,
      nodeName: node.name,
      depth,
      tracks: snapshotNodeTracks(node, slide, materialDefinitions),
    })
    for (const child of node.children) {
      visit(child, depth + 1)
    }
  }
  visit(root, 0)
  return snapshots
}

/** Number of keyframes on a track inside `[from, to]` (inclusive). */
export function countTrackInRange(track: RangeTrackSnapshot, from: number, to: number): number {
  let count = 0
  for (const time of track.times) {
    if (inSegment(time.time, from, to)) {
      count += 1
    }
  }
  return count
}
