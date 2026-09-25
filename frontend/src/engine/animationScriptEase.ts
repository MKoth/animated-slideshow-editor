import { EASING_PRESETS } from './easingPresets'
import { ZERO_TANGENT } from './keyframe'
import type { InterpolationType, KeyframeTangent } from './keyframe'

/** The ease vocabulary an Animation Script shares with the timeline. */
export const SCRIPT_EASE_NAMES = [
  'hold',
  'linear',
  'easeIn',
  'easeOut',
  'easeInOut',
  'quadratic',
  'cubic',
  'quartic',
  'quintic',
  'back',
  'bounce',
  'elastic',
  'spring',
] as const

export type ScriptEaseName = (typeof SCRIPT_EASE_NAMES)[number]

export const DEFAULT_SCRIPT_EASE: ScriptEaseName = 'easeInOut'

export interface ResolvedScriptEase {
  readonly interpolation: InterpolationType
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
}

const PRESET_BY_NAME: Readonly<Record<string, string>> = {
  easeIn: 'Ease In',
  easeOut: 'Ease Out',
  easeInOut: 'Ease In-Out',
  quadratic: 'Quadratic',
  cubic: 'Cubic',
  quartic: 'Quartic',
  quintic: 'Quintic',
  back: 'Back',
}

/** Map a script ease name to the interpolation and tangents the timeline speaks. */
export function resolveScriptEase(name: string): ResolvedScriptEase | null {
  if (name === 'hold') {
    return { interpolation: 'hold', tangentIn: ZERO_TANGENT, tangentOut: ZERO_TANGENT }
  }
  if (name === 'linear') {
    return { interpolation: 'linear', tangentIn: ZERO_TANGENT, tangentOut: ZERO_TANGENT }
  }
  if (name === 'bounce' || name === 'elastic' || name === 'spring') {
    return { interpolation: name, tangentIn: ZERO_TANGENT, tangentOut: ZERO_TANGENT }
  }
  const presetLabel = PRESET_BY_NAME[name]
  if (presetLabel !== undefined) {
    const preset = EASING_PRESETS.find((entry) => entry.label === presetLabel)
    if (preset) {
      return {
        interpolation: 'bezier',
        tangentIn: preset.tangentIn,
        tangentOut: preset.tangentOut,
      }
    }
  }
  return null
}
