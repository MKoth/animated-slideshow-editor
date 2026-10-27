import { checkAnimationScript } from '../engine/animationScriptCheck'
import type { AnimationScriptDiagnostic } from '../engine/animationScriptCompiler'
import type { EnginePublic } from '../engine'
import { measuredNodeSize } from '../pixi/renderer/nodeMeasurement'
import { collectGlobalAudioAssets } from '../stores/assetLibraryStore'

export interface ScriptDraftCheck {
  runnable: boolean
  errors: readonly AnimationScriptDiagnostic[]
}

/**
 * Compile-check an assistant-drafted script with the same seams as the
 * Script panel Check (renderer-measured bounds, global library audio), so a
 * truncated or broken block is caught before it becomes a proposal.
 */
export function checkScriptDraft(
  engine: EnginePublic,
  slideId: string,
  source: string,
): ScriptDraftCheck {
  const result = checkAnimationScript(engine, slideId, source, {
    measure: measuredNodeSize,
    globalAudioAssets: collectGlobalAudioAssets(),
  })
  return {
    runnable: result.runnable,
    errors: result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
  }
}

/** One-line-per-error text for resubmitting a failed draft to the assistant. */
export function formatScriptDraftErrors(
  errors: readonly { message: string; line: number; column: number }[],
): string {
  const lines = errors
    .slice(0, 20)
    .map((error) => `Line ${error.line}, Col ${error.column}: ${error.message}`)
  return (
    'The drafted script failed validation — reply with the corrected full script:\n' +
    lines.map((line) => `- ${line}`).join('\n')
  )
}
