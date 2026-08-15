import { beforeEach, describe, expect, it } from 'vitest'
import type { MaterialDefinition } from '../api'
import { registerMaterialLibrarySync } from '../app/librarySync'
import { MaterialLibrarySync } from '../engine/materialLibrarySync'
import { createEngine } from '../engine/internal'
import { useMaterialLibraryStore } from '../stores/materialLibraryStore'

const RED_SLIME: MaterialDefinition = {
  id: 'mat-1',
  name: 'Red Slime',
  description: '',
  tags: [],
  created_at: '2026-08-15T12:00:00',
  updated_at: '2026-08-15T12:00:00',
  parameters: [
    { key: 'tint', kind: 'color', default: '#ffffff' },
    { key: 'opacityMultiplier', kind: 'number', default: 1 },
  ],
}

const BLUE_SLIME: MaterialDefinition = { ...RED_SLIME, id: 'mat-2', name: 'Blue Slime' }

function setLibrary(definitions: MaterialDefinition[]): void {
  useMaterialLibraryStore.setState({ definitions })
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

    expect(engine.materialDefinitions.map((definition) => definition.name)).toEqual([
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

    expect(engine.materialDefinitions).toHaveLength(1)
    expect(engine.getMaterialDefinition('mat-1').name).toBe('Red Slime')
  })

  it('updates the engine name when the store definition is renamed', () => {
    const engine = createEngine()
    registerMaterialLibrarySync(new MaterialLibrarySync(engine))
    setLibrary([RED_SLIME])

    setLibrary([{ ...RED_SLIME, name: 'Red Slime Updated' }])

    expect(engine.getMaterialDefinition('mat-1').name).toBe('Red Slime Updated')
  })

  it('never removes definitions the store no longer lists, so project definitions stay intact', () => {
    const engine = createEngine()
    registerMaterialLibrarySync(new MaterialLibrarySync(engine))
    setLibrary([RED_SLIME, BLUE_SLIME])

    setLibrary([BLUE_SLIME])

    expect(engine.materialDefinitions.map((definition) => definition.id)).toEqual([
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

    expect(engine.materialDefinitions).toHaveLength(0)
  })
})
