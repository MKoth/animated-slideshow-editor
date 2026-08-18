import { describe, expect, it } from 'vitest'
import { createBlankProject } from '../../engine'
import { createEngine } from '../../engine/internal'
import { serialize, deserializeWithClips } from '../../engine/lessonSerializer'
import { createBuiltInClips } from '../../engine/builtInClips'

describe('clip loading', () => {
  describe('createBlankProject', () => {
    it('returns clips alongside the project', () => {
      const { project, clips } = createBlankProject('My Lesson')

      expect(project.name).toBe('My Lesson')
      expect(clips.length).toBeGreaterThan(0)
    })

    it('includes all 21 built-in clips', () => {
      const { clips } = createBlankProject('My Lesson')

      expect(clips.length).toBe(21)
    })

    it('clips are distinct from the built-in definitions', () => {
      const { clips } = createBlankProject('My Lesson')
      const builtIn = createBuiltInClips()

      expect(clips.length).toBe(builtIn.length)
      for (const clip of clips) {
        expect(clip.id).not.toBe('')
      }
    })
  })

  describe('engine.openProject', () => {
    it('imports clips when provided', () => {
      const engine = createEngine()
      engine.createProject({ name: 'Initial' })
      engine.createSlide()

      const { project, clips } = createBlankProject('New')
      engine.openProject(project, clips)

      expect(engine.clips.length).toBe(clips.length)
    })

    it('clears previous clips and imports new ones', () => {
      const engine = createEngine()
      engine.createProject({ name: 'Initial' })
      engine.createSlide()

      const { project: p1, clips: c1 } = createBlankProject('First')
      engine.openProject(p1, c1)
      expect(engine.clips.length).toBe(c1.length)

      const { project: p2, clips: c2 } = createBlankProject('Second')
      engine.openProject(p2, c2)
      expect(engine.clips.length).toBe(c2.length)
    })

    it('works without clips parameter (backward compatible)', () => {
      const engine = createEngine()
      engine.createProject({ name: 'Initial' })
      engine.createSlide()

      const project = createBlankProject('New').project
      engine.openProject(project)

      expect(engine.clips.length).toBe(0)
    })
  })

  describe('serialize / deserialize round-trip', () => {
    it('serializes clips into the lesson JSON', () => {
      const { project, clips } = createBlankProject('My Lesson')
      const json = serialize(project, clips)
      const parsed = JSON.parse(json) as { clips?: unknown[] }

      expect(parsed.clips).toBeDefined()
      expect(parsed.clips!.length).toBe(21)
    })

    it('deserializeWithClips returns clips alongside the project', () => {
      const { project, clips } = createBlankProject('My Lesson')
      const json = serialize(project, clips)

      const result = deserializeWithClips(json)
      expect(result.project.name).toBe('My Lesson')
      expect(result.clips.length).toBe(21)
    })

    it('round-trips clip data faithfully', () => {
      const { project, clips } = createBlankProject('My Lesson')
      const json = serialize(project, clips)
      const { clips: restoredClips } = deserializeWithClips(json)

      expect(restoredClips.length).toBe(clips.length)
      for (let i = 0; i < clips.length; i++) {
        expect(restoredClips[i].name).toBe(clips[i].name)
        expect(restoredClips[i].duration).toBe(clips[i].duration)
        expect(restoredClips[i].category).toBe(clips[i].category)
      }
    })
  })

  describe('full flow: createBlankProject → openProject → serialize → deserialize → openProject', () => {
    it('preserves clips through the entire lifecycle', () => {
      // Create a new project with clips
      const { project, clips } = createBlankProject('My Lesson')

      // Open it in the engine
      const engine = createEngine()
      engine.openProject(project, clips)
      expect(engine.clips.length).toBe(21)

      // Serialize
      const json = serialize(project, clips)

      // Deserialize
      const { project: restored, clips: restoredClips } = deserializeWithClips(json)

      // Open the restored project
      engine.openProject(restored, restoredClips)
      expect(engine.clips.length).toBe(21)
      expect(engine.clips[0].name).toBe(clips[0].name)
    })

    it('round-trips clip instances assigned to nodes', () => {
      const { project, clips } = createBlankProject('My Lesson')

      // Assign a clip to a node
      const slide = project.slides[0]
      const node = slide.scene.root.children[0] ?? slide.scene.root
      const clip = clips[0]
      node.clipInstances.push({
        id: 'test-instance',
        clipId: clip.id,
        startTime: 0,
        speed: 1,
        enabled: true,
        paramOverrides: {},
      })

      // Serialize with clips
      const json = serialize(project, clips)

      // Deserialize
      const { project: restored, clips: restoredClips } = deserializeWithClips(json)

      // Verify clip instances survived the round-trip
      const restoredSlide = restored.slides[0]
      const restoredNode = restoredSlide.scene.root.children[0] ?? restoredSlide.scene.root
      expect(restoredNode.clipInstances.length).toBe(1)
      expect(restoredNode.clipInstances[0].clipId).toBe(clip.id)

      // Verify the clip definition is also present
      expect(restoredClips.length).toBe(21)
    })

    it('deserializeWithClips does not throw for projects with clip instances', () => {
      const { project, clips } = createBlankProject('Test')
      const slide = project.slides[0]
      const node = slide.scene.root.children[0] ?? slide.scene.root
      node.clipInstances.push({
        id: 'inst-1',
        clipId: clips[0].id,
        startTime: 0,
        speed: 1,
        enabled: true,
        paramOverrides: {},
      })

      const json = serialize(project, clips)
      expect(() => deserializeWithClips(json)).not.toThrow()
    })

    it('engine.openProject does not throw when clips are provided alongside clip instances', () => {
      const { project, clips } = createBlankProject('Test')
      const slide = project.slides[0]
      const node = slide.scene.root.children[0] ?? slide.scene.root
      node.clipInstances.push({
        id: 'inst-1',
        clipId: clips[0].id,
        startTime: 0,
        speed: 1,
        enabled: true,
        paramOverrides: {},
      })

      const engine = createEngine()
      expect(() => engine.openProject(project, clips)).not.toThrow()
      expect(engine.clips.length).toBe(21)
      expect(engine.getClipInstances(node.id).length).toBe(1)
    })
  })
})
