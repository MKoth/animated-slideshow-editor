import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { LessonJSON } from '../../engine/json'

function buildPopulatedEngine() {
  const engine = createEngine()
  engine.createProject({
    name: 'Lesson',
    description: 'A lesson',
    author: 'Me',
  })
  const fox = engine.defineAsset('Fox')
  const slide = engine.createSlide('Intro')
  const { scene } = slide
  const tree = engine.createNode(scene.id, scene.root.id, 'Tree')

  engine.setTransform(scene.camera.id, { x: 320, y: 180, rotation: 0, scaleX: 1.5, scaleY: 1.5 })
  engine.createAssetInstance(scene.id, tree.id, fox.id, 'Fox A', {
    transform: { x: 40, y: 50, rotation: 0.2, scaleX: 1, scaleY: 1 },
    visible: false,
  })
  engine.createNode(scene.id, tree.id, 'Label', {
    components: { text: { kind: 'text', content: 'Hello', fontSize: 24, alignment: 'center' } },
    transform: { x: -10, y: 5, rotation: 0, scaleX: 1, scaleY: 1 },
  })
  engine.createSlide('Outro')
  return engine
}

describe('serialization', () => {
  it('rejects toJSON when no project exists', () => {
    const engine = createEngine()

    expect(() => engine.toJSON()).toThrow(/project/i)
  })

  it('round-trips an empty project to an equivalent project', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Empty' })

    const json = engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    expect(restored.toJSON()).toEqual(json)
  })

  it('round-trips a populated project: ids, structure, values', () => {
    const engine = buildPopulatedEngine()

    const json = engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    expect(restored.toJSON()).toEqual(json)
  })

  it('restores an equivalent project with working reads and writes', () => {
    const engine = buildPopulatedEngine()
    const fox = engine.assetDefinitions[0]
    const restored = createEngine()
    restored.restoreFromJSON(engine.toJSON())
    if (fox) {
      restored.registerAssetDefinition(fox.id, fox.name)
    }

    const project = restored.project
    expect(project?.name).toBe('Lesson')
    expect(project?.slides).toHaveLength(2)
    expect(restored.assetDefinitions.map((d) => d.name)).toEqual(['Fox'])

    const slide = project?.slides[0]
    const scene = slide?.scene
    expect(scene?.root.parent).toBeNull()
    expect(scene?.camera.parent).toBe(scene?.root)
    expect(scene?.camera.transform).toEqual({
      x: 320,
      y: 180,
      rotation: 0,
      scaleX: 1.5,
      scaleY: 1.5,
    })

    const tree = scene?.root.children.find((node) => node.name === 'Tree')
    const label = tree?.children.find((node) => node.name === 'Label')
    const foxNode = tree?.children.find((node) => node.components.assetInstance)
    expect(label?.components.text).toEqual({
      kind: 'text',
      content: 'Hello',
      fontSize: 24,
      alignment: 'center',
    })
    expect(foxNode?.components.assetInstance?.assetDefinitionId).toBe(fox?.id)
    expect(foxNode?.visible).toBe(false)

    const camera = scene?.camera
    if (camera) {
      expect(() => restored.setTransform(camera.id, { ...camera.transform, rotation: 1 })).toThrow(
        /rotation.*locked/i,
      )
    }
  })

  it('rejects toJSON/restore malformed data with meaningful errors', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })

    expect(() => restoredFromJSON({ nope: true } as unknown as LessonJSON)).toThrow(/invalid/i)
    expect(() => engine.toJSON()).not.toThrow()

    const valid = {
      version: 1,
      project: {
        id: 'p',
        name: 'P',
        description: '',
        author: '',
        createdAt: 't',
        modifiedAt: 't',
      },
      slides: [],
    }
    expect(() => restoredFromJSON(valid as unknown as LessonJSON)).not.toThrow()
  })

  it('rejects duplicate node ids in the JSON payload', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const json = engine.toJSON()

    const nodeJson = {
      id: 'dup',
      name: 'Root',
      parentId: null,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      visible: true,
      components: {},
    }
    const cameraJson = {
      id: 'cam',
      name: 'Camera',
      parentId: 'dup',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      visible: true,
      components: { camera: { kind: 'camera' } },
    }
    const corrupt: LessonJSON = {
      ...json,
      slides: [
        {
          id: 's1',
          name: 'S',
          duration: 0,
          scene: {
            id: 'sc',
            nodes: [nodeJson, { ...nodeJson, name: 'Root copy', parentId: 'dup' }, cameraJson],
          },
        },
      ],
    }

    expect(() => restoredFromJSON(corrupt)).toThrow(/already exists/i)
  })

  it('rejects a scene without a camera node', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const json = engine.toJSON()

    const nodeJson = {
      id: 'r1',
      name: 'Root',
      parentId: null,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      visible: true,
      components: {},
    }
    const corrupt: LessonJSON = {
      ...json,
      slides: [
        {
          id: 's1',
          name: 'S',
          duration: 0,
          scene: { id: 'sc', nodes: [nodeJson] },
        },
      ],
    }

    expect(() => restoredFromJSON(corrupt)).toThrow(/camera/i)
  })

  it('rejects a camera node that is not a child of the scene root', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const json = engine.toJSON()

    const rootJson = {
      id: 'r1',
      name: 'Root',
      parentId: null,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      visible: true,
      components: {},
    }
    const middleJson = {
      id: 'm1',
      name: 'Middle',
      parentId: 'r1',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      visible: true,
      components: {},
    }
    const cameraJson = {
      id: 'cam',
      name: 'Camera',
      parentId: 'm1',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      visible: true,
      components: { camera: { kind: 'camera' } },
    }
    const corrupt: LessonJSON = {
      ...json,
      slides: [
        {
          id: 's1',
          name: 'S',
          duration: 0,
          scene: { id: 'sc', nodes: [rootJson, middleJson, cameraJson] },
        },
      ],
    }

    expect(() => restoredFromJSON(corrupt)).toThrow(/child of the scene root/i)
  })

  it('rejects an unknown text alignment in the JSON payload', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const json = engine.toJSON()

    const corrupt: LessonJSON = {
      ...json,
      slides: [
        {
          id: 's1',
          name: 'S',
          duration: 0,
          scene: {
            id: 'sc',
            nodes: [
              {
                id: 'r1',
                name: 'Root',
                parentId: null,
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: {},
              },
              {
                id: 'cam',
                name: 'Camera',
                parentId: 'r1',
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: { camera: { kind: 'camera' } },
              },
              {
                id: 't1',
                name: 'Label',
                parentId: 'r1',
                transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                visible: true,
                components: {
                  text: { kind: 'text', content: 'Hi', fontSize: 12, alignment: 'bogus' },
                },
              },
            ],
          },
        },
      ],
    }

    expect(() => restoredFromJSON(corrupt)).toThrow(/alignment/i)
  })

  it('round-trips IK chains through serialization', () => {
    const engine = createEngine()
    engine.createProject({ name: 'IK Test' })
    const slide = engine.createSlide('Slide 1')
    const { scene } = slide

    const bone1 = engine.createNode(scene.id, scene.root.id, 'Bone1', {
      components: { bone: { kind: 'bone', length: 100 } },
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const bone2 = engine.createNode(scene.id, bone1.id, 'Bone2', {
      components: { bone: { kind: 'bone', length: 100 } },
      transform: { x: 100, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })

    const chain = engine.createIKChain(slide.id, [bone1.id, bone2.id], {
      position: { x: 200, y: 0 },
    })

    const json = engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    const restoredChains = restored.getIKChainsForSlide(slide.id)
    expect(restoredChains).toHaveLength(1)
    expect(restoredChains[0].id).toBe(chain.id)
    expect(restoredChains[0].boneIds).toEqual([bone1.id, bone2.id])
    expect(restoredChains[0].target).toEqual({ position: { x: 200, y: 0 } })
  })

  it('round-trips IK chains with pole targets', () => {
    const engine = createEngine()
    engine.createProject({ name: 'IK Pole Test' })
    const slide = engine.createSlide('Slide 1')
    const { scene } = slide

    const bone1 = engine.createNode(scene.id, scene.root.id, 'Bone1', {
      components: { bone: { kind: 'bone', length: 100 } },
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const bone2 = engine.createNode(scene.id, bone1.id, 'Bone2', {
      components: { bone: { kind: 'bone', length: 100 } },
      transform: { x: 100, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })

    engine.createIKChain(
      slide.id,
      [bone1.id, bone2.id],
      { position: { x: 200, y: 50 } },
      { position: { x: 100, y: -100 } },
    )

    const json = engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    const restoredChains = restored.getIKChainsForSlide(slide.id)
    expect(restoredChains).toHaveLength(1)
    expect(restoredChains[0].poleTarget).toEqual({ position: { x: 100, y: -100 } })
  })

  it('leaves the engine clean after a failed restore', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
    const json = engine.toJSON()
    const restored = createEngine()

    const slideJson = json.slides[0]
    if (!slideJson) {
      throw new Error('expected a slide')
    }
    const rootId = slideJson.scene.nodes.find((node) => node.parentId === null)?.id
    const duplicateNode = {
      id: rootId ?? 'root',
      name: 'Impostor',
      parentId: null,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      visible: true,
      components: {},
    }
    const corrupt: LessonJSON = {
      ...json,
      slides: [
        {
          ...slideJson,
          scene: { id: slideJson.scene.id, nodes: [...slideJson.scene.nodes, duplicateNode] },
        },
      ],
    }
    expect(() => restored.restoreFromJSON(corrupt)).toThrow(/already exists/i)

    expect(restored.project).toBeNull()
    expect(() => restored.getSlide(slide.id)).toThrow(/project/i)
    expect(() => restored.getNode(slide.scene.root.id)).toThrow(/node.*not found/i)
    expect(restored.assetDefinitions).toEqual([])
    expect(() => restored.getAssetDefinition('a')).toThrow(/definition.*not found/i)
  })
})

function restoredFromJSON(json: LessonJSON): void {
  const engine = createEngine()
  engine.restoreFromJSON(json)
}
