import { describe, expect, it } from 'vitest'
import * as publicEngine from '../../engine'
import { createEngine as createEngineInternal } from '../../engine/internal'

const engineSources = import.meta.glob('../../engine/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('engine module boundary', () => {
  it('exposes only the read surface through the public barrel', () => {
    const exported = Object.keys(publicEngine)

    expect(exported).toContain('createEngine')
    expect(exported).not.toContain('Engine')
    expect(exported).not.toContain('createEngineInternal')

    const engine = publicEngine.createEngine()
    const runtimeKeys = Object.keys(engine) as string[]
    expect(runtimeKeys).toEqual(
      expect.arrayContaining(['subscribe', 'getSlide', 'getNode', 'getAssetDefinition', 'toJSON']),
    )
    for (const write of ['createProject', 'createSlide', 'removeSlide', 'createNode']) {
      expect((engine as unknown as Record<string, unknown>)[write]).toBeUndefined()
    }
  })

  it('gives full write access only through the internal entry point', () => {
    const engine = createEngineInternal()
    const project = engine.createProject({ name: 'P' })
    expect(project.id).toBeTruthy()

    const readOnly = publicEngine.createEngine()
    expect((readOnly as unknown as Record<string, unknown>).createProject).toBeUndefined()
  })

  it('keeps the write API out of the public engine facade module', () => {
    const facadeFile = Object.keys(engineSources).find((file) => file.endsWith('engine.ts'))
    const internalFile = Object.keys(engineSources).find((file) => file.endsWith('internal.ts'))

    expect(facadeFile).toBeDefined()
    expect(internalFile).toBeDefined()
    const facade = engineSources[facadeFile!]
    const internal = engineSources[internalFile!]

    expect(facade).not.toMatch(/createEngineInternal|export class Engine/)
    expect(internal).toMatch(/export class Engine/)
  })

  it('engine modules import no React, PixiJS, or AI dependencies', () => {
    const files = Object.keys(engineSources)

    expect(files.length).toBeGreaterThan(5)
    for (const [file, source] of Object.entries(engineSources)) {
      expect(source, file).not.toMatch(
        /from\s+['"](react|react-dom|pixi|@pixi[\w./]*|ai[\w./]*)['"]/,
      )
    }
  })
})
