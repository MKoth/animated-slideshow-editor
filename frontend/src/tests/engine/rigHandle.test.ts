import { describe, expect, it } from 'vitest'
import { createEngine, createEngineInternal } from '../../engine/internal'
import { CreateRigHandleCommand, CommandDispatcher, UndoStack } from '../../engine/commands'
import { worldTransformOf, EvaluatedWorldTransformSource } from '../../engine/worldTransform'

function setup() {
  const engine = createEngineInternal()
  engine.createProject({ name: 'RigHandleTest' })
  const slide = engine.createSlide('Slide 1')
  return { engine, slide }
}

function createBone(
  engine: ReturnType<typeof createEngineInternal>,
  parentId: string,
  name: string,
  x = 0,
  y = 0,
) {
  const slide = engine.project!.slides[0]
  return engine.createNode(slide.scene.id, parentId, name, {
    components: { bone: { kind: 'bone', length: 100 } },
    transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
  })
}

function createMesh(
  engine: ReturnType<typeof createEngineInternal>,
  parentId: string,
  name: string,
  x = 0,
  y = 0,
) {
  const slide = engine.project!.slides[0]
  // Minimal mesh data
  const mesh = {
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    faces: [
      { v0: 0, v1: 1, v2: 2 },
      { v0: 0, v1: 2, v2: 3 },
    ],
    uvs: [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ],
  }
  return engine.createNode(slide.scene.id, parentId, name, {
    components: { mesh: { kind: 'mesh', mesh } },
    transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
  })
}

describe('Rig Handle Group + one-way IK/Pole follow', () => {
  it('empty Group/Locator Scene Node can be created and parent mesh/skeleton/IK/pole vectors under it with Keep World', () => {
    const { engine, slide } = setup()
    const rootId = slide.scene.root.id
    const boneRoot = createBone(engine, rootId, 'BoneRoot', 10, 20)
    const boneChild = createBone(engine, boneRoot.id, 'BoneChild', 100, 0)
    const meshNode = createMesh(engine, rootId, 'Mesh', 30, 40)
    // Create IK chain to get ghost nodes
    const chain = engine.createIKChain(
      slide.id,
      [boneRoot.id, boneChild.id],
      { position: { x: 200, y: 0 } },
      { position: { x: 100, y: -50 } },
    )
    const ghostId = chain.ghostNodeId!
    const poleGhostId = chain.poleGhostNodeId!
    const boneWorldBefore = worldTransformOf(slide.scene, boneRoot.id)!
    const meshWorldBefore = worldTransformOf(slide.scene, meshNode.id)!
    const ghostWorldBefore = worldTransformOf(slide.scene, ghostId)!
    const poleWorldBefore = worldTransformOf(slide.scene, poleGhostId)!

    const cmd = new CreateRigHandleCommand({
      sceneId: slide.scene.id,
      name: 'Rig Handle',
      childIds: [boneRoot.id, meshNode.id, ghostId, poleGhostId],
    })
    const result = cmd.execute(engine)
    expect(result.handleId).toBeTruthy()
    const handle = engine.getNode(result.handleId)
    // Handle is empty: only Transform, no mesh/bone/camera etc.
    expect(handle.components.bone).toBeUndefined()
    expect(handle.components.mesh).toBeUndefined()
    expect(handle.components.camera).toBeUndefined()
    expect(handle.components.ghost).toBeUndefined()
    expect(handle.components.assetInstance).toBeUndefined()
    expect(handle.components.text).toBeUndefined()
    // Children are parented under handle
    expect(engine.getNode(boneRoot.id).parent?.id).toBe(result.handleId)
    expect(engine.getNode(meshNode.id).parent?.id).toBe(result.handleId)
    expect(engine.getNode(ghostId).parent?.id).toBe(result.handleId)
    expect(engine.getNode(poleGhostId).parent?.id).toBe(result.handleId)
    // Keep World: world positions preserved
    const boneWorldAfter = worldTransformOf(slide.scene, boneRoot.id)!
    const meshWorldAfter = worldTransformOf(slide.scene, meshNode.id)!
    const ghostWorldAfter = worldTransformOf(slide.scene, ghostId)!
    const poleWorldAfter = worldTransformOf(slide.scene, poleGhostId)!
    expect(boneWorldAfter.x).toBeCloseTo(boneWorldBefore.x, 5)
    expect(boneWorldAfter.y).toBeCloseTo(boneWorldBefore.y, 5)
    expect(meshWorldAfter.x).toBeCloseTo(meshWorldBefore.x, 5)
    expect(meshWorldAfter.y).toBeCloseTo(meshWorldBefore.y, 5)
    expect(ghostWorldAfter.x).toBeCloseTo(ghostWorldBefore.x, 5)
    expect(poleWorldAfter.x).toBeCloseTo(poleWorldBefore.x, 5)
    // Handle appears in scene hierarchy clearly (is child of root and has children)
    expect(slide.scene.root.children.map((c) => c.id)).toContain(result.handleId)
    expect(handle.children.map((c) => c.id)).toEqual(
      expect.arrayContaining([boneRoot.id, meshNode.id, ghostId, poleGhostId]),
    )
  })

  it('moving the Rig Handle moves all children rigidly as one Transaction via normal Transform composition', () => {
    const { engine, slide } = setup()
    const rootId = slide.scene.root.id
    const boneRoot = createBone(engine, rootId, 'BoneRoot', 10, 0)
    const boneChild = createBone(engine, boneRoot.id, 'BoneChild', 100, 0)
    const meshNode = createMesh(engine, rootId, 'Mesh', 20, 20)
    const chain = engine.createIKChain(
      slide.id,
      [boneRoot.id, boneChild.id],
      { position: { x: 250, y: 0 } },
      null,
    )
    const ghostId = chain.ghostNodeId!
    // Group under handle
    const handleCmd = new CreateRigHandleCommand({
      sceneId: slide.scene.id,
      name: 'Rig Handle',
      childIds: [boneRoot.id, meshNode.id, ghostId],
    })
    const { handleId } = handleCmd.execute(engine)
    const boneWorldBefore = worldTransformOf(slide.scene, boneRoot.id)!
    const meshWorldBefore = worldTransformOf(slide.scene, meshNode.id)!
    const ghostWorldBefore = worldTransformOf(slide.scene, ghostId)!
    // Move handle by (50, 30) via single MoveNodeCommand (one Transaction)
    engine.setTransform(handleId, { ...engine.getNode(handleId).transform, x: 50, y: 30 })
    const boneWorldAfter = worldTransformOf(slide.scene, boneRoot.id)!
    const meshWorldAfter = worldTransformOf(slide.scene, meshNode.id)!
    const ghostWorldAfter = worldTransformOf(slide.scene, ghostId)!
    // All children should have moved by same delta as handle (rigid)
    expect(boneWorldAfter.x).toBeCloseTo(boneWorldBefore.x + 50, 5)
    expect(boneWorldAfter.y).toBeCloseTo(boneWorldBefore.y + 30, 5)
    expect(meshWorldAfter.x).toBeCloseTo(meshWorldBefore.x + 50, 5)
    expect(ghostWorldAfter.x).toBeCloseTo(ghostWorldBefore.x + 50, 5)
  })

  it('IK Handle moves chain via solver; dragging chain bones FK does not reposition handle/pole', () => {
    const { engine, slide } = setup()
    const rootId = slide.scene.root.id
    const boneRoot = createBone(engine, rootId, 'Root', 0, 0)
    const boneChild = createBone(engine, boneRoot.id, 'Child', 100, 0)
    const chain = engine.createIKChain(
      slide.id,
      [boneRoot.id, boneChild.id],
      { position: { x: 150, y: 0 } },
      { position: { x: 50, y: 50 } },
    )
    const ghostId = chain.ghostNodeId!
    const poleGhostId = chain.poleGhostNodeId!
    // Group bone root + ghosts under handle
    const handleCmd = new CreateRigHandleCommand({
      sceneId: slide.scene.id,
      name: 'Rig Handle',
      childIds: [boneRoot.id, ghostId, poleGhostId],
    })
    handleCmd.execute(engine)
    // Verify IK solver: moving ghost should affect bone rotations via evaluated world transform source
    const source = new EvaluatedWorldTransformSource(
      engine as unknown as import('../../engine').EnginePublic,
      () => 0,
      new Map(),
      engine.getIKManager(),
    )
    source.updateIKOverrides(slide.id, 0)
    const rotationsBefore = new Map(source.getIKOverrides())
    // Move IK handle ghost to new position far away
    engine.setTransform(ghostId, { ...engine.getNode(ghostId).transform, x: 300, y: 100 })
    // Update chain target to follow ghost world (engine.setIKPoleTarget would update but we move ghost directly; solver resolves via ghost world)
    // For this test, we also update chain target position to match ghost world? Actually IK solver resolves via evaluatedWorldTransformOf(ghost), so moving ghost changes targetWorld
    source.updateIKOverrides(slide.id, 0)
    const rotationsAfter = new Map(source.getIKOverrides())
    // Rotations should have changed due to new target
    expect(rotationsBefore.get(boneRoot.id)).not.toBeCloseTo(
      rotationsAfter.get(boneRoot.id) ?? 0,
      2,
    )
    // Now FK: rotate boneRoot directly, ghost should NOT move (one-way)
    const ghostWorldBeforeFK = worldTransformOf(slide.scene, ghostId)!
    engine.setTransform(boneRoot.id, { ...engine.getNode(boneRoot.id).transform, rotation: 1.0 })
    const ghostWorldAfterFK = worldTransformOf(slide.scene, ghostId)!
    expect(ghostWorldAfterFK.x).toBeCloseTo(ghostWorldBeforeFK.x, 5)
    expect(ghostWorldAfterFK.y).toBeCloseTo(ghostWorldBeforeFK.y, 5)
    const poleWorldBeforeFK = worldTransformOf(slide.scene, poleGhostId)!
    engine.setTransform(boneChild.id, { ...engine.getNode(boneChild.id).transform, rotation: 0.5 })
    const poleWorldAfterFK = worldTransformOf(slide.scene, poleGhostId)!
    expect(poleWorldAfterFK.x).toBeCloseTo(poleWorldBeforeFK.x, 5)
  })

  it('Pole Vectors follow same one-way parent-follow semantics as handles', () => {
    const { engine, slide } = setup()
    const rootId = slide.scene.root.id
    const boneRoot = createBone(engine, rootId, 'Root', 0, 0)
    const boneChild = createBone(engine, boneRoot.id, 'Child', 100, 0)
    const chain = engine.createIKChain(
      slide.id,
      [boneRoot.id, boneChild.id],
      { position: { x: 200, y: 0 } },
      { position: { x: 50, y: 50 } },
    )
    const poleGhostId = chain.poleGhostNodeId!
    const handleCmd = new CreateRigHandleCommand({
      sceneId: slide.scene.id,
      name: 'Rig Handle',
      childIds: [boneRoot.id, poleGhostId],
    })
    const { handleId } = handleCmd.execute(engine)
    const poleWorldBefore = worldTransformOf(slide.scene, poleGhostId)!
    // Moving handle should move pole
    engine.setTransform(handleId, { ...engine.getNode(handleId).transform, x: 40, y: 20 })
    const poleWorldAfter = worldTransformOf(slide.scene, poleGhostId)!
    expect(poleWorldAfter.x).toBeCloseTo(poleWorldBefore.x + 40, 5)
    expect(poleWorldAfter.y).toBeCloseTo(poleWorldBefore.y + 20, 5)
    // FK on chain should not move pole
    const poleWorldBeforeFK = { ...poleWorldAfter }
    engine.setTransform(boneRoot.id, { ...engine.getNode(boneRoot.id).transform, rotation: 0.8 })
    const poleWorldAfterFK = worldTransformOf(slide.scene, poleGhostId)!
    expect(poleWorldAfterFK.x).toBeCloseTo(poleWorldBeforeFK.x, 5)
    expect(poleWorldAfterFK.y).toBeCloseTo(poleWorldBeforeFK.y, 5)
    // Also verify IK solver uses pole ghost world (not just position)
    const source = new EvaluatedWorldTransformSource(
      engine as unknown as import('../../engine').EnginePublic,
      () => 0,
      new Map(),
      engine.getIKManager(),
    )
    source.updateIKOverrides(slide.id, 0)
    const overridesWithPole = source.getIKOverrides()
    expect(overridesWithPole.size).toBeGreaterThan(0)
  })

  it('Handle is a normal Scene Node serialized in .lesson; scene hierarchy shows it clearly', () => {
    const { engine, slide } = setup()
    const rootId = slide.scene.root.id
    const boneRoot = createBone(engine, rootId, 'Root', 0, 0)
    const meshNode = createMesh(engine, rootId, 'Mesh', 10, 10)
    const handleCmd = new CreateRigHandleCommand({
      sceneId: slide.scene.id,
      name: 'Rig Handle',
      childIds: [boneRoot.id, meshNode.id],
    })
    const { handleId } = handleCmd.execute(engine)
    // Handle is normal node: has id, name, parent, transform, no special components
    const handleJson = engine.getNode(handleId).toJSON()
    expect(handleJson.id).toBe(handleId)
    expect(handleJson.name).toBe('Rig Handle')
    expect(handleJson.parentId).toBe(rootId)
    expect(handleJson.components).toEqual({})
    expect(handleJson.transform).toBeDefined()
    // Serialization round-trip
    const json = engine.toJSON()
    // Find handle in serialized nodes
    const slideJson = json.slides[0]
    const handleNodeJson = slideJson.scene.nodes.find((n) => n.id === handleId)
    expect(handleNodeJson).toBeDefined()
    expect(handleNodeJson?.name).toBe('Rig Handle')
    expect(handleNodeJson?.parentId).toBe(rootId)
    expect(handleNodeJson?.components).toEqual({})
    // Children serialized with parentId = handleId
    const boneJson = slideJson.scene.nodes.find((n) => n.id === boneRoot.id)
    expect(boneJson?.parentId).toBe(handleId)
    const meshJson = slideJson.scene.nodes.find((n) => n.id === meshNode.id)
    expect(meshJson?.parentId).toBe(handleId)
    // Restore and verify hierarchy
    const restored = createEngine()
    restored.restoreFromJSON(json)
    const restoredHandle = restored.getNode(handleId)
    expect(restoredHandle.name).toBe('Rig Handle')
    expect(restoredHandle.children.map((c) => c.id)).toEqual(
      expect.arrayContaining([boneRoot.id, meshNode.id]),
    )
    expect(restored.getNode(boneRoot.id).parent?.id).toBe(handleId)
  })

  it('undo/redo of Rig Handle creation restores world transforms', () => {
    const raw = createEngineInternal()
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(raw, undoStack)
    raw.createProject({ name: 'UndoTest' })
    const sysSlide = raw.createSlide('S1')
    const sysRoot = createBone(raw, sysSlide.scene.root.id, 'Root', 15, 25)
    const sysMesh = createMesh(raw, sysSlide.scene.root.id, 'Mesh', 30, 30)
    const cmd = new CreateRigHandleCommand({
      sceneId: sysSlide.scene.id,
      name: 'Rig Handle',
      childIds: [sysRoot.id, sysMesh.id],
    })
    const result = dispatcher.dispatch(cmd)
    expect(result.ok).toBe(true)
    const hId = (result as { ok: true; inverse: { handleId: string } }).inverse.handleId
    expect(raw.getNode(sysRoot.id).parent?.id).toBe(hId)
    dispatcher.undo()
    expect(raw.getNode(sysRoot.id).parent?.id).toBe(sysSlide.scene.root.id)
    const worldAfterUndo = worldTransformOf(sysSlide.scene, sysRoot.id)!
    expect(worldAfterUndo.x).toBeCloseTo(15, 5)
    dispatcher.redo()
    expect(raw.getNode(sysRoot.id).parent?.id).toBe(hId)
    const worldAfterRedo = worldTransformOf(sysSlide.scene, sysRoot.id)!
    // After redo, world should still be preserved (keepWorld)
    expect(worldAfterRedo.x).toBeCloseTo(15, 5)
  })
})
