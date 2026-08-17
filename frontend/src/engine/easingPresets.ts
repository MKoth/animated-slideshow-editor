import type { KeyframeTangent } from './keyframe'

export interface EasingPreset {
  readonly label: string
  readonly tangentIn: KeyframeTangent
  readonly tangentOut: KeyframeTangent
}

/**
 * The nine easing presets (Spec 07 R1): named Bezier configurations.
 * Each preset is a fixed set of tangent offsets applied to a keyframe's
 * handles, exactly equivalent to manually set Bezier tangents.
 *
 * Tangent offsets are relative to the keyframe: tangentOut is an offset from
 * the "from" keyframe and tangentIn is an offset from the "to" keyframe.
 * These map to standard CSS cubic-bezier control points:
 *   P1 = (tangentOut.time, tangentOut.value)  [from (0,0)]
 *   P2 = (1 + tangentIn.time, 1 + tangentIn.value)  [from (1,1)]
 */
export const EASING_PRESETS: readonly EasingPreset[] = [
  {
    label: 'Linear',
    tangentIn: { time: 0, value: 0 },
    tangentOut: { time: 0, value: 0 },
  },
  {
    label: 'Ease In',
    tangentIn: { time: 0, value: 0 },
    tangentOut: { time: 0.42, value: 0 },
  },
  {
    label: 'Ease Out',
    tangentIn: { time: -0.42, value: 0 },
    tangentOut: { time: 0, value: 0 },
  },
  {
    label: 'Ease In-Out',
    tangentIn: { time: -0.42, value: 0 },
    tangentOut: { time: 0.42, value: 0 },
  },
  {
    label: 'Quadratic',
    tangentIn: { time: -0.75, value: -0.9 },
    tangentOut: { time: 0.75, value: 0.9 },
  },
  {
    label: 'Cubic',
    tangentIn: { time: -0.42, value: 0 },
    tangentOut: { time: 0.42, value: 0 },
  },
  {
    label: 'Quartic',
    tangentIn: { time: -0.685, value: -0.78 },
    tangentOut: { time: 0.895, value: 0.03 },
  },
  {
    label: 'Quintic',
    tangentIn: { time: -0.68, value: 0 },
    tangentOut: { time: 0.23, value: 0 },
  },
  {
    label: 'Back',
    tangentIn: { time: 0.34, value: 1.56 },
    tangentOut: { time: -0.36, value: -0.28 },
  },
]

export function findPresetByTangents(
  tangentIn: KeyframeTangent,
  tangentOut: KeyframeTangent,
): EasingPreset | null {
  for (const preset of EASING_PRESETS) {
    if (
      tangentIn.time === preset.tangentIn.time &&
      tangentIn.value === preset.tangentIn.value &&
      tangentOut.time === preset.tangentOut.time &&
      tangentOut.value === preset.tangentOut.value
    ) {
      return preset
    }
  }
  return null
}
