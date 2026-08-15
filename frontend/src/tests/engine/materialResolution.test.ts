import { describe, expect, it } from 'vitest'
import type { MaterialOverrides } from '../../engine/materialInstance'
import {
  DEFAULT_OPACITY_MULTIPLIER,
  DEFAULT_TINT,
  resolveMaterial,
  type MaterialParameterDefault,
} from '../../engine/materialResolution'

const PARAMETERS: readonly MaterialParameterDefault[] = [
  { key: 'tint', kind: 'color', default: '#ff8800' },
  { key: 'opacityMultiplier', kind: 'number', default: 0.5 },
]

describe('material resolution', () => {
  it('resolves the instance override over the definition default', () => {
    const overrides: MaterialOverrides = { tint: '#123456', opacityMultiplier: 0.25 }

    const effective = resolveMaterial(PARAMETERS, overrides)

    expect(effective.tint).toBe('#123456')
    expect(effective.opacityMultiplier).toBe(0.25)
  })

  it('falls back to the definition default when a parameter is not overridden', () => {
    const effective = resolveMaterial(PARAMETERS, {})

    expect(effective.tint).toBe('#ff8800')
    expect(effective.opacityMultiplier).toBe(0.5)
  })

  it('falls back to the built-in defaults when the definition has no matching parameter', () => {
    const effective = resolveMaterial([], { someUniform: 2 })

    expect(effective.tint).toBe(DEFAULT_TINT)
    expect(effective.opacityMultiplier).toBe(DEFAULT_OPACITY_MULTIPLIER)
  })

  it('ignores a definition whose tint default is not a color string', () => {
    const definition: readonly MaterialParameterDefault[] = [
      { key: 'tint', kind: 'number', default: 7 },
    ]

    const effective = resolveMaterial(definition, {})

    expect(effective.tint).toBe(DEFAULT_TINT)
  })

  it('ignores an opacity multiplier override that is not a number', () => {
    const overrides: MaterialOverrides = { opacityMultiplier: '#ffffff' }

    const effective = resolveMaterial(PARAMETERS, overrides)

    expect(effective.opacityMultiplier).toBe(0.5)
  })

  it('clamps the opacity multiplier to the 0-1 parameter domain', () => {
    const overrides: MaterialOverrides = { opacityMultiplier: 2 }
    const negative: MaterialOverrides = { opacityMultiplier: -1 }

    expect(resolveMaterial(PARAMETERS, overrides).opacityMultiplier).toBe(1)
    expect(resolveMaterial(PARAMETERS, negative).opacityMultiplier).toBe(0)
  })

  it('writes into a provided target without allocating', () => {
    const target = { tint: DEFAULT_TINT, opacityMultiplier: DEFAULT_OPACITY_MULTIPLIER }

    const result = resolveMaterial(PARAMETERS, { tint: '#00ff00' }, target)

    expect(result).toBe(target)
    expect(target.tint).toBe('#00ff00')
    expect(target.opacityMultiplier).toBe(0.5)
  })
})
