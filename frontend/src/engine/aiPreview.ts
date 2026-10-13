import type { EnginePublic } from './engine'
import type { LessonJSON } from './json'
import { AiRunAnimationScriptCommand } from './commands/aiRunAnimationScriptCommand'
import type { Command } from './commands/command'
import { createEngineInternal, toReadOnly } from './internal'

/** Create a disposable, read-only engine for visualizing a candidate LessonJSON. */
export function createIsolatedPreviewEngine(snapshot: LessonJSON): EnginePublic {
  const engine = createEngineInternal()
  engine.restoreFromJSON(structuredClone(snapshot))
  return toReadOnly(engine)
}

export interface ScratchDryRunFailure {
  /** Position within the submitted command list (0-based). */
  readonly failedStep: number
  readonly phase: 'validate' | 'execute'
  readonly message: string
}

/**
 * Validate + apply proposal commands in order on a disposable engine seeded
 * from a project snapshot. Later steps see earlier ones, so a batch of clip
 * creates closed by a collection dry-runs exactly as it will execute. The
 * live engine is never touched. Stops at the first failure, like execution.
 */
export function validateAndApplyInOrder(
  snapshot: LessonJSON,
  commands: readonly Command<unknown>[],
): { ok: true } | { ok: false; failure: ScratchDryRunFailure } {
  const engine = createEngineInternal()
  engine.restoreFromJSON(structuredClone(snapshot))
  for (let step = 0; step < commands.length; step++) {
    const command = commands[step]!
    try {
      command.validate(engine)
    } catch (error) {
      return {
        ok: false,
        failure: {
          failedStep: step,
          phase: 'validate',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
    try {
      command.execute(engine)
    } catch (error) {
      return {
        ok: false,
        failure: {
          failedStep: step,
          phase: 'execute',
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }
  return { ok: true }
}

/** Apply a reviewed script to a disposable engine using the normal Run seam. */
export function createAnimationScriptPreview(
  snapshot: LessonJSON,
  slideId: string,
  source: string,
): { engine: EnginePublic | null; error: string | null } {
  try {
    const engine = createEngineInternal()
    engine.restoreFromJSON(structuredClone(snapshot))
    new AiRunAnimationScriptCommand({ slideId, source }).execute(engine)
    return { engine: toReadOnly(engine), error: null }
  } catch (error) {
    return {
      engine: null,
      error:
        error instanceof Error
          ? error.message
          : 'Could not run the isolated Animation Script preview.',
    }
  }
}
