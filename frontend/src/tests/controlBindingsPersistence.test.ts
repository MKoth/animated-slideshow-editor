import { describe, expect, it } from 'vitest'
import { createEngineInternal } from '../engine/internal'
import { createControl, createControlSet } from '../engine/control'
import { Keyframe } from '../engine/keyframe'

function createControlClip(
  engine: ReturnType<typeof createEngineInternal>,
  name: string,
  value: number,
) {
  const clip = engine.createClip(name, 1, 'control', [], [{ property: 'positionX' }])
  clip.addChannelKeyframe('positionX', new Keyframe(`${name}-start`, 0, value))
  clip.addChannelKeyframe('positionX', new Keyframe(`${name}-end`, 1, value))
  return clip
}

describe('control bindings', () => {
  it('evaluates and reloads multiple clips bound to one semantic name', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'Host')
    const child = engine.createNode(slide.scene.id, host.id, 'Child')
    child.semanticName = 'hand'

    const first = createControlClip(engine, 'First', 10)
    const second = createControlClip(engine, 'Second', 20)
    host.controlSet = createControlSet(host.id, [
      createControl({
        key: 'Pose',
        bindings: {
          hand: [
            { clipId: first.id, start: 0, end: 0.5 },
            { clipId: second.id, start: 0.5, end: 1 },
          ],
        },
      }),
    ])
    engine.addKeyframe({ kind: 'control', nodeId: host.id, controlKey: 'Pose' }, 0, 0)
    engine.addKeyframe({ kind: 'control', nodeId: host.id, controlKey: 'Pose' }, 10, 1)

    expect(engine.evaluateNode(child.id, 2.5).transform.x).toBe(10)
    expect(engine.evaluateNode(child.id, 7.5).transform.x).toBe(20)

    const restored = createEngineInternal()
    restored.restoreFromJSON(engine.toJSON())
    const restoredChild = restored.getNode(child.id)
    expect(restored.evaluateNode(restoredChild.id, 2.5).transform.x).toBe(10)
    expect(restored.evaluateNode(restoredChild.id, 7.5).transform.x).toBe(20)
  })
})
