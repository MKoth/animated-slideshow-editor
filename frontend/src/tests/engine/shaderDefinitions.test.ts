import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'

describe('shader definitions', () => {
  it('registers a library definition under its existing id and name', () => {
    const engine = createEngine()

    engine.registerShaderDefinition('s-1', 'Ink Wash')

    const definition = engine.getShaderDefinition('s-1')
    expect(definition.name).toBe('Ink Wash')
  })

  it('re-registering the same id updates the name without creating a duplicate', () => {
    const engine = createEngine()
    engine.registerShaderDefinition('s-1', 'Ink Wash')

    engine.registerShaderDefinition('s-1', 'Ink Wash Updated')

    expect(engine.shaderDefinitions).toHaveLength(1)
    expect(engine.getShaderDefinition('s-1').name).toBe('Ink Wash Updated')
  })

  it('keeps registered definitions immutable', () => {
    const engine = createEngine()
    engine.registerShaderDefinition('s-1', 'Ink Wash')

    const definition = engine.getShaderDefinition('s-1')

    expect(() => {
      ;(definition as { name: string }).name = 'Changed'
    }).toThrow()
    expect(definition.name).toBe('Ink Wash')
  })

  it('fails to fetch an unknown definition', () => {
    const engine = createEngine()

    expect(() => engine.getShaderDefinition('ghost')).toThrow(/definition.*not found/i)
  })

  it('rejects an empty registered name', () => {
    const engine = createEngine()

    expect(() => engine.registerShaderDefinition('s-1', '')).toThrow(/name/i)
  })
})
