import { describe, expect, it } from 'vitest'
import {
  getAcceptedScenarioVersion,
  requireAcceptedScenarioVersion,
  withScenarioAcceptedVersion,
  createEmptyScenarioSection,
  appendScenarioVersion,
  scenarioSectionFromJSON,
  scenarioSectionToJSON,
  setScenarioSection,
  getScenarioSection,
  validateScenarioSection,
  duplicateScenarioSection,
} from '../../engine/scenarioSection'
import { requireAcceptedSnapshot, resolveAcceptedSnapshot } from '../../engine/scenarioVersions'
import type { LessonJSON } from '../../engine/json'

describe('accepted downstream snapshot', () => {
  it('resolves the accepted version and blocks without one', () => {
    const base = createEmptyScenarioSection('## Step 1 -- One')
    const v1 = appendScenarioVersion(base, {
      id: 'v-1',
      summary: 'First',
      touchedSteps: [1],
      timestamp: '2026-01-01T00:00:00Z',
      content: '## Step 1 -- One\n\nA.',
    })
    const v2 = appendScenarioVersion(v1, {
      id: 'v-2',
      summary: 'Second',
      touchedSteps: [1],
      timestamp: '2026-01-02T00:00:00Z',
      content: '## Step 1 -- One\n\nB.',
    })
    expect(getAcceptedScenarioVersion(v2)).toBeUndefined()
    expect(() => requireAcceptedScenarioVersion(v2)).toThrow('No accepted scenario version')

    const accepted = withScenarioAcceptedVersion(v2, 'v-1')
    // Newer drafts never move the accepted pointer.
    expect(accepted.currentMarkdown).toContain('B.')
    expect(getAcceptedScenarioVersion(accepted)?.id).toBe('v-1')
    expect(getAcceptedScenarioVersion(accepted)?.content).toContain('A.')
    expect(requireAcceptedScenarioVersion(accepted).id).toBe('v-1')
  })

  it('pure version-list helpers mirror the portable gate', () => {
    const versions = [{ id: 'v-1' }, { id: 'v-2' }]
    expect(resolveAcceptedSnapshot(versions, null)).toBeUndefined()
    expect(resolveAcceptedSnapshot(versions, 'v-1')?.id).toBe('v-1')
    expect(() => requireAcceptedSnapshot(versions, null)).toThrow('No accepted scenario version')
    expect(requireAcceptedSnapshot(versions, 'v-2').id).toBe('v-2')
  })

  it('travels in the portable file verbatim with additive-tolerant reads', () => {
    const base = createEmptyScenarioSection('## Step 1 -- One')
    const v1 = {
      id: 'v-1',
      summary: 'First',
      touchedSteps: [1],
      timestamp: '2026-01-01T00:00:00Z',
      content: '## Step 1 -- One\n\nA.',
    }
    const section = withScenarioAcceptedVersion(appendScenarioVersion(base, v1), 'v-1')
    const json = setScenarioSection(
      { version: 2, project: { id: 'p-1' } } as unknown as LessonJSON,
      scenarioSectionToJSON(section),
    )
    // Unknown keys preserved; accepted pointer survives the round-trip.
    expect(getScenarioSection(json)?.acceptedVersionId).toBe('v-1')
    const round = scenarioSectionFromJSON(json)
    expect(round?.acceptedVersionId).toBe('v-1')
    expect(getAcceptedScenarioVersion(round)?.content).toContain('A.')

    // Old files without the pointer still load; duplicate keeps it verbatim.
    const legacy = scenarioSectionFromJSON({
      version: 2,
      project: { id: 'p-1' },
      scenario: { currentMarkdown: 'md', versions: [], bindings: {} },
    } as unknown as LessonJSON)
    expect(legacy?.acceptedVersionId).toBeUndefined()
    expect(getAcceptedScenarioVersion(legacy)).toBeUndefined()
    expect(duplicateScenarioSection(section)?.acceptedVersionId).toBe('v-1')

    const errors: string[] = []
    validateScenarioSection(json, errors)
    expect(errors).toEqual([])
    const bad: string[] = []
    validateScenarioSection({ scenario: { acceptedVersionId: 7 } } as unknown as LessonJSON, bad)
    expect(bad.length).toBeGreaterThan(0)
  })
})
