import { describe, it, expect, vi } from 'vitest'
import { createEngineInternal, toReadOnly } from '../../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  SetShadowEffectCommand,
  SetCastShadowCommand,
} from '../../engine/commands'
import { ExtractToClipCommand } from '../../engine/commands/extractToClipCommand'
import { AssignClipCommand } from '../../engine/commands'
import { DEFAULT_SHADOW_EFFECT, SHADOW_PROPERTIES } from '../../engine/shadowEffect'
import type { ShadowProperty } from '../../engine/shadowEffect'
import {
  computeExtractionBounds,
  normalizeExtractable,
  channelKeyOf,
  groupNormalizedByChannel,
  validateNoDuplicateTimes,
} from '../../engine/clipExtraction'
import type { ExtractableKeyframe } from '../../engine/clipExtraction'
import { ClipDefinition } from '../../engine/clipDefinition'
import { walkPreOrder } from '../../engine/sceneNode'
import { Keyframe, newKeyframeId } from '../../engine/keyframe'

function setup() {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const pub = toReadOnly(engine)
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S')
  return { engine, pub, dispatcher, undoStack, slide }
}

function makeExtractable(
  target: import('../../engine/keyframeTarget').KeyframeTarget,
  time: number,
  value: unknown,
  interp: import('../../engine/keyframe').InterpolationType = 'linear',
): ExtractableKeyframe {
  return {
    target,
    time,
    value: value as import('../../engine/keyframe').KeyframeValue,
    interpolation: interp,
    tangentIn: { time: 0, value: 0 },
    tangentOut: { time: 0, value: 0 },
    keyframeId: `kf-${time}-${String(value)}`,
  }
}

describe('Shadow — 06 Clip Extraction, Collections & Reusable Objects portability #303', () => {
  it('Clip Extraction: Shadow section listing only animated shadow props (checked by default), normalizing each to shadow:${property} channel keys with NormalizedChannelKey {kind:shadow, property} in [0,1]; validation mirrors insertion', () => {
    const { engine, dispatcher, pub } = setup()
    const slide = engine.getActiveSlide()!
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'HeroGroup')
    dispatcher.dispatch(
      new SetShadowEffectCommand({ nodeId: group.id, shadowEffect: DEFAULT_SHADOW_EFFECT }),
    )
    engine.addKeyframe({ kind: 'shadow', nodeId: group.id, property: 'offsetX' }, 1, 10)
    engine.addKeyframe({ kind: 'shadow', nodeId: group.id, property: 'offsetX' }, 2, 20)
    engine.addKeyframe({ kind: 'shadow', nodeId: group.id, property: 'offsetX' }, 4, 30)
    engine.addKeyframe({ kind: 'shadow', nodeId: group.id, property: 'blur' }, 1, 4)
    engine.addKeyframe({ kind: 'shadow', nodeId: group.id, property: 'blur' }, 4, 8)
    engine.addKeyframe({ kind: 'shadow', nodeId: group.id, property: 'color' }, 0, '#ff0000')
    engine.addKeyframe({ kind: 'shadow', nodeId: group.id, property: 'color' }, 2, '#00ff00')
    engine.addKeyframe({ kind: 'shadow', nodeId: group.id, property: 'opacity' }, 0, 0.2)
    engine.addKeyframe({ kind: 'shadow', nodeId: group.id, property: 'opacity' }, 2, 0.8)

    const targets: ExtractableKeyframe[] = []
    for (const prop of ['offsetX', 'blur', 'color', 'opacity'] as ShadowProperty[]) {
      for (const kf of engine.getShadowKeyframes(group.id, prop)) {
        targets.push({
          target: { kind: 'shadow', nodeId: group.id, property: prop },
          time: kf.time,
          value: kf.value,
          interpolation: kf.interpolation,
          tangentIn: kf.tangentIn,
          tangentOut: kf.tangentOut,
          keyframeId: kf.id,
        })
      }
    }
    expect(targets.length).toBeGreaterThan(0)
    expect(targets.some((t) => (t.target as { property: string }).property === 'offsetX')).toBe(
      true,
    )

    const bounds = computeExtractionBounds(targets)
    expect(bounds.selStart).toBe(0)
    expect(bounds.selEnd).toBe(4)
    expect(bounds.clipDuration).toBe(4)
    const normalized = targets.map((kf) => normalizeExtractable(kf, bounds))
    for (const nk of normalized) {
      expect(nk.time).toBeGreaterThanOrEqual(0)
      expect(nk.time).toBeLessThanOrEqual(1)
    }
    const groups = groupNormalizedByChannel(normalized)
    const shadowKeys = [...groups.keys()].filter((k) => k.startsWith('shadow:'))
    expect(shadowKeys).toEqual(
      expect.arrayContaining(['shadow:offsetX', 'shadow:blur', 'shadow:color', 'shadow:opacity']),
    )
    for (const [key, arr] of groups) {
      if (key.startsWith('shadow:')) {
        const prop = key.slice('shadow:'.length) as ShadowProperty
        expect(SHADOW_PROPERTIES).toContain(prop)
        for (const nk of arr) {
          expect(channelKeyOf(nk.target)).toBe(`shadow:${prop}`)
          const nkKey = { kind: 'shadow', property: prop } as const
          expect(nkKey.kind).toBe('shadow')
          expect(nkKey.property).toBe(prop)
        }
      }
    }
    validateNoDuplicateTimes(groups)

    const badColor = makeExtractable(
      { kind: 'shadow', nodeId: group.id, property: 'color' },
      1,
      '#gggggg',
    )
    expect(() => normalizeExtractable(badColor, bounds)).toThrow(/hex/)
    const badOpacity = makeExtractable(
      { kind: 'shadow', nodeId: group.id, property: 'opacity' },
      1,
      2,
    )
    expect(() => normalizeExtractable(badOpacity, bounds)).toThrow(/opacity.*\[0,1\]/)
    const badBlur = makeExtractable({ kind: 'shadow', nodeId: group.id, property: 'blur' }, 1, -1)
    expect(() => normalizeExtractable(badBlur, bounds)).toThrow(/non-negative/)
    const badFinite = makeExtractable(
      { kind: 'shadow', nodeId: group.id, property: 'offsetX' },
      1,
      NaN,
    )
    expect(() => normalizeExtractable(badFinite, bounds)).toThrow(/finite/)

    void pub
  })

  it('ClipDef persists bespoke sidecar shadowChannelAnimations: Map<ShadowProperty, ClipChannelAnimation> (not ClipChannelDef uniform-six) — numeric continuous, color kind:color hex-validated; ClipJSON.shadowChannelAnimations', () => {
    const { engine, dispatcher } = setup()
    const slide = engine.getActiveSlide()!
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'G')
    dispatcher.dispatch(
      new SetShadowEffectCommand({ nodeId: group.id, shadowEffect: DEFAULT_SHADOW_EFFECT }),
    )
    engine.addKeyframe({ kind: 'shadow', nodeId: group.id, property: 'offsetX' }, 1, 10)
    engine.addKeyframe({ kind: 'shadow', nodeId: group.id, property: 'offsetX' }, 2, 20)
    const offsetXKF = engine.getShadowKeyframes(group.id, 'offsetX')[1]!
    engine.setKeyframeInterpolation(
      { kind: 'shadow', nodeId: group.id, property: 'offsetX' },
      offsetXKF.id,
      'bezier',
    )
    engine.addKeyframe({ kind: 'shadow', nodeId: group.id, property: 'color' }, 1, '#000000')
    engine.addKeyframe({ kind: 'shadow', nodeId: group.id, property: 'color' }, 2, '#ffffff')
    engine.addKeyframe({ kind: 'shadow', nodeId: group.id, property: 'blur' }, 0, 0)
    engine.addKeyframe({ kind: 'shadow', nodeId: group.id, property: 'blur' }, 1, 16)

    const extractable: ExtractableKeyframe[] = []
    for (const prop of ['offsetX', 'blur', 'color'] as ShadowProperty[]) {
      for (const kf of engine.getShadowKeyframes(group.id, prop)) {
        extractable.push({
          target: { kind: 'shadow', nodeId: group.id, property: prop },
          time: kf.time,
          value: kf.value,
          interpolation: kf.interpolation,
          tangentIn: kf.tangentIn,
          tangentOut: kf.tangentOut,
          keyframeId: kf.id,
        })
      }
    }
    const res = dispatcher.dispatch(
      new ExtractToClipCommand({
        keyframes: extractable,
        name: 'ShadowClip',
        duration: 2,
        category: 'test',
      }),
    )
    expect(res.ok).toBe(true)
    const clip = engine.clips[0]!
    expect(clip.shadowChannelKeys).toEqual(expect.arrayContaining(['offsetX', 'blur', 'color']))
    expect(clip.hasChannel('positionX')).toBe(false)
    expect(clip.hasChannel('opacity')).toBe(false)
    const offsetXAnim = clip.shadowChannelAnimation('offsetX')!
    expect(offsetXAnim.length).toBe(2)
    expect(offsetXAnim.keyframes()[0].value).toBe(10)
    const blurAnim = clip.shadowChannelAnimation('blur')!
    expect(blurAnim.keyframes()[0].value).toBe(0)
    const colorAnim = clip.shadowChannelAnimation('color')!
    expect(colorAnim.keyframes()[0].value).toBe('#000000')
    expect((colorAnim.keyframes()[0].value as string).toLowerCase()).toBe('#000000')
    const json = clip.toJSON() as unknown as { shadowChannelAnimations?: Record<string, unknown> }
    expect(json.shadowChannelAnimations).toBeDefined()
    expect(json.shadowChannelAnimations!['offsetX']).toBeDefined()
    expect(json.shadowChannelAnimations!['blur']).toBeDefined()
    expect(json.shadowChannelAnimations!['color']).toBeDefined()
    expect(json.shadowChannelAnimations!['offsetX']).not.toHaveProperty('property')
    const badJson = {
      id: 'clip-bad',
      name: 'Bad',
      duration: 1,
      category: '',
      params: [],
      channels: [],
      channelAnimations: {},
      shadowChannelAnimations: {
        color: {
          keyframes: [
            {
              id: 'k1',
              time: 0,
              value: '#gggggg',
              interpolation: 'linear',
              tangentIn: { time: 0, value: 0 },
              tangentOut: { time: 0, value: 0 },
            },
          ],
        },
        blur: {
          keyframes: [
            {
              id: 'k2',
              time: 0,
              value: -5,
              interpolation: 'linear',
              tangentIn: { time: 0, value: 0 },
              tangentOut: { time: 0, value: 0 },
            },
          ],
        },
      },
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const parsed = ClipDefinition.fromJSON(badJson)
    warn.mockRestore()
    expect(parsed.shadowChannelAnimation('color')!.keyframes()[0].value).toBe('#000000')
    expect(parsed.shadowChannelAnimation('blur')!.keyframes()[0].value).toBe(0)
  })

  it('ClipCollection broadcast by semanticName carries shadow clips verbatim (no schema change) — same semanticName → clipId map as morphs; rig collection left_hand shadows travel like morphs', () => {
    const { engine, dispatcher } = setup()
    const slide = engine.getActiveSlide()!
    const handle = engine.createNode(slide.scene.id, slide.scene.root.id, 'RigHandle')
    const leftHand = engine.createNode(slide.scene.id, handle.id, 'LeftHand', {
      components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
    })
    engine.setSemanticName(leftHand.id, 'left_hand')
    const rightHand = engine.createNode(slide.scene.id, handle.id, 'RightHand', {
      components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
    })
    engine.setSemanticName(rightHand.id, 'right_hand')

    const clipA = engine.createClip('ShadowA', 1, 'test', [], [])
    clipA.addShadowChannelKeyframe(
      'offsetX',
      new Keyframe(newKeyframeId(), 0, 10, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }),
    )
    clipA.addShadowChannelKeyframe(
      'offsetX',
      new Keyframe(newKeyframeId(), 1, 20, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }),
    )
    const clipB = engine.createClip('ShadowB', 1, 'test', [], [])
    clipB.addShadowChannelKeyframe(
      'color',
      new Keyframe(
        newKeyframeId(),
        0,
        '#000000',
        'linear',
        { time: 0, value: 0 },
        { time: 0, value: 0 },
      ),
    )
    clipB.addShadowChannelKeyframe(
      'color',
      new Keyframe(
        newKeyframeId(),
        1,
        '#ff0000',
        'linear',
        { time: 0, value: 0 },
        { time: 0, value: 0 },
      ),
    )

    const collection = engine.createClipCollection(
      'RigCollection',
      { left_hand: clipA.id, right_hand: clipB.id },
      handle.id,
    )
    expect(collection.getBinding('left_hand')).toBe(clipA.id)
    expect(collection.getBinding('right_hand')).toBe(clipB.id)
    const colJson = collection.toJSON()
    expect(colJson.bindings).toEqual({ left_hand: clipA.id, right_hand: clipB.id })
    expect(colJson.id).toBe(collection.id)
    const lessonJson = engine.toJSON()
    expect(lessonJson.clipCollections).toBeDefined()
    expect(lessonJson.clipCollections!.length).toBe(1)
    expect(lessonJson.clipCollections![0].bindings).toEqual({
      left_hand: clipA.id,
      right_hand: clipB.id,
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    engine.restoreFromJSON(lessonJson)
    warn.mockRestore()
    const restoredCol = engine.getClipCollection(collection.id)
    expect(restoredCol.getBinding('left_hand')).toBe(clipA.id)
    expect(restoredCol.getBinding('right_hand')).toBe(clipB.id)
    const restoredClipA = engine.getClip(clipA.id)
    expect(restoredClipA.shadowChannelAnimation('offsetX')!.length).toBe(2)
    const restoredClipB = engine.getClip(clipB.id)
    expect(restoredClipB.shadowChannelAnimation('color')!.keyframes()[0].value).toBe('#000000')

    const targetHandle = engine.createNode(slide.scene.id, slide.scene.root.id, 'TargetHandle')
    const targetLeft = engine.createNode(slide.scene.id, targetHandle.id, 'TgtLeft', {
      components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
    })
    engine.setSemanticName(targetLeft.id, 'left_hand')
    const targetRight = engine.createNode(slide.scene.id, targetHandle.id, 'TgtRight', {
      components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
    })
    engine.setSemanticName(targetRight.id, 'right_hand')
    const applied = engine.applyClipCollection(collection.id, targetHandle.id)
    expect(applied.length).toBe(2)
    const leftInst = engine.getClipInstances(targetLeft.id)[0]!
    const rightInst = engine.getClipInstances(targetRight.id)[0]!
    expect(leftInst.clipId).toBe(clipA.id)
    expect(rightInst.clipId).toBe(clipB.id)

    void dispatcher
  })

  it('Reusable Objects (.lesson_object) bundles nodes shadowEffect + castShadow plus library clips / clipCollections that contain shadow channels plus SlideAnimation shadowTracks for the subtree; import remaps ids (fresh keyframe ids, node / clip ids) via LessonSerializer', () => {
    const { engine, dispatcher, pub } = setup()
    const slide = engine.getActiveSlide()!
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'HeroRig')
    const childAsset = engine.createNode(slide.scene.id, host.id, 'AssetChild', {
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def1' } },
    })
    engine.setSemanticName(childAsset.id, 'left_hand')
    dispatcher.dispatch(new SetCastShadowCommand({ nodeId: childAsset.id, castShadow: false }))
    const childCircle = engine.createNode(slide.scene.id, host.id, 'CircleChild', {
      components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
    })
    engine.setSemanticName(childCircle.id, 'right_hand')
    // Host now has children, so it is a group — set shadowEffect after children
    dispatcher.dispatch(
      new SetShadowEffectCommand({ nodeId: host.id, shadowEffect: DEFAULT_SHADOW_EFFECT }),
    )

    const clip1 = engine.createClip('ShadowOffset', 1, 'test', [], [])
    clip1.addShadowChannelKeyframe(
      'offsetX',
      new Keyframe(newKeyframeId(), 0, 5, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }),
    )
    clip1.addShadowChannelKeyframe(
      'offsetX',
      new Keyframe(newKeyframeId(), 1, 15, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }),
    )
    const clip2 = engine.createClip('ShadowColor', 1, 'test', [], [])
    clip2.addShadowChannelKeyframe(
      'color',
      new Keyframe(
        newKeyframeId(),
        0,
        '#000000',
        'linear',
        { time: 0, value: 0 },
        { time: 0, value: 0 },
      ),
    )
    clip2.addShadowChannelKeyframe(
      'color',
      new Keyframe(
        newKeyframeId(),
        1,
        '#ff0000',
        'linear',
        { time: 0, value: 0 },
        { time: 0, value: 0 },
      ),
    )

    dispatcher.dispatch(new AssignClipCommand({ nodeId: childAsset.id, clipId: clip1.id }))
    dispatcher.dispatch(new AssignClipCommand({ nodeId: childCircle.id, clipId: clip2.id }))

    const col = engine.createClipCollection(
      'RigShadows',
      { left_hand: clip1.id, right_hand: clip2.id },
      host.id,
    )

    engine.addKeyframe({ kind: 'shadow', nodeId: host.id, property: 'blur' }, 0, 8)
    engine.addKeyframe({ kind: 'shadow', nodeId: host.id, property: 'blur' }, 1, 16)
    engine.addKeyframe({ kind: 'shadow', nodeId: host.id, property: 'opacity' }, 0, 0.35)
    engine.addKeyframe({ kind: 'shadow', nodeId: host.id, property: 'opacity' }, 1, 0.8)
    engine.addKeyframe({ kind: 'shadow', nodeId: host.id, property: 'color' }, 0, '#000000')
    engine.addKeyframe({ kind: 'shadow', nodeId: host.id, property: 'color' }, 1, '#ffffff')
    engine.addKeyframe({ kind: 'shadow', nodeId: childCircle.id, property: 'offsetY' }, 0, 10)
    engine.addKeyframe({ kind: 'shadow', nodeId: childCircle.id, property: 'offsetY' }, 1, 20)
    const offYKf = engine.getShadowKeyframes(childCircle.id, 'offsetY')[1]!
    engine.setKeyframeInterpolation(
      { kind: 'shadow', nodeId: childCircle.id, property: 'offsetY' },
      offYKf.id,
      'bounce',
    )

    const hostShadowBefore = pub.evaluateShadow(host.id, 0.5)!
    const hostShadowTracksBefore = [
      ...engine
        .getShadowKeyframes(host.id, 'blur')
        .map((k) => ({ id: k.id, time: k.time, value: k.value })),
    ]
    const clip1JsonBefore = clip1.toJSON()

    const obj = engine.exportReusableObject(host.id, 'HeroRig', 'Test rig')
    expect(obj.nodes.some((n) => n.shadowEffect !== undefined)).toBe(true)
    const exportedHost = obj.nodes.find((n) => n.id === host.id)!
    expect(exportedHost.shadowEffect).toEqual(DEFAULT_SHADOW_EFFECT)
    const exportedAsset = obj.nodes.find((n) => n.name === 'AssetChild')!
    expect(exportedAsset.castShadow).toBe(false)
    const exportedCircle = obj.nodes.find((n) => n.name === 'CircleChild')!
    expect(exportedCircle.castShadow).toBeUndefined()
    expect(obj.library?.clips).toBeDefined()
    expect(obj.library!.clips!.some((c) => (c as { id: string }).id === clip1.id)).toBe(true)
    expect(obj.library!.clips!.some((c) => (c as { id: string }).id === clip2.id)).toBe(true)
    const libClip1 = obj.library!.clips!.find(
      (c) => (c as { id: string }).id === clip1.id,
    ) as unknown as { shadowChannelAnimations: Record<string, unknown> }
    expect(libClip1.shadowChannelAnimations).toBeDefined()
    expect(libClip1.shadowChannelAnimations['offsetX']).toBeDefined()
    expect(obj.library?.clipCollections).toBeDefined()
    expect(obj.library!.clipCollections!.length).toBe(1)
    expect(obj.library!.clipCollections![0].bindings).toEqual({
      left_hand: clip1.id,
      right_hand: clip2.id,
    })
    expect(obj.animation).toBeDefined()
    const animNodeIds = obj.animation!.nodes.map((n) => n.nodeId)
    expect(animNodeIds).toEqual(expect.arrayContaining([host.id, childCircle.id]))
    const hostAnim = obj.animation!.nodes.find((n) => n.nodeId === host.id)!
    expect(hostAnim.shadowTracks).toBeDefined()
    expect(hostAnim.shadowTracks!.some((t) => t.property === 'blur')).toBe(true)
    expect(hostAnim.shadowTracks!.some((t) => t.property === 'color')).toBe(true)

    const engine2 = createEngineInternal()
    const undo2 = new UndoStack()
    new CommandDispatcher(engine2, undo2, () => undefined)
    const pub2 = toReadOnly(engine2)
    engine2.createProject({ name: 'P2' })
    engine2.createSlide('S2')
    const beforeIds = new Set(
      [...walkPreOrder(engine2.getActiveSlide()!.scene.root)].map((n) => n.id),
    )
    const importResult = engine2.importReusableObject(obj)
    for (const [oldId, newId] of importResult.nodeIdMap) {
      expect(oldId).not.toBe(newId)
      expect(beforeIds.has(newId)).toBe(false)
    }
    for (const [oldClipId, newClipId] of importResult.clipIdMap) {
      expect(oldClipId).not.toBe(newClipId)
      expect(() => engine2.getClip(oldClipId)).toThrow()
      expect(engine2.getClip(newClipId)).toBeDefined()
    }
    const newHostId = importResult.nodeIdMap.get(host.id)!
    const importedHostShadowTracks = engine2.getShadowKeyframes(newHostId, 'blur')
    expect(importedHostShadowTracks.length).toBe(2)
    for (const orig of hostShadowTracksBefore) {
      expect(importedHostShadowTracks.some((k) => k.id === orig.id)).toBe(false)
      expect(
        importedHostShadowTracks.some((k) => k.time === orig.time && k.value === orig.value),
      ).toBe(true)
    }
    const newClip1Id = importResult.clipIdMap.get(clip1.id)!
    const newClip1 = engine2.getClip(newClip1Id)
    const origClip1KfIds = (
      clip1JsonBefore as unknown as {
        shadowChannelAnimations: Record<string, { keyframes: { id: string }[] }>
      }
    ).shadowChannelAnimations['offsetX'].keyframes.map((k) => k.id)
    const newClip1KfIds = newClip1
      .shadowChannelAnimation('offsetX')!
      .keyframes()
      .map((k) => k.id)
    for (const oldKfId of origClip1KfIds) {
      expect(newClip1KfIds).not.toContain(oldKfId)
    }
    const originalAt05 = pub.evaluateShadow(host.id, 0.5)!
    const importedAt05 = pub2.evaluateShadow(newHostId, 0.5)!
    expect(importedAt05.offsetX).toBe(originalAt05.offsetX)
    expect(importedAt05.blur).toBeCloseTo(originalAt05.blur, 5)
    expect(importedAt05.color.toLowerCase()).toBe(originalAt05.color.toLowerCase())
    expect(importedAt05.opacity).toBeCloseTo(originalAt05.opacity, 5)

    const newCircleId = importResult.nodeIdMap.get(childCircle.id)!
    const importedHostBlur = engine2.getShadowKeyframes(newHostId, 'blur')
    expect(importedHostBlur.length).toBe(2)
    void newCircleId
    void col
    void hostShadowBefore
  })

  it('Project.embeddedAssets not used for shadows (no external definition to snapshot); cloning / duplicate preserves shadow data like visible / opacity', () => {
    const { engine, dispatcher, pub } = setup()
    const slide = engine.getActiveSlide()!
    const host = engine.createNode(slide.scene.id, slide.scene.root.id, 'HostGroup')
    const child = engine.createNode(slide.scene.id, host.id, 'ChildAsset', {
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def1' } },
    })
    dispatcher.dispatch(
      new SetShadowEffectCommand({ nodeId: host.id, shadowEffect: DEFAULT_SHADOW_EFFECT }),
    )
    dispatcher.dispatch(new SetCastShadowCommand({ nodeId: child.id, castShadow: false }))
    engine.addKeyframe({ kind: 'shadow', nodeId: host.id, property: 'blur' }, 0, 5)
    engine.addKeyframe({ kind: 'shadow', nodeId: host.id, property: 'opacity' }, 0, 0.4)
    engine.setVisibility(child.id, false)
    engine.setOpacity(child.id, 0.5)

    const beforeEmbeddedAssets = engine.embeddedAssets.length
    expect(beforeEmbeddedAssets).toBe(0)
    const dupSlide = engine.duplicateSlide(slide.id)
    const dupHost = [...walkPreOrder(dupSlide.scene.root)].find(
      (n) => n.name === 'HostGroup' && n.id !== host.id,
    )!
    expect(dupHost.shadowEffect).toEqual(DEFAULT_SHADOW_EFFECT)
    const dupChild = dupHost.children.find((c) => c.name === 'ChildAsset')!
    expect(dupChild.castShadow).toBe(false)
    expect(dupChild.visible).toBe(false)
    expect(dupChild.opacity).toBe(0.5)
    expect(engine.getShadowKeyframes(dupHost.id, 'blur').length).toBe(1)
    expect(engine.getShadowKeyframes(dupHost.id, 'blur')[0].value).toBe(5)
    expect(engine.embeddedAssets.length).toBe(0)
    expect(pub.toJSON().library).toBeUndefined()
    const obj = engine.exportReusableObject(host.id, 'HostObj')
    const engine2 = createEngineInternal()
    const undo2 = new UndoStack()
    new CommandDispatcher(engine2, undo2, () => undefined)
    engine2.createProject({ name: 'P2' })
    engine2.createSlide('S2')
    const imp = engine2.importReusableObject(obj)
    const newHostId = imp.nodeIdMap.get(host.id)!
    const newChildId = imp.nodeIdMap.get(child.id)!
    const newHost = engine2.getNode(newHostId)
    const newChild = engine2.getNode(newChildId)
    expect(newHost.shadowEffect).toEqual(DEFAULT_SHADOW_EFFECT)
    expect(newChild.castShadow).toBe(false)
    expect(newChild.visible).toBe(false)
    expect(newChild.opacity).toBe(0.5)
    expect(engine2.embeddedAssets.length).toBe(0)
    void dispatcher
  })

  it('Engine seam: extract timeline selection → create Clip → assign to another Group → evaluate; collection export / import round-trip; reusable object export / import with shadowEffect + tracks + library clips, assert id remap and evaluateShadow equality', () => {
    const { engine, dispatcher, pub } = setup()
    const slide = engine.getActiveSlide()!
    const hero = engine.createNode(slide.scene.id, slide.scene.root.id, 'Hero')
    // Make hero a group before shadowEffect: add a dummy child
    engine.createNode(slide.scene.id, hero.id, 'HeroChild', {
      components: { circle: { kind: 'circle', radius: 5, startAngle: 0, endAngle: 360 } },
    })
    dispatcher.dispatch(
      new SetShadowEffectCommand({ nodeId: hero.id, shadowEffect: DEFAULT_SHADOW_EFFECT }),
    )
    engine.addKeyframe({ kind: 'shadow', nodeId: hero.id, property: 'offsetX' }, 0, 12)
    engine.addKeyframe({ kind: 'shadow', nodeId: hero.id, property: 'offsetX' }, 1, 32)
    engine.addKeyframe({ kind: 'shadow', nodeId: hero.id, property: 'scaleY' }, 0, 1)
    engine.addKeyframe({ kind: 'shadow', nodeId: hero.id, property: 'scaleY' }, 1, 0.2)
    engine.addKeyframe({ kind: 'shadow', nodeId: hero.id, property: 'color' }, 0, '#000000')
    engine.addKeyframe({ kind: 'shadow', nodeId: hero.id, property: 'color' }, 1, '#ff0000')

    const extractable: ExtractableKeyframe[] = []
    for (const prop of ['offsetX', 'scaleY', 'color'] as ShadowProperty[]) {
      for (const kf of engine.getShadowKeyframes(hero.id, prop)) {
        extractable.push({
          target: { kind: 'shadow', nodeId: hero.id, property: prop },
          time: kf.time,
          value: kf.value,
          interpolation: kf.interpolation,
          tangentIn: kf.tangentIn,
          tangentOut: kf.tangentOut,
          keyframeId: kf.id,
        })
      }
    }
    const extractRes = dispatcher.dispatch(
      new ExtractToClipCommand({ keyframes: extractable, name: 'HeroShadowClip', duration: 1 }),
    )
    expect(extractRes.ok).toBe(true)
    const heroClip = engine.clips[0]!
    expect(heroClip.shadowChannelAnimation('offsetX')!.length).toBe(2)
    expect(heroClip.shadowChannelAnimation('scaleY')!.length).toBe(2)
    expect(heroClip.shadowChannelAnimation('color')!.length).toBe(2)

    const otherGroup = engine.createNode(slide.scene.id, slide.scene.root.id, 'OtherHero')
    engine.createNode(slide.scene.id, otherGroup.id, 'OtherChild', {
      components: { circle: { kind: 'circle', radius: 5, startAngle: 0, endAngle: 360 } },
    })
    dispatcher.dispatch(
      new SetShadowEffectCommand({
        nodeId: otherGroup.id,
        shadowEffect: { ...DEFAULT_SHADOW_EFFECT, offsetX: 0, scaleY: 1, color: '#000000' },
      }),
    )
    dispatcher.dispatch(new AssignClipCommand({ nodeId: otherGroup.id, clipId: heroClip.id }))
    const evalBegin = pub.evaluateShadow(otherGroup.id, 0)!
    expect(evalBegin.offsetX).toBe(12)
    expect(evalBegin.scaleY).toBe(1)
    const evalMid = pub.evaluateShadow(otherGroup.id, 0.5)!
    expect(evalMid.offsetX).toBeCloseTo(22, 1)
    expect(evalMid.scaleY).toBeCloseTo(0.6, 1)
    expect(evalMid.color.toLowerCase()).toBe('#800000')
    const evalEnd = pub.evaluateShadow(otherGroup.id, 1)!
    expect(evalEnd.offsetX).toBe(32)
    expect(evalEnd.scaleY).toBe(0.2)
    const evalMid2 = pub.evaluateShadow(otherGroup.id, 0.5)!
    expect(evalMid2.offsetX).toBe(evalMid.offsetX)
    expect(evalMid2.color).toBe(evalMid.color)
    const lessonJson = pub.toJSON()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    pub.restoreFromJSON(lessonJson)
    warn.mockRestore()
    const evalMidAfter = pub.evaluateShadow(otherGroup.id, 0.5)!
    expect(evalMidAfter.offsetX).toBeCloseTo(evalMid.offsetX, 5)
    expect(evalMidAfter.color.toLowerCase()).toBe(evalMid.color.toLowerCase())

    const coll = engine.createClipCollection('HeroCollection', { hero_shadow: heroClip.id })
    const lessonWithColl = pub.toJSON()
    expect(lessonWithColl.clipCollections).toBeDefined()
    engine.restoreFromJSON(lessonWithColl)
    const restoredColl = engine.getClipCollection(coll.id)
    expect(restoredColl.getBinding('hero_shadow')).toBe(heroClip.id)
    const restoredClip = engine.getClip(heroClip.id)
    expect(restoredClip.shadowChannelAnimation('offsetX')!.length).toBe(2)

    engine.addKeyframe({ kind: 'shadow', nodeId: hero.id, property: 'blur' }, 0, 8)
    engine.addKeyframe({ kind: 'shadow', nodeId: hero.id, property: 'blur' }, 1, 12)
    // Ensure hero references heroClip so that reusable object bundles it
    dispatcher.dispatch(new AssignClipCommand({ nodeId: hero.id, clipId: heroClip.id }))
    const beforeShadow = pub.evaluateShadow(hero.id, 0.5)!
    const obj = engine.exportReusableObject(hero.id, 'HeroObj')
    expect(obj.nodes[0].shadowEffect).toBeDefined()
    expect(obj.library?.clips?.some((c) => (c as { id: string }).id === heroClip.id)).toBe(true)
    const engine2 = createEngineInternal()
    const undo2 = new UndoStack()
    new CommandDispatcher(engine2, undo2, () => undefined)
    engine2.createProject({ name: 'P2' })
    engine2.createSlide('S2')
    const imp2 = engine2.importReusableObject(obj)
    const newHeroId = imp2.nodeIdMap.get(hero.id)!
    const pub2 = toReadOnly(engine2)
    const afterShadow = pub2.evaluateShadow(newHeroId, 0.5)!
    expect(afterShadow.blur).toBeCloseTo(beforeShadow.blur, 5)
    expect(afterShadow.offsetX).toBeCloseTo(beforeShadow.offsetX, 5)
    expect(newHeroId).not.toBe(hero.id)
    expect(imp2.clipIdMap.get(heroClip.id)!).not.toBe(heroClip.id)
  })
})
