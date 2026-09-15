/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import { createControl, createControlSet, addGroupToControlSet } from '../../engine/control'
import { Keyframe, ZERO_TANGENT } from '../../engine/keyframe'
import {
  createCommandSystem,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateNodeCommand,
  CreateClipCommand,
  AddClipKeyframeCommand,
  AddKeyframeCommand,
  RenameControlCommand,
  DeleteKeyframesCommand,
  MoveKeyframesCommand,
  ScaleKeyframesCommand,
  SetKeyframeValueCommand,
  SetKeyframeInterpolationCommand,
  SetKeyframeTangentsCommand,
  SetKeyframeDisabledCommand,
  PasteKeyframesCommand,
  DuplicateKeyframesCommand,
} from '../../engine/commands'
import { SetControlBlendCommand } from '../../engine/commands/setControlBlendCommand'

function ok(res: any): any {
  if (!res.ok) throw (res as any).error
  return (res as any).inverse
}

function setupTwoGroup() {
  const system = createCommandSystem()
  ok(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  ok(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project!.slides[0]
  const host = ok(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Rig',
      }),
    ),
  ).nodeId as string
  const child = ok(
    system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId: slide.scene.id, parentId: host, name: 'Child' }),
    ),
  ).nodeId as string
  system.engine.getNode(child).semanticName = 'mouth'
  const clip1 = ok(
    system.dispatcher.dispatch(
      new CreateClipCommand({
        name: 'Clip1',
        duration: 1,
        category: 'control',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    ),
  ).clipId as string
  const clip2 = ok(
    system.dispatcher.dispatch(
      new CreateClipCommand({
        name: 'Clip2',
        duration: 1,
        category: 'control',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    ),
  ).clipId as string
  ok(
    system.dispatcher.dispatch(
      new AddClipKeyframeCommand({
        target: { kind: 'clip', clipId: clip1, channel: 'positionX' },
        time: 0,
        value: 10,
      }),
    ),
  )
  ok(
    system.dispatcher.dispatch(
      new AddClipKeyframeCommand({
        target: { kind: 'clip', clipId: clip1, channel: 'positionX' },
        time: 1,
        value: 20,
      }),
    ),
  )
  ok(
    system.dispatcher.dispatch(
      new AddClipKeyframeCommand({
        target: { kind: 'clip', clipId: clip2, channel: 'positionX' },
        time: 0,
        value: 100,
      }),
    ),
  )
  ok(
    system.dispatcher.dispatch(
      new AddClipKeyframeCommand({
        target: { kind: 'clip', clipId: clip2, channel: 'positionX' },
        time: 1,
        value: 200,
      }),
    ),
  )
  let cs = createControlSet(host, [createControl({ key: 'Host', bindings: { mouth: clip1 } })])
  cs = addGroupToControlSet(cs, 'Host', 'Second')
  const h = cs.controls[0]
  const newG1 = { ...h.groups[0], bindings: { mouth: { clipId: clip1, start: 0, end: 1 } } }
  const newG2 = { ...h.groups[1], bindings: { mouth: { clipId: clip2, start: 0, end: 1 } } }
  cs = {
    ...cs,
    controls: [
      {
        ...h,
        groups: [newG1, newG2],
        bindings: { mouth: { clipId: clip2, start: 0, end: 1 } } as any,
      },
    ],
  }
  system.engine.getNode(host).controlSet = cs
  return { system, slide, host, child, clip1, clip2 }
}

describe('RenameControl host-only + blend-inside-host-kf (redesign)', () => {
  it('renames host-only, moves host track, preserves blend, undoable', () => {
    const { system, slide, host, child } = setupTwoGroup()
    const anim = slide.animation.ensure(host)
    anim.addControl(
      'Host',
      new Keyframe('kHost1', 0, 0.5, 'linear', ZERO_TANGENT, ZERO_TANGENT, false, [0.5]),
    )
    let val = system.engine.evaluateNode(child, 0).transform.x
    // U=0.5 => G1=15, G2=150, blend 0.5 => 82.5
    expect(val).toBeCloseTo(82.5)

    // Rename host
    const res = system.dispatcher.dispatch(
      new RenameControlCommand({ hostNodeId: host, oldKey: 'Host', newKey: 'HostRenamed' }),
    )
    expect(res.ok).toBe(true)
    const afterCS = system.engine.getNode(host).controlSet!
    expect(afterCS.controls[0].key).toBe('HostRenamed')
    expect(afterCS.controls.length).toBe(1)
    expect(anim.controlTrackKeys()).toContain('HostRenamed')
    expect(anim.controlTrackKeys()).not.toContain('Host')
    // Blend preserved inside kf
    expect(anim.controlKeyframes('HostRenamed')[0].blend).toEqual([0.5])
    val = system.engine.evaluateNode(child, 0).transform.x
    expect(val).toBeCloseTo(82.5)

    system.dispatcher.undo()
    expect(system.engine.getNode(host).controlSet!.controls[0].key).toBe('Host')
    expect(anim.controlTrackKeys()).toContain('Host')
  })

  it('SetControlBlendCommand is undoable and drives strict lerp', () => {
    const { system, slide, host, child } = setupTwoGroup()
    const anim = slide.animation.ensure(host)
    anim.addControl(
      'Host',
      new Keyframe('kh', 0, 0.5, 'linear', ZERO_TANGENT, ZERO_TANGENT, false, [0]),
    )
    expect(system.engine.evaluateNode(child, 0).transform.x).toBeCloseTo(15)
    const kfId = anim.controlKeyframes('Host')[0].id
    const res = system.dispatcher.dispatch(
      new SetControlBlendCommand({
        hostNodeId: host,
        controlKey: 'Host',
        keyframeId: kfId,
        blendIndex: 0,
        value: 1,
      }),
    )
    expect(res.ok).toBe(true)
    expect(anim.controlKeyframes('Host')[0].blend).toEqual([1])
    expect(system.engine.evaluateNode(child, 0).transform.x).toBeCloseTo(150)
    system.dispatcher.undo()
    expect(anim.controlKeyframes('Host')[0].blend).toEqual([0])
    expect(system.engine.evaluateNode(child, 0).transform.x).toBeCloseTo(15)
  })

  it('generic kf ops preserve blend: add/move/scale/value/interp/tangents/disabled/duplicate/paste/delete', () => {
    const { system, slide, host } = setupTwoGroup()
    const anim = slide.animation.ensure(host)
    let res: any = system.dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'Host' },
        time: 0,
        value: 0.5,
      }),
    )
    expect(res.ok).toBe(true)
    const kfId = anim.controlKeyframes('Host')[0].id
    // Set blend via command
    res = system.dispatcher.dispatch(
      new SetControlBlendCommand({
        hostNodeId: host,
        controlKey: 'Host',
        keyframeId: kfId,
        blendIndex: 0,
        value: 0.7,
      }),
    )
    expect(res.ok).toBe(true)
    expect(anim.controlKeyframes('Host')[0].blend).toEqual([0.7])

    // set value preserves blend
    res = system.dispatcher.dispatch(
      new SetKeyframeValueCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'Host' },
        keyframeId: kfId,
        newValue: 0.6,
      }),
    )
    expect(res.ok).toBe(true)
    expect(anim.controlKeyframes('Host')[0].blend).toEqual([0.7])

    // set interp preserves
    res = system.dispatcher.dispatch(
      new SetKeyframeInterpolationCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'Host' },
        keyframeId: kfId,
        interpolation: 'hold',
      }),
    )
    expect(res.ok).toBe(true)
    expect(anim.controlKeyframes('Host')[0].blend).toEqual([0.7])

    // set tangents preserves
    res = system.dispatcher.dispatch(
      new SetKeyframeTangentsCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'Host' },
        keyframeId: kfId,
        tangentIn: { time: 1, value: 1 },
        tangentOut: { time: 1, value: 1 },
      }),
    )
    expect(res.ok).toBe(true)
    expect(anim.controlKeyframes('Host')[0].blend).toEqual([0.7])

    // disabled preserves
    res = system.dispatcher.dispatch(
      new SetKeyframeDisabledCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'Host' },
        keyframeId: kfId,
        disabled: true,
      }),
    )
    expect(res.ok).toBe(true)
    expect(anim.controlKeyframes('Host')[0].blend).toEqual([0.7])
    res = system.dispatcher.dispatch(
      new SetKeyframeDisabledCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'Host' },
        keyframeId: kfId,
        disabled: false,
      }),
    )
    expect(res.ok).toBe(true)

    // move preserves
    res = system.dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'Host' },
        time: 5,
        value: 0.2,
      }),
    )
    expect(res.ok).toBe(true)
    const secondId = anim.controlKeyframes('Host').find((k) => k.time === 5)!.id
    res = system.dispatcher.dispatch(
      new MoveKeyframesCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'Host' },
        moves: [{ keyframeId: secondId, newTime: 6 }],
      }),
    )
    expect(res.ok).toBe(true)
    expect(anim.controlKeyframes('Host').some((k) => k.time === 6)).toBe(true)

    // scale preserves (first kf blend still 0.7)
    res = system.dispatcher.dispatch(
      new ScaleKeyframesCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'Host' },
        keyframeIds: [kfId],
        pivot: 0,
        factor: 2,
      }),
    )
    expect(res.ok).toBe(true)
    expect(anim.controlKeyframes('Host').find((k) => k.id === kfId)!.blend).toEqual([0.7])

    // duplicate preserves blend
    res = system.dispatcher.dispatch(
      new DuplicateKeyframesCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'Host' },
        keyframeIds: [kfId],
      }),
    )
    expect(res.ok).toBe(true)
    const dups = anim.controlKeyframes('Host').filter((k) => k.id !== kfId && k.id !== secondId)
    // At least one duplicate should carry blend 0.7 (duplicate copies blend)
    expect(dups.some((k) => (k.blend[0] ?? -1) === 0.7)).toBe(true)

    // paste preserves blend when payload has blend
    res = system.dispatcher.dispatch(
      new PasteKeyframesCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'Host' },
        payload: {
          keyframes: [
            {
              time: 0,
              value: 0.9,
              interpolation: 'linear' as const,
              tangentIn: { time: 0, value: 0 },
              tangentOut: { time: 0, value: 0 },
              blend: [0.25],
            },
          ],
        },
        atTime: 8,
      }),
    )
    expect(res.ok).toBe(true)
    expect(
      anim.controlKeyframes('Host').some((k) => k.time === 8 && (k.blend[0] ?? -1) === 0.25),
    ).toBe(true)

    // delete host kf
    res = system.dispatcher.dispatch(
      new DeleteKeyframesCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'Host' },
        keyframeIds: [kfId],
      }),
    )
    expect(res.ok).toBe(true)
  })

  it('Timeline shows host controlSubtrack only (no blend lanes)', async () => {
    const { timelineRows } = await import('../../components/panels/timelineTracks')
    const { createCommandSystem: CCS2 } = await import('../../engine/commands')
    const {
      createControl: CC,
      createControlSet: CCS,
      addGroupToControlSet: AG,
    } = await import('../../engine/control')
    const system = CCS2()
    ok(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P3' })))
    ok(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project!.slides[0]
    const host = ok(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'Rig',
        }),
      ),
    ).nodeId as string
    let cs = CCS(host, [CC({ key: 'Host', bindings: {}, exposed: true })])
    cs = AG(cs, 'Host', 'Second')
    expect(cs.controls.length).toBe(1)
    expect(cs.controls[0].groups.length).toBe(2)
    system.engine.getNode(host).controlSet = cs
    const rows = timelineRows(slide.scene, { [host]: true }, [], {}, (id) => {
      try {
        return system.engine.getClip(id)
      } catch {
        return null
      }
    })
    const controlRows = rows.filter((r) => r.kind === 'controlSubtrack')
    expect(controlRows.map((r) => (r as any).controlKey)).toEqual(['Host'])
  })
})
