import { isRecord, requireStringAllowEmpty } from './guards'
import {
  compiledFootprintFromJSON,
  compiledFootprintToJSON,
  validateCompiledFootprintJSON,
} from './compiledFootprint'
import type { CompiledFootprint } from './compiledFootprint'
import type { AnimationScriptJSON } from './json'

export interface SlideAnimationScript {
  readonly source: string
  readonly lastCompiled?: CompiledFootprint
}

export function animationScriptToJSON(script: SlideAnimationScript): AnimationScriptJSON {
  return {
    source: script.source,
    ...(script.lastCompiled !== undefined
      ? { lastCompiled: compiledFootprintToJSON(script.lastCompiled) }
      : {}),
  }
}

export function animationScriptFromJSON(json: AnimationScriptJSON): SlideAnimationScript {
  return {
    source: requireStringAllowEmpty(json.source, 'Animation Script source'),
    ...(json.lastCompiled !== undefined
      ? { lastCompiled: compiledFootprintFromJSON(json.lastCompiled) }
      : {}),
  }
}

export function validateAnimationScriptJSON(errors: string[], value: unknown, label: string): void {
  if (!isRecord(value)) {
    errors.push(`${label} animationScript must be an object`)
    return
  }
  if (typeof value.source !== 'string') {
    errors.push(`${label} animationScript.source must be a string`)
  }
  if (value.lastCompiled !== undefined) {
    validateCompiledFootprintJSON(
      errors,
      value.lastCompiled,
      `${label} animationScript.lastCompiled`,
    )
  }
}
