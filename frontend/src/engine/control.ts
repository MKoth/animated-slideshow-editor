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

export const CONTROL_INTERVAL_MIN_SPAN = 1e-6
export const CONTROL_INTERVAL_EPSILON = 1e-9

export interface ControlBindingInterval {
  readonly clipId: string
  readonly start: number
  readonly end: number
}

export type ControlBinding = string | ControlBindingInterval

export type ControlBindingJSON =
  string | { readonly clipId: string; readonly start: number; readonly end: number }

export interface Control {
  readonly id: string
  readonly key: string
  readonly label: string
  readonly min: 0
  readonly max: 1
  readonly default: number
  readonly exposed: boolean
  readonly bindings: Readonly<Record<string, ControlBinding>>
}

export interface ControlSet {
  readonly id: string
  readonly hostNodeId: string
  readonly controls: readonly Control[]
}

export function normalizeControlBinding(binding: ControlBinding): ControlBindingInterval {
  if (typeof binding === 'string') return { clipId: binding, start: 0, end: 1 }
  return binding
}

export function isControlBindingInterval(
  binding: ControlBinding,
): binding is ControlBindingInterval {
  return typeof binding === 'object' && binding !== null
}

export function controlBindingClipId(binding: ControlBinding): string {
  return typeof binding === 'string' ? binding : binding.clipId
}

export function validateControlBinding(
  binding: ControlBinding,
  semantic: string,
  controlKey: string,
): void {
  if (typeof binding === 'string') {
    if (binding.length === 0)
      throw new Error(`Control "${controlKey}" binding "${semantic}" clipId must be non-empty`)
    return
  }
  if (!binding || typeof binding !== 'object')
    throw new Error(
      `Control "${controlKey}" binding "${semantic}" must be a string or interval object`,
    )
  const interval = binding as unknown as Record<string, unknown>
  const clipId = interval.clipId
  if (typeof clipId !== 'string' || clipId.length === 0)
    throw new Error(
      `Control "${controlKey}" binding "${semantic}" clipId must be a non-empty string`,
    )
  const start = requireFiniteNumber(
    interval.start,
    `Control "${controlKey}" binding "${semantic}" start`,
  )
  const end = requireFiniteNumber(interval.end, `Control "${controlKey}" binding "${semantic}" end`)
  if (start < 0) throw new Error(`Control "${controlKey}" binding "${semantic}" start must be >= 0`)
  if (end > 1) throw new Error(`Control "${controlKey}" binding "${semantic}" end must be <= 1`)
  if (start >= end)
    throw new Error(`Control "${controlKey}" binding "${semantic}" start must be < end`)
  const span = end - start
  if (span < CONTROL_INTERVAL_MIN_SPAN)
    throw new Error(
      `Control "${controlKey}" binding "${semantic}" span must be >= ${CONTROL_INTERVAL_MIN_SPAN}`,
    )
}

export function createControl(input: {
  key: string
  label?: string
  default?: number
  exposed?: boolean
  bindings?: Readonly<Record<string, ControlBinding>>
}): Control {
  validateControlKey(input.key)
  const value = input.default ?? 0
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Control default must be within [0, 1]')
  }
  const bindings: Record<string, ControlBinding> = {}
  if (input.bindings) {
    for (const [semantic, binding] of Object.entries(input.bindings)) {
      validateControlBinding(binding, semantic, input.key)
      bindings[semantic] = typeof binding === 'string' ? binding : { ...binding }
    }
  }
  return {
    id: newId('control'),
    key: input.key,
    label: input.label ?? input.key,
    min: 0,
    max: 1,
    default: value,
    exposed: input.exposed ?? false,
    bindings,
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
    if (control.bindings && typeof control.bindings === 'object') {
      for (const [semantic, binding] of Object.entries(control.bindings)) {
        validateControlBinding(binding as ControlBinding, semantic, control.key)
      }
    }
  }
}

export function controlSetToJSON(controlSet: ControlSet): ControlSetJSON {
  return {
    id: controlSet.id,
    hostNodeId: controlSet.hostNodeId,
    controls: controlSet.controls.map((control) => {
      const bindings: Record<string, ControlBindingJSON> = {}
      for (const [semantic, binding] of Object.entries(control.bindings)) {
        if (typeof binding === 'string') {
          bindings[semantic] = { clipId: binding, start: 0, end: 1 }
        } else {
          bindings[semantic] = { clipId: binding.clipId, start: binding.start, end: binding.end }
        }
      }
      return {
        id: control.id,
        key: control.key,
        label: control.label,
        min: control.min,
        max: control.max,
        default: control.default,
        exposed: control.exposed,
        bindings,
      }
    }),
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
      const bindings: Record<string, ControlBinding> = {}
      if (item.bindings && typeof item.bindings === 'object') {
        for (const [semantic, rawBinding] of Object.entries(
          item.bindings as Record<string, unknown>,
        )) {
          if (typeof rawBinding === 'string') {
            if (rawBinding.length > 0) bindings[semantic] = { clipId: rawBinding, start: 0, end: 1 }
            continue
          }
          if (rawBinding && typeof rawBinding === 'object') {
            const obj = rawBinding as Record<string, unknown>
            try {
              const clipId = requireString(
                obj.clipId,
                `Control "${key}" binding "${semantic}" clipId`,
              )
              const start = requireFiniteNumber(
                obj.start,
                `Control "${key}" binding "${semantic}" start`,
              )
              const end = requireFiniteNumber(obj.end, `Control "${key}" binding "${semantic}" end`)
              if (start < 0 || end > 1 || start >= end || end - start < CONTROL_INTERVAL_MIN_SPAN) {
                console.warn(
                  `[control] Dropping invalid interval binding "${semantic}" on "${key}": start=${start} end=${end}`,
                )
                continue
              }
              bindings[semantic] = { clipId, start, end }
            } catch (e) {
              console.warn(
                `[control] Dropping invalid binding "${semantic}" on "${key}": ${e instanceof Error ? e.message : String(e)}`,
              )
              continue
            }
          } else {
            console.warn(
              `[control] Dropping invalid binding "${semantic}" on "${key}": unsupported value`,
            )
          }
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
