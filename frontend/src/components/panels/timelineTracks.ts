import type { Scene, SceneNode } from '../../engine'
import type { AnimationProperty, CircleAnimationProperty } from '../../engine'
import type { MaterialParameterDefault } from '../../engine'
import type { ClipDefinition } from '../../engine/clipDefinition'
import type { ClipParam } from '../../engine/clipDefinition'
import { animatablePropertiesOf } from '../../app/keyframeActions'
import { CIRCLE_ANIMATABLE_PROPERTIES } from '../../engine/animationProperties'

export const TRACK_HEADER_WIDTH = 240
export const ROW_HEIGHT = 28

export interface TrackRowEntry {
  readonly kind: 'node'
  readonly node: SceneNode
  readonly depth: number
  readonly name: string
  readonly visible: boolean
}

export interface SubtrackEntry {
  readonly kind: 'subtrack'
  readonly node: SceneNode
  readonly property: AnimationProperty
  readonly depth: number
}

export interface MaterialSubtrackEntry {
  readonly kind: 'materialSubtrack'
  readonly node: SceneNode
  readonly parameter: MaterialParameterDefault
  readonly depth: number
}

export interface DataLabelSubtrackEntry {
  readonly kind: 'dataLabelSubtrack'
  readonly node: SceneNode
  readonly label: string
  readonly depth: number
}

export interface CircleSubtrackEntry {
  readonly kind: 'circleSubtrack'
  readonly node: SceneNode
  readonly property: CircleAnimationProperty
  readonly depth: number
}

/** A bone node row — distinguished from regular node rows for UI styling. */
export interface BoneTrackEntry {
  readonly kind: 'bone'
  readonly node: SceneNode
  readonly depth: number
  readonly name: string
  readonly visible: boolean
}

export type TimelineRow =
  | TrackRowEntry
  | SubtrackEntry
  | MaterialSubtrackEntry
  | DataLabelSubtrackEntry
  | CircleSubtrackEntry
  | BoneTrackEntry

export const PROPERTY_LABELS: Record<AnimationProperty, string> = {
  positionX: 'Position X',
  positionY: 'Position Y',
  rotation: 'Rotation',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  opacity: 'Opacity',
}

export const CIRCLE_LABELS: Record<CircleAnimationProperty, string> = {
  radius: 'Radius',
  startAngle: 'Start Angle',
  endAngle: 'End Angle',
  segments: 'Segments',
}

export function materialParameterLabel(parameter: MaterialParameterDefault): string {
  return parameter.key
}

export function materialParametersOf(
  node: SceneNode,
  materialDefinitions: readonly { id: string; parameters: readonly MaterialParameterDefault[] }[],
): MaterialParameterDefault[] {
  const definitionId = node.material.materialDefinitionId
  const definition = materialDefinitions.find((d) => d.id === definitionId)
  if (!definition) {
    return []
  }
  return [...definition.parameters]
}

export function trackRows(scene: Scene): TrackRowEntry[] {
  const rows: TrackRowEntry[] = []
  const walk = (node: SceneNode, depth: number): void => {
    rows.push({ kind: 'node', node, depth, name: node.name, visible: node.visible })
    for (const child of node.children) {
      if (child.components.camera) {
        continue
      }
      walk(child, depth + 1)
    }
  }
  walk(scene.root, 0)
  rows.push({
    kind: 'node',
    node: scene.camera,
    depth: 1,
    name: scene.camera.name,
    visible: scene.camera.visible,
  })
  return rows
}

/**
 * Build the full list of timeline rows, including bone track entries
 * for nodes that have a bone component.
 */
export function timelineRows(
  scene: Scene,
  expandedNodeIds: Readonly<Record<string, boolean>>,
  materialDefinitions: readonly {
    id: string
    parameters: readonly MaterialParameterDefault[]
  }[] = [],
): TimelineRow[] {
  const rows: TimelineRow[] = []
  for (const entry of trackRows(scene)) {
    if (entry.node.components.bone) {
      rows.push({
        kind: 'bone',
        node: entry.node,
        depth: entry.depth,
        name: entry.name,
        visible: entry.visible,
      })
    } else {
      rows.push(entry)
    }
    if (expandedNodeIds[entry.node.id] === true) {
      for (const property of animatablePropertiesOf(entry.node)) {
        rows.push({ kind: 'subtrack', node: entry.node, property, depth: entry.depth + 1 })
      }
      for (const parameter of materialParametersOf(entry.node, materialDefinitions)) {
        rows.push({ kind: 'materialSubtrack', node: entry.node, parameter, depth: entry.depth + 1 })
      }
      const chart = entry.node.components.chart
      if (chart) {
        for (const label of chart.dataLabels) {
          rows.push({
            kind: 'dataLabelSubtrack',
            node: entry.node,
            label,
            depth: entry.depth + 1,
          })
        }
      }
      if (entry.node.components.circle) {
        for (const property of CIRCLE_ANIMATABLE_PROPERTIES) {
          rows.push({
            kind: 'circleSubtrack',
            node: entry.node,
            property,
            depth: entry.depth + 1,
          })
        }
      }
    }
  }
  return rows
}

export function sceneHasObjects(scene: Scene): boolean {
  return scene.root.children.some((child) => !child.components.camera)
}

// ---------------------------------------------------------------------------
// Clip-edit track rows
// ---------------------------------------------------------------------------

export interface ClipChannelRowEntry {
  readonly kind: 'clipChannel'
  readonly clipId: string
  readonly channel: AnimationProperty
  readonly label: string
  readonly rowIndex: number
}

export type ClipTimelineRow = ClipChannelRowEntry

export function clipChannelRows(clip: ClipDefinition): ClipChannelRowEntry[] {
  const rows: ClipChannelRowEntry[] = []
  let rowIndex = 0
  for (const channelDef of clip.channels) {
    rows.push({
      kind: 'clipChannel',
      clipId: clip.id,
      channel: channelDef.property,
      label: PROPERTY_LABELS[channelDef.property],
      rowIndex,
    })
    rowIndex++
  }
  return rows
}

export function clipChannelParamLabel(channel: AnimationProperty, param?: ClipParam): string {
  if (param) {
    return `${PROPERTY_LABELS[channel]} (${param.label})`
  }
  return PROPERTY_LABELS[channel]
}
