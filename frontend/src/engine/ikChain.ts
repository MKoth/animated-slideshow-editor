import type { SceneNode } from './sceneNode'

export interface BoneIKTarget {
  readonly position: { readonly x: number; readonly y: number }
  readonly nodeId?: string // optional node to attach to (world-space)
}

export interface PoleTarget {
  readonly position: { readonly x: number; readonly y: number }
}

export class IKChain {
  readonly id: string
  readonly boneIds: readonly string[]
  target: BoneIKTarget
  poleTarget: PoleTarget | null

  constructor(
    id: string,
    boneIds: readonly string[],
    target: BoneIKTarget,
    poleTarget: PoleTarget | null = null,
  ) {
    this.id = id
    this.boneIds = boneIds
    this.target = target
    this.poleTarget = poleTarget
  }

  get rootBoneId(): string {
    return this.boneIds[0]
  }

  get endBoneId(): string {
    return this.boneIds[this.boneIds.length - 1]
  }

  get chainLength(): number {
    return this.boneIds.length
  }

  /**
   * Validate that the chain is a valid ancestor-descendant path.
   * @param nodeLookup function to retrieve node by id
   * @returns error message if invalid, null if valid
   */
  validate(nodeLookup: (nodeId: string) => SceneNode): string | null {
    if (this.boneIds.length < 2) {
      return 'IK chain must have at least 2 bones'
    }
    // Check that all nodes exist and have bone component
    const nodes: SceneNode[] = []
    for (const boneId of this.boneIds) {
      let node: SceneNode
      try {
        node = nodeLookup(boneId)
      } catch {
        return `Bone node "${boneId}" not found`
      }
      if (!node.components.bone) {
        return `Node "${boneId}" is not a bone`
      }
      nodes.push(node)
    }
    // Check ancestor-descendant path (each bone is a child of previous)
    for (let i = 0; i < nodes.length - 1; i++) {
      const parent = nodes[i]
      const child = nodes[i + 1]
      if (child.parent !== parent) {
        return `Bone "${child.id}" is not a child of bone "${parent.id}"`
      }
    }
    return null
  }

  toJSON(): IKChainJSON {
    return {
      id: this.id,
      boneIds: [...this.boneIds],
      target: { ...this.target },
      poleTarget: this.poleTarget ? { ...this.poleTarget } : null,
    }
  }

  static fromJSON(json: IKChainJSON): IKChain {
    return new IKChain(
      json.id,
      json.boneIds,
      { ...json.target },
      json.poleTarget ? { ...json.poleTarget } : null,
    )
  }
}

export interface IKChainJSON {
  readonly id: string
  readonly boneIds: readonly string[]
  readonly target: BoneIKTarget
  readonly poleTarget: PoleTarget | null
}
