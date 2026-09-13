import { describe, expect, it } from 'vitest'
import {
  createCommandSystem,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateClipCommand,
  AddClipKeyframeCommand,
  AddKeyframeCommand,
} from '../../engine/commands'
import { createControl, createControlSet } from '../../engine/control'
import { Keyframe } from '../../engine/keyframe'

function ok<T>(result: { ok: true; inverse: T } | { ok: false; error: Error }): T {
  if (!result.ok) throw result.error
  return result.inverse
}

describe('parametric controls', () => {
  it('drives descendants after time clips and persists the definition and track', () => {
    const system = createCommandSystem()
    ok(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Controls' })))
    ok(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide' })))
    const slide = system.engine.project!.slides[0]
    const host = ok(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Rig',
        }),
      ),
    )
    const child = ok(
      system.dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: host.nodeId, name: 'Target' }),
      ),
    )
    const clip = ok(
      system.dispatcher.dispatch(
        new CreateClipCommand({
          name: 'Normalized X',
          duration: 1,
          category: 'control',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ),
    )
    ok(
      system.dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId: clip.clipId, channel: 'positionX' },
          time: 0,
          value: 10,
        }),
      ),
    )
    ok(
      system.dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId: clip.clipId, channel: 'positionX' },
          time: 1,
          value: 30,
        }),
      ),
    )

    const target = slide.scene.getNode(child.nodeId)!
    target.semanticName = 'target'
    const rig = slide.scene.getNode(host.nodeId)!
    rig.controlSet = createControlSet(rig.id, [
      createControl({ key: 'Mouth.Openness', bindings: { target: clip.clipId }, exposed: true }),
    ])
    const track = slide.animation.ensure(rig.id)
    track.addControl('Mouth.Openness', new Keyframe('control-start', 0, 0))
    const added = ok(
      system.dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'control', nodeId: rig.id, controlKey: 'Mouth.Openness' },
          time: slide.duration,
          value: 1,
        }),
      ),
    )
    expect(added.keyframe.keyframeId).toBeTruthy()

    expect(system.engine.evaluateNode(target.id, slide.duration / 2).transform.x).toBe(20)
    const json = slide.toJSON()
    const jsonNode = json.scene.nodes.find((node) => node.id === rig.id)!
    expect(jsonNode.controlSet?.controls[0].key).toBe('Mouth.Openness')
    expect(
      json.animation?.nodes.find((node) => node.nodeId === rig.id)?.controlTracks,
    ).toHaveLength(1)
  })

  it('enforces stable control keys', () => {
    expect(() => createControl({ key: '1invalid' })).toThrow()
    expect(() =>
      createControlSet('host', [createControl({ key: 'Open' }), createControl({ key: 'Open' })]),
    ).toThrow()
  })
})
