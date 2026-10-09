import { useEffect, useState } from 'react'
import type { AiImageBrief, AiReconciliation } from '../../api/aiApi'
import { useAiStore } from '../../stores/aiStore'

interface AiReconciliationViewProps {
  projectId: string
  scenarioId: string | null
  conversationId: string | null
  context: unknown
  disabled?: boolean
}

export function AiReconciliationView({
  projectId,
  scenarioId,
  conversationId,
  context,
  disabled,
}: AiReconciliationViewProps) {
  const reconciliations = useAiStore((s) => s.reconciliations)
  const reconciliationById = useAiStore((s) => s.reconciliationById)
  const activeReconciliationId = useAiStore((s) => s.activeReconciliationId)
  const reconciliationBusy = useAiStore((s) => s.reconciliationBusy)
  const reconciliationError = useAiStore((s) => s.reconciliationError)
  const store = useAiStore.getState()

  const active = activeReconciliationId
    ? (reconciliationById[activeReconciliationId] ?? null)
    : null

  useEffect(() => {
    if (projectId) void store.loadReconciliations(projectId, scenarioId ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, scenarioId])

  useEffect(() => {
    if (activeReconciliationId) void store.loadReconciliation(activeReconciliationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeReconciliationId])

  if (disabled) {
    return (
      <div className="ai-reconciliation" data-testid="ai-reconciliation-section">
        <div data-testid="ai-reconciliation-disabled">
          Reconciliation unavailable — backend unreachable.
        </div>
      </div>
    )
  }

  const canRun = Boolean(projectId && scenarioId && conversationId && !reconciliationBusy)

  const handleRun = () => {
    if (!projectId || !scenarioId || !conversationId || reconciliationBusy) return
    void store.reconcileScenario(projectId, scenarioId, conversationId, context)
  }

  return (
    <div className="ai-reconciliation" data-testid="ai-reconciliation-section">
      <div className="ai-reconciliation__request">
        <button
          data-testid="ai-reconciliation-run"
          disabled={!canRun}
          onClick={handleRun}
          title={
            !scenarioId
              ? 'Accept an Action Scenario first — Stage B reads only the accepted version'
              : undefined
          }
        >
          Reconcile middle steps
        </button>
        {reconciliationBusy && <span data-testid="ai-reconciliation-generating">Reconciling…</span>}
        {reconciliationError && (
          <span data-testid="ai-reconciliation-error">{reconciliationError.message}</span>
        )}
      </div>

      {reconciliations.length > 0 && (
        <select
          data-testid="ai-reconciliation-select"
          value={activeReconciliationId ?? ''}
          onChange={(e) => store.setActiveReconciliation(e.target.value || null)}
        >
          {reconciliations.map((rec) => (
            <option key={rec.id} value={rec.id}>
              {rec.title} ({rec.status})
            </option>
          ))}
        </select>
      )}

      {active ? (
        <AiReconciliationDetail reconciliation={active} />
      ) : (
        <div data-testid="ai-reconciliation-empty">
          No reconciliation yet — accept a scenario, then reconcile its middle steps.
        </div>
      )}
    </div>
  )
}

function AiReconciliationDetail({ reconciliation }: { reconciliation: AiReconciliation }) {
  const store = useAiStore.getState()

  return (
    <div data-testid={`ai-reconciliation-${reconciliation.id}`}>
      <div data-testid="ai-reconciliation-status">Status: {reconciliation.status}</div>
      <div data-testid="ai-reconciliation-gate">
        {reconciliation.status === 'accepted'
          ? 'Accepted — Stage C Prompter work reads this version.'
          : 'Stage C waits on the accepted version.'}
      </div>
      <div data-testid="ai-reconciliation-counts">
        {reconciliation.middleStepCount} middle steps · {reconciliation.missingCount} missing assets
        · {reconciliation.briefs.length} briefs
      </div>

      <div className="ai-reconciliation__steps">
        {reconciliation.verdicts.map((step) => (
          <div key={step.stepId} data-testid={`ai-reconciliation-step-${step.stepId}`}>
            {step.skipped ? (
              <div data-testid={`ai-reconciliation-skipped-${step.stepId}`}>
                {step.partTag} step left alone (pregenerated reference).
              </div>
            ) : (
              <>
                <div data-testid={`ai-reconciliation-motion-${step.stepId}`}>
                  Motion: {step.motion?.state} — {step.motion?.explanation}
                </div>
                {step.assetVerdicts.map((verdict, index) => (
                  <AssetVerdictRow
                    key={`${step.stepId}-${verdict.hint}`}
                    reconciliationId={reconciliation.id}
                    stepId={step.stepId}
                    index={index}
                    hint={verdict.hint}
                    verdict={verdict.verdict}
                    candidates={verdict.candidates}
                    alternatives={verdict.alternatives}
                    decision={reconciliation.decisions[`${step.stepId}:${verdict.hint}`] ?? null}
                  />
                ))}
                {step.soundVerdicts.map((verdict) => (
                  <div
                    key={`${step.stepId}-sound-${verdict.hint}`}
                    data-testid={`ai-reconciliation-sound-${step.stepId}-${verdict.hint}`}
                  >
                    Sound: {verdict.hint} — {verdict.verdict}
                  </div>
                ))}
              </>
            )}
          </div>
        ))}
      </div>

      <div className="ai-reconciliation__briefs">
        <h4>Image-gen briefs</h4>
        {reconciliation.briefs.map((brief) => (
          <AiBriefEditor
            key={`${brief.id}-${brief.prompt}`}
            reconciliationId={reconciliation.id}
            brief={brief}
          />
        ))}
      </div>

      <div className="ai-reconciliation__actions">
        <button
          data-testid="ai-reconciliation-accept"
          disabled={reconciliation.status === 'accepted'}
          onClick={() => void store.acceptReconciliation(reconciliation.id)}
        >
          Accept
        </button>
        <button
          data-testid="ai-reconciliation-reject"
          disabled={reconciliation.status === 'rejected'}
          onClick={() => void store.rejectReconciliation(reconciliation.id)}
        >
          Reject
        </button>
      </div>
    </div>
  )
}

function AssetVerdictRow({
  reconciliationId,
  stepId,
  index,
  hint,
  verdict,
  candidates,
  alternatives,
  decision,
}: {
  reconciliationId: string
  stepId: string
  index: number
  hint: string
  verdict: 'matched' | 'missing'
  candidates: { definitionId: string; name: string; score: number; explanation: string }[]
  alternatives: { definitionId: string; name: string; score: number; explanation: string }[]
  decision: { decision: string; definitionId: string | null } | null
}) {
  const store = useAiStore.getState()
  const top = candidates[0]

  return (
    <div data-testid={`ai-reconciliation-verdict-${stepId}-${index}`}>
      <span>
        {hint} — {verdict}
      </span>
      {top && (
        <span data-testid={`ai-reconciliation-top-${stepId}-${index}`}>
          Top: {top.name} ({top.score.toFixed(2)}) — {top.explanation}
        </span>
      )}
      {decision && (
        <span data-testid={`ai-reconciliation-decision-${stepId}-${index}`}>
          Decision: {decision.decision}
          {decision.definitionId ? ` → ${decision.definitionId}` : ''}
        </span>
      )}
      <div>
        {(candidates.length > 0 ? candidates : alternatives.slice(0, 3)).map((candidate) => (
          <button
            key={candidate.definitionId}
            data-testid={`ai-reconciliation-accept-${stepId}-${candidate.definitionId}`}
            onClick={() =>
              void store.decideReconciliation(reconciliationId, {
                stepId,
                hint,
                decision: 'accept',
                definitionId: candidate.definitionId,
              })
            }
          >
            {decision?.decision === 'accepted' && decision.definitionId !== candidate.definitionId
              ? `Replace with ${candidate.name}`
              : `Accept ${candidate.name}`}
          </button>
        ))}
        <button
          data-testid={`ai-reconciliation-reject-${stepId}-${index}`}
          onClick={() =>
            void store.decideReconciliation(reconciliationId, { stepId, hint, decision: 'reject' })
          }
        >
          Reject
        </button>
        {decision && (
          <button
            data-testid={`ai-reconciliation-clear-${stepId}-${index}`}
            onClick={() => void store.clearReconciliationDecision(reconciliationId, stepId, hint)}
          >
            Clear decision
          </button>
        )}
      </div>
      {alternatives.length > 0 && candidates.length > 0 && (
        <details>
          <summary>Alternatives ({alternatives.length})</summary>
          {alternatives.slice(0, 5).map((alt) => (
            <div key={alt.definitionId}>
              {alt.name} ({alt.score.toFixed(2)}) — {alt.explanation}
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

function AiBriefEditor({
  reconciliationId,
  brief,
}: {
  reconciliationId: string
  brief: AiImageBrief
}) {
  const [draft, setDraft] = useState(brief.prompt)
  const [copied, setCopied] = useState(false)
  const store = useAiStore.getState()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div data-testid={`ai-reconciliation-brief-${brief.id}`}>
      <div>
        {brief.hint} · style: {brief.styleProfile.name}
      </div>
      <textarea
        data-testid={`ai-reconciliation-brief-input-${brief.id}`}
        aria-label={`Image brief for ${brief.hint}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div data-testid={`ai-reconciliation-brief-wizard-${brief.id}`}>
        Wizard entry: {brief.wizardEntry.assetName} · {brief.wizardEntry.styleProfile.name} ·{' '}
        {brief.productionConstraints}
      </div>
      <div>{brief.providerNote}</div>
      <button
        data-testid={`ai-reconciliation-brief-copy-${brief.id}`}
        onClick={() => void handleCopy()}
      >
        {copied ? 'Copied' : 'Copy prompt'}
      </button>
      <button
        data-testid={`ai-reconciliation-brief-save-${brief.id}`}
        disabled={draft === brief.prompt}
        onClick={() =>
          void store.updateReconciliationBriefs(reconciliationId, [{ id: brief.id, prompt: draft }])
        }
      >
        Save brief
      </button>
    </div>
  )
}
