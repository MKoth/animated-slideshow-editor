import type { EnginePublic } from './engine'
import type { DispatchCommand } from './commands/dispatcher'
import { TransactionCommand } from './commands/transactionCommand'
import { SetSlideAnimationScriptFootprintCommand } from './commands/setSlideAnimationScriptFootprintCommand'
import { checkAnimationScript } from './animationScriptCheck'
import { compiledFootprintToJSON } from './compiledFootprint'
import type { AnimationScriptDiagnostic, AnimationScriptSummary } from './animationScriptCompiler'

/**
 * The Animation Script Run seam: compile `(source, slide state)` pure, then
 * dispatch the emitted commands plus the compiled-footprint record as children
 * of one Transaction — one Run, one History entry. A blocked compile dispatches
 * nothing; a failing run rolls back completely. The source is never rewritten.
 */
export interface AnimationScriptRunResult {
  readonly ran: boolean
  readonly diagnostics: readonly AnimationScriptDiagnostic[]
  /** The same metrics Check promised for this source. */
  readonly summary: AnimationScriptSummary
  /** Set when the compile was runnable but the Transaction failed; null otherwise. */
  readonly error: string | null
}

export function runAnimationScript(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  slideId: string,
  source: string,
): AnimationScriptRunResult {
  const compiled = checkAnimationScript(engine, slideId, source)
  const outcome = {
    diagnostics: compiled.diagnostics,
    summary: compiled.summary,
  }
  if (!compiled.runnable) {
    return { ran: false, error: null, ...outcome }
  }
  const result = dispatch(
    new TransactionCommand([
      ...compiled.commands,
      new SetSlideAnimationScriptFootprintCommand({
        slideId,
        footprint: compiledFootprintToJSON(compiled.footprint),
      }),
    ]),
  )
  if (!result.ok) {
    return { ran: false, error: result.error.message, ...outcome }
  }
  return { ran: true, error: null, ...outcome }
}
