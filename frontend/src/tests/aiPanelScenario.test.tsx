import { render, screen } from '@testing-library/react'
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
  const projectId = engine.project!.id
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
  return projectId
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url)
      if (path.includes('/api/ai/conversations?')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (path.endsWith('/messages')) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }),
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
  })
  useBackendStore.setState({ status: 'available' })
})

describe('AiPanel scenario version links (issue #462)', () => {
  it('renders stored inline summaries with version links and mixed split, never deriving from raw content', async () => {
    const projectId = renderPanel()
    const convId = 'c-scen-1'
    const messages = [
      {
        id: 'm-user-1',
        role: 'user',
        content: 'make an intro',
        stopped: false,
        errorCode: null,
        created: new Date().toISOString(),
      },
      {
        id: 'm-asst-1',
        role: 'assistant',
        content:
          'intent: edit\nSummary: Add intro\nTouched-steps: 1\n\n## Step 1 -- Hi\n\nHello.\n\nQuestion: Should step 2 mention cats?',
        stopped: false,
        errorCode: null,
        scenarioIntent: 'edit',
        scenarioVersionId: 'v-abcdef123456',
        scenarioSummary: 'Add intro',
        scenarioTouchedSteps: [1],
        created: new Date().toISOString(),
      },
      {
        id: 'm-asst-2',
        role: 'assistant',
        content: 'What should step 1 be?',
        stopped: false,
        errorCode: null,
        scenarioIntent: 'question-only',
        scenarioVersionId: null,
        scenarioSummary: null,
        scenarioTouchedSteps: [],
        created: new Date().toISOString(),
      },
    ]
    vi.mocked(fetch).mockImplementation(async (url: unknown) => {
      const path = String(url)
      if (path.includes('/api/ai/conversations?')) {
        return new Response(
          JSON.stringify([
            {
              id: convId,
              projectId,
              title: 'Scenario chat',
              mode: 'scenario',
              modified: new Date().toISOString(),
            },
          ]),
          { status: 200 },
        )
      }
      if (path.includes(`/api/ai/conversations/${convId}/messages`)) {
        return new Response(JSON.stringify(messages), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })
    // Trigger reload with the mocked conversation.
    useAiStore.getState().loadConversations(projectId)
    expect(await screen.findByTestId(`ai-conversation-${convId}`)).toBeInTheDocument()
    // Select it (loadConversations auto-selects the only scenario conversation).
    await screen.findByTestId('ai-message-m-asst-1')
    // Stored link renders inline under the chat message.
    expect(screen.getByTestId('ai-message-scenario-m-asst-1')).toHaveTextContent('Add intro')
    expect(screen.getByTestId('ai-message-scenario-m-asst-1')).toHaveTextContent('v-abcdef')
    expect(screen.getByTestId('ai-message-scenario-m-asst-1')).toHaveTextContent('steps 1')
    expect(screen.getByTestId('ai-message-scenario-m-asst-2')).toHaveTextContent('Question-only')
    // Mixed reply: edit part renders as a compact change brief, never the full doc.
    expect(screen.getByTestId('ai-message-scenario-mixed-m-asst-1')).toBeInTheDocument()
    expect(screen.getByTestId('ai-message-scenario-edit-m-asst-1')).toHaveTextContent(
      'Doc edit — Add intro',
    )
    expect(screen.getByTestId('ai-message-scenario-edit-m-asst-1')).toHaveTextContent('steps 1')
    expect(screen.getByTestId('ai-message-scenario-edit-m-asst-1')).toHaveTextContent('v-abcdef')
    expect(screen.getByTestId('ai-message-scenario-edit-m-asst-1')).not.toHaveTextContent('Hello.')
    expect(screen.getByTestId('ai-message-scenario-question-m-asst-1')).toHaveTextContent(
      'Should step 2',
    )
  })

  it('edit brief counts added and removed lines against the previous version', async () => {
    const projectId = renderPanel()
    const convId = 'c-scen-1'
    const base = {
      projectId,
      conversationId: convId,
      touchedSteps: [1],
      timestamp: new Date().toISOString(),
      baseVersionId: null,
    }
    const stored = [
      {
        ...base,
        id: 'v-prev',
        messageId: 'm-0',
        summary: 'Base',
        content: '## Step 1 -- Hi\n\nHello.',
      },
      {
        ...base,
        id: 'v-abcdef123456',
        messageId: 'm-asst-1',
        summary: 'Add intro',
        content: '## Step 1 -- Hi\n\nHello world.\n\nNew line.',
      },
    ]
    const messages = [
      {
        id: 'm-asst-1',
        role: 'assistant',
        content:
          'intent: edit\nSummary: Add intro\nTouched-steps: 1\n\n## Step 1 -- Hi\n\nHello world.',
        stopped: false,
        errorCode: null,
        scenarioIntent: 'edit',
        scenarioVersionId: 'v-abcdef123456',
        scenarioSummary: 'Add intro',
        scenarioTouchedSteps: [1],
        created: new Date().toISOString(),
      },
    ]
    vi.mocked(fetch).mockImplementation(async (url: unknown) => {
      const path = String(url)
      if (path.includes('/api/ai/conversations?')) {
        return new Response(
          JSON.stringify([
            {
              id: convId,
              projectId,
              title: 'Scenario chat',
              mode: 'scenario',
              modified: new Date().toISOString(),
            },
          ]),
          { status: 200 },
        )
      }
      if (path.includes(`/api/ai/conversations/${convId}/messages`)) {
        return new Response(JSON.stringify(messages), { status: 200 })
      }
      if (path.includes('/markdown/versions') && !path.includes('/restore')) {
        return new Response(JSON.stringify(stored), { status: 200 })
      }
      if (path.includes('/markdown/active')) {
        return new Response(
          JSON.stringify({ projectId, activeVersionId: 'v-abcdef123456', version: null }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })
    useAiStore.getState().loadConversations(projectId)
    await screen.findByTestId('ai-message-m-asst-1')
    const brief = screen.getByTestId('ai-message-scenario-edit-m-asst-1')
    expect(brief).toHaveTextContent('2 added')
    expect(brief).toHaveTextContent('1 removed')
    expect(brief).not.toHaveTextContent('Hello world.')
  })

  it('offers ask/edit prefix affordance in scenario mode', async () => {
    renderPanel()
    expect(await screen.findByTestId('ai-ask-prefix')).toBeInTheDocument()
    expect(screen.getByTestId('ai-edit-prefix')).toBeInTheDocument()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('ai-ask-prefix'))
    // Draft gains the ask: prefix without touching the doc.
    const input = screen.getByTestId('ai-input') as HTMLTextAreaElement
    expect(input.value.startsWith('ask:')).toBe(true)
  })

  it('reloads scenario versions after chat completes so the doc syncs without refresh', async () => {
    const projectId = renderPanel()
    const convId = 'c-scen-1'
    const stored = {
      id: 'v-1',
      projectId,
      conversationId: convId,
      messageId: 'm-asst-1',
      summary: 'Add intro',
      touchedSteps: [1],
      timestamp: new Date().toISOString(),
      content: '## Step 1 -- Hi',
      baseVersionId: null,
    }
    vi.mocked(fetch).mockImplementation(async (url: unknown, init?: unknown) => {
      const path = String(url)
      const method = (init as RequestInit | undefined)?.method ?? 'GET'
      if (method === 'POST' && path === '/api/ai/chat') {
        return new Response('event: done\ndata: {"content":"ok"}\n\n', { status: 200 })
      }
      if (path.includes('/api/ai/conversations?')) {
        return new Response(
          JSON.stringify([
            {
              id: convId,
              projectId,
              title: 'Scenario chat',
              mode: 'scenario',
              modified: new Date().toISOString(),
            },
          ]),
          { status: 200 },
        )
      }
      if (path.includes(`/api/ai/conversations/${convId}/messages`)) {
        return new Response(JSON.stringify([]), { status: 200 })
      }
      if (path.includes('/markdown/versions') && !path.includes('/restore')) {
        return new Response(JSON.stringify([stored]), { status: 200 })
      }
      if (path.includes('/markdown/active')) {
        return new Response(JSON.stringify({ projectId, activeVersionId: 'v-1', version: null }), {
          status: 200,
        })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })
    useAiStore.setState({
      conversations: [
        {
          id: convId,
          projectId,
          title: 'Scenario chat',
          mode: 'scenario',
          modified: new Date().toISOString(),
        },
      ],
    })
    await useAiStore.getState().sendMessage(projectId, convId, 'make an intro', {}, 'scenario')
    expect(useAiStore.getState().markdownVersionsByProject[projectId]).toHaveLength(1)
    expect(useAiStore.getState().activeMarkdownVersionIdByProject[projectId]).toBe('v-1')
  })
})
