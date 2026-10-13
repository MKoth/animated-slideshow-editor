import type { ClipCollectionJSON, ClipJSON, LessonJSON, NodeJSON } from '../engine/json'
import type { ShapeJSON } from '../engine/shape'
import type { AiProposal } from '../api/aiApi'

/** A reviewed, project-scoped mutation of a reusable animation asset. */
export type AnimationAssetOperation =
  | {
      readonly kind: 'upsertShape'
      readonly action: 'create' | 'update'
      readonly targetId?: string
      readonly sourceShapeId?: string
      readonly nodeId: string
      readonly shape: ShapeJSON
    }
  | { readonly kind: 'deleteShape'; readonly nodeId: string; readonly shapeId: string }
  | {
      readonly kind: 'upsertClip'
      readonly action: 'create' | 'update'
      readonly targetId?: string
      readonly clip: ClipJSON
      readonly nodeId?: string
    }
  | { readonly kind: 'deleteClip'; readonly clipId: string }
  | { readonly kind: 'deleteClipInstance'; readonly nodeId: string; readonly instanceId: string }
  | {
      readonly kind: 'upsertCollection'
      readonly action: 'create' | 'update'
      readonly targetId?: string
      readonly collection: ClipCollectionJSON
    }
  | { readonly kind: 'deleteCollection'; readonly collectionId: string }

export interface AnimationAssetPreviewSummary {
  readonly operation: AnimationAssetOperation['kind']
  readonly assetId: string
  readonly assetName: string
  readonly nodeId?: string
}

function nodesOf(slide: LessonJSON['slides'][number]): NodeJSON[] {
  return slide.scene.nodes as NodeJSON[]
}

function nodeById(lesson: LessonJSON, nodeId: string): NodeJSON {
  for (const slide of lesson.slides) {
    const node = nodesOf(slide).find((entry) => entry.id === nodeId)
    if (node) return node
  }
  throw new Error(`Scene Node not found: ${nodeId}`)
}

function removeCollectionPlacements(lesson: LessonJSON, collectionId: string): void {
  for (const slide of lesson.slides) {
    const nodes = nodesOf(slide) as unknown as {
      id: string
      parentId: string | null
      clipInstances?: import('../engine/json').ClipInstanceJSON[]
      collectionPlacements?: import('../engine/json').CollectionPlacementJSON[]
    }[]
    const byId = new Map(nodes.map((node) => [node.id, node] as const))
    const isWithin = (nodeId: string, rootId: string): boolean => {
      let current = byId.get(nodeId)
      while (current) {
        if (current.id === rootId) return true
        current = current.parentId ? byId.get(current.parentId) : undefined
      }
      return false
    }
    for (const parent of nodes) {
      const placements = (parent.collectionPlacements ?? []).filter(
        (placement) => placement.collectionId === collectionId,
      )
      for (const placement of placements) {
        const targetRootId = placement.parentNodeId
        for (const node of nodes) {
          if (!isWithin(node.id, targetRootId)) continue
          node.clipInstances = (node.clipInstances ?? []).map((instance) => {
            if (instance.placementId !== placement.id) return instance
            const plainInstance = { ...instance } as Record<string, unknown>
            delete plainInstance.placementId
            if (plainInstance.collectionId === collectionId) {
              delete plainInstance.collectionId
              delete plainInstance.collectionTargetId
              delete plainInstance.collectionSemantic
            }
            return plainInstance as unknown as typeof instance
          })
        }
      }
      if (placements.length > 0) {
        const removed = new Set(placements.map((placement) => placement.id))
        parent.collectionPlacements = (parent.collectionPlacements ?? []).filter(
          (placement) => !removed.has(placement.id),
        )
      }
    }
    for (const node of nodes) {
      node.clipInstances = (node.clipInstances ?? []).map((instance) => {
        if (instance.collectionId !== collectionId) return instance
        const plainInstance = { ...instance } as Record<string, unknown>
        delete plainInstance.collectionId
        delete plainInstance.collectionTargetId
        delete plainInstance.collectionSemantic
        return plainInstance as unknown as typeof instance
      })
    }
  }
}

function mutableLibraryArray<T>(lesson: LessonJSON, field: 'clips' | 'clipCollections'): T[] {
  const root = lesson as unknown as Record<string, unknown>
  const library = root.library as Record<string, unknown> | undefined
  const rootValue = root[field]
  if (Array.isArray(rootValue)) return rootValue as T[]
  const libraryValue = library?.[field]
  if (Array.isArray(libraryValue)) return libraryValue as T[]
  const created: T[] = []
  root[field] = created
  return created
}

function replaceById<T extends { id: string }>(entries: T[], candidate: T): void {
  const index = entries.findIndex((entry) => entry.id === candidate.id)
  if (index < 0) entries.push(candidate)
  else entries[index] = candidate
}

function validateCreateOrUpdate<T extends { id: string }>(
  entries: readonly T[],
  action: 'create' | 'update',
  candidateId: string,
  targetId: string | undefined,
  label: string,
): void {
  if (action !== 'create' && action !== 'update') {
    throw new Error(`${label} operation must explicitly say create or update`)
  }
  const existing = entries.some((entry) => entry.id === candidateId)
  if (action === 'create' && existing) throw new Error(`${label} id already exists: ${candidateId}`)
  if (action === 'update' && (!targetId || targetId !== candidateId || !existing)) {
    throw new Error(`Updating ${label} requires its existing stable id as targetId`)
  }
  if (action === 'create' && targetId) {
    throw new Error(`Creating ${label} must not target an existing id`)
  }
}

function deleteById<T extends { id: string }>(entries: T[], id: string, label: string): void {
  const index = entries.findIndex((entry) => entry.id === id)
  if (index < 0) throw new Error(`${label} not found: ${id}`)
  entries.splice(index, 1)
}

/**
 * Produce a candidate LessonJSON without touching the live project. The same
 * transformation powers dry-run validation and inline proposal previews.
 */
export function applyAnimationAssetOperations(
  source: LessonJSON,
  operations: readonly AnimationAssetOperation[],
): LessonJSON {
  if (operations.length === 0) throw new Error('At least one asset operation is required')
  const lesson = structuredClone(source) as LessonJSON
  for (const operation of operations) {
    switch (operation.kind) {
      case 'upsertShape': {
        const node = nodeById(lesson, operation.nodeId)
        const components = node.components as Record<string, unknown>
        const mesh = components.mesh as Record<string, unknown> | undefined
        if (!mesh) throw new Error(`Node "${node.name}" does not have a mesh component`)
        const meshData = mesh.mesh as { vertices?: unknown[] } | undefined
        if (!Array.isArray(meshData?.vertices))
          throw new Error(`Node "${node.name}" has no mesh vertices`)
        if (operation.shape.vertices.length !== meshData.vertices.length) {
          throw new Error(
            `Shape "${operation.shape.name}" has ${operation.shape.vertices.length} vertices; mesh topology requires ${meshData.vertices.length}.`,
          )
        }
        const shapes = (Array.isArray(mesh.shapes) ? mesh.shapes : []) as ShapeJSON[]
        if (operation.sourceShapeId) {
          if (
            operation.sourceShapeId === operation.shape.id ||
            !shapes.some((shape) => shape.id === operation.sourceShapeId)
          ) {
            throw new Error(`Source Shape not found on target mesh: ${operation.sourceShapeId}`)
          }
        }
        if (operation.action === 'create' && !operation.sourceShapeId) {
          throw new Error(
            'Creating a Shape draft requires a closest-fit sourceShapeId to duplicate',
          )
        }
        validateCreateOrUpdate(
          shapes,
          operation.action,
          operation.shape.id,
          operation.targetId,
          'Shape',
        )
        const nameConflict = shapes.find(
          (shape) => shape.id !== operation.shape.id && shape.name === operation.shape.name,
        )
        if (nameConflict) throw new Error(`Shape name already exists: ${operation.shape.name}`)
        replaceById(shapes, structuredClone(operation.shape))
        mesh.shapes = shapes
        break
      }
      case 'deleteShape': {
        const node = nodeById(lesson, operation.nodeId)
        const mesh = (node.components as Record<string, unknown>).mesh as
          Record<string, unknown> | undefined
        if (!mesh) throw new Error(`Node "${node.name}" does not have a mesh component`)
        const shapes = (Array.isArray(mesh.shapes) ? mesh.shapes : []) as ShapeJSON[]
        deleteById(shapes, operation.shapeId, 'Shape')
        mesh.shapes = shapes
        break
      }
      case 'upsertClip': {
        if (!operation.clip.id || !operation.clip.name.trim())
          throw new Error('Clip needs a stable id and a non-empty name')
        const clips = mutableLibraryArray<ClipJSON>(lesson, 'clips')
        validateCreateOrUpdate(
          clips,
          operation.action,
          operation.clip.id,
          operation.targetId,
          'Clip',
        )
        replaceById(clips, structuredClone(operation.clip))
        break
      }
      case 'deleteClip':
        deleteById(mutableLibraryArray<ClipJSON>(lesson, 'clips'), operation.clipId, 'Clip')
        break
      case 'deleteClipInstance': {
        const node = nodeById(lesson, operation.nodeId) as unknown as {
          clipInstances?: { id: string; clipId: string }[]
        }
        const instances = node.clipInstances ?? []
        deleteById(instances, operation.instanceId, 'Clip Instance')
        node.clipInstances = instances
        break
      }
      case 'upsertCollection': {
        if (!operation.collection.id || !operation.collection.name.trim())
          throw new Error('Collection needs a stable id and a non-empty name')
        const collections = mutableLibraryArray<ClipCollectionJSON>(lesson, 'clipCollections')
        validateCreateOrUpdate(
          collections,
          operation.action,
          operation.collection.id,
          operation.targetId,
          'Clip Collection',
        )
        replaceById(collections, structuredClone(operation.collection))
        break
      }
      case 'deleteCollection':
        removeCollectionPlacements(lesson, operation.collectionId)
        deleteById(
          mutableLibraryArray<ClipCollectionJSON>(lesson, 'clipCollections'),
          operation.collectionId,
          'Clip Collection',
        )
        break
    }
  }
  return lesson
}

export function summarizeAnimationAssetOperations(
  operations: readonly AnimationAssetOperation[],
): AnimationAssetPreviewSummary[] {
  return operations.map((operation) => {
    switch (operation.kind) {
      case 'upsertShape':
        return {
          operation: operation.kind,
          assetId: operation.shape.id,
          assetName: operation.shape.name,
          nodeId: operation.nodeId,
        }
      case 'deleteShape':
        return {
          operation: operation.kind,
          assetId: operation.shapeId,
          assetName: `Shape ${operation.shapeId}`,
          nodeId: operation.nodeId,
        }
      case 'upsertClip':
        return {
          operation: operation.kind,
          assetId: operation.clip.id,
          assetName: operation.clip.name,
          ...(operation.nodeId ? { nodeId: operation.nodeId } : {}),
        }
      case 'deleteClip':
        return {
          operation: operation.kind,
          assetId: operation.clipId,
          assetName: `Clip ${operation.clipId}`,
        }
      case 'deleteClipInstance':
        return {
          operation: operation.kind,
          assetId: operation.instanceId,
          assetName: `Clip Instance ${operation.instanceId}`,
          nodeId: operation.nodeId,
        }
      case 'upsertCollection':
        return {
          operation: operation.kind,
          assetId: operation.collection.id,
          assetName: operation.collection.name,
        }
      case 'deleteCollection':
        return {
          operation: operation.kind,
          assetId: operation.collectionId,
          assetName: `Collection ${operation.collectionId}`,
        }
    }
  })
}

/** Compact, conversation-scoped provenance fed back to the assistant. */
export function animationAssetsFromConversationProposals(
  proposals: readonly AiProposal[],
  conversationId: string | null,
): { kind: string; id: string; name: string; action: string; proposalId: string }[] {
  const assets = new Map<
    string,
    { kind: string; id: string; name: string; action: string; proposalId: string }
  >()
  if (!conversationId) return []
  for (const proposal of [...proposals].reverse()) {
    if (
      proposal.conversationId !== conversationId ||
      !proposal.executions.some((execution) => execution.success)
    )
      continue
    for (const command of proposal.commands) {
      if (command.type !== 'AiAnimationAssetBatch' || !Array.isArray(command.operations)) continue
      for (const raw of command.operations) {
        if (typeof raw !== 'object' || raw === null) continue
        const operation = raw as Record<string, unknown>
        const kind = operation.kind
        let id: string | null = null
        let name = ''
        let assetKind = ''
        let action = ''
        if (kind === 'upsertShape' && typeof operation.shape === 'object' && operation.shape) {
          const shape = operation.shape as Record<string, unknown>
          id = typeof shape.id === 'string' ? shape.id : null
          name = typeof shape.name === 'string' ? shape.name : ''
          assetKind = 'shape'
          action = typeof operation.action === 'string' ? operation.action : 'update'
        } else if (kind === 'deleteShape') {
          id = typeof operation.shapeId === 'string' ? operation.shapeId : null
          assetKind = 'shape'
          action = 'delete'
        } else if (kind === 'upsertClip' && typeof operation.clip === 'object' && operation.clip) {
          const clip = operation.clip as Record<string, unknown>
          id = typeof clip.id === 'string' ? clip.id : null
          name = typeof clip.name === 'string' ? clip.name : ''
          assetKind = 'clip'
          action = typeof operation.action === 'string' ? operation.action : 'update'
        } else if (kind === 'deleteClip') {
          id = typeof operation.clipId === 'string' ? operation.clipId : null
          assetKind = 'clip'
          action = 'delete'
        } else if (kind === 'deleteClipInstance') {
          id = typeof operation.instanceId === 'string' ? operation.instanceId : null
          assetKind = 'clip instance'
          action = 'delete'
        } else if (
          kind === 'upsertCollection' &&
          typeof operation.collection === 'object' &&
          operation.collection
        ) {
          const collection = operation.collection as Record<string, unknown>
          id = typeof collection.id === 'string' ? collection.id : null
          name = typeof collection.name === 'string' ? collection.name : ''
          assetKind = 'collection'
          action = typeof operation.action === 'string' ? operation.action : 'update'
        } else if (kind === 'deleteCollection') {
          id = typeof operation.collectionId === 'string' ? operation.collectionId : null
          assetKind = 'collection'
          action = 'delete'
        }
        if (!id || !assetKind) continue
        const key = `${assetKind}:${id}`
        if (action === 'delete') assets.delete(key)
        else
          assets.set(key, {
            kind: assetKind,
            id,
            name: name || id,
            action,
            proposalId: proposal.id,
          })
      }
    }
  }
  return [...assets.values()]
}
