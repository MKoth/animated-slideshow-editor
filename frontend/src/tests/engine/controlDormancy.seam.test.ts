import { describe, expect, it } from 'vitest'
import {
  createCommandSystem,
  CreateClipCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
} from '../../engine/commands'
import { createControl, createControlSet } from '../../engine/control'
import { Keyframe } from '../../engine/keyframe'
import { timelineRows } from '../../components/panels/timelineTracks'
import type { Slide } from '../../engine/slide'

function ok<T>(result: { ok: true; inverse: T } | { ok: false; error: Error }): T {
  if (!result.ok) throw result.error
  return result.inverse
}

type System = ReturnType<typeof createCommandSystem>

/**
 * Host rig (control "Drive" -> normalized clip 0..1 animating positionX 0..100
 * and rotation 10..50) with a descendant target tagged `target`.
 */
function setupRig(system: System, slide: Slide) {
  const host = ok(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Rig',
      }),
    ),
  )
  const target = ok(
    system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId: slide.scene.id, parentId: host.nodeId, name: 'Target' }),
    ),
  )
  const clip = ok(
    system.dispatcher.dispatch(
      new CreateClipCommand({
        name: 'Normalized',
        duration: 1,
        category: 'control',
        params: [],
        channels: [{ property: 'positionX' }, { property: 'rotation' }],
      }),
    ),
  )
  const definition = system.engine.getClip(clip.clipId)
  definition.addChannelKeyframe('positionX', new Keyframe('x0', 0, 0))
  definition.addChannelKeyframe('positionX', new Keyframe('x1', 1, 100))
  definition.addChannelKeyframe('rotation', new Keyframe('r0', 0, 10))
  definition.addChannelKeyframe('rotation', new Keyframe('r1', 1, 50))
  slide.scene.getNode(target.nodeId)!.semanticName = 'target'
  const rig = slide.scene.getNode(host.nodeId)!
  rig.controlSet = createControlSet(rig.id, [
    createControl({ key: 'Drive', bindings: { target: clip.clipId }, exposed: true, default: 0 }),
  ])
  return { hostId: host.nodeId, targetId: target.nodeId, clipId: clip.clipId }
}

function newSystem(): { system: System; slide: Slide } {
  const system = createCommandSystem()
  ok(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Dormancy' })))
  ok(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide' })))
  return { system, slide: system.engine.project!.slides[0]! }
}

describe('dormant controls (ADR 0018)', () => {
  it('yields per channel to raw keyframes while keeping the default pose on untouched channels', () => {
    const { system, slide } = newSystem()
    const { hostId, targetId } = setupRig(system, slide)
    const track = slide.animation.ensure(hostId)
    expect(track.hasEnabledControlKeyframes('Drive')).toBe(false)

    const raw = slide.animation.ensure(targetId)
    raw.add('positionX', new Keyframe('raw0', 0, 7))
    raw.add('positionX', new Keyframe('raw1', slide.duration, 9))

    const mid = slide.duration / 2
    const evaluated = system.engine.evaluateNode(targetId, mid)
    expect(evaluated.transform.x).toBe(8)
    // rotation is not raw-animated: dormant control still applies its default pose (clip u=0)
    expect(evaluated.transform.rotation).toBe(10)
  })

  it('restores control priority on all bound channels once the control has an enabled keyframe', () => {
    const { system, slide } = newSystem()
    const { hostId, targetId } = setupRig(system, slide)
    const raw = slide.animation.ensure(targetId)
    raw.add('positionX', new Keyframe('raw0', 0, 7))
    raw.add('positionX', new Keyframe('raw1', slide.duration, 9))

    const track = slide.animation.ensure(hostId)
    track.addControl('Drive', new Keyframe('active', 0, 1))
    expect(track.hasEnabledControlKeyframes('Drive')).toBe(true)

    const evaluated = system.engine.evaluateNode(targetId, slide.duration / 2)
    expect(evaluated.transform.x).toBe(100)
    expect(evaluated.transform.rotation).toBe(50)
  })

  it('treats an all-disabled control track as dormant', () => {
    const { system, slide } = newSystem()
    const { hostId, targetId } = setupRig(system, slide)
    const raw = slide.animation.ensure(targetId)
    raw.add('positionX', new Keyframe('raw0', 0, 7))
    raw.add('positionX', new Keyframe('raw1', slide.duration, 9))

    const track = slide.animation.ensure(hostId)
    track.addControl('Drive', new Keyframe('off', 0, 1, 'linear', undefined, undefined, true))
    expect(track.hasEnabledControlKeyframes('Drive')).toBe(false)

    const evaluated = system.engine.evaluateNode(targetId, slide.duration / 2)
    expect(evaluated.transform.x).toBe(8)
    expect(evaluated.transform.rotation).toBe(10)
  })

  it('scopes dormancy per slide (keyframes on one slide do not activate another)', () => {
    const system = createCommandSystem()
    ok(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'PerSlide' })))
    ok(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    ok(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S2' })))
    const [slide1, slide2] = system.engine.project!.slides
    const rig1 = setupRig(system, slide1!)
    const rig2 = setupRig(system, slide2!)

    for (const rig of [rig1, rig2]) {
      const raw = slideOf(system, rig.targetId).animation.ensure(rig.targetId)
      raw.add('positionX', new Keyframe('raw0', 0, 7))
      raw.add('positionX', new Keyframe('raw1', 4, 9))
    }
    slide1!.animation.ensure(rig1.hostId).addControl('Drive', new Keyframe('active', 0, 1))

    expect(system.engine.evaluateNode(rig1.targetId, 2).transform.x).toBe(100)
    expect(system.engine.evaluateNode(rig2.targetId, 2).transform.x).toBe(8)
  })

  it('yields to an active clip instance but keeps the default pose when the clip is inactive', () => {
    const { system, slide } = newSystem()
    const { hostId, targetId, clipId } = setupRig(system, slide)
    const rig = slide.scene.getNode(hostId)!
    rig.controlSet = createControlSet(rig.id, [
      createControl({ key: 'Drive', bindings: { target: clipId }, exposed: true, default: 0.5 }),
    ])
    const timeClip = ok(
      system.dispatcher.dispatch(
        new CreateClipCommand({
          name: 'Time X',
          duration: 4,
          category: 'transform',
          params: [],
          channels: [{ property: 'positionX' }],
        }),
      ),
    )
    const timeDefinition = system.engine.getClip(timeClip.clipId)
    timeDefinition.addChannelKeyframe('positionX', new Keyframe('t0', 0, 0))
    timeDefinition.addChannelKeyframe('positionX', new Keyframe('t1', 1, 40))
    slide.scene.getNode(targetId)!.clipInstances.push({
      id: 'inst-1',
      clipId: timeClip.clipId,
      startTime: 0,
      speed: 1,
      enabled: true,
      paramOverrides: {},
    })

    // dormant control default 0.5 -> clip u 0.5 -> positionX 50
    expect(system.engine.evaluateNode(targetId, 8).transform.x).toBe(50)
    // active time clip at u=0.25 -> positionX 10 wins over the dormant control
    expect(system.engine.evaluateNode(targetId, 1).transform.x).toBe(10)
  })

  it('applies the same dormancy rule to non-transform families (table borderRadius)', () => {
    const { system, slide } = newSystem()
    const host = ok(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'TableRig',
        }),
      ),
    )
    const table = ok(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: host.nodeId,
          name: 'Table',
          components: {
            table: {
              kind: 'table',
              columns: [],
              gap: 0,
              borderWidth: 0,
              borderColor: '#000000',
              borderRadius: 0,
              padding: 0,
            },
          },
        }),
      ),
    )
    slide.scene.getNode(table.nodeId)!.semanticName = 'table'
    const clip = ok(
      system.dispatcher.dispatch(
        new CreateClipCommand({
          name: 'Table Control',
          duration: 1,
          category: 'control',
          params: [],
          channels: [],
        }),
      ),
    )
    const definition = system.engine.getClip(clip.clipId)
    definition.addTableKeyframe('borderRadius', new Keyframe('t0', 0, 7))
    definition.addTableKeyframe('borderRadius', new Keyframe('t1', 1, 20))
    const rig = slide.scene.getNode(host.nodeId)!
    rig.controlSet = createControlSet(rig.id, [
      createControl({ key: 'Shape', bindings: { table: clip.clipId }, exposed: true, default: 0 }),
    ])

    // dormant with no raw table animation: default pose from the clip (u=0 -> 7)
    expect(system.engine.evaluateTable(table.nodeId, 5)?.borderRadius).toBe(7)
    // raw table keyframes win while dormant
    slide.animation.ensure(table.nodeId).addTable('borderRadius', new Keyframe('raw', 0, 3))
    expect(system.engine.evaluateTable(table.nodeId, 5)?.borderRadius).toBe(3)
    // active control wins again
    slide.animation.ensure(host.nodeId).addControl('Shape', new Keyframe('active', 0, 1))
    expect(system.engine.evaluateTable(table.nodeId, 5)?.borderRadius).toBe(20)
  })
})

function slideOf(system: System, nodeId: string): Slide {
  for (const slide of system.engine.project!.slides) {
    if (slide.scene.getNode(nodeId)) return slide
  }
  throw new Error(`Node "${nodeId}" not found in any slide`)
}

function timelineRowsFor(
  system: System,
  slide: Slide,
  hostId: string,
  targetId: string,
  controlDrives: (hostNodeId: string, controlKey: string) => boolean,
) {
  return timelineRows(
    slide.scene,
    { [hostId]: true, [targetId]: true },
    [],
    {},
    (clipId) => {
      try {
        return system.engine.getClip(clipId)
      } catch {
        return null
      }
    },
    controlDrives,
  )
}

describe('timeline lanes for dormant controls (ADR 0018)', () => {
  it('keeps raw lanes editable while the control is dormant and hides them once active', () => {
    const { system, slide } = newSystem()
    const { hostId, targetId } = setupRig(system, slide)

    const dormantRows = timelineRowsFor(system, slide, hostId, targetId, () => false)
    const dormantTargetRows = dormantRows.filter((row) => row.node.id === targetId)
    expect(
      dormantTargetRows.some((row) => row.kind === 'subtrack' && row.property === 'positionX'),
    ).toBe(true)
    expect(dormantTargetRows.some((row) => row.kind === 'hiddenSubtrack')).toBe(false)
    const dormantBadge = dormantRows.find((row) => row.kind === 'node' && row.node.id === targetId)
    expect(dormantBadge?.kind === 'node' ? dormantBadge.hiddenCount : undefined).toBe(0)

    const activeRows = timelineRowsFor(system, slide, hostId, targetId, () => true)
    const hidden = activeRows.filter(
      (row) => row.node.id === targetId && row.kind === 'hiddenSubtrack',
    )
    expect(hidden.map((row) => (row as { property: string }).property).sort()).toEqual([
      'positionX',
      'rotation',
    ])
    const activeBadge = activeRows.find((row) => row.kind === 'node' && row.node.id === targetId)
    expect(activeBadge?.kind === 'node' ? activeBadge.hiddenCount : undefined).toBe(2)
  })

  it('uses the real control track: disabled-only keyframes leave lanes editable', () => {
    const { system, slide } = newSystem()
    const { hostId, targetId } = setupRig(system, slide)
    const track = slide.animation.ensure(hostId)
    const keyframe = new Keyframe('off', 0, 1, 'linear', undefined, undefined, true)
    track.addControl('Drive', keyframe)

    const drives = (nodeId: string, controlKey: string) =>
      slide.animation.node(nodeId)?.hasEnabledControlKeyframes(controlKey) ?? false
    expect(drives(hostId, 'Drive')).toBe(false)

    const rows = timelineRowsFor(system, slide, hostId, targetId, drives)
    const targetRows = rows.filter((row) => row.node.id === targetId)
    expect(targetRows.some((row) => row.kind === 'subtrack' && row.property === 'positionX')).toBe(
      true,
    )
    expect(targetRows.some((row) => row.kind === 'hiddenSubtrack')).toBe(false)

    keyframe.disabled = false
    expect(drives(hostId, 'Drive')).toBe(true)
  })
})
