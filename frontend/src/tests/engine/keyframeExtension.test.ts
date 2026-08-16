import { describe, expect, it } from 'vitest'
import { Keyframe, ZERO_TANGENT, newKeyframeId } from '../../engine/keyframe'
import type { KeyframeTangent } from '../../engine/keyframe'
import { createEngine } from '../../engine/internal'

describe('Keyframe model extension', () => {
  it('defaults to linear interpolation and zero-length tangents', () => {
    const keyframe = new Keyframe('k1', 1, 10)
    expect(keyframe.interpolation).toBe('linear')
    expect(keyframe.tangentIn).toEqual(ZERO_TANGENT)
    expect(keyframe.tangentOut).toEqual(ZERO_TANGENT)
  })

  it('stores explicit interpolation and tangents', () => {
    const tangentIn: KeyframeTangent = { time: -0.5, value: -20 }
    const tangentOut: KeyframeTangent = { time: 0.5, value: 20 }
    const keyframe = new Keyframe('k1', 1, 10, 'bezier', tangentIn, tangentOut)
    expect(keyframe.interpolation).toBe('bezier')
    expect(keyframe.tangentIn).toEqual(tangentIn)
    expect(keyframe.tangentOut).toEqual(tangentOut)
  })

  it('round-trips interpolation, tangents, and generalized values through JSON', () => {
    const keyframe = new Keyframe(
      'k1',
      1.5,
      10,
      'bezier',
      { time: -0.25, value: -5 },
      {
        time: 0.25,
        value: 5,
      },
    )
    expect(keyframe.toJSON()).toEqual({
      id: 'k1',
      time: 1.5,
      value: 10,
      interpolation: 'bezier',
      tangentIn: { time: -0.25, value: -5 },
      tangentOut: { time: 0.25, value: 5 },
    })
    expect(newKeyframeId()).not.toBe(newKeyframeId())
  })

  it('accepts generalized values (string, boolean, number arrays)', () => {
    const keyframe = new Keyframe('k1', 1, [0.1, 0.2])
    expect(keyframe.value).toEqual([0.1, 0.2])
    keyframe.value = true
    expect(keyframe.value).toBe(true)
    keyframe.value = 'asset-1'
    expect(keyframe.value).toBe('asset-1')
    keyframe.value = 42
    expect(keyframe.value).toBe(42)
    keyframe.value = [0.1, 0.2]
    expect(keyframe.value).toEqual([0.1, 0.2])
  })
})

describe('new keyframes inherit the previous keyframe interpolation', () => {
  const positionX = (nodeId: string) => ({ kind: 'node', nodeId, property: 'positionX' }) as const

  it('defaults to linear on an empty track', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
    engine.addKeyframe(positionX(node.id), 1, 10)
    expect(engine.getKeyframes(node.id, 'positionX')[0]?.interpolation).toBe('linear')
  })

  it('inherits the previous keyframe interpolation when appending', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
    engine.addKeyframe(positionX(node.id), 1, 10)
    const first = engine.getKeyframes(node.id, 'positionX')[0]
    if (!first) {
      throw new Error('expected a keyframe')
    }
    first.interpolation = 'bezier'
    engine.addKeyframe(positionX(node.id), 4, 40)
    expect(engine.getKeyframes(node.id, 'positionX')[1]?.interpolation).toBe('bezier')
  })

  it('inherits the left keyframe interpolation when inserting mid-segment', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'A')
    engine.addKeyframe(positionX(node.id), 0, 0)
    engine.addKeyframe(positionX(node.id), 5, 50)
    const first = engine.getKeyframes(node.id, 'positionX')[0]
    if (!first) {
      throw new Error('expected a keyframe')
    }
    first.interpolation = 'hold'
    engine.addKeyframe(positionX(node.id), 3, 30)
    const inserted = engine
      .getKeyframes(node.id, 'positionX')
      .find((keyframe) => keyframe.time === 3)
    expect(inserted?.interpolation).toBe('hold')
  })
})
