import type { EnginePublic } from '../engine'
import type { SceneNode } from '../engine'
import type { Command } from '../engine/commands'
import { ReorderNodeCommand, ReparentNodeCommand, TransactionCommand } from '../engine/commands'
import type { DispatchCommand } from '../engine/commands'
import { walkPreOrder } from '../engine/sceneNode'

export interface HierarchyMoveInput {
  readonly targets: readonly string[]
  readonly parentId: string
  /** Slot at which the dragged group starts in the target parent's non-dragged children. */
  readonly index: number
}

export function applyHierarchyMove(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  input: HierarchyMoveInput,
): void {
  const parent = safeGetNode(engine, input.parentId)
  if (!parent || parent.components.camera) {
    return
  }
  const group = moveGroup(engine, parent, input.targets)
  if (group.length === 0) {
    return
  }
  const commands = buildCommands(parent, group, input.index)
  if (commands.length === 0) {
    return
  }
  dispatch(new TransactionCommand(commands))
}

function safeGetNode(engine: EnginePublic, nodeId: string): SceneNode | null {
  try {
    return engine.getNode(nodeId)
  } catch {
    return null
  }
}

function sceneRootOf(node: SceneNode): SceneNode {
  let root = node
  while (root.parent !== null) {
    root = root.parent
  }
  return root
}

function moveGroup(
  engine: EnginePublic,
  parent: SceneNode,
  targets: readonly string[],
): SceneNode[] {
  const scene = new Set(walkPreOrder(sceneRootOf(parent)))
  const wanted = new Map<string, SceneNode>()
  for (const nodeId of targets) {
    const node = safeGetNode(engine, nodeId)
    if (!node || node === parent) {
      continue
    }
    if (node.parent === null || node.components.camera) {
      continue
    }
    if (!scene.has(node)) {
      continue
    }
    wanted.set(nodeId, node)
  }
  const group: SceneNode[] = []
  for (const node of walkPreOrder(sceneRootOf(parent))) {
    if (!wanted.has(node.id)) {
      continue
    }
    if (hasDraggedAncestor(node, wanted)) {
      continue
    }
    group.push(node)
  }
  return group
}

function hasDraggedAncestor(node: SceneNode, wanted: ReadonlyMap<string, SceneNode>): boolean {
  for (let cursor = node.parent; cursor !== null; cursor = cursor.parent) {
    if (wanted.has(cursor.id)) {
      return true
    }
  }
  return false
}

function buildCommands(
  parent: SceneNode,
  group: readonly SceneNode[],
  index: number,
): Command<unknown>[] {
  const children = [...parent.children]
  const groupIds = new Set(group.map((node) => node.id))
  const boundary = children[0]?.components.camera ? 1 : 0
  const after = reducedElementAt(children, groupIds, index)
  const live = [...parent.children]
  const commands: Command<unknown>[] = []

  for (let i = group.length - 1; i >= 0; i -= 1) {
    const node = group[i]
    const successor = i < group.length - 1 ? group[i + 1] : after
    if (node.parent === parent) {
      const current = live.indexOf(node)
      let target: number
      if (successor === undefined) {
        target = live.length - 1
      } else {
        const successorIndex = live.indexOf(successor)
        target = successorIndex - (successorIndex > current ? 1 : 0)
      }
      target = Math.max(target, boundary)
      if (target !== current) {
        commands.push(new ReorderNodeCommand({ nodeId: node.id, index: target }))
        live.splice(current, 1)
        live.splice(target, 0, node)
      }
    } else {
      const target = Math.max(
        successor === undefined ? live.length : live.indexOf(successor),
        boundary,
      )
      commands.push(
        new ReparentNodeCommand({ nodeId: node.id, parentId: parent.id, index: target }),
      )
      live.splice(target, 0, node)
    }
  }
  return commands
}

function reducedElementAt(
  children: readonly SceneNode[],
  groupIds: ReadonlySet<string>,
  position: number,
): SceneNode | undefined {
  let seen = 0
  for (const child of children) {
    if (groupIds.has(child.id)) {
      continue
    }
    if (seen === position) {
      return child
    }
    seen += 1
  }
  return undefined
}
