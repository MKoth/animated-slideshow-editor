import { describe, expect, it } from 'vitest'
import { createEngine } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { useEditingModeStore } from '../stores/editingModeStore'
import { useSelectionStore } from '../stores/selectionStore'
import type { NodeFilter } from '../pixi/renderer/hitTest'
import { topmostNodeAt, nodesIntersectingRect } from '../pixi/renderer/hitTest'
import type { WorldSize } from '../pixi/renderer/worldGeometry'

function setup(): Engine {
  const engine = createEngine()
  engine.createProject({ name: 'Test Project' })
  engine.createSlide('Slide 1')
  return engine
}

function createBoneNode(engine: Engine, name: string, parentId: string, x = 0, y = 0) {
  const slide = engine.project?.slides[0]
  if (!slide) throw new Error('No slide')
  return engine.createNode(slide.scene.id, parentId, name, {
    components: { bone: { kind: 'bone', length: 100 } },
    transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
  })
}

function createImageNode(engine: Engine, name: string, parentId: string, x = 0, y = 0) {
  const slide = engine.project?.slides[0]
  if (!slide) throw new Error('No slide')
  return engine.createNode(slide.scene.id, parentId, name, {
    components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'test-asset' } },
    transform: { x, y, rotation: 0, scaleX: 1, scaleY: 1 },
  })
}

function createNodeSizeGetter(engine: Engine): (nodeId: string) => WorldSize | null {
  return (nodeId: string) => {
    try {
      const node = engine.getNode(nodeId)
      if (node.components.bone) {
        return { width: node.components.bone.length, height: 10 }
      }
      if (node.components.assetInstance) {
        return { width: 100, height: 100 }
      }
      return null
    } catch {
      return null
    }
  }
}

describe('rigging selection', () => {
  it('in default mode, both bones and image nodes are selectable', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone1', slide.scene.root.id, 0, 0)
    const image = createImageNode(engine, 'Image1', slide.scene.root.id, 200, 0)

    const nodeSize = createNodeSizeGetter(engine)
    const scene = slide.scene

    const hitBone = topmostNodeAt(scene, { x: 10, y: 0 }, nodeSize)
    const hitImage = topmostNodeAt(scene, { x: 210, y: 0 }, nodeSize)

    expect(hitBone).toBe(bone.id)
    expect(hitImage).toBe(image.id)
  })

  it('in rigging mode, only bones are selectable', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone1', slide.scene.root.id, 0, 0)
    createImageNode(engine, 'Image1', slide.scene.root.id, 200, 0)

    useEditingModeStore.getState().setMode('rigging')

    const nodeSize = createNodeSizeGetter(engine)
    const scene = slide.scene
    const filter: NodeFilter = (node) => !!node.components.bone

    const hitBone = topmostNodeAt(scene, { x: 10, y: 0 }, nodeSize, undefined, filter)
    const hitImage = topmostNodeAt(scene, { x: 210, y: 0 }, nodeSize, undefined, filter)

    expect(hitBone).toBe(bone.id)
    expect(hitImage).toBeNull()

    useEditingModeStore.getState().exitMode()
  })

  it('in rigging mode, box-select only selects bones', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone1 = createBoneNode(engine, 'Bone1', slide.scene.root.id, 0, 0)
    const bone2 = createBoneNode(engine, 'Bone2', slide.scene.root.id, 100, 0)
    const image = createImageNode(engine, 'Image1', slide.scene.root.id, 50, 0)

    useEditingModeStore.getState().setMode('rigging')

    const nodeSize = createNodeSizeGetter(engine)
    const scene = slide.scene
    const filter: NodeFilter = (node) => !!node.components.bone

    const hits = nodesIntersectingRect(
      scene,
      { minX: -10, minY: -10, maxX: 200, maxY: 10 },
      nodeSize,
      undefined,
      filter,
    )

    expect(hits).toContain(bone1.id)
    expect(hits).toContain(bone2.id)
    expect(hits).not.toContain(image.id)

    useEditingModeStore.getState().exitMode()
  })

  it('shift-click extends bone selection in rigging mode', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone1 = createBoneNode(engine, 'Bone1', slide.scene.root.id, 0, 0)
    const bone2 = createBoneNode(engine, 'Bone2', slide.scene.root.id, 100, 0)

    useEditingModeStore.getState().setMode('rigging')
    useSelectionStore.getState().select(bone1.id)

    expect(useSelectionStore.getState().selectedIds).toEqual([bone1.id])

    useSelectionStore.getState().extend(bone2.id)

    expect(useSelectionStore.getState().selectedIds).toContain(bone1.id)
    expect(useSelectionStore.getState().selectedIds).toContain(bone2.id)

    useEditingModeStore.getState().exitMode()
  })

  it('ESC exits rigging mode', () => {
    useEditingModeStore.getState().setMode('rigging')
    expect(useEditingModeStore.getState().mode).toBe('rigging')

    useEditingModeStore.getState().exitMode()
    expect(useEditingModeStore.getState().mode).toBe('default')
  })

  it('selecting image node attached to bone shows attachment in rigging panel', () => {
    const engine = setup()
    const slide = engine.project?.slides[0]
    if (!slide) throw new Error('No slide')

    const bone = createBoneNode(engine, 'Bone1', slide.scene.root.id, 0, 0)
    const image = createImageNode(engine, 'Image1', bone.id, 10, 20)

    useSelectionStore.getState().select(image.id)

    expect(useSelectionStore.getState().selectedIds).toEqual([image.id])

    const selectedNode = engine.getNode(image.id)
    expect(selectedNode.parent?.id).toBe(bone.id)
    expect(selectedNode.parent?.components.bone).toBeDefined()
  })
})
