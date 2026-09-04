import { describe, it, expect } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import {
  CommandDispatcher,
  UndoStack,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateNodeCommand,
  CreateClipCommand,
  AssignClipCommand,
  SetSemanticNameCommand,
} from '../../engine/commands'
import { ExportClipCollectionCommand } from '../../engine/commands'
import { validateReusableObject } from '../../engine/reusableObject'
import { walkPreOrder } from '../../engine/sceneNode'

function setupEngine(): {
  engine: Engine
  dispatcher: import('../../engine/commands').CommandDispatcher
  undoStack: import('../../engine/commands').UndoStack
} {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
  const res = dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  if (!res.ok) throw new Error('create project failed')
  const slideRes = dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
  if (!slideRes.ok) throw new Error('create slide failed')
  return { engine, dispatcher, undoStack }
}

function expectOk<T>(result: { ok: boolean; inverse?: T; error?: Error }): T {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error?.message}`)
  return result.inverse as T
}

describe('ReusableObject export/import', () => {
  it('defines .lesson_object format and validates (mirrors library)', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    // Create a simple rig: handle + bone + mesh + circle with materials and semanticNames
    const handle = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'RigHandle',
        }),
      ),
    ).nodeId
    const bone = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: handle,
          name: 'BoneA',
          components: { bone: { kind: 'bone', length: 80 } },
        }),
      ),
    ).nodeId
    expectOk(dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: bone, semanticName: 'arm' })))
    const mesh = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: handle,
          name: 'MeshNode',
          components: {
            mesh: {
              kind: 'mesh',
              mesh: {
                vertices: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                  { x: 10, y: 10 },
                ],
                faces: [{ v0: 0, v1: 1, v2: 2 }],
                uvs: [
                  { u: 0, v: 0 },
                  { u: 1, v: 0 },
                  { u: 1, v: 1 },
                ],
              },
            },
          },
        }),
      ),
    ).nodeId
    expectOk(
      dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: mesh, semanticName: 'mesh_part' })),
    )
    const circle = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: handle,
          name: 'CircleNode',
          components: { circle: { kind: 'circle', radius: 20, startAngle: 0, endAngle: 180 } },
        }),
      ),
    ).nodeId
    expectOk(
      dispatcher.dispatch(
        new SetSemanticNameCommand({ nodeId: circle, semanticName: 'circle_part' }),
      ),
    )

    // Create clips and assign
    const clip1 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'Wave', duration: 1, category: '' })),
    ).clipId
    const clip2 = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'Spin', duration: 1, category: '' })),
    ).clipId
    // Add channel keyframes to clips for meaningful animation
    engine.addClipChannelKeyframe(clip1, 'positionX', 0, 0)
    engine.addClipChannelKeyframe(clip1, 'positionX', 1, 10)
    engine.addClipChannelKeyframe(clip2, 'rotation', 0, 0)
    engine.addClipChannelKeyframe(clip2, 'rotation', 1, 90)
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: bone, clipId: clip1 })))
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: mesh, clipId: clip1 })))
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: circle, clipId: clip2 })))

    // Material: assign non-default material and snapshot
    const matId = 'mat-test-1'
    engine.registerMaterialDefinition(matId, 'TestMat')
    engine.assignMaterial(bone, matId)
    // Embed snapshot so export includes it
    engine.embedMaterial({
      id: matId,
      name: 'TestMat',
      description: '',
      tags: [],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      parameters: [],
      shaderId: null,
    })

    // Asset: embed a fake asset
    const assetId = 'asset-test-1'
    engine.embedAsset({
      id: assetId,
      name: 'Fake',
      data: 'QUJD',
      mimeType: 'image/png',
      metadata: { width: 10, height: 10 },
    })
    // Attach asset instance to mesh? Simulate via component
    // For simplicity assign asset instance component to mesh node via direct node mutation (since no command for assetInstance change beyond create)
    // We'll manually set component
    const meshNode = engine.getNode(mesh)
    ;(meshNode as unknown as { components: Record<string, unknown> }).components = Object.freeze({
      ...(meshNode.components as object),
      assetInstance: { kind: 'assetInstance', assetDefinitionId: assetId },
    } as unknown as import('../../engine/components').NodeComponents)

    // Create clip collection via hierarchical export
    const col = expectOk(
      dispatcher.dispatch(
        new ExportClipCollectionCommand({ parentNodeId: handle, name: 'RigAnim' }),
      ),
    )
    expect(col.collectionId).toBeDefined()

    // Export reusable object
    const obj = engine.exportReusableObject(handle, 'MyRig', 'Test rig')
    expect(obj.version).toBe(1)
    expect(obj.name).toBe('MyRig')
    expect(obj.rootId).toBe(handle)
    expect(obj.nodes.length).toBeGreaterThanOrEqual(4) // handle + 3 children
    // Ensure semanticNames preserved
    const boneJson = obj.nodes.find((n) => n.name === 'BoneA')
    expect(boneJson?.semanticName).toBe('arm')
    // Ensure IK/pole handling: no IK here, but ensure nodes include at least handle
    // Library mirrors .lesson shape: should contain assets, materials, clips, clipCollections
    expect(obj.library).toBeDefined()
    expect(obj.library?.assets?.some((a) => a.id === assetId)).toBe(true)
    expect(obj.library?.materials?.some((m) => m.id === matId)).toBe(true)
    expect(obj.library?.clips?.length).toBeGreaterThanOrEqual(2)
    expect(obj.library?.clipCollections?.length).toBe(1)
    // Clip instances preserved
    const exportedBone = obj.nodes.find((n) => n.semanticName === 'arm')
    expect(exportedBone?.clipInstances?.some((ci) => ci.clipId === clip1)).toBe(true)

    // Validate format
    const errors = validateReusableObject(obj)
    expect(errors).toEqual([])

    // Ensure .lesson_object JSON stringifies and parses
    const text = JSON.stringify(obj)
    const parsed = JSON.parse(text)
    expect(validateReusableObject(parsed)).toEqual([])
  })

  it('export modal auxiliary nodes: includes IK handle/pole ghosts', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const handle = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'RigHandle',
        }),
      ),
    ).nodeId
    const boneA = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: handle,
          name: 'BoneA',
          components: { bone: { kind: 'bone', length: 80 } },
        }),
      ),
    ).nodeId
    const boneB = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: boneA,
          name: 'BoneB',
          components: { bone: { kind: 'bone', length: 80 } },
        }),
      ),
    ).nodeId
    // Create IK chain: this will create ghost nodes under handle
    const chain = engine.createIKChain(
      slide.id,
      [boneA, boneB],
      { position: { x: 100, y: 0 } },
      { position: { x: 0, y: 50 } },
    )
    expect(chain.ghostNodeId).toBeTruthy()
    expect(chain.poleGhostNodeId).toBeTruthy()
    const ghostId = chain.ghostNodeId!
    const poleId = chain.poleGhostNodeId!
    // Export only boneA subtree (should include ghosts as auxiliary)
    const obj = engine.exportReusableObject(boneA, 'BoneAObj')
    // Even though export root is boneA, its chain's ghosts live under handle (outside subtree) but should be included
    const ids = new Set(obj.nodes.map((n) => n.id))
    expect(ids.has(ghostId)).toBe(true)
    expect(ids.has(poleId)).toBe(true)
    // Also ensure ikChains includes the chain with remapped boneIds
    expect(obj.ikChains?.chains.length).toBe(1)
    expect(obj.ikChains?.chains[0]?.boneIds).toContain(boneA)
  })

  it('import creates new ids, snaps definitions, preserves clip bindings and semanticNames', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    const handle = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'RigHandle',
        }),
      ),
    ).nodeId
    const bone = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: handle,
          name: 'Bone',
          components: { bone: { kind: 'bone', length: 80 } },
        }),
      ),
    ).nodeId
    expectOk(dispatcher.dispatch(new SetSemanticNameCommand({ nodeId: bone, semanticName: 'arm' })))
    const clip = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'Wave', duration: 1, category: '' })),
    ).clipId
    engine.addClipChannelKeyframe(clip, 'positionX', 0, 0)
    engine.addClipChannelKeyframe(clip, 'positionX', 1, 10)
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: bone, clipId: clip })))
    const col = expectOk(
      dispatcher.dispatch(new ExportClipCollectionCommand({ parentNodeId: handle, name: 'Anim' })),
    ).collectionId

    // Embed asset for snap
    const assetId = 'asset-snap-1'
    engine.embedAsset({ id: assetId, name: 'Snap', data: 'QUJD', mimeType: 'image/png' })
    const meshNodeId = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: handle,
          name: 'MeshPart',
          components: {
            mesh: {
              kind: 'mesh',
              mesh: {
                vertices: [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                  { x: 10, y: 10 },
                ],
                faces: [{ v0: 0, v1: 1, v2: 2 }],
                uvs: [
                  { u: 0, v: 0 },
                  { u: 1, v: 0 },
                  { u: 1, v: 1 },
                ],
              },
            },
          },
        }),
      ),
    ).nodeId
    const meshNode = engine.getNode(meshNodeId)
    ;(meshNode as unknown as { components: Record<string, unknown> }).components = Object.freeze({
      ...(meshNode.components as object),
      assetInstance: { kind: 'assetInstance', assetDefinitionId: assetId },
    } as unknown as import('../../engine/components').NodeComponents)
    engine.assignMaterial(meshNodeId, '0d3f4464-8300-5b6d-ae14-45246fefbeae') // default
    // Ensure handle has material snapshot? not needed

    const obj = engine.exportReusableObject(handle, 'ExportedRig')

    // Import into new project (new engine)
    const engine2 = createEngine()
    const undoStack2 = new UndoStack()
    const disp2 = new CommandDispatcher(engine2, undoStack2, () => {})
    expectOk(disp2.dispatch(new CreateProjectCommand({ name: 'P2' })))
    expectOk(disp2.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const activeSlide2 = engine2.getActiveSlide()!
    const beforeIds_unused = new Set([...walkPreOrder(activeSlide2.scene.root)].map((n) => n.id))
    void beforeIds_unused
    const beforeClipIds_unused = new Set(engine2.clips.map((c) => c.id))
    void beforeClipIds_unused

    const result = engine2.importReusableObject(obj)
    expect(result.nodeIdMap.size).toBe(obj.nodes.length)
    // New ids differ from old
    for (const [oldId, newId] of result.nodeIdMap) {
      expect(oldId).not.toBe(newId)
    }
    for (const [oldClipId, newClipId] of result.clipIdMap) {
      expect(oldClipId).not.toBe(newClipId)
      // old clip should not be in new engine with old id
      expect(() => engine2.getClip(oldClipId)).toThrow()
      expect(engine2.getClip(newClipId)).toBeDefined()
    }
    // Snap definitions: asset should be embedded
    expect(engine2.getEmbeddedAsset(assetId)).toBeDefined()
    // Imported nodes exist in new project and have semanticNames preserved
    const importedBoneId = result.nodeIdMap.get(bone)!
    const importedBone = engine2.getNode(importedBoneId)
    expect(importedBone.semanticName).toBe('arm')
    expect(importedBone.name).toBe('Bone')
    // Clip bindings preserved: imported bone's clipInstances should point to new clip id
    expect(importedBone.clipInstances.length).toBe(1)
    const newClipId = result.clipIdMap.get(clip)!
    expect(importedBone.clipInstances[0]!.clipId).toBe(newClipId)
    // ClipCollections preserved and remapped
    const importedColId = result.collectionIdMap.get(col)!
    const importedCol = engine2.getClipCollection(importedColId)
    expect(importedCol.getBinding('arm')).toBe(newClipId)
    expect(importedCol.sourceNodeId).toBe(result.nodeIdMap.get(handle)!)

    // Ensure nodes are under active slide root
    const importedRootId = result.rootNewId
    const importedRoot = engine2.getNode(importedRootId)
    expect(importedRoot.parent?.id).toBe(activeSlide2.scene.root.id)
  })

  it('end-to-end: export rig with clips → import into new project → apply ClipCollection → animates identically', () => {
    const { engine, dispatcher } = setupEngine()
    const slide = engine.getActiveSlide()!
    // Source rig
    const rigHandle = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name: 'RigHandle',
        }),
      ),
    ).nodeId
    const boneLeft = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: rigHandle,
          name: 'LeftArm',
          components: { bone: { kind: 'bone', length: 80 } },
        }),
      ),
    ).nodeId
    expectOk(
      dispatcher.dispatch(
        new SetSemanticNameCommand({ nodeId: boneLeft, semanticName: 'left_arm' }),
      ),
    )
    const boneRight = expectOk(
      dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: rigHandle,
          name: 'RightArm',
          components: { bone: { kind: 'bone', length: 80 } },
        }),
      ),
    ).nodeId
    expectOk(
      dispatcher.dispatch(
        new SetSemanticNameCommand({ nodeId: boneRight, semanticName: 'right_arm' }),
      ),
    )

    // Create two clips with distinct channels
    const clipA = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'Raise', duration: 1, category: '' })),
    ).clipId
    engine.addClipChannelKeyframe(clipA, 'positionX', 0, 0)
    engine.addClipChannelKeyframe(clipA, 'positionX', 1, 100)
    engine.addClipChannelKeyframe(clipA, 'positionY', 0, 0)
    engine.addClipChannelKeyframe(clipA, 'positionY', 1, 50)

    const clipB = expectOk(
      dispatcher.dispatch(new CreateClipCommand({ name: 'Lower', duration: 1, category: '' })),
    ).clipId
    engine.addClipChannelKeyframe(clipB, 'positionX', 0, 10)
    engine.addClipChannelKeyframe(clipB, 'positionX', 1, -10)

    // Assign clips to bones
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: boneLeft, clipId: clipA })))
    expectOk(dispatcher.dispatch(new AssignClipCommand({ nodeId: boneRight, clipId: clipB })))

    // Export collection for rig
    const colId = expectOk(
      dispatcher.dispatch(
        new ExportClipCollectionCommand({ parentNodeId: rigHandle, name: 'ArmMotion' }),
      ),
    ).collectionId
    // Export reusable object (includes collection and clips)
    const obj = engine.exportReusableObject(rigHandle, 'ArmRig')
    expect(obj.library?.clipCollections?.length).toBe(1)
    expect(obj.library?.clips?.length).toBe(2)

    // New project engine2
    const engine2 = createEngine()
    const undoStack2 = new UndoStack()
    const disp2 = new CommandDispatcher(engine2, undoStack2, () => {})
    expectOk(disp2.dispatch(new CreateProjectCommand({ name: 'P2' })))
    expectOk(disp2.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const importResult = engine2.importReusableObject(obj)
    const importedColId = importResult.collectionIdMap.get(colId)!
    // Verify imported clips animate same as original when evaluated via AnimationEvaluator? Use clip evaluation directly?
    // Instead, create fresh target rig in new project and apply collection
    const slide2 = engine2.getActiveSlide()!
    const targetHandle = expectOk(
      disp2.dispatch(
        new CreateNodeCommand({
          sceneId: slide2.scene.id,
          parentId: slide2.scene.root.id,
          name: 'TargetHandle',
        }),
      ),
    ).nodeId
    const targetLeft = expectOk(
      disp2.dispatch(
        new CreateNodeCommand({
          sceneId: slide2.scene.id,
          parentId: targetHandle,
          name: 'TgtLeft',
          components: { bone: { kind: 'bone', length: 80 } },
        }),
      ),
    ).nodeId
    expectOk(
      disp2.dispatch(new SetSemanticNameCommand({ nodeId: targetLeft, semanticName: 'left_arm' })),
    )
    const targetRight = expectOk(
      disp2.dispatch(
        new CreateNodeCommand({
          sceneId: slide2.scene.id,
          parentId: targetHandle,
          name: 'TgtRight',
          components: { bone: { kind: 'bone', length: 80 } },
        }),
      ),
    ).nodeId
    expectOk(
      disp2.dispatch(
        new SetSemanticNameCommand({ nodeId: targetRight, semanticName: 'right_arm' }),
      ),
    )

    // Apply imported collection to target
    const applied = engine2.applyClipCollection(importedColId, targetHandle)
    expect(applied.length).toBe(2) // both arms
    const leftInstance = engine2.getClipInstances(targetLeft)[0]!
    const rightInstance = engine2.getClipInstances(targetRight)[0]!
    const importedClipA = importResult.clipIdMap.get(clipA)!
    const importedClipB = importResult.clipIdMap.get(clipB)!
    expect(leftInstance.clipId).toBe(importedClipA)
    expect(rightInstance.clipId).toBe(importedClipB)

    // Verify imported clips have identical channel keyframes to originals
    const origClipA = engine.getClip(clipA)
    const importedClipAObj = engine2.getClip(importedClipA)
    expect(
      origClipA.getChannelKeyframes('positionX').map((k) => ({ t: k.time, v: k.value })),
    ).toEqual(
      importedClipAObj.getChannelKeyframes('positionX').map((k) => ({ t: k.time, v: k.value })),
    )
    expect(
      origClipA.getChannelKeyframes('positionY').map((k) => ({ t: k.time, v: k.value })),
    ).toEqual(
      importedClipAObj.getChannelKeyframes('positionY').map((k) => ({ t: k.time, v: k.value })),
    )
    const origClipB = engine.getClip(clipB)
    const importedClipBObj = engine2.getClip(importedClipB)
    expect(
      origClipB.getChannelKeyframes('positionX').map((k) => ({ t: k.time, v: k.value })),
    ).toEqual(
      importedClipBObj.getChannelKeyframes('positionX').map((k) => ({ t: k.time, v: k.value })),
    )
    // Also verify that applying collection produced same bindings semantic → same clip mapping
    const srcCol = engine.getClipCollection(colId)
    const importedCol = engine2.getClipCollection(importedColId)
    for (const [sem, clipId] of srcCol.bindings) {
      const expectedNew = importResult.clipIdMap.get(clipId)!
      expect(importedCol.getBinding(sem)).toBe(expectedNew)
    }
  })
})
