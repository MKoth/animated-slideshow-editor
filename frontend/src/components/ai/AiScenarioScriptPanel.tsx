import type { PlannerResult } from '../../ai/scenarioPlanner'
import { highlightAnimationScript } from '../panels/AnimationScriptViewer'

export interface ScenarioScriptPreview {
  readonly acceptedVersionId: string
  readonly plan: PlannerResult
}

export interface ScenarioScriptTtsProgress {
  readonly done: number
  readonly total: number
}

export type ScenarioScriptStepStatus = 'idle' | 'applying' | 'done'

export interface ScenarioScriptStepUiState {
  readonly position: number
  readonly slideName: string
  readonly ttsStatus: ScenarioScriptStepStatus
  readonly ttsProgress: ScenarioScriptTtsProgress | null
  readonly ttsError: string | null
  readonly boardStatus: ScenarioScriptStepStatus
  readonly boardError: string | null
}

interface AiScenarioScriptPanelProps {
  readonly preview: ScenarioScriptPreview
  readonly currentAcceptedVersionId: string | null
  readonly prompterApplying: boolean
  readonly prompterError: string | null
  readonly prompterApplied: boolean
  readonly onApplyPrompter: () => void
  readonly steps: readonly ScenarioScriptStepUiState[]
  readonly onGenerateTtsStep: (position: number) => void
  readonly onApplyBoardStep: (position: number) => void
  readonly onClose: () => void
}

/**
 * Distinct color per prompt block so split prompter parts stay visually
 * distinguishable across slides, fractions, and board sources. Base palette
 * cycles by prompt-N number; sub-blocks (`prompt-N-M`) offset by the part
 * index so siblings differ while staying related; unknown names hash into it.
 */
export const PROMPT_BLOCK_COLORS = [
  '#e6194b',
  '#4363d8',
  '#3cb44b',
  '#f58231',
  '#911eb4',
  '#0096c7',
  '#f032e6',
  '#008080',
] as const

export function promptBlockColor(block: string): string {
  const sub = /prompt-(\d+)-(\d+)/.exec(block)
  if (sub) {
    const n = Number(sub[1])
    const m = Number(sub[2])
    if (Number.isFinite(n) && Number.isFinite(m)) {
      const index = (n - 1 + (m - 1) * 3) % PROMPT_BLOCK_COLORS.length
      return PROMPT_BLOCK_COLORS[
        ((index % PROMPT_BLOCK_COLORS.length) + PROMPT_BLOCK_COLORS.length) %
          PROMPT_BLOCK_COLORS.length
      ]!
    }
  }
  const match = /prompt-(\d+)/.exec(block)
  if (match) {
    const n = Number(match[1])
    if (Number.isFinite(n)) {
      return PROMPT_BLOCK_COLORS[
        (((n - 1) % PROMPT_BLOCK_COLORS.length) + PROMPT_BLOCK_COLORS.length) %
          PROMPT_BLOCK_COLORS.length
      ]!
    }
  }
  let hash = 0
  for (let i = 0; i < block.length; i++) hash = (hash * 31 + block.charCodeAt(i)) | 0
  return PROMPT_BLOCK_COLORS[Math.abs(hash) % PROMPT_BLOCK_COLORS.length]!
}

/**
 * Reviewable script-draft preview (issue #471): per-slide durations, board
 * sources, block fractions, and diagnostics before anything is written.
 * Three-step apply with persisted per-step states: (1) prompter text writes
 * slides + prompter parts + durations; (2) per-step TTS synthesizes that
 * step's prompter blocks sequentially with the saved TTS defaults; (3)
 * per-step board buttons write animation sources onto the Step-1 slides.
 * Steps 2 and 3 need Step 1 first but are otherwise independent; completed
 * buttons flip to Regenerate. Hard errors block all steps; a preview
 * computed against a superseded accepted snapshot is stale and cannot apply
 * until re-generated.
 */
export function AiScenarioScriptPanel({
  preview,
  currentAcceptedVersionId,
  prompterApplying,
  prompterError,
  prompterApplied,
  onApplyPrompter,
  steps,
  onGenerateTtsStep,
  onApplyBoardStep,
  onClose,
}: AiScenarioScriptPanelProps) {
  const stale = currentAcceptedVersionId !== preview.acceptedVersionId
  const blocked = preview.plan.blocked
  const stepsBlocked = blocked || stale
  const busy =
    prompterApplying ||
    steps.some((s) => s.ttsStatus === 'applying' || s.boardStatus === 'applying')
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
          <li
            key={slide.position}
            data-testid={`ai-scenario-script-slide-${slide.position}`}
            style={{
              margin: '8px 0',
              padding: '8px',
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              borderLeft: `4px solid ${promptBlockColor(slide.promptBlockId)}`,
              listStyle: 'none',
            }}
          >
            <div
              data-testid={`ai-scenario-script-slide-title-${slide.position}`}
              style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
            >
              <span>
                Slide {slide.position}: {slide.slideName} — {slide.duration.toFixed(2)}s (prompter{' '}
                {slide.prompterDuration.toFixed(2)}s){slide.padded ? ' · padded' : ''}
              </span>
              <span
                data-testid={`ai-scenario-script-slide-block-${slide.position}`}
                data-block={slide.promptBlockId}
                title={`Owning prompt block ${slide.promptBlockId}`}
                style={{
                  display: 'inline-block',
                  padding: '1px 8px',
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#fff',
                  background: promptBlockColor(slide.promptBlockId),
                }}
              >
                {slide.promptBlockId}
              </span>
            </div>
            <div
              data-testid={`ai-scenario-script-slide-prompter-${slide.position}`}
              style={{ margin: '6px 0', display: 'flex', flexDirection: 'column', gap: 6 }}
            >
              {(slide.prompterParts.length > 0
                ? slide.prompterParts.map((part) => ({
                    block: part.promptBlockId,
                    text: part.text,
                    duration: part.duration,
                  }))
                : [
                    {
                      block: slide.promptBlockId,
                      text: slide.prompterText,
                      duration: slide.duration,
                    },
                  ]
              ).map((part, partIndex) => (
                <div
                  key={partIndex}
                  data-testid={`ai-scenario-script-slide-prompter-${slide.position}-${partIndex + 1}`}
                  data-block={part.block}
                  title={`Prompt block ${part.block} (${part.duration.toFixed(2)}s)`}
                  style={{
                    padding: '6px 8px',
                    borderLeft: `4px solid ${promptBlockColor(part.block)}`,
                    borderRadius: 4,
                    background: `color-mix(in srgb, ${promptBlockColor(part.block)} 12%, transparent)`,
                  }}
                >
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '1px 8px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#fff',
                      background: promptBlockColor(part.block),
                      marginRight: 8,
                    }}
                  >
                    {part.block}
                  </span>
                  <span>{part.text}</span>
                  <span style={{ opacity: 0.7, marginLeft: 8 }}>({part.duration.toFixed(2)}s)</span>
                </div>
              ))}
            </div>
            <details open>
              <summary>Board source</summary>
              <pre
                data-testid={`ai-scenario-script-slide-source-${slide.position}`}
                style={{
                  margin: '4px 0 0',
                  padding: 8,
                  overflow: 'auto',
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12,
                  lineHeight: '18px',
                  whiteSpace: 'pre',
                }}
              >
                <code
                  className="anim-code"
                  dangerouslySetInnerHTML={{ __html: highlightAnimationScript(slide.source) }}
                />
              </pre>
            </details>
            <ul data-testid={`ai-scenario-script-slide-fractions-${slide.position}`}>
              {slide.fractions.map((fraction, index) => (
                <li
                  key={index}
                  data-block={fraction.block}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: promptBlockColor(fraction.block),
                    }}
                  />
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0 6px',
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 600,
                      color: '#fff',
                      background: promptBlockColor(fraction.block),
                    }}
                  >
                    {fraction.block}
                  </span>
                  <span>
                    {fraction.action} {fraction.fraction.toFixed(3)}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          data-testid="ai-scenario-script-apply-prompter"
          disabled={stepsBlocked || busy}
          title={
            blocked
              ? 'Blocked — fix the reported errors in the accepted scenario first'
              : stale
                ? 'Stale — the accepted snapshot changed, re-run Generate Script'
                : prompterApplied
                  ? 'Step 1 — rewrite slides, prompter parts, and durations in one undoable step (re-applying drops existing TTS audio and resets per-step states)'
                  : 'Step 1 — write slides, prompter parts, and durations in one undoable step'
          }
          onClick={onApplyPrompter}
        >
          {prompterApplying
            ? 'Applying prompter…'
            : prompterApplied
              ? '1. Re-apply prompter text'
              : '1. Apply prompter text'}
        </button>
      </div>
      {prompterApplied && (
        <div data-testid="ai-scenario-script-prompter-done">
          Prompter text applied — per-step TTS and board buttons below.
        </div>
      )}
      {prompterApplied && (
        <ol data-testid="ai-scenario-script-steps" style={{ listStyle: 'none', padding: 0 }}>
          {steps.map((step) => {
            const ttsDisabled = stepsBlocked || busy || !prompterApplied
            const boardDisabled = stepsBlocked || busy || !prompterApplied
            return (
              <li
                key={step.position}
                data-testid={`ai-scenario-script-step-${step.position}`}
                style={{
                  margin: '8px 0',
                  padding: '8px',
                  borderRadius: 8,
                  border: '1px solid var(--color-border)',
                }}
              >
                <div style={{ fontWeight: 600 }}>
                  Step {step.position}: {step.slideName}
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    marginTop: 6,
                  }}
                >
                  <button
                    data-testid={`ai-scenario-script-generate-tts-${step.position}`}
                    disabled={ttsDisabled}
                    title={
                      blocked
                        ? 'Blocked — fix the reported errors in the accepted scenario first'
                        : stale
                          ? 'Stale — the accepted snapshot changed, re-run Generate Script'
                          : 'Synthesize this step’s prompter blocks sequentially with the saved TTS defaults (one undoable step)'
                    }
                    onClick={() => onGenerateTtsStep(step.position)}
                  >
                    {step.ttsStatus === 'applying'
                      ? 'Generating TTS…'
                      : step.ttsStatus === 'done'
                        ? `Regenerate TTS — Step ${step.position}`
                        : `2. Generate TTS — Step ${step.position}`}
                  </button>
                  <button
                    data-testid={`ai-scenario-script-apply-board-${step.position}`}
                    disabled={boardDisabled}
                    title={
                      blocked
                        ? 'Blocked — fix the reported errors in the accepted scenario first'
                        : stale
                          ? 'Stale — the accepted snapshot changed, re-run Generate Script'
                          : 'Write this step’s board script in one undoable step'
                    }
                    onClick={() => onApplyBoardStep(step.position)}
                  >
                    {step.boardStatus === 'applying'
                      ? 'Applying board…'
                      : step.boardStatus === 'done'
                        ? `Re-apply board — Step ${step.position}`
                        : `3. Apply board — Step ${step.position}`}
                  </button>
                </div>
                {step.ttsProgress && (
                  <div data-testid={`ai-scenario-script-tts-progress-${step.position}`}>
                    Generating TTS: {step.ttsProgress.done} of {step.ttsProgress.total}
                    <progress
                      data-testid={`ai-scenario-script-tts-progress-bar-${step.position}`}
                      value={step.ttsProgress.done}
                      max={Math.max(1, step.ttsProgress.total)}
                      style={{ marginLeft: 8, verticalAlign: 'middle' }}
                    />
                  </div>
                )}
                {step.ttsStatus === 'done' && (
                  <div data-testid={`ai-scenario-script-tts-done-${step.position}`}>
                    TTS ready for Step {step.position} — Regenerate replaces it.
                  </div>
                )}
                {step.boardStatus === 'done' && (
                  <div data-testid={`ai-scenario-script-board-done-${step.position}`}>
                    Board applied for Step {step.position} — Re-apply overwrites it.
                  </div>
                )}
                {step.ttsError && (
                  <div data-testid={`ai-scenario-script-tts-error-${step.position}`}>
                    {step.ttsError}
                  </div>
                )}
                {step.boardError && (
                  <div data-testid={`ai-scenario-script-board-error-${step.position}`}>
                    {step.boardError}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {blocked && !stale && (
        <div data-testid="ai-scenario-script-blocked-hint">
          Blocked — fix the reported errors in the accepted scenario, accept the fix, and re-run
          Generate Script.
        </div>
      )}
      {prompterError && <div data-testid="ai-scenario-script-prompter-error">{prompterError}</div>}
      <button data-testid="ai-scenario-script-preview-close" onClick={onClose}>
        Close preview
      </button>
    </div>
  )
}
