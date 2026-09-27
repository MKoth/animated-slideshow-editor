import type { EnginePublic } from './engine'
import type { Command } from './commands/command'
import { DeleteKeyframesCommand } from './commands/deleteKeyframesCommand'
import { RemoveClipCommand } from './commands/removeClipCommand'
import { DeleteCollectionPlacementCommand } from './commands/deleteCollectionPlacementCommand'
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
 * The deletions a Run must perform before emitting: for the previous and the
 * new footprint alike, every keyframe on a written track whose time lies
 * inside that footprint's `[from, to]`, every standalone Clip Instance on an
 * instance-bearing node whose start lies in the span, and every collection
 * placement on an addressed parent whose start lies in the span (its member
 * instances go with it). Reads current state, so hand-deleted data is
 * tolerated and data outside the windows is never touched; a target that no
 * longer resolves (its node or track is gone) is skipped rather than breaking
 * the run.
 */
export function animationScriptClearCommands(
  engine: EnginePublic,
  previous: CompiledFootprint | null,
  next: CompiledFootprint,
): Command<unknown>[] {
  const commands: Command<unknown>[] = []
  const replacements = collectReplacements(previous, next)
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
  for (const entry of collectNodeReplacements(previous, next).values()) {
    const { nodeId, windows } = entry
    let instances: readonly { id: string; startTime: number; placementId?: string }[]
    try {
      instances = engine.getClipInstances(nodeId)
    } catch {
      continue
    }
    for (const instance of instances) {
      // Placement-linked members are cleared with their placement below;
      // standalone instances (play output and hand-assigned clips) clear here.
      if (instance.placementId !== undefined) continue
      if (
        !windows.some((window: ReplacementWindow) =>
          inSegment(instance.startTime, window.from, window.to),
        )
      ) {
        continue
      }
      commands.push(new RemoveClipCommand({ nodeId, instanceId: instance.id }))
    }
  }
  for (const entry of collectPlacementReplacements(previous, next).values()) {
    const { parentId, windows } = entry
    let placements: readonly { id: string; startTime: number }[]
    try {
      placements = engine.getCollectionPlacements(parentId)
    } catch {
      continue
    }
    for (const placement of placements) {
      if (
        !windows.some((window: ReplacementWindow) =>
          inSegment(placement.startTime, window.from, window.to),
        )
      ) {
        continue
      }
      commands.push(new DeleteCollectionPlacementCommand({ placementId: placement.id }))
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

function collectNodeReplacements(
  previous: CompiledFootprint | null,
  next: CompiledFootprint,
): Map<string, { nodeId: string; windows: ReplacementWindow[] }> {
  const replacements = new Map<string, { nodeId: string; windows: ReplacementWindow[] }>()
  for (const footprint of [previous, next]) {
    if (!footprint) continue
    const window = { from: footprint.from, to: footprint.to }
    for (const nodeId of footprint.instanceNodes) {
      const existing = replacements.get(nodeId)
      if (existing) {
        existing.windows.push(window)
      } else {
        replacements.set(nodeId, { nodeId, windows: [window] })
      }
    }
  }
  return replacements
}

function collectPlacementReplacements(
  previous: CompiledFootprint | null,
  next: CompiledFootprint,
): Map<string, { parentId: string; windows: ReplacementWindow[] }> {
  const replacements = new Map<string, { parentId: string; windows: ReplacementWindow[] }>()
  for (const footprint of [previous, next]) {
    if (!footprint) continue
    const window = { from: footprint.from, to: footprint.to }
    for (const parentId of footprint.placementParents) {
      const existing = replacements.get(parentId)
      if (existing) {
        existing.windows.push(window)
      } else {
        replacements.set(parentId, { parentId, windows: [window] })
      }
    }
  }
  return replacements
}
