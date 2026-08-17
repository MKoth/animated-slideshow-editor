import { newId } from './ids'
import { isRecord, requireFiniteNumber, requireString } from './guards'
import type { ClipInstanceJSON } from './json'

export interface ClipInstance {
  readonly id: string
  readonly clipId: string
  startTime: number
  speed: number
  enabled: boolean
  paramOverrides: Record<string, number>
}

export function createClipInstance(
  clipId: string,
  startTime = 0,
  speed = 1,
  enabled = true,
  paramOverrides: Record<string, number> = {},
): ClipInstance {
  return {
    id: newClipInstanceId(),
    clipId,
    startTime,
    speed,
    enabled,
    paramOverrides: { ...paramOverrides },
  }
}

export function cloneClipInstance(instance: ClipInstance): ClipInstance {
  return {
    id: newClipInstanceId(),
    clipId: instance.clipId,
    startTime: instance.startTime,
    speed: instance.speed,
    enabled: instance.enabled,
    paramOverrides: { ...instance.paramOverrides },
  }
}

export function clipInstanceToJSON(instance: ClipInstance): ClipInstanceJSON {
  return {
    id: instance.id,
    clipId: instance.clipId,
    startTime: instance.startTime,
    speed: instance.speed,
    enabled: instance.enabled,
    ...(Object.keys(instance.paramOverrides).length > 0
      ? { paramOverrides: { ...instance.paramOverrides } }
      : {}),
  }
}

export function clipInstanceFromJSON(json: unknown): ClipInstance {
  if (!isRecord(json)) {
    throw new Error('Clip instance must be an object')
  }
  const id = requireString(json.id, 'Clip instance id')
  const clipId = requireString(json.clipId, 'Clip instance clipId')
  const startTime = requireFiniteNumber(json.startTime, 'Clip instance startTime')
  if (startTime < 0) {
    throw new Error('Clip instance startTime must be non-negative')
  }
  const speed = requireFiniteNumber(json.speed, 'Clip instance speed')
  if (speed < 0) {
    throw new Error('Clip instance speed must be non-negative')
  }
  const enabled = typeof json.enabled === 'boolean' ? json.enabled : true
  const paramOverrides: Record<string, number> = {}
  if (json.paramOverrides !== undefined) {
    if (!isRecord(json.paramOverrides)) {
      throw new Error('Clip instance paramOverrides must be an object')
    }
    for (const [key, value] of Object.entries(json.paramOverrides)) {
      paramOverrides[key] = requireFiniteNumber(value, `Clip instance paramOverride "${key}"`)
    }
  }
  return { id, clipId, startTime, speed, enabled, paramOverrides }
}

export function newClipInstanceId(): string {
  return newId('clipInst')
}

export function validateClipInstance(instance: ClipInstance, context: string): void {
  requireString(instance.clipId, `${context} clipId`)
  requireFiniteNumber(instance.startTime, `${context} startTime`)
  if (instance.startTime < 0) {
    throw new Error(`${context} startTime must be non-negative`)
  }
  requireFiniteNumber(instance.speed, `${context} speed`)
  if (instance.speed < 0) {
    throw new Error(`${context} speed must be non-negative`)
  }
}
