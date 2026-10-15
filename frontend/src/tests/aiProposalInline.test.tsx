import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiPanel } from '../components/ai/AiPanel'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { createDefaultRectangleMesh } from '../engine/mesh'
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

function attachedProposal(projectId: string, mode = 'scenario') {
  return {
    id: 'prop-1',
    projectId,
    conversationId: 'c-1',
    messageId: 'm-1',
    title: 'Middle fill',
    status: 'validated',
    commands:
      mode === 'scenario'
        ? [{ type: 'CreateSlide', name: 'Middle 1' }]
        : [
            {
              type: 'AiAnimationAssetBatch',
              operations: [
                {
                  kind: 'upsertShape',
                  action: 'create',
                  sourceShapeId: 'shape-rest',
                  nodeId: 'n-paw',
                  shape: { id: 'shape-pose', name: 'Resting paw', vertices: [] },
                },
              ],
            },
          ],
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

function installFetch(projectId: string, draftFailure = false, mode = 'lesson') {
  const conv = { id: 'c-1', projectId, title: 'Chat', mode, modified: now() }
  const messages = [userMessage, assistantMessage]
  const proposals = [attachedProposal(projectId, mode), unattachedProposal(projectId)]
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
      const drafted = {
        ...attachedProposal(projectId, mode),
        id: 'prop-drafted',
        messageId: body.messageId ?? null,
        title: mode === 'scenario' ? 'Drafted slide' : 'Drafted shape',
        baseFingerprint: 'draft:m-1',
      }
      return new Response(JSON.stringify(drafted), { status: 201 })
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

function renderInline(
  draftFailure = false,
  mode: 'scenario' | 'animation' | 'shape' | 'collection' = 'scenario',
) {
  const { value, projectId } = seedEngine()
  installFetch(projectId, draftFailure, mode)
  useAiStore.setState({
    conversations: [{ id: 'c-1', projectId, title: 'Chat', mode, modified: now() }],
    messagesById: { 'c-1': [userMessage, assistantMessage] },
    activeByProject: { [`${projectId}:${mode}`]: 'c-1' },
    drafts: {},
    search: '',
    panelOpen: true,
    assistantMode: mode,
    settingsOpen: false,
    status: 'idle',
    streamingConversationId: null,
    streamingContent: '',
    lastError: null,
    proposals: [attachedProposal(projectId, mode) as never, unattachedProposal(projectId) as never],
    proposalById: {
      'prop-1': attachedProposal(projectId, mode) as never,
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
      assistantMode: 'scenario',
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

  it('keeps animation proposal previews and approvals inline in conversation history', async () => {
    renderInline(false, 'animation')
    const card = await screen.findByTestId('ai-message-proposal-prop-1')
    expect(card).toHaveTextContent('create Shape “Resting paw”')
    expect(within(card).getByTestId('ai-animation-asset-preview')).toBeInTheDocument()
    expect(within(card).getByTestId('ai-proposal-approve-and-apply')).toBeInTheDocument()
    expect(within(card).getByTestId('ai-proposal-denial-feedback')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-proposal-modal')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-message-propose-m-1')).not.toBeInTheDocument()
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

  it('drafts a shape proposal inline and closes the modal in shape mode', async () => {
    renderInline(false, 'shape')
    const user = userEvent.setup()
    const draftButton = await screen.findByTestId('ai-message-draft-m-1')
    expect(draftButton).toHaveTextContent('Draft shape proposal')
    await user.click(draftButton)
    // The drafting modal closes once the proposal lands inline under its message.
    const card = await screen.findByTestId('ai-message-proposal-prop-drafted')
    expect(screen.queryByTestId('ai-proposal-modal')).not.toBeInTheDocument()
    expect(card).toHaveTextContent('Resting paw')
    expect(within(card).getByTestId('ai-animation-asset-preview')).toBeInTheDocument()
    expect(within(card).getByTestId('ai-proposal-approve-and-apply')).toBeInTheDocument()
  })
})

describe('AiPanel instant shape draft', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    useAiStore.setState({
      conversations: [],
      messagesById: {},
      activeByProject: {},
      drafts: {},
      search: '',
      panelOpen: true,
      assistantMode: 'shape',
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

  type SeenCommands = {
    type: string
    operations: {
      kind: string
      action: string
      nodeId: string
      sourceShapeId: string
      shape: { id: string; name: string; vertices: { x: number; y: number }[] }
    }[]
  }[]

  function renderShapePanel(blockLinesFor: (nodeId: string) => string[], messageId: string) {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Room')
    const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Body', {
      components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(10, 10) } },
    })
    const source = engine.createShape(node.id, 'sitting_facing_profile')
    const projectId = engine.project?.id ?? 'p-1'
    const shapeMessage: AiMessage = {
      id: messageId,
      role: 'assistant',
      content: [
        'A shape step for review.',
        '',
        '```shape-step',
        ...blockLinesFor(node.id),
        '```',
      ].join('\n'),
      stopped: false,
      errorCode: null,
      created: now(),
    }
    const seen: {
      commands?: SeenCommands
      title?: unknown
      draftCalled?: boolean
      createCalled?: boolean
    } = {}
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
        seen.commands = body.commands as SeenCommands
        seen.title = body.title
        return new Response(
          JSON.stringify({
            id: 'prop-shape',
            projectId,
            conversationId: 'c-1',
            messageId: body.messageId ?? null,
            title: body.title ?? 'Shape draft',
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
      if (path.includes('/api/ai/proposals'))
        return new Response(JSON.stringify([]), { status: 200 })
      if (path.includes('/api/ai/conversations?'))
        return new Response(
          JSON.stringify([{ id: 'c-1', projectId, title: 'Chat', mode: 'shape', modified: now() }]),
          { status: 200 },
        )
      if (path.endsWith('/messages'))
        return new Response(JSON.stringify([userMessage, shapeMessage]), { status: 200 })
      return new Response(JSON.stringify([]), { status: 200 })
    })
    useAiStore.setState({
      conversations: [{ id: 'c-1', projectId, title: 'Chat', mode: 'shape', modified: now() }],
      messagesById: { 'c-1': [userMessage, shapeMessage] },
      activeByProject: { [`${projectId}:shape`]: 'c-1' },
      proposals: [],
      proposalById: {},
      activeProposalId: null,
    })
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
    return { node, source, seen }
  }

  it('builds the shape proposal locally without a second AI call', async () => {
    const { node, source, seen } = renderShapePanel(
      (nodeId) => [
        'action: create',
        `node: ${nodeId}`,
        'source: sitting_facing_profile',
        'name: lying_left_side',
      ],
      'm-shape',
    )
    const user = userEvent.setup()
    const draftButton = await screen.findByTestId('ai-message-draft-shape-m-shape')
    expect(draftButton).toHaveTextContent('Draft this shape')
    await user.click(draftButton)
    // Instant path: no second AI call, modal closes, inline card renders.
    const card = await screen.findByTestId('ai-message-proposal-prop-shape')
    expect(screen.queryByTestId('ai-proposal-modal')).not.toBeInTheDocument()
    expect(seen.draftCalled).not.toBe(true)
    expect(seen.createCalled).toBe(true)
    const commands = seen.commands
    expect(commands).toHaveLength(1)
    expect(commands![0]!.type).toBe('AiAnimationAssetBatch')
    const operation = commands![0]!.operations[0]!
    expect(operation.kind).toBe('upsertShape')
    expect(operation.action).toBe('create')
    expect(operation.nodeId).toBe(node.id)
    expect(operation.sourceShapeId).toBe(source.id)
    expect(operation.shape.name).toBe('lying_left_side')
    // Vertices duplicate the live source Shape — count holds by construction.
    expect(operation.shape.vertices).toHaveLength(source.vertices.length)
    expect(operation.shape.vertices).toEqual(
      source.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    )
    expect(card).toHaveTextContent('lying_left_side')
    expect(within(card).getByTestId('ai-animation-asset-preview')).toBeInTheDocument()
    expect(within(card).getByTestId('ai-proposal-approve-and-apply')).toBeInTheDocument()
  })

  describe('AiPanel clip-batch fix-and-resubmit', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn())
      useAiStore.setState({
        conversations: [],
        messagesById: {},
        activeByProject: {},
        drafts: {},
        search: '',
        panelOpen: true,
        assistantMode: 'collection',
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

    function renderBatchPanel() {
      const engine = createEngineInternal()
      engine.createProject({ name: 'Demo' })
      const slide = engine.createSlide('Room')
      const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'paw')
      const projectId = engine.project?.id ?? 'p-1'
      const batchMessage: AiMessage = {
        id: 'm-batch',
        role: 'assistant',
        content: [
          'Clip batch with a bad track name.',
          '',
          '```clip-batch',
          'window: 0 - 4',
          'clip: paw move | node: paw | semantic: paw',
          'keys: rotationZ = 90@0, 0@4',
          'collection: paw batch | source: paw',
          '```',
        ].join('\n'),
        stopped: false,
        errorCode: null,
        created: now(),
      }
      const seen: { chatBodies: unknown[] } = { chatBodies: [] }
      vi.mocked(fetch).mockImplementation(async (url: unknown, init?: unknown) => {
        const path = String(url)
        const method = (init as RequestInit | undefined)?.method ?? 'GET'
        if (method === 'POST' && path === '/api/ai/chat') {
          seen.chatBodies.push(JSON.parse(String((init as RequestInit)?.body ?? '{}')))
          return new Response('event: done\ndata: {"content":"fixed"}\n\n', { status: 200 })
        }
        if (method === 'POST' && path === '/api/ai/proposals') {
          return new Response(JSON.stringify({ detail: 'unexpected proposal call' }), {
            status: 500,
          })
        }
        if (path.includes('/api/ai/proposals'))
          return new Response(JSON.stringify([]), { status: 200 })
        if (path.includes('/api/ai/conversations?'))
          return new Response(
            JSON.stringify([
              { id: 'c-1', projectId, title: 'Chat', mode: 'collection', modified: now() },
            ]),
            { status: 200 },
          )
        if (path.endsWith('/messages'))
          return new Response(JSON.stringify([userMessage, batchMessage]), { status: 200 })
        return new Response(JSON.stringify([]), { status: 200 })
      })
      useAiStore.setState({
        conversations: [
          { id: 'c-1', projectId, title: 'Chat', mode: 'collection', modified: now() },
        ],
        messagesById: { 'c-1': [userMessage, batchMessage] },
        activeByProject: { [`${projectId}:collection`]: 'c-1' },
        proposals: [],
        proposalById: {},
        activeProposalId: null,
      })
      const undoStack = new UndoStack()
      const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
      const value: EngineContextValue = {
        engine: toReadOnly(engine),
        undoStack,
        dispatch: (command) => dispatcher.dispatch(command),
        persistence: {
          save: vi.fn(),
          onCommandSucceeded: () => undefined,
          dispose: () => undefined,
        },
      }
      render(
        <EngineContext.Provider value={value}>
          <AiPanel />
        </EngineContext.Provider>,
      )
      return { node, seen }
    }

    it('shows the local build error with a fix button that resubmits to the assistant', async () => {
      const { seen } = renderBatchPanel()
      const user = userEvent.setup()
      const draftButton = await screen.findByTestId('ai-message-draft-clip-batch-m-batch')
      expect(draftButton).toHaveTextContent('Draft clip batch (1 clips from timeline)')
      await user.click(draftButton)
      // Local build fails — no proposal POST, error names the bad track.
      const errorBox = await screen.findByTestId('ai-message-draft-error-m-batch')
      expect(errorBox).toHaveTextContent('rotationz')
      const fixButton = within(errorBox).getByTestId('ai-message-fix-batch-m-batch')
      expect(fixButton).toHaveTextContent('Send fix to assistant')
      await user.click(fixButton)
      // Fix resubmits the failure to the LLM as a new message (history appends,
      // nothing is deleted) carrying the error plus the valid vocabulary.
      await vi.waitFor(() => expect(seen.chatBodies).toHaveLength(1))
      const sent = String((seen.chatBodies[0] as { message?: unknown }).message ?? '')
      expect(sent).toMatch(/rotationz/)
      expect(sent).toMatch(/plain rotation/)
      expect(sent).toMatch(/clip-batch/)
      await vi.waitFor(() =>
        expect(screen.queryByTestId('ai-message-draft-error-m-batch')).not.toBeInTheDocument(),
      )
      expect(screen.queryByTestId('ai-message-fix-batch-m-batch')).not.toBeInTheDocument()
    })
  })

  it('applies a rotate transform locally with the same vertex count', async () => {
    const { source, seen } = renderShapePanel(
      (nodeId) => [
        'action: create',
        `node: ${nodeId}`,
        'source: sitting_facing_profile',
        'name: lying_rotated',
        'transform: rotate',
        'degrees: 90',
      ],
      'm-rotated',
    )
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-message-draft-shape-m-rotated'))
    const card = await screen.findByTestId('ai-message-proposal-prop-shape')
    expect(screen.queryByTestId('ai-proposal-modal')).not.toBeInTheDocument()
    expect(seen.draftCalled).not.toBe(true)
    const operation = seen.commands![0]!.operations[0]!
    expect(operation.kind).toBe('upsertShape')
    expect(operation.shape.name).toBe('lying_rotated')
    // New geometry: same count, moved positions.
    expect(operation.shape.vertices).toHaveLength(source.vertices.length)
    expect(operation.shape.vertices).not.toEqual(
      source.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    )
    expect(card).toHaveTextContent('lying_rotated')
    expect(String(seen.title)).toContain('rotate 90°')
    expect(within(card).getByTestId('ai-animation-asset-preview')).toBeInTheDocument()
    expect(within(card).getByTestId('ai-proposal-approve-and-apply')).toBeInTheDocument()
  })

  describe('AiPanel proposal dry-run fix-and-resubmit', () => {
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

    function renderScriptPanel() {
      const engine = createEngineInternal()
      engine.createProject({ name: 'Demo' })
      const slide = engine.createSlide('Room')
      engine.createNode(slide.scene.id, slide.scene.root.id, 'cat')
      const projectId = engine.project?.id ?? 'p-1'
      const scriptMessage: AiMessage = {
        id: 'm-script',
        role: 'assistant',
        content: [
          '## Script',
          '',
          '```engine-command',
          'slide: Room',
          'script "Cat performance" from 0',
          'jump from top to middle',
          '```',
        ].join('\n'),
        stopped: false,
        errorCode: null,
        created: now(),
      }
      const dryRunMessage =
        'command #0 (AiRunAnimationScript) failed dry-run validate at position 0: ' +
        'Expected ".", found "jump" Fix it and re-validate before anything executes.'
      const proposal = {
        id: 'prop-script',
        projectId,
        conversationId: 'c-1',
        messageId: 'm-script',
        title: 'Cat performance',
        status: 'draft',
        commands: [{ type: 'AiRunAnimationScript', slideId: slide.id, source: 'jump from top' }],
        validation: { ok: true, errors: [] },
        baseFingerprint: 'fp-base',
        validatedFingerprint: null,
        dryRun: {
          ok: false,
          errors: [{ index: 0, type: 'AiRunAnimationScript', message: dryRunMessage }],
        },
        selectedIndexes: [],
        executions: [],
        created: now(),
        modified: now(),
      }
      const seen: { chatBodies: unknown[] } = { chatBodies: [] }
      vi.mocked(fetch).mockImplementation(async (url: unknown, init?: unknown) => {
        const path = String(url)
        const method = (init as RequestInit | undefined)?.method ?? 'GET'
        if (method === 'POST' && path === '/api/ai/chat') {
          seen.chatBodies.push(JSON.parse(String((init as RequestInit)?.body ?? '{}')))
          return new Response('event: done\ndata: {"content":"fixed"}\n\n', { status: 200 })
        }
        if (path.includes('/api/ai/proposals'))
          return new Response(JSON.stringify([proposal]), { status: 200 })
        if (path.includes('/api/ai/conversations?'))
          return new Response(
            JSON.stringify([
              { id: 'c-1', projectId, title: 'Chat', mode: 'animation', modified: now() },
            ]),
            { status: 200 },
          )
        if (path.endsWith('/messages'))
          return new Response(JSON.stringify([userMessage, scriptMessage]), { status: 200 })
        return new Response(JSON.stringify([]), { status: 200 })
      })
      useAiStore.setState({
        conversations: [
          { id: 'c-1', projectId, title: 'Chat', mode: 'animation', modified: now() },
        ],
        messagesById: { 'c-1': [userMessage, scriptMessage] },
        activeByProject: { [`${projectId}:animation`]: 'c-1' },
        proposals: [proposal as never],
        proposalById: { 'prop-script': proposal as never },
        activeProposalId: null,
      })
      const undoStack = new UndoStack()
      const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
      const value: EngineContextValue = {
        engine: toReadOnly(engine),
        undoStack,
        dispatch: (command) => dispatcher.dispatch(command),
        persistence: {
          save: vi.fn(),
          onCommandSucceeded: () => undefined,
          dispose: () => undefined,
        },
      }
      render(
        <EngineContext.Provider value={value}>
          <AiPanel />
        </EngineContext.Provider>,
      )
      return { seen, dryRunMessage }
    }

    it('shows Send fix to assistant on a failed animation-script dry-run and resubmits the error', async () => {
      const { seen, dryRunMessage } = renderScriptPanel()
      const user = userEvent.setup()
      const card = await screen.findByTestId('ai-message-proposal-prop-script')
      expect(card).toHaveTextContent('Expected "."')
      const fixButton = await within(card).findByTestId('ai-proposal-fix-prop-script')
      expect(fixButton).toHaveTextContent('Send fix to assistant')
      await user.click(fixButton)
      // Fix resubmits the validator failure as a new message carrying the
      // error plus the member-call repair vocabulary (history appends).
      await vi.waitFor(() => expect(seen.chatBodies).toHaveLength(1))
      const sent = String((seen.chatBodies[0] as { message?: unknown }).message ?? '')
      expect(sent).toContain('prop-script')
      expect(sent).toContain(dryRunMessage)
      expect(sent).toMatch(/engine-command/)
      expect(sent).toMatch(/member call/)
      // The failed source travels with the fix — the assistant never sees
      // proposals, so a bare proposal id would be unresolvable.
      expect(sent).toContain('Failed source')
      expect(sent).toContain('jump from top')
    })
  })
})
