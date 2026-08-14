import { describe, expect, it } from 'vitest'
import type { EngineEvent } from '../../engine/events'
import { createEngine } from '../../engine/internal'
import { collectEvents } from './helpers'

function setup() {
  const engine = createEngine()
  const project = engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  return {
    engine,
    projectId: project.id,
    slideId: slide.id,
    sceneId: slide.scene.id,
    rootId: slide.scene.root.id,
  }
}

const canonicalTypes = [
  'ProjectCreated',
  'SlideCreated',
  'SlideRemoved',
  'SlideActivated',
  'SlideRenamed',
  'SlideMoved',
  'SlideDurationChanged',
  'NodeCreated',
  'NodeRemoved',
  'NodeReparented',
  'TransformChanged',
  'VisibilityChanged',
  'NodeRenamed',
  'OpacityChanged',
  'NodeOrderChanged',
] as const

describe('canonical events', () => {
  it('uses only the canonical vocabulary across a full workflow', () => {
    const { engine, sceneId, rootId } = setup()
    const events = collectEvents(engine)

    const node = engine.createNode(sceneId, rootId, 'A')
    engine.setTransform(node.id, { x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1 })
    engine.setVisibility(node.id, false)
    engine.reparentNode(node.id, rootId)
    engine.removeNode(node.id)
    engine.createSlide('S2')

    for (const event of events) {
      expect(canonicalTypes).toContain(event.type)
    }
  })

  it('emits exactly one event per operation with the affected id', () => {
    const { engine, sceneId, rootId } = setup()
    const events = collectEvents(engine)

    const node = engine.createNode(sceneId, rootId, 'A')
    engine.removeNode(node.id)

    expect(events).toEqual([
      { type: 'NodeCreated', nodeId: node.id },
      { type: 'NodeRemoved', nodeId: node.id },
    ])
  })

  it('emits TransformChanged with the affected node id', () => {
    const { engine, sceneId, rootId } = setup()
    const events = collectEvents(engine)
    const node = engine.createNode(sceneId, rootId, 'A')

    engine.setTransform(node.id, { x: 10, y: 0, rotation: 0, scaleX: 1, scaleY: 1 })

    expect(events).toEqual([
      { type: 'NodeCreated', nodeId: node.id },
      { type: 'TransformChanged', nodeId: node.id },
    ])
  })

  it('emits VisibilityChanged with the affected node id', () => {
    const { engine, sceneId, rootId } = setup()
    const events = collectEvents(engine)
    const node = engine.createNode(sceneId, rootId, 'A')

    engine.setVisibility(node.id, false)

    expect(events).toEqual([
      { type: 'NodeCreated', nodeId: node.id },
      { type: 'VisibilityChanged', nodeId: node.id },
    ])
  })

  it('emits slide events with their ids', () => {
    const { engine, slideId: firstId } = setup()
    const events = collectEvents(engine)

    const slide = engine.createSlide('S2')
    engine.removeSlide(slide.id)

    expect(events).toEqual([
      { type: 'SlideCreated', slideId: slide.id },
      { type: 'SlideActivated', slideId: slide.id },
      { type: 'SlideRemoved', slideId: slide.id },
      { type: 'SlideActivated', slideId: firstId },
    ])
  })

  it('emits SlideRenamed, SlideMoved, and SlideDurationChanged with the slide id', () => {
    const { engine } = setup()
    const slide = engine.createSlide('S2')
    const events = collectEvents(engine)

    engine.renameSlide(slide.id, 'Renamed')
    engine.moveSlide(slide.id, 0)
    engine.setSlideDuration(slide.id, 20)

    expect(events).toEqual([
      { type: 'SlideRenamed', slideId: slide.id },
      { type: 'SlideMoved', slideId: slide.id },
      { type: 'SlideDurationChanged', slideId: slide.id },
    ])
  })

  it('emits NodeCreated when an asset instance node is created', () => {
    const { engine, sceneId, rootId } = setup()
    const definition = engine.defineAsset('Fox')
    const events = collectEvents(engine)
    const node = engine.createAssetInstance(sceneId, rootId, definition.id, 'Fox A')

    expect(events).toEqual([{ type: 'NodeCreated', nodeId: node.id }])
  })

  it('emits NodeReparented with the affected node id', () => {
    const { engine, sceneId, rootId } = setup()
    const events = collectEvents(engine)
    const a = engine.createNode(sceneId, rootId, 'A')
    const b = engine.createNode(sceneId, rootId, 'B')

    engine.reparentNode(a.id, b.id)

    expect(events).toEqual([
      { type: 'NodeCreated', nodeId: a.id },
      { type: 'NodeCreated', nodeId: b.id },
      { type: 'NodeReparented', nodeId: a.id },
    ])
  })

  it('emits NodeRenamed and OpacityChanged with the affected node id', () => {
    const { engine, sceneId, rootId } = setup()
    const events = collectEvents(engine)
    const node = engine.createNode(sceneId, rootId, 'A')

    engine.renameNode(node.id, 'B')
    engine.setOpacity(node.id, 0.5)

    expect(events).toEqual([
      { type: 'NodeCreated', nodeId: node.id },
      { type: 'NodeRenamed', nodeId: node.id },
      { type: 'OpacityChanged', nodeId: node.id },
    ])
  })

  it('emits nothing for operations without a canonical event', () => {
    const { engine, sceneId, rootId } = setup()
    engine.createNode(sceneId, rootId, 'A')
    const events = collectEvents(engine)

    engine.defineAsset('Wolf')

    expect(events).toEqual([])
  })

  it('emits nothing when an operation is rejected', () => {
    const { engine, sceneId, rootId } = setup()
    const a = engine.createNode(sceneId, rootId, 'A')
    const b = engine.createNode(sceneId, a.id, 'B')
    const events = collectEvents(engine)

    expect(() => engine.removeNode(rootId)).toThrow()
    expect(() => engine.reparentNode(a.id, b.id)).toThrow()
    expect(() =>
      engine.setTransform(engine.project?.slides[0]?.scene.camera.id ?? '', {
        x: 0,
        y: 0,
        rotation: 1,
        scaleX: 1,
        scaleY: 1,
      }),
    ).toThrow()

    expect(events).toEqual([])
  })

  it('stops delivering events after unsubscribing', () => {
    const { engine, sceneId, rootId } = setup()
    const events: EngineEvent[] = []
    const unsubscribe = engine.subscribe((event) => events.push(event))

    engine.createNode(sceneId, rootId, 'A')
    unsubscribe()
    engine.createNode(sceneId, rootId, 'B')

    expect(events).toHaveLength(1)
    expect(events[0]).toEqual(expect.objectContaining({ type: 'NodeCreated' }))
  })
})
