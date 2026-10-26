import { beforeEach, describe, expect, it } from 'vitest'
import {
  buildScriptWorkflowFingerprint,
  useScenarioScriptWorkflowStore,
} from '../stores/scenarioScriptWorkflowStore'
import type { PlannerResult } from '../ai/scenarioPlanner'

function fakePlan(): PlannerResult {
  return {
    slides: [],
    diagnostics: [],
    ops: { creates: [], renames: [], deletes: [], keeps: [] },
    blocked: false,
  }
}

beforeEach(() => {
  useScenarioScriptWorkflowStore.setState({ workflowsByProject: {} })
  useScenarioScriptWorkflowStore.persist.clearStorage()
})

describe('scenarioScriptWorkflowStore', () => {
  it('saves a preview and tracks per-step completion', () => {
    const store = useScenarioScriptWorkflowStore.getState()
    store.savePreview('p-1', {
      acceptedVersionId: 'v1',
      fingerprint: 'fp',
      plan: fakePlan(),
      foreignWords: [],
      prompterApplied: false,
      ttsDone: {},
      boardDone: {},
    })
    expect(
      useScenarioScriptWorkflowStore.getState().workflowsByProject['p-1']?.prompterApplied,
    ).toBe(false)

    useScenarioScriptWorkflowStore.getState().markPrompterApplied('p-1')
    useScenarioScriptWorkflowStore.getState().markTtsDone('p-1', 2)
    useScenarioScriptWorkflowStore.getState().markBoardDone('p-1', 1)
    const workflow = useScenarioScriptWorkflowStore.getState().workflowsByProject['p-1']!
    expect(workflow.prompterApplied).toBe(true)
    expect(workflow.ttsDone).toEqual({ 2: true })
    expect(workflow.boardDone).toEqual({ 1: true })
  })

  it('re-applying the prompter resets per-step states', () => {
    const store = useScenarioScriptWorkflowStore.getState()
    store.savePreview('p-1', {
      acceptedVersionId: 'v1',
      fingerprint: 'fp',
      plan: fakePlan(),
      foreignWords: [],
      prompterApplied: false,
      ttsDone: {},
      boardDone: {},
    })
    store.markPrompterApplied('p-1')
    store.markTtsDone('p-1', 1)
    store.markBoardDone('p-1', 1)
    // Re-apply: parts are recreated, so old TTS/board work is invalid.
    store.markPrompterApplied('p-1')
    const workflow = useScenarioScriptWorkflowStore.getState().workflowsByProject['p-1']!
    expect(workflow.prompterApplied).toBe(true)
    expect(workflow.ttsDone).toEqual({})
    expect(workflow.boardDone).toEqual({})
  })

  it('clears a project workflow', () => {
    const store = useScenarioScriptWorkflowStore.getState()
    store.savePreview('p-1', {
      acceptedVersionId: 'v1',
      fingerprint: 'fp',
      plan: fakePlan(),
      foreignWords: [],
      prompterApplied: false,
      ttsDone: {},
      boardDone: {},
    })
    store.clearWorkflow('p-1')
    expect(useScenarioScriptWorkflowStore.getState().workflowsByProject['p-1']).toBeUndefined()
  })

  it('fingerprints distinguish plan inputs', () => {
    const base = {
      secondsPerCharacter: 0.1,
      splitChars: ['.', '!'],
      bindings: { a: 'b' },
      html: '<section>hi</section>',
      foreignWords: ['ser'],
    }
    expect(buildScriptWorkflowFingerprint(base)).toBe(buildScriptWorkflowFingerprint(base))
    expect(buildScriptWorkflowFingerprint({ ...base, secondsPerCharacter: 0.2 })).not.toBe(
      buildScriptWorkflowFingerprint(base),
    )
    expect(buildScriptWorkflowFingerprint({ ...base, bindings: { a: 'c' } })).not.toBe(
      buildScriptWorkflowFingerprint(base),
    )
    expect(buildScriptWorkflowFingerprint({ ...base, html: '<section>other</section>' })).not.toBe(
      buildScriptWorkflowFingerprint(base),
    )
    expect(buildScriptWorkflowFingerprint({ ...base, foreignWords: ['estar'] })).not.toBe(
      buildScriptWorkflowFingerprint(base),
    )
  })
})
