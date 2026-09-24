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
import {
  createControl,
  createControlSet,
  addCollectionBlockToGroup,
  addGroupToControlSet,
  removeCollectionBlockFromGroup,
  updateCollectionBlockInterval,
  reorderCollectionBlockWithinGroup,
  moveCollectionBlockBetweenGroups,
  groupCollectionBlocks,
  controlSetToJSON,
  controlSetFromJSON,
  normalizeControlSetForMutation,
  validateControls,
} from '../../engine/control'
import { packControlIntervalBlocks } from '../../engine/animationManagerModel'
import { ClipCollection } from '../../engine/clipCollection'
import { Keyframe } from '../../engine/keyframe'

function ok<T>(result: { ok: true; inverse: T } | { ok: false; error: Error }): T {
  if (!result.ok) throw result.error
  return result.inverse
}

type CommandSystem = ReturnType<typeof createCommandSystem>

function normalizedClip(system: CommandSystem, name: string, from: number, to: number): string {
  const clip = ok(
    system.dispatcher.dispatch(
      new CreateClipCommand({
        name,
        duration: 1,
        category: 'control',
        params: [],
        channels: [{ property: 'positionX' }],
      }),
    ),
  )
  const clipId = (clip as unknown as { clipId: string }).clipId
  ok(
    system.dispatcher.dispatch(
      new AddClipKeyframeCommand({
        target: { kind: 'clip', clipId, channel: 'positionX' },
        time: 0,
        value: from,
      }),
    ),
  )
  ok(
    system.dispatcher.dispatch(
      new AddClipKeyframeCommand({
        target: { kind: 'clip', clipId, channel: 'positionX' },
        time: 1,
        value: to,
      }),
    ),
  )
  return clipId
}

function setupRig() {
  const system = createCommandSystem()
  ok(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'CollectionControls' })))
  ok(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide' })))
  const slide = system.engine.project!.slides[0]!
  const host = ok(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Rig',
      }),
    ),
  )
  const mouth = ok(
    system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId: slide.scene.id, parentId: host.nodeId, name: 'Mouth' }),
    ),
  )
  const smile = ok(
    system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId: slide.scene.id, parentId: host.nodeId, name: 'Smile' }),
    ),
  )
  slide.scene.getNode(mouth.nodeId)!.semanticName = 'mouth'
  slide.scene.getNode(smile.nodeId)!.semanticName = 'smile'
  const clipA = normalizedClip(system, 'Clip A', 10, 30)
  const clipB = normalizedClip(system, 'Clip B', 100, 200)
  const collection = system.engine.createClipCollection('Rig', { mouth: clipA, smile: clipB })
  return {
    system,
    slide,
    hostId: host.nodeId,
    mouthId: mouth.nodeId,
    smileId: smile.nodeId,
    clipA,
    clipB,
    collectionId: collection.id,
  }
}

function attachCollection(
  ctx: ReturnType<typeof setupRig>,
  collectionId: string,
  start = 0,
  end = 1,
  key = 'Face',
) {
  const host = ctx.slide.scene.getNode(ctx.hostId)!
  const base = createControlSet(ctx.hostId, [createControl({ key, exposed: true })])
  host.controlSet = addCollectionBlockToGroup(base, key, base.controls[0]!.groups[0]!.id, {
    collectionId,
    start,
    end,
  })
  const track = ctx.slide.animation.ensure(ctx.hostId)
  track.addControl(key, new Keyframe('k0', 0, 0))
  ok(
    ctx.system.dispatcher.dispatch(
      new AddKeyframeCommand({
        target: { kind: 'control', nodeId: ctx.hostId, controlKey: key },
        time: ctx.slide.duration,
        value: 1,
      }),
    ),
  )
  return host.controlSet.controls[0]!
}

describe('Control collection blocks — live-linked ClipCollection references', () => {
  it('drives every bound descendant through one grouped block', () => {
    const ctx = setupRig()
    attachCollection(ctx, ctx.collectionId)
    const mid = ctx.slide.duration / 2
    expect(ctx.system.engine.evaluateNode(ctx.mouthId, mid).transform.x).toBe(20)
    expect(ctx.system.engine.evaluateNode(ctx.smileId, mid).transform.x).toBe(150)
  })

  it('remaps the control value into the block interval (uPrime)', () => {
    const ctx = setupRig()
    attachCollection(ctx, ctx.collectionId, 0.25, 0.75)
    const at = (value: number) => {
      // control track is linear 0→1 over slide duration; sample by time fraction
      const t = value * ctx.slide.duration
      return ctx.system.engine.evaluateNode(ctx.mouthId, t).transform.x
    }
    expect(at(0.25)).toBeCloseTo(10, 6)
    expect(at(0.5)).toBeCloseTo(20, 6)
    // Intervals are half-open [start,end): the end edge itself is a gap.
    expect(at(0.749)).toBeCloseTo(29.96, 2)
    expect(at(0.75)).toBe(0)
    // Outside the block interval the binding is a gap: base transform passes through
    expect(at(0)).toBe(0)
  })

  it('stays live-linked: collection rebinding propagates without touching the control', () => {
    const ctx = setupRig()
    attachCollection(ctx, ctx.collectionId)
    const clipC = normalizedClip(ctx.system, 'Clip C', 1000, 2000)
    ctx.system.engine.setClipCollectionBindings(ctx.collectionId, {
      mouth: clipC,
      smile: ctx.clipB,
    })
    const mid = ctx.slide.duration / 2
    expect(ctx.system.engine.evaluateNode(ctx.mouthId, mid).transform.x).toBe(1500)
    // Control definition untouched — still a single collection block
    const control = ctx.slide.scene.getNode(ctx.hostId)!.controlSet!.controls[0]!
    expect(groupCollectionBlocks(control.groups[0]).length).toBe(1)
    expect(Object.keys(control.groups[0]!.bindings).length).toBe(0)
  })

  it('collection blocks win ties over clip blocks within the same timeline', () => {
    const ctx = setupRig()
    const host = ctx.slide.scene.getNode(ctx.hostId)!
    let set = createControlSet(ctx.hostId, [
      createControl({
        key: 'Face',
        exposed: true,
        bindings: { mouth: { clipId: ctx.clipB, start: 0, end: 1 } },
      }),
    ])
    set = addCollectionBlockToGroup(set, 'Face', set.controls[0]!.groups[0]!.id, {
      collectionId: ctx.collectionId,
    })
    host.controlSet = set
    const track = ctx.slide.animation.ensure(ctx.hostId)
    track.addControl('Face', new Keyframe('k0', 0, 0))
    ok(
      ctx.system.dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'control', nodeId: ctx.hostId, controlKey: 'Face' },
          time: ctx.slide.duration,
          value: 1,
        }),
      ),
    )
    // clipB alone would give 150 at mid; collection (clipA) wins → 20
    expect(ctx.system.engine.evaluateNode(ctx.mouthId, ctx.slide.duration / 2).transform.x).toBe(20)
  })

  it('reorders collection blocks within a timeline (later wins)', () => {
    const ctx = setupRig()
    const other = ctx.system.engine.createClipCollection('Other', { mouth: ctx.clipB })
    const host = ctx.slide.scene.getNode(ctx.hostId)!
    let set = createControlSet(ctx.hostId, [createControl({ key: 'Face', exposed: true })])
    const groupId = set.controls[0]!.groups[0]!.id
    set = addCollectionBlockToGroup(set, 'Face', groupId, { collectionId: ctx.collectionId })
    set = addCollectionBlockToGroup(set, 'Face', groupId, { collectionId: other.id })
    host.controlSet = set
    const track = ctx.slide.animation.ensure(ctx.hostId)
    track.addControl('Face', new Keyframe('k0', 0, 0))
    ok(
      ctx.system.dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'control', nodeId: ctx.hostId, controlKey: 'Face' },
          time: ctx.slide.duration,
          value: 1,
        }),
      ),
    )
    const mid = ctx.slide.duration / 2
    // Second block wins → clipB → 150
    expect(ctx.system.engine.evaluateNode(ctx.mouthId, mid).transform.x).toBe(150)
    set = reorderCollectionBlockWithinGroup(set, 'Face', groupId, 1, 0)
    host.controlSet = set
    // First collection now wins → clipA → 20
    expect(ctx.system.engine.evaluateNode(ctx.mouthId, mid).transform.x).toBe(20)
  })

  it('blends between timelines holding different collections', () => {
    const ctx = setupRig()
    const other = ctx.system.engine.createClipCollection('Other', {
      mouth: ctx.clipB,
      smile: ctx.clipB,
    })
    const host = ctx.slide.scene.getNode(ctx.hostId)!
    let set = createControlSet(ctx.hostId, [createControl({ key: 'Face', exposed: true })])
    set = addGroupToControlSet(set, 'Face', 'Second')
    const [g0, g1] = set.controls[0]!.groups
    set = addCollectionBlockToGroup(set, 'Face', g0!.id, { collectionId: ctx.collectionId })
    set = addCollectionBlockToGroup(set, 'Face', g1!.id, { collectionId: other.id })
    host.controlSet = set
    const track = ctx.slide.animation.ensure(ctx.hostId)
    const first = new Keyframe('k0', 0, 0)
    ;(first as unknown as { blend: readonly number[] }).blend = [0.5]
    track.addControl('Face', first)
    ok(
      ctx.system.dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'control', nodeId: ctx.hostId, controlKey: 'Face' },
          time: ctx.slide.duration,
          value: 1,
        }),
      ),
    )
    // blend 0.5 between clipA (20 at mid) and clipB (150 at mid) → 85
    // Note: control value also sweeps 0→1; sample at duration start where u=0:
    // group clips at u=0 → clipA=10, clipB=100 → blended 55
    expect(ctx.system.engine.evaluateNode(ctx.mouthId, 0).transform.x).toBeCloseTo(55, 6)
  })

  it('treats a missing collection as a gap (base passthrough, no throw)', () => {
    const ctx = setupRig()
    attachCollection(ctx, 'ghost-collection')
    expect(ctx.system.engine.evaluateNode(ctx.mouthId, ctx.slide.duration / 2).transform.x).toBe(0)
  })

  it('treats a missing member clip as a gap for that semantic only', () => {
    const ctx = setupRig()
    attachCollection(ctx, ctx.collectionId)
    // Dangle one member binding (bypasses engine validation, like a clip
    // deleted out from under the collection): mouth degrades to a gap while
    // smile keeps driving.
    ctx.system.engine.getClipCollection(ctx.collectionId).setBinding('mouth', 'ghost-clip')
    const mid = ctx.slide.duration / 2
    expect(ctx.system.engine.evaluateNode(ctx.mouthId, mid).transform.x).toBe(0)
    expect(ctx.system.engine.evaluateNode(ctx.smileId, mid).transform.x).toBe(150)
  })

  it('steps zIndex from the same member clip instead of rejecting it (coefficient as time point)', () => {
    const ctx = setupRig()
    const clipId = normalizedClip(ctx.system, 'Zed mover', 10, 30)
    const clip = ctx.system.engine.getClip(clipId)
    clip.addZIndexKeyframe(new Keyframe('z0', 0, 5, 'hold'))
    clip.addZIndexKeyframe(new Keyframe('z1', 0.5, 9, 'hold'))
    const stepped = ctx.system.engine.createClipCollection('Steppers', { mouth: clipId })
    attachCollection(ctx, stepped.id)
    const at = (fraction: number) => {
      const t = fraction * ctx.slide.duration
      return {
        x: ctx.system.engine.evaluateNode(ctx.mouthId, t).transform.x,
        z: ctx.system.engine.evaluateZIndex(ctx.mouthId, t),
      }
    }
    // Transform interpolates while zIndex holds, then steps past the middle
    expect(at(0.25)).toMatchObject({ x: 15, z: 5 })
    expect(at(0.5)).toMatchObject({ x: 20, z: 9 })
    expect(at(0.75)).toMatchObject({ x: 25, z: 9 })
  })

  it('ignores visible lanes but still drives the other channels', () => {
    const ctx = setupRig()
    const clipId = normalizedClip(ctx.system, 'Blinker', 10, 30)
    const clip = ctx.system.engine.getClip(clipId)
    clip.addVisibleKeyframe(new Keyframe('v0', 0, false, 'hold'))
    clip.addVisibleKeyframe(new Keyframe('v1', 0.5, true, 'hold'))
    const collection = ctx.system.engine.createClipCollection('Blinkers', { mouth: clipId })
    attachCollection(ctx, collection.id)
    const mid = ctx.slide.duration / 2
    // Transform drives; visibility stays static by global design
    expect(ctx.system.engine.evaluateNode(ctx.mouthId, mid).transform.x).toBe(20)
    expect(ctx.system.engine.evaluateNode(ctx.mouthId, mid).visible).toBe(true)
  })

  it('blends zIndex discretely across timelines (0.5 threshold, no interpolation)', () => {
    const ctx = setupRig()
    const lowId = normalizedClip(ctx.system, 'Low', 0, 0)
    ctx.system.engine.getClip(lowId).addZIndexKeyframe(new Keyframe('z0', 0, 5, 'hold'))
    const highId = normalizedClip(ctx.system, 'High', 0, 0)
    ctx.system.engine.getClip(highId).addZIndexKeyframe(new Keyframe('z0', 0, 9, 'hold'))
    const lowCol = ctx.system.engine.createClipCollection('LowCol', { mouth: lowId })
    const highCol = ctx.system.engine.createClipCollection('HighCol', { mouth: highId })
    const host = ctx.slide.scene.getNode(ctx.hostId)!
    let set = createControlSet(ctx.hostId, [createControl({ key: 'Face', exposed: true })])
    set = addGroupToControlSet(set, 'Face', 'Second')
    const [g0, g1] = set.controls[0]!.groups
    set = addCollectionBlockToGroup(set, 'Face', g0!.id, { collectionId: lowCol.id })
    set = addCollectionBlockToGroup(set, 'Face', g1!.id, { collectionId: highCol.id })
    host.controlSet = set
    const track = ctx.slide.animation.ensure(ctx.hostId)
    const first = new Keyframe('k0', 0, 0)
    ;(first as unknown as { blend: readonly number[] }).blend = [0.4]
    track.addControl('Face', first)
    ok(
      ctx.system.dispatcher.dispatch(
        new AddKeyframeCommand({
          target: { kind: 'control', nodeId: ctx.hostId, controlKey: 'Face' },
          time: ctx.slide.duration,
          value: 1,
        }),
      ),
    )
    // Blend 0.4 < 0.5 keeps the first timeline's step
    expect(ctx.system.engine.evaluateZIndex(ctx.mouthId, 0)).toBe(5)
    ;(first as unknown as { blend: readonly number[] }).blend = [0.6]
    // Blend 0.6 >= 0.5 takes the second timeline's step
    expect(ctx.system.engine.evaluateZIndex(ctx.mouthId, 0)).toBe(9)
  })
})

describe('Control collection blocks — authoring helpers', () => {
  it('validates intervals and ids', () => {
    const set = createControlSet('host', [createControl({ key: 'Face' })])
    const groupId = set.controls[0]!.groups[0]!.id
    expect(() => addCollectionBlockToGroup(set, 'Face', groupId, { collectionId: '' })).toThrow()
    expect(() =>
      addCollectionBlockToGroup(set, 'Face', groupId, { collectionId: 'c', start: 0.5, end: 0.5 }),
    ).toThrow()
    expect(() =>
      addCollectionBlockToGroup(set, 'Face', groupId, { collectionId: 'c', start: -0.1, end: 1 }),
    ).toThrow()
    expect(() => addCollectionBlockToGroup(set, 'Nope', groupId, { collectionId: 'c' })).toThrow()
  })

  it('updates, removes, and moves blocks between timelines', () => {
    let set = createControlSet('host', [createControl({ key: 'Face' })])
    set = addGroupToControlSet(set, 'Face', 'Second')
    const [g0, g1] = set.controls[0]!.groups
    set = addCollectionBlockToGroup(set, 'Face', g0!.id, { collectionId: 'c1' })
    const blockId = groupCollectionBlocks(set.controls[0]!.groups[0])![0]!.id
    set = updateCollectionBlockInterval(set, 'Face', g0!.id, blockId, 0.2, 0.8)
    expect(groupCollectionBlocks(set.controls[0]!.groups[0])![0]).toMatchObject({
      start: 0.2,
      end: 0.8,
    })
    expect(() => updateCollectionBlockInterval(set, 'Face', g0!.id, blockId, 0.9, 0.2)).toThrow()
    set = moveCollectionBlockBetweenGroups(set, 'Face', g0!.id, g1!.id, blockId)
    expect(groupCollectionBlocks(set.controls[0]!.groups[0])).toHaveLength(0)
    expect(groupCollectionBlocks(set.controls[0]!.groups[1])![0]!.id).toBe(blockId)
    set = removeCollectionBlockFromGroup(set, 'Face', g1!.id, blockId)
    expect(groupCollectionBlocks(set.controls[0]!.groups[1])).toHaveLength(0)
    expect(() => removeCollectionBlockFromGroup(set, 'Face', g1!.id, blockId)).toThrow()
  })

  it('rejects duplicate block ids within a group', () => {
    expect(() =>
      createControlSet('host', [
        createControl({
          key: 'Face',
          groups: [
            {
              id: 'g1',
              name: 'Group 1',
              bindings: {},
              collectionBlocks: [
                { id: 'dup', collectionId: 'c1', start: 0, end: 1 },
                { id: 'dup', collectionId: 'c2', start: 0, end: 1 },
              ],
            },
          ],
        }),
      ]),
    ).toThrow()
    // validateControls also catches it on a hand-built set
    const handBuilt = {
      id: 'cs',
      hostNodeId: 'host',
      controls: [
        {
          id: 'c1',
          key: 'Face',
          label: 'Face',
          min: 0 as const,
          max: 1 as const,
          default: 0,
          exposed: false,
          bindings: {},
          groups: [
            {
              id: 'g1',
              name: 'Group 1',
              bindings: {},
              collectionBlocks: [
                { id: 'dup', collectionId: 'c1', start: 0, end: 1 },
                { id: 'dup', collectionId: 'c2', start: 0, end: 1 },
              ],
            },
          ],
        },
      ],
    }
    expect(() => validateControls(handBuilt.controls)).toThrow()
  })
})

describe('Control collection blocks — persistence', () => {
  it('round-trips through JSON and stays backward compatible', () => {
    let set = createControlSet('host', [createControl({ key: 'Face', exposed: true })])
    const groupId = set.controls[0]!.groups[0]!.id
    set = addCollectionBlockToGroup(set, 'Face', groupId, {
      collectionId: 'col-1',
      start: 0.1,
      end: 0.9,
    })
    const json = controlSetToJSON(set)
    expect(json.controls[0]!.groups![0]!.collectionBlocks).toHaveLength(1)
    const restored = controlSetFromJSON(json, 'host')!
    expect(groupCollectionBlocks(restored.controls[0]!.groups[0])).toEqual(
      groupCollectionBlocks(set.controls[0]!.groups[0]),
    )
    // Legacy files without the field load as clip-only groups
    const legacy = controlSetFromJSON(
      {
        id: 'cs',
        hostNodeId: 'host',
        controls: [
          {
            id: 'c1',
            key: 'Face',
            label: 'Face',
            min: 0,
            max: 1,
            default: 0,
            exposed: true,
            bindings: { mouth: { clipId: 'clip1', start: 0, end: 1 } },
          },
        ],
      },
      'host',
    )!
    expect(groupCollectionBlocks(legacy.controls[0]!.groups[0])).toEqual([])
  })

  it('drops invalid blocks tolerantly on load', () => {
    const json = {
      id: 'cs',
      hostNodeId: 'host',
      controls: [
        {
          id: 'c1',
          key: 'Face',
          label: 'Face',
          min: 0,
          max: 1,
          default: 0,
          exposed: true,
          bindings: {},
          groups: [
            {
              id: 'g1',
              name: 'Group 1',
              bindings: {},
              collectionBlocks: [
                { id: 'good', collectionId: 'col-1', start: 0, end: 1 },
                { id: 'bad', collectionId: '', start: 0, end: 1 },
                { id: 'bad-span', collectionId: 'col-2', start: 0.5, end: 0.5 },
                'not-an-object',
              ],
            },
          ],
        },
      ],
    }
    const restored = controlSetFromJSON(json, 'host')!
    expect(groupCollectionBlocks(restored.controls[0]!.groups[0])).toHaveLength(1)
  })

  it('survives setControlSet normalization (the engine write path)', () => {
    const ctx = setupRig()
    attachCollection(ctx, ctx.collectionId)
    const host = ctx.slide.scene.getNode(ctx.hostId)!
    ctx.system.engine.setControlSet(ctx.hostId, host.controlSet)
    expect(
      groupCollectionBlocks(ctx.slide.scene.getNode(ctx.hostId)!.controlSet!.controls[0]!.groups[0])
        .length,
    ).toBe(1)
    // And the normalized round-trip helper keeps blocks too
    const normalized = normalizeControlSetForMutation(host.controlSet!)
    expect(groupCollectionBlocks(normalized.controls[0]!.groups[0]).length).toBe(1)
  })

  it('packs grouped entries after clip entries in one lane', () => {
    let set = createControlSet('host', [
      createControl({
        key: 'Face',
        bindings: { mouth: { clipId: 'clipA', start: 0, end: 1 } },
      }),
    ])
    const groupId = set.controls[0]!.groups[0]!.id
    set = addCollectionBlockToGroup(set, 'Face', groupId, { collectionId: 'col-1' })
    const getClip = () => null
    const withoutCollections = packControlIntervalBlocks(set.controls[0]!, getClip, 600)
    expect(withoutCollections).toHaveLength(1)
    const withCollections = packControlIntervalBlocks(
      set.controls[0]!,
      getClip,
      600,
      undefined,
      () => new ClipCollection('col-1', 'Rig', { mouth: 'clipA' }),
    )
    expect(withCollections).toHaveLength(2)
    const grouped = withCollections[1]!
    expect(grouped.kind).toBe('collection')
    expect(grouped.blockId).toBe(groupCollectionBlocks(set.controls[0]!.groups[0])![0]!.id)
    expect(grouped.groupId).toBe(groupId)
    // Collections sort after clips → lower lane → wins evaluation
    expect(grouped.priority).toBeGreaterThan(withCollections[0]!.priority)
  })
})
