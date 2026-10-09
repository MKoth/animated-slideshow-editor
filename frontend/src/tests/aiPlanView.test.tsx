import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiPlanView } from '../components/ai/AiPlanView'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useAiStore } from '../stores/aiStore'
import { useBackendStore } from '../stores/backendStore'
import type { AiPlan } from '../api/aiApi'

const samplePlan: AiPlan = {
  id: 'plan-1',
  projectId: 'p-1',
  conversationId: 'c-1',
  title: 'Intro to Ser and Estar',
  description: 'Beginner lesson',
  language: 'en',
  estimatedDurationSec: 300,
  learningObjective: 'Distinguish ser from estar',
  teachingStrategy: 'Present, practice, produce',
  status: 'draft',
  slides: [
    {
      id: 's-1',
      order: 0,
      title: 'Ser for identity',
      goal: 'Learn ser',
      estimatedDurationSec: 150,
      explanation: 'Ser describes identity',
      suggestedNarration: 'Ser is for who you are.',
      requiredAssets: [
        { name: 'Cat', classification: 'existing', definitionId: 'def-cat' },
        { name: 'Blackboard', classification: 'missing' },
      ],
      recommendedMaterials: ['Chalk'],
      recommendedShaders: [],
      recommendedClips: ['Fade'],
    },
    {
      id: 's-2',
      order: 1,
      title: 'Estar for state',
      goal: 'Learn estar',
      estimatedDurationSec: 150,
      explanation: 'Estar describes state',
      suggestedNarration: 'Estar is for how you are.',
      requiredAssets: [{ name: 'Board', classification: 'optional' }],
      recommendedMaterials: [],
      recommendedShaders: [],
      recommendedClips: [],
    },
  ],
  revisions: [
    { id: 'r-1', sourceRequest: 'Teach ser vs estar', created: new Date().toISOString() },
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
      <AiPlanView projectId="p-1" conversationId="c-1" context={context} />
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
    plans: [
      {
        id: 'plan-1',
        projectId: 'p-1',
        conversationId: 'c-1',
        title: 'Intro to Ser and Estar',
        status: 'draft',
        slideCount: 2,
        modified: new Date().toISOString(),
      },
    ],
    planById: { 'plan-1': samplePlan },
    activePlanId: 'plan-1',
    planGenerating: false,
    planError: null,
    planRequest: '',
  })
  useBackendStore.setState({ status: 'available' })
})

describe('AiPlanView proposal and accept gate', () => {
  it('renders overview, slides, classified assets, clips, and missing resources', () => {
    renderView()
    expect(screen.getByTestId('ai-plan-section')).toBeInTheDocument()
    expect(screen.getByTestId('ai-plan-title')).toHaveValue('Intro to Ser and Estar')
    expect(screen.getByTestId('ai-plan-slide-s-1')).toBeInTheDocument()
    expect(screen.getByTestId('ai-plan-asset-s-1-0')).toHaveTextContent('existing')
    expect(screen.getByTestId('ai-plan-asset-s-1-1')).toHaveTextContent('missing')
    expect(screen.getByTestId('ai-plan-clips-s-1')).toHaveTextContent('Fade')
    expect(screen.getByTestId('ai-plan-missing')).toHaveTextContent('Blackboard')
    expect(screen.getByTestId('ai-plan-reconcile')).toBeDisabled()
  })

  it('view/edit/revise/accept cycle never dispatches engine commands', async () => {
    const { dispatchSpy } = renderView()
    const user = userEvent.setup()

    // Edit the lesson title then save.
    await user.clear(screen.getByTestId('ai-plan-title'))
    await user.type(screen.getByTestId('ai-plan-title'), 'My edited title')
    const updateFetch = vi
      .mocked(fetch)
      .mockResolvedValue(
        new Response(JSON.stringify({ ...samplePlan, title: 'My edited title' }), { status: 200 }),
      )
    await user.click(screen.getByTestId('ai-plan-save'))
    expect(updateFetch).toHaveBeenCalled()

    // Accept stores the plan without touching the project.
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ...samplePlan, status: 'accepted' }), { status: 200 }),
    )
    await user.click(screen.getByTestId('ai-plan-accept'))
    expect(dispatchSpy).not.toHaveBeenCalled()
  })

  it('shows degraded state when the backend is down', () => {
    render(<AiPlanView projectId="p-1" conversationId="c-1" context={{}} disabled />)
    expect(screen.getByTestId('ai-plan-disabled')).toBeInTheDocument()
  })
})
