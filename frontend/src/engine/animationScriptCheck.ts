import type { EnginePublic } from './engine'
import { walkPreOrder } from './sceneNode'
import { compileAnimationScript, isScriptTableProperty } from './animationScriptCompiler'
import type {
  AnimationScriptCompileResult,
  AnimationScriptNodeInfo,
  ScriptProperty,
} from './animationScriptCompiler'
import { createAnimationScriptReads } from './animationScriptReads'
import type { AnimationScriptMeasure } from './animationScriptReads'

export interface AnimationScriptCheckOptions {
  /**
   * The renderer's measured node sizes, used by `bounds(...)`. Omitted in a
   * headless compile, where bounds report no measurable geometry.
   */
  readonly measure?: AnimationScriptMeasure
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
        })),
      }),
    })
  }
  return compileAnimationScript(source, {
    slideDuration: slide.duration,
    nodes,
    evaluateProperty: (nodeId, property, time) => evaluateProperty(engine, nodeId, property, time),
    reads: createAnimationScriptReads(engine, options.measure),
  })
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
