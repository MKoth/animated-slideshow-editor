import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiPanel } from '../components/ai/AiPanel'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useAiStore } from '../stores/aiStore'
import { useBackendStore } from '../stores/backendStore'

function renderPanelWithUsage() {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  const projectId = engine.project?.id ?? 'p-1'
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: { save: vi.fn(), onCommandSucceeded: () => undefined, dispose: () => undefined },
  }
  useAiStore.setState({
    conversations: [
      { id: 'c-1', projectId, title: 'Chat', mode: 'scenario', modified: new Date().toISOString() },
    ],
    messagesById: {
      'c-1': [
        {
          id: 'm-1',
          role: 'user',
          content: 'hi',
          stopped: false,
          errorCode: null,
          created: new Date().toISOString(),
        },
        {
          id: 'm-2',
          role: 'assistant',
          content: 'hello',
          stopped: false,
          errorCode: null,
          promptTokens: 11,
          completionTokens: 22,
          totalTokens: 33,
          created: new Date().toISOString(),
        },
      ],
    },
    activeByProject: { [`${projectId}:scenario`]: 'c-1' },
    drafts: {},
    search: '',
    panelOpen: true,
    assistantMode: 'scenario',
    settingsOpen: false,
    status: 'idle',
    streamingConversationId: null,
    streamingContent: '',
    lastError: null,
  })
  render(
    <EngineContext.Provider value={value}>
      <AiPanel />
    </EngineContext.Provider>,
  )
}

describe('AiPanel token usage', () => {
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
      assistantMode: 'scenario',
      settingsOpen: false,
      status: 'idle',
      streamingConversationId: null,
      streamingContent: '',
      lastError: null,
    })
    useBackendStore.setState({ status: 'available' })
  })

  it('shows the real per-conversation total with prompt/completion split', () => {
    renderPanelWithUsage()
    expect(screen.getByTestId('ai-token-usage')).toHaveTextContent('33 total')
    expect(screen.getByTestId('ai-token-usage')).toHaveTextContent('prompt 11')
    expect(screen.getByTestId('ai-token-usage')).toHaveTextContent('completion 22')
  })

  it('collapses animation details by default and expands on toggle', async () => {
    renderPanelWithUsage()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('ai-mode-animation'))
    expect(screen.getByTestId('ai-animation-section')).toBeInTheDocument()
    expect(screen.getByTestId('ai-animation-toggle')).toHaveTextContent('Show details')
    expect(screen.getByTestId('ai-animation-details')).not.toBeVisible()
    await user.click(screen.getByTestId('ai-animation-toggle'))
    expect(screen.getByTestId('ai-animation-toggle')).toHaveTextContent('Hide details')
    expect(screen.getByTestId('ai-animation-details')).toBeVisible()
  })
})
