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

export interface CollectionLaneCommitEnv {
  getPlacementMembers(placementId: string): readonly {
    nodeId: string
    instance: { id: string; clipId: string; startTime: number; speed: number }
  }[]
  getClip(clipId: string): { duration: number }
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
  }
}

export function commitCollectionMove(
  env: CollectionLaneCommitEnv,
  dispatch: DispatchCommand,
  placementId: string,
  previewStart: number,
  initialStart: number,
): boolean {
  const delta = previewStart - initialStart
  if (Math.abs(delta) <= 1e-6) return false
  const members = env.getPlacementMembers(placementId)
  const cmds: import('../engine/commands').Command<unknown>[] = [
    new SetCollectionPlacementStartTimeCommand({
      placementId,
      startTime: Math.max(0, previewStart),
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
  const res = dispatch(new TransactionCommand(cmds) as never)
  return (res as unknown as { ok: boolean }).ok !== false
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
): boolean {
  const { placementId, initialStart, initialVisual, previewStart, previewVisual, isLeftHandle } =
    args
  const oldVisual = initialVisual
  const newVisual = previewVisual
  const factor = oldVisual / newVisual
  const cmds: import('../engine/commands').Command<unknown>[] = []
  const members = env.getPlacementMembers(placementId)
  if (isLeftHandle && Math.abs(previewStart - initialStart) > 1e-6) {
    cmds.push(
      new SetCollectionPlacementStartTimeCommand({
        placementId,
        startTime: Math.max(0, previewStart),
      }) as unknown as import('../engine/commands').Command<unknown>,
    )
    const deltaStart = previewStart - initialStart
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
  if (Math.abs(factor - 1) <= 1e-9 || !Number.isFinite(factor) || factor <= 0) {
    if (cmds.length === 0) return false
    const res = dispatch(new TransactionCommand(cmds as never) as never)
    return (res as unknown as { ok: boolean }).ok !== false
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
  if (cmds.length === 0) return false
  const res = dispatch(new TransactionCommand(cmds) as never)
  return (res as unknown as { ok: boolean }).ok !== false
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
