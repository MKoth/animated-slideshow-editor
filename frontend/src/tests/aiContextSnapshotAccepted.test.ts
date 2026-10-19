import { describe, expect, it } from 'vitest'
import { buildContextSnapshot } from '../ai/contextSnapshot'
import type { EnginePublic } from '../engine'

function mockEngine(): EnginePublic {
  const root = { id: 'root', name: 'Root', children: [] }
  return {
    project: { id: 'p-1', name: 'Lesson', slides: [] },
    materialDefinitions: [],
    shaderDefinitions: [],
    clips: [],
    getActiveSlide: () => ({ id: 's-1', name: 'Intro', duration: 5, scene: { root } }),
    getNode: () => {
      throw new Error('missing')
    },
  } as unknown as EnginePublic
}

describe('context snapshot accepted version', () => {
  it('carries active and accepted version lines with the markdown working view', () => {
    const snapshot = buildContextSnapshot(mockEngine(), {
      scenarioMarkdown: '## Step 1 -- Hi',
      scenarioActiveVersion: { id: 'v-active', summary: 'Draft', touchedSteps: [1] },
      scenarioAcceptedVersion: { id: 'v-accepted', summary: 'Stable', touchedSteps: [1, 2] },
    })
    expect(snapshot.scenarioMarkdown).toContain('## Step 1')
    expect(snapshot.scenarioActiveVersion?.id).toBe('v-active')
    expect(snapshot.scenarioAcceptedVersion?.id).toBe('v-accepted')
    expect(snapshot.scenarioAcceptedVersion?.summary).toBe('Stable')
  })

  it('omits version lines when none are set', () => {
    const snapshot = buildContextSnapshot(mockEngine(), { scenarioMarkdown: '## Step 1' })
    expect(snapshot.scenarioActiveVersion).toBeUndefined()
    expect(snapshot.scenarioAcceptedVersion).toBeUndefined()
  })
})
