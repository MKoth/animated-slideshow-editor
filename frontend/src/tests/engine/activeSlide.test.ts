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
  it('has no active slide before one is set', () => {
    const { engine } = setup()

    expect(engine.activeSlideId).toBeNull()
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

  it('clears the active slide when the active slide is removed', () => {
    const { engine, firstId, secondId } = setup()
    engine.setActiveSlide(secondId)

    engine.removeSlide(secondId)

    expect(engine.activeSlideId).toBeNull()
    expect(engine.setActiveSlide(firstId)).toBeUndefined()
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
