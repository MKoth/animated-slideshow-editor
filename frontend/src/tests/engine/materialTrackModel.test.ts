import { describe, expect, it } from 'vitest'
import { NodeAnimation } from '../../engine/animation'
import { Keyframe } from '../../engine/keyframe'
import { createEngine } from '../../engine/internal'
import type { KeyframeJSON, LessonJSON } from '../../engine/json'

const CUSTOM_MATERIAL = {
  id: 'mat-params',
  name: 'Params',
  parameters: [
    { key: 'uSteps', kind: 'int', default: 2 },
    { key: 'uEnabled', kind: 'bool', default: true },
    { key: 'uOffset', kind: 'vec2', default: [0.1, 0.2] },
    { key: 'uMask', kind: 'sampler2D', default: '' },
  ],
}

function engineWithProject() {
  const engine = createEngine()
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
  engine.registerMaterialDefinition(
    CUSTOM_MATERIAL.id,
    CUSTOM_MATERIAL.name,
    CUSTOM_MATERIAL.parameters,
  )
  engine.assignMaterial(node.id, CUSTOM_MATERIAL.id)
  return { engine, slide, node }
}

function restoredEngine() {
  const restored = createEngine()
  restored.registerMaterialDefinition(
    CUSTOM_MATERIAL.id,
    CUSTOM_MATERIAL.name,
    CUSTOM_MATERIAL.parameters,
  )
  return restored
}

function fullKeyframe(keyframe: unknown): KeyframeJSON {
  return {
    interpolation: 'linear',
    tangentIn: { time: 0, value: 0 },
    tangentOut: { time: 0, value: 0 },
    ...(keyframe as Record<string, unknown>),
  } as KeyframeJSON
}

function jsonWithMaterialTracks(
  engine: ReturnType<typeof createEngine>,
  nodeId: string,
  materialTracks: { parameter: string; keyframes: unknown[] }[],
): LessonJSON {
  const json = engine.toJSON()
  const slide = json.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  return {
    ...json,
    slides: [
      {
        ...slide,
        animation: {
          nodes: [
            {
              nodeId,
              tracks: [],
              materialTracks: materialTracks.map((track) => ({
                parameter: track.parameter,
                keyframes: track.keyframes.map(fullKeyframe),
              })),
            },
          ],
        },
      },
    ],
  } as LessonJSON
}

describe('material tracks model', () => {
  it('a material track is born with its first keyframe and reverts when empty', () => {
    const animation = new NodeAnimation()
    expect(animation.hasMaterialTrack('tint')).toBe(false)
    expect(animation.materialKeyframes('tint')).toHaveLength(0)

    const keyframe = new Keyframe('k1', 0.5, '#ff0000')
    animation.addMaterial('tint', keyframe)
    expect(animation.hasMaterialTrack('tint')).toBe(true)
    expect(animation.materialKeyframes('tint')).toEqual([keyframe])

    expect(animation.removeMaterial('tint', 'k1')).toBe(keyframe)
    expect(animation.hasMaterialTrack('tint')).toBe(false)
    expect(animation.materialKeyframes('tint')).toHaveLength(0)
  })

  it('keeps material keyframes sorted by time as they are added', () => {
    const animation = new NodeAnimation()
    animation.addMaterial('tint', new Keyframe('k1', 2, '#00ff00'))
    animation.addMaterial('tint', new Keyframe('k2', 0, '#ff0000'))
    animation.addMaterial('tint', new Keyframe('k3', 1, '#0000ff'))
    expect(animation.materialKeyframes('tint').map((keyframe) => keyframe.time)).toEqual([0, 1, 2])
  })

  it('removes one of several material keyframes and keeps the track', () => {
    const animation = new NodeAnimation()
    animation.addMaterial('tint', new Keyframe('k1', 0, '#ff0000'))
    animation.addMaterial('tint', new Keyframe('k2', 1, '#00ff00'))
    animation.removeMaterial('tint', 'k1')
    expect(animation.hasMaterialTrack('tint')).toBe(true)
    expect(animation.materialKeyframes('tint').map((keyframe) => keyframe.id)).toEqual(['k2'])
  })

  it('copy copies material tracks', () => {
    const animation = new NodeAnimation()
    animation.addMaterial('tint', new Keyframe('k1', 0, '#ff0000'))
    const copy = animation.copy()
    expect(copy.materialKeyframes('tint')[0]?.value).toBe('#ff0000')
    expect(copy.materialKeyframes('tint')[0]?.id).not.toBe('k1')
  })
})

describe('material track serialization', () => {
  it('round-trips material tracks with generalized values through the engine', () => {
    const { engine, node } = engineWithProject()
    const json = jsonWithMaterialTracks(engine, node.id, [
      {
        parameter: 'uSteps',
        keyframes: [
          { id: 'k1', time: 0, value: 1 },
          { id: 'k2', time: 2, value: 4 },
        ],
      },
      { parameter: 'uOffset', keyframes: [{ id: 'k3', time: 1, value: [0.5, 0.6] }] },
      { parameter: 'uEnabled', keyframes: [{ id: 'k4', time: 1.5, value: false }] },
      { parameter: 'uMask', keyframes: [{ id: 'k5', time: 2, value: 'asset-1' }] },
    ])

    const restored = restoredEngine()
    restored.restoreFromJSON(json)

    expect(restored.toJSON()).toEqual(json)
    const restoredAnimation = restored.getSlideOfNode(node.id).animation.node(node.id)
    expect(
      restoredAnimation?.materialKeyframes('uSteps').map((k) => [k.id, k.time, k.value]),
    ).toEqual([
      ['k1', 0, 1],
      ['k2', 2, 4],
    ])
    expect(restoredAnimation?.materialKeyframes('uOffset')[0]?.value).toEqual([0.5, 0.6])
    expect(restoredAnimation?.materialKeyframes('uEnabled')[0]?.value).toBe(false)
    expect(restoredAnimation?.materialKeyframes('uMask')[0]?.value).toBe('asset-1')
  })

  it('material keyframes default to linear interpolation with zero tangents', () => {
    const { engine, node } = engineWithProject()
    const json = jsonWithMaterialTracks(engine, node.id, [
      { parameter: 'uSteps', keyframes: [{ id: 'k1', time: 0, value: 1 }] },
    ])
    const restored = restoredEngine()
    restored.restoreFromJSON(json)
    const keyframe = restored
      .getSlideOfNode(node.id)
      .animation.node(node.id)
      ?.materialKeyframes('uSteps')[0]
    expect(keyframe?.interpolation).toBe('linear')
    expect(keyframe?.tangentIn).toEqual({ time: 0, value: 0 })
    expect(keyframe?.tangentOut).toEqual({ time: 0, value: 0 })
  })

  it('loads pre-material-track files unchanged (no materialTracks, linear interpolation)', () => {
    const { engine, node } = engineWithProject()
    const json = engine.toJSON()
    const slide = json.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const legacy: LessonJSON = {
      ...json,
      slides: [
        {
          ...slide,
          animation: {
            nodes: [
              {
                nodeId: node.id,
                tracks: [{ property: 'positionX', keyframes: [{ id: 'k1', time: 1, value: 10 }] }],
              },
            ],
          },
        },
      ],
    }

    const restored = restoredEngine()
    restored.restoreFromJSON(legacy)

    const restoredAnimation = restored.getSlideOfNode(node.id).animation.node(node.id)
    expect(restoredAnimation?.hasMaterialTrack('uSteps')).toBe(false)
    expect(restoredAnimation?.keyframes('positionX')[0]?.interpolation).toBe('linear')
  })
})

describe('material track per-kind validation on load', () => {
  function expectRejected(json: LessonJSON, pattern: RegExp): void {
    const restored = restoredEngine()
    expect(() => restored.restoreFromJSON(json)).toThrow(pattern)
  }

  it('rejects a non-integer int value', () => {
    const { engine, node } = engineWithProject()
    expectRejected(
      jsonWithMaterialTracks(engine, node.id, [
        { parameter: 'uSteps', keyframes: [{ id: 'k1', time: 0, value: 1.5 }] },
      ]),
      /integer/i,
    )
  })

  it('rejects a non-boolean bool value', () => {
    const { engine, node } = engineWithProject()
    expectRejected(
      jsonWithMaterialTracks(engine, node.id, [
        { parameter: 'uEnabled', keyframes: [{ id: 'k1', time: 0, value: 1 }] },
      ]),
      /boolean/i,
    )
  })

  it('rejects a vector with the wrong length', () => {
    const { engine, node } = engineWithProject()
    expectRejected(
      jsonWithMaterialTracks(engine, node.id, [
        { parameter: 'uOffset', keyframes: [{ id: 'k1', time: 0, value: [0.5, 0.6, 0.7] }] },
      ]),
      /length/i,
    )
  })

  it('rejects a non-hex color and a non-asset sampler2D', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    const colorJson = jsonWithMaterialTracks(engine, node.id, [
      { parameter: 'tint', keyframes: [{ id: 'k1', time: 0, value: 'red' }] },
    ])
    expectRejected(colorJson, /hex/i)

    const { engine: paramsEngine, node: paramsNode } = engineWithProject()
    const samplerJson = jsonWithMaterialTracks(paramsEngine, paramsNode.id, [
      { parameter: 'uMask', keyframes: [{ id: 'k2', time: 0, value: 42 }] },
    ])
    expectRejected(samplerJson, /string/i)
  })

  it('rejects an out-of-bounds time', () => {
    const { engine, node } = engineWithProject()
    expectRejected(
      jsonWithMaterialTracks(engine, node.id, [
        { parameter: 'uSteps', keyframes: [{ id: 'k1', time: 99, value: 2 }] },
      ]),
      /within/i,
    )
  })

  it('accepts a valid default-material tint track (color kind)', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    const json = jsonWithMaterialTracks(engine, node.id, [
      { parameter: 'tint', keyframes: [{ id: 'k1', time: 0, value: '#ff0000' }] },
    ])
    const restored = restoredEngine()
    restored.restoreFromJSON(json)
    expect(restored.toJSON()).toEqual(json)
  })
})

describe('orphaned material tracks', () => {
  it('keeps data for a parameter the current material no longer defines', () => {
    const { engine, node } = engineWithProject()
    const json = jsonWithMaterialTracks(engine, node.id, [
      { parameter: 'ghost', keyframes: [{ id: 'k1', time: 0, value: 42 }] },
    ])
    const restored = restoredEngine()
    restored.restoreFromJSON(json)
    const animation = restored.getSlideOfNode(node.id).animation.node(node.id)
    expect(animation?.hasMaterialTrack('ghost')).toBe(true)
    expect(animation?.materialKeyframes('ghost')[0]?.value).toBe(42)
    expect(restored.toJSON()).toEqual(json)
  })

  it('rejects malformed values even on orphaned tracks', () => {
    const { engine, node } = engineWithProject()
    const json = jsonWithMaterialTracks(engine, node.id, [
      { parameter: 'ghost', keyframes: [{ id: 'k1', time: 0, value: { nested: true } }] },
    ])
    const restored = restoredEngine()
    expect(() => restored.restoreFromJSON(json)).toThrow()
  })
})

describe('material keyframe id uniqueness', () => {
  it('rejects a material keyframe id colliding with a property keyframe id', () => {
    const { engine, node } = engineWithProject()
    const json = jsonWithMaterialTracks(engine, node.id, [
      { parameter: 'uSteps', keyframes: [{ id: 'dup', time: 0, value: 2 }] },
    ])
    const slide = json.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const collision: LessonJSON = {
      ...json,
      slides: [
        {
          ...slide,
          animation: {
            nodes: [
              {
                nodeId: node.id,
                tracks: [
                  {
                    property: 'positionX',
                    keyframes: [fullKeyframe({ id: 'dup', time: 1, value: 10 })],
                  },
                ],
                materialTracks: [
                  {
                    parameter: 'uSteps',
                    keyframes: [fullKeyframe({ id: 'dup', time: 0, value: 2 })],
                  },
                ],
              },
            ],
          },
        },
      ],
    }
    const restored = restoredEngine()
    expect(() => restored.restoreFromJSON(collision)).toThrow(/duplicate keyframe/i)
  })

  it('keeps material keyframe ids stable and unique across nodes', () => {
    const { engine, node } = engineWithProject()
    const sceneId = engine.getSlideOfNode(node.id).scene.id
    const rootId = engine.getSlideOfNode(node.id).scene.root.id
    const otherNode = engine.createNode(sceneId, rootId, 'Other')
    const json = engine.toJSON()
    const slide = json.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const withTracks: LessonJSON = {
      ...json,
      slides: [
        {
          ...slide,
          animation: {
            nodes: [
              {
                nodeId: node.id,
                tracks: [],
                materialTracks: [
                  {
                    parameter: 'uSteps',
                    keyframes: [fullKeyframe({ id: 'a1', time: 0, value: 2 })],
                  },
                ],
              },
              {
                nodeId: otherNode.id,
                tracks: [],
                materialTracks: [
                  {
                    parameter: 'uSteps',
                    keyframes: [fullKeyframe({ id: 'a2', time: 1, value: 3 })],
                  },
                ],
              },
            ],
          },
        },
      ],
    }
    const restored = restoredEngine()
    restored.restoreFromJSON(withTracks)
    expect(restored.toJSON()).toEqual(withTracks)
  })
})

describe('default material resolves parameter kinds', () => {
  it('validates default-material parameter kinds (tint, opacityMultiplier) on load', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Box')
    const json = engine.toJSON()
    const slideJson = json.slides[0]
    if (!slideJson) {
      throw new Error('expected a slide')
    }
    const withTracks: LessonJSON = {
      ...json,
      slides: [
        {
          ...slideJson,
          animation: {
            nodes: [
              {
                nodeId: node.id,
                tracks: [],
                materialTracks: [
                  {
                    parameter: 'tint',
                    keyframes: [fullKeyframe({ id: 'k1', time: 0, value: 'red' })],
                  },
                ],
              },
            ],
          },
        },
      ],
    }
    const restored = restoredEngine()
    expect(() => restored.restoreFromJSON(withTracks)).toThrow(/hex/i)
  })
})

describe('material track structure validation', () => {
  it('rejects an empty material parameter key', () => {
    const { engine, node } = engineWithProject()
    const json = jsonWithMaterialTracks(engine, node.id, [
      { parameter: '', keyframes: [{ id: 'k1', time: 0, value: 2 }] },
    ])
    const restored = restoredEngine()
    expect(() => restored.restoreFromJSON(json)).toThrow()
  })

  it('rejects duplicate times not at the slide duration on a material track', () => {
    const { engine, node } = engineWithProject()
    const json = jsonWithMaterialTracks(engine, node.id, [
      {
        parameter: 'uSteps',
        keyframes: [
          { id: 'k1', time: 1, value: 2 },
          { id: 'k2', time: 1, value: 3 },
        ],
      },
    ])
    const restored = restoredEngine()
    expect(() => restored.restoreFromJSON(json)).toThrow(/distinct/i)
  })

  it('rejects a non-array materialTracks field', () => {
    const { engine, node } = engineWithProject()
    const json = jsonWithMaterialTracks(engine, node.id, [])
    const slide = json.slides[0]
    if (!slide) {
      throw new Error('expected a slide')
    }
    const malformed = {
      ...json,
      slides: [
        {
          ...slide,
          animation: {
            nodes: [{ nodeId: node.id, tracks: [], materialTracks: 'nope' }],
          },
        },
      ],
    } as unknown as LessonJSON
    const restored = restoredEngine()
    expect(() => restored.restoreFromJSON(malformed)).toThrow(/materialTracks/i)
  })
})

describe('material track duration clamping', () => {
  it('clamps material keyframes beyond a shortened duration and records old times', () => {
    const { engine, node } = engineWithProject()
    const json = jsonWithMaterialTracks(engine, node.id, [
      { parameter: 'uSteps', keyframes: [{ id: 'k1', time: 8, value: 2 }] },
    ])
    const restored = restoredEngine()
    restored.restoreFromJSON(json)
    const slideId = restored.getSlideOfNode(node.id).id

    const change = restored.setSlideDuration(slideId, 5)

    expect(change.clampedKeyframes).toEqual([
      { nodeId: node.id, parameterKey: 'uSteps', keyframeId: 'k1', oldTime: 8 },
    ])
    const keyframe = restored
      .getSlideOfNode(node.id)
      .animation.node(node.id)
      ?.materialKeyframes('uSteps')[0]
    expect(keyframe?.time).toBe(5)
  })

  it('leaves material keyframes within a shortened duration untouched', () => {
    const { engine, node } = engineWithProject()
    const json = jsonWithMaterialTracks(engine, node.id, [
      { parameter: 'uSteps', keyframes: [{ id: 'k1', time: 2, value: 2 }] },
    ])
    const restored = restoredEngine()
    restored.restoreFromJSON(json)
    const slideId = restored.getSlideOfNode(node.id).id

    const change = restored.setSlideDuration(slideId, 5)

    expect(change.clampedKeyframes).toEqual([])
  })
})
