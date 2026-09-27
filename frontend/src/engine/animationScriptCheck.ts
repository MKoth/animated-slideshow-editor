import type { EnginePublic } from './engine'
import type { SceneNode } from './sceneNode'
import { isGroupNode, walkPreOrder } from './sceneNode'
import { compileAnimationScript, isScriptTableProperty } from './animationScriptCompiler'
import type {
  AnimationScriptBudgets,
  AnimationScriptClipChannel,
  AnimationScriptCompileResult,
  AnimationScriptExistingControl,
  AnimationScriptExistingInstance,
  AnimationScriptMaterialParameterInfo,
  AnimationScriptNodeInfo,
  ScriptProperty,
  ScriptTrack,
  ScriptTrackValue,
} from './animationScriptCompiler'
import { createAnimationScriptReads } from './animationScriptReads'
import type { AnimationScriptMeasure, AnimationScriptReadSource } from './animationScriptReads'
import { evaluateSegment } from './interpolators'
import type { Keyframe } from './keyframe'
import {
  DEFAULT_MATERIAL_PARAMETERS,
  DEFAULT_OPACITY_MULTIPLIER,
  DEFAULT_TINT,
  OPACITY_MULTIPLIER_PARAMETER_KEY,
  RESERVED_TIME_UNIFORM,
  TINT_PARAMETER_KEY,
} from './materialResolution'
import { DEFAULT_SHADOW_EFFECT, lerpHexColor } from './shadowEffect'
import { MIN_CLIP_SPEED } from './animationManagerModel'
import type { ClipDefinition } from './clipDefinition'
import { controlBindingClipId } from './control'

export interface AnimationScriptCheckOptions {
  /**
   * The renderer's measured node sizes, used by `bounds(...)`. Omitted in a
   * headless compile, where bounds report no measurable geometry.
   */
  readonly measure?: AnimationScriptMeasure
  /**
   * Tunable compile budgets, overriding the `SCRIPT_MAX_*` defaults. Tests use
   * small budgets to trigger diagnostics quickly; production uses defaults.
   * Validation is identical no matter who authored the source — hand or AI —
   * because Check and Run share this single compile path.
   */
  readonly budgets?: AnimationScriptBudgets
}

/**
 * The Animation Script Check seam: a pure function of `(source, slide state)`
 * that returns diagnostics, the prospective command output, and a footprint
 * summary. It reads the engine and dispatches nothing.
 */
export function checkAnimationScript(
  engine: EnginePublic,
  slideId: string,
  source: string,
  options: AnimationScriptCheckOptions = {},
): AnimationScriptCompileResult {
  const slide = engine.getSlide(slideId)
  const nodes: AnimationScriptNodeInfo[] = []
  for (const node of walkPreOrder(slide.scene.root)) {
    const tableCell = node.components.tableCell
    nodes.push({
      id: node.id,
      name: node.name,
      isBone: node.components.bone !== undefined,
      isCamera: node.components.camera !== undefined,
      ...(node.semanticName !== undefined && { semanticName: node.semanticName }),
      ...(node.parent !== null && { parentId: node.parent.id }),
      isTable: node.components.table !== undefined,
      isTableCell: tableCell !== undefined,
      ...(node.components.table !== undefined && {
        tableColumnCount: node.components.table.columns.length,
      }),
      ...(tableCell !== undefined && { colSpan: tableCell.colSpan, rowSpan: tableCell.rowSpan }),
      ...(node.controlSet !== undefined && {
        controls: node.controlSet.controls.map((control) => ({
          key: control.key,
          exposed: control.exposed,
          bindings: controlBindingsOf(control.bindings),
        })),
      }),
      materialParameters: materialParametersOf(engine, node),
      isCircle: node.components.circle !== undefined,
      isMesh: node.components.mesh !== undefined,
      isText: node.components.text !== undefined,
      isGroup: isGroupNode(node),
      hasShadowEffect: node.shadowEffect !== undefined,
      morphBinding: engine.getMorphBinding(node.id),
      ...(node.components.chart?.dataLabels !== undefined && {
        dataLabels: [...node.components.chart.dataLabels],
      }),
    })
  }
  const reads = createAnimationScriptReads(engine, options.measure)
  const libraryFunctions =
    engine.project?.scriptFunctions.map((entry) => ({
      id: entry.id,
      name: entry.name,
      version: entry.version,
      source: entry.source,
    })) ?? []
  return compileAnimationScript(source, {
    slideDuration: slide.duration,
    nodes,
    clips: engine.clips.map((clip) => ({
      id: clip.id,
      name: clip.name,
      duration: clip.duration,
      params: clip.params.map((param) => param.key),
      channels: clipChannelsOf(clip),
    })),
    collections: engine.clipCollections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      bindings: collection.getBindingsObject(),
    })),
    libraryFunctions,
    ...(options.budgets !== undefined ? { budgets: options.budgets } : {}),
    existingInstances: existingInstancesOf(engine, slide.scene.root),
    existingControls: existingControlsOf(engine, slide.scene.root),
    evaluateProperty: (nodeId, property, time) => evaluateProperty(engine, nodeId, property, time),
    evaluateTrackValue: (nodeId, track, time) =>
      evaluateTrackValue(engine, reads, nodeId, track, time),
    reads,
  })
}

/**
 * The tracks a clip placement drives, for raw-vs-clip conflict detection.
 * Uniform channels map to the script's node vocabulary (`positionX` → `x`);
 * material channels match by parameter name; circle/table/shadow/morph/
 * symmetry/zIndex map to their script kinds. `visible` and `segments` never
 * appear — the script surface excludes them.
 */
function clipChannelsOf(clip: ClipDefinition): AnimationScriptClipChannel[] {
  const channels: AnimationScriptClipChannel[] = []
  for (const channel of clip.channels) {
    if (channel.materialParameter) {
      channels.push({ kind: 'parameter', parameter: channel.materialParameter })
      continue
    }
    switch (channel.property) {
      case 'positionX':
        channels.push({ kind: 'node', property: 'x' })
        break
      case 'positionY':
        channels.push({ kind: 'node', property: 'y' })
        break
      case 'rotation':
        channels.push({ kind: 'node', property: 'rotation' })
        break
      case 'scaleX':
        channels.push({ kind: 'node', property: 'scaleX' })
        break
      case 'scaleY':
        channels.push({ kind: 'node', property: 'scaleY' })
        break
      case 'opacity':
        channels.push({ kind: 'node', property: 'opacity' })
        break
    }
  }
  for (const property of clip.circleTrackKeys) {
    if (property === 'radius' || property === 'startAngle' || property === 'endAngle') {
      channels.push({ kind: 'circle', property })
    }
  }
  for (const property of clip.tableTrackKeys) {
    if (property === 'borderRadius' || property === 'padding') {
      channels.push({ kind: 'table', property })
    }
  }
  if (clip.hasMorphTrack()) channels.push({ kind: 'morph' })
  if (clip.getSymmetryKeyframes().length > 0) channels.push({ kind: 'symmetry' })
  for (const property of clip.shadowChannelKeys) {
    channels.push({ kind: 'shadow', property })
  }
  if (clip.hasZIndexTrack()) channels.push({ kind: 'zIndex' })
  return channels
}

/** A control's semantic → clip ids, flattened from intervals and arrays. */
function controlBindingsOf(
  bindings: Readonly<Record<string, unknown>>,
): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {}
  for (const [semantic, value] of Object.entries(bindings)) {
    const ids: string[] = []
    const push = (binding: unknown): void => {
      if (typeof binding === 'string') {
        if (binding !== '') ids.push(binding)
        return
      }
      if (binding !== null && typeof binding === 'object') {
        try {
          ids.push(controlBindingClipId(binding as never))
        } catch {
          // Tolerant: a malformed binding never blocks a compile
        }
      }
    }
    if (Array.isArray(value)) {
      for (const entry of value) push(entry)
    } else {
      push(value)
    }
    if (ids.length > 0) out[semantic] = ids
  }
  return out
}

/**
 * Pre-existing clip instances overlapping the script window, for warnings.
 * Includes placement members (they drive through their clip) and excludes
 * disabled instances (they never evaluate). The window is the instance's
 * visual span at its effective speed.
 */
function existingInstancesOf(
  engine: EnginePublic,
  root: SceneNode,
): AnimationScriptExistingInstance[] {
  const out: AnimationScriptExistingInstance[] = []
  const clipById = new Map(engine.clips.map((clip) => [clip.id, clip] as const))
  for (const node of walkPreOrder(root)) {
    let instances: readonly {
      clipId: string
      startTime: number
      speed: number
      enabled: boolean
    }[]
    try {
      instances = engine.getClipInstances(node.id)
    } catch {
      continue
    }
    for (const instance of instances) {
      if (instance.enabled === false) continue
      const clip = clipById.get(instance.clipId)
      if (!clip) continue
      const speed = Math.max(instance.speed, MIN_CLIP_SPEED)
      const end = speed === 0 ? instance.startTime : instance.startTime + clip.duration / speed
      out.push({ nodeId: node.id, clipId: clip.id, start: instance.startTime, end })
    }
  }
  return out
}

/**
 * Pre-existing active Controls (≥1 enabled keyframe), for warnings. Dormant
 * controls yield to raw keyframes and never warn; active ones win evaluation
 * precedence over the whole slide once keyed, so any same-property script
 * write warns.
 */
function existingControlsOf(
  engine: EnginePublic,
  root: SceneNode,
): AnimationScriptExistingControl[] {
  const out: AnimationScriptExistingControl[] = []
  for (const node of walkPreOrder(root)) {
    const controlSet = node.controlSet
    if (!controlSet) continue
    for (const control of controlSet.controls) {
      let track: readonly { disabled?: boolean }[]
      try {
        track = engine.getKeyframesOf({ kind: 'control', nodeId: node.id, controlKey: control.key })
      } catch {
        continue
      }
      if (track.some((keyframe) => keyframe.disabled !== true)) {
        out.push({ hostId: node.id, key: control.key })
      }
    }
  }
  return out
}

/**
 * The material parameters a write may address by name: the node's material
 * definition parameters plus the built-ins every material resolves. Sampler
 * kinds stay out of the write surface and keep their default value as pins.
 */
function materialParametersOf(
  engine: EnginePublic,
  node: SceneNode,
): AnimationScriptMaterialParameterInfo[] {
  const parameters = new Map<string, string>()
  for (const parameter of DEFAULT_MATERIAL_PARAMETERS) {
    parameters.set(parameter.key, parameter.kind)
  }
  const definition = engine.getMaterialDefinition(node.material.materialDefinitionId)
  for (const parameter of definition.parameters) {
    if (parameter.key === RESERVED_TIME_UNIFORM) continue
    parameters.set(parameter.key, parameter.kind)
  }
  return [...parameters.entries()].map(([key, kind]) => ({ key, kind }))
}

function evaluateProperty(
  engine: EnginePublic,
  nodeId: string,
  property: ScriptProperty,
  time: number,
): number {
  if (property === 'zIndex') {
    return engine.evaluateZIndex(nodeId, time)
  }
  if (isScriptTableProperty(property)) {
    const table = engine.evaluateTable(nodeId, time)
    if (!table) {
      throw new Error(`Node "${nodeId}" cannot evaluate ${property} without a table or cell`)
    }
    return table[property]
  }
  const state = engine.evaluateNode(nodeId, time)
  switch (property) {
    case 'x':
      return state.transform.x
    case 'y':
      return state.transform.y
    case 'rotation':
      return state.transform.rotation
    case 'scaleX':
      return state.transform.scaleX
    case 'scaleY':
      return state.transform.scaleY
    case 'opacity':
      return state.opacity
  }
}

/**
 * The pre-clear value of any written track: the same value the evaluator shows
 * for the current scene state at `time`. Shadow tracks read their own raw
 * keyframes (the shadow evaluator composes alpha with node opacity, which a
 * track pin must not capture).
 */
function evaluateTrackValue(
  engine: EnginePublic,
  reads: AnimationScriptReadSource,
  nodeId: string,
  track: ScriptTrack,
  time: number,
): ScriptTrackValue {
  switch (track.kind) {
    case 'node':
      return track.property === 'zIndex'
        ? engine.evaluateZIndex(nodeId, time)
        : evaluateProperty(engine, nodeId, track.property, time)
    case 'parameter': {
      const value = engine.evaluateMaterialOverrides(nodeId, time)[track.parameter]
      if (value !== undefined) return value as ScriptTrackValue
      const definition = engine.getMaterialDefinition(
        engine.getNode(nodeId).material.materialDefinitionId,
      )
      for (const parameter of definition.parameters) {
        if (parameter.key === track.parameter) return parameter.default as ScriptTrackValue
      }
      if (track.parameter === TINT_PARAMETER_KEY) return DEFAULT_TINT
      if (track.parameter === OPACITY_MULTIPLIER_PARAMETER_KEY) return DEFAULT_OPACITY_MULTIPLIER
      return 0
    }
    case 'circle': {
      const state = engine.evaluateCircle(nodeId, time)
      return state ? state[track.property] : 0
    }
    case 'table': {
      const state = engine.evaluateTable(nodeId, time)
      return state ? state[track.property] : 0
    }
    case 'morph': {
      const value = engine.evaluateMorphValue(nodeId, time)
      if (value) return value
      const binding = engine.getMorphBinding(nodeId)
      return {
        fromShapeId: binding?.fromShapeId ?? null,
        toShapeId: binding?.toShapeId ?? null,
        coefficient: engine.evaluateMorph(nodeId, time),
      }
    }
    case 'symmetry':
      return engine.evaluateSymmetry(nodeId, time) ?? { axis: 'x', factor: 0 }
    case 'shadow': {
      const raw = evaluateRawTrack(engine.getShadowKeyframes(nodeId, track.property), time)
      if (raw !== null) return raw
      const effect = engine.getShadowEffect(nodeId) ?? DEFAULT_SHADOW_EFFECT
      return effect[track.property] as ScriptTrackValue
    }
    case 'dataLabel':
      return engine.evaluateDataLabels(nodeId, time).get(track.label) ?? 0
    case 'control':
      return reads.controlValue(nodeId, track.controlKey, time)
  }
}

/**
 * Evaluate a track's own keyframes at `time`: last value hold, segment
 * interpolation otherwise. Numeric tracks use the evaluator's segment
 * interpolators; color strings lerp like the shadow evaluator.
 */
function evaluateRawTrack(keyframes: readonly Keyframe[], time: number): ScriptTrackValue | null {
  const enabled = keyframes.filter(
    (keyframe) => (keyframe as unknown as { disabled?: boolean }).disabled !== true,
  )
  if (enabled.length === 0) return null
  const first = enabled[0]
  if (time <= first.time) return first.value as ScriptTrackValue
  const last = enabled[enabled.length - 1]
  if (time >= last.time) return last.value as ScriptTrackValue
  for (let index = 0; index < enabled.length - 1; index += 1) {
    const from = enabled[index]
    const to = enabled[index + 1]
    if (to.time > from.time && time >= from.time && time < to.time) {
      if (typeof from.value === 'number' && typeof to.value === 'number') {
        return evaluateSegment(from, to, time)
      }
      if (typeof from.value === 'string' && typeof to.value === 'string') {
        if (from.interpolation === 'hold') return from.value
        return lerpHexColor(from.value, to.value, (time - from.time) / (to.time - from.time))
      }
      return (from.interpolation === 'hold' ? from.value : to.value) as ScriptTrackValue
    }
  }
  return last.value as ScriptTrackValue
}
