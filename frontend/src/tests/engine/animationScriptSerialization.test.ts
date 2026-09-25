import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import type { CompiledFootprint } from '../../engine/compiledFootprint'
import { LESSON_VERSION, deserialize, serialize, validate } from '../../engine/lessonSerializer'
import type { LessonJSON } from '../../engine/json'

const FOOTPRINT: CompiledFootprint = {
  from: 0.5,
  to: 3.25,
  tracks: [
    {
      nodeId: 'node-boy',
      target: { kind: 'node', nodeId: 'node-boy', property: 'positionX' },
    },
    {
      nodeId: 'node-boy',
      target: { kind: 'node', nodeId: 'node-boy', parameter: 'tint' },
    },
    {
      nodeId: 'node-rig',
      target: { kind: 'control', nodeId: 'node-rig', controlKey: 'pose' },
    },
  ],
  placementParents: ['node-rig'],
  instanceNodes: ['node-boy'],
  entryVersions: { 'entry-wave': 2, 'entry-fly': 7 },
}

function buildEngine() {
  const engine = createEngine()
  engine.createProject({ name: 'Lesson' })
  const slide = engine.createSlide('Intro')
  return { engine, slide }
}

function projectJson(engine: ReturnType<typeof createEngine>): LessonJSON {
  return JSON.parse(serialize(engine.project!)) as LessonJSON
}

describe('Animation Script persistence', () => {
  it('round-trips source and compiled footprint through serialize and deserialize', () => {
    const { engine, slide } = buildEngine()
    engine.setSlideAnimationScript(slide.id, {
      source: 'script "Hello" from 0.5\nwait(1s)\n',
      lastCompiled: FOOTPRINT,
    })

    const json = projectJson(engine)
    expect(json.version).toBe(LESSON_VERSION)
    expect(json.slides[0].animationScript).toEqual({
      source: 'script "Hello" from 0.5\nwait(1s)\n',
      lastCompiled: FOOTPRINT,
    })

    const restored = deserialize(JSON.stringify(json))
    expect(restored.slides[0].animationScript).toEqual({
      source: 'script "Hello" from 0.5\nwait(1s)\n',
      lastCompiled: FOOTPRINT,
    })
  })

  it('round-trips a source that has never been compiled', () => {
    const { engine, slide } = buildEngine()
    engine.setSlideAnimationScript(slide.id, { source: 'script "Draft" from 0' })

    const json = projectJson(engine)
    expect(json.slides[0].animationScript).toEqual({ source: 'script "Draft" from 0' })

    const restored = deserialize(JSON.stringify(json))
    expect(restored.slides[0].animationScript).toEqual({ source: 'script "Draft" from 0' })
  })

  it('omits the field for slides without a script, so an untouched file loads unchanged', () => {
    const { engine } = buildEngine()

    const json = projectJson(engine)
    expect(json.slides[0].animationScript).toBeUndefined()
    expect(serialize(engine.project!)).not.toContain('animationScript')

    const restored = deserialize(JSON.stringify(json))
    expect(restored.slides[0].animationScript).toBeNull()
    expect(json.version).toBe(LESSON_VERSION)
  })

  it('rejects a malformed animationScript instead of silently dropping it', () => {
    const { engine, slide } = buildEngine()
    engine.setSlideAnimationScript(slide.id, { source: 'ok' })
    const json = projectJson(engine)

    const badSource = JSON.parse(JSON.stringify(json)) as LessonJSON
    ;(badSource.slides[0] as unknown as Record<string, unknown>).animationScript = { source: 42 }
    expect(validate(badSource).join('; ')).toMatch(/animationScript.*source/i)

    const badFootprint = JSON.parse(JSON.stringify(json)) as LessonJSON
    ;(badFootprint.slides[0] as unknown as Record<string, unknown>).animationScript = {
      source: 'ok',
      lastCompiled: { from: 0, to: 1, tracks: [{ nodeId: 'n', target: { kind: 'nope' } }] },
    }
    expect(validate(badFootprint).join('; ')).toMatch(/animationScript.*lastCompiled/i)
  })

  it('accepts an empty source as a created but unwritten script', () => {
    const { engine, slide } = buildEngine()
    engine.setSlideAnimationScript(slide.id, { source: '' })

    const json = projectJson(engine)
    expect(validate(json)).toEqual([])

    const restored = deserialize(JSON.stringify(json))
    expect(restored.slides[0].animationScript).toEqual({ source: '' })
  })
})
