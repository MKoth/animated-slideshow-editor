import { describe, expect, it } from 'vitest'
import { createEngineInternal } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { AiAnimationAssetBatchCommand } from '../engine/commands/aiAnimationAssetBatchCommand'
import { createDefaultRectangleMesh } from '../engine/mesh'
import {
  animationAssetsFromConversationProposals,
  applyAnimationAssetOperations,
  type AnimationAssetOperation,
} from '../ai/animationAssetOperations'
import { buildContextSnapshot } from '../ai/contextSnapshot'
import type { AiProposal } from '../api/aiApi'

function fixture() {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Animation asset proposal' })
  const slide = engine.createSlide('Room')
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Paw', {
    semanticName: 'left_front_paw',
    components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(10, 10) } },
  })
  const sourceShape = engine.createShape(node.id, 'Rest')
  return { engine, slide, node, sourceShape }
}

describe('animation asset proposal operations', () => {
  it('previews a duplicated-and-edited Shape without changing the live project', () => {
    const { engine, node, sourceShape } = fixture()
    const before = JSON.stringify(engine.toJSON())
    const operations: AnimationAssetOperation[] = [
      {
        kind: 'upsertShape',
        action: 'create',
        sourceShapeId: sourceShape.id,
        nodeId: node.id,
        shape: {
          id: 'ai-shape-sleeping-paw',
          name: 'Sleeping paw',
          vertices: sourceShape.vertices.map((vertex, index) => ({
            x: vertex.x + (index === 2 ? 2 : 0),
            y: vertex.y + (index > 1 ? 1 : 0),
          })),
        },
      },
    ]

    const preview = applyAnimationAssetOperations(engine.toJSON(), operations)
    const previewNode = preview.slides[0]?.scene.nodes.find((entry) => entry.id === node.id)
    const mesh = previewNode?.components.mesh

    expect(mesh?.shapes).toHaveLength(2)
    expect(mesh?.shapes?.[0]?.vertices).toEqual(sourceShape.vertices)
    expect(mesh?.shapes?.[1]?.vertices[2]).not.toEqual(sourceShape.vertices[2])
    expect(JSON.stringify(engine.toJSON())).toBe(before)
  })

  it('blocks a Shape draft whose topology differs from its target mesh', () => {
    const { engine, node, sourceShape } = fixture()

    expect(() =>
      applyAnimationAssetOperations(engine.toJSON(), [
        {
          kind: 'upsertShape',
          action: 'create',
          sourceShapeId: sourceShape.id,
          nodeId: node.id,
          shape: { id: 'bad-shape', name: 'Bad', vertices: [{ x: 0, y: 0 }] },
        },
      ]),
    ).toThrow(/topology requires/i)
  })

  it('provides bounded source vertex coordinates and stable asset ids to the assistant', () => {
    const { engine, node, sourceShape } = fixture()
    const context = buildContextSnapshot(engine, { selection: [node.id] })

    expect(context.animation.rig.shapeInventory[0]?.shapeDetails?.[0]).toMatchObject({
      id: sourceShape.id,
      name: 'Rest',
      vertexCount: sourceShape.vertices.length,
    })
    expect(context.animation.shapeGeometry?.[0]?.shapes[0]).toMatchObject({
      id: sourceShape.id,
      name: 'Rest',
      vertices: sourceShape.vertices,
    })
  })

  it('retains chat-created asset identities for later approved deletion proposals', () => {
    const proposal = {
      id: 'proposal-1',
      conversationId: 'conversation-1',
      commands: [
        {
          type: 'AiAnimationAssetBatch',
          operations: [
            {
              kind: 'upsertShape',
              action: 'create',
              nodeId: 'paw-node',
              shape: { id: 'shape-paw-sleep', name: 'Sleeping paw', vertices: [] },
            },
          ],
        },
      ],
      executions: [{ success: true }],
    } as unknown as AiProposal

    expect(animationAssetsFromConversationProposals([proposal], 'conversation-1')).toEqual([
      {
        kind: 'shape',
        id: 'shape-paw-sleep',
        name: 'Sleeping paw',
        action: 'create',
        proposalId: 'proposal-1',
      },
    ])
  })

  it('previews Clip Collection deletion with regular lane-detach behavior', () => {
    const { engine, slide, node } = fixture()
    const clip = engine.createClip('Paw motion', 1, '', [], [])
    const collection = engine.createClipCollection(
      'Paw motion collection',
      { left_front_paw: clip.id },
      slide.scene.root.id,
    )
    engine.applyClipCollection(collection.id, slide.scene.root.id)
    const before = JSON.stringify(engine.toJSON())

    const preview = applyAnimationAssetOperations(engine.toJSON(), [
      { kind: 'deleteCollection', collectionId: collection.id },
    ])
    const previewRoot = preview.slides[0]?.scene.nodes.find(
      (entry) => entry.id === slide.scene.root.id,
    )
    const previewPaw = preview.slides[0]?.scene.nodes.find((entry) => entry.id === node.id)

    expect(preview.clipCollections ?? []).toHaveLength(0)
    expect(previewRoot?.collectionPlacements ?? []).toHaveLength(0)
    expect(previewPaw?.clipInstances?.[0]?.clipId).toBe(clip.id)
    expect(previewPaw?.clipInstances?.[0]?.placementId).toBeUndefined()
    expect(previewPaw?.clipInstances?.[0]?.collectionId).toBeUndefined()
    expect(JSON.stringify(engine.toJSON())).toBe(before)
  })

  it('creates a Clip with keyframes, then a Collection that references that new Clip', () => {
    const { engine, slide, node } = fixture()
    const authoringEngine = createEngineInternal()
    authoringEngine.restoreFromJSON(engine.toJSON())
    const clip = authoringEngine.createClip(
      'Paw tuck',
      6,
      'character',
      [],
      [{ property: 'positionX' }],
    )
    authoringEngine.addClipChannelKeyframe(clip.id, 'positionX', 0, 0)
    authoringEngine.addClipChannelKeyframe(clip.id, 'positionX', 1, 12)
    const clipJson = clip.toJSON()
    const collection = authoringEngine.createClipCollection(
      'Paw tuck collection',
      { left_front_paw: clip.id },
      slide.scene.root.id,
    )

    const candidate = applyAnimationAssetOperations(engine.toJSON(), [
      { kind: 'upsertClip', action: 'create', nodeId: node.id, clip: clipJson },
      { kind: 'upsertCollection', action: 'create', collection: collection.toJSON() },
    ])
    const preview = createEngineInternal()
    preview.restoreFromJSON(candidate)

    expect(preview.getClip(clip.id).getChannelKeyframes('positionX')).toHaveLength(2)
    expect(preview.getClipCollection(collection.id).getBindingsObject()).toEqual({
      left_front_paw: clip.id,
    })
    expect(engine.clips).toHaveLength(0)
    expect(engine.clipCollections).toHaveLength(0)
  })

  it('applies an approved asset batch as one undoable change', () => {
    const { engine, node, sourceShape } = fixture()
    const system = {
      engine,
      undoStack: new UndoStack(),
      dispatcher: null as unknown as CommandDispatcher,
    }
    system.dispatcher = new CommandDispatcher(engine, system.undoStack, () => undefined)
    const command = new AiAnimationAssetBatchCommand({
      operations: [
        {
          kind: 'upsertShape',
          action: 'create',
          sourceShapeId: sourceShape.id,
          nodeId: node.id,
          shape: {
            id: 'approved-shape',
            name: 'Approved pose',
            vertices: sourceShape.vertices.map((vertex) => ({ x: vertex.x + 1, y: vertex.y })),
          },
        },
      ],
    })
    const result = system.dispatcher.dispatch(command, 'ai')

    expect(result.ok).toBe(true)
    expect(system.undoStack.entries).toHaveLength(1)
    expect(engine.getShapes(node.id).map((shape) => shape.name)).toContain('Approved pose')

    system.undoStack.undo(engine)
    expect(engine.getShapes(node.id).map((shape) => shape.name)).toEqual(['Rest'])
    system.undoStack.redo(engine)
    expect(engine.getShapes(node.id).map((shape) => shape.name)).toContain('Approved pose')
  })
})
