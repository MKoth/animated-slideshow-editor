import { describe, expect, it } from 'vitest'
import { EASING_PRESETS, findPresetByTangents } from '../../engine/easingPresets'

describe('EASING_PRESETS', () => {
  it('contains exactly nine presets', () => {
    expect(EASING_PRESETS).toHaveLength(9)
  })

  it('each preset has a unique label', () => {
    const labels = EASING_PRESETS.map((p) => p.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it.each(EASING_PRESETS.map((p) => [p.label, p] as const))(
    '%s preset has valid tangent offsets',
    (_label, preset) => {
      expect(typeof preset.tangentIn.time).toBe('number')
      expect(typeof preset.tangentIn.value).toBe('number')
      expect(typeof preset.tangentOut.time).toBe('number')
      expect(typeof preset.tangentOut.value).toBe('number')
      expect(Number.isFinite(preset.tangentIn.time)).toBe(true)
      expect(Number.isFinite(preset.tangentIn.value)).toBe(true)
      expect(Number.isFinite(preset.tangentOut.time)).toBe(true)
      expect(Number.isFinite(preset.tangentOut.value)).toBe(true)
    },
  )

  it('Linear preset has zero tangents', () => {
    const linear = EASING_PRESETS.find((p) => p.label === 'Linear')!
    expect(linear.tangentIn).toEqual({ time: 0, value: 0 })
    expect(linear.tangentOut).toEqual({ time: 0, value: 0 })
  })

  it('Ease In preset has tangentOut offset (0.42, 0)', () => {
    const easeIn = EASING_PRESETS.find((p) => p.label === 'Ease In')!
    expect(easeIn.tangentIn).toEqual({ time: 0, value: 0 })
    expect(easeIn.tangentOut).toEqual({ time: 0.42, value: 0 })
  })

  it('Ease Out preset has tangentIn offset (-0.42, 0)', () => {
    const easeOut = EASING_PRESETS.find((p) => p.label === 'Ease Out')!
    expect(easeOut.tangentIn).toEqual({ time: -0.42, value: 0 })
    expect(easeOut.tangentOut).toEqual({ time: 0, value: 0 })
  })

  it('Ease In-Out preset has symmetric tangent offsets', () => {
    const easeInOut = EASING_PRESETS.find((p) => p.label === 'Ease In-Out')!
    expect(easeInOut.tangentIn).toEqual({ time: -0.42, value: 0 })
    expect(easeInOut.tangentOut).toEqual({ time: 0.42, value: 0 })
  })

  it('Quadratic preset has value offsets', () => {
    const quad = EASING_PRESETS.find((p) => p.label === 'Quadratic')!
    expect(quad.tangentIn).toEqual({ time: -0.75, value: -0.9 })
    expect(quad.tangentOut).toEqual({ time: 0.75, value: 0.9 })
  })

  it('Cubic preset matches Ease In-Out tangent shape', () => {
    const cubic = EASING_PRESETS.find((p) => p.label === 'Cubic')!
    expect(cubic.tangentIn).toEqual({ time: -0.42, value: 0 })
    expect(cubic.tangentOut).toEqual({ time: 0.42, value: 0 })
  })

  it('Quartic preset has asymmetric tangent offsets', () => {
    const quartic = EASING_PRESETS.find((p) => p.label === 'Quartic')!
    expect(quartic.tangentIn).toEqual({ time: -0.685, value: -0.78 })
    expect(quartic.tangentOut).toEqual({ time: 0.895, value: 0.03 })
  })

  it('Quintic preset has tangent time offsets only', () => {
    const quintic = EASING_PRESETS.find((p) => p.label === 'Quintic')!
    expect(quintic.tangentIn).toEqual({ time: -0.68, value: 0 })
    expect(quintic.tangentOut).toEqual({ time: 0.23, value: 0 })
  })

  it('Back preset has overshoot tangent values', () => {
    const back = EASING_PRESETS.find((p) => p.label === 'Back')!
    expect(back.tangentIn).toEqual({ time: 0.34, value: 1.56 })
    expect(back.tangentOut).toEqual({ time: -0.36, value: -0.28 })
  })
})

describe('findPresetByTangents', () => {
  it('returns the matching preset for exact tangent values', () => {
    const result = findPresetByTangents({ time: 0, value: 0 }, { time: 0.42, value: 0 })
    expect(result?.label).toBe('Ease In')
  })

  it('returns Linear for zero tangents', () => {
    const result = findPresetByTangents({ time: 0, value: 0 }, { time: 0, value: 0 })
    expect(result?.label).toBe('Linear')
  })

  it('returns Ease Out for its tangent values', () => {
    const result = findPresetByTangents({ time: -0.42, value: 0 }, { time: 0, value: 0 })
    expect(result?.label).toBe('Ease Out')
  })

  it('returns Ease In-Out for its tangent values', () => {
    const result = findPresetByTangents({ time: -0.42, value: 0 }, { time: 0.42, value: 0 })
    expect(result?.label).toBe('Ease In-Out')
  })

  it('returns Back for its tangent values', () => {
    const result = findPresetByTangents({ time: 0.34, value: 1.56 }, { time: -0.36, value: -0.28 })
    expect(result?.label).toBe('Back')
  })

  it('returns null for non-preset tangent values', () => {
    const result = findPresetByTangents({ time: -1.5, value: 0.5 }, { time: 0.5, value: -0.5 })
    expect(result).toBeNull()
  })

  it('returns null for zero tangents that do not match Linear (swapped)', () => {
    const result = findPresetByTangents({ time: 0.42, value: 0 }, { time: 0, value: 0 })
    expect(result).toBeNull()
  })

  it.each(EASING_PRESETS.map((p) => [p.label, p] as const))(
    'round-trips %s preset through findPresetByTangents',
    (_label, preset) => {
      const found = findPresetByTangents(preset.tangentIn, preset.tangentOut)
      // Cubic and Ease In-Out share identical tangent values; findPresetByTangents
      // returns the first match (Ease In-Out), so Cubic is not uniquely recoverable.
      if (preset.label === 'Cubic') {
        expect(found?.label).toBe('Ease In-Out')
      } else {
        expect(found).toBe(preset)
      }
    },
  )
})
