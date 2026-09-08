import type { SceneNode } from './sceneNode'
import type { Slide } from './slide'
import { walkPreOrder } from './sceneNode'
import { animatablePropertiesOf } from '../app/keyframeActions'
import { CIRCLE_ANIMATABLE_PROPERTIES } from './animationProperties'
import { SHADOW_PROPERTIES } from './shadowEffect'
import type { ShadowProperty } from './shadowEffect'
import type { ClipDefinition } from './clipDefinition'
import { isGroupNode } from './sceneNode'
import { PROPERTY_LABELS, CIRCLE_LABELS, VISIBLE_LABEL, MORPH_LABEL } from '../components/panels/timelineTracks'
import { SHADOW_LABELS } from './shadowEffect'
import type { MaterialParameterDefault } from './materialResolution'
import { materialParametersOf } from '../components/panels/timelineTracks'

export type ManagerTab = 'collections' | 'clips' | 'orphans'

export interface AnimatedParam {
  readonly kind: 'property' | 'visible' | 'circle' | 'shadow' | 'material' | 'morph' | 'symmetry' | 'table'
  readonly key: string
  readonly label: string
}

export interface ManagerRow {
  readonly node: SceneNode
  readonly depth: number
  readonly animatedParams: readonly AnimatedParam[]
}



function hasClipChannelForProperty(
  propertyKey: string,
  kind: AnimatedParam['kind'],
  node: SceneNode,
  getClip: (clipId: string) => ClipDefinition | null,
): boolean {
  for (const inst of node.clipInstances) {
    let clip: ClipDefinition | null = null
    try {
      clip = getClip(inst.clipId)
    } catch {
      continue
    }
    if (!clip) continue
    if (kind === 'property') {
      if (clip.hasChannel(propertyKey as never) && (clip.channelAnimation(propertyKey as never)?.length ?? 0) > 0) return true
      // fallback: check channel list existence implies at least one keyframe (since empty channels are removed)
      if (clip.hasChannel(propertyKey as never)) return true
    } else if (kind === 'visible') {
      if (clip.hasVisibleTrack()) return true
    } else if (kind === 'morph') {
      if (clip.hasMorphTrack()) return true
    } else if (kind === 'circle') {
      if (clip.hasCircleTrack(propertyKey as never)) return true
    } else if (kind === 'shadow') {
      if (clip.hasShadowChannel(propertyKey as ShadowProperty)) return true
    } else if (kind === 'material') {
      if (clip.hasMaterialChannel(propertyKey)) return true
    }
  }
  return false
}

export function isParamAnimated(
  node: SceneNode,
  slide: Slide,
  kind: AnimatedParam['kind'],
  key: string,
  getClip: (clipId: string) => ClipDefinition | null,
): boolean {
  // node keyframe check
  const nodeAnim = slide.animation.node(node.id)
  const hasNode = (() => {
    if (!nodeAnim) return false
    if (kind === 'property') return nodeAnim.hasTrack(key as never) && nodeAnim.keyframes(key as never).length > 0
    if (kind === 'visible') return nodeAnim.hasVisibleTrack() && nodeAnim.visibleKeyframes().length > 0
    if (kind === 'morph') return nodeAnim.hasMorphTrack() && nodeAnim.morphKeyframes().length > 0
    if (kind === 'circle') return nodeAnim.hasCircleTrack(key as never) && nodeAnim.circleKeyframes(key as never).length > 0
    if (kind === 'shadow') return nodeAnim.hasShadowTrack(key as ShadowProperty) && nodeAnim.shadowKeyframes(key as ShadowProperty).length > 0
    if (kind === 'material') return nodeAnim.hasMaterialTrack(key) && nodeAnim.materialKeyframes(key).length > 0
    if (kind === 'symmetry') return nodeAnim.hasSymmetryTrack() && nodeAnim.symmetryKeyframes().length > 0
    if (kind === 'table') return (nodeAnim as unknown as { hasTableTrack: (k:string)=>boolean }).hasTableTrack?.(key) && (nodeAnim.tableKeyframes(key as never).length > 0)
    return false
  })()
  if (hasNode) return true
  return hasClipChannelForProperty(key, kind, node, getClip)
}

export function getAnimatedParams(
  node: SceneNode,
  slide: Slide,
  materialDefinitions: readonly { id: string; parameters: readonly MaterialParameterDefault[] }[],
  getClip: (clipId: string) => ClipDefinition | null,
): readonly AnimatedParam[] {
  const params: AnimatedParam[] = []
  // standard six (filtered per node type)
  for (const prop of animatablePropertiesOf(node)) {
    if (isParamAnimated(node, slide, 'property', prop, getClip)) {
      params.push({ kind: 'property', key: prop, label: (PROPERTY_LABELS as Record<string,string>)[prop] ?? prop })
    }
  }
  // visible (hold) – always check, even if not in animatablePropertiesOf
  if (isParamAnimated(node, slide, 'visible', 'visible', getClip)) {
    params.push({ kind: 'visible', key: 'visible', label: VISIBLE_LABEL })
  }
  // morph – for mesh nodes or if animated (visible-pattern: one morph lane per clip)
  // We include morph if node has mesh or if either side animates. To avoid omitting, check always.
  // But spec says morph coefficient appears when animated – include if animated regardless of mesh.
  // We gate: if node has mesh component OR animated then include. Safer to check animated unconditionally.
  if (isParamAnimated(node, slide, 'morph', 'morph', getClip)) {
    params.push({ kind: 'morph', key: 'morph', label: MORPH_LABEL })
  }
  // symmetry (not required but include if animated for completeness)
  if (isParamAnimated(node, slide, 'symmetry', 'symmetry', getClip)) {
    params.push({ kind: 'symmetry', key: 'symmetry', label: 'Symmetry' })
  }
  // circle angles – only if node has circle component OR animated via clip
  const hasCircleAnimated = CIRCLE_ANIMATABLE_PROPERTIES.some((p) => isParamAnimated(node, slide, 'circle', p, getClip))
  if (node.components.circle || hasCircleAnimated) {
    for (const prop of CIRCLE_ANIMATABLE_PROPERTIES) {
      if (isParamAnimated(node, slide, 'circle', prop, getClip)) {
        params.push({ kind: 'circle', key: prop, label: (CIRCLE_LABELS as Record<string,string>)[prop] ?? prop })
      }
    }
  }
  // shadow params – only for group nodes or if any shadow animated
  const hasShadowAnimated = (SHADOW_PROPERTIES as readonly string[]).some((p) => isParamAnimated(node, slide, 'shadow', p, getClip))
  if (isGroupNode(node) || hasShadowAnimated || !!node.shadowEffect) {
    for (const prop of SHADOW_PROPERTIES as readonly ShadowProperty[]) {
      if (isParamAnimated(node, slide, 'shadow', prop, getClip)) {
        params.push({ kind: 'shadow', key: prop, label: (SHADOW_LABELS as Record<string,string>)[prop] ?? prop })
      }
    }
  }
  // material params – per node's material parameters
  const materialParams = materialParametersOf(node, materialDefinitions)
  for (const param of materialParams) {
    if (isParamAnimated(node, slide, 'material', param.key, getClip)) {
      params.push({ kind: 'material', key: param.key, label: param.key })
    }
  }
  // Also include material tracks that exist but whose definition may not be in materialDefinitions (e.g., after definition removed)
  // Check node's material tracks keys that haven't been covered
  const nodeAnim = slide.animation.node(node.id)
  if (nodeAnim) {
    const extraKeys = nodeAnim.materialTrackParameterKeys().filter((k) => !materialParams.some((p) => p.key === k))
    for (const key of extraKeys) {
      if (isParamAnimated(node, slide, 'material', key, getClip) && !params.some((p) => p.kind === 'material' && p.key === key)) {
        params.push({ kind: 'material', key, label: key })
      }
    }
    // Also clip material channels not in materialParams
    for (const inst of node.clipInstances) {
      let clip: ClipDefinition | null = null
      try {
        clip = getClip(inst.clipId)
      } catch {
        continue
      }
      if (!clip) continue
      for (const k of clip.materialChannelParameterKeys) {
        if (
          !params.some((p) => p.kind === 'material' && p.key === k) &&
          !materialParams.some((p) => p.key === k)
        ) {
          if (clip.hasMaterialChannel(k)) {
            params.push({ kind: 'material', key: k, label: k })
          }
        }
      }
    }
  }
  // table tracks
  if (node.components.table || node.components.tableCell || node.components.tableRow) {
    for (const prop of ['borderRadius', 'padding'] as const) {
      if (isParamAnimated(node, slide, 'table', prop, getClip)) {
        params.push({ kind: 'table', key: prop, label: prop === 'borderRadius' ? 'Border Radius' : 'Padding' })
      }
    }
  } else {
    // Even if node doesn't have table component now but has table keyframes (orphan), still surface
    if (nodeAnim && (nodeAnim.tableTrackKeys().length > 0 || [...node.clipInstances].some(() => true))) {
      // check each table prop
      for (const prop of ['borderRadius', 'padding'] as const) {
        if (isParamAnimated(node, slide, 'table', prop, getClip) && !params.some((p) => p.key === prop)) {
          params.push({ kind: 'table', key: prop, label: prop === 'borderRadius' ? 'Border Radius' : 'Padding' })
        }
      }
    }
  }
  // camera – camera transform already handled via property filtering, but ensure camera's specific set includes all transform minus rotation
  // No extra handling needed.

  return params
}

export function hasAnyKeyframe(node: SceneNode, slide: Slide): boolean {
  const anim = slide.animation.node(node.id)
  if (!anim) return false
  // check any track with keyframes
  for (const prop of animatablePropertiesOf(node)) {
    if (anim.hasTrack(prop as never) && anim.keyframes(prop as never).length > 0) return true
  }
  if (anim.hasVisibleTrack() && anim.visibleKeyframes().length > 0) return true
  if (anim.hasMorphTrack() && anim.morphKeyframes().length > 0) return true
  if (anim.hasSymmetryTrack() && anim.symmetryKeyframes().length > 0) return true
  for (const key of anim.materialTrackParameterKeys()) {
    if (anim.materialKeyframes(key).length > 0) return true
  }
  for (const key of anim.dataLabelTrackLabels()) {
    if (anim.dataLabelKeyframes(key).length > 0) return true
  }
  for (const key of anim.circleTrackKeys()) {
    if (anim.circleKeyframes(key as never).length > 0) return true
  }
  for (const key of anim.shadowTrackKeys()) {
    if (anim.shadowKeyframes(key as never).length > 0) return true
  }
  for (const key of anim.tableTrackKeys()) {
    if (anim.tableKeyframes(key as never).length > 0) return true
  }
  return false
}

export function isAnimatedChild(node: SceneNode, slide: Slide): boolean {
  if (node.clipInstances.length > 0) return true
  return hasAnyKeyframe(node, slide)
}

export function hasAnimatedDescendant(
  parent: SceneNode,
  slide: Slide,
): boolean {
  for (const descendant of walkPreOrder(parent)) {
    if (descendant.id === parent.id) continue
    if (isAnimatedChild(descendant, slide)) return true
  }
  return false
}

export function getManagerRows(
  parent: SceneNode,
  slide: Slide,
  materialDefinitions: readonly { id: string; parameters: readonly MaterialParameterDefault[] }[],
  getClip: (clipId: string) => ClipDefinition | null,
): readonly ManagerRow[] {
  const rows: ManagerRow[] = []
  function walk(node: SceneNode, depth: number): void {
    for (const child of node.children) {
      const animated = isAnimatedChild(child, slide)
      if (animated) {
        const animatedParams = getAnimatedParams(child, slide, materialDefinitions, getClip)
        // Only keep if at least one animated param OR has clip instances (clip instance without param still counts as row?)
        // Spec says per child only Animated Params – if a child has clipInstances but no channel keyframe, should it still appear?
        // Yes, because Animated Child includes clip instance; but Animated Params may be empty if clip has no channels with keyframes.
        // In that case we still surface the child row but with zero params? Spec says per child only Animated Params – so if zero params, row would be empty.
        // However to avoid silently hiding clip-only nodes, we keep row even if params empty, but prefer to show params derived from clip channels.
        // If params empty but clipInstances exist, we try to still derive params from clip channels (maybe clip has channels but we missed because getAnimatedParams requires clip lookup – it already does)
        // So if still empty, we keep empty (row will be collapsible but shows no subtracks)
        rows.push({ node: child, depth, animatedParams })
      }
      // Recurse regardless – need to find deeply nested animated descendants even under non-animated intermediate parent
      walk(child, depth + 1)
    }
  }
  walk(parent, 0)
  return rows
}

export function getOrphanKeyframes(
  node: SceneNode,
  slide: Slide,
  param: AnimatedParam,
): readonly import('./keyframe').Keyframe[] {
  const anim = slide.animation.node(node.id)
  if (!anim) return []
  if (param.kind === 'property') return anim.keyframes(param.key as never)
  if (param.kind === 'visible') return anim.visibleKeyframes()
  if (param.kind === 'morph') return anim.morphKeyframes()
  if (param.kind === 'circle') return anim.circleKeyframes(param.key as never)
  if (param.kind === 'shadow') return anim.shadowKeyframes(param.key as ShadowProperty)
  if (param.kind === 'material') return anim.materialKeyframes(param.key)
  if (param.kind === 'symmetry') return anim.symmetryKeyframes()
  if (param.kind === 'table') return anim.tableKeyframes(param.key as never)
  return []
}
