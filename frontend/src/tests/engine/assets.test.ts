import { describe, expect, it } from 'vitest'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'

function setup(): { engine: Engine; sceneId: string; rootId: string } {
  const engine = createEngine()
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  return { engine, sceneId: slide.scene.id, rootId: slide.scene.root.id }
}

describe('asset definitions', () => {
  it('creates an immutable definition with an id and name', () => {
    const { engine } = setup()

    const definition = engine.defineAsset('Fox')

    expect(definition.name).toBe('Fox')
    expect(engine.getAssetDefinition(definition.id)).toBe(definition)
    expect(() => {
      ;(definition as { name: string }).name = 'Wolf'
    }).toThrow()
    expect(definition.name).toBe('Fox')
  })

  it('rejects an empty definition name', () => {
    const { engine } = setup()

    expect(() => engine.defineAsset('')).toThrow(/name/i)
  })

  it('fails to fetch an unknown definition', () => {
    const { engine } = setup()

    expect(() => engine.getAssetDefinition('ghost')).toThrow(/definition.*not found/i)
  })
})

describe('asset instances', () => {
  it('creates an instance node referencing a definition', () => {
    const { engine, sceneId, rootId } = setup()
    const definition = engine.defineAsset('Fox')

    const node = engine.createAssetInstance(sceneId, rootId, definition.id, 'Fox A')

    expect(node.name).toBe('Fox A')
    expect(node.components.assetInstance?.kind).toBe('assetInstance')
    expect(node.components.assetInstance?.assetDefinitionId).toBe(definition.id)
    expect(node.parent?.id).toBe(rootId)
  })

  it('rejects an unknown definition id', () => {
    const { engine, sceneId, rootId } = setup()

    expect(() => engine.createAssetInstance(sceneId, rootId, 'ghost', 'Fox A')).toThrow(
      /definition.*not found/i,
    )
  })

  it('carries its own transform and visibility without touching the definition', () => {
    const { engine, sceneId, rootId } = setup()
    const definition = engine.defineAsset('Fox')

    const node = engine.createAssetInstance(sceneId, rootId, definition.id, 'Fox A', {
      transform: { x: 5, y: 5, rotation: 0, scaleX: 1, scaleY: 1 },
      visible: false,
    })
    engine.setTransform(node.id, { x: 25, y: 40, rotation: 0.25, scaleX: 2, scaleY: 2 })
    engine.setVisibility(node.id, true)

    expect(node.transform).toEqual({ x: 25, y: 40, rotation: 0.25, scaleX: 2, scaleY: 2 })
    expect(node.visible).toBe(true)
    expect(definition.name).toBe('Fox')
  })

  it('keeps the definition reference immutable', () => {
    const { engine, sceneId, rootId } = setup()
    const definition = engine.defineAsset('Fox')
    const node = engine.createAssetInstance(sceneId, rootId, definition.id, 'Fox A')

    expect(() => {
      ;(node.components.assetInstance as { assetDefinitionId: string }).assetDefinitionId = 'other'
    }).toThrow()
    expect(node.components.assetInstance?.assetDefinitionId).toBe(definition.id)
  })

  it('rejects unknown parents or scenes like any node', () => {
    const { engine, rootId } = setup()
    const definition = engine.defineAsset('Fox')

    expect(() => engine.createAssetInstance('ghost-scene', rootId, definition.id, 'X')).toThrow(
      /scene.*not found/i,
    )
  })
})

describe('text component', () => {
  it('carries content, font size, and alignment', () => {
    const { engine, sceneId, rootId } = setup()

    const node = engine.createNode(sceneId, rootId, 'Label', {
      components: { text: { kind: 'text', content: 'Hello', fontSize: 24, alignment: 'right' } },
    })

    expect(node.components.text).toEqual({
      kind: 'text',
      content: 'Hello',
      fontSize: 24,
      alignment: 'right',
    })
  })

  it('is immutable once attached', () => {
    const { engine, sceneId, rootId } = setup()
    const node = engine.createNode(sceneId, rootId, 'Label', {
      components: { text: { kind: 'text', content: 'Hello', fontSize: 24, alignment: 'left' } },
    })

    expect(() => {
      ;(node.components.text as { content: string }).content = 'Changed'
    }).toThrow()
    expect(node.components.text?.content).toBe('Hello')
  })
})
