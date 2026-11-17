import type { EnginePublic } from './engine'
import type { LessonJSON } from './json'
import { AiRunAnimationScriptCommand } from './commands/aiRunAnimationScriptCommand'
import type { Command } from './commands/command'
import { createEngineInternal, toReadOnly } from './internal'
import type { Engine } from './internal'

/** Library name mirror a scratch engine needs to resolve `create asset` / `material()`. */
export interface LibraryMirror {
  readonly assetDefinitions: readonly { readonly id: string; readonly name: string }[]
  readonly materialDefinitions: readonly {
    readonly id: string
    readonly name: string
    readonly parameters?: readonly unknown[]
    readonly shaderId?: string | null
  }[]
}

/** Copy the live library name mirror into a scratch engine seeded from LessonJSON. */
export function seedLibraryMirror(target: Engine, source: EnginePublic | LibraryMirror): void {
  for (const definition of source.assetDefinitions) {
    try {
      target.registerAssetDefinition(definition.id, definition.name)
    } catch {
      // A malformed mirror entry must never block a dry-run.
    }
  }
  for (const definition of source.materialDefinitions) {
    try {
      const ref = definition as {
        readonly id: string
        readonly name: string
        readonly parameters?: readonly unknown[]
        readonly shaderId?: string | null
      }
      target.registerMaterialDefinition(
        ref.id,
        ref.name,
        (ref.parameters ?? []) as never,
        ref.shaderId ?? null,
      )
    } catch {
      // Same tolerance as assets above.
    }
  }
}

/** Create a disposable, read-only engine for visualizing a candidate LessonJSON. */
export function createIsolatedPreviewEngine(
  snapshot: LessonJSON,
  library?: EnginePublic | LibraryMirror,
): EnginePublic {
  const engine = createEngineInternal()
  engine.restoreFromJSON(structuredClone(snapshot))
  if (library) seedLibraryMirror(engine, library)
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
  library?: EnginePublic | LibraryMirror,
): { ok: true } | { ok: false; failure: ScratchDryRunFailure } {
  const engine = createEngineInternal()
  engine.restoreFromJSON(structuredClone(snapshot))
  if (library) seedLibraryMirror(engine, library)
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
  library?: EnginePublic | LibraryMirror,
): { engine: EnginePublic | null; error: string | null } {
  try {
    const engine = createEngineInternal()
    engine.restoreFromJSON(structuredClone(snapshot))
    if (library) seedLibraryMirror(engine, library)
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
