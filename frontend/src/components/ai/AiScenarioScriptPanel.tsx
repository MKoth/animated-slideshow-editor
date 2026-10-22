import type { PlannerResult } from '../../ai/scenarioPlanner'

export interface ScenarioScriptPreview {
  readonly acceptedVersionId: string
  readonly plan: PlannerResult
}

interface AiScenarioScriptPanelProps {
  readonly preview: ScenarioScriptPreview
  readonly currentAcceptedVersionId: string | null
  readonly applying: boolean
  readonly applyError: string | null
  readonly onApply: () => void
  readonly onClose: () => void
}

/**
 * Reviewable script-draft preview (issue #471): per-slide durations, board
 * sources, block fractions, and diagnostics before anything is written. Hard
 * errors block Apply; a preview computed against a superseded accepted
 * snapshot is stale and cannot apply until re-generated.
 */
export function AiScenarioScriptPanel({
  preview,
  currentAcceptedVersionId,
  applying,
  applyError,
  onApply,
  onClose,
}: AiScenarioScriptPanelProps) {
  const stale = currentAcceptedVersionId !== preview.acceptedVersionId
  const blocked = preview.plan.blocked
  return (
    <div data-testid="ai-scenario-script-preview">
      <div data-testid="ai-scenario-script-preview-summary">
        Script draft from accepted {preview.acceptedVersionId.slice(0, 8)} —{' '}
        {preview.plan.slides.length} slide(s)
        {stale ? ' — stale, accepted version changed since this preview' : ''}
        {!stale && blocked ? ' — blocked by errors, fix the accepted scenario to apply' : ''}
      </div>
      {preview.plan.diagnostics.length > 0 && (
        <ul data-testid="ai-scenario-script-diagnostics">
          {preview.plan.diagnostics.map((diagnostic, index) => (
            <li
              key={index}
              data-testid={`ai-scenario-script-diagnostic-${index}`}
              data-severity={diagnostic.severity}
            >
              [{diagnostic.severity}]{diagnostic.step ? ` step ${diagnostic.step}` : ''}{' '}
              {diagnostic.code ? `(${diagnostic.code}) ` : ''}
              {diagnostic.message}
            </li>
          ))}
        </ul>
      )}
      <ol>
        {preview.plan.slides.map((slide) => (
          <li key={slide.position} data-testid={`ai-scenario-script-slide-${slide.position}`}>
            <div data-testid={`ai-scenario-script-slide-title-${slide.position}`}>
              Slide {slide.position}: {slide.slideName} — {slide.duration.toFixed(2)}s (prompter{' '}
              {slide.prompterDuration.toFixed(2)}s){slide.padded ? ' · padded' : ''}
            </div>
            <div data-testid={`ai-scenario-script-slide-prompter-${slide.position}`}>
              Prompter: {slide.prompterText}
            </div>
            <details>
              <summary>Board source</summary>
              <pre data-testid={`ai-scenario-script-slide-source-${slide.position}`}>
                {slide.source}
              </pre>
            </details>
            <ul data-testid={`ai-scenario-script-slide-fractions-${slide.position}`}>
              {slide.fractions.map((fraction, index) => (
                <li key={index}>
                  {fraction.action} @ {fraction.block} {fraction.fraction.toFixed(3)}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <button
        data-testid="ai-scenario-script-apply"
        disabled={blocked || stale || applying}
        title={
          blocked
            ? 'Blocked — fix the reported errors in the accepted scenario first'
            : stale
              ? 'Stale — the accepted snapshot changed, re-run Generate Script'
              : 'Write slides, prompter parts, and board scripts in one undoable step'
        }
        onClick={onApply}
      >
        {applying ? 'Applying…' : 'Apply draft'}
      </button>
      {blocked && !stale && (
        <div data-testid="ai-scenario-script-blocked-hint">
          Blocked — fix the reported errors in the accepted scenario, accept the fix, and re-run
          Generate Script.
        </div>
      )}
      {applyError && <div data-testid="ai-scenario-script-apply-error">{applyError}</div>}
      <button data-testid="ai-scenario-script-preview-close" onClick={onClose}>
        Close preview
      </button>
    </div>
  )
}
