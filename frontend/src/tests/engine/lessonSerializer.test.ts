import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import {
  LESSON_VERSION,
  deserialize,
  serialize,
  upgrade,
  validate,
} from '../../engine/lessonSerializer'
import type { LessonJSON, LessonProjectJSON } from '../../engine/json'

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
  engine.createAssetInstance(scene.id, tree.id, fox.id, 'Fox A', {
    transform: { x: 40, y: 50, rotation: 0.2, scaleX: 1, scaleY: 1 },
  })
  engine.addKeyframe(tree.id, 'positionX', 1, 10)
  engine.addKeyframe(tree.id, 'positionX', 3, 30)
  engine.addKeyframe(scene.camera.id, 'opacity', 0, 0.5)
  engine.createSlide('Outro')
  return engine
}

function projectJson(engine: ReturnType<typeof createEngine>): LessonJSON {
  if (!engine.project) {
    throw new Error('expected a project')
  }
  return JSON.parse(serialize(engine.project)) as LessonJSON
}

describe('lesson serializer', () => {
  it('serializes to the R12 v1 container: version, flat project metadata, top-level slides', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Lesson', description: 'A lesson', author: 'Me' })
    engine.createSlide('Intro')
    const project = engine.project
    if (!project) {
      throw new Error('expected a project')
    }

    const json = projectJson(engine)

    expect(json).toEqual({
      version: 1,
      project: {
        id: project.id,
        name: 'Lesson',
        description: 'A lesson',
        author: 'Me',
        createdAt: project.createdAt,
        modifiedAt: project.updatedAt,
        settings: {},
      },
      slides: [
        expect.objectContaining({
          id: project.slides[0]?.id,
          name: 'Intro',
          duration: 10,
          scene: expect.objectContaining({ id: expect.any(String) }),
          animation: { nodes: [] },
        }),
      ],
    })
  })

  it('carries no editor state and no library section', () => {
    const engine = buildPopulatedEngine()

    const json = projectJson(engine)

    expect(json).not.toHaveProperty('library')
    expect(json).not.toHaveProperty('executionLog')
    expect(json).not.toHaveProperty('activeSlideId')
    expect(json).not.toHaveProperty('currentTime')
    expect(json.project).not.toHaveProperty('metadata')
    expect(json.project).not.toHaveProperty('updatedAt')
  })

  it('serializes animation data per node, only properties with keyframes', () => {
    const engine = buildPopulatedEngine()
    const slide = engine.project?.slides[0]
    const tree = slide?.scene.root.children.find((node) => node.name === 'Tree')
    const camera = slide?.scene.camera
    if (!slide || !tree || !camera) {
      throw new Error('expected nodes')
    }
    engine.addKeyframe(tree.id, 'scaleY', 0, 1)

    const json = projectJson(engine)
    const slideJson = json.slides[0]
    if (!slideJson) {
      throw new Error('expected a slide')
    }

    expect(slideJson.animation).toEqual({
      nodes: [
        {
          nodeId: tree.id,
          tracks: [
            {
              property: 'positionX',
              keyframes: [
                { id: expect.any(String), time: 1, value: 10 },
                { id: expect.any(String), time: 3, value: 30 },
              ],
            },
            { property: 'scaleY', keyframes: [{ id: expect.any(String), time: 0, value: 1 }] },
          ],
        },
        {
          nodeId: camera.id,
          tracks: [
            { property: 'opacity', keyframes: [{ id: expect.any(String), time: 0, value: 0.5 }] },
          ],
        },
      ],
    })
    const outro = json.slides[1]
    expect(outro?.animation).toEqual({ nodes: [] })
  })

  it('round-trips ids, structure, and values through serialize and deserialize', () => {
    const engine = buildPopulatedEngine()
    if (!engine.project) {
      throw new Error('expected a project')
    }

    const restored = deserialize(serialize(engine.project))

    expect(restored.id).toBe(engine.project.id)
    expect(restored.name).toBe('Lesson')
    expect(restored.description).toBe('A lesson')
    expect(restored.author).toBe('Me')
    expect(restored.createdAt).toBe(engine.project.createdAt)
    expect(restored.updatedAt).toBe(engine.project.updatedAt)
    expect(restored.slides).toHaveLength(2)

    const originalSlide = engine.project.slides[0]
    const restoredSlide = restored.slides[0]
    if (!originalSlide || !restoredSlide) {
      throw new Error('expected slides')
    }
    expect(restoredSlide.id).toBe(originalSlide.id)
    expect(restoredSlide.scene.id).toBe(originalSlide.scene.id)
    expect(restoredSlide.scene.root.id).toBe(originalSlide.scene.root.id)
    expect(restoredSlide.scene.camera.id).toBe(originalSlide.scene.camera.id)
    expect(restoredSlide.duration).toBe(originalSlide.duration)

    const originalTree = originalSlide.scene.root.children.find((node) => node.name === 'Tree')
    const restoredTree = restoredSlide.scene.root.children.find((node) => node.name === 'Tree')
    if (!originalTree || !restoredTree) {
      throw new Error('expected the Tree node')
    }
    expect(restoredTree.id).toBe(originalTree.id)
    expect(restoredTree.transform).toEqual(originalTree.transform)

    const originalFox = originalTree.children.find((node) => node.components.assetInstance)
    const restoredFox = restoredTree.children.find((node) => node.components.assetInstance)
    expect(restoredFox?.id).toBe(originalFox?.id)
    expect(restoredFox?.components.assetInstance?.assetDefinitionId).toBe(
      originalFox?.components.assetInstance?.assetDefinitionId,
    )

    const originalKeyframes = engine.getKeyframes(originalTree.id, 'positionX')
    const restoredKeyframes = restoredSlide.animation.node(restoredTree.id)?.keyframes('positionX')
    expect(restoredKeyframes?.map((k) => [k.id, k.time, k.value])).toEqual(
      originalKeyframes.map((k) => [k.id, k.time, k.value]),
    )
  })

  it('deserializing a serialized project yields an equivalent project for the engine', () => {
    const engine = buildPopulatedEngine()
    if (!engine.project) {
      throw new Error('expected a project')
    }

    const restored = createEngine()
    restored.restoreFromJSON(JSON.parse(serialize(engine.project)) as LessonJSON)

    expect(restored.toJSON()).toEqual(engine.toJSON())
    expect(restored.toJSON().version).toBe(1)
  })

  it('validate returns no errors for a serialized project', () => {
    const engine = buildPopulatedEngine()
    if (!engine.project) {
      throw new Error('expected a project')
    }

    expect(validate(JSON.parse(serialize(engine.project)))).toEqual([])
  })

  it('validate reports missing required fields', () => {
    expect(validate(null)).toEqual([expect.stringMatching(/invalid/i)])
    expect(validate({ version: 1 })).toEqual(
      expect.arrayContaining([expect.stringMatching(/project/i), expect.stringMatching(/slides/i)]),
    )
    expect(validate({ version: 1, project: { id: 'p1' }, slides: [] })).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/name/i),
        expect.stringMatching(/modifiedAt/i),
      ]),
    )
    expect(
      validate({
        version: 1,
        project: {
          id: 'p1',
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
            duration: 10,
            scene: {
              id: 'sc',
              nodes: [
                {
                  id: 'n1',
                  name: 'Root',
                  parentId: null,
                  transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
                  visible: true,
                  components: {},
                },
              ],
            },
          },
        ],
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/camera/i)]))
  })

  it('validate reports invalid references: parent, asset definition, keyframe node', () => {
    const base = {
      version: 1 as const,
      project: {
        id: 'p1',
        name: 'P',
        description: '',
        author: '',
        createdAt: 't',
        modifiedAt: 't',
      },
      slides: [] as unknown[],
    }
    const node = {
      id: 'root',
      name: 'Root',
      parentId: null,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      visible: true,
      components: {},
    }
    const camera = {
      id: 'cam',
      name: 'Camera',
      parentId: 'root',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      visible: true,
      components: { camera: { kind: 'camera' } },
    }
    const scene = (nodes: unknown[]) => ({ id: 'sc', nodes })
    const slide = (sceneJson: { id: string; nodes: unknown[] }) => ({
      id: 's1',
      name: 'S',
      duration: 10,
      scene: sceneJson,
    })

    expect(
      validate({
        ...base,
        slides: [slide(scene([node, camera, { ...node, id: 'kid', parentId: 'ghost' }]))],
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/parent.*not found|not found/i)]))

    expect(
      validate({
        ...base,
        slides: [
          slide(
            scene([
              node,
              camera,
              {
                ...node,
                id: 'kid',
                parentId: 'root',
                components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: '' } },
              },
            ]),
          ),
        ],
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/asset definition/i)]))

    expect(
      validate({
        ...base,
        slides: [
          {
            ...slide(scene([node, camera])),
            animation: {
              nodes: [{ nodeId: 'ghost', tracks: [] }],
            },
          },
        ],
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/unknown node/i)]))
  })

  it('validate reports duplicate node ids and duplicate keyframe ids', () => {
    const base = {
      version: 1 as const,
      project: {
        id: 'p1',
        name: 'P',
        description: '',
        author: '',
        createdAt: 't',
        modifiedAt: 't',
      },
      slides: [] as unknown[],
    }
    const node = {
      id: 'root',
      name: 'Root',
      parentId: null,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      visible: true,
      components: {},
    }
    const camera = {
      id: 'cam',
      name: 'Camera',
      parentId: 'root',
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      visible: true,
      components: { camera: { kind: 'camera' } },
    }
    const scene = { id: 'sc', nodes: [node, camera] }
    const slideJson = { id: 's1', name: 'S', duration: 10, scene }

    expect(
      validate({
        ...base,
        slides: [
          { ...slideJson, scene: { id: 'sc', nodes: [node, camera, { ...node, id: 'root' }] } },
        ],
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/already exists/i)]))

    expect(
      validate({
        ...base,
        slides: [
          {
            ...slideJson,
            animation: {
              nodes: [
                {
                  nodeId: 'root',
                  tracks: [
                    {
                      property: 'positionX',
                      keyframes: [
                        { id: 'k1', time: 1, value: 10 },
                        { id: 'k1', time: 2, value: 20 },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        ],
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/duplicate keyframe/i)]))
  })

  it('deserialize rejects corrupted JSON with a user-friendly message', () => {
    expect(() => deserialize('{ nope')).toThrow(/invalid.*json|json.*invalid/i)
    expect(() => deserialize('')).toThrow(/invalid.*json|json.*invalid/i)
  })

  it('validate rejects unsupported versions', () => {
    expect(validate({ version: 2, project: {}, slides: [] })).toEqual([
      expect.stringMatching(/version/i),
    ])
    expect(validate({ project: {}, slides: [] })).toEqual([expect.stringMatching(/version/i)])
  })

  it('validate reports duplicate slide ids and duplicate scene ids', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    engine.createSlide('S2')
    if (!engine.project) {
      throw new Error('expected a project')
    }
    const json = JSON.parse(serialize(engine.project)) as LessonJSON
    const first = json.slides[0]
    const second = json.slides[1]
    if (!first || !second) {
      throw new Error('expected slides')
    }

    expect(validate({ ...json, slides: [first, { ...second, id: first.id }] })).toEqual(
      expect.arrayContaining([expect.stringMatching(/slide with id .* already exists/i)]),
    )

    expect(
      validate({
        ...json,
        slides: [first, { ...second, scene: { ...second.scene, id: first.scene.id } }],
      }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/scene with id .* already exists/i)]))

    expect(
      validate({ ...json, slides: [{ ...first, scene: { ...first.scene, id: '' } }] }),
    ).toEqual(expect.arrayContaining([expect.stringMatching(/scene id/i)]))
  })

  it('deserialize rejects an invalid project with a user-friendly message', () => {
    expect(() => deserialize(JSON.stringify({ version: 99, project: {}, slides: [] }))).toThrow(
      /version/i,
    )
    expect(() => deserialize(JSON.stringify({ version: 1, project: { id: 'x' } }))).toThrow(
      /invalid/i,
    )
  })

  it('upgrade is a no-op for v1: returns the project unchanged', () => {
    const engine = buildPopulatedEngine()
    if (!engine.project) {
      throw new Error('expected a project')
    }
    const text = serialize(engine.project)

    const upgraded = upgrade(text)
    const plain = deserialize(text)

    expect(upgraded.id).toBe(plain.id)
    expect(upgraded.slides.map((slide) => slide.id)).toEqual(plain.slides.map((slide) => slide.id))
    expect(upgraded.slides[0]?.scene.root.id).toBe(plain.slides[0]?.scene.root.id)
    expect(() => upgrade(JSON.stringify({ version: 2, project: {}, slides: [] }))).toThrow(
      /version/i,
    )
  })

  it('exposes LESSON_VERSION = 1', () => {
    expect(LESSON_VERSION).toBe(1)
  })
})

describe('lesson serializer project metadata', () => {
  it('maps the file modifiedAt field to in-memory updatedAt on deserialize', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    if (!engine.project) {
      throw new Error('expected a project')
    }
    const json = JSON.parse(serialize(engine.project)) as LessonJSON
    const project: LessonProjectJSON = json.project
    expect(project).toHaveProperty('modifiedAt')
    expect(project).not.toHaveProperty('updatedAt')

    const restored = deserialize(serialize(engine.project))
    expect(restored.updatedAt).toBe(engine.project.updatedAt)
  })
})
