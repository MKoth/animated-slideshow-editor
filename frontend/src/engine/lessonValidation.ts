import { isOverrideValue, isRecord } from './guards'

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

function requireNonEmptyString(errors: string[], value: unknown, what: string): void {
  if (typeof value !== 'string' || value === '') {
    errors.push(`${what} must be a non-empty string`)
  }
}
