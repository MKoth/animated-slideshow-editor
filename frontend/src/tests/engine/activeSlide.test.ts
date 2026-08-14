import { describe, expect, it, vi } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  CreateProjectCommand,
  CreateSlideCommand,
  createCommandSystem,
} from '../../engine/commands'
import { createEngine } from '../../engine/internal'
import { collectEvents } from './helpers'

function setup() {
  const engine = createEngine()
  engine.createProject({ name: 'P' })
  const first = engine.createSlide('First')
  const second = engine.createSlide('Second')
  return {
    engine,
    firstId: first.id,
    secondId: second.id,
  }
}

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

describe('active slide', () => {
  it('has no active slide in a fresh engine before any slide exists', () => {
    const engine = createEngine()

    expect(engine.activeSlideId).toBeNull()
  })

  it('creates a slide as the active slide and emits SlideActivated', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const events = collectEvents(engine)

    const slide = engine.createSlide('First')

    expect(engine.activeSlideId).toBe(slide.id)
    expect(events).toEqual([
      { type: 'SlideCreated', slideId: slide.id },
      { type: 'SlideActivated', slideId: slide.id },
    ])
  })

  it('setActiveSlide updates the active slide and emits SlideActivated with the id', () => {
    const { engine, secondId } = setup()
    const events = collectEvents(engine)

    const result = engine.setActiveSlide(secondId)

    expect(result).toBeUndefined()
    expect(engine.activeSlideId).toBe(secondId)
    expect(events).toEqual([{ type: 'SlideActivated', slideId: secondId }])
  })

  it('emits SlideActivated each time the active slide changes', () => {
    const { engine, firstId, secondId } = setup()
    const events = collectEvents(engine)

    engine.setActiveSlide(firstId)
    engine.setActiveSlide(secondId)

    expect(engine.activeSlideId).toBe(secondId)
    expect(events).toEqual([
      { type: 'SlideActivated', slideId: firstId },
      { type: 'SlideActivated', slideId: secondId },
    ])
  })

  it('rejects an unknown slide id, leaving the active slide unchanged and emitting nothing', () => {
    const { engine, firstId } = setup()
    engine.setActiveSlide(firstId)
    const events = collectEvents(engine)

    expect(() => engine.setActiveSlide('missing-slide')).toThrow(/Slide not found/)

    expect(engine.activeSlideId).toBe(firstId)
    expect(events).toEqual([])
  })

  it('rejects a switch when no project exists', () => {
    const engine = createEngine()

    expect(() => engine.setActiveSlide('any')).toThrow(/No project exists/)
    expect(engine.activeSlideId).toBeNull()
  })

  it('repoints the active slide to the slide now at the deleted index when the active slide is removed', () => {
    const { engine, firstId, secondId } = setup()
    engine.setActiveSlide(secondId)
    const events = collectEvents(engine)

    engine.removeSlide(secondId)

    expect(engine.activeSlideId).toBe(firstId)
    expect(events).toEqual([
      { type: 'SlideRemoved', slideId: secondId },
      { type: 'SlideActivated', slideId: firstId },
    ])
  })

  it('repoints the active slide to the new last slide when the last slide is removed', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const first = engine.createSlide('First')
    const second = engine.createSlide('Second')
    const third = engine.createSlide('Third')
    engine.setActiveSlide(third.id)
    const events = collectEvents(engine)

    engine.removeSlide(third.id)

    expect(engine.activeSlideId).toBe(second.id)
    expect(events).toEqual([
      { type: 'SlideRemoved', slideId: third.id },
      { type: 'SlideActivated', slideId: second.id },
    ])
    expect(engine.setActiveSlide(first.id)).toBeUndefined()
  })

  it('refuses to remove the last remaining slide', () => {
    const { engine, firstId, secondId } = setup()
    engine.removeSlide(firstId)

    expect(() => engine.removeSlide(secondId)).toThrow(/last/i)
    expect(engine.project?.slides).toHaveLength(1)
  })

  it('keeps the active slide when a different slide is removed', () => {
    const { engine, firstId, secondId } = setup()
    engine.setActiveSlide(secondId)

    engine.removeSlide(firstId)

    expect(engine.activeSlideId).toBe(secondId)
  })

  it('writes no undo entry and no command-log entry for a switch', () => {
    const log = vi.fn()
    const system = createCommandSystem(log)
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    const { slideId } = expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const undoEntriesBefore = system.undoStack.entries.length
    const logCallsBefore = log.mock.calls.length

    system.engine.setActiveSlide(slideId)

    expect(system.engine.activeSlideId).toBe(slideId)
    expect(system.undoStack.entries).toHaveLength(undoEntriesBefore)
    expect(system.undoStack.entries.map((entry) => entry.type)).not.toContain('SetActiveSlide')
    expect(log.mock.calls).toHaveLength(logCallsBefore)
  })
})
