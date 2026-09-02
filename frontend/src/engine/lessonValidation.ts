import { isOverrideValue, isRecord } from './guards'

const INTERPOLATIONS = ['hold', 'linear', 'bezier'] as const

export function validateFullscreenShader(errors: string[], value: unknown, slideId: string): void {
  if (!isRecord(value)) {
    errors.push(`Slide "${slideId}" fullscreenShader must be an object`)
    return
  }
  requireNonEmptyString(
    errors,
    value.shaderDefinitionId,
    `Slide "${slideId}" fullscreenShader shaderDefinitionId`,
  )
  validateOverrides(errors, value.overrides, `Slide "${slideId}" fullscreenShader overrides`)
}

export function validateMaterial(errors: string[], value: unknown, nodeId: string): void {
  if (!isRecord(value)) {
    errors.push(`Node "${nodeId}" material must be an object`)
    return
  }
  requireNonEmptyString(errors, value.definitionId, `Node "${nodeId}" material definition id`)
  validateOverrides(errors, value.overrides, `Node "${nodeId}" material overrides`)
  if (value.textureId !== undefined) {
    if (typeof value.textureId !== 'string' || value.textureId === '') {
      errors.push(`Node "${nodeId}" material textureId must be a non-empty string`)
    }
  }
  if (value.uvScale !== undefined) {
    if (
      !isRecord(value.uvScale) ||
      typeof value.uvScale.u !== 'number' ||
      typeof value.uvScale.v !== 'number' ||
      !Number.isFinite(value.uvScale.u) ||
      !Number.isFinite(value.uvScale.v) ||
      value.uvScale.u <= 0 ||
      value.uvScale.v <= 0
    ) {
      errors.push(`Node "${nodeId}" material uvScale must have positive finite u and v`)
    }
  }
  if (value.uvOffset !== undefined) {
    if (
      !isRecord(value.uvOffset) ||
      typeof value.uvOffset.u !== 'number' ||
      typeof value.uvOffset.v !== 'number' ||
      !Number.isFinite(value.uvOffset.u) ||
      !Number.isFinite(value.uvOffset.v)
    ) {
      errors.push(`Node "${nodeId}" material uvOffset must have finite u and v`)
    }
  }
  if (value.fitMode !== undefined) {
    if (
      typeof value.fitMode !== 'string' ||
      !['stretch', 'cover', 'contain'].includes(value.fitMode as string)
    ) {
      errors.push(`Node "${nodeId}" material fitMode must be one of stretch, cover, contain`)
    }
  }
}

export function validateKeyframeList(
  errors: string[],
  keyframes: unknown,
  trackLabel: string,
  duration: number,
  keyframeIds: Set<string>,
  valueOf: (value: unknown, id: string) => string | null,
): void {
  if (!Array.isArray(keyframes)) {
    errors.push(`${trackLabel} must have a keyframes array`)
    return
  }
  let previousTime = -Infinity
  for (const keyframeJson of keyframes) {
    if (!isRecord(keyframeJson)) {
      errors.push(`${trackLabel} keyframe must be an object`)
      continue
    }
    const id = requireNonEmptyString(errors, keyframeJson.id, `${trackLabel} keyframe id`)
    if (id !== undefined) {
      if (keyframeIds.has(id)) {
        errors.push(`Duplicate keyframe id: ${id}`)
      } else {
        keyframeIds.add(id)
      }
    }
    const time = keyframeJson.time
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > duration) {
      errors.push(`Keyframe "${String(keyframeJson.id)}" time must be within [0, ${duration}]`)
    } else if (time < previousTime) {
      errors.push(`${trackLabel} keyframe times must not decrease (out-of-order time ${time})`)
    } else if (time === previousTime && time !== duration) {
      errors.push(
        `${trackLabel} keyframe times must be distinct (duplicate time ${time} not at the slide duration)`,
      )
    } else {
      previousTime = time
    }
    const valueError = valueOf(keyframeJson.value, String(keyframeJson.id))
    if (valueError !== null) {
      errors.push(valueError)
    }
    if (
      keyframeJson.interpolation !== undefined &&
      !(INTERPOLATIONS as readonly string[]).includes(keyframeJson.interpolation as string)
    ) {
      errors.push(
        `Keyframe "${String(keyframeJson.id)}" interpolation must be hold, linear, or bezier`,
      )
    }
    for (const side of ['tangentIn', 'tangentOut'] as const) {
      const tangent = keyframeJson[side]
      if (tangent === undefined) {
        continue
      }
      if (
        !isRecord(tangent) ||
        typeof tangent.time !== 'number' ||
        !Number.isFinite(tangent.time) ||
        typeof tangent.value !== 'number' ||
        !Number.isFinite(tangent.value)
      ) {
        errors.push(
          `Keyframe "${String(keyframeJson.id)}" ${side} must be an object with finite time and value`,
        )
      }
    }
  }
}

function validateOverrides(errors: string[], overrides: unknown, what: string): void {
  if (overrides === undefined) {
    return
  }
  if (!isRecord(overrides)) {
    errors.push(`${what} must be an object`)
    return
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (!isOverrideValue(value)) {
      errors.push(
        `${what} value for "${key}" must be a non-empty string, a finite number, a boolean, or a number array`,
      )
    }
  }
}

function requireNonEmptyString(errors: string[], value: unknown, what: string): string | undefined {
  if (typeof value !== 'string' || value === '') {
    errors.push(`${what} must be a non-empty string`)
    return undefined
  }
  return value
}
