import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  AddKeyframeCommand,
  AssignMaterialCommand,
  CommandDispatcher,
  CreateAssetInstanceCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DuplicateSlideCommand,
  MoveKeyframeCommand,
  OverrideMaterialParameterCommand,
  RenameNodeCommand,
  SetSlideDurationCommand,
  UndoStack,
} from '../../engine/commands'
import { createEngine } from '../../engine/internal'
import { deserialize, serialize } from '../../engine/lessonSerializer'
import { walkPreOrder } from '../../engine/sceneNode'
import type { Scene } from '../../engine/scene'
import { collectEvents } from './helpers'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

const ANIMATABLE_PROPERTIES = [
  'positionX',
  'positionY',
  'opacity',
  'scaleX',
  'scaleY',
  'rotation',
] as const

function addKeyframe(
  dispatcher: CommandDispatcher,
  nodeId: string,
  property: (typeof ANIMATABLE_PROPERTIES)[number],
  time: number,
  value: number,
) {
  expectOk(dispatcher.dispatch(new AddKeyframeCommand({ nodeId, property, time, value })))
}

function keyframeIds(engine: ReturnType<typeof createEngine>, scene: Scene): Set<string> {
  return new Set(
    [...walkPreOrder(scene.root)].flatMap((node) =>
      ANIMATABLE_PROPERTIES.flatMap((property) =>
        engine.getKeyframes(node.id, property).map((keyframe) => keyframe.id),
      ),
    ),
  )
}

function findNode(scene: Scene, name: string) {
  for (const node of walkPreOrder(scene.root)) {
    if (node.name === name) {
      return node
    }
  }
  throw new Error(`Node not found: ${name}`)
}

function slideNames(engine: ReturnType<typeof createEngine>): string[] {
  return engine.project?.slides.map((slide) => slide.name) ?? []
}

function setup() {
  const engine = createEngine()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack)
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  const { slideId } = expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  const slide = engine.getSlide(slideId)
  const definition = engine.defineAsset('Boy')
  const { nodeId: boyId } = expectOk(
    dispatcher.dispatch(
      new CreateAssetInstanceCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        definitionId: definition.id,
        name: 'Boy',
        position: { x: 12, y: 34 },
        rotation: 0.5,
        scaleX: 2,
        scaleY: 3,
      }),
    ),
  )
  expectOk(
    dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: boyId,
        name: 'Hat',
        transform: { x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1 },
        opacity: 0.5,
      }),
    ),
  )
  expectOk(
    dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Rule',
        components: {
          text: { kind: 'text', content: 'Yo corro', fontSize: 48, alignment: 'center' },
        },
      }),
    ),
  )
  addKeyframe(dispatcher, boyId, 'positionX', 3, 100)
  addKeyframe(dispatcher, boyId, 'positionX', 7, 200)
  addKeyframe(dispatcher, boyId, 'opacity', 5, 0.5)
  addKeyframe(dispatcher, slide.scene.camera.id, 'positionX', 2, 10)
  return { engine, dispatcher, undoStack, slide, definition, boyId }
}

describe('DuplicateSlideCommand', () => {
  it('lands the copy immediately after the source, activates it, emits SlideDuplicated + SlideActivated, and records the new slide id as inverse', () => {
    const { engine, dispatcher, undoStack, slide } = setup()
    const events = collectEvents(engine)

    const inverse = expectOk(dispatcher.dispatch(new DuplicateSlideCommand({ slideId: slide.id })))

    expect(inverse).toEqual({ slideId: expect.any(String) })
    expect(inverse.slideId).not.toBe(slide.id)
    expect(slideNames(engine)).toEqual(['S1', 'S1'])
    const copy = engine.getSlide(inverse.slideId)
    expect(copy.duration).toBe(slide.duration)
    expect(engine.activeSlideId).toBe(inverse.slideId)
    expect(events).toEqual([
      { type: 'SlideDuplicated', slideId: inverse.slideId },
      { type: 'SlideActivated', slideId: inverse.slideId },
    ])
    expect(undoStack.entries[0]).toMatchObject({
      type: 'DuplicateSlide',
      parameters: { slideId: slide.id },
      inverse,
    })
  })

  it('rejects duplicating a slide that does not exist, leaving the engine unchanged', () => {
    const { engine, dispatcher, undoStack } = setup()
    const events = collectEvents(engine)
    const before = undoStack.entries.length

    const result = dispatcher.dispatch(new DuplicateSlideCommand({ slideId: 'ghost' }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/slide.*not found/i)
    }
    expect(engine.project?.slides).toHaveLength(1)
    expect(engine.activeSlideId).not.toBe('ghost')
    expect(events).toEqual([])
    expect(undoStack.entries).toHaveLength(before)
  })

  it('gives the copy all-new ids: slide, scene, every node including the camera, and every keyframe', () => {
    const { engine, dispatcher, slide } = setup()
    const sourceNodes = [...walkPreOrder(slide.scene.root)]
    const copy = engine.getSlide(
      expectOk(dispatcher.dispatch(new DuplicateSlideCommand({ slideId: slide.id }))).slideId,
    )
    const copyNodes = [...walkPreOrder(copy.scene.root)]

    expect(copy.id).not.toBe(slide.id)
    expect(copy.scene.id).not.toBe(slide.scene.id)
    expect(copy.scene.camera.id).not.toBe(slide.scene.camera.id)
    expect(copyNodes).toHaveLength(sourceNodes.length)
    expect(new Set(copyNodes.map((node) => node.id))).toHaveLength(copyNodes.length)
    for (const source of sourceNodes) {
      expect(copyNodes.some((node) => node.id === source.id)).toBe(false)
    }
    const sourceKeyframeIds = keyframeIds(engine, slide.scene)
    for (const copied of copyNodes) {
      for (const property of ANIMATABLE_PROPERTIES) {
        for (const keyframe of engine.getKeyframes(copied.id, property)) {
          expect(sourceKeyframeIds.has(keyframe.id)).toBe(false)
        }
      }
    }
  })

  it('copies the node graph identically: same names, order, transforms, visibility, opacity, and components', () => {
    const { engine, dispatcher, slide } = setup()
    const copy = engine.getSlide(
      expectOk(dispatcher.dispatch(new DuplicateSlideCommand({ slideId: slide.id }))).slideId,
    )
    const sourceNodes = [...walkPreOrder(slide.scene.root)]
    const copyNodes = [...walkPreOrder(copy.scene.root)]

    expect(copyNodes.map((node) => node.name)).toEqual(sourceNodes.map((node) => node.name))
    for (let i = 0; i < sourceNodes.length; i += 1) {
      const source = sourceNodes[i]
      const copied = copyNodes[i]
      expect(copied.transform).toEqual(source.transform)
      expect(copied.visible).toBe(source.visible)
      expect(copied.opacity).toBe(source.opacity)
      expect(copied.parent ? copied.parent.id : null).toBe(
        source.parent ? copyNodes[sourceNodes.indexOf(source.parent)].id : null,
      )
      expect(copied.children.map((child) => child.id)).toEqual(
        source.children.map((child) => copyNodes[sourceNodes.indexOf(child)].id),
      )
      expect(copied.components.camera !== undefined).toBe(source.components.camera !== undefined)
      expect(copied.components.text).toEqual(source.components.text)
    }
  })

  it('shares asset-definition references with the source instead of deep-copying them', () => {
    const { engine, dispatcher, slide, definition } = setup()
    const copy = engine.getSlide(
      expectOk(dispatcher.dispatch(new DuplicateSlideCommand({ slideId: slide.id }))).slideId,
    )

    const sourceBoy = findNode(slide.scene, 'Boy')
    const copiedBoy = findNode(copy.scene, 'Boy')
    expect(copiedBoy.components.assetInstance).toEqual({
      kind: 'assetInstance',
      assetDefinitionId: definition.id,
    })
    expect(copiedBoy.components.assetInstance?.assetDefinitionId).toBe(
      sourceBoy.components.assetInstance?.assetDefinitionId,
    )
  })

  it('copies material instances and the fullscreen shader reference with the slide', () => {
    const { engine, dispatcher, slide } = setup()
    engine.registerMaterialDefinition('mat-1', 'Warm')
    const sourceBoy = findNode(slide.scene, 'Boy')
    const sourceHat = findNode(slide.scene, 'Hat')
    expectOk(
      dispatcher.dispatch(
        new AssignMaterialCommand({ nodeId: sourceBoy.id, materialDefinitionId: 'mat-1' }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({
          nodeId: sourceBoy.id,
          parameter: 'tint',
          value: '#ff0000',
        }),
      ),
    )
    slide.fullscreenShader = { shaderDefinitionId: 'shader-1', overrides: { strength: 0.5 } }

    const copy = engine.getSlide(
      expectOk(dispatcher.dispatch(new DuplicateSlideCommand({ slideId: slide.id }))).slideId,
    )

    const copiedBoy = findNode(copy.scene, 'Boy')
    const copiedHat = findNode(copy.scene, 'Hat')
    expect(copiedBoy.material).toEqual({
      materialDefinitionId: 'mat-1',
      overrides: { tint: '#ff0000' },
    })
    expect(copiedHat.material).toEqual(sourceHat.material)
    expect(copy.fullscreenShader).toEqual({
      shaderDefinitionId: 'shader-1',
      overrides: { strength: 0.5 },
    })

    copy.fullscreenShader = null
    expect(slide.fullscreenShader).toEqual({
      shaderDefinitionId: 'shader-1',
      overrides: { strength: 0.5 },
    })
  })

  it('remaps every keyframe to the copied nodes with new ids and identical times and values', () => {
    const { engine, dispatcher, slide } = setup()
    const copy = engine.getSlide(
      expectOk(dispatcher.dispatch(new DuplicateSlideCommand({ slideId: slide.id }))).slideId,
    )
    const sourceBoy = findNode(slide.scene, 'Boy')
    const copiedBoy = findNode(copy.scene, 'Boy')
    const copiedCamera = findNode(copy.scene, 'Camera')

    expect(
      engine.getKeyframes(copiedBoy.id, 'positionX').map((keyframe) => ({
        time: keyframe.time,
        value: keyframe.value,
      })),
    ).toEqual([
      { time: 3, value: 100 },
      { time: 7, value: 200 },
    ])
    expect(engine.getKeyframes(copiedBoy.id, 'opacity').map((keyframe) => keyframe.value)).toEqual([
      0.5,
    ])
    expect(
      engine.getKeyframes(copiedCamera.id, 'positionX').map((keyframe) => keyframe.time),
    ).toEqual([2])

    const copiedKeyframeIds = keyframeIds(engine, copy.scene)
    expect(copiedKeyframeIds.size).toBe(4)
    const sourceKeyframeIds = keyframeIds(engine, slide.scene)
    expect(sourceKeyframeIds.size).toBe(4)
    for (const id of copiedKeyframeIds) {
      expect(sourceKeyframeIds.has(id)).toBe(false)
    }
    expect(engine.getKeyframes(sourceBoy.id, 'positionX')).toHaveLength(2)
  })

  it('registers every copied node in the copy scene, so the copy resolves like any scene', () => {
    const { engine, dispatcher, slide } = setup()
    const copy = engine.getSlide(
      expectOk(dispatcher.dispatch(new DuplicateSlideCommand({ slideId: slide.id }))).slideId,
    )

    for (const node of walkPreOrder(copy.scene.root)) {
      expect(copy.scene.getNode(node.id)).toBe(node)
    }
    expect(copy.scene.getNode(copy.scene.camera.id)).toBe(copy.scene.camera)
    expect(copy.scene.getNode(copy.scene.root.id)).toBe(copy.scene.root)
  })

  it('keeps the copied animation fully independent: editing the copy leaves the source untouched', () => {
    const { engine, dispatcher, slide } = setup()
    const copy = engine.getSlide(
      expectOk(dispatcher.dispatch(new DuplicateSlideCommand({ slideId: slide.id }))).slideId,
    )
    const sourceBoy = findNode(slide.scene, 'Boy')
    const copiedBoy = findNode(copy.scene, 'Boy')
    const copiedKeyframe = engine.getKeyframes(copiedBoy.id, 'positionX')[0]
    if (!copiedKeyframe) {
      throw new Error('expected a copied keyframe')
    }

    expectOk(dispatcher.dispatch(new RenameNodeCommand({ nodeId: copiedBoy.id, name: 'Boy copy' })))
    expectOk(
      dispatcher.dispatch(
        new MoveKeyframeCommand({
          nodeId: copiedBoy.id,
          property: 'positionX',
          keyframeId: copiedKeyframe.id,
          newTime: 4.5,
        }),
      ),
    )
    expectOk(dispatcher.dispatch(new SetSlideDurationCommand({ slideId: copy.id, duration: 20 })))

    expect(findNode(slide.scene, 'Boy').name).toBe('Boy')
    expect(engine.getKeyframes(sourceBoy.id, 'positionX').map((keyframe) => keyframe.time)).toEqual(
      [3, 7],
    )
    expect(slide.duration).toBe(10)
  })

  it('round-trips the duplicated project through serialize/deserialize with identical structure and values', () => {
    const { engine, dispatcher, slide } = setup()
    const { slideId: copyId } = expectOk(
      dispatcher.dispatch(new DuplicateSlideCommand({ slideId: slide.id })),
    )
    const project = engine.project
    if (!project) {
      throw new Error('No project exists in memory')
    }

    const restored = deserialize(serialize(project))

    expect(restored.slides).toHaveLength(2)
    const restoredCopy = restored.slides[1]
    expect(restoredCopy.id).toBe(copyId)
    expect(restoredCopy.name).toBe('S1')
    expect(restoredCopy.duration).toBe(slide.duration)
    expect(restoredCopy.scene.toJSON()).toEqual(engine.getSlide(copyId).scene.toJSON())
    expect(restoredCopy.animation.toJSON()).toEqual(engine.getSlide(copyId).animation.toJSON())
  })

  it('serializes to JSON with its type and parameters', () => {
    expect(new DuplicateSlideCommand({ slideId: 'slide-1' }).toJSON()).toEqual({
      type: 'DuplicateSlide',
      slideId: 'slide-1',
    })
  })
})
