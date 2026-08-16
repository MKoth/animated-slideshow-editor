import { describe, expect, it } from 'vitest'
import { requireMaterialKeyframeValue } from '../../engine/materialKeyframes'

describe('requireMaterialKeyframeValue per-kind validation', () => {
  it('accepts integer values for int and rejects non-integers', () => {
    expect(requireMaterialKeyframeValue('int', 2)).toBe(2)
    expect(requireMaterialKeyframeValue('int', 0)).toBe(0)
    expect(requireMaterialKeyframeValue('int', -3)).toBe(-3)
    expect(() => requireMaterialKeyframeValue('int', 2.5)).toThrow(/integer/i)
    expect(() => requireMaterialKeyframeValue('int', '2')).toThrow(/integer/i)
    expect(() => requireMaterialKeyframeValue('int', Number.NaN)).toThrow(/integer/i)
  })

  it('accepts booleans for bool and rejects anything else', () => {
    expect(requireMaterialKeyframeValue('bool', true)).toBe(true)
    expect(requireMaterialKeyframeValue('bool', false)).toBe(false)
    expect(() => requireMaterialKeyframeValue('bool', 1)).toThrow(/boolean/i)
    expect(() => requireMaterialKeyframeValue('bool', 'true')).toThrow(/boolean/i)
  })

  it('accepts a non-empty asset id string for sampler2D and rejects empty or non-string', () => {
    expect(requireMaterialKeyframeValue('sampler2D', 'asset-1')).toBe('asset-1')
    expect(() => requireMaterialKeyframeValue('sampler2D', '')).toThrow(/string/i)
    expect(() => requireMaterialKeyframeValue('sampler2D', 42)).toThrow(/string/i)
  })

  it('accepts six-digit hex colors for color and rejects non-hex', () => {
    expect(requireMaterialKeyframeValue('color', '#ff0000')).toBe('#ff0000')
    expect(requireMaterialKeyframeValue('color', '#FFAA00')).toBe('#FFAA00')
    expect(() => requireMaterialKeyframeValue('color', 'red')).toThrow(/hex/i)
    expect(() => requireMaterialKeyframeValue('color', '#fff')).toThrow(/hex/i)
    expect(() => requireMaterialKeyframeValue('color', '#ff00000')).toThrow(/hex/i)
    expect(() => requireMaterialKeyframeValue('color', 42)).toThrow(/hex/i)
  })

  it('accepts finite numbers for number and float', () => {
    expect(requireMaterialKeyframeValue('number', 0.5)).toBe(0.5)
    expect(requireMaterialKeyframeValue('float', 1.25)).toBe(1.25)
    expect(() => requireMaterialKeyframeValue('number', 'x')).toThrow(/number/i)
    expect(() => requireMaterialKeyframeValue('float', Number.POSITIVE_INFINITY)).toThrow(/number/i)
  })

  it('accepts vectors whose length matches the kind and rejects wrong lengths', () => {
    expect(requireMaterialKeyframeValue('vec2', [0.1, 0.2])).toEqual([0.1, 0.2])
    expect(requireMaterialKeyframeValue('vec3', [1, 0, 0])).toEqual([1, 0, 0])
    expect(requireMaterialKeyframeValue('vec4', [0, 0, 0, 0])).toEqual([0, 0, 0, 0])
    expect(() => requireMaterialKeyframeValue('vec2', [0.1])).toThrow(/length/i)
    expect(() => requireMaterialKeyframeValue('vec2', [0.1, 0.2, 0.3])).toThrow(/length/i)
    expect(() => requireMaterialKeyframeValue('vec3', [1, 0])).toThrow(/length/i)
    expect(() => requireMaterialKeyframeValue('vec4', [0, 0, 0])).toThrow(/length/i)
    expect(() => requireMaterialKeyframeValue('vec2', [0.1, 'a'])).toThrow(/number/i)
  })

  it('accepts override-shaped values for unknown kinds and rejects malformed ones', () => {
    expect(requireMaterialKeyframeValue('weird', 1)).toBe(1)
    expect(requireMaterialKeyframeValue('weird', 'x')).toBe('x')
    expect(requireMaterialKeyframeValue('weird', true)).toBe(true)
    expect(requireMaterialKeyframeValue('weird', [1, 2])).toEqual([1, 2])
    expect(() => requireMaterialKeyframeValue('weird', {})).toThrow()
    expect(() => requireMaterialKeyframeValue('weird', '')).toThrow()
  })
})
