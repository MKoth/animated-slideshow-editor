import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { LessonJSON } from '../../engine/json'

describe('keyframe serialization', () => {
  it('round-trips keyframes (ids, times, values) across slides and nodes', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Lesson' })
    const slide = engine.createSlide('Intro')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
    const camera = slide.scene.camera
    engine.addKeyframe(node.id, 'positionX', 1, 10)
    engine.addKeyframe(node.id, 'positionX', 3, 30)
    engine.addKeyframe(node.id, 'opacity', 2, 0.5)
    engine.addKeyframe(camera.id, 'scaleX', 0, 1.5)
    const keyframeId = engine.getKeyframes(node.id, 'positionX')[0]?.id
    if (!keyframeId) {
      throw new Error('expected a keyframe')
    }
    engine.moveKeyframe(node.id, 'positionX', keyframeId, 4)
    const second = engine.createSlide('Outro')
    const outroNode = engine.createNode(second.scene.id, second.scene.root.id, 'B')
    engine.addKeyframe(outroNode.id, 'rotation', 1.5, 0.25)

    const json = engine.toJSON()
    const restored = createEngine()
    restored.restoreFromJSON(json)

    expect(restored.toJSON()).toEqual(json)
    expect(restored.getKeyframes(node.id, 'positionX').map((k) => [k.id, k.time, k.value])).toEqual(
      engine.getKeyframes(node.id, 'positionX').map((k) => [k.id, k.time, k.value]),
    )
    expect(restored.getKeyframes(camera.id, 'scaleX').map((k) => [k.id, k.time, k.value])).toEqual([
      [engine.getKeyframes(camera.id, 'scaleX')[0]?.id ?? '', 0, 1.5],
    ])
    expect(restored.getKeyframes(outroNode.id, 'rotation').map((k) => k.value)).toEqual([0.25])
    expect(restored.getSlide(slide.id).animation.node(node.id)).toBeDefined()
  })

  it('restores a slide without an animation section as empty animation', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    const json = engine.toJSON()
    const slideJson = json.slides[0]
    if (!slideJson) {
      throw new Error('expected a slide')
    }
    const legacy: LessonJSON = {
      ...json,
      slides: [{ ...slideJson, animation: undefined }],
    }

    const restored = createEngine()
    restored.restoreFromJSON(legacy)

    expect(restored.toJSON().slides[0]?.animation).toEqual({ nodes: [] })
  })

  it('rejects a keyframe on an unknown node in the JSON payload', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('S1')
    const json = engine.toJSON()
    const slideJson = json.slides[0]
    if (!slideJson) {
      throw new Error('expected a slide')
    }
    const corrupt: LessonJSON = {
      ...json,
      slides: [
        {
          ...slideJson,
          animation: {
            nodes: [
              {
                nodeId: 'ghost',
                tracks: [{ property: 'positionX', keyframes: [{ id: 'k1', time: 1, value: 10 }] }],
              },
            ],
          },
        },
      ],
    }

    expect(() => restoredFromJSON(corrupt)).toThrow(/unknown node/i)
  })

  it('rejects camera rotation keyframes in the JSON payload', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const camera = slide.scene.camera
    const json = engine.toJSON()
    const slideJson = json.slides[0]
    if (!slideJson) {
      throw new Error('expected a slide')
    }
    const corrupt: LessonJSON = {
      ...json,
      slides: [
        {
          ...slideJson,
          animation: {
            nodes: [
              {
                nodeId: camera.id,
                tracks: [{ property: 'rotation', keyframes: [{ id: 'k1', time: 1, value: 0.5 }] }],
              },
            ],
          },
        },
      ],
    }

    expect(() => restoredFromJSON(corrupt)).toThrow(/rotation/i)
  })

  it('rejects a keyframe time beyond the slide duration in the JSON payload', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
    const json = engine.toJSON()
    const slideJson = json.slides[0]
    if (!slideJson) {
      throw new Error('expected a slide')
    }
    const corrupt: LessonJSON = {
      ...json,
      slides: [
        {
          ...slideJson,
          animation: {
            nodes: [
              {
                nodeId: node.id,
                tracks: [{ property: 'positionX', keyframes: [{ id: 'k1', time: 99, value: 10 }] }],
              },
            ],
          },
        },
      ],
    }

    expect(() => restoredFromJSON(corrupt)).toThrow(/within/i)
  })

  it('rejects an out-of-range opacity keyframe value in the JSON payload', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
    const json = engine.toJSON()
    const slideJson = json.slides[0]
    if (!slideJson) {
      throw new Error('expected a slide')
    }
    const corrupt: LessonJSON = {
      ...json,
      slides: [
        {
          ...slideJson,
          animation: {
            nodes: [
              {
                nodeId: node.id,
                tracks: [{ property: 'opacity', keyframes: [{ id: 'k1', time: 1, value: 2 }] }],
              },
            ],
          },
        },
      ],
    }

    expect(() => restoredFromJSON(corrupt)).toThrow(/opacity/i)
  })

  it('rejects an unknown animation property in the JSON payload', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
    const json = engine.toJSON()
    const slideJson = json.slides[0]
    if (!slideJson) {
      throw new Error('expected a slide')
    }
    const corrupt: LessonJSON = {
      ...json,
      slides: [
        {
          ...slideJson,
          animation: {
            nodes: [
              {
                nodeId: node.id,
                tracks: [{ property: 'content', keyframes: [{ id: 'k1', time: 1, value: 10 }] }],
              },
            ],
          },
        },
      ],
    }

    expect(() => restoredFromJSON(corrupt)).toThrow(/unknown animation property/i)
  })

  it('rejects duplicate keyframe ids in the JSON payload', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
    const json = engine.toJSON()
    const slideJson = json.slides[0]
    if (!slideJson) {
      throw new Error('expected a slide')
    }
    const corrupt: LessonJSON = {
      ...json,
      slides: [
        {
          ...slideJson,
          animation: {
            nodes: [
              {
                nodeId: node.id,
                tracks: [
                  {
                    property: 'positionX',
                    keyframes: [
                      { id: 'dup', time: 1, value: 10 },
                      { id: 'dup', time: 2, value: 20 },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    }

    expect(() => restoredFromJSON(corrupt)).toThrow(/duplicate keyframe/i)
  })

  it('rejects an unknown interpolation in the JSON payload', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
    const json = engine.toJSON()
    const slideJson = json.slides[0]
    if (!slideJson) {
      throw new Error('expected a slide')
    }
    const corrupt = {
      ...json,
      slides: [
        {
          ...slideJson,
          animation: {
            nodes: [
              {
                nodeId: node.id,
                tracks: [
                  {
                    property: 'positionX',
                    keyframes: [{ id: 'k1', time: 1, value: 10, interpolation: 'ease' }],
                  },
                ],
              },
            ],
          },
        },
      ],
    } as unknown as LessonJSON

    expect(() => restoredFromJSON(corrupt)).toThrow(/interpolation/i)
  })

  it('rejects a malformed tangent in the JSON payload', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
    const json = engine.toJSON()
    const slideJson = json.slides[0]
    if (!slideJson) {
      throw new Error('expected a slide')
    }
    const corrupt = {
      ...json,
      slides: [
        {
          ...slideJson,
          animation: {
            nodes: [
              {
                nodeId: node.id,
                tracks: [
                  {
                    property: 'positionX',
                    keyframes: [
                      { id: 'k1', time: 1, value: 10, tangentIn: { time: 'x', value: 0 } },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ],
    } as unknown as LessonJSON

    expect(() => restoredFromJSON(corrupt)).toThrow(/tangentIn/i)
  })
})

function restoredFromJSON(json: LessonJSON): void {
  const engine = createEngine()
  engine.restoreFromJSON(json)
}
