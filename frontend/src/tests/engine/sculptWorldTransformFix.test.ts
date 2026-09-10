import { describe, it, expect } from 'vitest'
import { worldDeltaToLocal, localDeltaToWorld, worldTransformOf } from '../../engine/worldTransform'
import { computeSculptOffsets } from '../../engine/sculptBrush'
import { deformedMeshWorldVertices } from '../../pixi/renderer/deformedMeshWorld'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  ReparentNodeCommand,
  RotateNodeCommand,
  ScaleNodeCommand,
  CreateShapeCommand,
  MoveShapeVertexCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { CommandResult } from '../../engine/commands'
import { createDefaultRectangleMesh } from '../../engine/mesh'
import type { MeshVertex } from '../../engine/mesh'
import type { WorldTransform } from '../../engine/worldTransform'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) throw new Error(`expected ok: ${result.error.message}`)
  return result.inverse
}

function localToWorld(local: { x: number; y: number }, wt: WorldTransform) {
  const sx = local.x * wt.scaleX
  const sy = local.y * wt.scaleY
  const cos = Math.cos(wt.rotation)
  const sin = Math.sin(wt.rotation)
  return { x: sx * cos - sy * sin + wt.x, y: sx * sin + sy * cos + wt.y }
}

describe('worldDeltaToLocal fix', () => {
  it('inverts localDeltaToWorld', () => {
    const wt = { x: 10, y: 20, rotation: Math.PI / 4, scaleX: 2, scaleY: 3 }
    const local = { x: 5, y: -3 }
    const world = localDeltaToWorld(local, wt)
    const recovered = worldDeltaToLocal(world, wt)
    expect(recovered.x).toBeCloseTo(local.x, 5)
    expect(recovered.y).toBeCloseTo(local.y, 5)
  })

  it('rotation 90deg: world (10,0) -> local (0,-5) with scale 2', () => {
    const wt = { x: 0, y: 0, rotation: Math.PI / 2, scaleX: 2, scaleY: 2 }
    const worldDelta = { x: 10, y: 0 }
    const local = worldDeltaToLocal(worldDelta, wt)
    expect(local.x).toBeCloseTo(0, 5)
    expect(local.y).toBeCloseTo(-5, 5)
    const back = localDeltaToWorld(local, wt)
    expect(back.x).toBeCloseTo(10, 5)
    expect(back.y).toBeCloseTo(0, 5)
  })

  it('sculpt under parent with rotation/scale: world drag 10,0 becomes correct world movement after fix', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S' })))
    const slide = system.engine.project!.slides[0]
    const scene = slide.scene
    const { nodeId: parentId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: scene.root.id,
          name: 'Parent',
          transform: { x: 50, y: 0, rotation: Math.PI / 2, scaleX: 2, scaleY: 2 },
        }),
      ),
    )
    const mesh = createDefaultRectangleMesh(10, 10)
    const { nodeId: meshId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: parentId,
          name: 'Mesh',
          components: { mesh: { kind: 'mesh', mesh } },
        }),
      ),
    )
    // Create shape for sculpt
    const { shapeId } = expectOk(
      system.dispatcher.dispatch(new CreateShapeCommand({ nodeId: meshId, name: 'Base' })),
    )
    const shape = system.engine.getShapes(meshId).find((s) => s.id === shapeId)!
    const wt = worldTransformOf(scene, meshId)!
    // Simulate brush at first vertex
    const meshForWorld = { ...mesh, vertices: shape.vertices as unknown as readonly MeshVertex[] }
    const worldVerts = deformedMeshWorldVertices(meshForWorld, scene, wt)
    const brushWorld = { x: worldVerts[0].x, y: worldVerts[0].y }
    const dragDeltaWorld = { x: 10, y: 0 }
    const offsets = computeSculptOffsets({
      worldVerts,
      brushWorld,
      radiusScreen: 25,
      scale: 1,
      falloff: 1,
      strength: 1,
      dragDeltaWorld,
      invert: false,
    })
    expect(offsets.get(0)?.dx).toBeCloseTo(10, 5)
    // Apply fix: convert to local
    const off = offsets.get(0)!
    const localDelta = worldDeltaToLocal({ x: off.dx, y: off.dy }, wt)
    const restBefore = shape.vertices[0]
    const restAfter = { x: restBefore.x + localDelta.x, y: restBefore.y + localDelta.y }
    const worldBefore = worldVerts[0]
    const worldAfter = localToWorld(restAfter, wt)
    const deltaWorldObserved = { x: worldAfter.x - worldBefore.x, y: worldAfter.y - worldBefore.y }
    // After fix, observed world delta should equal drag delta
    expect(deltaWorldObserved.x).toBeCloseTo(10, 5)
    expect(deltaWorldObserved.y).toBeCloseTo(0, 5)
    // Without fix (buggy), it would be R*S*delta = (0,20) for this wt
    const buggyRest = { x: restBefore.x + off.dx, y: restBefore.y + off.dy }
    const buggyWorld = localToWorld(buggyRest, wt)
    const buggyDelta = { x: buggyWorld.x - worldBefore.x, y: buggyWorld.y - worldBefore.y }
    expect(buggyDelta.x).not.toBeCloseTo(10, 1)
    expect(Math.hypot(buggyDelta.x - 10, buggyDelta.y - 0)).toBeGreaterThan(5)
  })

  it('reparent then transform: bug previously made sculpt random, now correct', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const slide = system.engine.project!.slides[0]
    const scene = slide.scene
    const { nodeId: parentId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: scene.root.id,
          name: 'ParentGroup',
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
        }),
      ),
    )
    const mesh = createDefaultRectangleMesh(10, 10)
    const { nodeId: meshId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: scene.root.id,
          name: 'MeshNode',
          components: { mesh: { kind: 'mesh', mesh } },
        }),
      ),
    )
    const { shapeId } = expectOk(
      system.dispatcher.dispatch(new CreateShapeCommand({ nodeId: meshId, name: 'Base' })),
    )
    // Reparent under parent
    expectOk(system.dispatcher.dispatch(new ReparentNodeCommand({ nodeId: meshId, parentId })))
    // Now "move, resize, rotate object under other object" — transform child and parent
    expectOk(
      system.dispatcher.dispatch(
        new RotateNodeCommand({ nodeId: parentId, rotation: Math.PI / 3 }),
      ),
    )
    expectOk(
      system.dispatcher.dispatch(
        new ScaleNodeCommand({ nodeId: parentId, scaleX: 1.5, scaleY: 1.5 }),
      ),
    )
    // Also rotate/scale child
    const childBefore = system.engine.getNode(meshId).transform
    expectOk(
      system.dispatcher.dispatch(
        new RotateNodeCommand({ nodeId: meshId, rotation: childBefore.rotation + 0.5 }),
      ),
    )
    const wt = worldTransformOf(scene, meshId)!
    const shape = system.engine.getShapes(meshId).find((s) => s.id === shapeId)!
    const meshForWorld = { ...mesh, vertices: shape.vertices as unknown as readonly MeshVertex[] }
    const worldVerts = deformedMeshWorldVertices(meshForWorld, scene, wt)
    const drag = { x: 5, y: 5 }
    const offsets = computeSculptOffsets({
      worldVerts,
      brushWorld: { x: worldVerts[0].x, y: worldVerts[0].y },
      radiusScreen: 25,
      scale: 1,
      falloff: 1,
      strength: 1,
      dragDeltaWorld: drag,
      invert: false,
    })
    const off = offsets.get(0)!
    const local = worldDeltaToLocal({ x: off.dx, y: off.dy }, wt)
    const worldAfter = localToWorld(
      { x: shape.vertices[0].x + local.x, y: shape.vertices[0].y + local.y },
      wt,
    )
    const observed = { x: worldAfter.x - worldVerts[0].x, y: worldAfter.y - worldVerts[0].y }
    expect(observed.x).toBeCloseTo(drag.x, 4)
    expect(observed.y).toBeCloseTo(drag.y, 4)
  })

  it('uses the selected shape pivot when hit-testing a switched shape', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S' })))
    const scene = system.engine.project!.slides[0].scene
    const mesh = createDefaultRectangleMesh(10, 10)
    const { nodeId } = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: scene.root.id,
          name: 'Mesh',
          transform: {
            x: 100,
            y: 0,
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            localPivot: { x: 0.5, y: 0 },
          },
          components: { mesh: { kind: 'mesh', mesh } },
        }),
      ),
    )
    const { shapeId } = expectOk(
      system.dispatcher.dispatch(new CreateShapeCommand({ nodeId, name: 'Switched' })),
    )
    expectOk(
      system.dispatcher.dispatch(
        new MoveShapeVertexCommand({ nodeId, shapeId, vertexIndex: 0, x: 20, y: -5 }),
      ),
    )

    const shape = system.engine.getShapes(nodeId).find((candidate) => candidate.id === shapeId)!
    const transform = worldTransformOf(scene, nodeId)!
    const switchedMesh = { ...mesh, vertices: shape.vertices as unknown as MeshVertex[] }
    const withNodeContext = deformedMeshWorldVertices(
      switchedMesh,
      scene,
      transform,
      undefined,
      undefined,
      nodeId,
      0,
    )
    const withoutNodeContext = deformedMeshWorldVertices(switchedMesh, scene, transform)

    expect(withNodeContext[0].x).toBeCloseTo(110)
    expect(withoutNodeContext[0].x).toBeCloseTo(120)
  })
})
