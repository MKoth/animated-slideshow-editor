import { describe, expect, it } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DeleteSlideCommand,
  RenameSlideCommand,
  SetSlideAnimationScriptCommand,
  TransactionCommand,
  createCommandSystem,
} from '../../engine/commands'
import { serialize } from '../../engine/lessonSerializer'

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

function setup() {
  const system = createCommandSystem()
  expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  const { slideId } = expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  return { system, slideId }
}

function addNode(system: ReturnType<typeof createCommandSystem>, slideId: string, name: string) {
  const slide = system.engine.getSlide(slideId)
  expectOk(
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name,
      }),
    ),
  )
}

describe('SetSlideAnimationScriptCommand', () => {
  it('sets the source, emits SlideAnimationScriptChanged, and records the previous source as inverse', () => {
    const { system, slideId } = setup()
    const events = collectEvents(system)
    const source = 'script "Hi" from 0\n'

    const result = system.dispatcher.dispatch(
      new SetSlideAnimationScriptCommand({ slideId, source }),
    )

    expect(expectOk(result)).toEqual({ slideId, previousSource: null })
    expect(system.engine.getSlide(slideId).animationScript).toEqual({ source })
    expect(events).toEqual([{ type: 'SlideAnimationScriptChanged', slideId }])
    expect(system.undoStack.entries[0]).toMatchObject({
      type: 'SetSlideAnimationScript',
      parameters: { slideId, source },
      inverse: { slideId, previousSource: null },
    })
  })

  it('replaces an existing source and undo restores the previous text', () => {
    const { system, slideId } = setup()
    expectOk(
      system.dispatcher.dispatch(
        new SetSlideAnimationScriptCommand({ slideId, source: 'script "One" from 0' }),
      ),
    )

    expectOk(
      system.dispatcher.dispatch(
        new SetSlideAnimationScriptCommand({ slideId, source: 'script "Two" from 1' }),
      ),
    )
    expect(system.engine.getSlide(slideId).animationScript?.source).toBe('script "Two" from 1')

    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getSlide(slideId).animationScript?.source).toBe('script "One" from 0')

    expect(system.dispatcher.redo()).toBe(true)
    expect(system.engine.getSlide(slideId).animationScript?.source).toBe('script "Two" from 1')
  })

  it('undoing the first edit removes the script from the slide entirely', () => {
    const { system, slideId } = setup()
    expectOk(
      system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId, source: '' })),
    )

    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getSlide(slideId).animationScript).toBeNull()

    expect(system.dispatcher.redo()).toBe(true)
    expect(system.engine.getSlide(slideId).animationScript).toEqual({ source: '' })
  })

  it('keeps the compiled footprint untouched when the source is edited and undone', () => {
    const { system, slideId } = setup()
    const footprint = {
      from: 0,
      to: 2,
      tracks: [],
      placementParents: [],
      instanceNodes: [],
      entryVersions: {},
    }
    system.engine.getSlide(slideId).animationScript = { source: 'one', lastCompiled: footprint }

    expectOk(
      system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId, source: 'two' })),
    )

    expect(system.engine.getSlide(slideId).animationScript).toEqual({
      source: 'two',
      lastCompiled: footprint,
    })

    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getSlide(slideId).animationScript).toEqual({
      source: 'one',
      lastCompiled: footprint,
    })
  })

  it('rejects a missing slide and a non-string source without recording history', () => {
    const { system, slideId } = setup()
    const events = collectEvents(system)
    const before = system.undoStack.entries.length

    const missing = system.dispatcher.dispatch(
      new SetSlideAnimationScriptCommand({ slideId: 'ghost', source: 'x' }),
    )
    expect(missing.ok).toBe(false)
    if (!missing.ok) {
      expect(missing.error.message).toMatch(/slide.*not found/i)
    }

    const badSource = system.dispatcher.dispatch(
      new SetSlideAnimationScriptCommand({
        slideId,
        source: 42 as unknown as string,
      }),
    )
    expect(badSource.ok).toBe(false)
    if (!badSource.ok) {
      expect(badSource.error.message).toMatch(/source/i)
    }

    expect(system.undoStack.entries).toHaveLength(before)
    expect(events).toEqual([])
    expect(system.engine.getSlide(slideId).animationScript).toBeNull()
  })

  it('serializes to JSON with its type and parameters', () => {
    const command = new SetSlideAnimationScriptCommand({ slideId: 'slide-1', source: 'a' })

    expect(command.toJSON()).toEqual({
      type: 'SetSlideAnimationScript',
      slideId: 'slide-1',
      source: 'a',
    })
  })

  it('composes into a larger Transaction with one undo entry and no execution of its own', () => {
    const { system, slideId } = setup()
    const events = collectEvents(system)
    const before = system.undoStack.entries.length

    expectOk(
      system.dispatcher.dispatch(
        new TransactionCommand([
          new SetSlideAnimationScriptCommand({ slideId, source: 'script "T" from 0' }),
          new RenameSlideCommand({ slideId, name: 'Renamed' }),
        ]),
      ),
    )

    expect(system.undoStack.entries).toHaveLength(before + 1)
    expect(system.undoStack.entries[0].type).toBe('Transaction')
    expect(system.engine.getSlide(slideId).name).toBe('Renamed')
    expect(system.engine.getSlide(slideId).animationScript?.source).toBe('script "T" from 0')
    expect(events).toEqual([
      { type: 'SlideAnimationScriptChanged', slideId },
      { type: 'SlideRenamed', slideId },
    ])

    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getSlide(slideId).name).toBe('S1')
    expect(system.engine.getSlide(slideId).animationScript).toBeNull()

    expect(system.dispatcher.redo()).toBe(true)
    expect(system.engine.getSlide(slideId).name).toBe('Renamed')
    expect(system.engine.getSlide(slideId).animationScript?.source).toBe('script "T" from 0')
  })

  it('nothing but an explicit edit rewrites the source', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Boy')
    const source = 'script "Stable" from 0'
    expectOk(system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId, source })))

    expectOk(system.dispatcher.dispatch(new RenameSlideCommand({ slideId, name: 'Later' })))

    expect(system.engine.getSlide(slideId).animationScript?.source).toBe(source)
  })

  it('deletes the script with its slide, leaving no orphan source in the file', () => {
    const { system, slideId } = setup()
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Keep' })))
    const source = 'script "Gone" from 0'
    expectOk(system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId, source })))

    expectOk(system.dispatcher.dispatch(new DeleteSlideCommand({ slideId })))

    expect(() => system.engine.getSlide(slideId)).toThrow()
    expect(serialize(system.engine.project!)).not.toContain('Gone')
  })
})
