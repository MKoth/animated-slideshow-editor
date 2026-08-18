import { describe, expect, it } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import type { KeyframeTarget } from '../../engine/keyframeTarget'

const CUSTOM_MATERIAL = {
  id: 'mat-params',
  name: 'Params',
  parameters: [
    { key: 'uSteps', kind: 'int', default: 2 },
    { key: 'uGlow', kind: 'float', default: 0.5 },
    { key: 'uColor', kind: 'color', default: '#ff0000' },
    { key: 'uEnabled', kind: 'bool', default: true },
  ],
}

function setup() {
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

function collectEvents(engine: Engine): EngineEvent[] {
  const events: EngineEvent[] = []
  engine.subscribe((event) => events.push(event))
  return events
}

const positionX = (nodeId: string): KeyframeTarget => ({
  kind: 'node',
  nodeId,
  property: 'positionX',
})

const uGlow = (nodeId: string): KeyframeTarget => ({
  kind: 'node',
  nodeId,
  parameter: 'uGlow',
})

describe('addKeyframe through the engine', () => {
  it('adds to a property track with the value, sorted, emitting KeyframeAdded with the target', () => {
    const { engine, node } = setup()
    const events = collectEvents(engine)
    const keyframe = engine.addKeyframe(positionX(node.id), 2.5, 100)
    expect(keyframe.time).toBe(2.5)
    expect(keyframe.value).toBe(100)
    expect(keyframe.interpolation).toBe('linear')
    expect(engine.getKeyframes(node.id, 'positionX').map((entry) => entry.id)).toEqual([
      keyframe.id,
    ])
    expect(events).toEqual([
      { type: 'KeyframeAdded', target: positionX(node.id), keyframeId: keyframe.id },
    ])
  })

  it('adds to a material track with a per-kind value, emitting the parameter target', () => {
    const { engine, node } = setup()
    const events = collectEvents(engine)
    const keyframe = engine.addKeyframe(uGlow(node.id), 1, 0.75)
    expect(keyframe.value).toBe(0.75)
    expect(engine.hasMaterialTrack(node.id, 'uGlow')).toBe(true)
    expect(engine.getMaterialKeyframes(node.id, 'uGlow').map((entry) => entry.id)).toEqual([
      keyframe.id,
    ])
    expect(events).toEqual([
      { type: 'KeyframeAdded', target: uGlow(node.id), keyframeId: keyframe.id },
    ])
  })

  it('adds color-typed values to a material track', () => {
    const { engine, node } = setup()
    engine.addKeyframe({ kind: 'node', nodeId: node.id, parameter: 'uColor' }, 0.5, '#00ff00')
    expect(engine.getMaterialKeyframes(node.id, 'uColor')[0]?.value).toBe('#00ff00')
  })

  it('rejects an unknown node, camera rotation, unknown parameter, and out-of-bounds time', () => {
    const { engine, slide, node } = setup()
    const events = collectEvents(engine)

    expect(() => engine.addKeyframe(positionX('ghost'), 1, 10)).toThrow(/node.*not found/i)
    expect(() =>
      engine.addKeyframe(
        { kind: 'node', nodeId: slide.scene.camera.id, property: 'rotation' },
        1,
        0.5,
      ),
    ).toThrow(/rotation/i)
    expect(() =>
      engine.addKeyframe({ kind: 'node', nodeId: node.id, parameter: 'uGhost' }, 1, 10),
    ).toThrow(/unknown material parameter/i)
    expect(() => engine.addKeyframe(positionX(node.id), -0.01, 10)).toThrow(/within/i)
    expect(() => engine.addKeyframe(positionX(node.id), slide.duration + 0.01, 10)).toThrow(
      /within/i,
    )
    expect(engine.getKeyframes(node.id, 'positionX')).toHaveLength(0)
    expect(engine.hasMaterialTrack(node.id, 'uGlow')).toBe(false)
    expect(events).toEqual([])
  })

  it('rejects values invalid for the property or the parameter kind', () => {
    const { engine, node } = setup()
    expect(() =>
      engine.addKeyframe({ kind: 'node', nodeId: node.id, property: 'opacity' }, 1, 1.5),
    ).toThrow(/opacity/i)
    expect(() =>
      engine.addKeyframe({ kind: 'node', nodeId: node.id, parameter: 'uSteps' }, 1, 2.5),
    ).toThrow(/integer/i)
    expect(() =>
      engine.addKeyframe({ kind: 'node', nodeId: node.id, parameter: 'uColor' }, 1, 'green'),
    ).toThrow(/hex/i)
    expect(engine.hasMaterialTrack(node.id, 'uSteps')).toBe(false)
  })

  it('rejects a time already occupied on the same track', () => {
    const { engine, node } = setup()
    engine.addKeyframe(positionX(node.id), 1, 10)
    expect(() => engine.addKeyframe(positionX(node.id), 1, 99)).toThrow(/already has a keyframe/i)
    expect(engine.getKeyframes(node.id, 'positionX')[0]?.value).toBe(10)
  })

  it('allows the same time on a material track and a property track', () => {
    const { engine, node } = setup()
    engine.addKeyframe(positionX(node.id), 1, 10)
    engine.addKeyframe(uGlow(node.id), 1, 0.5)
    expect(engine.getKeyframes(node.id, 'positionX')).toHaveLength(1)
    expect(engine.getMaterialKeyframes(node.id, 'uGlow')).toHaveLength(1)
  })
})

describe('deleteKeyframes through the engine', () => {
  it('deletes one or many keyframes, emitting one KeyframeRemoved per keyframe', () => {
    const { engine, node } = setup()
    const first = engine.addKeyframe(positionX(node.id), 1, 10)
    const material = engine.addKeyframe(uGlow(node.id), 2, 0.5)
    const third = engine.addKeyframe(positionX(node.id), 3, 30)
    const events = collectEvents(engine)

    const removed = engine.deleteKeyframes(positionX(node.id), [first.id, third.id])
    expect(removed.map((keyframe) => keyframe.id)).toEqual([first.id, third.id])
    expect(engine.getKeyframes(node.id, 'positionX')).toHaveLength(0)
    expect(engine.getMaterialKeyframes(node.id, 'uGlow')).toHaveLength(1)
    expect(engine.getMaterialKeyframes(node.id, 'uGlow')[0]?.id).toBe(material.id)
    expect(events).toEqual([
      { type: 'KeyframeRemoved', target: positionX(node.id), keyframeId: first.id },
      { type: 'KeyframeRemoved', target: positionX(node.id), keyframeId: third.id },
    ])
  })

  it('removes the material track when its last keyframe goes', () => {
    const { engine, node } = setup()
    const keyframe = engine.addKeyframe(uGlow(node.id), 1, 0.5)
    engine.deleteKeyframes(uGlow(node.id), [keyframe.id])
    expect(engine.hasMaterialTrack(node.id, 'uGlow')).toBe(false)
  })

  it('rejects deleting with an unknown keyframe id, leaving the engine unchanged', () => {
    const { engine, node } = setup()
    const keyframe = engine.addKeyframe(positionX(node.id), 1, 10)
    expect(() => engine.deleteKeyframes(positionX(node.id), [keyframe.id, 'ghost'])).toThrow(
      /keyframe.*not found/i,
    )
    expect(engine.getKeyframes(node.id, 'positionX')).toHaveLength(1)
  })

  it('rejects an empty delete batch', () => {
    const { engine, node } = setup()
    expect(() => engine.deleteKeyframes(positionX(node.id), [])).toThrow(/at least one/i)
  })
})

describe('moveKeyframes through the engine', () => {
  it('moves one or many keyframes in time, values unchanged, one KeyframeMoved per keyframe', () => {
    const { engine, node } = setup()
    const first = engine.addKeyframe(positionX(node.id), 1, 10)
    const second = engine.addKeyframe(positionX(node.id), 2, 20)
    const events = collectEvents(engine)

    const results = engine.moveKeyframes(positionX(node.id), [
      { keyframeId: first.id, newTime: 4 },
      { keyframeId: second.id, newTime: 5 },
    ])
    expect(results).toEqual([
      { keyframeId: first.id, oldTime: 1 },
      { keyframeId: second.id, oldTime: 2 },
    ])
    expect(
      engine.getKeyframes(node.id, 'positionX').map((keyframe) => [keyframe.id, keyframe.time]),
    ).toEqual([
      [first.id, 4],
      [second.id, 5],
    ])
    expect(engine.getKeyframes(node.id, 'positionX')[0]?.value).toBe(10)
    expect(events).toEqual([
      { type: 'KeyframeMoved', target: positionX(node.id), keyframeId: first.id },
      { type: 'KeyframeMoved', target: positionX(node.id), keyframeId: second.id },
    ])
  })

  it('moves material keyframes with per-kind values intact', () => {
    const { engine, node } = setup()
    const keyframe = engine.addKeyframe(uGlow(node.id), 1, 0.5)
    engine.moveKeyframes(uGlow(node.id), [{ keyframeId: keyframe.id, newTime: 3 }])
    expect(engine.getMaterialKeyframes(node.id, 'uGlow')[0]?.time).toBe(3)
    expect(engine.getMaterialKeyframes(node.id, 'uGlow')[0]?.value).toBe(0.5)
  })

  it('rejects the whole batch when any move is invalid and leaves the engine unchanged', () => {
    const { engine, node } = setup()
    const first = engine.addKeyframe(positionX(node.id), 1, 10)
    engine.addKeyframe(positionX(node.id), 2, 20)
    expect(() =>
      engine.moveKeyframes(positionX(node.id), [
        { keyframeId: first.id, newTime: 5 },
        { keyframeId: 'ghost', newTime: 6 },
      ]),
    ).toThrow(/keyframe.*not found/i)
    expect(engine.getKeyframes(node.id, 'positionX').map((keyframe) => keyframe.time)).toEqual([
      1, 2,
    ])
  })

  it('rejects two keyframes moving onto the same time and a time occupied by a stationary keyframe', () => {
    const { engine, node } = setup()
    const first = engine.addKeyframe(positionX(node.id), 1, 10)
    const second = engine.addKeyframe(positionX(node.id), 2, 20)
    const stationary = engine.addKeyframe(positionX(node.id), 3, 30)

    expect(() =>
      engine.moveKeyframes(positionX(node.id), [
        { keyframeId: first.id, newTime: 5 },
        { keyframeId: second.id, newTime: 5 },
      ]),
    ).toThrow(/same time/i)
    expect(() =>
      engine.moveKeyframes(positionX(node.id), [
        { keyframeId: first.id, newTime: stationary.time },
      ]),
    ).toThrow(/already has a keyframe/i)
    expect(engine.getKeyframes(node.id, 'positionX').map((keyframe) => keyframe.time)).toEqual([
      1, 2, 3,
    ])
  })

  it('rejects a move beyond the slide duration', () => {
    const { engine, slide, node } = setup()
    const keyframe = engine.addKeyframe(positionX(node.id), 1, 10)
    expect(() =>
      engine.moveKeyframes(positionX(node.id), [
        { keyframeId: keyframe.id, newTime: slide.duration + 1 },
      ]),
    ).toThrow(/within/i)
    expect(engine.getKeyframes(node.id, 'positionX')[0]?.time).toBe(1)
  })
})

describe('setKeyframeValue through the engine', () => {
  it('changes a property value and returns the old value', () => {
    const { engine, node } = setup()
    const keyframe = engine.addKeyframe(positionX(node.id), 1, 10)
    const events = collectEvents(engine)
    const oldValue = engine.setKeyframeValue(positionX(node.id), keyframe.id, 42)
    expect(oldValue).toBe(10)
    expect(engine.getKeyframes(node.id, 'positionX')[0]?.value).toBe(42)
    expect(events).toEqual([
      { type: 'KeyframeValueChanged', target: positionX(node.id), keyframeId: keyframe.id },
    ])
  })

  it('changes a material value per its kind and rejects invalid values', () => {
    const { engine, node } = setup()
    const keyframe = engine.addKeyframe(uGlow(node.id), 1, 0.5)
    expect(engine.setKeyframeValue(uGlow(node.id), keyframe.id, 0.9)).toBe(0.5)
    expect(engine.getMaterialKeyframes(node.id, 'uGlow')[0]?.value).toBe(0.9)
    expect(() => engine.setKeyframeValue(uGlow(node.id), keyframe.id, Number.NaN)).toThrow(
      /finite/i,
    )
  })
})

describe('scaleKeyframes through the engine', () => {
  it('scales times around the pivot and reports old times', () => {
    const { engine, node } = setup()
    const first = engine.addKeyframe(positionX(node.id), 1, 10)
    const second = engine.addKeyframe(positionX(node.id), 2, 20)
    const third = engine.addKeyframe(positionX(node.id), 4, 40)

    const results = engine.scaleKeyframes(positionX(node.id), [first.id, second.id, third.id], 0, 2)
    expect(results).toEqual([
      { keyframeId: first.id, oldTime: 1 },
      { keyframeId: second.id, oldTime: 2 },
      { keyframeId: third.id, oldTime: 4 },
    ])
    expect(engine.getKeyframes(node.id, 'positionX').map((keyframe) => keyframe.time)).toEqual([
      2, 4, 8,
    ])
  })

  it('scaling around the same pivot with the reciprocal factor reproduces the original times exactly', () => {
    const { engine, node } = setup()
    const times = [1, 2, 4, 7]
    const ids = times.map((time) => engine.addKeyframe(positionX(node.id), time, time).id)

    engine.scaleKeyframes(positionX(node.id), ids, 3, 1.5)
    const scaled = engine.getKeyframes(node.id, 'positionX').map((keyframe) => keyframe.time)
    expect(scaled).not.toEqual(times)
    engine.scaleKeyframes(positionX(node.id), ids, 3, 2 / 3)
    expect(engine.getKeyframes(node.id, 'positionX').map((keyframe) => keyframe.time)).toEqual(
      times,
    )
  })

  it('scales material keyframes with the pivot in effect', () => {
    const { engine, node } = setup()
    const keyframe = engine.addKeyframe(uGlow(node.id), 1, 0.5)
    engine.scaleKeyframes(uGlow(node.id), [keyframe.id], 0, 2)
    expect(engine.getMaterialKeyframes(node.id, 'uGlow')[0]?.time).toBe(2)
    expect(engine.getMaterialKeyframes(node.id, 'uGlow')[0]?.value).toBe(0.5)
  })

  it('rejects a scale pushing times out of bounds or collapsing onto each other', () => {
    const { engine, slide, node } = setup()
    const first = engine.addKeyframe(positionX(node.id), 1, 10)
    const second = engine.addKeyframe(positionX(node.id), 2, 20)
    expect(() => engine.scaleKeyframes(positionX(node.id), [first.id, second.id], 0, 10)).toThrow(
      /within/i,
    )
    expect(() => engine.scaleKeyframes(positionX(node.id), [first.id, second.id], 0, 0)).toThrow(
      /same time/i,
    )
    expect(() =>
      engine.scaleKeyframes(positionX(node.id), [first.id, second.id], 0, slide.duration * 2),
    ).toThrow()
    expect(engine.getKeyframes(node.id, 'positionX').map((keyframe) => keyframe.time)).toEqual([
      1, 2,
    ])
  })
})

describe('pasteKeyframes through the engine', () => {
  it('creates copies at the origin time plus relative offsets, clamping to bounds', () => {
    const { engine, slide, node } = setup()
    const keyframes = engine.pasteKeyframes(
      positionX(node.id),
      {
        keyframes: [
          {
            time: 0,
            value: 10,
            interpolation: 'hold',
            tangentIn: { time: 0, value: 0 },
            tangentOut: { time: 0, value: 0 },
          },
          {
            time: 1,
            value: 20,
            interpolation: 'bezier',
            tangentIn: { time: -0.5, value: 2 },
            tangentOut: { time: 0.5, value: 2 },
          },
        ],
      },
      slide.duration - 0.5,
    )
    expect(keyframes.map((keyframe) => keyframe.time)).toEqual([
      slide.duration - 0.5,
      slide.duration,
    ])
    expect(keyframes.map((keyframe) => keyframe.interpolation)).toEqual(['hold', 'bezier'])
    expect(keyframes[1]?.tangentOut).toEqual({ time: 0.5, value: 2 })
  })

  it('copies material keyframes with their kind-valid values', () => {
    const { engine, node } = setup()
    engine.addKeyframe(uGlow(node.id), 1, 0.5)
    const copied = engine.pasteKeyframes(
      uGlow(node.id),
      {
        keyframes: [
          {
            time: 0,
            value: 0.5,
            interpolation: 'linear',
            tangentIn: { time: 0, value: 0 },
            tangentOut: { time: 0, value: 0 },
          },
        ],
      },
      2,
    )
    expect(
      engine
        .getMaterialKeyframes(node.id, 'uGlow')
        .map((keyframe) => [keyframe.time, keyframe.value]),
    ).toEqual([
      [1, 0.5],
      [2, 0.5],
    ])
    expect(copied[0]?.time).toBe(2)
  })

  it('rejects a paste colliding with existing keyframes or with clamped duplicates', () => {
    const { engine, slide, node } = setup()
    engine.addKeyframe(positionX(node.id), 1, 10)
    expect(() =>
      engine.pasteKeyframes(
        positionX(node.id),
        {
          keyframes: [
            {
              time: 0,
              value: 10,
              interpolation: 'linear',
              tangentIn: { time: 0, value: 0 },
              tangentOut: { time: 0, value: 0 },
            },
          ],
        },
        1,
      ),
    ).toThrow(/already has a keyframe/i)
    expect(() =>
      engine.pasteKeyframes(
        positionX(node.id),
        {
          keyframes: [
            {
              time: 0,
              value: 10,
              interpolation: 'linear',
              tangentIn: { time: 0, value: 0 },
              tangentOut: { time: 0, value: 0 },
            },
            {
              time: 1,
              value: 20,
              interpolation: 'linear',
              tangentIn: { time: 0, value: 0 },
              tangentOut: { time: 0, value: 0 },
            },
          ],
        },
        slide.duration,
      ),
    ).toThrow()
    expect(engine.getKeyframes(node.id, 'positionX')).toHaveLength(1)
  })

  it('rejects an empty paste payload', () => {
    const { engine, node } = setup()
    expect(() => engine.pasteKeyframes(positionX(node.id), { keyframes: [] }, 0)).toThrow(
      /at least one/i,
    )
  })
})

describe('duplicateKeyframes through the engine', () => {
  it('places copies immediately after the last selected keyframe, preserving spacing', () => {
    const { engine, node } = setup()
    const first = engine.addKeyframe(positionX(node.id), 1, 10)
    const second = engine.addKeyframe(positionX(node.id), 3, 30)
    const copied = engine.duplicateKeyframes(positionX(node.id), [first.id, second.id])
    expect(copied).toHaveLength(2)
    expect(engine.getKeyframes(node.id, 'positionX').map((keyframe) => keyframe.time)).toEqual([
      1,
      3,
      3 + 1 / 60,
      5 + 1 / 60,
    ])
  })

  it('duplicates a single keyframe one frame step after it', () => {
    const { engine, node } = setup()
    const keyframe = engine.addKeyframe(positionX(node.id), 2, 20)
    const copied = engine.duplicateKeyframes(positionX(node.id), [keyframe.id])
    expect(engine.getKeyframes(node.id, 'positionX').map((entry) => entry.time)).toEqual([
      2,
      2 + 1 / 60,
    ])
    expect(copied[0]?.value).toBe(20)
  })

  it('rejects a duplicate whose copies would run past the slide duration', () => {
    const { engine, slide, node } = setup()
    const keyframe = engine.addKeyframe(positionX(node.id), slide.duration, 10)
    expect(() => engine.duplicateKeyframes(positionX(node.id), [keyframe.id])).toThrow(/within/i)
    expect(engine.getKeyframes(node.id, 'positionX')).toHaveLength(1)
  })
})

describe('interpolation and tangents through the engine', () => {
  it('sets interpolation and emits KeyframeInterpolationChanged with the target', () => {
    const { engine, node } = setup()
    const keyframe = engine.addKeyframe(positionX(node.id), 1, 10)
    const events = collectEvents(engine)
    const old = engine.setKeyframeInterpolation(positionX(node.id), keyframe.id, 'bezier')
    expect(old).toBe('linear')
    expect(engine.getKeyframes(node.id, 'positionX')[0]?.interpolation).toBe('bezier')
    expect(events).toEqual([
      { type: 'KeyframeInterpolationChanged', target: positionX(node.id), keyframeId: keyframe.id },
    ])
  })

  it('rejects an unknown interpolation and leaves the keyframe unchanged', () => {
    const { engine, node } = setup()
    const keyframe = engine.addKeyframe(positionX(node.id), 1, 10)
    expect(() =>
      engine.setKeyframeInterpolation(positionX(node.id), keyframe.id, 'nonexistent' as never),
    ).toThrow(/unknown keyframe interpolation/i)
    expect(engine.getKeyframes(node.id, 'positionX')[0]?.interpolation).toBe('linear')
  })

  it('sets tangents and emits KeyframeTangentsChanged with the target', () => {
    const { engine, node } = setup()
    const keyframe = engine.addKeyframe(positionX(node.id), 1, 10)
    const events = collectEvents(engine)
    const old = engine.setKeyframeTangents(
      positionX(node.id),
      keyframe.id,
      { time: -0.5, value: 2 },
      { time: 0.5, value: 2 },
    )
    expect(old).toEqual({
      tangentIn: { time: 0, value: 0 },
      tangentOut: { time: 0, value: 0 },
    })
    const updated = engine.getKeyframes(node.id, 'positionX')[0]
    expect(updated?.tangentIn).toEqual({ time: -0.5, value: 2 })
    expect(updated?.tangentOut).toEqual({ time: 0.5, value: 2 })
    expect(events).toEqual([
      { type: 'KeyframeTangentsChanged', target: positionX(node.id), keyframeId: keyframe.id },
    ])
  })

  it('sets interpolation and tangents on material keyframes', () => {
    const { engine, node } = setup()
    const keyframe = engine.addKeyframe(uGlow(node.id), 1, 0.5)
    engine.setKeyframeInterpolation(uGlow(node.id), keyframe.id, 'hold')
    engine.setKeyframeTangents(
      uGlow(node.id),
      keyframe.id,
      { time: -0.1, value: 1 },
      { time: 0.1, value: 1 },
    )
    const updated = engine.getMaterialKeyframes(node.id, 'uGlow')[0]
    expect(updated?.interpolation).toBe('hold')
    expect(updated?.tangentIn).toEqual({ time: -0.1, value: 1 })
  })
})
