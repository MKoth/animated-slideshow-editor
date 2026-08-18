import type { Scene, SceneNode } from '../../engine'
import type { AnimationProperty } from '../../engine'
import type { MaterialParameterDefault } from '../../engine'
import type { ClipDefinition } from '../../engine/clipDefinition'
import type { ClipParam } from '../../engine/clipDefinition'
import { animatablePropertiesOf } from '../../app/keyframeActions'

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

export type TimelineRow = TrackRowEntry | SubtrackEntry | MaterialSubtrackEntry

export const PROPERTY_LABELS: Record<AnimationProperty, string> = {
  positionX: 'Position X',
  positionY: 'Position Y',
  rotation: 'Rotation',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  opacity: 'Opacity',
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
    rows.push(entry)
    if (expandedNodeIds[entry.node.id] === true) {
      for (const property of animatablePropertiesOf(entry.node)) {
        rows.push({ kind: 'subtrack', node: entry.node, property, depth: entry.depth + 1 })
      }
      for (const parameter of materialParametersOf(entry.node, materialDefinitions)) {
        rows.push({ kind: 'materialSubtrack', node: entry.node, parameter, depth: entry.depth + 1 })
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
