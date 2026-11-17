import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiScenarioModal } from '../components/ai/AiScenarioModal'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import {
  appendScenarioVersion,
  createEmptyScenarioSection,
  createScenarioVersion,
  withScenarioBindings,
} from '../engine/scenarioSection'
import { useAiStore } from '../stores/aiStore'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useBackendStore } from '../stores/backendStore'
import { useScenarioScriptWorkflowStore } from '../stores/scenarioScriptWorkflowStore'
import type { AssetDefinition } from '../api'

const MD = [
  '## Step 1 — Who you are',
  '',
  '**Narrator:** Ser is for who you are.',
  '',
  '![Young doctor smiling](asset:young-doctor-smiling)',
  '',
  '> Brief: Warm portrait.',
  '',
  'You say soy.',
  '',
].join('\n')

function makeDefinition(id: string, name: string): AssetDefinition {
  return {
    id,
    name,
    description: '',
    category: 'Object',
    tags: [],
    ai_description: '',
    original_filename: `${name}.png`,
    import_date: '2026-01-01T00:00:00Z',
    width: 1,
    height: 1,
    file_size: 1,
    aspect_ratio: 1,
    default_scale: 1,
    default_rotation: 0,
    pivot: { x: 0.5, y: 0.5 },
    anchors: [],
    original_url: '',
    thumbnail_url: '',
  }
}

function setupEngine() {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  let section = createEmptyScenarioSection(MD)
  const v1 = createScenarioVersion(MD, 'Initial', [1])
  section = appendScenarioVersion(section, v1)
  section = { ...section, currentMarkdown: MD }
  section = withScenarioBindings(section, { 'young-doctor-smiling': 'def-doctor' })
  engine.project!.setScenario(section)
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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
  )
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
    definitions: [makeDefinition('def-doctor', 'Doctor')],
    allDefinitions: [makeDefinition('def-doctor', 'Doctor')],
    loaded: true,
    unavailable: false,
  })
  useScenarioScriptWorkflowStore.setState({ workflowsByProject: {} })
  useScenarioScriptWorkflowStore.persist.clearStorage()
})

describe('checklist brief edit propagation', () => {
  it('persists the brief edit as a server version so script/history see it', async () => {
    const user = userEvent.setup()
    const { engine, value } = setupEngine()
    const posted: Array<{ content: string; summary: string }> = []
    vi.mocked(fetch).mockImplementation(async (url: unknown, init?: RequestInit) => {
      const path = String(url)
      if (path.endsWith('/api/ai/scenarios/markdown/versions') && init?.method === 'POST') {
        const body = JSON.parse(String((init as RequestInit).body)) as {
          content: string
          summary: string
        }
        posted.push(body)
        return new Response(JSON.stringify({ id: 'v-brief', ...body }), { status: 201 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const input = await screen.findByTestId(
      'ai-scenario-checklist-brief-input-young-doctor-smiling',
    )
    await user.clear(input)
    await user.type(input, 'Edited brief propagates.')
    await user.click(screen.getByTestId('ai-scenario-checklist-save-brief-young-doctor-smiling'))
    // Portable updates immediately (existing behaviour).
    expect(engine.project!.scenario!.currentMarkdown).toContain('Edited brief propagates.')
    // And a server version is created so History/Script observe the edit.
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0))
    expect(posted[0]!.content).toContain('Edited brief propagates.')
    expect(posted[0]!.summary).toMatch(/brief/i)
  })
})
