import { describe, expect, it } from 'vitest'
import type { MaterialOverrides } from '../../engine/materialInstance'
import {
  DEFAULT_OPACITY_MULTIPLIER,
  DEFAULT_TINT,
  copyShaderUniforms,
  effectiveShaderScratch,
  resolveMaterial,
  resolveParameterValue,
  resolveShaderUniforms,
  shaderUniformsEqual,
  type MaterialParameterDefault,
} from '../../engine/materialResolution'

const PARAMETERS: readonly MaterialParameterDefault[] = [
  { key: 'tint', kind: 'color', default: '#ff8800' },
  { key: 'opacityMultiplier', kind: 'number', default: 0.5 },
]

const UNIFORM_PARAMETERS: readonly MaterialParameterDefault[] = [
  { key: 'uIntensity', kind: 'float', default: 0.5 },
  { key: 'uEnabled', kind: 'bool', default: false },
  { key: 'uColor', kind: 'vec3', default: [1, 0, 0] },
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

describe('resolveParameterValue', () => {
  it('resolves an instance override over the definition default for shader uniforms', () => {
    const overrides: MaterialOverrides = { uIntensity: 0.9 }

    expect(resolveParameterValue(UNIFORM_PARAMETERS, overrides, 'uIntensity')).toBe(0.9)
  })

  it('falls back to the definition default when the uniform is not overridden', () => {
    expect(resolveParameterValue(UNIFORM_PARAMETERS, {}, 'uIntensity')).toBe(0.5)
    expect(resolveParameterValue(UNIFORM_PARAMETERS, {}, 'uEnabled')).toBe(false)
    expect(resolveParameterValue(UNIFORM_PARAMETERS, {}, 'uColor')).toEqual([1, 0, 0])
  })

  it('returns undefined for a parameter neither overridden nor defined', () => {
    expect(resolveParameterValue(UNIFORM_PARAMETERS, {}, 'uMissing')).toBeUndefined()
  })

  it('treats a falsey override as present', () => {
    const overrides = { uEnabled: false }

    expect(resolveParameterValue(UNIFORM_PARAMETERS, overrides, 'uEnabled')).toBe(false)
  })
})

describe('resolveShaderUniforms', () => {
  const SHADER_PARAMETERS: readonly MaterialParameterDefault[] = [
    { key: 'tint', kind: 'color', default: '#ffffff' },
    { key: 'opacityMultiplier', kind: 'number', default: 1 },
    { key: 'uIntensity', kind: 'float', default: 0.5 },
    { key: 'uEnabled', kind: 'bool', default: false },
    { key: 'uColor', kind: 'vec3', default: [1, 0, 0] },
    { key: 'uPhoto', kind: 'sampler2D', default: 'def-photo' },
  ]

  it('collects the shader-uniform parameters with values resolved override over default', () => {
    const scratch = resolveShaderUniforms(SHADER_PARAMETERS, { uIntensity: 0.9 })

    expect(scratch.keys).toEqual(['uIntensity', 'uEnabled', 'uColor'])
    expect(scratch.kinds).toEqual(['float', 'bool', 'vec3'])
    expect(scratch.values).toEqual([0.9, false, [1, 0, 0]])
  })

  it('excludes the built-in tint and opacity multiplier parameters', () => {
    const scratch = resolveShaderUniforms(SHADER_PARAMETERS, {})

    expect(scratch.keys).not.toContain('tint')
    expect(scratch.keys).not.toContain('opacityMultiplier')
  })

  it('excludes sampler2D parameters — samplers are not scalar uniforms', () => {
    const scratch = resolveShaderUniforms(SHADER_PARAMETERS, {})

    expect(scratch.keys).not.toContain('uPhoto')
  })

  it('collects sampler2D parameters as key/asset-id bindings resolved override over default', () => {
    const scratch = resolveShaderUniforms(SHADER_PARAMETERS, { uPhoto: 'override-photo' })

    expect(scratch.samplers).toEqual([{ key: 'uPhoto', assetDefinitionId: 'override-photo' }])
  })

  it('falls back to the definition default for an unoverridden sampler', () => {
    const scratch = resolveShaderUniforms(SHADER_PARAMETERS, {})

    expect(scratch.samplers).toEqual([{ key: 'uPhoto', assetDefinitionId: 'def-photo' }])
  })

  it('resolves an empty or missing sampler value to no binding', () => {
    const empty = resolveShaderUniforms(SHADER_PARAMETERS, { uPhoto: '' })

    expect(empty.samplers[0].assetDefinitionId).toBeNull()
    expect(
      resolveShaderUniforms(
        [
          ...SHADER_PARAMETERS,
          { key: 'uOther', kind: 'sampler2D', default: undefined as unknown as string },
        ],
        {},
      ).samplers,
    ).toContainEqual({ key: 'uOther', assetDefinitionId: null })
  })

  it('collects nothing for a shader-less material parameter list', () => {
    const scratch = resolveShaderUniforms(
      [
        { key: 'tint', kind: 'color', default: '#ffffff' },
        { key: 'opacityMultiplier', kind: 'number', default: 1 },
      ],
      {},
    )

    expect(scratch.keys).toEqual([])
    expect(scratch.values).toEqual([])
  })

  it('reuses a provided scratch target without allocating', () => {
    const target = effectiveShaderScratch()

    const result = resolveShaderUniforms(SHADER_PARAMETERS, {}, target)

    expect(result).toBe(target)
    expect(result.keys).toEqual(['uIntensity', 'uEnabled', 'uColor'])
  })
})

describe('shaderUniformsEqual', () => {
  const PARAMETERS: readonly MaterialParameterDefault[] = [
    { key: 'uIntensity', kind: 'float', default: 0.5 },
    { key: 'uColor', kind: 'vec3', default: [1, 0, 0] },
  ]

  it('reports equal for identical resolutions', () => {
    const first = resolveShaderUniforms(PARAMETERS, { uIntensity: 0.7 })
    const second = resolveShaderUniforms(PARAMETERS, { uIntensity: 0.7 })

    expect(shaderUniformsEqual(first, second)).toBe(true)
  })

  it('reports a scalar value change', () => {
    const first = resolveShaderUniforms(PARAMETERS, { uIntensity: 0.7 })
    const second = resolveShaderUniforms(PARAMETERS, { uIntensity: 0.8 })

    expect(shaderUniformsEqual(first, second)).toBe(false)
  })

  it('reports a vector component change', () => {
    const first = resolveShaderUniforms(PARAMETERS, {})
    const changed: readonly MaterialParameterDefault[] = [
      { key: 'uIntensity', kind: 'float', default: 0.5 },
      { key: 'uColor', kind: 'vec3', default: [1, 1, 0] },
    ]
    const second = resolveShaderUniforms(changed, {})

    expect(shaderUniformsEqual(first, second)).toBe(false)
  })

  it('reports a parameter-list change', () => {
    const first = resolveShaderUniforms(PARAMETERS, {})
    const second = resolveShaderUniforms([PARAMETERS[0]], {})

    expect(shaderUniformsEqual(first, second)).toBe(false)
  })

  it('reports a kind change even when the value is equal', () => {
    const first = resolveShaderUniforms(PARAMETERS, {})
    const changed: readonly MaterialParameterDefault[] = [
      { key: 'uIntensity', kind: 'int', default: 0.5 },
      { key: 'uColor', kind: 'vec3', default: [1, 0, 0] },
    ]
    const second = resolveShaderUniforms(changed, {})

    expect(second.keys).toEqual(first.keys)
    expect(second.values[0]).toBe(first.values[0])
    expect(shaderUniformsEqual(first, second)).toBe(false)
  })

  it('reports a sampler asset change', () => {
    const parameters: readonly MaterialParameterDefault[] = [
      { key: 'uPhoto', kind: 'sampler2D', default: 'photo-a' },
    ]
    const first = resolveShaderUniforms(parameters, {})
    const second = resolveShaderUniforms(parameters, { uPhoto: 'photo-b' })

    expect(shaderUniformsEqual(first, second)).toBe(false)
  })

  it('reports a sampler appearing or disappearing', () => {
    const withSampler: readonly MaterialParameterDefault[] = [
      { key: 'uPhoto', kind: 'sampler2D', default: 'photo-a' },
    ]

    expect(
      shaderUniformsEqual(resolveShaderUniforms(withSampler, {}), resolveShaderUniforms([], {})),
    ).toBe(false)
    expect(
      shaderUniformsEqual(
        resolveShaderUniforms(withSampler, {}),
        resolveShaderUniforms(withSampler, { uPhoto: 'photo-a' }),
      ),
    ).toBe(true)
  })

  it('reports not equal when there is no previous state', () => {
    const next = resolveShaderUniforms(PARAMETERS, {})

    expect(shaderUniformsEqual(undefined, next)).toBe(false)
  })
})

describe('copyShaderUniforms', () => {
  it('copies the scalar uniforms and sampler bindings into a reusable target', () => {
    const source = resolveShaderUniforms(
      [
        { key: 'uIntensity', kind: 'float', default: 0.5 },
        { key: 'uPhoto', kind: 'sampler2D', default: 'photo-a' },
      ],
      { uIntensity: 0.9 },
    )
    const target = effectiveShaderScratch()

    copyShaderUniforms(target, source)

    expect(target).not.toBe(source)
    expect(target.source).toBe(source.source)
    expect(target.keys).toEqual(['uIntensity'])
    expect(target.values).toEqual([0.9])
    expect(target.samplers).toEqual([{ key: 'uPhoto', assetDefinitionId: 'photo-a' }])
    expect(shaderUniformsEqual(target, source)).toBe(true)
  })

  it('replaces the previous sampler bindings when copying over a used target', () => {
    const first = resolveShaderUniforms(
      [{ key: 'uPhoto', kind: 'sampler2D', default: 'photo-a' }],
      {},
    )
    const second = resolveShaderUniforms(
      [{ key: 'uPhoto', kind: 'sampler2D', default: 'photo-b' }],
      {},
    )
    const target = effectiveShaderScratch()

    copyShaderUniforms(target, first)
    copyShaderUniforms(target, second)

    expect(target.samplers).toEqual([{ key: 'uPhoto', assetDefinitionId: 'photo-b' }])
  })
})
