import type { EnginePublic } from './engine'
import { DeleteKeyframesCommand } from './commands/deleteKeyframesCommand'
import { deleteGroupKey, inSegment } from './timeSegmentExtraction'
import type { CompiledFootprint } from './compiledFootprint'
import type { Keyframe } from './keyframe'
import type { KeyframeTarget } from './keyframeTarget'

interface ReplacementWindow {
  readonly from: number
  readonly to: number
}

interface TargetReplacement {
  readonly target: KeyframeTarget
  readonly windows: ReplacementWindow[]
}

/**
 * The keyframe deletions a Run must perform before emitting: for the previous
 * and the new footprint alike, every keyframe on a written track whose time
 * lies inside that footprint's `[from, to]`. Reads current state, so
 * hand-deleted keyframes are tolerated and data outside the windows is never
 * touched; a target that no longer resolves (its node or track is gone) is
 * skipped rather than breaking the run.
 */
export function animationScriptClearCommands(
  engine: EnginePublic,
  previous: CompiledFootprint | null,
  next: CompiledFootprint,
): DeleteKeyframesCommand[] {
  const replacements = collectReplacements(previous, next)
  const commands: DeleteKeyframesCommand[] = []
  for (const { target, windows } of replacements.values()) {
    const keyframes = readKeyframes(engine, target)
    if (!keyframes) continue
    const keyframeIds = keyframes
      .filter((keyframe) =>
        windows.some((window) => inSegment(keyframe.time, window.from, window.to)),
      )
      .map((keyframe) => keyframe.id)
    if (keyframeIds.length > 0) {
      commands.push(new DeleteKeyframesCommand({ target, keyframeIds }))
    }
  }
  return commands
}

function collectReplacements(
  previous: CompiledFootprint | null,
  next: CompiledFootprint,
): Map<string, TargetReplacement> {
  const replacements = new Map<string, TargetReplacement>()
  for (const footprint of [previous, next]) {
    if (!footprint) continue
    const window = { from: footprint.from, to: footprint.to }
    for (const track of footprint.tracks) {
      const key = deleteGroupKey(track.target)
      const existing = replacements.get(key)
      if (existing) {
        existing.windows.push(window)
      } else {
        replacements.set(key, { target: track.target, windows: [window] })
      }
    }
  }
  return replacements
}

/**
 * Current keyframes for a target, or null when the target no longer resolves
 * (its node was deleted, its track removed). Any other failure propagates.
 */
function readKeyframes(engine: EnginePublic, target: KeyframeTarget): readonly Keyframe[] | null {
  try {
    engine.resolveAnimationTarget(target)
  } catch {
    return null
  }
  return engine.getKeyframesOf(target)
}
