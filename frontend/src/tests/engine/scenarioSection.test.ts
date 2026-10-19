import { describe, expect, it } from 'vitest'
import {
  appendScenarioVersion,
  createEmptyScenarioSection,
  createScenarioVersion,
  duplicateScenarioSection,
  getScenarioSection,
  getUnresolvableScenarioBindings,
  scanScenarioAssetKeys,
  scenarioSectionFromJSON,
  scenarioSectionToJSON,
  setScenarioSection,
  validateScenarioSection,
  withScenarioBindings,
  withScenarioMarkdown,
} from '../../engine/scenarioSection'
import type { LessonJSON } from '../../engine/json'

function lessonWithScenario(scenario: unknown): LessonJSON {
  return {
    version: 2,
    project: {
      id: 'p-1',
      name: 'Lesson',
      description: '',
      author: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
    },
    slides: [],
    ...(scenario !== undefined ? { scenario: scenario as never } : {}),
  } as unknown as LessonJSON
}

describe('scenarioSection', () => {
  it('creates an empty doc and appends versions append-only with currentMarkdown tracking', () => {
    const empty = createEmptyScenarioSection('# Title\n\n## Step 1 — One\n\nHi.\n')
    expect(empty.currentMarkdown).toContain('Step 1')
    expect(empty.versions).toHaveLength(0)

    const v1 = createScenarioVersion(empty.currentMarkdown, 'Initial draft', [1])
    const withV1 = appendScenarioVersion(empty, v1)
    expect(withV1.versions).toHaveLength(1)
    expect(withV1.currentMarkdown).toBe(v1.content)
    expect(empty.versions).toHaveLength(0)

    const v2 = createScenarioVersion(`${v1.content}\n\nMore.`, 'Add more', [1])
    const withV2 = appendScenarioVersion(withV1, v2)
    expect(withV2.versions.map((v) => v.id)).toEqual([v1.id, v2.id])
    expect(withV1.versions).toHaveLength(1)
  })

  it('edits markdown and bindings immutably', () => {
    const section = createEmptyScenarioSection('## Step 1 — One\n\nHi.\n')
    const edited = withScenarioMarkdown(section, '## Step 1 — One\n\nHello.\n')
    expect(edited.currentMarkdown).toContain('Hello')
    expect(section.currentMarkdown).toContain('Hi')

    const bound = withScenarioBindings(edited, { hi: 'def-1' })
    expect(bound.bindings).toEqual({ hi: 'def-1' })
    expect(edited.bindings).toEqual({})
  })

  it('validates shape without blocking on markdown warnings', () => {
    const errors: string[] = []
    validateScenarioSection(
      lessonWithScenario({
        currentMarkdown: '## Step 1 — One\n\nHi.\n',
        versions: [],
        bindings: {},
      }),
      errors,
    )
    expect(errors).toEqual([])

    const bad: string[] = []
    validateScenarioSection(lessonWithScenario({ currentMarkdown: 7 }), bad)
    expect(bad.length).toBeGreaterThan(0)

    const nonObject: string[] = []
    validateScenarioSection(lessonWithScenario('oops'), nonObject)
    expect(nonObject.join(' ')).toMatch(/object/i)
  })

  it('reads additive-tolerantly: old files without scenario load as undefined', () => {
    expect(scenarioSectionFromJSON(lessonWithScenario(undefined))).toBeUndefined()
    const section = scenarioSectionFromJSON(
      lessonWithScenario({ currentMarkdown: '## Step 1 — One\n\nHi.\n' }),
    )
    expect(section?.currentMarkdown).toContain('Step 1')
    expect(section?.versions).toEqual([])
    expect(section?.bindings).toEqual({})
  })

  it('round-trips through get/set helpers preserving unknown keys', () => {
    const json = lessonWithScenario(undefined)
    const section = {
      ...createEmptyScenarioSection('md'),
      futureField: 'keep-me',
    }
    const withScenario = setScenarioSection(json, scenarioSectionToJSON(section))
    expect(getScenarioSection(withScenario)?.futureField).toBe('keep-me')
    const round = scenarioSectionFromJSON(withScenario)
    expect(round?.futureField).toBe('keep-me')
  })

  it('duplicates verbatim with no id remap and deep isolation', () => {
    const v = createScenarioVersion('md', 'First', [1])
    const original = withScenarioBindings(
      appendScenarioVersion(createEmptyScenarioSection('md'), v),
      {
        cat: 'def-cat',
      },
    )
    const copy = duplicateScenarioSection(original)
    expect(copy).toEqual(original)
    expect(copy?.versions[0]?.id).toBe(v.id)
    if (copy) {
      ;(copy.bindings as Record<string, string>).cat = 'changed'
      expect(original.bindings.cat).toBe('def-cat')
    }
  })

  it('scans live asset keys from markdown in order', () => {
    const keys = scanScenarioAssetKeys(
      [
        '## Step 1 — One',
        '',
        '![Young doctor smiling](asset:young-doctor-smiling)',
        '',
        '> Brief: Portrait.',
        '',
        'Text.',
        '',
        '## Step 2 — Two',
        '',
        '![Cat](asset:cat)',
        '',
        '> Brief: Cat.',
        '',
        'More.',
        '',
      ].join('\n'),
    )
    expect(keys).toEqual(['young-doctor-smiling', 'cat'])
  })

  it('reports unresolvable bindings ignoring empty and available ids', () => {
    const section = withScenarioBindings(createEmptyScenarioSection('md'), {
      cat: 'def-cat',
      dog: 'def-dog',
      empty: '',
    })
    const unresolvable = getUnresolvableScenarioBindings(section, new Set(['def-cat']))
    expect(unresolvable).toEqual([{ key: 'dog', assetId: 'def-dog' }])
  })
})
