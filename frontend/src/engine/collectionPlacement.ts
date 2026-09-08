import { newId } from './ids'
import { isRecord, requireFiniteNumber, requireString } from './guards'
import type { CollectionPlacementJSON } from './json'

export interface CollectionPlacement {
  readonly id: string
  collectionId: string
  parentNodeId: string
  startTime: number
}

export function newCollectionPlacementId(): string {
  return newId('colPlace')
}

export function createCollectionPlacement(
  collectionId: string,
  parentNodeId: string,
  startTime = 0,
): CollectionPlacement {
  return {
    id: newCollectionPlacementId(),
    collectionId,
    parentNodeId,
    startTime: Math.max(0, startTime),
  }
}

export function cloneCollectionPlacement(p: CollectionPlacement): CollectionPlacement {
  return {
    id: newCollectionPlacementId(),
    collectionId: p.collectionId,
    parentNodeId: p.parentNodeId,
    startTime: p.startTime,
  }
}

export function collectionPlacementToJSON(p: CollectionPlacement): CollectionPlacementJSON {
  return {
    id: p.id,
    collectionId: p.collectionId,
    parentNodeId: p.parentNodeId,
    startTime: p.startTime,
  }
}

export function collectionPlacementFromJSON(json: unknown): CollectionPlacement {
  if (!isRecord(json)) throw new Error('Collection placement must be an object')
  const id = requireString(json.id, 'Collection placement id')
  const collectionId = requireString(json.collectionId, 'Collection placement collectionId')
  const parentNodeId = requireString(json.parentNodeId, 'Collection placement parentNodeId')
  const startTime = requireFiniteNumber(json.startTime, 'Collection placement startTime')
  if (startTime < 0) throw new Error('Collection placement startTime must be non-negative')
  return { id, collectionId, parentNodeId, startTime }
}

export function validateCollectionPlacement(p: CollectionPlacement, context: string): void {
  requireString(p.collectionId, `${context} collectionId`)
  requireString(p.parentNodeId, `${context} parentNodeId`)
  requireFiniteNumber(p.startTime, `${context} startTime`)
  if (p.startTime < 0) throw new Error(`${context} startTime must be non-negative`)
}
