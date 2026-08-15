import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'

describe('material definitions', () => {
  it('registers a library definition under its existing id and name', () => {
    const engine = createEngine()

    engine.registerMaterialDefinition('mat-1', 'Red Slime')

    const definition = engine.getMaterialDefinition('mat-1')
    expect(definition.name).toBe('Red Slime')
  })

  it('re-registering the same id updates the name without creating a duplicate', () => {
    const engine = createEngine()
    engine.registerMaterialDefinition('mat-1', 'Red Slime')

    engine.registerMaterialDefinition('mat-1', 'Red Slime Updated')

    expect(engine.materialDefinitions).toHaveLength(1)
    expect(engine.getMaterialDefinition('mat-1').name).toBe('Red Slime Updated')
  })

  it('keeps registered definitions immutable', () => {
    const engine = createEngine()
    engine.registerMaterialDefinition('mat-1', 'Red Slime')

    const definition = engine.getMaterialDefinition('mat-1')

    expect(() => {
      ;(definition as { name: string }).name = 'Changed'
    }).toThrow()
    expect(definition.name).toBe('Red Slime')
  })

  it('fails to fetch an unknown definition', () => {
    const engine = createEngine()

    expect(() => engine.getMaterialDefinition('ghost')).toThrow(/definition.*not found/i)
  })

  it('rejects an empty registered name', () => {
    const engine = createEngine()

    expect(() => engine.registerMaterialDefinition('mat-1', '')).toThrow(/name/i)
  })
})
