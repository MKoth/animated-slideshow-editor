import { newId } from './ids'
import type { Keyframe } from './keyframe'
import {
  Keyframe as KeyframeModel,
  requireKeyframeInterpolation,
  requireKeyframeTangent,
  ZERO_TANGENT,
} from './keyframe'
import { evaluateSegment } from './interpolators'
import type { ControlSetJSON } from './json'
import { requireFiniteNumber, requireString } from './guards'

export const CONTROL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.]*$/

export interface Control {
  readonly id: string
  readonly key: string
  readonly label: string
  readonly min: 0
  readonly max: 1
  readonly default: number
  readonly exposed: boolean
  readonly bindings: Readonly<Record<string, string>>
}

export interface ControlSet {
  readonly id: string
  readonly hostNodeId: string
  readonly controls: readonly Control[]
}

export function createControl(input: {
  key: string
  label?: string
  default?: number
  exposed?: boolean
  bindings?: Readonly<Record<string, string>>
}): Control {
  validateControlKey(input.key)
  const value = input.default ?? 0
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Control default must be within [0, 1]')
  }
  return {
    id: newId('control'),
    key: input.key,
    label: input.label ?? input.key,
    min: 0,
    max: 1,
    default: value,
    exposed: input.exposed ?? false,
    bindings: { ...(input.bindings ?? {}) },
  }
}

export function createControlSet(
  hostNodeId: string,
  controls: readonly Control[] = [],
): ControlSet {
  validateControls(controls)
  return { id: newId('control-set'), hostNodeId, controls: [...controls] }
}

export function validateControlKey(key: string): void {
  if (!CONTROL_KEY_PATTERN.test(key)) {
    throw new Error(`Invalid control key "${key}"`)
  }
}

export function validateControls(controls: readonly Control[]): void {
  const keys = new Set<string>()
  for (const control of controls) {
    validateControlKey(control.key)
    if (keys.has(control.key)) throw new Error(`Duplicate control key: ${control.key}`)
    keys.add(control.key)
    if (control.min !== 0 || control.max !== 1 || control.default < 0 || control.default > 1) {
      throw new Error(`Control "${control.key}" must use the v1 range [0, 1]`)
    }
  }
}

export function controlSetToJSON(controlSet: ControlSet): ControlSetJSON {
  return {
    id: controlSet.id,
    hostNodeId: controlSet.hostNodeId,
    controls: controlSet.controls.map((control) => ({
      id: control.id,
      key: control.key,
      label: control.label,
      min: control.min,
      max: control.max,
      default: control.default,
      exposed: control.exposed,
      bindings: { ...control.bindings },
    })),
  }
}

export function controlSetFromJSON(value: unknown, nodeId: string): ControlSet | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object')
    throw new Error(`Node "${nodeId}" controlSet must be an object`)
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.controls))
    throw new Error(`Node "${nodeId}" controlSet controls must be an array`)
  const controls: Control[] = []
  for (const raw of record.controls) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    try {
      const key = requireString(item.key, 'Control key')
      validateControlKey(key)
      const bindings: Record<string, string> = {}
      if (item.bindings && typeof item.bindings === 'object') {
        for (const [semantic, clipId] of Object.entries(item.bindings)) {
          if (typeof clipId === 'string' && clipId.length > 0) bindings[semantic] = clipId
        }
      }
      const control = {
        id: requireString(item.id, 'Control id'),
        key,
        label: typeof item.label === 'string' ? item.label : key,
        min: 0 as const,
        max: 1 as const,
        default: typeof item.default === 'number' ? item.default : 0,
        exposed: item.exposed === true,
        bindings,
      }
      if (control.default < 0 || control.default > 1 || !Number.isFinite(control.default)) continue
      controls.push(control)
    } catch {
      continue
    }
  }
  validateControls(controls)
  return {
    id: typeof record.id === 'string' ? record.id : newId('control-set'),
    hostNodeId: nodeId,
    controls,
  }
}

export function evaluateControlTrack(
  keyframes: readonly Keyframe[],
  time: number,
  fallback: number,
): number {
  const enabled = keyframes.filter((keyframe) => !keyframe.disabled)
  if (enabled.length === 0) return fallback
  if (time <= enabled[0].time) return enabled[0].value as number
  const last = enabled[enabled.length - 1]
  if (time >= last.time) return last.value as number
  for (let index = 0; index < enabled.length - 1; index += 1) {
    const from = enabled[index]
    const to = enabled[index + 1]
    if (time >= from.time && time < to.time) {
      return evaluateSegment(from, to, time)
    }
  }
  return last.value as number
}

export function controlTrackKeyframeFromJSON(
  value: unknown,
  duration: number,
): Keyframe | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  try {
    const time = requireFiniteNumber(record.time, 'Control keyframe time')
    const numberValue = requireFiniteNumber(record.value, 'Control keyframe value')
    if (time < 0 || time > duration || numberValue < 0 || numberValue > 1) return undefined
    return new KeyframeModel(
      requireString(record.id, 'Control keyframe id'),
      time,
      numberValue,
      record.interpolation === undefined
        ? 'linear'
        : requireKeyframeInterpolation(record.interpolation),
      record.tangentIn === undefined ? ZERO_TANGENT : requireKeyframeTangent(record.tangentIn),
      record.tangentOut === undefined ? ZERO_TANGENT : requireKeyframeTangent(record.tangentOut),
      record.disabled === true,
    )
  } catch {
    return undefined
  }
}
