import type { EnginePublic } from './engine'
import { evaluatedWorldTransformOf, localToWorldWithPivot } from './worldTransform'
import { walkPreOrder } from './sceneNode'
import { computeTableLayout } from './tableGridLayout'
import { evaluateControlTrack } from './control'

/**
 * A node's measured local size, as the renderer reports it: `offsetX`/`offsetY`
 * are the measured bounds centre relative to the node's transform position.
 * Text sizes come from the renderer's deterministic metric estimate, so a read
 * is the same determinism class as Video Export.
 */
export interface AnimationScriptNodeSize {
  readonly width: number
  readonly height: number
  readonly offsetX?: number
  readonly offsetY?: number
}

export type AnimationScriptMeasure = (nodeId: string) => AnimationScriptNodeSize | null

export interface AnimationScriptWorldRead {
  readonly x: number
  readonly y: number
  readonly rotation: number
}

export interface AnimationScriptBoundsRead {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export interface AnimationScriptRectRead {
  /** World position of the table-local rect's top-left corner. */
  readonly x: number
  readonly y: number
  /** Scaled local size. */
  readonly width: number
  readonly height: number
  /** The rect's world orientation, so a rotated table stays exact. */
  readonly rotation: number
}

/**
 * The compile-time read seam: every method is side-effect free and reports the
 * value the evaluator (or the renderer's measurement) reports for the current
 * scene state at `time`. No read writes engine state, so Check and Run read
 * identical values.
 */
export interface AnimationScriptReadSource {
  /** The node's evaluated world x, y and rotation at `time`. */
  world(nodeId: string, time: number): AnimationScriptWorldRead
  /**
   * The subtree-union world AABB of a node at `time`, or null when nothing in
   * the subtree is measurable. The box ignores rotation (it is the axis-aligned
   * box of the unrotated node) and uses renderer-measured sizes.
   */
  bounds(nodeId: string, time: number): AnimationScriptBoundsRead | null
  /**
   * The world-space rectangle of a Grid Slot cell composed with the table's
   * world transform at `time`: `x`/`y` are the mapped top-left corner,
   * `width`/`height` the scaled local size, and `rotation` the table's world
   * orientation, so a rotated table stays exact.
   */
  cellRect(tableNodeId: string, cellNodeId: string, time: number): AnimationScriptRectRead | null
  /** The exposed Control's evaluated value at `time`. */
  controlValue(nodeId: string, key: string, time: number): number
}

/** The renderer's fallback table width, matching `computeTableLayout` use. */
const DEFAULT_TABLE_WIDTH = 400

export function createAnimationScriptReads(
  engine: EnginePublic,
  measure?: AnimationScriptMeasure,
): AnimationScriptReadSource {
  return {
    world(nodeId, time) {
      const world = evaluatedWorldTransformOf(engine, nodeId, time)
      if (!world) {
        throw new Error(`Node "${nodeId}" has no world transform at ${time}s`)
      }
      return { x: world.x, y: world.y, rotation: world.rotation }
    },
    bounds(nodeId, time) {
      return subtreeBounds(engine, measure, nodeId, time)
    },
    cellRect(tableNodeId, cellNodeId, time) {
      return gridSlotRect(engine, tableNodeId, cellNodeId, time)
    },
    controlValue(nodeId, key, time) {
      return controlValueAt(engine, nodeId, key, time)
    },
  }
}

/**
 * Union the unrotated world boxes of every measurable node in the subtree. A
 * node with no measurement (an unloaded asset, a group) contributes nothing;
 * null means the whole subtree is unmeasurable.
 */
function subtreeBounds(
  engine: EnginePublic,
  measure: AnimationScriptMeasure | undefined,
  nodeId: string,
  time: number,
): AnimationScriptBoundsRead | null {
  const root = engine.getNode(nodeId)
  let union: AnimationScriptBoundsRead | null = null
  for (const node of walkPreOrder(root)) {
    const size = measure?.(node.id)
    if (!size) continue
    const world = evaluatedWorldTransformOf(engine, node.id, time)
    if (!world || world.scaleX === 0 || world.scaleY === 0) continue
    const halfWidth = Math.abs(size.width * world.scaleX) / 2
    const halfHeight = Math.abs(size.height * world.scaleY) / 2
    const centerX = world.x + (size.offsetX ?? 0) * world.scaleX
    const centerY = world.y + (size.offsetY ?? 0) * world.scaleY
    const rect: AnimationScriptBoundsRead = {
      minX: centerX - halfWidth,
      minY: centerY - halfHeight,
      maxX: centerX + halfWidth,
      maxY: centerY + halfHeight,
    }
    union = union === null ? rect : mergeBounds(union, rect)
  }
  return union
}

export function mergeBounds(
  a: AnimationScriptBoundsRead,
  b: AnimationScriptBoundsRead,
): AnimationScriptBoundsRead {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

/** The cell's table-local layout rect mapped through the table's world transform. */
function gridSlotRect(
  engine: EnginePublic,
  tableNodeId: string,
  cellNodeId: string,
  time: number,
): AnimationScriptRectRead | null {
  const tableNode = engine.getNode(tableNodeId)
  const table = tableNode.components.table
  if (!table) return null
  const layout = computeTableLayout(table, tableNode.children, DEFAULT_TABLE_WIDTH)
  const rect = layout.cellRects.get(cellNodeId)
  if (!rect) return null
  const world = evaluatedWorldTransformOf(engine, tableNodeId, time)
  if (!world) return null
  const pivot = tableNode.transform.localPivot
  const pivotOffset = pivot
    ? { x: pivot.x * layout.totalWidth, y: pivot.y * layout.totalHeight }
    : null
  const origin = localToWorldWithPivot(rect.x, rect.y, world, pivotOffset)
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width * world.scaleX,
    height: rect.height * world.scaleY,
    rotation: world.rotation,
  }
}

/**
 * The exposed Control's evaluated track value at `time`, clamped to the
 * control's range and falling back to its default when the track is empty. The
 * compiler validates that the control exists and is exposed before calling.
 */
function controlValueAt(engine: EnginePublic, nodeId: string, key: string, time: number): number {
  const node = engine.getNode(nodeId)
  const control = node.controlSet?.controls.find((entry) => entry.key === key)
  if (!control) return 0
  const track = engine.getKeyframesOf({ kind: 'control', nodeId, controlKey: key })
  const value = evaluateControlTrack(track, time, control.default)
  return Math.min(Math.max(value, control.min), control.max)
}
