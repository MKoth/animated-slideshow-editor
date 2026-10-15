import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiPanel } from '../components/ai/AiPanel'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useAiStore } from '../stores/aiStore'
import { useBackendStore } from '../stores/backendStore'

function renderPanel() {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: { save: vi.fn(), onCommandSucceeded: () => undefined, dispose: () => undefined },
  }
  render(
    <EngineContext.Provider value={value}>
      <AiPanel />
    </EngineContext.Provider>,
  )
  return engine
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
  useBackendStore.setState({ status: 'available' })
})

function mockFetchConversations(conversations: unknown[], messages: unknown = []) {
  vi.mocked(fetch).mockImplementation(async (url: unknown) => {
    const path = String(url)
    if (path.includes('/api/ai/conversations?')) {
      return new Response(JSON.stringify(conversations), { status: 200 })
    }
    if (path.endsWith('/messages')) {
      return new Response(JSON.stringify(messages), { status: 200 })
    }
    return new Response(JSON.stringify([]), { status: 200 })
  })
}

describe('AiPanel foundation', () => {
  it('renders conversation list, search, input, and settings entry', async () => {
    mockFetchConversations([
      { id: 'c-1', projectId: 'p-1', title: 'Intro ideas', modified: new Date().toISOString() },
    ])
    renderPanel()

    expect(await screen.findByTestId('ai-conversation-c-1')).toBeInTheDocument()
    expect(screen.getByTestId('ai-panel')).toBeInTheDocument()
    expect(screen.getByTestId('ai-search')).toBeInTheDocument()
    expect(screen.getByTestId('ai-input')).toBeInTheDocument()
    expect(screen.getByTestId('ai-settings-open')).toBeInTheDocument()
  })

  it('shows degraded unavailable state and disables chat when backend is down', () => {
    useBackendStore.setState({ status: 'unavailable' })
    mockFetchConversations([])
    renderPanel()

    expect(screen.getByTestId('ai-unavailable')).toHaveTextContent('AI unavailable')
    expect(screen.queryByTestId('ai-input')).not.toBeInTheDocument()
  })

  it('filters conversations client-side by title and content', async () => {
    mockFetchConversations(
      [
        { id: 'c-1', projectId: 'p-1', title: 'Intro ideas', modified: new Date().toISOString() },
        { id: 'c-2', projectId: 'p-1', title: 'Board plan', modified: new Date().toISOString() },
      ],
      [],
    )
    renderPanel()
    expect(await screen.findByTestId('ai-conversation-c-1')).toBeInTheDocument()
    // Seed message content for the client-side search filter.
    useAiStore.setState({
      messagesById: {
        'c-1': [
          {
            id: 'm-1',
            role: 'user',
            content: 'hello cat',
            stopped: false,
            errorCode: null,
            created: new Date().toISOString(),
          },
        ],
        'c-2': [],
      },
    })
    const user = userEvent.setup()

    await user.type(screen.getByTestId('ai-search'), 'cat')
    expect(screen.getByTestId('ai-conversation-c-1')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-conversation-c-2')).not.toBeInTheDocument()
  })

  it('never renders a collection story in the animation tab', async () => {
    mockFetchConversations([])
    const engine = renderPanel()
    const projectId = engine.project?.id ?? ''
    const stamp = new Date().toISOString()
    // Let the mount-time loads settle so they cannot wipe the seeded state below.
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    mockFetchConversations([])
    useAiStore.setState({
      assistantMode: 'animation',
      conversations: [
        { id: 'c-col', projectId, title: 'Walk batch', mode: 'collection', modified: stamp },
      ],
      messagesById: {
        'c-col': [
          {
            id: 'm-1',
            role: 'user',
            content: 'collection story',
            stopped: false,
            errorCode: null,
            created: stamp,
          },
        ],
      },
      // Stale persisted mapping: animation key points at the collection conversation.
      activeByProject: { [`${projectId}:animation`]: 'c-col' },
    })

    // The stale mapping is cleared instead of rendered.
    await waitFor(() =>
      expect(useAiStore.getState().activeByProject[`${projectId}:animation`]).toBeUndefined(),
    )
    expect(screen.queryByText('collection story')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-conversation-c-col')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-no-conversation-in-mode')).toHaveTextContent(
      'No animation conversation yet',
    )
  })

  it('repairs a stale mapping to the same-mode conversation', async () => {
    mockFetchConversations([])
    const engine = renderPanel()
    const projectId = engine.project?.id ?? ''
    const stamp = new Date().toISOString()
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled())
    const seeded = [
      { id: 'c-col', projectId, title: 'Walk batch', mode: 'collection' as const, modified: stamp },
      { id: 'c-anim', projectId, title: 'Cat walk', mode: 'animation' as const, modified: stamp },
    ]
    mockFetchConversations(seeded)
    useAiStore.setState({
      assistantMode: 'animation',
      conversations: seeded,
      messagesById: {},
      activeByProject: { [`${projectId}:animation`]: 'c-col' },
    })

    await waitFor(() =>
      expect(useAiStore.getState().activeByProject[`${projectId}:animation`]).toBe('c-anim'),
    )
    expect(screen.getByTestId('ai-conversation-c-anim')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-conversation-c-col')).not.toBeInTheDocument()
  })
})
