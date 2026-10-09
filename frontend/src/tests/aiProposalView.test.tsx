import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiProposalView } from '../components/ai/AiProposalView'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useAiStore } from '../stores/aiStore'
import type { AiProposal } from '../api/aiApi'

function sampleProposal(overrides: Partial<AiProposal> = {}): AiProposal {
  return {
    id: 'prop-1',
    projectId: 'p-1',
    conversationId: 'c-1',
    title: 'Middle fill',
    status: 'validated',
    commands: [
      { type: 'CreateSlide', name: 'Middle 1' },
      { type: 'AiSetMorphCoefficient', nodeId: 'cat-1', coefficient: 0.5 },
    ],
    validation: { ok: true, errors: [] },
    baseFingerprint: 'fp-base',
    validatedFingerprint: null,
    dryRun: {},
    selectedIndexes: [],
    executions: [],
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    ...overrides,
  }
}

function renderView() {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatcher,
    dispatch: ((command: never) =>
      dispatcher.dispatch(command)) as unknown as EngineContextValue['dispatch'],
    persistence: { save: vi.fn(), onCommandSucceeded: () => undefined, dispose: () => undefined },
  }
  render(
    <EngineContext.Provider value={value}>
      <AiProposalView projectId="p-1" conversationId="c-1" />
    </EngineContext.Provider>,
  )
  return { engine, dispatcher, undoStack }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  useAiStore.setState({
    proposals: [],
    proposalById: {},
    activeProposalId: null,
    proposalBusy: false,
    proposalError: null,
  })
})

describe('AiProposalView validate-dry-run-execute pipeline', () => {
  it('renders commands with partial-acceptance checkboxes', () => {
    const proposal = sampleProposal()
    useAiStore.setState({
      proposals: [proposal],
      proposalById: { 'prop-1': proposal },
      activeProposalId: 'prop-1',
    })
    renderView()
    expect(screen.getByTestId('ai-proposal-section')).toBeInTheDocument()
    expect(screen.getByTestId('ai-proposal-command-0')).toHaveTextContent('CreateSlide')
    expect(screen.getByTestId('ai-proposal-check-0')).toBeChecked()
    expect(screen.getByTestId('ai-proposal-check-1')).toBeChecked()
  })

  it('partial acceptance unchecks one command before dry-run', async () => {
    const proposal = sampleProposal()
    useAiStore.setState({
      proposals: [proposal],
      proposalById: { 'prop-1': proposal },
      activeProposalId: 'prop-1',
    })
    renderView()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('ai-proposal-check-1'))
    expect(screen.getByTestId('ai-proposal-check-1')).not.toBeChecked()

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ...proposal, status: 'dry_run_ok' }), { status: 200 }),
    )
    await user.click(screen.getByTestId('ai-proposal-dry-run'))
    const dryRunCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/dry-run'))
    expect(dryRunCall).toBeDefined()
    const [, init] = dryRunCall as unknown as [string, RequestInit]
    // The dry-run reports the live fingerprint for stale-blocking at approval.
    expect(String(init?.body)).toContain('fp-')
  })

  it('blocks invalid proposals with a fixable server message before anything executes', () => {
    const proposal = sampleProposal({
      status: 'draft',
      validation: {
        ok: false,
        errors: [
          {
            index: 0,
            type: 'DeleteEverything',
            message: "unknown command type 'DeleteEverything'. Allowed: CreateSlide.",
          },
        ],
      },
    })
    useAiStore.setState({
      proposals: [proposal],
      proposalById: { 'prop-1': proposal },
      activeProposalId: 'prop-1',
    })
    renderView()
    expect(screen.getByTestId('ai-proposal-server-error-0')).toHaveTextContent('DeleteEverything')
    expect(screen.getByTestId('ai-proposal-execute')).toBeDisabled()
  })

  it('stale proposals are blocked at approval until re-validated', () => {
    const proposal = sampleProposal({
      status: 'dry_run_ok',
      validatedFingerprint: 'fp-stale-validation',
      dryRun: { ok: true, errors: [] },
    })
    useAiStore.setState({
      proposals: [proposal],
      proposalById: { 'prop-1': proposal },
      activeProposalId: 'prop-1',
    })
    renderView()
    // Live fingerprint differs from the validated one: stale gate shows.
    expect(screen.getByTestId('ai-proposal-stale')).toBeInTheDocument()
    expect(screen.getByTestId('ai-proposal-approve')).toBeDisabled()
    expect(screen.getByTestId('ai-proposal-execute')).toBeDisabled()
  })

  it('execution records link the single History Entry', () => {
    const proposal = sampleProposal({
      status: 'executed',
      selectedIndexes: [0],
      executions: [
        {
          id: 'exec-1',
          executedIndexes: [0],
          historyEntryId: 'hist-123',
          success: true,
          error: '',
          created: new Date().toISOString(),
        },
      ],
    })
    useAiStore.setState({
      proposals: [proposal],
      proposalById: { 'prop-1': proposal },
      activeProposalId: 'prop-1',
    })
    renderView()
    expect(screen.getByTestId('ai-proposal-execution-exec-1')).toHaveTextContent('Executed')
    expect(screen.getByTestId('ai-proposal-history-exec-1')).toHaveTextContent('hist-123')
  })

  it('shows degraded state when the backend is down', () => {
    render(<AiProposalView projectId="p-1" conversationId="c-1" disabled />)
    expect(screen.getByTestId('ai-proposal-disabled')).toBeInTheDocument()
  })
})
