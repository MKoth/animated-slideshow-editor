import { describe, expect, it } from 'vitest'
import { createEngineInternal } from '../../engine/internal'
import type { Engine } from '../../engine/internal'
import { CreateIKChainCommand, DeleteIKChainCommand } from '../../engine/commands'
import { EvaluatedWorldTransformSource } from '../../engine/worldTransform'

function createBoneNode(engine: Engine, name: string, parentId: string, x = 0, y = 0) {
  const slide = engine.project?.slides[0]
  if (!slide) throw new Error('No slide')
  return engine.createNode(slide.scene.id, parentId, name, {
    components: { bone: { kind: 'bone', length: 100 } },
    transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
  })
}

function setup(): Engine {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Test' })
  engine.createSlide('Slide 1')
  return engine
}

describe('Ghost node lifecycle for IK targets', () => {
  describe('creating an IK chain', () => {
    it('auto-creates a ghost scene node with no visual component', () => {
      const engine = setup()
      const slide = engine.project!.slides[0]

      const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
      const child = createBoneNode(engine, 'Child', root.id, 100, 0)

      engine.createIKChain(slide.id, [root.id, child.id], { position: { x: 200, y: 0 } })

      // Ghost node should be created
      const ghostNodeIds = engine.getGhostNodeIds()
      expect(ghostNodeIds).toHaveLength(1)
      const ghostNode = engine.getNode(ghostNodeIds[0])

      // Ghost node has no visual component
      expect(ghostNode.components.ghost).toEqual({ kind: 'ghost' })
      expect(ghostNode.components.assetInstance).toBeUndefined()
      expect(ghostNode.components.text).toBeUndefined()
      expect(ghostNode.components.bone).toBeUndefined()
      expect(ghostNode.components.mesh).toBeUndefined()

      // Ghost node is positioned at the initial target position
      expect(ghostNode.transform.x).toBe(200)
      expect(ghostNode.transform.y).toBe(0)
    })

    it('links the ghost node to the chain via chain.target.nodeId', () => {
      const engine = setup()
      const slide = engine.project!.slides[0]

      const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
      const child = createBoneNode(engine, 'Child', root.id, 100, 0)

      engine.createIKChain(slide.id, [root.id, child.id], { position: { x: 200, y: 0 } })

      const chains = engine.getIKChainsForSlide(slide.id)
      expect(chains).toHaveLength(1)
      const chain = chains[0]

      // Chain target should reference the ghost node
      expect(chain.target.nodeId).toBeTruthy()
      expect(chain.ghostNodeId).toBe(chain.target.nodeId)

      // The ghost node should exist
      const ghostNode = engine.getNode(chain.target.nodeId!)
      expect(ghostNode.components.ghost).toEqual({ kind: 'ghost' })
    })

    it('positions ghost node at the initial target position', () => {
      const engine = setup()
      const slide = engine.project!.slides[0]

      const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
      const child = createBoneNode(engine, 'Child', root.id, 100, 0)

      engine.createIKChain(slide.id, [root.id, child.id], { position: { x: 350, y: 120 } })

      const ghostNodeIds = engine.getGhostNodeIds()
      const ghostNode = engine.getNode(ghostNodeIds[0])
      expect(ghostNode.transform.x).toBe(350)
      expect(ghostNode.transform.y).toBe(120)
    })

    it('creates ghost node under the scene root', () => {
      const engine = setup()
      const slide = engine.project!.slides[0]
      const rootId = slide.scene.root.id

      const root = createBoneNode(engine, 'Root', rootId, 0, 0)
      const child = createBoneNode(engine, 'Child', root.id, 100, 0)

      engine.createIKChain(slide.id, [root.id, child.id], { position: { x: 200, y: 0 } })

      const ghostNodeIds = engine.getGhostNodeIds()
      const ghostNode = engine.getNode(ghostNodeIds[0])
      expect(ghostNode.parent?.id).toBe(rootId)
    })
  })

  describe('deleting an IK chain', () => {
    it('deletes the associated ghost node from the scene graph', () => {
      const engine = setup()
      const slide = engine.project!.slides[0]

      const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
      const child = createBoneNode(engine, 'Child', root.id, 100, 0)

      const chain = engine.createIKChain(slide.id, [root.id, child.id], {
        position: { x: 200, y: 0 },
      })

      expect(engine.getGhostNodeIds()).toHaveLength(1)

      engine.deleteIKChain(chain.id)

      // Ghost node should be deleted
      expect(engine.getGhostNodeIds()).toHaveLength(0)
      // Chain should also be deleted
      expect(engine.getIKChainsForSlide(slide.id)).toHaveLength(0)
    })
  })

  describe('command-level ghost node lifecycle', () => {
    it('CreateIKChainCommand creates ghost node and links it', () => {
      const engine = setup()
      const slide = engine.project!.slides[0]

      const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
      const child = createBoneNode(engine, 'Child', root.id, 100, 0)

      const cmd = new CreateIKChainCommand({
        slideId: slide.id,
        boneIds: [root.id, child.id],
        target: { position: { x: 200, y: 0 } },
      })

      const result = cmd.execute(engine)
      expect(result.chainId).toBeTruthy()

      const chain = engine.getIKChain(result.chainId)
      expect(chain.target.nodeId).toBeTruthy()
      expect(chain.ghostNodeId).toBeTruthy()

      const ghostNode = engine.getNode(chain.target.nodeId!)
      expect(ghostNode.components.ghost).toEqual({ kind: 'ghost' })
      expect(ghostNode.transform.x).toBe(200)
      expect(ghostNode.transform.y).toBe(0)
    })

    it('DeleteIKChainCommand deletes ghost node and returns inverse data', () => {
      const engine = setup()
      const slide = engine.project!.slides[0]

      const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
      const child = createBoneNode(engine, 'Child', root.id, 100, 0)

      const createResult = new CreateIKChainCommand({
        slideId: slide.id,
        boneIds: [root.id, child.id],
        target: { position: { x: 200, y: 0 } },
      }).execute(engine)

      expect(engine.getGhostNodeIds()).toHaveLength(1)

      const deleteCmd = new DeleteIKChainCommand({ chainId: createResult.chainId })
      const deleteInverse = deleteCmd.execute(engine)

      // Ghost node should be deleted
      expect(engine.getGhostNodeIds()).toHaveLength(0)

      // Inverse should contain ghost node data
      expect(deleteInverse.ghostNode).toBeTruthy()
      expect(deleteInverse.ghostNode!.components.ghost).toEqual({ kind: 'ghost' })
      expect(deleteInverse.chain.target.nodeId).toBeTruthy()
    })
  })

  describe('undo/redo', () => {
    it('undo of chain deletion restores the ghost node', () => {
      const engine = setup()
      const slide = engine.project!.slides[0]

      const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
      const child = createBoneNode(engine, 'Child', root.id, 100, 0)

      const createResult = new CreateIKChainCommand({
        slideId: slide.id,
        boneIds: [root.id, child.id],
        target: { position: { x: 200, y: 0 } },
      }).execute(engine)

      const deleteInverse = new DeleteIKChainCommand({
        chainId: createResult.chainId,
      }).execute(engine)

      expect(engine.getGhostNodeIds()).toHaveLength(0)

      // Simulate undo: replay the inverse
      // engine.createIKChain() already creates the ghost node, so we just call it
      engine.createIKChain(
        slide.id,
        deleteInverse.chain.boneIds,
        deleteInverse.chain.target,
        deleteInverse.chain.poleTarget,
      )

      // Verify restoration
      expect(engine.getGhostNodeIds()).toHaveLength(1)
      expect(engine.getIKChainsForSlide(slide.id)).toHaveLength(1)
      const restoredChain = engine.getIKChainsForSlide(slide.id)[0]
      expect(restoredChain.target.nodeId).toBeTruthy()
      expect(engine.getNode(restoredChain.target.nodeId!).components.ghost).toEqual({
        kind: 'ghost',
      })
    })

    it('undo of chain deletion restores ghost node at the correct position', () => {
      const engine = setup()
      const slide = engine.project!.slides[0]

      const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
      const child = createBoneNode(engine, 'Child', root.id, 100, 0)

      const createResult = new CreateIKChainCommand({
        slideId: slide.id,
        boneIds: [root.id, child.id],
        target: { position: { x: 400, y: 250 } },
      }).execute(engine)

      const deleteInverse = new DeleteIKChainCommand({
        chainId: createResult.chainId,
      }).execute(engine)

      // Simulate undo: engine.createIKChain creates ghost node automatically
      engine.createIKChain(
        slide.id,
        deleteInverse.chain.boneIds,
        deleteInverse.chain.target,
        deleteInverse.chain.poleTarget,
      )

      const ghostNode = engine.getNode(engine.getGhostNodeIds()[0])
      expect(ghostNode.transform.x).toBe(400)
      expect(ghostNode.transform.y).toBe(250)
    })
  })

  describe('ghost node is invisible to UI', () => {
    it('ghost node is filtered from visible children', () => {
      const engine = setup()
      const slide = engine.project!.slides[0]

      const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
      createBoneNode(engine, 'Child', root.id, 100, 0)

      engine.createGhostNode(slide.scene.id, 'IK Target', 200, 0)

      const visibleChildren = slide.scene.root.children.filter(
        (c) => !c.components.camera && !c.components.ghost,
      )
      expect(visibleChildren).toHaveLength(1)
      expect(visibleChildren[0].id).toBe(root.id)
    })

    it('ghost node has ghost component marker', () => {
      const engine = setup()
      const slide = engine.project!.slides[0]

      const ghost = engine.createGhostNode(slide.scene.id, 'IK Target', 200, 0)
      expect(ghost.components.ghost).toEqual({ kind: 'ghost' })
    })
  })

  describe('serialization', () => {
    it('serializes ghost node ID in IK chain JSON', () => {
      const engine = setup()
      const slide = engine.project!.slides[0]

      const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
      const child = createBoneNode(engine, 'Child', root.id, 100, 0)

      engine.createIKChain(slide.id, [root.id, child.id], { position: { x: 200, y: 0 } })

      const chain = engine.getIKChainsForSlide(slide.id)[0]
      const json = chain.toJSON()
      expect(json.ghostNodeId).toBeTruthy()
      expect(json.slideId).toBe(slide.id)
    })

    it('ghost node serializes with ghost component', () => {
      const engine = setup()
      const slide = engine.project!.slides[0]

      const ghost = engine.createGhostNode(slide.scene.id, 'IK Target', 200, 0)
      const json = ghost.toJSON()
      expect(json.components.ghost).toEqual({ kind: 'ghost' })
    })
  })

  describe('IK solver uses ghost node position', () => {
    it('worldTransform.ts resolves target from ghost node when nodeId is set', () => {
      const engine = setup()
      const slide = engine.project!.slides[0]

      const root = createBoneNode(engine, 'Root', slide.scene.root.id, 0, 0)
      const child = createBoneNode(engine, 'Child', root.id, 100, 0)

      engine.createIKChain(slide.id, [root.id, child.id], { position: { x: 200, y: 0 } })

      const chain = engine.getIKChainsForSlide(slide.id)[0]
      expect(chain.target.nodeId).toBeTruthy()

      // The IK solver should resolve the target from the ghost node
      const source = new EvaluatedWorldTransformSource(
        engine,
        () => 0,
        new Map(),
        engine.getIKManager(),
      )

      // Update IK overrides - exercises the worldTransform.ts:110 code path
      source.updateIKOverrides(slide.id, 0)

      const overrides = source.getIKOverrides()
      expect(overrides.size).toBeGreaterThan(0)
    })
  })
})
