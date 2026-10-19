import { describe, expect, it } from 'vitest'
import { createEngine } from '../../engine/internal'
import { deserialize, serialize, validate } from '../../engine/lessonSerializer'
import { duplicateLessonJSON } from '../../app/projectDuplication'
import {
  appendScenarioVersion,
  createEmptyScenarioSection,
  createScenarioVersion,
  getUnresolvableScenarioBindings,
  withScenarioBindings,
} from '../../engine/scenarioSection'
import { upgradeLegacyScenarioToMarkdown } from '../../engine/scenarioMarkdown'
import type { LessonJSON } from '../../engine/json'

const SCENARIO_MD = [
  '# Ser vs Estar — Mini Lesson',
  '',
  '## Step 1 — Who you are',
  '',
  '**Narrator:** Ser is for who you are.',
  '',
  '![Young doctor smiling](asset:young-doctor-smiling)',
  '',
  '> Brief: Warm portrait.',
  '',
  '| Spanish | English |',
  '| --- | --- |',
  '| Soy doctora | I am a doctor |',
  '',
  'You say **soy** tomorrow.',
  '',
].join('\n')

describe('scenario markdown doc travels with the project', () => {
  it('author can create and edit a doc; save round-trips verbatim including versions and bindings', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Lesson' })
    engine.createSlide('Slide 1')
    const project = engine.project!
    const v1 = createScenarioVersion(SCENARIO_MD, 'Initial draft', [1])
    const section = withScenarioBindings(
      appendScenarioVersion(createEmptyScenarioSection(SCENARIO_MD), v1),
      { 'young-doctor-smiling': 'def-doctor' },
    )
    project.setScenario(section)

    const json = engine.toJSON()
    expect(json.scenario?.currentMarkdown).toBe(SCENARIO_MD)
    expect(json.scenario?.versions).toHaveLength(1)
    expect(json.scenario?.bindings).toEqual({ 'young-doctor-smiling': 'def-doctor' })

    const restored = createEngine()
    restored.restoreFromJSON(JSON.parse(JSON.stringify(json)))
    expect(restored.project?.scenario?.currentMarkdown).toBe(SCENARIO_MD)
    expect(restored.project?.scenario?.versions[0]?.summary).toBe('Initial draft')
    expect(restored.project?.scenario?.bindings).toEqual({ 'young-doctor-smiling': 'def-doctor' })
    expect(restored.toJSON()).toEqual(json)
  })

  it('old files without a scenario section still load', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Old' })
    engine.createSlide('S1')
    const json = JSON.parse(serialize(engine.project!)) as LessonJSON
    expect('scenario' in json).toBe(false)
    expect(validate(json)).toEqual([])

    const restored = createEngine()
    expect(() => restored.restoreFromJSON(json)).not.toThrow()
    expect(restored.project?.scenario).toBeUndefined()
  })

  it('duplicate keeps history verbatim with no id remap', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Original' })
    engine.createSlide('S1')
    const v1 = createScenarioVersion(SCENARIO_MD, 'First', [1])
    const v2 = createScenarioVersion(`${SCENARIO_MD}\n\nMore.`, 'Second', [1])
    let section = appendScenarioVersion(createEmptyScenarioSection(SCENARIO_MD), v1)
    section = appendScenarioVersion(section, v2)
    section = withScenarioBindings(section, { 'young-doctor-smiling': 'def-doctor' })
    engine.project!.setScenario(section)

    const duplicated = duplicateLessonJSON(engine.toJSON(), ['Original', 'Other'])
    expect(duplicated.scenario?.versions?.map((v: { id: string }) => v.id)).toEqual([v1.id, v2.id])
    expect(duplicated.scenario?.bindings).toEqual({ 'young-doctor-smiling': 'def-doctor' })
  })

  it('legacy spoken-line arrives as narrator and on-screen-action as text plus brief seed', () => {
    const md = upgradeLegacyScenarioToMarkdown([
      {
        partTag: 'middle',
        spokenLine: 'Ser is for identity.',
        onScreenAction: 'Chalk text appears line by line',
        assetHints: ['blackboard'],
      },
    ])
    const engine = createEngine()
    engine.createProject({ name: 'Legacy' })
    engine.createSlide('S1')
    engine.project!.setScenario(createEmptyScenarioSection(md))
    const json = engine.toJSON()
    expect(json.scenario?.currentMarkdown).toContain('**Narrator:** Ser is for identity.')
    expect(json.scenario?.currentMarkdown).toContain('Chalk text appears line by line')
  })

  it('unresolvable bindings are reported for the Missing Assets flow', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Lesson' })
    engine.createSlide('S1')
    const section = withScenarioBindings(createEmptyScenarioSection(SCENARIO_MD), {
      'young-doctor-smiling': 'def-missing',
    })
    engine.project!.setScenario(section)
    const available = new Set<string>([...engine.embeddedAssets.map((a) => a.id)])
    const unresolvable = getUnresolvableScenarioBindings(engine.project!.scenario, available)
    expect(unresolvable).toEqual([{ key: 'young-doctor-smiling', assetId: 'def-missing' }])
  })

  it('serializes through the LESSON_VERSION pipeline without errors', () => {
    const engine = createEngine()
    engine.createProject({ name: 'Lesson' })
    engine.createSlide('S1')
    engine.project!.setScenario(createEmptyScenarioSection(SCENARIO_MD))
    const text = serialize(engine.project!)
    const back = deserialize(text)
    expect(back.scenario?.currentMarkdown).toBe(SCENARIO_MD)
  })
})
