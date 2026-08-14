import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import { serialize } from '../../engine/lessonSerializer'
import {
  CreateProjectCommand,
  CreateSlideCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { CommandResult } from '../../engine/commands'
import { collectEvents, makeProject } from './helpers'

function setup() {
  const engine = createEngine()
  engine.createProject({ name: 'Current', description: 'old', author: 'Me' })
  const first = engine.createSlide('Old A')
  const second = engine.createSlide('Old B')
  engine.setActiveSlide(second.id)
  return { engine, oldSlideIds: [first.id, second.id] }
}

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

describe('openProject', () => {
  it('replaces the in-memory project wholesale and activates the first slide', () => {
    const { engine } = setup()
    const incoming = makeProject('New', ['N1', 'N2', 'N3'])

    engine.openProject(incoming)

    expect(engine.project).toBe(incoming)
    expect(engine.project?.name).toBe('New')
    expect(engine.activeSlideId).toBe(incoming.slides[0].id)
  })

  it('resets the active slide to the first slide even when another slide was active', () => {
    const { engine } = setup()
    const incoming = makeProject('New', ['N1', 'N2'])

    engine.openProject(incoming)

    expect(engine.activeSlideId).toBe(incoming.slides[0].id)
    expect(engine.getSlide(incoming.slides[0].id).name).toBe('N1')
    expect(engine.getSlide(incoming.slides[1].id).name).toBe('N2')
  })

  it('emits ProjectLoaded followed by SlideActivated in that order', () => {
    const { engine } = setup()
    const incoming = makeProject('New', ['N1', 'N2'])
    const events = collectEvents(engine)

    engine.openProject(incoming)

    expect(events).toEqual([
      { type: 'ProjectLoaded', projectId: incoming.id },
      { type: 'SlideActivated', slideId: incoming.slides[0].id },
    ])
  })

  it('emits only ProjectLoaded and leaves the active slide null when the project has no slides', () => {
    const { engine } = setup()
    const incoming = makeProject('Empty')
    const events = collectEvents(engine)

    engine.openProject(incoming)

    expect(engine.project).toBe(incoming)
    expect(engine.activeSlideId).toBeNull()
    expect(events).toEqual([{ type: 'ProjectLoaded', projectId: incoming.id }])
  })

  it('rejects an invalid project (empty slide name) with the current project untouched', () => {
    const { engine, oldSlideIds } = setup()
    const incoming = makeProject('New', ['N1'])
    incoming.slides[0].name = ''
    const events = collectEvents(engine)
    const before = engine.toJSON()

    expect(() => engine.openProject(incoming)).toThrow(/name/i)

    expect(engine.project?.name).toBe('Current')
    expect(engine.activeSlideId).toBe(oldSlideIds[1])
    expect(engine.toJSON()).toEqual(before)
    expect(events).toEqual([])
    expect(() => engine.getSlide(incoming.slides[0].id)).toThrow(/not found/i)
  })

  it('rejects an invalid project (duplicate slide id) with the current project untouched', () => {
    const { engine } = setup()
    const incoming = makeProject('New', ['N1'])
    incoming.slides.push(incoming.slides[0])

    expect(() => engine.openProject(incoming)).toThrow(/already exists/i)

    expect(engine.project?.name).toBe('Current')
    expect(() => engine.getSlide(incoming.slides[0].id)).toThrow(/not found/i)
  })

  it('clears the execution log when opened through the command system', () => {
    const system = createCommandSystem()
    expectOk(system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    expect(system.undoStack.entries.length).toBeGreaterThan(0)

    system.engine.openProject(makeProject('New', ['N1']))

    expect(system.undoStack.entries).toHaveLength(0)
  })

  it('makes the previous project data unreachable', () => {
    const { engine, oldSlideIds } = setup()
    const oldNodeId = engine.project?.slides[0].scene.root.id
    if (!oldNodeId) {
      throw new Error('expected a node id')
    }
    engine.openProject(makeProject('New', ['N1']))

    for (const slideId of oldSlideIds) {
      expect(() => engine.getSlide(slideId)).toThrow(/not found/i)
    }
    expect(() => engine.getNode(oldNodeId)).toThrow(/not found/i)
  })

  it('round-trips: toJSON after opening equals the serialized incoming project', () => {
    const { engine } = setup()
    const incoming = makeProject('New', ['N1', 'N2'])

    engine.openProject(incoming)

    expect(JSON.stringify(engine.toJSON())).toBe(serialize(incoming))
  })

  it('opens onto a fresh engine that has no project', () => {
    const engine = createEngine()
    const incoming = makeProject('New', ['N1'])
    const events = collectEvents(engine)

    engine.openProject(incoming)

    expect(engine.project).toBe(incoming)
    expect(engine.activeSlideId).toBe(incoming.slides[0].id)
    expect(events).toEqual([
      { type: 'ProjectLoaded', projectId: incoming.id },
      { type: 'SlideActivated', slideId: incoming.slides[0].id },
    ])
  })
})
