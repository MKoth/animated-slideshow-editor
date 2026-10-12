import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiPanel } from '../components/ai/AiPanel'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useAiStore } from '../stores/aiStore'
import { useBackendStore } from '../stores/backendStore'
import type { AiMessage } from '../api/aiApi'

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
  return { engine, value, projectId }
}

const assistantMessage: AiMessage = {
  id: 'm-1',
  role: 'assistant',
  content: 'I can add that slide.',
  stopped: false,
  errorCode: null,
  created: now(),
}

const userMessage: AiMessage = {
  id: 'm-0',
  role: 'user',
  content: 'Add a slide',
  stopped: false,
  errorCode: null,
  created: now(),
}

function attachedProposal(projectId: string) {
  return {
    id: 'prop-1',
    projectId,
    conversationId: 'c-1',
    messageId: 'm-1',
    title: 'Middle fill',
    status: 'validated',
    commands: [{ type: 'CreateSlide', name: 'Middle 1' }],
    validation: { ok: true, errors: [] },
    baseFingerprint: 'fp-base',
    validatedFingerprint: null,
    dryRun: {},
    selectedIndexes: [],
    executions: [],
    created: now(),
    modified: now(),
  }
}

function unattachedProposal(projectId: string) {
  return {
    ...attachedProposal(projectId),
    id: 'prop-stage',
    messageId: null,
    title: 'Board scripts',
  }
}

function installFetch(projectId: string, draftFailure = false) {
  const conv = { id: 'c-1', projectId, title: 'Chat', mode: 'lesson', modified: now() }
  const messages = [userMessage, assistantMessage]
  const proposals = [attachedProposal(projectId), unattachedProposal(projectId)]
  vi.mocked(fetch).mockImplementation(async (url: unknown, init?: unknown) => {
    const path = String(url)
    const method = (init as RequestInit | undefined)?.method ?? 'GET'
    if (method === 'POST' && path === '/api/ai/proposals/draft') {
      if (draftFailure) {
        return new Response(
          JSON.stringify({
            detail: {
              code: 'no_actionable_edit',
              message:
                'This message has no actionable edit to draft — ask the assistant for a concrete change, then draft again.',
              logId: 'draft-test123',
            },
          }),
          { status: 422 },
        )
      }
      const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'))
      return new Response(
        JSON.stringify({
          id: 'prop-drafted',
          projectId,
          conversationId: 'c-1',
          messageId: body.messageId ?? null,
          title: 'Drafted slide',
          status: 'validated',
          commands: [{ type: 'CreateSlide', name: 'Middle 3' }],
          validation: { ok: true, errors: [] },
          baseFingerprint: 'draft:m-1',
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
    if (method === 'POST' && path === '/api/ai/proposals') {
      const body = JSON.parse(String((init as RequestInit)?.body ?? '{}'))
      return new Response(
        JSON.stringify({
          id: 'prop-new',
          projectId,
          conversationId: 'c-1',
          messageId: body.messageId ?? null,
          title: body.title ?? 'Untitled proposal',
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
    if (path.includes('/api/ai/proposals')) {
      return new Response(JSON.stringify(proposals), { status: 200 })
    }
    if (path.includes('/api/ai/conversations?')) {
      return new Response(JSON.stringify([conv]), { status: 200 })
    }
    if (path.endsWith('/messages')) {
      return new Response(JSON.stringify(messages), { status: 200 })
    }
    return new Response(JSON.stringify([]), { status: 200 })
  })
}

function renderInline(draftFailure = false) {
  const { value, projectId } = seedEngine()
  installFetch(projectId, draftFailure)
  useAiStore.setState({
    conversations: [{ id: 'c-1', projectId, title: 'Chat', mode: 'lesson', modified: now() }],
    messagesById: { 'c-1': [userMessage, assistantMessage] },
    activeByProject: { [`${projectId}:lesson`]: 'c-1' },
    drafts: {},
    search: '',
    panelOpen: true,
    assistantMode: 'lesson',
    settingsOpen: false,
    status: 'idle',
    streamingConversationId: null,
    streamingContent: '',
    lastError: null,
    proposals: [attachedProposal(projectId) as never, unattachedProposal(projectId) as never],
    proposalById: {
      'prop-1': attachedProposal(projectId) as never,
      'prop-stage': unattachedProposal(projectId) as never,
    },
    activeProposalId: 'prop-1',
  })
  render(
    <EngineContext.Provider value={value}>
      <AiPanel />
    </EngineContext.Provider>,
  )
  return projectId
}

describe('AiPanel inline proposals', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    useAiStore.setState({
      conversations: [],
      messagesById: {},
      activeByProject: {},
      drafts: {},
      search: '',
      panelOpen: true,
      assistantMode: 'lesson',
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

  it('renders the attached proposal card under its assistant message', async () => {
    renderInline()
    expect(await screen.findByTestId('ai-message-proposal-prop-1')).toBeInTheDocument()
    expect(screen.getByTestId('ai-message-proposal-prop-1')).toHaveTextContent('Middle fill')
    // User messages get no propose affordance.
    expect(screen.queryByTestId('ai-message-propose-m-0')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-message-propose-m-1')).toBeInTheDocument()
  })

  it('opens the review modal from the card and closes it', async () => {
    renderInline()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-message-proposal-view-prop-1'))
    const modal = await screen.findByTestId('ai-proposal-modal')
    expect(modal).toBeInTheDocument()
    expect(within(modal).getByTestId('ai-proposal-prop-1')).toBeInTheDocument()
    await user.click(within(modal).getByTestId('ai-proposal-modal-close'))
    expect(screen.queryByTestId('ai-proposal-modal')).not.toBeInTheDocument()
  })

  it('creates a message-attached proposal from the per-message button', async () => {
    renderInline()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-message-propose-m-1'))
    const modal = await screen.findByTestId('ai-proposal-modal')
    fireEvent.change(within(modal).getByTestId('ai-proposal-modal-create-commands'), {
      target: { value: JSON.stringify([{ type: 'CreateSlide', name: 'Middle 2' }]) },
    })
    await user.click(within(modal).getByTestId('ai-proposal-modal-create-submit'))
    // Creation flips the modal into review mode for the new proposal.
    expect(
      await within(screen.getByTestId('ai-proposal-modal')).findByTestId('ai-proposal-prop-new'),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('ai-proposal-modal')).getByTestId('ai-proposal-prop-new'),
    ).toHaveTextContent('CreateSlide')
  })

  it('lists unattached proposals collapsed and reviews them in the modal', async () => {
    renderInline()
    const user = userEvent.setup()
    expect(await screen.findByTestId('ai-proposals-others-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('ai-proposals-others')).not.toBeVisible()
    await user.click(screen.getByTestId('ai-proposals-others-toggle'))
    expect(screen.getByTestId('ai-proposals-others')).toBeVisible()
    await user.click(screen.getByTestId('ai-other-proposal-view-prop-stage'))
    const modal = await screen.findByTestId('ai-proposal-modal')
    expect(within(modal).getByTestId('ai-proposal-prop-stage')).toBeInTheDocument()
  })

  it('drafts a proposal from the assistant message and reviews it', async () => {
    renderInline()
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-message-draft-m-1'))
    const modal = await screen.findByTestId('ai-proposal-modal')
    expect(within(modal).getByTestId('ai-proposal-prop-drafted')).toBeInTheDocument()
    expect(within(modal).getByTestId('ai-proposal-prop-drafted')).toHaveTextContent('CreateSlide')
    // The drafted card now renders inline under its message.
    expect(screen.getByTestId('ai-message-proposal-prop-drafted')).toHaveTextContent(
      'Drafted slide',
    )
  })

  it('shows the backend reason when the message has no actionable edit', async () => {
    renderInline(true)
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-message-draft-m-1'))
    expect(await screen.findByTestId('ai-message-draft-error-m-1')).toHaveTextContent(
      'no actionable edit',
    )
  })
})
