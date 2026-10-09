import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiScenarioView } from '../components/ai/AiScenarioView'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useAiStore } from '../stores/aiStore'
import { useBackendStore } from '../stores/backendStore'
import type { AiScenario } from '../api/aiApi'

const sampleScenario: AiScenario = {
  id: 'scen-1',
  projectId: 'p-1',
  conversationId: 'c-1',
  title: 'Ser vs Estar cat lesson',
  description: 'Intro greeting, blackboard teaching, goodbye',
  status: 'draft',
  steps: [
    {
      id: 'st-1',
      order: 0,
      partTag: 'intro',
      spokenLine: 'Hello friends, I am Mao the cat!',
      onScreenAction: 'Cat waves at the camera',
      assetHints: ['cat'],
      estimatedDurationSec: 8,
    },
    {
      id: 'st-2',
      order: 1,
      partTag: 'middle',
      spokenLine: 'Ser is for who you are.',
      onScreenAction: 'Chalk text appears on the blackboard',
      assetHints: ['blackboard', 'chalk text'],
      estimatedDurationSec: 20,
    },
    {
      id: 'st-3',
      order: 2,
      partTag: 'outro',
      spokenLine: 'Goodbye friends!',
      onScreenAction: 'Cat waves goodbye',
      assetHints: ['cat'],
      estimatedDurationSec: 6,
    },
  ],
  revisions: [
    { id: 'r-1', sourceRequest: 'Draft the cat lesson', created: new Date().toISOString() },
  ],
  created: new Date().toISOString(),
  modified: new Date().toISOString(),
}

function renderView(context: unknown = {}) {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const dispatchSpy: ReturnType<typeof vi.fn> = vi.fn((command: never) =>
    dispatcher.dispatch(command),
  )
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: dispatchSpy as unknown as EngineContextValue['dispatch'],
    persistence: { save: vi.fn(), onCommandSucceeded: () => undefined, dispose: () => undefined },
  }
  render(
    <EngineContext.Provider value={value}>
      <AiScenarioView projectId="p-1" conversationId="c-1" context={context} />
    </EngineContext.Provider>,
  )
  return { engine, dispatchSpy }
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
    scenarios: [
      {
        id: 'scen-1',
        projectId: 'p-1',
        conversationId: 'c-1',
        title: 'Ser vs Estar cat lesson',
        status: 'draft',
        stepCount: 3,
        modified: new Date().toISOString(),
      },
    ],
    scenarioById: { 'scen-1': sampleScenario },
    activeScenarioId: 'scen-1',
    scenarioGenerating: false,
    scenarioError: null,
    scenarioRequest: '',
  })
  useBackendStore.setState({ status: 'available' })
})

describe('AiScenarioView draft and accept gate', () => {
  it('renders steps with part tags, spoken lines, actions, hints, and durations', () => {
    renderView()
    expect(screen.getByTestId('ai-scenario-section')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-title')).toHaveValue('Ser vs Estar cat lesson')
    expect(screen.getByTestId('ai-scenario-step-st-1')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-step-tag-st-1')).toHaveTextContent('intro')
    expect(screen.getByTestId('ai-scenario-step-spoken-st-2')).toHaveTextContent(
      'Ser is for who you are.',
    )
    expect(screen.getByTestId('ai-scenario-step-action-st-2')).toHaveTextContent('Chalk text')
    expect(screen.getByTestId('ai-scenario-step-hints-st-2')).toHaveTextContent('blackboard')
    expect(screen.getByTestId('ai-scenario-step-duration-st-2')).toHaveValue(20)
    expect(screen.getByTestId('ai-scenario-gate')).toHaveTextContent(
      'Stage B runs only on the accepted version.',
    )
  })

  it('view/edit/accept cycle never dispatches engine commands', async () => {
    const { dispatchSpy } = renderView()
    const user = userEvent.setup()

    await user.clear(screen.getByTestId('ai-scenario-title'))
    await user.type(screen.getByTestId('ai-scenario-title'), 'My edited scenario')
    const updateFetch = vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ...sampleScenario, title: 'My edited scenario' }), {
        status: 200,
      }),
    )
    await user.click(screen.getByTestId('ai-scenario-save'))
    expect(updateFetch).toHaveBeenCalled()

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ...sampleScenario, status: 'accepted' }), { status: 200 }),
    )
    await user.click(screen.getByTestId('ai-scenario-accept'))
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('shows degraded state when the backend is down', () => {
    render(<AiScenarioView projectId="p-1" conversationId="c-1" context={{}} disabled />)
    expect(screen.getByTestId('ai-scenario-disabled')).toBeInTheDocument()
  })
})
