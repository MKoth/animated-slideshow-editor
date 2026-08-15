import { beforeEach, describe, expect, it } from 'vitest'
import type { MaterialDefinition } from '../api'
import { registerMaterialLibrarySync } from '../app/librarySync'
import { MaterialLibrarySync } from '../engine/materialLibrarySync'
import type { MaterialDefinition as EngineMaterialDefinition } from '../engine/materialDefinition'
import { createEngine } from '../engine/internal'
import { DEFAULT_MATERIAL_DEFINITION_ID } from '../engine/materialInstance'
import { useMaterialLibraryStore } from '../stores/materialLibraryStore'

const RED_SLIME: MaterialDefinition = {
  id: 'mat-1',
  name: 'Red Slime',
  description: '',
  tags: [],
  created_at: '2026-08-15T12:00:00',
  updated_at: '2026-08-15T12:00:00',
  shader_id: null,
  parameters: [
    { key: 'tint', kind: 'color', default: '#ffffff' },
    { key: 'opacityMultiplier', kind: 'number', default: 1 },
  ],
}

const BLUE_SLIME: MaterialDefinition = { ...RED_SLIME, id: 'mat-2', name: 'Blue Slime' }

function setLibrary(definitions: MaterialDefinition[]): void {
  useMaterialLibraryStore.setState({ definitions })
}

function libraryDefinitions(
  engine: ReturnType<typeof createEngine>,
): readonly EngineMaterialDefinition[] {
  return engine.materialDefinitions.filter(
    (definition) => definition.id !== DEFAULT_MATERIAL_DEFINITION_ID,
  )
}

beforeEach(() => {
  useMaterialLibraryStore.setState({ definitions: [] })
})

describe('material library sync', () => {
  it('mirrors the definitions already in the store into the engine', () => {
    const engine = createEngine()
    const sync = new MaterialLibrarySync(engine)
    setLibrary([RED_SLIME, BLUE_SLIME])

    const dispose = registerMaterialLibrarySync(sync)
    dispose()

    expect(libraryDefinitions(engine).map((definition) => definition.name)).toEqual([
      'Red Slime',
      'Blue Slime',
    ])
    expect(engine.getMaterialDefinition('mat-1').name).toBe('Red Slime')
    expect(engine.getMaterialDefinition('mat-2').name).toBe('Blue Slime')
  })

  it('registers definitions added to the store after the sync starts', () => {
    const engine = createEngine()
    registerMaterialLibrarySync(new MaterialLibrarySync(engine))

    setLibrary([RED_SLIME])

    expect(libraryDefinitions(engine)).toHaveLength(1)
    expect(engine.getMaterialDefinition('mat-1').name).toBe('Red Slime')
  })

  it('updates the engine name when the store definition is renamed', () => {
    const engine = createEngine()
    registerMaterialLibrarySync(new MaterialLibrarySync(engine))
    setLibrary([RED_SLIME])

    setLibrary([{ ...RED_SLIME, name: 'Red Slime Updated' }])

    expect(engine.getMaterialDefinition('mat-1').name).toBe('Red Slime Updated')
  })

  it('registers the shader reference of a material into the engine', () => {
    const engine = createEngine()
    registerMaterialLibrarySync(new MaterialLibrarySync(engine))
    setLibrary([{ ...RED_SLIME, shader_id: 'shader-1' }])

    expect(engine.getMaterialDefinition('mat-1').shaderId).toBe('shader-1')
    expect(engine.getMaterialDefinition('mat-1').parameters).toEqual(RED_SLIME.parameters)
  })

  it('never removes definitions the store no longer lists, so project definitions stay intact', () => {
    const engine = createEngine()
    registerMaterialLibrarySync(new MaterialLibrarySync(engine))
    setLibrary([RED_SLIME, BLUE_SLIME])

    setLibrary([BLUE_SLIME])

    expect(libraryDefinitions(engine).map((definition) => definition.id)).toEqual([
      'mat-1',
      'mat-2',
    ])
    expect(engine.getMaterialDefinition('mat-1').name).toBe('Red Slime')
  })

  it('stops syncing after dispose', () => {
    const engine = createEngine()
    const dispose = registerMaterialLibrarySync(new MaterialLibrarySync(engine))
    dispose()

    setLibrary([RED_SLIME])

    expect(libraryDefinitions(engine)).toHaveLength(0)
  })
})
