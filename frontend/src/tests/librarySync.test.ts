import { beforeEach, describe, expect, it } from 'vitest'
import type { AssetDefinition } from '../api'
import { registerLibrarySync } from '../app/librarySync'
import { AssetLibrarySync } from '../engine/assetLibrarySync'
import { createEngine } from '../engine/internal'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'

const BOY: AssetDefinition = {
  id: 'lib-1',
  name: 'Boy',
  category: 'Character',
  tags: [],
  description: '',
  ai_description: '',
  original_filename: 'boy.png',
  import_date: '2026-08-12T10:00:00',
  width: 100,
  height: 80,
  file_size: 1024,
  aspect_ratio: 1.25,
  default_scale: 1,
  default_rotation: 0,
  pivot: { x: 0.5, y: 0.5 },
  anchors: [],
  original_url: '/api/assets/originals/lib-1.png',
  thumbnail_url: '/api/assets/thumbnails/lib-1.png',
}

const GIRL: AssetDefinition = { ...BOY, id: 'lib-2', name: 'Girl' }

function setLibrary(definitions: AssetDefinition[]): void {
  useAssetLibraryStore.setState({ allDefinitions: definitions })
}

beforeEach(() => {
  useAssetLibraryStore.setState({ definitions: [], allDefinitions: [] })
})

describe('library sync', () => {
  it('mirrors the definitions already in the store into the engine', () => {
    const engine = createEngine()
    const sync = new AssetLibrarySync(engine)
    setLibrary([BOY, GIRL])

    const dispose = registerLibrarySync(sync)
    dispose()

    expect(engine.assetDefinitions.map((definition) => definition.name)).toEqual(['Boy', 'Girl'])
    expect(engine.getAssetDefinition('lib-1').name).toBe('Boy')
    expect(engine.getAssetDefinition('lib-2').name).toBe('Girl')
  })

  it('registers definitions added to the store after the sync starts', () => {
    const engine = createEngine()
    registerLibrarySync(new AssetLibrarySync(engine))

    setLibrary([BOY])

    expect(engine.assetDefinitions).toHaveLength(1)
    expect(engine.getAssetDefinition('lib-1').name).toBe('Boy')
  })

  it('updates the engine name when the store definition is renamed', () => {
    const engine = createEngine()
    registerLibrarySync(new AssetLibrarySync(engine))
    setLibrary([BOY])

    setLibrary([{ ...BOY, name: 'Boy Updated' }])

    expect(engine.getAssetDefinition('lib-1').name).toBe('Boy Updated')
  })

  it('removes library definitions the backend no longer lists, so deleted assets stop resolving', () => {
    const engine = createEngine()
    registerLibrarySync(new AssetLibrarySync(engine))
    setLibrary([BOY, GIRL])

    setLibrary([GIRL])

    expect(engine.assetDefinitions.map((definition) => definition.id)).toEqual(['lib-2'])
    expect(() => engine.getAssetDefinition('lib-1')).toThrow()
  })

  it('keeps project definitions that the sync never added, even when ids overlap the removals', () => {
    const engine = createEngine()
    const projectDefinition = engine.defineAsset('From Lesson File')
    registerLibrarySync(new AssetLibrarySync(engine))
    setLibrary([BOY, GIRL])

    setLibrary([GIRL])

    expect(engine.assetDefinitions.map((definition) => definition.id)).toEqual([
      projectDefinition.id,
      'lib-2',
    ])
    expect(engine.getAssetDefinition(projectDefinition.id).name).toBe('From Lesson File')
  })

  it('syncs the full library even when the scoped panel display is empty', () => {
    const engine = createEngine()
    registerLibrarySync(new AssetLibrarySync(engine))

    // Browsing an empty folder: display list is empty but the full mirror is not.
    useAssetLibraryStore.setState({ definitions: [], allDefinitions: [BOY] })

    expect(engine.assetDefinitions.map((definition) => definition.name)).toEqual(['Boy'])
  })

  it('drops ids added by apply once a full sync no longer lists them', () => {
    const engine = createEngine()
    const sync = new AssetLibrarySync(engine)
    registerLibrarySync(sync)
    sync.apply([{ id: 'lib-1', name: 'Boy' }])
    expect(engine.assetDefinitions).toHaveLength(1)

    setLibrary([])

    expect(engine.assetDefinitions).toHaveLength(0)
  })

  it('stops syncing after dispose', () => {
    const engine = createEngine()
    const dispose = registerLibrarySync(new AssetLibrarySync(engine))
    dispose()

    setLibrary([BOY])

    expect(engine.assetDefinitions).toHaveLength(0)
  })
})
