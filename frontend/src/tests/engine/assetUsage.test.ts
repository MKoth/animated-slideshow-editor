import { describe, expect, it } from 'vitest'
import { createEngine as createEngineInternal } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import { countAssetUsage } from '../../engine/assetUsage'

function setup(): { engine: Engine; sceneId: string; rootId: string } {
  const engine = createEngineInternal()
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  return { engine, sceneId: slide.scene.id, rootId: slide.scene.root.id }
}

describe('countAssetUsage', () => {
  it('counts instance nodes referencing the definition across all slides', () => {
    const { engine, sceneId, rootId } = setup()
    const boy = engine.defineAsset('Boy')
    const girl = engine.defineAsset('Girl')
    engine.createAssetInstance(sceneId, rootId, boy.id, 'Boy')
    const slide2 = engine.createSlide('S2')
    engine.createAssetInstance(slide2.scene.id, slide2.scene.root.id, boy.id, 'Boy 2')
    engine.createAssetInstance(sceneId, rootId, girl.id, 'Girl')

    const project = engine.project
    expect(project).not.toBeNull()
    expect(countAssetUsage(project!, boy.id)).toBe(2)
    expect(countAssetUsage(project!, girl.id)).toBe(1)
  })

  it('returns zero when no node references the definition', () => {
    const { engine } = setup()
    const definition = engine.defineAsset('Boy')

    expect(countAssetUsage(engine.project!, definition.id)).toBe(0)
  })

  it('returns zero for an unknown definition id', () => {
    const { engine, sceneId, rootId } = setup()
    const boy = engine.defineAsset('Boy')
    engine.createAssetInstance(sceneId, rootId, boy.id, 'Boy')

    expect(countAssetUsage(engine.project!, 'ghost')).toBe(0)
  })

  it('ignores non-instance nodes such as text and the camera', () => {
    const { engine, sceneId, rootId } = setup()
    const definition = engine.defineAsset('Boy')
    engine.createNode(sceneId, rootId, 'Label', {
      components: { text: { kind: 'text', content: 'Hi', fontSize: 24, alignment: 'left' } },
    })

    expect(countAssetUsage(engine.project!, definition.id)).toBe(0)
  })
})
