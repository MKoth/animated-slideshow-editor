import type { EnginePublic } from './engine'
import type { LessonJSON } from './json'
import { AiRunAnimationScriptCommand } from './commands/aiRunAnimationScriptCommand'
import { createEngineInternal, toReadOnly } from './internal'

/** Create a disposable, read-only engine for visualizing a candidate LessonJSON. */
export function createIsolatedPreviewEngine(snapshot: LessonJSON): EnginePublic {
  const engine = createEngineInternal()
  engine.restoreFromJSON(structuredClone(snapshot))
  return toReadOnly(engine)
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
