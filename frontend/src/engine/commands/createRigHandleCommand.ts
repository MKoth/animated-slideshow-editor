import type { Engine } from '../internal'
import type { Command } from './command'
import type { Transform } from '../transform'
import { relativeTransform, transformsEqual, worldTransformOf } from '../worldTransform'
import { requireNonEmpty } from '../guards'

export interface CreateRigHandleParameters {
  readonly sceneId: string
  readonly name: string
  readonly childIds?: readonly string[]
  readonly parentId?: string
  readonly transform?: Transform
}

export interface CreateRigHandleInverse {
  readonly handleId: string
  readonly childReparents: readonly {
    readonly nodeId: string
    readonly oldParentId: string
    readonly oldTransform: Transform
  }[]
}

export class CreateRigHandleCommand implements Command<CreateRigHandleInverse> {
  readonly type = 'CreateRigHandle'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #sceneId: string
  readonly #name: string
  readonly #childIds: readonly string[]
  readonly #parentId: string | undefined
  readonly #transform: Transform | undefined

  constructor(input: CreateRigHandleParameters) {
    this.#sceneId = input.sceneId
    this.#name = input.name
    this.#childIds = input.childIds ? [...input.childIds] : []
    this.#parentId = input.parentId
    this.#transform = input.transform ? { ...input.transform } : undefined
    this.parameters = {
      sceneId: input.sceneId,
      name: input.name,
      ...(this.#childIds.length > 0 && { childIds: [...this.#childIds] }),
      ...(input.parentId !== undefined && { parentId: input.parentId }),
      ...(this.#transform !== undefined && { transform: this.#transform }),
    }
  }

  validate(engine: Engine): void {
    requireNonEmpty(this.#name, 'Rig handle name')
    const scene = engine.getScene(this.#sceneId)
    const handleParentId = this.#parentId ?? scene.root.id
    const handleParent = scene.getNode(handleParentId)
    if (!handleParent) {
      throw new Error(`Parent node not found: ${handleParentId}`)
    }
    const seen = new Set<string>()
    for (const childId of this.#childIds) {
      if (seen.has(childId)) {
        throw new Error(`Duplicate child id: ${childId}`)
      }
      seen.add(childId)
      const node = engine.getNode(childId)
      if (node.parent === null) {
        throw new Error('The root node cannot be grouped under a rig handle')
      }
      if (node.components.camera) {
        throw new Error('The camera node cannot be grouped under a rig handle')
      }
      const childScene = engine.getNodeScene(childId)
      if (childScene.id !== this.#sceneId) {
        throw new Error(`Child node "${childId}" belongs to a different scene`)
      }
      // Prevent grouping handle's own parent chain cycles not needed as handle not yet created
      // But check that child is not ancestor of handleParent (would form cycle after grouping)
      // Since handleParent is existing node, if child is ancestor of handleParent, then reparenting child under handle (which is child of handleParent) would create cycle
      // Detect: if handleParent is descendant of child
      let cursor: import('../sceneNode').SceneNode | null = handleParent
      while (cursor !== null) {
        if (cursor.id === childId) {
          throw new Error(
            `Grouping would create a cycle: child "${childId}" is ancestor of handle parent`,
          )
        }
        cursor = cursor.parent
      }
    }
  }

  execute(engine: Engine): CreateRigHandleInverse {
    const scene = engine.getScene(this.#sceneId)
    const handleParentId = this.#parentId ?? scene.root.id
    // Create empty group/locator node (only Transform)
    const handle = engine.createNode(this.#sceneId, handleParentId, this.#name, {
      ...(this.#transform !== undefined && { transform: this.#transform }),
    })
    const handleId = handle.id
    const handleWorld = worldTransformOf(scene, handleId)

    const childReparents: {
      nodeId: string
      oldParentId: string
      oldTransform: Transform
    }[] = []

    for (const childId of this.#childIds) {
      const node = engine.getNode(childId)
      // Skip if already child of handle (should not happen as handle just created)
      if (node.parent?.id === handleId) {
        continue
      }
      const oldParentId = node.parent ? node.parent.id : handleParentId
      const oldTransform: Transform = { ...node.transform }
      const oldWorld = worldTransformOf(scene, childId)
      // Reparent with Keep World semantics: preserve world position
      engine.reparentNode(childId, handleId)
      if (oldWorld && handleWorld) {
        const adjusted = relativeTransform(oldWorld, handleWorld)
        const current = engine.getNode(childId).transform
        if (adjusted && !transformsEqual(adjusted, current)) {
          engine.setTransform(childId, adjusted)
        }
      } else if (!oldWorld || !handleWorld) {
        // fallback: if world not computable, keep old local
        engine.setTransform(childId, oldTransform)
      }
      childReparents.push({ nodeId: childId, oldParentId, oldTransform })
    }

    return { handleId, childReparents }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
