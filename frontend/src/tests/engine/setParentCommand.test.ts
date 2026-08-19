import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetParentCommand,
  createCommandSystem,
} from '../../engine/commands'
import { worldTransformOf } from '../../engine/worldTransform'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function setupWithNodes() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = system.engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const parentId = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Parent',
        transform: { x: 50, y: 100, rotation: 0, scaleX: 1, scaleY: 1 },
      }),
    ),
  ).nodeId
  const childId = expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId,
        name: 'Child',
        transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
      }),
    ),
  ).nodeId
  const cameraId = slide.scene.camera.id
  return { system, parentId, childId, cameraId, scene: slide.scene }
}

describe('SetParentCommand', () => {
  it('reparents a node and maintains world transform by default', () => {
    const { system, childId, scene } = setupWithNodes()

    const result = system.dispatcher.dispatch(
      new SetParentCommand({ nodeId: childId, parentId: scene.root.id }),
    )

    const inverse = expectOk(result)
    const node = system.engine.getNode(childId)
    expect(node.parent?.id).toBe(scene.root.id)
    expect(inverse.oldParentId).toBeDefined()
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'SetParent',
      parameters: {
        nodeId: childId,
        parentId: scene.root.id,
        maintainWorldTransform: true,
      },
    })
  })

  it('preserves world position with maintainWorldTransform=true', () => {
    const { system, childId, scene } = setupWithNodes()
    const worldBefore = worldTransformOf(scene, childId)

    system.dispatcher.dispatch(
      new SetParentCommand({
        nodeId: childId,
        parentId: scene.root.id,
        maintainWorldTransform: true,
      }),
    )

    const worldAfter = worldTransformOf(system.engine.getScene(scene.id), childId)
    expect(worldAfter).not.toBeNull()
    expect(worldAfter!.x).toBeCloseTo(worldBefore!.x, 5)
    expect(worldAfter!.y).toBeCloseTo(worldBefore!.y, 5)
    expect(worldAfter!.rotation).toBeCloseTo(worldBefore!.rotation, 5)
    expect(worldAfter!.scaleX).toBeCloseTo(worldBefore!.scaleX, 5)
    expect(worldAfter!.scaleY).toBeCloseTo(worldBefore!.scaleY, 5)
  })

  it('keeps local values with maintainWorldTransform=false', () => {
    const { system, childId, scene } = setupWithNodes()
    const localBefore = { ...system.engine.getNode(childId).transform }

    system.dispatcher.dispatch(
      new SetParentCommand({
        nodeId: childId,
        parentId: scene.root.id,
        maintainWorldTransform: false,
      }),
    )

    const node = system.engine.getNode(childId)
    expect(node.transform.x).toBe(localBefore.x)
    expect(node.transform.y).toBe(localBefore.y)
    expect(node.transform.rotation).toBe(localBefore.rotation)
    expect(node.transform.scaleX).toBe(localBefore.scaleX)
    expect(node.transform.scaleY).toBe(localBefore.scaleY)
  })

  it('rejects self-parenting', () => {
    const { system, childId } = setupWithNodes()

    const result = system.dispatcher.dispatch(
      new SetParentCommand({ nodeId: childId, parentId: childId }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/itself/i)
    }
  })

  it('rejects circular parent chains', () => {
    const { system, parentId, childId, scene } = setupWithNodes()
    const grandchildId = expectOk(
      system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: scene.id,
          parentId: childId,
          name: 'Grandchild',
        }),
      ),
    ).nodeId

    const result = system.dispatcher.dispatch(
      new SetParentCommand({ nodeId: parentId, parentId: grandchildId }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/descendant/i)
    }
  })

  it('rejects reparenting the camera node', () => {
    const { system, cameraId, scene } = setupWithNodes()

    const result = system.dispatcher.dispatch(
      new SetParentCommand({ nodeId: cameraId, parentId: scene.root.id }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/camera/i)
    }
  })

  it('rejects reparenting the root node', () => {
    const { system, scene } = setupWithNodes()

    const result = system.dispatcher.dispatch(
      new SetParentCommand({ nodeId: scene.root.id, parentId: scene.root.id }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/root/i)
    }
  })

  it('serializes to JSON with its type and parameters', () => {
    const cmd = new SetParentCommand({
      nodeId: 'n1',
      parentId: 'p1',
      maintainWorldTransform: false,
      index: 2,
    })
    expect(cmd.toJSON()).toEqual({
      type: 'SetParent',
      nodeId: 'n1',
      parentId: 'p1',
      maintainWorldTransform: false,
      index: 2,
    })
  })

  it('defaults maintainWorldTransform to true in serialization', () => {
    const cmd = new SetParentCommand({ nodeId: 'n1', parentId: 'p1' })
    expect(cmd.toJSON()).toEqual({
      type: 'SetParent',
      nodeId: 'n1',
      parentId: 'p1',
      maintainWorldTransform: true,
    })
  })

  it('records the inverse with oldParentId and oldTransform', () => {
    const { system, childId, parentId, scene } = setupWithNodes()

    const result = expectOk(
      system.dispatcher.dispatch(
        new SetParentCommand({ nodeId: childId, parentId: scene.root.id }),
      ),
    )

    expect(result.oldParentId).toBe(parentId)
    expect(result.oldTransform).toBeDefined()
    expect(result.oldTransform.x).toBeDefined()
    expect(result.oldTransform.y).toBeDefined()
  })
})
