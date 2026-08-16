import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  AddKeyframeCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DeleteSlideCommand,
  MoveSlideCommand,
  RenameSlideCommand,
  SetSlideDurationCommand,
  createCommandSystem,
} from '../../engine/commands'
import { deserialize, serialize } from '../../engine/lessonSerializer'

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function collectEvents(system: ReturnType<typeof createCommandSystem>) {
  const events: unknown[] = []
  system.engine.subscribe((event) => events.push(event))
  return events
}

function setup(slideNames: readonly string[] = ['S1']) {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  const slideIds: string[] = []
  for (const name of slideNames) {
    const { slideId } = expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name })))
    slideIds.push(slideId)
  }
  return { system, slideIds }
}

function addNode(system: ReturnType<typeof createCommandSystem>, slideId: string, id: string) {
  const slide = system.engine.getSlide(slideId)
  expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: id,
        id,
      }),
    ),
  )
}

function addKeyframe(
  system: ReturnType<typeof createCommandSystem>,
  nodeId: string,
  property: 'positionX' | 'positionY' | 'opacity' | 'scaleX' | 'scaleY' | 'rotation',
  time: number,
  value: number,
) {
  expectOk(
    system.dispatcher.dispatch(
      new AddKeyframeCommand({ target: { kind: 'node', nodeId, property }, time, value }),
    ),
  )
}

function slideNames(system: ReturnType<typeof createCommandSystem>): string[] {
  return system.engine.project?.slides.map((slide) => slide.name) ?? []
}

describe('RenameSlideCommand', () => {
  it('renames the slide, emits SlideRenamed, and records the old name as inverse', () => {
    const { system, slideIds } = setup(['Intro'])
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new RenameSlideCommand({ slideId: slideIds[0], name: 'Overview' }),
    )

    expect(expectOk(result)).toEqual({ slideId: slideIds[0], oldName: 'Intro' })
    expect(slideNames(system)).toEqual(['Overview'])
    expect(events).toEqual([{ type: 'SlideRenamed', slideId: slideIds[0] }])
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'RenameSlide',
      parameters: { slideId: slideIds[0], name: 'Overview' },
      inverse: { slideId: slideIds[0], oldName: 'Intro' },
    })
  })

  it('rejects an empty or blank name, leaving the engine unchanged', () => {
    const { system, slideIds } = setup(['Intro'])
    const events = collectEvents(system)

    for (const name of ['', '   ']) {
      const result = system.dispatcher.dispatch(
        new RenameSlideCommand({ slideId: slideIds[0], name }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toMatch(/name/i)
      }
    }

    expect(slideNames(system)).toEqual(['Intro'])
    expect(events).toEqual([])
    expect(system.undoStack.entries).toHaveLength(2)
  })

  it('rejects renaming a slide that does not exist', () => {
    const { system } = setup()

    const result = system.dispatcher.dispatch(
      new RenameSlideCommand({ slideId: 'ghost', name: 'X' }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/slide.*not found/i)
    }
    expect(system.undoStack.entries).toHaveLength(2)
  })

  it('serializes to JSON with its type and parameters', () => {
    const command = new RenameSlideCommand({ slideId: 'slide-1', name: 'New' })

    expect(command.toJSON()).toEqual({
      type: 'RenameSlide',
      slideId: 'slide-1',
      name: 'New',
    })
  })
})

describe('MoveSlideCommand', () => {
  it('moves the slide to the target index, emits SlideMoved, and records the old index', () => {
    const { system, slideIds } = setup(['A', 'B', 'C'])
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new MoveSlideCommand({ slideId: slideIds[2], index: 0 }),
    )

    expect(expectOk(result)).toEqual({ slideId: slideIds[2], oldIndex: 2 })
    expect(slideNames(system)).toEqual(['C', 'A', 'B'])
    expect(events).toEqual([{ type: 'SlideMoved', slideId: slideIds[2] }])
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'MoveSlide',
      parameters: { slideId: slideIds[2], index: 0 },
      inverse: { slideId: slideIds[2], oldIndex: 2 },
    })
  })

  it('rejects out-of-bounds and non-integer indexes, leaving the engine unchanged', () => {
    const { system, slideIds } = setup(['A', 'B', 'C'])
    const events = collectEvents(system)

    for (const index of [-1, 3, 1.5, Number.NaN]) {
      const result = system.dispatcher.dispatch(
        new MoveSlideCommand({ slideId: slideIds[0], index }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toMatch(/index/i)
      }
    }

    expect(slideNames(system)).toEqual(['A', 'B', 'C'])
    expect(events).toEqual([])
    expect(system.undoStack.entries).toHaveLength(4)
  })

  it('rejects moving a slide that does not exist', () => {
    const { system } = setup()

    const result = system.dispatcher.dispatch(new MoveSlideCommand({ slideId: 'ghost', index: 0 }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/slide.*not found/i)
    }
  })

  it('serializes to JSON with its type and parameters', () => {
    const command = new MoveSlideCommand({ slideId: 'slide-1', index: 2 })

    expect(command.toJSON()).toEqual({ type: 'MoveSlide', slideId: 'slide-1', index: 2 })
  })
})

describe('SetSlideDurationCommand', () => {
  it('sets the duration, emits SlideDurationChanged, and records the old duration', () => {
    const { system, slideIds } = setup()
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(
      new SetSlideDurationCommand({ slideId: slideIds[0], duration: 25 }),
    )

    expect(expectOk(result)).toEqual({
      slideId: slideIds[0],
      oldDuration: 10,
      clampedKeyframes: [],
    })
    expect(system.engine.getSlide(slideIds[0]).duration).toBe(25)
    expect(events).toEqual([{ type: 'SlideDurationChanged', slideId: slideIds[0] }])
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'SetSlideDuration',
      parameters: { slideId: slideIds[0], duration: 25 },
    })
  })

  it('accepts the boundary values 0.1 and 3600', () => {
    const { system, slideIds } = setup()

    for (const duration of [0.1, 3600]) {
      const result = system.dispatcher.dispatch(
        new SetSlideDurationCommand({ slideId: slideIds[0], duration }),
      )
      expect(result.ok).toBe(true)
      expect(system.engine.getSlide(slideIds[0]).duration).toBe(duration)
    }
  })

  it('rejects out-of-bounds and invalid durations, leaving the engine unchanged', () => {
    const { system, slideIds } = setup(['S'])
    const events = collectEvents(system)

    for (const duration of [0, 0.05, -5, 3600.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = system.dispatcher.dispatch(
        new SetSlideDurationCommand({ slideId: slideIds[0], duration }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.message).toMatch(/duration/i)
      }
    }

    expect(system.engine.getSlide(slideIds[0]).duration).toBe(10)
    expect(events).toEqual([])
    expect(system.undoStack.entries).toHaveLength(2)
  })

  it('rejects setting the duration of a slide that does not exist', () => {
    const { system } = setup()

    const result = system.dispatcher.dispatch(
      new SetSlideDurationCommand({ slideId: 'ghost', duration: 20 }),
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/slide.*not found/i)
    }
  })

  it('clamps keyframes beyond a shortened duration and records their old times', () => {
    const { system, slideIds } = setup(['S'])
    addNode(system, slideIds[0], 'node-boy')
    const events = collectEvents(system)

    addKeyframe(system, 'node-boy', 'positionX', 6, 100)
    addKeyframe(system, 'node-boy', 'positionX', 8, 200)
    addKeyframe(system, 'node-boy', 'positionX', 10, 300)
    addKeyframe(system, 'node-boy', 'opacity', 9, 0.5)
    addKeyframe(system, 'node-boy', 'positionY', 2, 40)
    events.length = 0

    const result = system.dispatcher.dispatch(
      new SetSlideDurationCommand({ slideId: slideIds[0], duration: 5 }),
    )

    const inverse = expectOk(result)
    expect(inverse).toEqual({
      slideId: slideIds[0],
      oldDuration: 10,
      clampedKeyframes: [
        { nodeId: 'node-boy', property: 'positionX', keyframeId: expect.any(String), oldTime: 6 },
        { nodeId: 'node-boy', property: 'positionX', keyframeId: expect.any(String), oldTime: 8 },
        { nodeId: 'node-boy', property: 'positionX', keyframeId: expect.any(String), oldTime: 10 },
        { nodeId: 'node-boy', property: 'opacity', keyframeId: expect.any(String), oldTime: 9 },
      ],
    })
    const times = system.engine.getKeyframes('node-boy', 'positionX').map((kf) => kf.time)
    expect(times).toEqual([5, 5, 5])
    const positionY = system.engine.getKeyframes('node-boy', 'positionY')[0]
    expect(positionY?.time).toBe(2)
    const opacity = system.engine.getKeyframes('node-boy', 'opacity')[0]
    expect(opacity?.time).toBe(5)
  })

  it('keeps every keyframe within the duration after clamping (timeline invariant)', () => {
    const { system, slideIds } = setup(['S'])
    addNode(system, slideIds[0], 'node-boy')

    addKeyframe(system, 'node-boy', 'positionX', 3, 100)
    addKeyframe(system, 'node-boy', 'positionX', 9, 200)
    addKeyframe(system, 'node-boy', 'positionY', 7, 50)
    addKeyframe(system, 'node-boy', 'scaleX', 2, 2)

    expectOk(
      system.dispatcher.dispatch(
        new SetSlideDurationCommand({ slideId: slideIds[0], duration: 4 }),
      ),
    )

    for (const property of ['positionX', 'positionY', 'scaleX'] as const) {
      for (const kf of system.engine.getKeyframes('node-boy', property)) {
        expect(kf.time).toBeLessThanOrEqual(4)
      }
    }
    expect(system.engine.getKeyframes('node-boy', 'positionX').map((kf) => kf.time)).toEqual([3, 4])
  })

  it('round-trips a slide whose clamped keyframes share the duration time', () => {
    const { system, slideIds } = setup(['S'])
    addNode(system, slideIds[0], 'node-boy')
    addKeyframe(system, 'node-boy', 'positionX', 7, 100)
    addKeyframe(system, 'node-boy', 'positionX', 9, 200)
    expectOk(
      system.dispatcher.dispatch(
        new SetSlideDurationCommand({ slideId: slideIds[0], duration: 6 }),
      ),
    )

    const project = system.engine.project
    if (!project) {
      throw new Error('No project exists in memory')
    }
    const restored = deserialize(serialize(project))

    const animation = restored.slides[0].animation.node('node-boy')
    expect(animation?.keyframes('positionX').map((kf) => kf.time)).toEqual([6, 6])
  })

  it('serializes to JSON with its type and parameters', () => {
    const command = new SetSlideDurationCommand({ slideId: 'slide-1', duration: 30 })

    expect(command.toJSON()).toEqual({ type: 'SetSlideDuration', slideId: 'slide-1', duration: 30 })
  })
})

describe('CreateSlideCommand defaults', () => {
  it('names a created slide "Slide 1" with duration 10, a camera-born scene, and activates it', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new CreateSlideCommand({}))

    const { slideId } = expectOk(result)
    const slide = system.engine.getSlide(slideId)
    expect(slide.name).toBe('Slide 1')
    expect(slide.duration).toBe(10)
    expect(slide.scene.camera.name).toBe('Camera')
    expect(slide.scene.root.children).toContain(slide.scene.camera)
    expect(system.engine.activeSlideId).toBe(slideId)
    expect(events).toEqual([
      { type: 'SlideCreated', slideId },
      { type: 'SlideActivated', slideId },
    ])
  })

  it('uses the next unused "Slide N" ordinal', () => {
    const { system } = setup(['Slide 1', 'Slide 3', 'Intro'])

    const { slideId } = expectOk(system.dispatcher.dispatch(new CreateSlideCommand({})))

    expect(system.engine.getSlide(slideId).name).toBe('Slide 2')
    expect(slideNames(system)).toEqual(['Slide 1', 'Slide 3', 'Intro', 'Slide 2'])
  })
})

describe('DeleteSlideCommand refinements', () => {
  it('rejects deleting the last remaining slide, leaving the engine unchanged', () => {
    const { system, slideIds } = setup(['Only'])
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new DeleteSlideCommand({ slideId: slideIds[0] }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toMatch(/last/i)
    }
    expect(system.engine.project?.slides).toHaveLength(1)
    expect(events).toEqual([])
    expect(system.undoStack.entries).toHaveLength(2)
  })

  it('deleting the active slide repoints the active slide to the slide now at its index', () => {
    const { system, slideIds } = setup(['A', 'B', 'C'])
    system.engine.setActiveSlide(slideIds[1])
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new DeleteSlideCommand({ slideId: slideIds[1] }))

    expect(expectOk(result).slideId).toBe(slideIds[1])
    expect(slideNames(system)).toEqual(['A', 'C'])
    expect(system.engine.activeSlideId).toBe(slideIds[2])
    expect(events).toEqual([
      { type: 'SlideRemoved', slideId: slideIds[1] },
      { type: 'SlideActivated', slideId: slideIds[2] },
    ])
  })

  it('deleting the last slide repoints the active slide to the new last slide', () => {
    const { system, slideIds } = setup(['A', 'B', 'C'])
    system.engine.setActiveSlide(slideIds[2])
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new DeleteSlideCommand({ slideId: slideIds[2] }))

    expect(expectOk(result).slideId).toBe(slideIds[2])
    expect(slideNames(system)).toEqual(['A', 'B'])
    expect(system.engine.activeSlideId).toBe(slideIds[1])
    expect(events).toEqual([
      { type: 'SlideRemoved', slideId: slideIds[2] },
      { type: 'SlideActivated', slideId: slideIds[1] },
    ])
  })

  it('deleting a non-active slide keeps the active slide and emits no SlideActivated', () => {
    const { system, slideIds } = setup(['A', 'B', 'C'])
    system.engine.setActiveSlide(slideIds[2])
    const events = collectEvents(system)

    const result = system.dispatcher.dispatch(new DeleteSlideCommand({ slideId: slideIds[0] }))

    expect(expectOk(result).slideId).toBe(slideIds[0])
    expect(system.engine.activeSlideId).toBe(slideIds[2])
    expect(events).toEqual([{ type: 'SlideRemoved', slideId: slideIds[0] }])
  })

  it('records the full removed slide payload as inverse', () => {
    const { system, slideIds } = setup(['A', 'B'])
    const slide = system.engine.getSlide(slideIds[0])
    const inverse = expectOk(
      system.dispatcher.dispatch(new DeleteSlideCommand({ slideId: slideIds[0] })),
    )

    expect(inverse.slideJSON).toMatchObject({
      id: slideIds[0],
      name: 'A',
      duration: 10,
    })
    expect(inverse.slideJSON.scene.nodes.map((node) => node.id)).toContain(slide.scene.camera.id)
  })
})
