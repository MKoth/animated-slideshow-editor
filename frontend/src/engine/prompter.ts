import { requireFiniteNumber, requireString } from './guards'
import { newId } from './ids'
import type { PrompterJSON } from './json'

export type PrompterPartStatus = 'stale'

export interface PrompterPart {
  readonly id: string
  text: string
  startTime: number
  endTime: number
  duration: number
  audioClipId?: string
  audioAssetId?: string
  promptId?: string
  status?: PrompterPartStatus
}

export interface Prompter {
  parts: PrompterPart[]
}

export function newPrompterPartId(): string {
  return newId('prompter-part')
}

export const PROMPTER_DURATION_TOLERANCE = 1e-6

export function createPrompterPart(input: {
  id?: string
  text: string
  startTime: number
  endTime: number
  duration: number
  audioClipId?: string
  audioAssetId?: string
  promptId?: string
  status?: PrompterPartStatus
}): PrompterPart {
  const id = input.id ?? newPrompterPartId()
  requireString(id, 'PrompterPart id')
  if (typeof input.text !== 'string') throw new Error('PrompterPart text must be a string')
  const duration = requireFiniteNumber(input.duration, 'PrompterPart duration', (v) => v >= 0)
  const startTime = requireFiniteNumber(input.startTime, 'PrompterPart startTime', (v) => v >= 0)
  const endTime = requireFiniteNumber(input.endTime, 'PrompterPart endTime', (v) => v >= 0)
  if (Math.abs(duration - (endTime - startTime)) > PROMPTER_DURATION_TOLERANCE) {
    throw new Error('PrompterPart duration must equal endTime - startTime within tolerance')
  }
  const part: PrompterPart = { id, text: input.text, startTime, endTime, duration }
  if (input.audioClipId !== undefined) part.audioClipId = requireString(input.audioClipId, 'PrompterPart audioClipId')
  if (input.audioAssetId !== undefined) part.audioAssetId = requireString(input.audioAssetId, 'PrompterPart audioAssetId')
  if (input.promptId !== undefined) part.promptId = requireString(input.promptId, 'PrompterPart promptId')
  if (input.status !== undefined) {
    if (input.status !== 'stale') throw new Error('PrompterPart status must be stale')
    part.status = input.status
  }
  return part
}

export function createPrompter(parts: PrompterPart[] = []): Prompter {
  return { parts: [...parts] }
}

export function reflowPrompter(prompter: Prompter): void {
  let cursor = 0
  for (const part of prompter.parts) {
    part.startTime = cursor
    part.endTime = cursor + part.duration
    cursor = part.endTime
  }
}

export function prompterToJSON(prompter: Prompter): PrompterJSON {
  return {
    parts: prompter.parts.map((part) => ({
      id: part.id,
      text: part.text,
      startTime: part.startTime,
      endTime: part.endTime,
      duration: part.duration,
      ...(part.audioClipId !== undefined ? { audioClipId: part.audioClipId } : {}),
      ...(part.audioAssetId !== undefined ? { audioAssetId: part.audioAssetId } : {}),
      ...(part.promptId !== undefined ? { promptId: part.promptId } : {}),
      ...(part.status !== undefined ? { status: part.status } : {}),
    })),
  }
}

export function prompterFromJSON(json: PrompterJSON): Prompter {
  const parts = json.parts.map((partJson) =>
    createPrompterPart({
      id: requireString(partJson.id, 'PrompterPart id'),
      text: partJson.text,
      startTime: partJson.startTime,
      endTime: partJson.endTime,
      duration: partJson.duration,
      audioClipId: partJson.audioClipId,
      audioAssetId: partJson.audioAssetId,
      promptId: partJson.promptId,
      status: partJson.status as PrompterPartStatus | undefined,
    }),
  )
  return { parts }
}

export function validatePrompterJSON(errors: string[], value: unknown, slideId: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`Slide "${slideId}" prompter must be an object`)
    return
  }
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.parts)) {
    errors.push(`Slide "${slideId}" prompter.parts must be an array`)
    return
  }
  const ids = new Set<string>()
  let expectedStart = 0
  for (let i = 0; i < v.parts.length; i++) {
    const part = v.parts[i] as Record<string, unknown>
    const where = `Slide "${slideId}" prompter.parts[${i}]`
    if (typeof part !== 'object' || part === null || Array.isArray(part)) {
      errors.push(`${where} must be an object`)
      continue
    }
    if (typeof part.id !== 'string' || part.id === '') errors.push(`${where} id must be a non-empty string`)
    else if (ids.has(part.id)) errors.push(`Duplicate prompter part id: ${part.id}`)
    else ids.add(part.id)
    if (typeof part.text !== 'string') errors.push(`${where} text must be a string`)
    if (typeof part.startTime !== 'number' || !Number.isFinite(part.startTime) || part.startTime < 0) errors.push(`${where} startTime must be a non-negative finite number`)
    if (typeof part.endTime !== 'number' || !Number.isFinite(part.endTime) || part.endTime < 0) errors.push(`${where} endTime must be a non-negative finite number`)
    if (typeof part.duration !== 'number' || !Number.isFinite(part.duration) || part.duration < 0) errors.push(`${where} duration must be a non-negative finite number`)
    if (typeof part.startTime === 'number' && typeof part.endTime === 'number' && typeof part.duration === 'number') {
      if (Math.abs(part.duration - (part.endTime - part.startTime)) > PROMPTER_DURATION_TOLERANCE) errors.push(`${where} duration must equal endTime - startTime`)
      if (Math.abs(part.startTime - expectedStart) > PROMPTER_DURATION_TOLERANCE) errors.push(`${where} startTime must equal previous endTime (gap-free; expected ${expectedStart})`)
      expectedStart = part.endTime
    }
    if (part.audioClipId !== undefined && (typeof part.audioClipId !== 'string' || part.audioClipId === '')) errors.push(`${where} audioClipId must be a non-empty string`)
    if (part.audioAssetId !== undefined && (typeof part.audioAssetId !== 'string' || part.audioAssetId === '')) errors.push(`${where} audioAssetId must be a non-empty string`)
    if (part.promptId !== undefined && (typeof part.promptId !== 'string' || part.promptId === '')) errors.push(`${where} promptId must be a non-empty string`)
    if (part.status !== undefined && part.status !== 'stale') errors.push(`${where} status must be stale`)
  }
}
