import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import { collectEvents } from './helpers'
import type { LessonJSON } from '../../engine/json'

function setup() {
  const engine = createEngine()
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  return {
    engine,
    slide,
    sceneId: slide.scene.id,
    rootId: slide.scene.root.id,
    cameraId: slide.scene.camera.id,
  }
}

describe('node opacity', () => {
  it('defaults to 1 for every node: root, camera, plain nodes, asset instances, text nodes', () => {
    const { engine, sceneId, rootId } = setup()
    const definition = engine.defineAsset('Fox')

    const plain = engine.createNode(sceneId, rootId, 'Plain')
    const instance = engine.createAssetInstance(sceneId, rootId, definition.id, 'Fox A')
    const text = engine.createNode(sceneId, rootId, 'Label', {
      components: { text: { kind: 'text', content: 'Hi', fontSize: 12, alignment: 'center' } },
    })

    const slide = engine.project?.slides[0]
    expect(slide?.scene.root.opacity).toBe(1)
    expect(slide?.scene.camera.opacity).toBe(1)
    expect(plain.opacity).toBe(1)
    expect(instance.opacity).toBe(1)
    expect(text.opacity).toBe(1)
  })

  it('accepts an explicit opacity in [0, 1] at creation', () => {
    const { engine, sceneId, rootId } = setup()
    const node = engine.createNode(sceneId, rootId, 'A', { opacity: 0.25 })
    expect(node.opacity).toBe(0.25)
  })

  it('rejects opacity outside [0, 1] and non-finite values at creation', () => {
    const { engine, sceneId, rootId } = setup()
    const events = collectEvents(engine)

    expect(() => engine.createNode(sceneId, rootId, 'A', { opacity: 1.5 })).toThrow(/opacity/i)
    expect(() => engine.createNode(sceneId, rootId, 'B', { opacity: -0.1 })).toThrow(/opacity/i)
    expect(() => engine.createNode(sceneId, rootId, 'C', { opacity: Number.NaN })).toThrow(
      /opacity/i,
    )

    expect(events).toEqual([])
  })

  it('rejects out-of-range and non-finite opacity via setOpacity and emits nothing', () => {
    const { engine, sceneId, rootId } = setup()
    const node = engine.createNode(sceneId, rootId, 'A')
    const events = collectEvents(engine)

    expect(() => engine.setOpacity(node.id, 2)).toThrow(/opacity/i)
    expect(() => engine.setOpacity(node.id, -0.5)).toThrow(/opacity/i)
    expect(() => engine.setOpacity(node.id, Number.POSITIVE_INFINITY)).toThrow(/opacity/i)

    expect(node.opacity).toBe(1)
    expect(events).toEqual([])
  })

  it('setOpacity updates the value and emits OpacityChanged with the node id', () => {
    const { engine, sceneId, rootId } = setup()
    const node = engine.createNode(sceneId, rootId, 'A')
    const events = collectEvents(engine)

    engine.setOpacity(node.id, 0.75)

    expect(node.opacity).toBe(0.75)
    expect(events).toEqual([{ type: 'OpacityChanged', nodeId: node.id }])
  })

  it('rejects setOpacity for a nonexistent node', () => {
    const { engine } = setup()

    expect(() => engine.setOpacity('ghost', 0.5)).toThrow(/node.*not found/i)
  })
})

describe('node rename', () => {
  it('renames a node and emits NodeRenamed with the node id', () => {
    const { engine, sceneId, rootId } = setup()
    const node = engine.createNode(sceneId, rootId, 'Old')
    const events = collectEvents(engine)

    engine.renameNode(node.id, 'New')

    expect(node.name).toBe('New')
    expect(events).toEqual([{ type: 'NodeRenamed', nodeId: node.id }])
  })

  it('rejects an empty or whitespace-only name and emits nothing', () => {
    const { engine, sceneId, rootId } = setup()
    const node = engine.createNode(sceneId, rootId, 'A')
    const events = collectEvents(engine)

    expect(() => engine.renameNode(node.id, '')).toThrow(/name/i)
    expect(() => engine.renameNode(node.id, '   ')).toThrow(/name/i)

    expect(node.name).toBe('A')
    expect(events).toEqual([])
  })

  it('rejects renaming a nonexistent node', () => {
    const { engine } = setup()

    expect(() => engine.renameNode('ghost', 'New')).toThrow(/node.*not found/i)
  })
})

describe('opacity serialization', () => {
  it('round-trips a non-default opacity through toJSON and restoreFromJSON', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'A', { opacity: 0.4 })
    engine.setOpacity(slide.scene.camera.id, 0.9)

    const json = engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    expect(restored.toJSON()).toEqual(json)
    expect(restored.getNode(node.id).opacity).toBe(0.4)
    expect(restored.getNode(slide.scene.camera.id).opacity).toBe(0.9)
  })

  it('defaults a missing opacity to 1 on restore', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const json = engine.toJSON()
    const nodeJson = {
      id: 'n1',
      name: 'Old Style',
      parentId: null,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      visible: true,
      components: {},
    }
    const legacy: LessonJSON = {
      ...json,
      slides: [
        {
          id: 's1',
          name: 'S',
          duration: 0,
          scene: {
            id: 'sc',
            nodes: [
              nodeJson,
              {
                ...nodeJson,
                id: 'cam',
                name: 'Camera',
                parentId: 'n1',
                components: { camera: { kind: 'camera' } },
              },
            ],
          },
        },
      ],
    }
    const restored = createEngine()
    restored.restoreFromJSON(legacy)

    expect(restored.getNode('n1').opacity).toBe(1)
  })

  it('rejects an out-of-range opacity in the JSON payload', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const bogus = {
      version: 1,
      project: {
        id: 'm',
        name: 'P',
        description: '',
        author: '',
        createdAt: 't',
        modifiedAt: 't',
      },
      slides: [
        {
          id: 's1',
          name: 'S',
          duration: 0,
          scene: {
            id: 'sc',
            nodes: [
              {
                id: 'n1',
                name: 'Root',
                parentId: null,
                opacity: 3,
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: {},
              },
              {
                id: 'cam',
                name: 'Camera',
                parentId: 'n1',
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: { camera: { kind: 'camera' } },
              },
            ],
          },
        },
      ],
    }
    const restored = createEngine()

    expect(() => restored.restoreFromJSON(bogus as unknown as LessonJSON)).toThrow(/opacity/i)
  })
})
