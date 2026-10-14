import type { EnginePublic } from '../engine'
import type { DispatchCommand } from '../engine/commands/dispatcher'
import {
  ReorderCollectionPlacementCommand,
  SetClipInstanceSpeedCommand,
  SetClipInstanceStartTimeCommand,
  SetCollectionPlacementStartTimeCommand,
  TransactionCommand,
} from '../engine/commands'
import { MIN_CLIP_SPEED, MIN_VISUAL_DURATION } from '../engine/animationManagerModel'
import { buildFreezeFollowCommands, freezeFollowEnvFromEngine } from '../engine/collectionFreeze'
import type { FreezeFollowEnv } from '../engine/collectionFreeze'

export interface CollectionLaneCommitEnv {
  getPlacementMembers(placementId: string): readonly {
    nodeId: string
    instance: { id: string; clipId: string; startTime: number; speed: number }
  }[]
  getClip(clipId: string): { duration: number }
  freezeEnv?: FreezeFollowEnv
}

export interface CollectionCommitResult {
  readonly ok: boolean
  /** Linked freeze keys shifted with the block. */
  readonly freezeMoved: number
  /** Linked freeze keys left behind (destination occupied). Never overwritten. */
  readonly freezeSkipped: number
}

/** Resolve members via public engine facade (works for useEngine().engine). */
export function collectionLaneEnvFromEngine(engine: EnginePublic): CollectionLaneCommitEnv {
  return {
    getPlacementMembers: (placementId: string) =>
      (
        engine as unknown as {
          getPlacementMembers: (id: string) => readonly {
            nodeId: string
            instance: { id: string; clipId: string; startTime: number; speed: number }
          }[]
        }
      ).getPlacementMembers(placementId),
    getClip: (clipId: string) => engine.getClip(clipId),
    freezeEnv: freezeFollowEnvFromEngine(engine),
  }
}

function appendFreezeFollow(
  cmds: import('../engine/commands').Command<unknown>[],
  env: CollectionLaneCommitEnv,
  placementId: string,
  deltaFor: (role: import('../engine/keyframe').FreezeLinkRole) => number,
): { moved: number; skipped: number } {
  if (!env.freezeEnv) return { moved: 0, skipped: 0 }
  const follow = buildFreezeFollowCommands(env.freezeEnv, placementId, deltaFor)
  for (const cmd of follow.cmds) {
    cmds.push(cmd as unknown as import('../engine/commands').Command<unknown>)
  }
  return { moved: follow.moved, skipped: follow.skipped }
}

export function commitCollectionMove(
  env: CollectionLaneCommitEnv,
  dispatch: DispatchCommand,
  placementId: string,
  previewStart: number,
  initialStart: number,
  options?: { maxStartTime?: number },
): CollectionCommitResult {
  const clampedPreview =
    options?.maxStartTime !== undefined
      ? Math.min(Math.max(0, previewStart), options.maxStartTime)
      : previewStart
  const delta = clampedPreview - initialStart
  if (Math.abs(delta) <= 1e-6) return { ok: false, freezeMoved: 0, freezeSkipped: 0 }
  const members = env.getPlacementMembers(placementId)
  const cmds: import('../engine/commands').Command<unknown>[] = [
    new SetCollectionPlacementStartTimeCommand({
      placementId,
      startTime: Math.max(0, clampedPreview),
    }) as unknown as import('../engine/commands').Command<unknown>,
  ]
  for (const m of members) {
    cmds.push(
      new SetClipInstanceStartTimeCommand({
        nodeId: m.nodeId,
        instanceId: m.instance.id,
        startTime: Math.max(0, m.instance.startTime + delta),
      }) as unknown as import('../engine/commands').Command<unknown>,
    )
  }
  const freeze = appendFreezeFollow(cmds, env, placementId, () => delta)
  const res = dispatch(new TransactionCommand(cmds) as never)
  const ok = (res as unknown as { ok: boolean }).ok !== false
  return { ok, freezeMoved: freeze.moved, freezeSkipped: freeze.skipped }
}

export function commitCollectionStretch(
  env: CollectionLaneCommitEnv,
  dispatch: DispatchCommand,
  args: {
    placementId: string
    initialStart: number
    initialVisual: number
    previewStart: number
    previewVisual: number
    isLeftHandle: boolean
  },
): CollectionCommitResult {
  const { placementId, initialStart, initialVisual, previewStart, previewVisual, isLeftHandle } =
    args
  const oldVisual = initialVisual
  const newVisual = previewVisual
  const factor = oldVisual / newVisual
  const cmds: import('../engine/commands').Command<unknown>[] = []
  const members = env.getPlacementMembers(placementId)
  const deltaStart = previewStart - initialStart
  if (isLeftHandle && Math.abs(previewStart - initialStart) > 1e-6) {
    cmds.push(
      new SetCollectionPlacementStartTimeCommand({
        placementId,
        startTime: Math.max(0, previewStart),
      }) as unknown as import('../engine/commands').Command<unknown>,
    )
    for (const m of members) {
      cmds.push(
        new SetClipInstanceStartTimeCommand({
          nodeId: m.nodeId,
          instanceId: m.instance.id,
          startTime: Math.max(0, m.instance.startTime + deltaStart),
        }) as unknown as import('../engine/commands').Command<unknown>,
      )
    }
  } else if (!isLeftHandle) {
    // right handle keeps start; still ensure placement start committed if drifted
    if (Math.abs(previewStart - initialStart) > 1e-6) {
      cmds.push(
        new SetCollectionPlacementStartTimeCommand({
          placementId,
          startTime: Math.max(0, previewStart),
        }) as unknown as import('../engine/commands').Command<unknown>,
      )
    }
  }
  // Linked freeze keys follow the edge they pin: start-linked (first/prefix)
  // ride the left edge, end-linked (last) ride the right edge.
  const oldEnd = initialStart + initialVisual
  const newEnd = previewStart + previewVisual
  const deltaEnd = newEnd - oldEnd
  let freeze = { moved: 0, skipped: 0 }
  if (isLeftHandle && Math.abs(deltaStart) > 1e-6) {
    freeze = appendFreezeFollow(cmds, env, placementId, (role) =>
      role === 'last' ? 0 : deltaStart,
    )
  } else if (!isLeftHandle && Math.abs(deltaEnd) > 1e-6) {
    const endFollow = appendFreezeFollow(cmds, env, placementId, (role) =>
      role === 'last' ? deltaEnd : 0,
    )
    freeze = endFollow
  }
  if (Math.abs(factor - 1) <= 1e-9 || !Number.isFinite(factor) || factor <= 0) {
    if (cmds.length === 0) return { ok: false, freezeMoved: 0, freezeSkipped: 0 }
    const res = dispatch(new TransactionCommand(cmds as never) as never)
    const ok = (res as unknown as { ok: boolean }).ok !== false
    return { ok, freezeMoved: freeze.moved, freezeSkipped: freeze.skipped }
  }
  for (const m of members) {
    const clip = env.getClip(m.instance.clipId)
    const oldSpeed = m.instance.speed
    let newSpeed = oldSpeed * factor
    const maxAllowedSpeed = clip.duration / MIN_VISUAL_DURATION
    if (newSpeed > maxAllowedSpeed) newSpeed = maxAllowedSpeed
    if (newSpeed < MIN_CLIP_SPEED) newSpeed = MIN_CLIP_SPEED
    const resultingVisual = clip.duration / newSpeed
    if (resultingVisual < MIN_VISUAL_DURATION - 1e-9) newSpeed = clip.duration / MIN_VISUAL_DURATION
    if (Math.abs(newSpeed - oldSpeed) > 1e-9) {
      cmds.push(
        new SetClipInstanceSpeedCommand({
          nodeId: m.nodeId,
          instanceId: m.instance.id,
          speed: newSpeed,
        }) as unknown as import('../engine/commands').Command<unknown>,
      )
    }
  }
  if (cmds.length === 0) return { ok: false, freezeMoved: 0, freezeSkipped: 0 }
  const res = dispatch(new TransactionCommand(cmds) as never)
  const ok = (res as unknown as { ok: boolean }).ok !== false
  return { ok, freezeMoved: freeze.moved, freezeSkipped: freeze.skipped }
}

export function commitCollectionReorder(
  dispatch: DispatchCommand,
  parentNodeId: string,
  placementId: string,
  newIndex: number,
): boolean {
  const res = dispatch(
    new ReorderCollectionPlacementCommand({ parentNodeId, placementId, newIndex }) as never,
  )
  return (res as unknown as { ok: boolean }).ok !== false
}
