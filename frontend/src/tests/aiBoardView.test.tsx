import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiBoard } from '../api/aiApi'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { AiBoardView } from '../components/ai/AiBoardView'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { createEmptyScenarioSection, withScenarioHtml } from '../engine/scenarioSection'
import { useAiStore } from '../stores/aiStore'
import { useBackendStore } from '../stores/backendStore'

const sampleBoard: AiBoard = {
  id: 'board-1',
  projectId: 'p-1',
  narrationId: 'nar-1',
  scenarioId: 'scen-1',
  conversationId: 'c-1',
  title: 'Board middle',
  status: 'draft',
  scripts: [
    {
      slideId: '',
      slideIndex: 0,
      source:
        'script "Board middle" from 0\nmark("part-0")\ncreate text "Ser is" as line0\nreveal(line0)\nmark("part-1")\ncreate text "Estar is" as line1\nreveal(line1)\n',
    },
  ],
  footprints: [],
  marksMap: {
    'part-0': { stepId: 'm1', time: 0 },
    'part-1': { stepId: 'm2', time: 2 },
  },
  checks: { parts: [], scene: { catNodes: [], cameraKeys: [] } },
  diagnostics: [],
  blockers: ['no compiled footprints reported — compile each middle script first'],
  revisions: [],
  created: new Date().toISOString(),
  modified: new Date().toISOString(),
}

function seedStore() {
  useAiStore.setState({
    boards: [
      {
        id: 'board-1',
        projectId: 'p-1',
        narrationId: 'nar-1',
        conversationId: 'c-1',
        title: 'Board middle',
        status: 'draft',
        scriptCount: 1,
        modified: new Date().toISOString(),
      },
    ],
    boardById: { 'board-1': sampleBoard },
    activeBoardId: 'board-1',
    boardBusy: false,
    boardError: null,
    narrationById: {
      'nar-1': {
        id: 'nar-1',
        projectId: 'p-1',
        reconciliationId: 'rec-1',
        scenarioId: 'scen-1',
        conversationId: 'c-1',
        title: 'Narration',
        status: 'accepted',
        defaultVoicePromptId: null,
        secondsPerCharacter: 0.1,
        parts: [
          {
            stepId: 'm1',
            order: 0,
            partTag: 'middle',
            spokenLine: 'Ser is for who you are.',
            estimatedDuration: 2.3,
            audioDuration: 2,
            assetId: 'a-1',
            status: 'ready',
            stale: false,
            voicePromptId: null,
            error: null,
            timelineStart: 0,
            timelineEnd: 2,
          },
          {
            stepId: 'm2',
            order: 1,
            partTag: 'middle',
            spokenLine: 'Estar is for where you are.',
            estimatedDuration: 2.7,
            audioDuration: 3,
            assetId: 'a-2',
            status: 'ready',
            stale: false,
            voicePromptId: null,
            error: null,
            timelineStart: 2,
            timelineEnd: 5,
          },
        ],
        slideDuration: 5,
        revisions: [],
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      },
    },
  })
  useBackendStore.setState({ status: 'available' })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
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
  })
  seedStore()
})

function renderView(disabled = false, markdown?: string | null, html?: string | null) {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Test' })
  const doc =
    markdown === undefined ? '## Step 1 — One\n\n**Narrator:** Hello.\n' : (markdown ?? '')
  const rendered = html === undefined ? '<html></html>' : (html ?? '')
  engine.project!.setScenario(withScenarioHtml(createEmptyScenarioSection(doc), rendered, 'v1'))
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: dispatcher.dispatch.bind(dispatcher) as unknown as EngineContextValue['dispatch'],
    persistence: { save: vi.fn(), onCommandSucceeded: () => undefined, dispose: () => undefined },
  }
  return render(
    <EngineContext.Provider value={value}>
      <AiBoardView projectId="p-1" narrationId="nar-1" conversationId="c-1" disabled={disabled} />
    </EngineContext.Provider>,
  )
}

describe('AiBoardView Stage E gate', () => {
  it('renders fresh scripts with marks and a blocked gate before compile', () => {
    renderView()
    expect(screen.getByTestId('ai-board-section')).toBeInTheDocument()
    expect(screen.getByTestId('ai-board-status')).toHaveTextContent('draft')
    const source = (screen.getByTestId('ai-board-source-0') as HTMLTextAreaElement).value
    expect(source).toContain('from 0')
    expect(source).toContain('mark("part-0")')
    expect(source).toContain('create text')
    // Gate blocked: no footprints yet, hard lock cannot pass.
    expect(screen.getByTestId('ai-board-accept')).toBeDisabled()
    expect(screen.getByTestId('ai-board-blockers')).toHaveTextContent('footprints')
    expect(screen.getByTestId('ai-board-contract')).toHaveTextContent('from zero')
    expect(screen.getByTestId('ai-board-contract')).toHaveTextContent('no auto-shift')
    expect(screen.getByTestId('ai-board-contract')).toHaveTextContent('No cat')
  })

  it('shows degraded state when the backend is down', () => {
    renderView(true)
    expect(screen.getByTestId('ai-board-disabled')).toBeInTheDocument()
  })

  it('refuses without scenario.md and generated HTML', () => {
    const { unmount } = renderView(false, '', null)
    expect(screen.getByTestId('ai-board-needs-scenario')).toBeInTheDocument()
    unmount()
  })
})
