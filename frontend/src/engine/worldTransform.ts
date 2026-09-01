import type { EnginePublic } from './engine'
import type { Scene } from './scene'
import type { SceneNode } from './sceneNode'
import type { Transform } from './transform'
import type { EvaluatedNodeScratch } from './animationEvaluator'
import { evaluatedNodeScratch } from './animationEvaluator'
import type { IKManager } from './ikManager'
import { solveTwoBoneIK, solveCCDIK } from './ikSolver'
import type { ConstraintManager } from './constraintManager'
import { applyConstraints } from './constraintEvaluator'

export interface WorldTransform {
  readonly x: number
  readonly y: number
  readonly rotation: number
  readonly scaleX: number
  readonly scaleY: number
}

export function worldTransformOf(scene: Scene, nodeId: string): WorldTransform | null {
  const node = scene.getNode(nodeId)
  if (!node) {
    return null
  }
  if (!node._worldTransformDirty && node._cachedWorldTransform) {
    return node._cachedWorldTransform
  }
  const result = composeChain(chainOf(node), (link) => link.transform)
  node._worldTransformDirty = false
  node._cachedWorldTransform = result
  return result
}

export function evaluatedWorldTransformOf(
  engine: EnginePublic,
  nodeId: string,
  time: number,
): WorldTransform | null {
  let node: SceneNode
  try {
    node = engine.getNode(nodeId)
  } catch {
    return null
  }
  return composeChain(chainOf(node), (link) => engine.evaluateNode(link.id, time).transform)
}

function chainOf(node: SceneNode): SceneNode[] {
  const chain: SceneNode[] = []
  for (let cursor: SceneNode | null = node; cursor !== null; cursor = cursor.parent) {
    chain.push(cursor)
  }
  chain.reverse()
  return chain
}

export class EvaluatedWorldTransformSource {
  readonly #engine: EnginePublic
  readonly #getTime: () => number
  readonly #previews: ReadonlyMap<string, { readonly x: number; readonly y: number }>
  readonly #ikManager: IKManager | null
  readonly #constraintManager: ConstraintManager | null
  readonly #scratch: EvaluatedNodeScratch = evaluatedNodeScratch()
  readonly #chain: SceneNode[] = []
  #time = 0
  readonly #ikOverrides = new Map<string, number>()
  readonly #localOf = (link: SceneNode): Transform => {
    const local = this.#engine.evaluateNode(link.id, this.#time, this.#scratch).transform
    const overrideRotation = this.#ikOverrides.get(link.id)
    const preview = this.#previews.get(link.id)
    if (overrideRotation !== undefined && preview) {
      return { ...local, rotation: overrideRotation, x: preview.x, y: preview.y }
    }
    if (overrideRotation !== undefined) {
      return { ...local, rotation: overrideRotation }
    }
    if (preview) {
      return { ...local, x: preview.x, y: preview.y }
    }
    return local
  }

  constructor(
    engine: EnginePublic,
    getTime: () => number,
    previews: ReadonlyMap<string, { readonly x: number; readonly y: number }> = new Map(),
    ikManager: IKManager | null = null,
    constraintManager: ConstraintManager | null = null,
  ) {
    this.#engine = engine
    this.#getTime = getTime
    this.#previews = previews
    this.#ikManager = ikManager
    this.#constraintManager = constraintManager
  }

  /**
   * Compute IK overrides for all IK chains in the given slide at the given time.
   * Must be called before transformOf to apply IK rotations.
   */
  updateIKOverrides(slideId: string, time: number): void {
    this.#ikOverrides.clear()
    if (!this.#ikManager) {
      return
    }
    const chains = this.#ikManager.getChainsForSlide(slideId)
    for (const chain of chains) {
      // Resolve target position (if attached to node, evaluate its world position)
      let targetWorld = chain.target.position
      if (chain.target.nodeId) {
        const targetWorldTransform = evaluatedWorldTransformOf(
          this.#engine,
          chain.target.nodeId,
          time,
        )
        if (targetWorldTransform) {
          targetWorld = { x: targetWorldTransform.x, y: targetWorldTransform.y }
        }
      }
      // Resolve pole target position (if attached to node, evaluate its world position)
      let poleWorld: { readonly x: number; readonly y: number } | null =
        chain.poleTarget?.position ?? null
      if (chain.poleTarget?.nodeId) {
        const poleWorldTransform = evaluatedWorldTransformOf(
          this.#engine,
          chain.poleTarget.nodeId,
          time,
        )
        if (poleWorldTransform) {
          poleWorld = { x: poleWorldTransform.x, y: poleWorldTransform.y }
        }
      } else if (chain.poleGhostNodeId) {
        // Legacy: pole ghost stored separately, resolve similarly
        const poleWorldTransform = evaluatedWorldTransformOf(
          this.#engine,
          chain.poleGhostNodeId,
          time,
        )
        if (poleWorldTransform) {
          poleWorld = { x: poleWorldTransform.x, y: poleWorldTransform.y }
        } else if (chain.poleTarget?.position) {
          poleWorld = chain.poleTarget.position
        }
      }
      // Get bone nodes and their lengths
      const boneNodes: SceneNode[] = []
      const boneLengths: number[] = []
      for (const boneId of chain.boneIds) {
        const node = this.#engine.getNode(boneId)
        boneNodes.push(node)
        boneLengths.push(node.components.bone?.length ?? 100)
      }
      // Create a function to get local transform of a node (without IK overrides)
      const getLocalTransform = (nodeId: string): Transform => {
        return this.#engine.evaluateNode(nodeId, time).transform
      }
      // Solve IK
      let solution
      if (chain.chainLength === 2) {
        solution = solveTwoBoneIK(boneNodes, targetWorld, poleWorld, getLocalTransform, boneLengths)
      } else {
        solution = solveCCDIK(boneNodes, targetWorld, poleWorld, getLocalTransform, boneLengths)
      }
      // Store rotations for each bone
      for (let i = 0; i < boneNodes.length; i++) {
        this.#ikOverrides.set(boneNodes[i].id, solution.rotations[i])
      }
    }
  }

  /** Returns the IK rotation override for a bone node, or undefined if none. */
  getIKRotationOverride(nodeId: string): number | undefined {
    return this.#ikOverrides.get(nodeId)
  }

  /** Returns all current IK rotation overrides. */
  getIKOverrides(): ReadonlyMap<string, number> {
    return this.#ikOverrides
  }

  transformOf(nodeId: string): WorldTransform | null {
    let node: SceneNode
    try {
      node = this.#engine.getNode(nodeId)
    } catch {
      return null
    }
    const time = this.#getTime()
    if (!Number.isFinite(time)) {
      return null
    }
    this.#time = time
    this.#chain.length = 0
    for (let cursor: SceneNode | null = node; cursor !== null; cursor = cursor.parent) {
      this.#chain.push(cursor)
    }
    this.#chain.reverse()
    let worldTransform = composeChain(this.#chain, this.#localOf)
    // Apply constraints if any
    if (this.#constraintManager) {
      const constraints = this.#constraintManager.getConstraintsForNode(nodeId)
      if (constraints.length > 0) {
        worldTransform = applyConstraints(worldTransform, constraints, {
          nodeLookup: (id) => this.#engine.getNode(id),
          worldTransformLookup: (id) => this.transformOf(id),
        })
      }
    }
    return worldTransform
  }
}

function composeChain(
  chain: readonly SceneNode[],
  localOf: (node: SceneNode) => Transform,
): WorldTransform {
  let x = 0
  let y = 0
  let rotation = 0
  let scaleX = 1
  let scaleY = 1
  for (const link of chain) {
    const local = localOf(link)
    x += rotateX(local.x * scaleX, local.y * scaleY, rotation)
    y += rotateY(local.x * scaleX, local.y * scaleY, rotation)
    rotation += local.rotation
    scaleX *= local.scaleX
    scaleY *= local.scaleY
  }
  return { x, y, rotation, scaleX, scaleY }
}

export function relativeTransform(
  world: WorldTransform,
  parentWorld: WorldTransform,
): Transform | null {
  if (parentWorld.scaleX === 0 || parentWorld.scaleY === 0) {
    return null
  }
  const dx = world.x - parentWorld.x
  const dy = world.y - parentWorld.y
  return {
    x: rotateX(dx, dy, -parentWorld.rotation) / parentWorld.scaleX,
    y: rotateY(dx, dy, -parentWorld.rotation) / parentWorld.scaleY,
    rotation: world.rotation - parentWorld.rotation,
    scaleX: world.scaleX / parentWorld.scaleX,
    scaleY: world.scaleY / parentWorld.scaleY,
  }
}

export function transformsEqual(a: Transform, b: Transform): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.rotation === b.rotation &&
    a.scaleX === b.scaleX &&
    a.scaleY === b.scaleY
  )
}

export function rotateX(x: number, y: number, rotation: number): number {
  return x * Math.cos(rotation) - y * Math.sin(rotation)
}

export function rotateY(x: number, y: number, rotation: number): number {
  return x * Math.sin(rotation) + y * Math.cos(rotation)
}
