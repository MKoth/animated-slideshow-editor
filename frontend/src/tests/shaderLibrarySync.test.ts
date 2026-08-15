import { beforeEach, describe, expect, it } from 'vitest'
import type { ShaderDefinition } from '../api'
import { registerShaderLibrarySync } from '../app/librarySync'
import { ShaderLibrarySync } from '../engine/shaderLibrarySync'
import { createEngine } from '../engine/internal'
import { useShaderLibraryStore } from '../stores/shaderLibraryStore'

const INK_WASH: ShaderDefinition = {
  id: 's-1',
  name: 'Ink Wash',
  description: '',
  tags: [],
  created_at: '2026-08-15T12:00:00',
  updated_at: '2026-08-15T12:00:00',
  source: '#version 300 es\nvoid main() {}\n',
  default_uniforms: [],
  is_builtin: false,
}

const BLUE_WASH: ShaderDefinition = { ...INK_WASH, id: 's-2', name: 'Blue Wash' }

function setLibrary(definitions: ShaderDefinition[]): void {
  useShaderLibraryStore.setState({ definitions })
}

beforeEach(() => {
  useShaderLibraryStore.setState({ definitions: [] })
})

describe('shader library sync', () => {
  it('mirrors the definitions already in the store into the engine', () => {
    const engine = createEngine()
    const sync = new ShaderLibrarySync(engine)
    setLibrary([INK_WASH, BLUE_WASH])

    const dispose = registerShaderLibrarySync(sync)
    dispose()

    expect(engine.shaderDefinitions.map((definition) => definition.name)).toEqual([
      'Ink Wash',
      'Blue Wash',
    ])
    expect(engine.getShaderDefinition('s-1').name).toBe('Ink Wash')
    expect(engine.getShaderDefinition('s-2').name).toBe('Blue Wash')
  })

  it('registers definitions added to the store after the sync starts', () => {
    const engine = createEngine()
    registerShaderLibrarySync(new ShaderLibrarySync(engine))

    setLibrary([INK_WASH])

    expect(engine.shaderDefinitions).toHaveLength(1)
    expect(engine.getShaderDefinition('s-1').name).toBe('Ink Wash')
  })

  it('updates the engine name when the store definition is renamed', () => {
    const engine = createEngine()
    registerShaderLibrarySync(new ShaderLibrarySync(engine))
    setLibrary([INK_WASH])

    setLibrary([{ ...INK_WASH, name: 'Ink Wash Updated' }])

    expect(engine.getShaderDefinition('s-1').name).toBe('Ink Wash Updated')
  })

  it('never removes definitions the store no longer lists, so project definitions stay intact', () => {
    const engine = createEngine()
    registerShaderLibrarySync(new ShaderLibrarySync(engine))
    setLibrary([INK_WASH, BLUE_WASH])

    setLibrary([BLUE_WASH])

    expect(engine.shaderDefinitions.map((definition) => definition.id)).toEqual(['s-1', 's-2'])
    expect(engine.getShaderDefinition('s-1').name).toBe('Ink Wash')
  })

  it('stops syncing after dispose', () => {
    const engine = createEngine()
    const dispose = registerShaderLibrarySync(new ShaderLibrarySync(engine))
    dispose()

    setLibrary([INK_WASH])

    expect(engine.shaderDefinitions).toHaveLength(0)
  })
})
