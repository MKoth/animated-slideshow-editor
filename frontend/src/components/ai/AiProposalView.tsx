import { useEffect, useMemo, useState } from 'react'
import {
  buildExecutableCommands,
  computeProjectFingerprint,
  dryRunValidate,
  executeProposal,
  isStale,
  type AiCommandJson,
} from '../../ai/proposals'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { useAiStore } from '../../stores/aiStore'
import type { AiProposal } from '../../api/aiApi'

interface AiProposalViewProps {
  projectId: string
  conversationId: string | null
  disabled?: boolean
}

export function AiProposalView({ projectId, conversationId, disabled }: AiProposalViewProps) {
  if (disabled) {
    return (
      <div className="ai-proposal" data-testid="ai-proposal-section">
        <div data-testid="ai-proposal-disabled">
          Edit proposals unavailable — backend unreachable.
        </div>
      </div>
    )
  }
  return <AiProposalLive projectId={projectId} conversationId={conversationId} />
}

function AiProposalLive({
  projectId,
  conversationId,
}: {
  projectId: string
  conversationId: string | null
}) {
  const proposals = useAiStore((s) => s.proposals)
  const proposalById = useAiStore((s) => s.proposalById)
  const activeProposalId = useAiStore((s) => s.activeProposalId)
  const proposalBusy = useAiStore((s) => s.proposalBusy)
  const store = useAiStore.getState()

  const [titleDraft, setTitleDraft] = useState('')
  const [commandsDraft, setCommandsDraft] = useState('[]')
  const [createError, setCreateError] = useState<string | null>(null)

  const { engine } = useEngine()
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((t) => t + 1))

  useEffect(() => {
    if (projectId) void store.loadProposals(projectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  const active = activeProposalId ? (proposalById[activeProposalId] ?? null) : null

  const fingerprint = useFingerprint(engine)

  const handleCreate = () => {
    setCreateError(null)
    if (!conversationId) {
      setCreateError('Select a conversation first.')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(commandsDraft)
    } catch {
      setCreateError('Commands must be a JSON array.')
      return
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      setCreateError('Commands must be a non-empty JSON array.')
      return
    }
    void store
      .createProposal({
        projectId,
        conversationId,
        title: titleDraft.trim() || 'Untitled proposal',
        commands: parsed as AiCommandJson[],
        projectFingerprint: fingerprint,
      })
      .then((created) => {
        if (created) setTitleDraft('')
      })
  }

  return (
    <div className="ai-proposal" data-testid="ai-proposal-section">
      <h4>AI Edit Proposals</h4>
      <div className="ai-proposal__create">
        <input
          data-testid="ai-proposal-title"
          placeholder="Proposal title"
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
        />
        <textarea
          data-testid="ai-proposal-commands"
          aria-label="Proposal commands JSON"
          placeholder='[{"type":"CreateSlide","name":"Middle 1"}]'
          value={commandsDraft}
          onChange={(e) => setCommandsDraft(e.target.value)}
        />
        <button
          data-testid="ai-proposal-create"
          disabled={!conversationId || proposalBusy}
          onClick={handleCreate}
        >
          Propose edit
        </button>
        {createError && <span data-testid="ai-proposal-create-error">{createError}</span>}
      </div>

      {proposals.length > 0 && (
        <select
          data-testid="ai-proposal-select"
          value={activeProposalId ?? ''}
          onChange={(e) => store.setActiveProposal(e.target.value || null)}
        >
          {proposals.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} ({p.status})
            </option>
          ))}
        </select>
      )}

      {!active ? (
        <div data-testid="ai-proposal-empty">No edit proposal yet — paste commands above.</div>
      ) : (
        <AiProposalDetail
          key={`${active.id}-${active.modified}`}
          proposal={active}
          fingerprint={fingerprint}
        />
      )}
    </div>
  )
}

function useFingerprint(engine: ReturnType<typeof useEngine>['engine']): string {
  const [tick, setTick] = useState(0)
  useEngineEvent(() => setTick((t) => t + 1))
  return useMemo(() => {
    void tick
    try {
      return computeProjectFingerprint(engine)
    } catch {
      return ''
    }
  }, [engine, tick])
}

function AiProposalDetail({
  proposal,
  fingerprint,
}: {
  proposal: AiProposal
  fingerprint: string
}) {
  const proposalBusy = useAiStore((s) => s.proposalBusy)
  const proposalError = useAiStore((s) => s.proposalError)
  const store = useAiStore.getState()
  const { engine, dispatcher, undoStack } = useEngine()

  const [selected, setSelected] = useState<number[]>(() =>
    proposal.selectedIndexes.length > 0
      ? [...proposal.selectedIndexes]
      : proposal.commands.map((_, i) => i),
  )
  const [dryRunMessage, setDryRunMessage] = useState<string | null>(null)
  const [executeError, setExecuteError] = useState<string | null>(null)

  const stale = isStale(proposal.validatedFingerprint, fingerprint)

  const toggleSelected = (index: number) => {
    setSelected((prev) =>
      prev.includes(index)
        ? prev.filter((i) => i !== index)
        : [...prev, index].sort((a, b) => a - b),
    )
  }

  const handleDryRun = () => {
    setDryRunMessage(null)
    const result = dryRunValidate(engine, proposal.commands as AiCommandJson[], selected)
    void store
      .reportDryRun(proposal.id, {
        projectFingerprint: result.fingerprint,
        ok: result.ok,
        errors: [...result.errors],
        validatedIndexes: [...selected],
      })
      .then(() => {
        setDryRunMessage(
          result.ok
            ? `Dry-run passed on ${selected.length} command(s).`
            : (result.errors[0]?.message ?? 'Dry-run failed.'),
        )
      })
  }

  const handleApprove = () => {
    void store.approveProposal(proposal.id, fingerprint, [...selected])
  }

  const handleExecute = () => {
    if (!dispatcher) return
    setExecuteError(null)
    const approvedIndexes =
      proposal.selectedIndexes.length > 0 ? proposal.selectedIndexes : selected
    const subset = buildExecutableCommands(proposal.commands as AiCommandJson[], approvedIndexes)
    const result = executeProposal({ dispatcher, undoStack }, subset)
    if (!result.ok) {
      setExecuteError(result.error ?? 'Execution failed.')
      void store.recordExecution(proposal.id, {
        historyEntryId: '',
        executedIndexes: [...approvedIndexes],
        success: false,
        error: result.error ?? 'Execution failed.',
      })
      return
    }
    void store.recordExecution(proposal.id, {
      historyEntryId: result.historyEntryId ?? '',
      executedIndexes: [...approvedIndexes],
      success: true,
    })
  }

  return (
    <div data-testid={`ai-proposal-${proposal.id}`}>
      <div data-testid="ai-proposal-status">Status: {proposal.status}</div>
      {stale && proposal.status !== 'approved' && (
        <div data-testid="ai-proposal-stale">
          Stale — the project changed since validation. Re-run the dry-run, then approve again.
        </div>
      )}
      {proposal.validation && !proposal.validation.ok && (
        <div data-testid="ai-proposal-server-errors">
          {(proposal.validation.errors ?? []).map((e, i) => (
            <div key={i} data-testid={`ai-proposal-server-error-${i}`}>
              {e.message}
            </div>
          ))}
        </div>
      )}
      <div className="ai-proposal__commands">
        {proposal.commands.map((command, index) => (
          <label key={index} data-testid={`ai-proposal-command-${index}`}>
            <input
              type="checkbox"
              data-testid={`ai-proposal-check-${index}`}
              checked={selected.includes(index)}
              onChange={() => toggleSelected(index)}
            />
            <span data-testid={`ai-proposal-command-type-${index}`}>{command.type}</span>
            <code>{JSON.stringify(command)}</code>
          </label>
        ))}
      </div>
      <div className="ai-proposal__actions">
        <button
          data-testid="ai-proposal-dry-run"
          disabled={proposalBusy || selected.length === 0}
          onClick={handleDryRun}
        >
          Dry-run validate
        </button>
        <button
          data-testid="ai-proposal-approve"
          disabled={proposalBusy || selected.length === 0 || stale}
          title={stale ? 'Re-run the dry-run first — the project moved.' : undefined}
          onClick={handleApprove}
        >
          Approve subset
        </button>
        <button
          data-testid="ai-proposal-execute"
          disabled={proposalBusy || proposal.status !== 'approved' || stale}
          title={
            stale
              ? 'Re-run the dry-run first — the project moved.'
              : proposal.status !== 'approved'
                ? 'Approve the subset first.'
                : undefined
          }
          onClick={handleExecute}
        >
          Execute approved
        </button>
        <button data-testid="ai-proposal-undo" onClick={() => dispatcher?.undo()}>
          Undo last
        </button>
      </div>
      {dryRunMessage && <div data-testid="ai-proposal-dry-run-message">{dryRunMessage}</div>}
      {proposal.dryRun && proposal.dryRun.errors && proposal.dryRun.errors.length > 0 && (
        <div data-testid="ai-proposal-dry-run-errors">
          {proposal.dryRun.errors.map((e, i) => (
            <div key={i} data-testid={`ai-proposal-dry-run-error-${i}`}>
              {e.message}
            </div>
          ))}
        </div>
      )}
      {proposalError && <div data-testid="ai-proposal-error">{proposalError.message}</div>}
      {executeError && <div data-testid="ai-proposal-execute-error">{executeError}</div>}
      {proposal.executions.length > 0 && (
        <div data-testid="ai-proposal-executions">
          {proposal.executions.map((execution) => (
            <div key={execution.id} data-testid={`ai-proposal-execution-${execution.id}`}>
              {execution.success ? 'Executed' : 'Failed'} [{execution.executedIndexes.join(', ')}]
              {execution.historyEntryId && (
                <span data-testid={`ai-proposal-history-${execution.id}`}>
                  {' '}
                  history {execution.historyEntryId}
                </span>
              )}
              {execution.error && <span> — {execution.error}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
