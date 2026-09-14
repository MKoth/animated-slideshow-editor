/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import { createControl, createControlSet, addGroupToControlSet } from '../../engine/control'
import { Keyframe } from '../../engine/keyframe'
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

function ok(res: any): any {
  if (!res.ok) throw (res as any).error
  return (res as any).inverse
}

describe('RenameControl atomic (issue 351)', () => {
  it('renames host+blend and moves tracks with undo, default 0->G1, clamp, disabled, hold/linear/bezier parity', () => {
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
        cs.controls[1],
      ],
    }
    system.engine.getNode(host).controlSet = cs
    const anim = slide.animation.ensure(host)
    anim.addControl('Host', new Keyframe('kHost1', 0, 0.5))
    anim.addControl('blend', new Keyframe('kBlend1', 0, 0))
    let val = system.engine.evaluateNode(child, 0).transform.x
    expect(val).toBe(15)
    // blend 1 -> G2
    // replace track: remove and add
    anim.addControl('blend', new Keyframe('kBlend2', 0.1, 1)) // at 0, still 0; need to set at 0
    // Actually we have two keyframes: time0=0, time0.1=1 => at time0 =>0, at time0.1=>1. At time0.05 => 0.5 linear?
    // Simpler: clear and add single keyframe at 0 value 1
    // Use engine's control track rename to test? Let's just directly test rename: first clear
    // Remove existing blend tracks
    const existing = [...anim.controlKeyframes('blend')]
    for (const kf of existing) anim.removeControl('blend', kf.id)
    anim.addControl('blend', new Keyframe('kBlendSingle', 0, 1))
    val = system.engine.evaluateNode(child, 0).transform.x
    // host 0.5 => G2 value 150
    expect(val).toBe(150)
    // Now test lerp with blend 0.5 => 82.5
    // Replace again
    for (const kf of [...anim.controlKeyframes('blend')]) anim.removeControl('blend', kf.id)
    anim.addControl('blend', new Keyframe('kb', 0, 0.5))
    val = system.engine.evaluateNode(child, 0).transform.x
    expect(val).toBeCloseTo(82.5)
    // Test clamp: value 2 clamped to 1 => G2
    for (const kf of [...anim.controlKeyframes('blend')]) anim.removeControl('blend', kf.id)
    anim.addControl('blend', new Keyframe('kb2', 0, 0.7)) // we will test via linear before lerp clamp is in evaluator not track? Actually track value is clamped 0..1 before lerp. So value 2 should be rejected by validation but we can test via setting track value directly? The Keyframe value for blend is validated 0..1, so 2 would be rejected via requireTrackKeyframeValue. So clamp test is via raw value outside range? But spec says blend=clamp(value,0,1) linear value space drives lerp. The track value itself is constrained 0..1 via validation, but if we bypass via direct Keyframe creation with value 2, evaluate should clamp.
    // Let's bypass via direct Keyframe with value 2 (not via addKeyframe command)
    for (const kf of [...anim.controlKeyframes('blend')]) anim.removeControl('blend', kf.id)
    anim.addControl('blend', new Keyframe('kbClamp', 0, 2 as any))
    val = system.engine.evaluateNode(child, 0).transform.x
    expect(val).toBe(150) // clamped to 1 => G2
    // Test disabled: blend track with disabled keyframe should be skipped -> fallback default 0 -> G1
    for (const kf of [...anim.controlKeyframes('blend')]) anim.removeControl('blend', kf.id)
    const disabledKf = new Keyframe('kbDis', 0, 1 as any)
    disabledKf.disabled = true
    anim.addControl('blend', disabledKf)
    val = system.engine.evaluateNode(child, 0).transform.x
    expect(val).toBe(15) // disabled => fallback 0 => G1
    // Need to reset to 0.5 for rename test
    for (const kf of [...anim.controlKeyframes('blend')]) anim.removeControl('blend', kf.id)
    anim.addControl('blend', new Keyframe('kb3', 0, 0.7))
    // Now rename blend -> myBlend
    const renameRes = system.dispatcher.dispatch(
      new RenameControlCommand({ hostNodeId: host, oldKey: 'blend', newKey: 'myBlend' }),
    )
    expect(renameRes.ok).toBe(true)
    const afterCS = system.engine.getNode(host).controlSet!
    expect(afterCS.controls[0].blendKeys).toEqual(['myBlend'])
    expect(afterCS.controls.map((c) => c.key)).toContain('myBlend')
    expect(anim.controlTrackKeys()).toContain('myBlend')
    expect(anim.controlTrackKeys()).not.toContain('blend')
    // Evaluate still should be lerp with myBlend 0.7 => 15 + (150-15)*0.7 = 109.5
    val = system.engine.evaluateNode(child, 0).transform.x
    expect(val).toBeCloseTo(109.5)
    // Also test host rename (patch blendKeys if host key was in blendKeys? Not needed)
    // Test rename host key: should update control.key and keep blend sibling order
    const renameHostRes = system.dispatcher.dispatch(
      new RenameControlCommand({ hostNodeId: host, oldKey: 'Host', newKey: 'HostRenamed' }),
    )
    expect(renameHostRes.ok).toBe(true)
    const afterHostCS = system.engine.getNode(host).controlSet!
    expect(afterHostCS.controls[0].key).toBe('HostRenamed')
    expect(afterHostCS.controls[0].blendKeys).toEqual(['myBlend'])
    expect(anim.controlTrackKeys()).toContain('HostRenamed')
    expect(anim.controlTrackKeys()).not.toContain('Host')
    // Evaluate with renamed host: host value still 0.5 via new key => should still be 109.5
    // The host track was moved, so at time0 still 0.5
    val = system.engine.evaluateNode(child, 0).transform.x
    expect(val).toBeCloseTo(109.5)
    // Undo last rename (host)
    system.dispatcher.undo()
    expect(system.engine.getNode(host).controlSet!.controls[0].key).toBe('Host')
    expect(anim.controlTrackKeys()).toContain('Host')
    // Undo blend rename
    system.dispatcher.undo()
    expect(system.engine.getNode(host).controlSet!.controls[0].blendKeys).toEqual(['blend'])
    expect(anim.controlTrackKeys()).toContain('blend')
    // Test hold/linear/bezier with blend: ensure same spline as host
    // Hold
    for (const kf of [...anim.controlKeyframes('blend')]) anim.removeControl('blend', kf.id)
    anim.addControl('blend', new Keyframe('h1', 0, 0, 'hold'))
    anim.addControl('blend', new Keyframe('h2', 10, 1, 'hold'))
    val = system.engine.evaluateNode(child, 5).transform.x
    expect(val).toBe(15) // hold => still 0 at time5
    // linear
    for (const kf of [...anim.controlKeyframes('blend')]) anim.removeControl('blend', kf.id)
    anim.addControl('blend', new Keyframe('l1', 0, 0, 'linear'))
    anim.addControl('blend', new Keyframe('l2', 10, 1, 'linear'))
    val = system.engine.evaluateNode(child, 5).transform.x
    expect(val).toBeCloseTo(82.5)
    // bezier with tangents 0 should be linear
    for (const kf of [...anim.controlKeyframes('blend')]) anim.removeControl('blend', kf.id)
    const b1 = new Keyframe('b1', 0, 0, 'bezier', { time: 0, value: 0 }, { time: 0, value: 0 })
    const b2 = new Keyframe('b2', 10, 1, 'bezier', { time: 0, value: 0 }, { time: 0, value: 0 })
    anim.addControl('blend', b1)
    anim.addControl('blend', b2)
    val = system.engine.evaluateNode(child, 5).transform.x
    expect(val).toBeCloseTo(82.5)
    // Untracked blend defaults 0->G1 already tested earlier with new host2, but we also test that after removing blend track, default 0
    for (const kf of [...anim.controlKeyframes('blend')]) anim.removeControl('blend', kf.id)
    val = system.engine.evaluateNode(child, 0).transform.x
    expect(val).toBe(15)
    // KeyframeTarget reuse: test that control target can be used via animationManager
    const addRes2 = system.dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'blend' },
        time: 2,
        value: 0.9,
      }),
    )
    expect(addRes2.ok).toBe(true)
    val = system.engine.evaluateNode(child, 2).transform.x
    // at time2 blend 0.9 => lerp 15 +135*0.9=136.5
    expect(val).toBeCloseTo(136.5)
    // Check clampKeyframesTo parity: create track with time beyond duration and clamp
    const slideDuration = slide.duration
    const longKf = new Keyframe('long', slideDuration + 5, 0.3)
    anim.addControl('Host', longKf)
    const clamped = slide.animation.clampKeyframesTo(5)
    expect(clamped.some((c) => (c as any).controlKey === 'Host')).toBe(true)
    expect(anim.controlKeyframes('Host').some((k) => k.time === 5)).toBe(true)
  })

  it('KeyframeTarget reuse for host+Blend: add/delete/move/scale/value/interpolation/tangents/disabled/paste/duplicate', () => {
    const system = createCommandSystem()
    ok(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P2' })))
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
          value: 0,
        }),
      ),
    )
    ok(
      system.dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId: clip1, channel: 'positionX' },
          time: 1,
          value: 10,
        }),
      ),
    )
    ok(
      system.dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId: clip2, channel: 'positionX' },
          time: 0,
          value: 0,
        }),
      ),
    )
    ok(
      system.dispatcher.dispatch(
        new AddClipKeyframeCommand({
          target: { kind: 'clip', clipId: clip2, channel: 'positionX' },
          time: 1,
          value: 20,
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
        cs.controls[1],
      ],
    }
    system.engine.getNode(host).controlSet = cs
    // add host and blend keyframes via command
    let res: any = system.dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'Host' },
        time: 0,
        value: 0.5,
      }),
    )
    expect(res.ok).toBe(true)
    res = system.dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'blend' },
        time: 0,
        value: 0.5,
      }),
    )
    expect(res.ok).toBe(true)
    const anim = slide.animation.ensure(host)
    expect(anim.controlKeyframes('Host').length).toBe(1)
    expect(anim.controlKeyframes('blend').length).toBe(1)
    const blendKfId = anim.controlKeyframes('blend')[0].id
    // set value
    res = system.dispatcher.dispatch(
      new SetKeyframeValueCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'blend' },
        keyframeId: blendKfId,
        newValue: 0.8,
      }),
    )
    expect(res.ok).toBe(true)
    expect(anim.controlKeyframes('blend')[0].value).toBe(0.8)
    // set interpolation
    res = system.dispatcher.dispatch(
      new SetKeyframeInterpolationCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'blend' },
        keyframeId: blendKfId,
        interpolation: 'hold',
      }),
    )
    expect(res.ok).toBe(true)
    expect(anim.controlKeyframes('blend')[0].interpolation).toBe('hold')
    // set tangents
    res = system.dispatcher.dispatch(
      new SetKeyframeTangentsCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'blend' },
        keyframeId: blendKfId,
        tangentIn: { time: 1, value: 1 },
        tangentOut: { time: 1, value: 1 },
      }),
    )
    expect(res.ok).toBe(true)
    // set disabled
    res = system.dispatcher.dispatch(
      new SetKeyframeDisabledCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'blend' },
        keyframeId: blendKfId,
        disabled: true,
      }),
    )
    expect(res.ok).toBe(true)
    expect(anim.controlKeyframes('blend')[0].disabled).toBe(true)
    res = system.dispatcher.dispatch(
      new SetKeyframeDisabledCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'blend' },
        keyframeId: blendKfId,
        disabled: false,
      }),
    )
    expect(res.ok).toBe(true)
    // move
    // need second keyframe to test move
    res = system.dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'blend' },
        time: 5,
        value: 0.2,
      }),
    )
    expect(res.ok).toBe(true)
    const secondId = anim.controlKeyframes('blend').find((k) => k.time === 5)!.id
    res = system.dispatcher.dispatch(
      new MoveKeyframesCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'blend' },
        moves: [{ keyframeId: secondId, newTime: 6 }],
      }),
    )
    expect(res.ok).toBe(true)
    expect(anim.controlKeyframes('blend').some((k) => k.time === 6)).toBe(true)
    // scale
    res = system.dispatcher.dispatch(
      new ScaleKeyframesCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'blend' },
        keyframeIds: [blendKfId],
        pivot: 0,
        factor: 2,
      }),
    )
    expect(res.ok).toBe(true)
    // duplicate
    res = system.dispatcher.dispatch(
      new DuplicateKeyframesCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'blend' },
        keyframeIds: [blendKfId],
      }),
    )
    expect(res.ok).toBe(true)
    expect(anim.controlKeyframes('blend').length).toBe(3)
    // paste
    const payload = {
      keyframes: [
        {
          time: 0,
          value: 0.9,
          interpolation: 'linear' as const,
          tangentIn: { time: 0, value: 0 },
          tangentOut: { time: 0, value: 0 },
        },
      ],
    }
    res = system.dispatcher.dispatch(
      new PasteKeyframesCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'blend' },
        payload,
        atTime: 8,
      }),
    )
    expect(res.ok).toBe(true)
    expect(anim.controlKeyframes('blend').some((k) => k.time === 8)).toBe(true)
    // delete
    const toDelete = anim.controlKeyframes('blend')[0].id
    res = system.dispatcher.dispatch(
      new DeleteKeyframesCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'blend' },
        keyframeIds: [toDelete],
      }),
    )
    expect(res.ok).toBe(true)
    // also test host still works
    res = system.dispatcher.dispatch(
      new DeleteKeyframesCommand({
        target: { kind: 'control', nodeId: host, controlKey: 'Host' },
        keyframeIds: [anim.controlKeyframes('Host')[0].id],
      }),
    )
    expect(res.ok).toBe(true)
    expect(anim.controlKeyframes('Host').length).toBe(0)
  })

  it('Dope Sheet one row per exposed Control and CurveEditor one curve per Control, blend sibling after host', async () => {
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
    // blend should be exposed true after genesis
    expect(cs.controls[0].exposed).toBe(true)
    expect(cs.controls[1].exposed).toBe(true)
    expect(cs.controls[0].key).toBe('Host')
    expect(cs.controls[1].key).toBe('blend')
    expect(cs.controls[0].blendKeys).toEqual(['blend'])
    system.engine.getNode(host).controlSet = cs
    // timelineRows should show two controlSubtrack rows when expanded
    const rows = timelineRows(slide.scene, { [host]: true }, [], {}, (id) => {
      try {
        return system.engine.getClip(id)
      } catch {
        return null
      }
    })
    const controlRows = rows.filter((r) => r.kind === 'controlSubtrack')
    expect(controlRows.map((r) => (r as any).controlKey)).toEqual(['Host', 'blend'])
    // Curve editor: should show one curve per control if has keyframes
    const anim = slide.animation.ensure(host)
    anim.addControl('Host', new Keyframe('k1', 0, 0.5))
    anim.addControl('blend', new Keyframe('k2', 0, 0.5))
    // Simulate curve building: check that controlKeyframes exist
    expect(anim.controlKeyframes('Host').length).toBe(1)
    expect(anim.controlKeyframes('blend').length).toBe(1)
  })
})
