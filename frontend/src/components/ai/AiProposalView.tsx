import { useEffect, useMemo, useState } from 'react'
import {
  buildExecutableCommands,
  dryRunValidate,
  executeProposal,
  isStale,
  type AiCommandJson,
} from '../../ai/proposals'
import { ShikiCode } from '../../ai/markdown'
import { useFingerprint } from '../../ai/proposalFingerprint'
import { useEngine } from '../../app/useEngine'
import { useAiStore } from '../../stores/aiStore'
import type { AiProposal } from '../../api/aiApi'
import type { AnimationAssetOperation } from '../../ai/animationAssetOperations'
import { AiAnimationAssetPreview } from './AiAnimationAssetPreview'
import { AiAnimationScriptPreview } from './AiAnimationScriptPreview'

function animationOperationLabel(
  operation: AnimationAssetOperation,
  engine: import('../../engine').EnginePublic,
): string {
  switch (operation.kind) {
    case 'upsertShape':
      return `${operation.action} Shape “${operation.shape.name}” on ${operation.nodeId}`
    case 'deleteShape':
      return `delete Shape “${engine.getShapes(operation.nodeId).find((shape) => shape.id === operation.shapeId)?.name ?? operation.shapeId}”`
    case 'upsertClip':
      return `${operation.action} Clip “${operation.clip.name}”${operation.nodeId ? ` for ${operation.nodeId}` : ''}`
    case 'deleteClip':
      return `delete Clip “${engine.clips.find((clip) => clip.id === operation.clipId)?.name ?? operation.clipId}”`
    case 'deleteClipInstance':
      return `delete Clip Instance ${operation.instanceId} from ${operation.nodeId}`
    case 'upsertCollection':
      return `${operation.action} Clip Collection “${operation.collection.name}”`
    case 'deleteCollection':
      return `delete Clip Collection “${engine.clipCollections.find((collection) => collection.id === operation.collectionId)?.name ?? operation.collectionId}”`
  }
}

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

export function AiProposalDetail({
  proposal,
  fingerprint,
  onDenyFeedback,
}: {
  proposal: AiProposal
  fingerprint: string
  onDenyFeedback?: (feedback: string) => void
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
  const [denialFeedback, setDenialFeedback] = useState('')
  const [denialError, setDenialError] = useState<string | null>(null)

  const assetOperations = useMemo(() => {
    const command = proposal.commands.find((entry) => entry.type === 'AiAnimationAssetBatch')
    return Array.isArray(command?.operations)
      ? (command.operations as AnimationAssetOperation[])
      : null
  }, [proposal.commands])
  const animationScript = useMemo(() => {
    const command = proposal.commands.find(
      (entry) =>
        entry.type === 'SetSlideAnimationScript' ||
        entry.type === 'AiRunAnimationScript' ||
        entry.type === 'AiDeleteAnimationScript',
    )
    if (!command || typeof command.slideId !== 'string') return null
    if (command.type === 'AiDeleteAnimationScript') {
      try {
        const script = engine.getSlide(command.slideId).animationScript
        return script ? { slideId: command.slideId, source: script.source, deleting: true } : null
      } catch {
        return null
      }
    }
    return typeof command.source === 'string'
      ? { slideId: command.slideId, source: command.source, deleting: false }
      : null
  }, [proposal.commands, engine])

  const stale = isStale(proposal.validatedFingerprint, fingerprint)
  // A fresh draft has no validation yet — that is not project drift, so it
  // gets its own notice instead of the stale warning.
  const neverValidated = proposal.validatedFingerprint == null

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

  const handleApproveAndApply = async () => {
    setExecuteError(null)
    if (stale) {
      setExecuteError('The Project changed since preview. Refresh and review this proposal again.')
      return
    }
    const dryRun = dryRunValidate(engine, proposal.commands as AiCommandJson[], selected)
    await store.reportDryRun(proposal.id, {
      projectFingerprint: dryRun.fingerprint,
      ok: dryRun.ok,
      errors: [...dryRun.errors],
      validatedIndexes: [...selected],
    })
    if (!dryRun.ok) {
      setExecuteError(dryRun.errors[0]?.message ?? 'Validation failed. No changes were made.')
      return
    }
    const approved = await store.approveProposal(proposal.id, dryRun.fingerprint, [...selected])
    if (approved?.status !== 'approved' || !dispatcher) return
    const result = executeProposal(
      { dispatcher, undoStack },
      buildExecutableCommands(approved.commands as AiCommandJson[], approved.selectedIndexes),
    )
    if (!result.ok) {
      setExecuteError(result.error ?? 'Execution failed. No changes were made.')
      void store.recordExecution(proposal.id, {
        historyEntryId: '',
        executedIndexes: [...approved.selectedIndexes],
        success: false,
        error: result.error ?? 'Execution failed.',
      })
      return
    }
    void store.recordExecution(proposal.id, {
      historyEntryId: result.historyEntryId ?? '',
      executedIndexes: [...approved.selectedIndexes],
      success: true,
    })
  }

  const handleDeny = async () => {
    const feedback = denialFeedback.trim()
    if (!feedback) {
      setDenialError('Add a short note so the assistant knows what to change.')
      return
    }
    setDenialError(null)
    const rejected = await store.rejectProposal(proposal.id, feedback)
    if (rejected) onDenyFeedback?.(feedback)
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
    <div data-testid={`ai-proposal-${proposal.id}`} className="ai-proposal__detail">
      <div data-testid="ai-proposal-status" className="ai-proposal__status">
        Status: {proposal.status}
      </div>
      {assetOperations && (
        <>
          <div data-testid="ai-animation-asset-operations">
            {assetOperations.map((operation, index) => (
              <div key={`${operation.kind}-${index}`}>
                {animationOperationLabel(operation, engine)}
              </div>
            ))}
          </div>
          <AiAnimationAssetPreview
            engine={engine}
            operations={assetOperations}
            revision={`${proposal.modified}:${fingerprint}`}
          />
        </>
      )}
      {animationScript && (
        <>
          {animationScript.deleting && (
            <div data-testid="ai-animation-script-delete-impact">
              Deleting the retained Animation Script clears its compiled footprint on{' '}
              {engine.getSlide(animationScript.slideId).name}: tracks, placements, instances, and
              script-created objects recorded by that run.
            </div>
          )}
          <AiAnimationScriptPreview
            engine={engine}
            slideId={animationScript.slideId}
            source={animationScript.source}
            revision={proposal.modified}
          />
        </>
      )}
      {neverValidated && proposal.status !== 'approved' && (
        <div data-testid="ai-proposal-unvalidated" className="ai-proposal__warning">
          Not yet validated — run Dry-run validate first, then approve.
        </div>
      )}
      {stale && !neverValidated && proposal.status !== 'approved' && (
        <div data-testid="ai-proposal-stale" className="ai-proposal__warning">
          Stale — the project changed since validation. Re-run the dry-run, then approve again.
        </div>
      )}
      {proposal.validation && !proposal.validation.ok && (
        <div data-testid="ai-proposal-server-errors" className="ai-proposal__errors" role="alert">
          {(proposal.validation.errors ?? []).map((e, i) => (
            <div key={i} data-testid={`ai-proposal-server-error-${i}`}>
              {e.message}
            </div>
          ))}
        </div>
      )}
      <div className="ai-proposal__commands">
        {proposal.commands.map((command, index) => (
          <label
            key={index}
            data-testid={`ai-proposal-command-${index}`}
            className="ai-proposal__command"
          >
            <span className="ai-proposal__command-head">
              <input
                type="checkbox"
                data-testid={`ai-proposal-check-${index}`}
                checked={selected.includes(index)}
                onChange={() => toggleSelected(index)}
              />
              <span
                data-testid={`ai-proposal-command-type-${index}`}
                className="ai-proposal__command-type"
              >
                {command.type}
              </span>
            </span>
            {command.type === 'AiAnimationAssetBatch' ? (
              <span>See the visual asset review above.</span>
            ) : (
              <CommandPayload command={command} />
            )}
          </label>
        ))}
      </div>
      {proposal.status !== 'rejected' && proposal.status !== 'executed' && (
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
          {(assetOperations || animationScript) && (
            <button
              data-testid="ai-proposal-approve-and-apply"
              disabled={proposalBusy || selected.length === 0 || stale}
              onClick={() => void handleApproveAndApply()}
            >
              Approve and apply
            </button>
          )}
          <button data-testid="ai-proposal-undo" onClick={() => dispatcher?.undo()}>
            Undo last
          </button>
        </div>
      )}
      {proposal.status === 'rejected' ? (
        <div data-testid="ai-proposal-rejected">Denied — {proposal.rejectionFeedback}</div>
      ) : (
        proposal.status !== 'executed' && (
          <div data-testid="ai-proposal-deny">
            <label>
              Feedback for the next draft
              <textarea
                data-testid="ai-proposal-denial-feedback"
                value={denialFeedback}
                onChange={(event) => setDenialFeedback(event.target.value)}
              />
            </label>
            <button
              data-testid="ai-proposal-deny-button"
              disabled={proposalBusy}
              onClick={() => void handleDeny()}
            >
              Deny and revise
            </button>
            {denialError && <div role="alert">{denialError}</div>}
          </div>
        )
      )}
      {dryRunMessage && (
        <div data-testid="ai-proposal-dry-run-message" className="ai-proposal__notice">
          {dryRunMessage}
        </div>
      )}
      {proposal.dryRun && proposal.dryRun.errors && proposal.dryRun.errors.length > 0 && (
        <div data-testid="ai-proposal-dry-run-errors" className="ai-proposal__errors" role="alert">
          {proposal.dryRun.errors.map((e, i) => (
            <div key={i} data-testid={`ai-proposal-dry-run-error-${i}`}>
              {e.message}
            </div>
          ))}
        </div>
      )}
      {proposalError && (
        <div data-testid="ai-proposal-error" className="ai-proposal__errors" role="alert">
          {proposalError.message}
        </div>
      )}
      {executeError && (
        <div data-testid="ai-proposal-execute-error" className="ai-proposal__errors" role="alert">
          {executeError}
        </div>
      )}
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

function CommandPayload({ command }: { command: AiCommandJson }) {
  if (command.type === 'SetSlideAnimationScript' && typeof command.source === 'string') {
    const slideId = typeof command.slideId === 'string' ? command.slideId : ''
    return (
      <span className="ai-proposal__payload">
        {slideId && (
          <span className="ai-proposal__payload-slide" data-testid="ai-proposal-payload-slide">
            slide {slideId}
          </span>
        )}
        <pre className="ai-proposal__payload-source">
          <code>{command.source}</code>
        </pre>
      </span>
    )
  }
  return (
    <span className="ai-proposal__payload">
      <ShikiCode code={JSON.stringify(command, null, 2)} language="json" />
    </span>
  )
}
