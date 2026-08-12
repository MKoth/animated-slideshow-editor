import type { Engine, EngineReadOnly } from '../internal'
import type { SceneNode } from '../sceneNode'
import type { Command } from './command'

export const Z_ORDER_MODES = ['bringForward', 'sendBackward', 'bringToFront', 'sendToBack'] as const
export type ZOrderMode = (typeof Z_ORDER_MODES)[number]

export interface ChangeZOrderParameters {
  readonly nodeId: string
  readonly mode: ZOrderMode
}

export interface ChangeZOrderInverse {
  readonly nodeId: string
  readonly parentId: string
  readonly oldIndex: number
}

function backBoundary(children: readonly SceneNode[]): number {
  return children[0]?.components.camera ? 1 : 0
}

function isForward(mode: ZOrderMode): boolean {
  return mode === 'bringForward' || mode === 'bringToFront'
}

function isNoOp(mode: ZOrderMode, children: readonly SceneNode[], index: number): boolean {
  if (isForward(mode)) {
    return index >= children.length - 1
  }
  return index <= backBoundary(children)
}

function targetIndex(mode: ZOrderMode, children: readonly SceneNode[], index: number): number {
  const back = backBoundary(children)
  switch (mode) {
    case 'bringForward':
      return index + 1
    case 'sendBackward':
      return index - 1
    case 'bringToFront':
      return children.length - 1
    case 'sendToBack':
      return back
  }
}

export function zOrderTargetsReversed(mode: ZOrderMode): boolean {
  return mode === 'bringForward' || mode === 'sendToBack'
}

export class ChangeZOrderCommand implements Command<ChangeZOrderInverse> {
  readonly type = 'ChangeZOrder'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #mode: ZOrderMode

  constructor(input: ChangeZOrderParameters) {
    this.#nodeId = input.nodeId
    this.#mode = input.mode
    this.parameters = { nodeId: input.nodeId, mode: input.mode }
  }

  static canApply(engine: EngineReadOnly, nodeId: string, mode: ZOrderMode): boolean {
    const node = engine.getNode(nodeId)
    const parent = node.parent
    if (!parent || node.components.camera) {
      return false
    }
    return !isNoOp(mode, parent.children, parent.children.indexOf(node))
  }

  validate(engine: Engine): void {
    if (!(Z_ORDER_MODES as readonly string[]).includes(this.#mode)) {
      throw new Error(`Unknown z-order mode: "${this.#mode}"`)
    }
    const node = engine.getNode(this.#nodeId)
    const parent = node.parent
    if (!parent) {
      throw new Error('The root node cannot be reordered')
    }
    if (node.components.camera) {
      throw new Error('The camera node cannot be reordered')
    }
    const index = parent.children.indexOf(node)
    if (isNoOp(this.#mode, parent.children, index)) {
      throw new Error(
        `Node "${node.name}" is already at the ${isForward(this.#mode) ? 'front' : 'back'}`,
      )
    }
  }

  execute(engine: Engine): ChangeZOrderInverse {
    const node = engine.getNode(this.#nodeId)
    const parent = node.parent
    if (!parent) {
      throw new Error('The root node cannot be reordered')
    }
    if (node.components.camera) {
      throw new Error('The camera node cannot be reordered')
    }
    const current = parent.children.indexOf(node)
    engine.reorderNode(this.#nodeId, targetIndex(this.#mode, parent.children, current))
    return { nodeId: this.#nodeId, parentId: parent.id, oldIndex: current }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
