/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { describe, it, expect } from 'vitest'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  ReparentNodeCommand,
  PaintWeightCommand,
  MoveNodeCommand,
  createCommandSystem,
} from '../../engine/commands'
import { worldTransformOf } from '../../engine/worldTransform'
import type { MeshData } from '../../engine/mesh'

function expectOk(result) {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.message}`)
  return result.inverse
}

function createLineMesh(): MeshData {
  const vertices = Array.from({ length: 9 }, (_, i) => ({ x: i * 20, y: 0 }))
  const uvs = vertices.map((_, i) => ({ u: i / 8, v: 0 }))
  const faces = [
    { v0: 0, v1: 1, v2: 2 },
    { v0: 3, v1: 4, v2: 5 },
    { v0: 6, v1: 7, v2: 8 },
  ]
  return { vertices, faces, uvs }
}

function evalDeform(system, scene, meshId) {
  const bones = new Map()
  const walk = (n) => {
    if (n.components?.bone) {
      const wt = worldTransformOf(scene, n.id)
      if (wt) bones.set(n.id, wt)
    }
    for (const c of n.children) walk(c)
  }
  walk(scene.root)
  return system.engine.evaluateMeshDeformation(meshId, 0, bones, worldTransformOf(scene, meshId))
}

/**
 * Regression for: moving the most-child bone incorrectly moved the
 * beginning vertices (parent's third) after reparenting.
 *
 * Root cause was stale mesh-local bindPose after reparenting a bone chain
 * (especially with snapToTail or hierarchy changes). ReparentNodeCommand now
 * recomputes bindPose for affected meshes to keep skinning stable.
 */
describe('Bone reparent skinning (issue: child moves parent verts)', () => {
  it('keepWorld chain painted after reparent: moving leaf only moves distal third', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project!.slides[0]!
    const scene = slide.scene
    const rootId = scene.root.id

    const { nodeId: groupId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: scene.id, parentId: rootId, name: 'Group' }),
      ),
    )
    const { nodeId: b1 } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: groupId,
          name: 'B1',
          components: { bone: { kind: 'bone', length: 50 } },
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const { nodeId: b2 } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: b1,
          name: 'B2',
          components: { bone: { kind: 'bone', length: 50 } },
          transform: { x: 50, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const { nodeId: b3 } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: b2,
          name: 'B3',
          components: { bone: { kind: 'bone', length: 50 } },
          transform: { x: 50, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const { nodeId: meshId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: groupId,
          name: 'Mesh',
          components: { mesh: { kind: 'mesh', mesh: createLineMesh() } },
        }),
      ),
    )

    // Paint one third each
    for (let i = 0; i < 9; i++) {
      const bid = i < 3 ? b1 : i < 6 ? b2 : b3
      expectOk(
        system.dispatcher.dispatch(
          new PaintWeightCommand({
            nodeId: meshId,
            vertexIndex: i,
            boneId: bid,
            strength: 1,
            mode: 'set',
          }),
        ),
      )
    }

    const before = evalDeform(system, scene, meshId)
    const old = system.engine.getNode(b3).transform
    expectOk(
      system.dispatcher.dispatch(new MoveNodeCommand({ nodeId: b3, x: old.x + 20, y: old.y })),
    )
    const after = evalDeform(system, scene, meshId)

    for (let i = 0; i < 3; i++) {
      expect(Math.abs(after.deformedVertices[i].x - before.deformedVertices[i].x)).toBeLessThan(
        0.01,
      )
      expect(Math.abs(after.deformedVertices[i].y - before.deformedVertices[i].y)).toBeLessThan(
        0.01,
      )
    }
    for (let i = 6; i < 9; i++) {
      expect(
        Math.abs(after.deformedVertices[i].x - before.deformedVertices[i].x - 20),
      ).toBeLessThan(0.5)
    }
  })

  it('paint before reparent (snapToTail) then move leaf: stale bindPose must be refreshed', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project!.slides[0]!
    const scene = slide.scene
    const rootId = scene.root.id

    const { nodeId: groupId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: scene.id, parentId: rootId, name: 'Group' }),
      ),
    )
    // Bones initially as siblings under root at 0,50,100
    const { nodeId: b1 } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: rootId,
          name: 'B1',
          components: { bone: { kind: 'bone', length: 50 } },
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const { nodeId: b2 } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: rootId,
          name: 'B2',
          components: { bone: { kind: 'bone', length: 50 } },
          transform: { x: 50, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const { nodeId: b3 } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: rootId,
          name: 'B3',
          components: { bone: { kind: 'bone', length: 50 } },
          transform: { x: 100, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const { nodeId: meshId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: groupId,
          name: 'Mesh',
          components: { mesh: { kind: 'mesh', mesh: createLineMesh() } },
        }),
      ),
    )

    // Paint BEFORE reparent (bindPose captured while bones are flat siblings)
    for (let i = 0; i < 9; i++) {
      const bid = i < 3 ? b1 : i < 6 ? b2 : b3
      expectOk(
        system.dispatcher.dispatch(
          new PaintWeightCommand({
            nodeId: meshId,
            vertexIndex: i,
            boneId: bid,
            strength: 1,
            mode: 'set',
          }),
        ),
      )
    }

    // Now build chain with snapToTail (world will shift for b2/b3 if parent length != original distance)
    // Keep for b1, snap for others to simulate user choosing snap after seeing dialog
    expectOk(
      system.dispatcher.dispatch(
        new ReparentNodeCommand({ nodeId: b1, parentId: groupId, parentingMode: 'keepWorld' }),
      ),
    )
    expectOk(
      system.dispatcher.dispatch(
        new ReparentNodeCommand({ nodeId: b2, parentId: b1, parentingMode: 'snapToTail' }),
      ),
    )
    expectOk(
      system.dispatcher.dispatch(
        new ReparentNodeCommand({ nodeId: b3, parentId: b2, parentingMode: 'snapToTail' }),
      ),
    )

    const before = evalDeform(system, scene, meshId)
    const old = system.engine.getNode(b3).transform
    expectOk(
      system.dispatcher.dispatch(new MoveNodeCommand({ nodeId: b3, x: old.x + 20, y: old.y })),
    )
    const after = evalDeform(system, scene, meshId)

    // After fix, leaf movement must not affect parent's third
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(after.deformedVertices[i].x - before.deformedVertices[i].x)).toBeLessThan(
        0.01,
      )
    }
    // And leaf's own third must move
    for (let i = 6; i < 9; i++) {
      expect(
        Math.abs(after.deformedVertices[i].x - before.deformedVertices[i].x - 20),
      ).toBeLessThan(0.5)
    }
  })

  it('moving parent moves all via hierarchy (expected)', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project!.slides[0]!
    const scene = slide.scene
    const rootId = scene.root.id
    const { nodeId: groupId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: scene.id, parentId: rootId, name: 'Group' }),
      ),
    )
    const { nodeId: b1 } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: groupId,
          name: 'B1',
          components: { bone: { kind: 'bone', length: 50 } },
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const { nodeId: b2 } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: b1,
          name: 'B2',
          components: { bone: { kind: 'bone', length: 50 } },
          transform: { x: 50, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const { nodeId: b3 } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: b2,
          name: 'B3',
          components: { bone: { kind: 'bone', length: 50 } },
          transform: { x: 50, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const { nodeId: meshId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: groupId,
          name: 'Mesh',
          components: { mesh: { kind: 'mesh', mesh: createLineMesh() } },
        }),
      ),
    )
    for (let i = 0; i < 9; i++) {
      const bid = i < 3 ? b1 : i < 6 ? b2 : b3
      expectOk(
        system.dispatcher.dispatch(
          new PaintWeightCommand({
            nodeId: meshId,
            vertexIndex: i,
            boneId: bid,
            strength: 1,
            mode: 'set',
          }),
        ),
      )
    }
    const before = evalDeform(system, scene, meshId)
    const old = system.engine.getNode(b1).transform
    expectOk(
      system.dispatcher.dispatch(new MoveNodeCommand({ nodeId: b1, x: old.x + 30, y: old.y })),
    )
    const after = evalDeform(system, scene, meshId)
    for (let i = 0; i < 9; i++) {
      expect(
        Math.abs(after.deformedVertices[i].x - before.deformedVertices[i].x - 30),
      ).toBeLessThan(0.5)
    }
  })
})
