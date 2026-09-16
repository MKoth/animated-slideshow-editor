import type { Scene, SceneNode } from '../../engine'
import type { AnimationProperty, CircleAnimationProperty } from '../../engine'
import type { MaterialParameterDefault } from '../../engine'
import type { ClipDefinition } from '../../engine/clipDefinition'
import type { ClipParam } from '../../engine/clipDefinition'
import { animatablePropertiesOf } from '../../app/keyframeActions'
import { CIRCLE_ANIMATABLE_PROPERTIES } from '../../engine/animationProperties'
import {
  SHADOW_LIGHT_PROPERTIES,
  SHADOW_SHARED_PROPERTIES,
  SHADOW_BASE_PROPERTIES,
  SHADOW_LABELS,
} from '../../engine/shadowEffect'
import type { ShadowProperty } from '../../engine/shadowEffect'
import { isGroupNode } from '../../engine/sceneNode'

export const TRACK_HEADER_WIDTH = 240
export const ROW_HEIGHT = 28

export interface TrackRowEntry {
  readonly kind: 'node'
  readonly node: SceneNode
  readonly depth: number
  readonly name: string
  readonly visible: boolean
  readonly hiddenCount?: number
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

export interface VisibleSubtrackEntry {
  readonly kind: 'visibleSubtrack'
  readonly node: SceneNode
  readonly depth: number
}

export interface ZIndexSubtrackEntry {
  readonly kind: 'zIndexSubtrack'
  readonly node: SceneNode
  readonly depth: number
}

export interface MorphSubtrackEntry {
  readonly kind: 'morphSubtrack'
  readonly node: SceneNode
  readonly depth: number
}

export interface SymmetrySubtrackEntry {
  readonly kind: 'symmetrySubtrack'
  readonly node: SceneNode
  readonly depth: number
}

export interface ControlSubtrackEntry {
  readonly kind: 'controlSubtrack'
  readonly node: SceneNode
  readonly controlKey: string
  readonly label: string
  readonly depth: number
}

export interface HiddenSubtrackEntry {
  readonly kind: 'hiddenSubtrack'
  readonly node: SceneNode
  readonly property: AnimationProperty
  readonly ownerKey: string
  readonly ownerKeys: readonly string[]
  readonly ownerLabel: string
  readonly depth: number
}

export interface ShadowSubtrackEntry {
  readonly kind: 'shadowSubtrack'
  readonly node: SceneNode
  readonly property: ShadowProperty
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
  | VisibleSubtrackEntry
  | ZIndexSubtrackEntry
  | MorphSubtrackEntry
  | SymmetrySubtrackEntry
  | ControlSubtrackEntry
  | HiddenSubtrackEntry
  | ShadowSubtrackEntry
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

export const VISIBLE_LABEL = 'Visible'

export const ZINDEX_LABEL = 'Z-Index'

export const MORPH_LABEL = 'Morph'

export const SYMMETRY_LABEL = 'Symmetry'

export const SHADOW_LABELS_MAP = SHADOW_LABELS

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
  authoringModeByHost: Readonly<Record<string, boolean>> = {},
  getClip: ((clipId: string) => ClipDefinition | null) | undefined = undefined,
): TimelineRow[] {
  const rows: TimelineRow[] = []
  for (const entry of trackRows(scene)) {
    // compute hiddenCount for badge ( Normal mode, when not authoring for this node's hosts)
    let hiddenCountForEntry = 0
    let shouldShowHiddenBadge = false
    if (expandedNodeIds[entry.node.id] === true) {
      // count hidden subtracks that would be hidden in Normal
      for (const property of animatablePropertiesOf(entry.node)) {
        const owners = getExposedControlOwners(entry.node, property, getClip)
        if (owners.length > 0) {
          const anyAuthoring = owners.some((o) => authoringModeByHost[o.split(':')[0]!] === true)
          if (!anyAuthoring) hiddenCountForEntry += 1
        }
      }
      // also include other lane types if they are controlled? For now only count subtrack hidden; material/circle etc. could be added
      shouldShowHiddenBadge = hiddenCountForEntry > 0 && authoringModeByHost[entry.node.id] !== true
    }
    const entryWithBadge: TrackRowEntry = {
      ...entry,
      hiddenCount: shouldShowHiddenBadge ? hiddenCountForEntry : 0,
    }
    // also need to handle bone vs node with hiddenCount? For bone entries we don't badge
    if (entry.node.components.bone) {
      rows.push({
        kind: 'bone',
        node: entry.node,
        depth: entry.depth,
        name: entry.name,
        visible: entry.visible,
      })
    } else {
      rows.push(entryWithBadge)
    }
    if (expandedNodeIds[entry.node.id] === true) {
      // Control lane visibility: Normal shows only exposed hosts, Authoring shows all.
      // Blend lives inside host keyframes (no separate lanes).
      const isAuthoringForHost = authoringModeByHost[entry.node.id] === true
      if (entry.node.controlSet) {
        const controls = entry.node.controlSet
          .controls as readonly import('../../engine/control').Control[]
        for (const control of controls) {
          const visible = isAuthoringForHost ? true : control.exposed === true
          if (visible) {
            rows.push({
              kind: 'controlSubtrack',
              node: entry.node,
              controlKey: control.key,
              label: control.label,
              depth: entry.depth + 1,
            })
          }
        }
      }
      for (const property of animatablePropertiesOf(entry.node)) {
        const owners = getExposedControlOwners(entry.node, property, getClip)
        if (owners.length > 0) {
          const anyAuthoring = owners.some((o) => authoringModeByHost[o.split(':')[0]!] === true)
          if (!anyAuthoring) {
            const ownerLabel = owners.map((o) => o.split(':')[1] ?? o).join(', ')
            rows.push({
              kind: 'hiddenSubtrack',
              node: entry.node,
              property,
              ownerKey: owners[0]!,
              ownerKeys: owners,
              ownerLabel,
              depth: entry.depth + 1,
            })
            continue
          }
        }
        rows.push({ kind: 'subtrack', node: entry.node, property, depth: entry.depth + 1 })
      }
      rows.push({ kind: 'zIndexSubtrack', node: entry.node, depth: entry.depth + 1 })
      if (entry.node.components.mesh) {
        rows.push({ kind: 'morphSubtrack', node: entry.node, depth: entry.depth + 1 })
        rows.push({ kind: 'symmetrySubtrack', node: entry.node, depth: entry.depth + 1 })
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
      // Shadow subtracks: flat under expanded Group at parent.depth+1, no intermediate header
      // Only for groups that have shadowEffect — hidden until ☑ Shadow checked
      // Spec 305: auto mode hides 7 raw lanes, shows 3 light lanes + blur/opacity/color (6 total). Manual shows 10 raw.
      if (isGroupNode(entry.node) && entry.node.shadowEffect) {
        const isAuto = !!entry.node.shadowEffect.auto
        if (isAuto) {
          for (const property of SHADOW_LIGHT_PROPERTIES) {
            rows.push({
              kind: 'shadowSubtrack',
              node: entry.node,
              property: property as ShadowProperty,
              depth: entry.depth + 1,
            })
          }
          for (const property of SHADOW_SHARED_PROPERTIES) {
            rows.push({
              kind: 'shadowSubtrack',
              node: entry.node,
              property: property as ShadowProperty,
              depth: entry.depth + 1,
            })
          }
        } else {
          for (const property of SHADOW_BASE_PROPERTIES) {
            rows.push({
              kind: 'shadowSubtrack',
              node: entry.node,
              property: property as ShadowProperty,
              depth: entry.depth + 1,
            })
          }
        }
      }
    }
  }
  return rows
}

export function getExposedControlOwner(
  node: SceneNode,
  property: AnimationProperty,
  getClip?: (clipId: string) => ClipDefinition | null,
): string | null {
  const owners = getExposedControlOwners(node, property, getClip)
  return owners[0] ?? null
}
// keep exported for test compatibility
void getExposedControlOwner

export function getExposedControlOwners(
  node: SceneNode,
  property: AnimationProperty,
  getClip?: (clipId: string) => ClipDefinition | null,
): string[] {
  if (!getClip || !node.semanticName) return []
  const owners: string[] = []
  for (let host = node.parent; host; host = host.parent) {
    const controls = host.controlSet?.controls ?? []
    for (const control of controls as readonly import('../../engine/control').Control[]) {
      if (!control.exposed) continue
      // Check union across all groups: use merged bindings (control.bindings) which is union of groups
      // For legacy without groups, bindings is the source; for groups, merged is union
      const binding = (control.bindings as Record<string, unknown>)[
        node.semanticName
      ] as unknown as { clipId?: string } | string | undefined
      if (!binding) continue
      const clipId = typeof binding === 'string' ? binding : (binding as { clipId: string }).clipId
      if (!clipId) continue
      let clip: ClipDefinition | null
      try {
        clip = getClip(clipId)
      } catch {
        continue
      }
      if (clip?.hasChannel(property as never)) owners.push(`${host.id}:${control.key}`)
      else {
        // also check if any group individually has channel even if merged doesn't? Merged already unions, but for completeness check groups
        const groups = (
          control as unknown as { groups?: readonly { bindings: Record<string, unknown> }[] }
        ).groups
        if (Array.isArray(groups)) {
          for (const g of groups) {
            const gb = (g.bindings as Record<string, unknown>)[node.semanticName] as unknown as
              { clipId?: string } | string | undefined
            if (!gb) continue
            const gid = typeof gb === 'string' ? gb : (gb as { clipId: string }).clipId
            if (!gid || gid !== clipId) continue
            // clip already checked
          }
        }
      }
    }
  }
  return owners
}

export function getHiddenCountForNode(
  node: SceneNode,
  authoringModeByHost: Readonly<Record<string, boolean>>,
  getClip?: (clipId: string) => ClipDefinition | null,
): number {
  let count = 0
  for (const property of animatablePropertiesOf(node)) {
    const owners = getExposedControlOwners(node, property, getClip)
    if (owners.length > 0 && !owners.some((o) => authoringModeByHost[o.split(':')[0]!] === true))
      count++
  }
  return count
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

export interface ClipVisibleRowEntry {
  readonly kind: 'clipVisible'
  readonly clipId: string
  readonly label: string
  readonly rowIndex: number
}

export interface ClipZIndexRowEntry {
  readonly kind: 'clipZIndex'
  readonly clipId: string
  readonly label: string
  readonly rowIndex: number
}

export interface ClipCircleRowEntry {
  readonly kind: 'clipCircle'
  readonly clipId: string
  readonly property: CircleAnimationProperty
  readonly label: string
  readonly rowIndex: number
}

export interface ClipMorphRowEntry {
  readonly kind: 'clipMorph'
  readonly clipId: string
  readonly label: string
  readonly rowIndex: number
}

export interface ClipShadowRowEntry {
  readonly kind: 'clipShadow'
  readonly clipId: string
  readonly property: ShadowProperty
  readonly label: string
  readonly rowIndex: number
}

export interface ClipMaterialRowEntry {
  readonly kind: 'clipMaterial'
  readonly clipId: string
  readonly parameter: string
  readonly label: string
  readonly rowIndex: number
}

export type ClipEditorRow =
  | ClipChannelRowEntry
  | ClipVisibleRowEntry
  | ClipZIndexRowEntry
  | ClipCircleRowEntry
  | ClipMorphRowEntry
  | ClipShadowRowEntry
  | ClipMaterialRowEntry

export type ClipTimelineRow = ClipEditorRow

export function clipChannelRows(clip: ClipDefinition): ClipEditorRow[] {
  const rows: ClipEditorRow[] = []
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
  // visible hold – one lane, visible-pattern
  if (clip.hasVisibleTrack()) {
    rows.push({
      kind: 'clipVisible',
      clipId: clip.id,
      label: VISIBLE_LABEL,
      rowIndex,
    })
    rowIndex++
  }
  // zIndex hold – one lane, same pattern
  if (clip.hasZIndexTrack()) {
    rows.push({
      kind: 'clipZIndex',
      clipId: clip.id,
      label: ZINDEX_LABEL,
      rowIndex,
    })
    rowIndex++
  }
  // morph coefficient – one lane
  if (clip.hasMorphTrack()) {
    rows.push({
      kind: 'clipMorph',
      clipId: clip.id,
      label: MORPH_LABEL,
      rowIndex,
    })
    rowIndex++
  }
  // circle angles/segments
  for (const prop of clip.circleTrackKeys) {
    rows.push({
      kind: 'clipCircle',
      clipId: clip.id,
      property: prop,
      label: CIRCLE_LABELS[prop],
      rowIndex,
    })
    rowIndex++
  }
  // shadow params
  for (const prop of clip.shadowChannelKeys) {
    rows.push({
      kind: 'clipShadow',
      clipId: clip.id,
      property: prop,
      label: SHADOW_LABELS[prop] ?? prop,
      rowIndex,
    })
    rowIndex++
  }
  // material params
  for (const key of clip.materialChannelParameterKeys) {
    rows.push({
      kind: 'clipMaterial',
      clipId: clip.id,
      parameter: key,
      label: key,
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
