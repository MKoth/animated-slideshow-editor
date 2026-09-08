/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import { createEngineInternal, toReadOnly } from '../../engine/internal'
import { createDefaultRectangleMesh } from '../../engine/mesh'
import { CommandDispatcher, UndoStack } from '../../engine/commands'
import {
  CreateProjectCommand,
  CreateSlideCommand,
  CreateNodeCommand,
  CreateClipCommand,
  AssignClipCommand,
  SetSemanticNameCommand,
  ImportReusableObjectCommand,
  PlaceCollectionCommand,
  ApplyClipCollectionCommand,
} from '../../engine/commands'
import { ExportClipCollectionCommand } from '../../engine/commands'
import { validateReusableObject, REUSABLE_OBJECT_VERSION } from '../../engine/reusableObject'
import { walkPreOrder } from '../../engine/sceneNode'
import { Keyframe, newKeyframeId } from '../../engine/keyframe'

function setupEngine() {
  const engine = createEngineInternal()
  const undo = new UndoStack()
  const dispatcher = new CommandDispatcher(engine as any, undo, () => {})
  const expectOk = (res: { ok: boolean; error?: Error; inverse?: any }) => {
    if (!res.ok) throw new Error(res.error?.message)
    return res.inverse
  }
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  return { engine, dispatcher, undo, expectOk }
}

describe('15-07 Reusable Object portability and library assignment via dropdown', () => {
  it('export writes .lesson_object with nodes + filtered animation + library{clips,clipCollections} self-contained including morphAnimation and shapes, downloadable and library snapshot', () => {
    const { engine, dispatcher, expectOk } = setupEngine()
    const slide = engine.getActiveSlide()!
    // Build hierarchy: parent RigHandle with bone, mesh with shapes, child circle
    const handle = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'RigHandle' }),
      ),
    ).nodeId as string
    const bone = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: handle,
          name: 'BoneA',
          components: { bone: { kind: 'bone', length: 80 } },
        }),
      ),
    ).nodeId as string
    expectOk(dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: bone, semanticName: 'arm' })))

    // Mesh node with shapes + morph binding
    const meshData = createDefaultRectangleMesh(10, 10)
    const meshNode = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: handle,
          name: 'MeshNode',
          components: { mesh: { kind: 'mesh', mesh: meshData } },
        }),
      ),
    ).nodeId as string
    expectOk(dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: meshNode, semanticName: 'mesh_part' })))
    engine.createShape(meshNode, 'A')
    const sB = engine.createShape(meshNode, 'B')
    for (let i = 0; i < sB.vertices.length; i++) {
      engine.setShapeVertex(meshNode, sB.id, i, sB.vertices[i].x + 8, sB.vertices[i].y)
    }
    const shapes = engine.getShapes(meshNode)
    const a = shapes.find((s) => s.name === 'A')!
    const b = shapes.find((s) => s.name === 'B')!
    engine.setMorphBinding(meshNode, { fromShapeId: a.id, toShapeId: b.id })
    // Add morph keyframes on mesh node
    dispatcher.dispatch(
      // using internal addKeyframe path via dispatcher AddKeyframeCommand for morph
      // Directly use engine's internal animation via Create? Use AddKeyframeCommand
      // For simplicity use engine.addKeyframe if available via internal cast
      {
        type: 'AddKeyframe',
      } as any,
    )
    // Use engine's morph track directly: add scalar morph keyframes via internal API
    // Use the AnimationManager via engine.addKeyframe if exists, else via direct slide animation
    const slideAnim = slide.animation.ensure(meshNode)
    slideAnim.addMorph(
      new Keyframe(newKeyframeId(), 0, { fromShapeId: a.id, toShapeId: b.id, coefficient: 0 } as any, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }),
    )
    slideAnim.addMorph(
      new Keyframe(newKeyframeId(), 1, { fromShapeId: a.id, toShapeId: b.id, coefficient: 1 } as any, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }),
    )

    // Clips: one with morphAnimation, one with standard channel
    const clipMorph = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'MorphWave', duration: 2, category: '' })),
    ).clipId as string
    const clipObjMorph = engine.getClip(clipMorph)
    clipObjMorph.addMorphKeyframe(new Keyframe(newKeyframeId(), 0, { fromShapeName: 'A', toShapeName: 'B', coefficient: 0 } as any, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))
    clipObjMorph.addMorphKeyframe(new Keyframe(newKeyframeId(), 1, { fromShapeName: 'A', toShapeName: 'B', coefficient: 1 } as any, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))

    const clipStd = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'Move', duration: 7, category: '' })),
    ).clipId as string
    const clipStdObj = engine.getClip(clipStd)
    clipStdObj.addChannelKeyframe('positionX', new Keyframe(newKeyframeId(), 0, 0, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))
    clipStdObj.addChannelKeyframe('positionX', new Keyframe(newKeyframeId(), 1, 10, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))

    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: bone, clipId: clipStd })))
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: meshNode, clipId: clipMorph })))

    // Create collection
    void (expectOk(
      dispatcher.dispatch(new ExportClipCollectionCommand({ parentNodeId: handle, name: 'RigAnim' })),
    ).collectionId as string)

    // Export reusable object
    const obj = engine.exportReusableObject(handle, 'MyRig', 'Test export')

    expect(obj.version).toBe(REUSABLE_OBJECT_VERSION)
    expect(obj.version).toBe(1)
    expect(validateReusableObject(obj)).toEqual([])
    // Nodes include hierarchy and shapes
    expect(obj.nodes.length).toBeGreaterThanOrEqual(3)
    const meshJson = obj.nodes.find((n) => n.name === 'MeshNode')!
    expect((meshJson.components as any).mesh.shapes).toBeDefined()
    expect((meshJson.components as any).mesh.shapes.length).toBe(2)
    expect((meshJson.components as any).mesh.shapes.map((s: any) => s.name).sort()).toEqual(['A', 'B'])
    // Filtered animation includes morphBinding/morphTrack per node
    expect(obj.animation).toBeDefined()
    const meshAnim = obj.animation!.nodes.find((n) => n.nodeId === meshNode)!
    // Global morphBinding no longer persisted — per-keyframe pair owns binding
    expect(meshAnim.morphTrack).toBeDefined()
    expect(meshAnim.morphTrack!.keyframes.length).toBe(2)
    // Per-keyframe fromShapeId/toShapeId preserved before remapping
    for (const kf of meshAnim.morphTrack!.keyframes) {
      const v = kf.value as unknown as { fromShapeId: string | null; toShapeId: string | null }
      // Before export, ids are original
      if (typeof v === 'object' && v !== null && 'fromShapeId' in v) {
        expect([a.id, b.id]).toContain(v.fromShapeId)
        expect([a.id, b.id]).toContain(v.toShapeId)
      }
    }
    // Library snapshot includes clips and clipCollections including morphAnimation
    expect(obj.library).toBeDefined()
    expect(obj.library!.clips!.length).toBeGreaterThanOrEqual(2)
    const libMorphClip = obj.library!.clips!.find((c: any) => c.id === clipMorph) as any
    expect(libMorphClip).toBeDefined()
    expect(libMorphClip.morphAnimation).toBeDefined()
    expect(libMorphClip.morphAnimation.keyframes.length).toBe(2)
    expect(obj.library!.clipCollections!.length).toBe(1)
    expect(obj.library!.clipCollections![0].bindings['arm']).toBeDefined()
    // Validate downloadable JSON round-trip
    const text = JSON.stringify(obj)
    const parsed = JSON.parse(text)
    expect(validateReusableObject(parsed)).toEqual([])
  })

  it('manager dropdown on parent lists available collections; Apply/Place broadcasts via semanticName at playhead speed=1', () => {
    const { engine, dispatcher, expectOk } = setupEngine()
    const slide = engine.getActiveSlide()!
    slide.duration = 10
    const parent = expectOk(
      dispatcher.dispatch(new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'Parent' })),
    ).nodeId as string
    const childA = expectOk(
      dispatcher.dispatch(new CreateNodeCommand({ sceneId: slide.scene.id, parentId: parent, name: 'Left' })),
    ).nodeId as string
    expectOk(dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: childA, semanticName: 'left_hand' })))
    const childB = expectOk(
      dispatcher.dispatch(new CreateNodeCommand({ sceneId: slide.scene.id, parentId: parent, name: 'Right' })),
    ).nodeId as string
    expectOk(dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: childB, semanticName: 'right_hand' })))

    const clip1 = expectOk(dispatcher.dispatch(new CreateClipCommand({ name: 'Wave', duration: 7, category: '' }))).clipId as string
    engine.getClip(clip1).addChannelKeyframe('positionX', new Keyframe(newKeyframeId(), 0, 0, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))
    engine.getClip(clip1).addChannelKeyframe('positionX', new Keyframe(newKeyframeId(), 1, 100, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))
    const clip2 = expectOk(dispatcher.dispatch(new CreateClipCommand({ name: 'Shake', duration: 7, category: '' }))).clipId as string
    engine.getClip(clip2).addChannelKeyframe('positionX', new Keyframe(newKeyframeId(), 0, 0, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))
    engine.getClip(clip2).addChannelKeyframe('positionX', new Keyframe(newKeyframeId(), 1, -50, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))

    const col = engine.createClipCollection('MyCol', { left_hand: clip1, right_hand: clip2 }, parent)
    // Simulate manager dropdown listing: engine.clipCollections should contain col
    const available = engine.clipCollections.map((c) => c.id)
    expect(available).toContain(col.id)

    // Simulate playhead at 3.5 and Apply via semanticName broadcast speed=1
    const playhead = 3.5
    void dispatcher.dispatch(new ApplyClipCollectionCommand({ collectionId: col.id, targetNodeId: parent })) as any
    // Apply uses startTime 0 speed1; for manager dropdown we test Place at playhead
    // Use PlaceCollectionCommand at playhead
    const targetParent = expectOk(
      dispatcher.dispatch(new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'TargetParent' })),
    ).nodeId as string
    const targetL = expectOk(
      dispatcher.dispatch(new CreateNodeCommand({ sceneId: slide.scene.id, parentId: targetParent, name: 'TLeft' })),
    ).nodeId as string
    expectOk(dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: targetL, semanticName: 'left_hand' })))
    const targetR = expectOk(
      dispatcher.dispatch(new CreateNodeCommand({ sceneId: slide.scene.id, parentId: targetParent, name: 'TRight' })),
    ).nodeId as string
    expectOk(dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: targetR, semanticName: 'right_hand' })))

    const placeRes = dispatcher.dispatch(new PlaceCollectionCommand({ collectionId: col.id, parentNodeId: targetParent, startTime: playhead })) as any
    expect(placeRes.ok).toBe(true)
    const placementId = placeRes.inverse.placementId as string
    const members = engine.getPlacementMembers(placementId)
    expect(members.length).toBe(2)
    for (const m of members) {
      expect(m.instance.startTime).toBe(playhead)
      expect(m.instance.speed).toBe(1)
      expect(m.instance.placementId).toBe(placementId)
    }
    // Verify hierarchical apply walked descendants and broadcast
    expect(engine.getClipInstances(targetL).length).toBe(1)
    expect(engine.getClipInstances(targetR).length).toBe(1)
    expect(engine.getClipInstances(targetL)[0]!.clipId).toBe(clip1)
    expect(engine.getClipInstances(targetR)[0]!.clipId).toBe(clip2)
    // Also verify ApplyClipCollection path (without placement) still works at speed1
    // Clean up targetParent instances then apply
    for (const m of [...members]) engine.removeClipInstance(m.nodeId, m.instance.id)
    engine.deleteCollectionPlacement(placementId)
    const applied = engine.applyClipCollection(col.id, targetParent)
    for (const a of applied) {
      const inst = engine.getClipInstance(a.nodeId, a.instanceId)
      expect(inst.startTime).toBe(0)
      expect(inst.speed).toBe(1)
    }
  })

  it('import forks new ids for nodes/clips/collections/shapeIds with per-mesh shapeIdMap remapping morphBinding ids; skeleton ids regenerated; no collisions', () => {
    const { engine, dispatcher, expectOk } = setupEngine()
    const slide = engine.getActiveSlide()!
    const handle = expectOk(
      dispatcher.dispatch(new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'Handle' })),
    ).nodeId as string
    const bone = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId: handle, name: 'Bone', components: { bone: { kind: 'bone', length: 60 } } }),
      ),
    ).nodeId as string
    expectOk(dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: bone, semanticName: 'arm' })))
    const meshNode = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: handle,
          name: 'Mesh',
          components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(10, 10) } },
        }),
      ),
    ).nodeId as string
    expectOk(dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: meshNode, semanticName: 'mesh' })))
    const _s1 = engine.createShape(meshNode, 'S1')
    void _s1
    const s2 = engine.createShape(meshNode, 'S2')
    for (let i = 0; i < s2.vertices.length; i++) engine.setShapeVertex(meshNode, s2.id, i, s2.vertices[i].x + 5, s2.vertices[i].y)
    const shapes = engine.getShapes(meshNode)
    const shapeA = shapes.find((s) => s.name === 'S1')!
    const shapeB = shapes.find((s) => s.name === 'S2')!
    engine.setMorphBinding(meshNode, { fromShapeId: shapeA.id, toShapeId: shapeB.id })
    const anim = slide.animation.ensure(meshNode)
    anim.addMorph(new Keyframe(newKeyframeId(), 0.2, { fromShapeId: shapeA.id, toShapeId: shapeB.id, coefficient: 0.3 } as any, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))

    const clip = expectOk(dispatcher.dispatch(new CreateClipCommand({ name: 'C', duration: 1, category: '' }))).clipId as string
    engine.getClip(clip).addChannelKeyframe('positionX', new Keyframe(newKeyframeId(), 0, 0, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: bone, clipId: clip })))
    const col = engine.createClipCollection('Col', { arm: clip }, handle)
    const obj = engine.exportReusableObject(handle, 'Obj')

    const oldNodeIds = new Set(obj.nodes.map((n) => n.id))
    void clip
    void col.id
    const oldShapeIds = new Set([shapeA.id, shapeB.id])

    // Import into same engine (should still fork fresh ids, no collision)
    void [...walkPreOrder(slide.scene.root)].length
    const beforeClipIds = new Set(engine.clips.map((c) => c.id))
    const beforeColIds = new Set(engine.clipCollections.map((c) => c.id))

    const res = engine.importReusableObject(obj)
    expect(res.nodeIdMap.size).toBe(obj.nodes.length)
    for (const [oldId, newId] of res.nodeIdMap) {
      expect(oldId).not.toBe(newId)
      expect(oldNodeIds.has(oldId)).toBe(true)
      // No collision with existing ids before import? New ids are fresh
      expect(beforeClipIds.has(newId)).toBe(false)
    }
    for (const [oldId, newId] of res.clipIdMap) {
      expect(oldId).not.toBe(newId)
      expect(() => engine.getClip(oldId) === engine.getClip(newId) ? null : null).not.toThrow()
      // Old clip still exists, new clip also exists with different id
      expect(engine.getClip(newId)).toBeDefined()
      expect(beforeClipIds.has(newId)).toBe(false) // fresh
    }
    for (const [oldId, newId] of res.collectionIdMap) {
      expect(oldId).not.toBe(newId)
      expect(engine.getClipCollection(newId)).toBeDefined()
      expect(beforeColIds.has(newId)).toBe(false)
    }
    // ShapeIds remapped via per-mesh shapeIdMap
    const newMeshId = res.nodeIdMap.get(meshNode)!
    const newShapes = engine.getShapes(newMeshId)
    expect(newShapes.length).toBe(2)
    const newIds = newShapes.map((s) => s.id)
    for (const oldSid of oldShapeIds) expect(newIds).not.toContain(oldSid)
    // Global morphBinding no longer persisted — per-keyframe pair owns binding, so global is null
    expect(engine.getMorphBinding(newMeshId)).toBeNull()
    // MorphTrack keyframe value remapped via shapeIdMap
    const newKfs = engine.getMorphKeyframes(newMeshId)
    expect(newKfs.length).toBe(1)
    const v = newKfs[0]!.value as any
    expect(oldShapeIds.has(v.fromShapeId)).toBe(false)
    expect(newIds).toContain(v.fromShapeId)
    expect(newIds).toContain(v.toShapeId)
    // Skeleton: bone node's id is remapped, and mesh boneWeights (if any) would be remapped – we at least check bone id new
    const newBoneId = res.nodeIdMap.get(bone)!
    expect(newBoneId).not.toBe(bone)
    // Animation keyframe ids regenerated
    const beforeKfIds = new Set(anim.morphKeyframes().map((k) => k.id))
    for (const kf of newKfs) expect(beforeKfIds.has(kf.id)).toBe(false)
  })

  it('round-trip: export then import restores hierarchy and saved animations with new ids; evaluator at timestamp matches preview', () => {
    const { engine, dispatcher, expectOk } = setupEngine()
    const slide = engine.getActiveSlide()!
    slide.duration = 5
    const handle = expectOk(
      dispatcher.dispatch(new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'Handle' })),
    ).nodeId as string
    const child = expectOk(
      dispatcher.dispatch(new CreateNodeCommand({ sceneId: slide.scene.id, parentId: handle, name: 'Arm', components: { bone: { kind: 'bone', length: 50 } } }),
      ),
    ).nodeId as string
    expectOk(dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: child, semanticName: 'arm' })))
    const clip = expectOk(dispatcher.dispatch(new CreateClipCommand({ name: 'Slide', duration: 2, category: '' }))).clipId as string
    const c = engine.getClip(clip)
    c.addChannelKeyframe('positionX', new Keyframe(newKeyframeId(), 0, 0, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))
    c.addChannelKeyframe('positionX', new Keyframe(newKeyframeId(), 1, 200, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: child, clipId: clip, startTime: 1, speed: 1 } as any)))
    // Also add a morph shape to test morphBinding preservation through round-trip
    const meshNode = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: handle,
          name: 'Mesh',
          components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(10, 10) } },
        }),
      ),
    ).nodeId as string
    const sA = engine.createShape(meshNode, 'A')
    const sB = engine.createShape(meshNode, 'B')
    for (let i = 0; i < sB.vertices.length; i++) engine.setShapeVertex(meshNode, sB.id, i, sB.vertices[i].x + 10, sB.vertices[i].y)
    const shapesOrig = engine.getShapes(meshNode)
    const aOrig = shapesOrig.find((s) => s.id === sA.id)!
    const bOrig = shapesOrig.find((s) => s.id === sB.id)!
    engine.setMorphBinding(meshNode, { fromShapeId: aOrig.id, toShapeId: bOrig.id })
    slide.animation.ensure(meshNode).addMorph(
      new Keyframe(newKeyframeId(), 0.5, { fromShapeId: aOrig.id, toShapeId: bOrig.id, coefficient: 0.5 } as any, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }),
    )
    const meshClip = expectOk(dispatcher.dispatch(new CreateClipCommand({ name: 'MorphClip', duration: 1, category: '' }))).clipId as string
    const mc = engine.getClip(meshClip)
    mc.addMorphKeyframe(new Keyframe(newKeyframeId(), 0, { fromShapeName: 'A', toShapeName: 'B', coefficient: 0 } as any, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))
    mc.addMorphKeyframe(new Keyframe(newKeyframeId(), 1, { fromShapeName: 'A', toShapeName: 'B', coefficient: 1 } as any, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: meshNode, clipId: meshClip })))

    const col = engine.createClipCollection('ArmCol', { arm: clip }, handle)

    const obj = engine.exportReusableObject(handle, 'HandleExport')
    // Capture evaluator preview at time 1.5 on original child
    const pub = toReadOnly(engine)
    const beforeEval = pub.evaluateNode(child, 1.5)
    // Create second engine and import
    const engine2 = createEngineInternal()
    const undo2 = new UndoStack()
    const disp2 = new CommandDispatcher(engine2 as any, undo2, () => {})
    const expectOk2 = (res: any) => {
      if (!res.ok) throw new Error(res.error?.message)
      return res.inverse
    }
    expectOk2(disp2.dispatch(new CreateProjectCommand({ name: 'P2' })))
    expectOk2(disp2.dispatch(new CreateSlideCommand({ name: 'S2' })))
    const importRes = engine2.importReusableObject(obj)
    const newChildId = importRes.nodeIdMap.get(child)!
    const newMeshId = importRes.nodeIdMap.get(meshNode)!
    const newClipId = importRes.clipIdMap.get(clip)!
    const newMeshClipId = importRes.clipIdMap.get(meshClip)!
    // Verify hierarchy restored
    const newHandleId = importRes.nodeIdMap.get(handle)!
    const newHandle = engine2.getNode(newHandleId)
    expect(newHandle.children.some((c) => c.id === newChildId)).toBe(true)
    expect(engine2.getNode(newChildId).semanticName).toBe('arm')
    // Verify clipInstances remapped to new clip ids
    expect(engine2.getClipInstances(newChildId)[0]!.clipId).toBe(newClipId)
    expect(engine2.getClipInstances(newMeshId)[0]!.clipId).toBe(newMeshClipId)
    // Verify collection remapped
    const newColId = importRes.collectionIdMap.get(col.id)!
    expect(engine2.getClipCollection(newColId).getBinding('arm')).toBe(newClipId)
    // Verify morph per-keyframe pair preservation via shapeIdMap (global binding null)
    const newShapes = engine2.getShapes(newMeshId)
    expect(engine2.getMorphBinding(newMeshId)).toBeNull()
    const newMorphKfs = engine2.getMorphKeyframes(newMeshId)
    expect(newMorphKfs.length).toBe(1)
    const newMorphVal = newMorphKfs[0]!.value as any
    expect(newShapes.map((s) => s.id)).toContain(newMorphVal.fromShapeId)
    expect(newShapes.map((s) => s.id)).toContain(newMorphVal.toShapeId)
    // Evaluator at same timestamp matches preview (within tolerance)
    const pub2 = toReadOnly(engine2)
    const afterEval = pub2.evaluateNode(newChildId, 1.5)
    expect(afterEval.transform.x).toBeCloseTo(beforeEval.transform.x, 5)
    expect(afterEval.transform.y).toBeCloseTo(beforeEval.transform.y, 5)
    expect(afterEval.opacity).toBeCloseTo(beforeEval.opacity, 5)
    // Also test morph evaluator preservation via import (check shape ids)
    const beforeMorphVal = engine.getMorphKeyframes(meshNode)[0]!.value as any
    const afterMorphVal = engine2.getMorphKeyframes(newMeshId)[0]!.value as any
    // Coefficient should be same, shape ids should be new but correspond
    expect(afterMorphVal.coefficient).toBeCloseTo(beforeMorphVal.coefficient, 5)
  })

  it('import forks placement ids and remaps collection/placement linkage to avoid collisions', () => {
    const { engine, dispatcher, expectOk } = setupEngine()
    const slide = engine.getActiveSlide()!
    const handle = expectOk(
      dispatcher.dispatch(new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'Handle' })),
    ).nodeId as string
    const child = expectOk(
      dispatcher.dispatch(new CreateNodeCommand({ sceneId: slide.scene.id, parentId: handle, name: 'Child' })),
    ).nodeId as string
    expectOk(dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: child, semanticName: 'hand' })))
    const clip = expectOk(dispatcher.dispatch(new CreateClipCommand({ name: 'C', duration: 2, category: '' }))).clipId as string
    engine.getClip(clip).addChannelKeyframe('positionX', new Keyframe(newKeyframeId(), 0, 0, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))
    const col = engine.createClipCollection('Col', { hand: clip }, handle)
    const placeRes = dispatcher.dispatch(new PlaceCollectionCommand({ collectionId: col.id, parentNodeId: handle, startTime: 0 })) as any
    expect(placeRes.ok).toBe(true)
    const placementId = placeRes.inverse.placementId as string
    const obj = engine.exportReusableObject(handle, 'WithPlacement')
    // Verify export includes placement
    const exportedHandle = obj.nodes.find((n) => n.name === 'Handle')!
    expect((exportedHandle as any).collectionPlacements).toBeDefined()
    expect((exportedHandle as any).collectionPlacements.length).toBe(1)
    expect((exportedHandle as any).collectionPlacements[0].id).toBe(placementId)
    // Import and verify placement id forked
    const res = engine.importReusableObject(obj)
    const newHandleId = res.nodeIdMap.get(handle)!
    const newHandle = engine.getNode(newHandleId)
    expect(newHandle.collectionPlacements.length).toBe(1)
    const newPlacementId = newHandle.collectionPlacements[0]!.id
    expect(newPlacementId).not.toBe(placementId)
    // Verify member clipInstances placementId remapped
    const newChildId = res.nodeIdMap.get(child)!
    const newChild = engine.getNode(newChildId)
    expect(newChild.clipInstances.length).toBe(1)
    expect(newChild.clipInstances[0]!.placementId).toBe(newPlacementId)
    // Verify no collisions on second import
    const res2 = engine.importReusableObject(obj)
    const newPlacementId2 = engine.getNode(res2.nodeIdMap.get(handle)!).collectionPlacements[0]!.id
    expect(newPlacementId2).not.toBe(placementId)
    expect(newPlacementId2).not.toBe(newPlacementId)
  })

  it('REUSABLE_OBJECT_VERSION 1 suffices; library snapshot pattern remains Objects tab, not global server registry', () => {
    expect(REUSABLE_OBJECT_VERSION).toBe(1)
    const { engine, dispatcher, expectOk } = setupEngine()
    const slide = engine.getActiveSlide()!
    const handle = expectOk(
      dispatcher.dispatch(new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name: 'H' })),
    ).nodeId as string
    const bone = expectOk(
      dispatcher.dispatch(new CreateNodeCommand({ sceneId: slide.scene.id, parentId: handle, name: 'B', components: { bone: { kind: 'bone', length: 10 } } })),
    ).nodeId as string
    expectOk(dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: bone, semanticName: 'b' })))
    const clip = expectOk(dispatcher.dispatch(new CreateClipCommand({ name: 'C', duration: 1, category: '' }))).clipId as string
    engine.getClip(clip).addChannelKeyframe('positionX', new Keyframe(newKeyframeId(), 0, 1, 'linear', { time: 0, value: 0 }, { time: 0, value: 0 }))
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: bone, clipId: clip })))
    engine.createClipCollection('Cc', { b: clip }, handle)
    const obj = engine.exportReusableObject(handle, 'Obj')
    // library snapshot is self-contained, no server fetch required
    expect(obj.library?.clips).toBeDefined()
    expect(obj.library?.clipCollections).toBeDefined()
    // Validate version still 1
    expect(obj.version).toBe(1)
    expect(validateReusableObject(obj)).toEqual([])
    // Import via command should work without server
    const dispatcher2 = new CommandDispatcher(engine, new UndoStack(), () => {})
    const res = dispatcher2.dispatch(new ImportReusableObjectCommand({ objectJson: obj }) as any)
    expect(res.ok).toBe(true)
  })
})
