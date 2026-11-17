import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiScenarioModal } from '../components/ai/AiScenarioModal'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { createEmptyScenarioSection, withScenarioBindings } from '../engine/scenarioSection'
import { useAiStore } from '../stores/aiStore'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useBackendStore } from '../stores/backendStore'
import { useScenarioScriptWorkflowStore } from '../stores/scenarioScriptWorkflowStore'

const TWO_STEP_DOC = [
  '# Ser and Estar',
  '',
  '## Step 1 — Who you are',
  '',
  '**Narrator:** Ser is for who you are.',
  '',
  '![Oak tree](asset:oak-tree)',
  '',
  '> Brief: A sturdy oak.',
  '',
  '[place: oak-tree]',
  '',
  '[reveal: text1]',
  '',
  'Ser is identity.',
  '',
  '## Step 2 — Where you are',
  '',
  '**Narrator:** Estar is for where you are.',
  '',
  '![Melting ice](asset:melting-ice)',
  '',
  '> Brief: Melting ice cube.',
  '',
  '[place: melting-ice]',
  '',
  '[reveal: text2]',
  '',
  'Estar is temporary.',
  '',
].join('\n')

const ONE_STEP_DOC = TWO_STEP_DOC.split('\n## Step 2')[0]!.trimEnd() + '\n'

const BOUND_BINDINGS = { 'oak-tree': 'emb-oak', 'melting-ice': 'emb-ice' }

function toBase64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes))
}

function setupEngineWithPortable(
  currentMarkdown: string,
  portableVersions: Array<{ id: string; content: string }>,
) {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  let section = createEmptyScenarioSection(currentMarkdown)
  section = {
    ...section,
    currentMarkdown,
    versions: portableVersions.map((v, i) => ({
      id: v.id,
      summary: `Portable ${i}`,
      touchedSteps: [1],
      timestamp: `2026-01-0${i + 1}T00:00:00Z`,
      content: v.content,
    })),
  }
  section = withScenarioBindings(section, BOUND_BINDINGS)
  engine.project!.setScenario(section)
  for (const id of new Set(Object.values(BOUND_BINDINGS))) {
    engine.embedAsset({
      id,
      name: `${id}.png`,
      data: toBase64([137, 80, 78, 71, 1, 2, 3]),
      mimeType: 'image/png',
    })
  }
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatcher,
    dispatch: dispatcher.dispatch.bind(dispatcher) as unknown as EngineContextValue['dispatch'],
    persistence: { save: vi.fn(), onCommandSucceeded: () => undefined, dispose: () => undefined },
  }
  return { engine, value }
}

function resetStores() {
  useAiStore.setState({
    conversations: [],
    messagesById: {},
    activeByProject: {},
    drafts: {},
    search: '',
    panelOpen: true,
    settingsOpen: false,
    status: 'idle',
    streamingConversationId: null,
    streamingContent: '',
    lastError: null,
    assistantMode: 'scenario',
    proposals: [],
    proposalById: {},
    activeProposalId: null,
    proposalBusy: false,
    proposalError: null,
    scenarios: [],
    scenarioById: {},
    activeScenarioId: null,
    scenarioGenerating: false,
    scenarioError: null,
    scenarioRequest: '',
    markdownVersionsByProject: {},
    activeMarkdownVersionIdByProject: {},
    acceptedMarkdownVersionIdByProject: {},
    markdownAuditsByProject: {},
    markdownBusy: false,
    markdownError: null,
    scenarioTab: 'doc',
    scenarioModalOpen: true,
    scenarioMissingOnly: false,
  })
  useBackendStore.setState({ status: 'available' })
  useAssetLibraryStore.setState({
    definitions: [],
    allDefinitions: [],
    loaded: true,
    unavailable: false,
  })
  useScenarioScriptWorkflowStore.setState({ workflowsByProject: {} })
  useScenarioScriptWorkflowStore.persist.clearStorage()
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
  )
  resetStores()
})

describe('scenario delete propagation to script', () => {
  it('default accept tracks the active draft, not a portable-only snapshot', async () => {
    const { value } = setupEngineWithPortable(ONE_STEP_DOC, [
      { id: 'p-v1', content: TWO_STEP_DOC },
      { id: 'p-snap', content: TWO_STEP_DOC },
    ])
    useAiStore.setState((s) => ({
      markdownVersionsByProject: {
        ...s.markdownVersionsByProject,
        'p-1': [
          {
            id: 'v-1',
            projectId: 'p-1',
            conversationId: 'c-1',
            messageId: null,
            summary: 'Initial',
            touchedSteps: [1, 2],
            timestamp: '2026-01-01T00:00:00Z',
            content: TWO_STEP_DOC,
            baseVersionId: null,
          },
          {
            id: 'v-2',
            projectId: 'p-1',
            conversationId: 'c-1',
            messageId: null,
            summary: 'Manual scenario block deletion',
            touchedSteps: [1],
            timestamp: '2026-01-02T00:00:00Z',
            content: ONE_STEP_DOC,
            baseVersionId: 'v-1',
          },
        ],
      },
      activeMarkdownVersionIdByProject: { ...s.activeMarkdownVersionIdByProject, 'p-1': 'v-2' },
    }))
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const user = userEvent.setup()
    // Default hint must point at the active draft v-2, not the stale snapshot.
    expect(await screen.findByTestId('ai-scenario-script-default-hint')).toHaveTextContent(
      /v-2|latest version/i,
    )
    await user.click(screen.getByTestId('ai-scenario-generate-script'))
    const preview = await screen.findByTestId('ai-scenario-script-preview')
    // Deleted Step 2 must not come back as prompt blocks.
    expect(preview).toHaveTextContent(/1 slide\(s\)/)
    expect(preview).not.toHaveTextContent(/Where you are/)
  })

  it('warns when the draft diverged from the pinned accepted snapshot', async () => {
    const { value } = setupEngineWithPortable(ONE_STEP_DOC, [{ id: 'p-v1', content: TWO_STEP_DOC }])
    useAiStore.setState((s) => ({
      markdownVersionsByProject: {
        ...s.markdownVersionsByProject,
        'p-1': [
          {
            id: 'v-1',
            projectId: 'p-1',
            conversationId: 'c-1',
            messageId: null,
            summary: 'Initial',
            touchedSteps: [1, 2],
            timestamp: '2026-01-01T00:00:00Z',
            content: TWO_STEP_DOC,
            baseVersionId: null,
          },
          {
            id: 'v-2',
            projectId: 'p-1',
            conversationId: 'c-1',
            messageId: null,
            summary: 'Manual scenario block deletion',
            touchedSteps: [1],
            timestamp: '2026-01-02T00:00:00Z',
            content: ONE_STEP_DOC,
            baseVersionId: 'v-1',
          },
        ],
      },
      activeMarkdownVersionIdByProject: { ...s.activeMarkdownVersionIdByProject, 'p-1': 'v-2' },
      acceptedMarkdownVersionIdByProject: { ...s.acceptedMarkdownVersionIdByProject, 'p-1': 'v-1' },
    }))
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    expect(await screen.findByTestId('ai-scenario-script-draft-diverged-hint')).toHaveTextContent(
      /newer edits.*not in accepted/i,
    )
  })
})
