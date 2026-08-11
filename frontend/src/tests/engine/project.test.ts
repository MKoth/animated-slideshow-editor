import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import { collectEvents } from './helpers'

describe('project lifecycle', () => {
  it('starts with no project in memory', () => {
    const engine = createEngine()

    expect(engine.project).toBeNull()
  })

  it('creates a project with its metadata and emits ProjectCreated', () => {
    const engine = createEngine()
    const events = collectEvents(engine)

    const project = engine.createProject({
      name: 'My Lesson',
      description: 'A test lesson',
      author: 'Tester',
    })

    expect(engine.project).toBe(project)
    expect(project.name).toBe('My Lesson')
    expect(project.description).toBe('A test lesson')
    expect(project.author).toBe('Tester')
    expect(project.createdAt).toBeTruthy()
    expect(project.updatedAt).toBeTruthy()
    expect(events).toEqual([{ type: 'ProjectCreated', projectId: project.id }])
  })

  it('rejects a second project while one exists', () => {
    const engine = createEngine()
    engine.createProject({ name: 'One' })

    expect(() => engine.createProject({ name: 'Two' })).toThrow(/already exists/)
    expect(engine.project?.name).toBe('One')
  })

  it('rejects a project without a name', () => {
    const engine = createEngine()

    expect(() => engine.createProject({ name: '' })).toThrow(/name/i)
  })
})

describe('slide lifecycle', () => {
  it('creates slides in order, each with a scene that has a root node', () => {
    const engine = createEngine()
    const project = engine.createProject({ name: 'P' })

    const intro = engine.createSlide('Intro')
    const body = engine.createSlide('Body')

    expect(project.slides.map((slide) => slide.name)).toEqual(['Intro', 'Body'])
    expect(project.slides[0]).toBe(intro)
    expect(project.slides[1]).toBe(body)

    const scene = intro.scene
    expect(scene.root.name).toBe('Root')
    expect(scene.root.parent).toBeNull()
    expect(scene.root.children).toEqual([scene.camera])
    expect(scene.getNode(scene.root.id)).toBe(scene.root)
  })

  it('emits SlideCreated for each slide', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const events = collectEvents(engine)

    const slide = engine.createSlide('Intro')

    expect(events).toEqual([{ type: 'SlideCreated', slideId: slide.id }])
  })

  it('removes a slide and emits SlideRemoved', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const first = engine.createSlide('One')
    engine.createSlide('Two')

    const events = collectEvents(engine)
    engine.removeSlide(first.id)

    expect(engine.project?.slides.map((slide) => slide.name)).toEqual(['Two'])
    expect(events).toEqual([{ type: 'SlideRemoved', slideId: first.id }])
  })

  it('fails to remove an unknown slide with a meaningful error', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    engine.createSlide('One')

    expect(() => engine.removeSlide('does-not-exist')).toThrow(/slide.*not found/i)
  })

  it('requires a project before slides can be managed', () => {
    const engine = createEngine()

    expect(() => engine.createSlide('Orphan')).toThrow(/project/i)
    expect(() => engine.removeSlide('anything')).toThrow(/project/i)
  })

  it('looks up a slide by id', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('Intro')

    expect(engine.getSlide(slide.id)).toBe(slide)
    expect(() => engine.getSlide('nope')).toThrow(/slide.*not found/i)
  })
})
