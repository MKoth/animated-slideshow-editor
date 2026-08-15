import type { MaterialParameterDefault } from '../../engine/materialResolution'

export type OverrideState = 'none' | 'all' | 'mixed'

export const VEC_COMPONENT_LABELS: Record<string, string> = {
  vec2: 'xy',
  vec3: 'xyz',
  vec4: 'xyzw',
}

export function overrideStateOf(overridden: readonly boolean[]): OverrideState {
  const any = overridden.some(Boolean)
  if (!any) {
    return 'none'
  }
  return overridden.every(Boolean) ? 'all' : 'mixed'
}

/** Whether a vec3/vec4 uniform key is treated as a color vector (RGB/RGBA). */
export function isColorVectorKey(key: string): boolean {
  return key.toLowerCase().includes('color')
}

/** A numeric uniform whose definition default lies in [0,1] also gets a slider. */
export function uniformHasSlider(parameter: MaterialParameterDefault): boolean {
  return (
    (parameter.kind === 'float' || parameter.kind === 'int' || parameter.kind === 'number') &&
    typeof parameter.default === 'number' &&
    parameter.default >= 0 &&
    parameter.default <= 1
  )
}
