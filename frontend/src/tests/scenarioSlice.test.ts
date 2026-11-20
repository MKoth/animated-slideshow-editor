import { describe, expect, it, vi } from 'vitest'
import {
  createScenarioSlice,
  initialScenarioSliceState,
  type ScenarioSliceState,
} from '../stores/scenarioSlice'

describe('scenario markdown version loading', () => {
  it('does not let an older in-flight reload replace a newer saved version', async () => {
    const oldVersion = {
      id: 'v-old',
      projectId: 'p-1',
      conversationId: 'c-1',
      messageId: null,
      summary: 'Before manual edit',
      touchedSteps: [1],
      timestamp: '2026-01-01T00:00:00.000Z',
      content: 'OLD markdown',
      baseVersionId: null,
    }
    const latestVersion = {
      ...oldVersion,
      id: 'v-latest',
      summary: 'Manual edit',
      content: 'LATEST markdown',
    }
    let resolveOldVersions!: (versions: (typeof oldVersion)[]) => void
    const oldVersions = new Promise<(typeof oldVersion)[]>((resolve) => {
      resolveOldVersions = resolve
    })
    const listMarkdownVersions = vi
      .fn()
      .mockReturnValueOnce(oldVersions)
      .mockResolvedValueOnce([oldVersion, latestVersion])
    const getActiveMarkdownVersion = vi
      .fn()
      .mockResolvedValueOnce({ activeVersionId: 'v-latest', acceptedVersionId: null })
      .mockResolvedValueOnce({ activeVersionId: 'v-old', acceptedVersionId: null })

    let state = {
      ...initialScenarioSliceState,
      api: { listMarkdownVersions, getActiveMarkdownVersion },
    } as ScenarioSliceState & {
      api: {
        listMarkdownVersions: typeof listMarkdownVersions
        getActiveMarkdownVersion: typeof getActiveMarkdownVersion
      }
    }
    const set = (
      update: Partial<typeof state> | ((current: typeof state) => Partial<typeof state>),
    ) => {
      state = { ...state, ...(typeof update === 'function' ? update(state) : update) }
    }
    const actions = createScenarioSlice(set, () => state)

    const olderLoad = actions.loadMarkdownVersions('p-1', 'c-1')
    await actions.loadMarkdownVersions('p-1', 'c-1')
    resolveOldVersions([oldVersion])
    await olderLoad

    expect(state.markdownVersionsByProject['p-1']?.map((version) => version.id)).toEqual([
      'v-old',
      'v-latest',
    ])
    expect(state.activeMarkdownVersionIdByProject['p-1']).toBe('v-latest')
  })
})
