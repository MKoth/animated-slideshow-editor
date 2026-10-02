import type { EnginePublic } from './engine'
import type { Command } from './commands/command'
import { DeleteKeyframesCommand } from './commands/deleteKeyframesCommand'
import { RemoveClipCommand } from './commands/removeClipCommand'
import { DeleteCollectionPlacementCommand } from './commands/deleteCollectionPlacementCommand'
import { DeleteNodeCommand } from './commands/deleteNodeCommand'
import { DeleteDataSourceCommand } from './commands/deleteDataSourceCommand'
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
  // Delete-and-recreate ownership first: the previous run's created subtrees
  // (and script-embedded data sources) go before anything else, so their ids
  // are free for the new run and their tracks vanish with them. Deleted by
  // hand in the meantime? Tolerate and move on.
  for (const nodeId of previous?.createdNodes ?? []) {
    try {
      engine.getNode(nodeId)
    } catch {
      continue
    }
    commands.push(new DeleteNodeCommand({ nodeId }))
  }
  for (const dataSourceId of previous?.createdDataSources ?? []) {
    if (!engine.embeddedDataSources.some((definition) => definition.id === dataSourceId)) {
      continue
    }
    commands.push(new DeleteDataSourceCommand({ dataSourceId }))
  }
  // Tracks/instances/placements on script-created nodes need no clearing:
  // deleting the node removes them, and the new run recreates the node. This
  // also keeps sequential transaction validation from resolving a target the
  // DeleteNode child just removed.
  const createdNodeIds = new Set<string>([...(previous?.createdNodes ?? []), ...next.createdNodes])
  const replacements = collectReplacements(previous, next, createdNodeIds)
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
  for (const entry of collectNodeReplacements(previous, next, createdNodeIds).values()) {
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
  for (const entry of collectPlacementReplacements(previous, next, createdNodeIds).values()) {
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
  createdNodeIds: ReadonlySet<string>,
): Map<string, TargetReplacement> {
  const replacements = new Map<string, TargetReplacement>()
  for (const footprint of [previous, next]) {
    if (!footprint) continue
    const window = { from: footprint.from, to: footprint.to }
    for (const track of footprint.tracks) {
      if (createdNodeIds.has(track.nodeId)) continue
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
  createdNodeIds: ReadonlySet<string>,
): Map<string, { nodeId: string; windows: ReplacementWindow[] }> {
  const replacements = new Map<string, { nodeId: string; windows: ReplacementWindow[] }>()
  for (const footprint of [previous, next]) {
    if (!footprint) continue
    const window = { from: footprint.from, to: footprint.to }
    for (const nodeId of footprint.instanceNodes) {
      if (createdNodeIds.has(nodeId)) continue
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
  createdNodeIds: ReadonlySet<string>,
): Map<string, { parentId: string; windows: ReplacementWindow[] }> {
  const replacements = new Map<string, { parentId: string; windows: ReplacementWindow[] }>()
  for (const footprint of [previous, next]) {
    if (!footprint) continue
    const window = { from: footprint.from, to: footprint.to }
    for (const parentId of footprint.placementParents) {
      if (createdNodeIds.has(parentId)) continue
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
