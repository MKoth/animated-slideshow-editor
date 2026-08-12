import type { EngineReadOnly } from '../engine'
import type { SceneNode } from '../engine'
import type { DispatchCommand } from '../engine/commands'
import { ChangeZOrderCommand } from '../engine/commands'
import type { ZOrderMode } from '../engine/commands'
import { zOrderTargetsReversed } from '../engine/commands'
import { walkPreOrder } from '../engine/sceneNode'
import { useSelectionStore } from '../stores/selectionStore'

export const Z_ORDER_ITEMS = [
  { label: 'Bring Forward', mode: 'bringForward' },
  { label: 'Send Backward', mode: 'sendBackward' },
  { label: 'Bring To Front', mode: 'bringToFront' },
  { label: 'Send To Back', mode: 'sendToBack' },
] as const

export const Z_ORDER_BY_LABEL = new Map<string, ZOrderMode>(
  Z_ORDER_ITEMS.map((item) => [item.label, item.mode]),
)

export function applyZOrder(
  engine: EngineReadOnly,
  dispatch: DispatchCommand,
  mode: ZOrderMode,
): void {
  for (const nodeId of zOrderTargets(engine, mode)) {
    if (!ChangeZOrderCommand.canApply(engine, nodeId, mode)) {
      continue
    }
    dispatch(new ChangeZOrderCommand({ nodeId, mode }))
  }
}

export function canApplyZOrder(engine: EngineReadOnly, mode: ZOrderMode): boolean {
  const selected = new Set(useSelectionStore.getState().selectedIds)
  for (const node of liveNodes(engine)) {
    if (selected.has(node.id) && ChangeZOrderCommand.canApply(engine, node.id, mode)) {
      return true
    }
  }
  return false
}

function zOrderTargets(engine: EngineReadOnly, mode: ZOrderMode): string[] {
  const selected = new Set(useSelectionStore.getState().selectedIds)
  const targets: string[] = []
  for (const slide of engine.project?.slides ?? []) {
    for (const node of walkPreOrder(slide.scene.root)) {
      if (selected.has(node.id)) {
        targets.push(node.id)
      }
    }
  }
  if (zOrderTargetsReversed(mode)) {
    targets.reverse()
  }
  return targets
}

function liveNodes(engine: EngineReadOnly): SceneNode[] {
  const nodes: SceneNode[] = []
  for (const slide of engine.project?.slides ?? []) {
    for (const node of walkPreOrder(slide.scene.root)) {
      nodes.push(node)
    }
  }
  return nodes
}
