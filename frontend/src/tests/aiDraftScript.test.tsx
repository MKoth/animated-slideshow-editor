import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiPanel } from '../components/ai/AiPanel'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useAiStore } from '../stores/aiStore'
import { useBackendStore } from '../stores/backendStore'

const now = () => new Date().toISOString()

function seedEngine() {
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
  return { value, projectId }
}

const DSL = [
  'slide: Slide 1',
  'script "Scene Animation Sequence" from 0',
  'bind cat = node("Cat")',
].join('\n')

function scriptMessage() {
  return {
    id: 'm-script',
    role: 'assistant',
    content: [
      '## What I found',
      'Cat [node-1].',
      '',
      '## Script',
      '```engine-command',
      DSL,
      '```',
      '',
      '## Open questions',
      'None',
    ].join('\n'),
    stopped: false,
    errorCode: null,
    created: now(),
  }
}

function questionsOnlyMessage() {
  return {
    id: 'm-q',
    role: 'assistant',
    content: '## Open questions\n- yawn in or silent?',
    stopped: false,
    errorCode: null,
    created: now(),
  }
}

function oldFormatMessage() {
  const longLine = `SetSlideAnimationScript { slide: "Slide 1" duration: 16.0 placement at 0.0s: node-abc position: [3549, 1425] clipInstance at 5.0s duration 6.0s: collection: "Sitting to standing behind" }`
  return {
    id: 'm-old',
    role: 'assistant',
    content: [
      'Yes — you can do this with the current Cat rig on Slide 1.',
      '',
      '```engine-command',
      longLine,
      '```',
    ].join('\n'),
    stopped: false,
    errorCode: null,
    created: now(),
  }
}

function userMessage() {
  return {
    id: 'u-1',
    role: 'user',
    content: 'Can you make a Cat lying at start and then getting up animation?',
    stopped: false,
    errorCode: null,
    created: now(),
  }
}

function installFetch(
  projectId: string,
  seen: { commands?: unknown; draftCalled?: boolean; createCalled?: boolean },
  msgs?: unknown[],
) {
  const conv = { id: 'c-1', projectId, title: 'Chat', mode: 'animation', modified: now() }
  vi.mocked(fetch).mockImplementation(async (url: unknown, init?: unknown) => {
    const path = String(url)
    const method = (init as RequestInit | undefined)?.method ?? 'GET'
    if (method === 'POST' && path === '/api/ai/proposals/draft') {
      seen.draftCalled = true
      return new Response(JSON.stringify({ detail: 'unexpected draft call' }), { status: 500 })
    }
    if (method === 'POST' && path === '/api/ai/proposals') {
      const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'))
      seen.createCalled = true
      seen.commands = body.commands
      return new Response(
        JSON.stringify({
          id: 'prop-script',
          projectId,
          conversationId: 'c-1',
          messageId: body.messageId ?? null,
          title: body.title ?? 'Drafted script',
          status: 'validated',
          commands: body.commands ?? [],
          validation: { ok: true, errors: [] },
          baseFingerprint: 'fp',
          validatedFingerprint: null,
          dryRun: {},
          selectedIndexes: [],
          executions: [],
          created: now(),
          modified: now(),
        }),
        { status: 201 },
      )
    }
    if (path.includes('/api/ai/proposals')) return new Response(JSON.stringify([]), { status: 200 })
    if (path.includes('/api/ai/conversations?'))
      return new Response(JSON.stringify([conv]), { status: 200 })
    if (path.endsWith('/messages'))
      return new Response(JSON.stringify(msgs ?? [scriptMessage(), questionsOnlyMessage()]), {
        status: 200,
      })
    return new Response(JSON.stringify([]), { status: 200 })
  })
}

function renderPanel(
  msgs: never[],
  seen: { commands?: unknown; draftCalled?: boolean },
  fetchMsgs?: unknown[],
) {
  const { value, projectId } = seedEngine()
  installFetch(projectId, seen, fetchMsgs ?? (msgs as unknown[]))
  useAiStore.setState({
    conversations: [{ id: 'c-1', projectId, title: 'Chat', mode: 'animation', modified: now() }],
    messagesById: { 'c-1': msgs },
    activeByProject: { [`${projectId}:animation`]: 'c-1' },
    drafts: {},
    search: '',
    panelOpen: true,
    assistantMode: 'animation',
    settingsOpen: false,
    status: 'idle',
    streamingConversationId: null,
    streamingContent: '',
    lastError: null,
    proposals: [],
    proposalById: {},
    activeProposalId: null,
  })
  render(
    <EngineContext.Provider value={value}>
      <AiPanel />
    </EngineContext.Provider>,
  )
}

describe('AiPanel draft this script', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    useAiStore.setState({
      conversations: [],
      messagesById: {},
      activeByProject: {},
      drafts: {},
      search: '',
      panelOpen: true,
      assistantMode: 'animation',
      settingsOpen: false,
      status: 'idle',
      streamingConversationId: null,
      streamingContent: '',
      lastError: null,
      proposals: [],
      proposalById: {},
      activeProposalId: null,
    })
    useBackendStore.setState({ status: 'available' })
  })

  it('shows one adaptive button: instant script draft vs AI draft', async () => {
    renderPanel([scriptMessage(), questionsOnlyMessage()] as never[], {})
    // Appliable message gets the instant button, not the AI one.
    expect(await screen.findByTestId('ai-message-draft-script-m-script')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-message-draft-m-script')).not.toBeInTheDocument()
    // Questions-only message keeps the AI draft button.
    expect(await screen.findByTestId('ai-message-draft-m-q')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-message-draft-script-m-q')).not.toBeInTheDocument()
  })

  it('copies the whole selected conversation from its icon-only list control', async () => {
    const originalClipboard = navigator.clipboard
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    try {
      renderPanel([userMessage(), scriptMessage()] as never[], {})
      const copy = await screen.findByTestId('ai-copy-conversation-c-1')
      expect(copy).toHaveAttribute('aria-label', 'Copy conversation Chat')
      expect(copy).toHaveTextContent('')
      fireEvent.click(copy)
      expect(await screen.findByLabelText('Conversation copied')).toBeInTheDocument()
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining(
          'User:\nCan you make a Cat lying at start and then getting up animation?',
        ),
      )
      expect(writeText.mock.calls[0]?.[0]).toContain('Assistant:\n')
      expect(writeText.mock.calls[0]?.[0]).toContain('script "Scene Animation Sequence" from 0')
    } finally {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: originalClipboard,
      })
    }
  })

  it('builds the proposal locally without a second AI call', async () => {
    const seen: { commands?: unknown; draftCalled?: boolean; createCalled?: boolean } = {}
    renderPanel([scriptMessage()] as never[], seen)
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-message-draft-script-m-script'))
    const modal = await screen.findByTestId('ai-proposal-modal')
    expect(modal).toBeInTheDocument()
    expect(seen.draftCalled).not.toBe(true)
    expect(seen.createCalled).toBe(true)
    const commands = seen.commands as { type: string; slideId: string; source: string }[]
    expect(commands).toHaveLength(1)
    expect(commands[0].type).toBe('SetSlideAnimationScript')
    expect(commands[0].source).toContain('script "Scene Animation Sequence" from 0')
    expect(commands[0].source).not.toContain('slide:')
    expect(typeof commands[0].slideId).toBe('string')
  })

  it('renders user text and old-format long single-line assistant content', async () => {
    renderPanel([userMessage(), oldFormatMessage()] as never[], {})
    expect(await screen.findByTestId('ai-message-u-1')).toHaveTextContent('Cat lying at start')
    const old = await screen.findByTestId('ai-message-m-old')
    expect(old).toHaveTextContent('current Cat rig')
    expect(old).toHaveTextContent('SetSlideAnimationScript')
    // Old pseudo-format is not appliable: keeps the AI draft button.
    expect(await screen.findByTestId('ai-message-draft-m-old')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-message-draft-script-m-old')).not.toBeInTheDocument()
  })

  it('opens the modal instantly with a drafting indicator while the POST is pending', async () => {
    renderPanel([scriptMessage()] as never[], {})
    let resolvePost!: (value: Response) => void
    const gate = new Promise<Response>((resolve) => {
      resolvePost = resolve
    })
    vi.mocked(fetch).mockImplementation(async (url: unknown) => {
      const path = String(url)
      if (path === '/api/ai/proposals') return gate
      return new Response(JSON.stringify([]), { status: 200 })
    })
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-message-draft-script-m-script'))
    expect(await screen.findByTestId('ai-proposal-modal-drafting')).toBeInTheDocument()
    expect(screen.getByTestId('ai-proposal-modal-drafting')).toHaveTextContent(
      'Nothing changes until you approve',
    )
    resolvePost(
      new Response(
        JSON.stringify({
          id: 'prop-script',
          projectId: 'p-1',
          conversationId: 'c-1',
          messageId: 'm-script',
          title: 'Animation script',
          status: 'validated',
          commands: [{ type: 'SetSlideAnimationScript', slideId: 's-1', source: 'x' }],
          validation: { ok: true, errors: [] },
          baseFingerprint: 'fp',
          validatedFingerprint: null,
          dryRun: {},
          selectedIndexes: [],
          executions: [],
          created: now(),
          modified: now(),
        }),
        { status: 201 },
      ),
    )
    expect(await screen.findByTestId('ai-proposal-prop-script')).toBeInTheDocument()
  })
})
