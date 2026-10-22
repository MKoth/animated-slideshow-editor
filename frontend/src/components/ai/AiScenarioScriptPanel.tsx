import type { PlannerResult } from '../../ai/scenarioPlanner'
import { highlightAnimationScript } from '../panels/AnimationScriptViewer'

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
 * Distinct color per prompt block so split prompter parts stay visually
 * distinguishable across slides, fractions, and board sources. Palette cycles
 * by prompt-N number; unknown names hash into it.
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
              style={{
                margin: '6px 0',
                padding: '6px 8px',
                borderLeft: `4px solid ${promptBlockColor(slide.promptBlockId)}`,
                borderRadius: 4,
                background: `color-mix(in srgb, ${promptBlockColor(slide.promptBlockId)} 12%, transparent)`,
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
                  background: promptBlockColor(slide.promptBlockId),
                  marginRight: 8,
                }}
              >
                {slide.promptBlockId}
              </span>
              <span>{slide.prompterText}</span>
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
