import { describe, expect, it } from 'vitest'
import { buildContextSnapshot, type AnimationAssistantSnapshot } from '../ai/contextSnapshot'
import type { EnginePublic } from '../engine'

function animationEngine() {
  const cat = {
    id: 'n-cat',
    name: 'Cat',
    semanticName: 'cat',
    parent: null as unknown,
    children: [] as unknown[],
    transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
    visible: true,
    components: { mesh: { kind: 'mesh' } },
    controlSet: { controls: [{ key: 'mouthOpen' }, { key: 'blink' }] },
    clipInstances: [{ clipId: 'clip-walk', startTime: 1 }],
    collectionPlacements: [],
  }
  const root = {
    id: 'root',
    name: 'Root',
    parent: null,
    children: [cat],
    transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    visible: true,
    components: {},
  }
  cat.parent = root
  const nodes: Record<string, unknown> = { root, 'n-cat': cat }
  return {
    project: {
      id: 'p-1',
      name: 'Unsaved Cat Edit',
      slides: [{ id: 's-1', name: 'Room', scene: { root } }],
    },
    materialDefinitions: [],
    shaderDefinitions: [],
    clips: [
      {
        id: 'clip-walk',
        name: 'Walk',
        duration: 2,
        category: 'locomotion',
        channels: [{ property: 'positionX' }, { property: 'positionY' }],
      },
    ],
    clipCollections: [
      {
        id: 'col-walk',
        name: 'Walk Cycle',
        category: 'locomotion',
        bindings: new Map([['cat', 'clip-walk']]),
        alignmentOffsets: {},
      },
    ],
    getActiveSlide: () => ({
      id: 's-1',
      name: 'Room',
      duration: 12,
      scene: { root },
      animationScript: null,
    }),
    getNode: (id: string) => {
      const node = nodes[id]
      if (!node) throw new Error('missing')
      return node as never
    },
    getShapes: (id: string) => (id === 'n-cat' ? [{ id: 'shape-sit', name: 'Sit' }] : []) as never,
    getMorphBinding: (id: string) =>
      (id === 'n-cat' ? { fromShapeId: 'shape-a', toShapeId: 'shape-b' } : null) as never,
    getMorphKeyframes: () => [] as never,
    getClipInstances: (id: string) =>
      (id === 'n-cat' ? [{ clipId: 'clip-walk', startTime: 1 }] : []) as never,
    getCollectionPlacements: () => [] as never,
    getKeyframes: (id: string, property: string) =>
      (id === 'n-cat' && property === 'positionX'
        ? [{ id: 'k-1', time: 1, value: 5 }]
        : []) as never,
  } as unknown as EnginePublic
}

describe('animation-assistant context snapshot', () => {
  it('provides bounded scene summaries with stable identity by default', () => {
    const snapshot = buildContextSnapshot(animationEngine())
    const animation = (snapshot as { animation?: AnimationAssistantSnapshot }).animation
    expect(animation).toBeDefined()
    const cat = animation!.nodes.find((n) => n.id === 'n-cat')
    expect(cat).toMatchObject({
      id: 'n-cat',
      name: 'Cat',
      parentId: 'root',
      semanticName: 'cat',
      visible: true,
    })
    expect(cat!.components).toContain('mesh')
    expect(cat!.transform).toMatchObject({ x: 10, y: 20 })
    // World transform composes the root chain without touching project data.
    expect(cat!.worldTransform).toMatchObject({ x: 10, y: 20 })
    // Nodes without an asset instance carry no asset metadata (issue #440).
    expect(cat!.assetDefinitionId).toBeNull()
    expect(animation!.truncated.nodes).toBe(false)
  })

  it('grounds target resolution in asset metadata when present', () => {
    const engine = animationEngine()
    const root = (
      engine as unknown as {
        getNode: (id: string) => { components: Record<string, unknown> }
      }
    ).getNode('n-cat')
    root.components = {
      ...root.components,
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'asset-cat' },
    }
    const snapshot = buildContextSnapshot(engine)
    const animation = (snapshot as { animation?: AnimationAssistantSnapshot }).animation!
    expect(animation.nodes.find((n) => n.id === 'n-cat')?.assetDefinitionId).toBe('asset-cat')
  })

  it('summarises rig, animation library, and timeline state', () => {
    const snapshot = buildContextSnapshot(animationEngine())
    const animation = (snapshot as { animation?: AnimationAssistantSnapshot }).animation!
    expect(animation.rig.shapeInventory).toEqual([
      { nodeId: 'n-cat', shapeCount: 1, shapeNames: ['Sit'] },
    ])
    expect(animation.rig.morphBindings).toEqual([
      { nodeId: 'n-cat', fromShapeId: 'shape-a', toShapeId: 'shape-b' },
    ])
    expect(animation.rig.controls).toEqual([{ hostNodeId: 'n-cat', keys: ['mouthOpen', 'blink'] }])
    expect(animation.clips).toEqual([
      {
        id: 'clip-walk',
        name: 'Walk',
        duration: 2,
        category: 'locomotion',
        channelCount: 2,
        channels: ['positionX', 'positionY'],
      },
    ])
    expect(animation.collections).toEqual([
      {
        id: 'col-walk',
        name: 'Walk Cycle',
        category: 'locomotion',
        bindingCount: 1,
        bindings: { cat: 'clip-walk' },
        hasAlignmentOffsets: false,
      },
    ])
    expect(animation.timeline).toMatchObject({
      slideId: 's-1',
      duration: 12,
      clipInstanceCount: 1,
      hasAnimationScript: false,
    })
    expect(animation.timeline.perNode.find((n) => n.nodeId === 'n-cat')?.keyframes).toBe(1)
  })

  it('reflects unsaved live edits without mutating the project', () => {
    const engine = animationEngine()
    const project = (engine as unknown as { project: { name: string } }).project
    const catBefore = (engine as unknown as { getNode: (id: string) => { name: string } }).getNode(
      'n-cat',
    ).name
    const snapshot = buildContextSnapshot(engine)
    expect(snapshot.projectName).toBe('Unsaved Cat Edit')
    const animation = (snapshot as { animation?: AnimationAssistantSnapshot }).animation!
    expect(animation.nodes.some((n) => n.name === 'Cat')).toBe(true)
    // Live unsaved state is reflected, and the builder leaves it untouched.
    expect(project.name).toBe('Unsaved Cat Edit')
    expect(
      (engine as unknown as { getNode: (id: string) => { name: string } }).getNode('n-cat').name,
    ).toBe(catBefore)
  })

  it('stays bounded and never throws on engines without animation APIs', () => {
    const engine = {
      project: null,
      materialDefinitions: [],
      shaderDefinitions: [],
      clips: [],
      getActiveSlide: () => {
        throw new Error('no slide')
      },
      getNode: () => {
        throw new Error('no node')
      },
    } as unknown as EnginePublic
    expect(() => buildContextSnapshot(engine)).not.toThrow()
    const snapshot = buildContextSnapshot(engine)
    const animation = (snapshot as { animation?: AnimationAssistantSnapshot }).animation!
    expect(animation.nodes).toEqual([])
    expect(animation.timeline.duration).toBeNull()
  })
})
