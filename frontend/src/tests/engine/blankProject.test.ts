import { describe, expect, it } from 'vitest'
import { createBlankProject } from '../../engine'
import { serialize } from '../../engine/lessonSerializer'

describe('createBlankProject', () => {
  it('creates a project with a fresh id and the given name', () => {
    const { project } = createBlankProject('My Lesson')

    expect(project.name).toBe('My Lesson')
    expect(project.id).toMatch(/^project-/)
    expect(project.description).toBe('')
    expect(project.author).toBe('')
    expect(project.createdAt).not.toBe('')
    expect(project.updatedAt).not.toBe('')
    expect(project.settings).toEqual({})
  })

  it('gives every fresh project a new id', () => {
    const { project: first } = createBlankProject('A')
    const { project: second } = createBlankProject('B')

    expect(first.id).not.toBe(second.id)
  })

  it('serializes as lesson version 1', () => {
    const { project, clips } = createBlankProject('A')
    const json = JSON.parse(serialize(project, clips)) as { version: number }

    expect(json.version).toBe(1)
  })

  it('starts with exactly one slide named "Slide 1" at the default duration', () => {
    const { project } = createBlankProject('A')

    expect(project.slides).toHaveLength(1)
    expect(project.slides[0].name).toBe('Slide 1')
    expect(project.slides[0].duration).toBe(10)
    expect(project.slides[0].animation.toJSON()).toEqual({ nodes: [] })
  })

  it('builds the slide scene with a root and a camera child', () => {
    const { project } = createBlankProject('A')
    const scene = project.slides[0].scene

    expect(scene.root.name).toBe('Root')
    expect(scene.root.parent).toBeNull()
    expect(scene.camera.name).toBe('Camera')
    expect(scene.camera.components.camera).toEqual({ kind: 'camera' })
    expect(scene.camera.parent).toBe(scene.root)
    expect(scene.root.children).toContain(scene.camera)
  })

  it('creates distinct ids for every project entity', () => {
    const { project } = createBlankProject('A')
    const ids = [
      project.id,
      project.slides[0].id,
      project.slides[0].scene.id,
      project.slides[0].scene.root.id,
      project.slides[0].scene.camera.id,
    ]

    expect(new Set(ids).size).toBe(ids.length)
  })
})
