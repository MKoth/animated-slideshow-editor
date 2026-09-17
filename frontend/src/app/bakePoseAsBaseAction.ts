import type { EnginePublic } from '../engine'
import type { Command, DispatchCommand, UndoStack } from '../engine/commands'
import {
  MoveNodeCommand,
  OverrideMaterialParameterCommand,
  RotateNodeCommand,
  ScaleNodeCommand,
  SetCircleComponentCommand,
  SetOpacityCommand,
  SetShadowParamCommand,
  SetTableCellComponentCommand,
  SetTableComponentCommand,
  SetVisibilityCommand,
  SetZIndexCommand,
} from '../engine/commands'
import { resolveCircleSegments } from '../engine/circleComponent'
import { uniformValuesEqual } from '../engine/materialResolution'
import { isGroupNode, walkPreOrder } from '../engine/sceneNode'
import type { SceneNode } from '../engine/sceneNode'
import {
  SHADOW_LIGHT_PROPERTIES,
  SHADOW_RAW_PROPERTIES,
  SHADOW_SHARED_PROPERTIES,
  isAutoShadowEffect,
} from '../engine/shadowEffect'
import type { ShadowProperty } from '../engine/shadowEffect'
import { formatTimeCode } from '../stores/playbackStore'
import { mergeUndoRecords } from './undoMerge'

interface BakePoseAsBaseOptions {
  /** Subtree roots to bake; nested/duplicate ids are collapsed to the outermost. */
  readonly rootNodeIds: readonly string[]
  /** Playhead time on the active slide (engine truth, not modal preview state). */
  readonly time: number
}

export type BakePoseAsBaseResult =
  | {
      readonly ok: true
      readonly message: string
      readonly bakedNodeCount: number
      /** Number of rest values rewritten across all baked nodes. */
      readonly valueCount: number
      /** Animated state with no rest counterpart, reported so nothing is silent. */
      readonly skipped: readonly string[]
    }
  | { readonly ok: false; readonly error: string }

const EPSILON = 1e-9

interface BakeReport {
  skip(message: string): void
  record(): void
}

function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > EPSILON
}

function findOwningTable(node: SceneNode): SceneNode | null {
  for (let parent: SceneNode | null = node.parent; parent; parent = parent.parent) {
    if (parent.components.table) return parent
  }
  return null
}

/**
 * Rewrite every rest value this node can represent with its evaluated
 * counterpart. Returns the number of values rewritten, and reports animated
 * state that has no rest counterpart (morph amount, symmetry, data labels)
 * through `report` instead of dropping it silently.
 */
function bakeNode(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  node: SceneNode,
  time: number,
  report: BakeReport,
): number {
  let changed = 0
  const run = (command: Command<unknown>, label: string): void => {
    const result = dispatch(command)
    if (!result.ok) {
      report.skip(`"${node.name}" ${label} failed (${result.error.message})`)
      return
    }
    report.record()
    changed += 1
  }

  const evaluated = engine.evaluateNode(node.id, time)

  if (
    differs(evaluated.transform.x, node.transform.x) ||
    differs(evaluated.transform.y, node.transform.y)
  ) {
    run(
      new MoveNodeCommand({
        nodeId: node.id,
        x: evaluated.transform.x,
        y: evaluated.transform.y,
      }),
      'position',
    )
  }
  if (differs(evaluated.transform.rotation, node.transform.rotation)) {
    run(
      new RotateNodeCommand({ nodeId: node.id, rotation: evaluated.transform.rotation }),
      'rotation',
    )
  }
  if (
    differs(evaluated.transform.scaleX, node.transform.scaleX) ||
    differs(evaluated.transform.scaleY, node.transform.scaleY)
  ) {
    if (isGroupNode(node) && differs(evaluated.transform.scaleX, evaluated.transform.scaleY)) {
      report.skip(`"${node.name}" non-uniform group scale cannot be baked (groups stay uniform)`)
    } else {
      run(
        new ScaleNodeCommand({
          nodeId: node.id,
          scaleX: evaluated.transform.scaleX,
          scaleY: evaluated.transform.scaleY,
        }),
        'scale',
      )
    }
  }
  if (differs(evaluated.opacity, node.opacity)) {
    run(new SetOpacityCommand({ nodeId: node.id, opacity: evaluated.opacity }), 'opacity')
  }
  if (evaluated.visible !== node.visible) {
    run(new SetVisibilityCommand({ nodeId: node.id, visible: evaluated.visible }), 'visibility')
  }
  const zIndex = engine.evaluateZIndex(node.id, time)
  if (zIndex !== node.zIndex) {
    run(new SetZIndexCommand({ nodeId: node.id, zIndex }), 'zIndex')
  }

  const overrides = engine.evaluateMaterialOverrides(node.id, time)
  for (const [parameter, next] of Object.entries(overrides)) {
    if (uniformValuesEqual(node.material.overrides[parameter], next)) continue
    run(
      new OverrideMaterialParameterCommand({ nodeId: node.id, parameter, value: next }),
      `material "${parameter}"`,
    )
  }

  const circle = engine.evaluateCircle(node.id, time)
  const restCircle = node.components.circle
  if (circle && restCircle) {
    const segmentsChanged = resolveCircleSegments(restCircle) !== circle.segments
    if (
      differs(restCircle.radius, circle.radius) ||
      differs(restCircle.startAngle, circle.startAngle) ||
      differs(restCircle.endAngle, circle.endAngle) ||
      segmentsChanged
    ) {
      run(
        new SetCircleComponentCommand({
          nodeId: node.id,
          circle: {
            kind: 'circle',
            radius: circle.radius,
            startAngle: circle.startAngle,
            endAngle: circle.endAngle,
            segments: circle.segments,
          },
        }),
        'circle',
      )
    }
  }

  const table = engine.evaluateTable(node.id, time)
  if (table && node.components.table) {
    const restTable = node.components.table
    if (
      differs(restTable.borderRadius ?? 0, table.borderRadius) ||
      differs(restTable.padding ?? 0, table.padding)
    ) {
      run(
        new SetTableComponentCommand({
          nodeId: node.id,
          table: { ...restTable, borderRadius: table.borderRadius, padding: table.padding },
        }),
        'table',
      )
    }
  } else if (table && node.components.tableCell) {
    const restCell = node.components.tableCell
    const owningTable = findOwningTable(node)?.components.table
    const baseBorderRadius = restCell.borderRadius ?? owningTable?.borderRadius ?? 0
    const basePadding = restCell.padding ?? owningTable?.padding ?? 0
    if (differs(baseBorderRadius, table.borderRadius) || differs(basePadding, table.padding)) {
      run(
        new SetTableCellComponentCommand({
          nodeId: node.id,
          tableCell: { ...restCell, borderRadius: table.borderRadius, padding: table.padding },
        }),
        'table cell',
      )
    }
  }

  const shadow = engine.evaluateShadow(node.id, time)
  const restShadow = node.shadowEffect
  if (shadow && restShadow) {
    // Auto effects re-derive the raw 7 DOF from anchor+light, so only the light
    // and shared properties have their own rest value; manual effects evaluate
    // the raw 7 DOF directly.
    const properties: readonly ShadowProperty[] = isAutoShadowEffect(restShadow)
      ? [...SHADOW_LIGHT_PROPERTIES, ...SHADOW_SHARED_PROPERTIES]
      : [...SHADOW_RAW_PROPERTIES, ...SHADOW_SHARED_PROPERTIES]
    for (const property of properties) {
      if (property === 'opacity') {
        // Evaluated shadow opacity folds in (and clamps) node opacity, so the
        // rest value is recovered by dividing it back out. Inexact only where
        // the folded product was clamped, i.e. the pose is not representable.
        if (evaluated.opacity > EPSILON) {
          const restOpacity = Math.min(1, Math.max(0, shadow.opacity / evaluated.opacity))
          if (differs(restOpacity, restShadow.opacity)) {
            run(
              new SetShadowParamCommand({ nodeId: node.id, property, value: restOpacity }),
              'shadow opacity',
            )
          }
        } else if (shadow.opacity > EPSILON) {
          report.skip(`"${node.name}" shadow opacity cannot be rebased while node opacity is 0`)
        }
        continue
      }
      const current = restShadow[property]
      const next = shadow[property] as number | string | undefined
      if (current === next || next === undefined) continue
      run(
        new SetShadowParamCommand({ nodeId: node.id, property, value: next }),
        `shadow ${property}`,
      )
    }
  }

  if (engine.evaluateMorphValue(node.id, time) !== null) {
    report.skip(`"${node.name}" morph amount has no rest value`)
  }
  if (engine.evaluateSymmetry(node.id, time) !== null) {
    report.skip(`"${node.name}" symmetry has no rest value`)
  }
  if (engine.evaluateDataLabels(node.id, time).size > 0) {
    report.skip(`"${node.name}" chart data labels are data-driven`)
  }
  return changed
}

/**
 * Bake the pose evaluated at `time` into the rest (base) transforms of the
 * selected subtrees, so parts have a stable base after clips end. Keyframes
 * and clip instances are kept (rebase, not freeze): animated frames evaluate
 * to the same pose, quiet regions fall back to the baked base instead of a
 * stale creation-time rest.
 *
 * Animated state with no rest counterpart (morph amount, symmetry, chart
 * data labels) is reported in `skipped`, never dropped silently.
 *
 * Caveat: layers that combine *on top of* the base (offset/gain-linked clip
 * channels, blended control layers) re-apply over the new base, so those parts
 * shift slightly after baking; keyframe and absolute-clip parts are exact.
 *
 * Leaf commands only, merged into one undo step (never merge Transactions).
 */
export function executeBakePoseAsBase(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  undoStack: UndoStack,
  options: BakePoseAsBaseOptions,
): BakePoseAsBaseResult {
  const { rootNodeIds, time } = options
  const skipped: string[] = []
  const roots: SceneNode[] = []
  const seen = new Set<string>()
  for (const nodeId of rootNodeIds) {
    if (seen.has(nodeId)) continue
    seen.add(nodeId)
    try {
      roots.push(engine.getNode(nodeId))
    } catch {
      skipped.push(`Node not found: ${nodeId}`)
    }
  }
  if (roots.length === 0) {
    return { ok: false, error: 'No bakeable subtree selected' }
  }
  const rootIds = new Set(roots.map((root) => root.id))
  const outermost = roots.filter((node) => {
    for (let cursor = node.parent; cursor; cursor = cursor.parent) {
      if (rootIds.has(cursor.id)) return false
    }
    return true
  })

  let records = 0
  let bakedNodeCount = 0
  let valueCount = 0
  const report: BakeReport = {
    skip: (message) => skipped.push(message),
    record: () => {
      records += 1
    },
  }
  for (const root of outermost) {
    for (const node of walkPreOrder(root)) {
      try {
        const changed = bakeNode(engine, dispatch, node, time, report)
        if (changed > 0) {
          bakedNodeCount += 1
          valueCount += changed
        }
      } catch (error) {
        skipped.push(
          `"${node.name}" bake failed (${error instanceof Error ? error.message : String(error)})`,
        )
      }
    }
  }

  mergeUndoRecords(undoStack, records)
  const bits: string[] = []
  if (bakedNodeCount === 0) {
    bits.push(`Nothing to bake — base already matches the pose at ${formatTimeCode(time)}`)
  } else {
    bits.push(
      `Baked pose at ${formatTimeCode(time)} into ${bakedNodeCount} node(s) (${valueCount} value(s))`,
    )
  }
  if (skipped.length > 0) {
    bits.push(`${skipped.length} skipped (${skipped.join('; ')})`)
  }
  return { ok: true, message: bits.join(' · '), bakedNodeCount, valueCount, skipped }
}
