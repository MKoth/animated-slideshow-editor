import type { EnginePublic } from '../engine'
import type { AnimationProperty } from '../engine'
import type { DispatchCommand } from '../engine/commands'
import {
  AddClipKeyframeCommand,
  DeleteClipKeyframesCommand,
  DuplicateClipKeyframesCommand,
  PasteClipKeyframesCommand,
  SetClipKeyframeValueCommand,
} from '../engine/commands'
import { dispatchKeyframeCommands } from '../engine/keyframeEdit'
import { snapshotOf } from '../engine/keyframe'
import type { PastePayloadKeyframe } from '../engine/animationManager'
import { useKeyframeClipboardStore } from '../stores/keyframeClipboardStore'
import type { KeyframeClipboardTarget } from '../stores/keyframeClipboardStore'
import { useTimelineSelectionStore, selectedKeyframeIdsOf } from '../stores/timelineSelectionStore'

/** A clipboard entry for clip channel keyframes. */
export interface ClipKeyframeRef {
  readonly clipId: string
  readonly channel: AnimationProperty
  readonly keyframeId: string
  readonly time: number
}

function allClipKeyframeRefs(engine: EnginePublic, clipId: string): ClipKeyframeRef[] {
  const refs: ClipKeyframeRef[] = []
  try {
    const clip = engine.getClip(clipId)
    for (const ch of clip.channels) {
      for (const kf of engine.getClipChannelKeyframes(clipId, ch.property)) {
        refs.push({
          clipId,
          channel: ch.property,
          keyframeId: kf.id,
          time: kf.time,
        })
      }
    }
  } catch {
    // clip not found
  }
  return refs
}

/** Return clip keyframe refs for the currently selected keyframes in clip-edit mode. */
export function selectedClipKeyframeRefs(engine: EnginePublic): ClipKeyframeRef[] {
  const selectedIds = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
  if (selectedIds.length === 0) {
    return []
  }
  const wanted = new Set(selectedIds)
  const editingContext = useTimelineSelectionStore.getState().editingContext
  if (editingContext !== 'clip-edit') {
    return []
  }
  const clipId = useKeyframeClipboardStore.getState().clipEditClipId
  if (!clipId) {
    return []
  }
  return allClipKeyframeRefs(engine, clipId).filter((ref) => wanted.has(ref.keyframeId))
}

export function copyClipKeyframes(engine: EnginePublic): void {
  const refs = selectedClipKeyframeRefs(engine)
  if (refs.length === 0) {
    return
  }

  const grouped = new Map<string, ClipKeyframeRef[]>()
  for (const ref of refs) {
    const key = ref.channel
    const group = grouped.get(key) ?? []
    group.push(ref)
    grouped.set(key, group)
  }

  const targets: KeyframeClipboardTarget[] = []
  let globalEarliest = Infinity

  for (const [channel, channelRefs] of grouped) {
    const sorted = [...channelRefs].sort((a, b) => a.time - b.time)
    const groupOriginTime = sorted[0].time
    if (groupOriginTime < globalEarliest) {
      globalEarliest = groupOriginTime
    }

    const clipId = sorted[0].clipId
    const allKeyframes = engine.getClipChannelKeyframes(clipId, channel as AnimationProperty)
    const kfById = new Map(allKeyframes.map((kf) => [kf.id, kf]))

    const keyframes: PastePayloadKeyframe[] = sorted.map((ref) => {
      const kf = kfById.get(ref.keyframeId)
      if (!kf) {
        throw new Error(`Keyframe not found: ${ref.keyframeId}`)
      }
      return {
        time: kf.time - groupOriginTime,
        value: snapshotOf(kf).value,
        interpolation: kf.interpolation,
        tangentIn: { time: kf.tangentIn.time, value: kf.tangentIn.value },
        tangentOut: { time: kf.tangentOut.time, value: kf.tangentOut.value },
      }
    })

    targets.push({
      target: { kind: 'clip', clipId, channel: channel as AnimationProperty },
      payload: { keyframes },
    })
  }

  useKeyframeClipboardStore.getState().copy(targets, globalEarliest)
}

export function pasteClipKeyframes(
  _engine: EnginePublic,
  dispatch: DispatchCommand,
  clipId: string,
  atTime: number,
): void {
  const { targets } = useKeyframeClipboardStore.getState()
  if (targets.length === 0) {
    return
  }

  const commands = targets
    .filter((t) => t.target.kind === 'clip')
    .map((clipTarget) => {
      const target = clipTarget.target as {
        kind: 'clip'
        clipId: string
        channel: AnimationProperty
      }
      return new PasteClipKeyframesCommand({
        target: { kind: 'clip', clipId, channel: target.channel },
        payload: clipTarget.payload as {
          keyframes: {
            time: number
            value: number
            interpolation: import('../engine/keyframe').InterpolationType
            tangentIn: import('../engine/keyframe').KeyframeTangent
            tangentOut: import('../engine/keyframe').KeyframeTangent
          }[]
        },
        atTime,
      })
    })

  dispatchKeyframeCommands(dispatch, commands)
  useTimelineSelectionStore.getState().clearSelection()
}

export function duplicateClipKeyframes(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  clipId: string,
): void {
  const refs = selectedClipKeyframeRefs(engine)
  if (refs.length === 0) {
    return
  }

  const grouped = new Map<string, string[]>()
  for (const ref of refs) {
    const group = grouped.get(ref.channel) ?? []
    group.push(ref.keyframeId)
    grouped.set(ref.channel, group)
  }

  const commands = [...grouped.entries()].map(
    ([channel, keyframeIds]) =>
      new DuplicateClipKeyframesCommand({
        target: { kind: 'clip', clipId, channel: channel as AnimationProperty },
        keyframeIds,
      }),
  )

  dispatchKeyframeCommands(dispatch, commands)
}

export function deleteSelectedClipKeyframes(
  engine: EnginePublic,
  dispatch: DispatchCommand,
): boolean {
  const refs = selectedClipKeyframeRefs(engine)
  if (refs.length === 0) {
    return false
  }

  const grouped = new Map<string, string[]>()
  for (const ref of refs) {
    const group = grouped.get(ref.channel) ?? []
    group.push(ref.keyframeId)
    grouped.set(ref.channel, group)
  }

  const commands = [...grouped.entries()].map(
    ([channel, keyframeIds]) =>
      new DeleteClipKeyframesCommand({
        target: { kind: 'clip', clipId: refs[0].clipId, channel: channel as AnimationProperty },
        keyframeIds,
      }),
  )

  dispatchKeyframeCommands(dispatch, commands)
  useTimelineSelectionStore.getState().clearSelection()
  return true
}

export function addClipKeyframeAtPlayhead(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  clipId: string,
  channel: AnimationProperty,
  time: number,
  value: number,
): void {
  const existing = engine.getClipChannelKeyframes(clipId, channel)
  const alreadyExists = existing.some((kf) => kf.time === time)
  if (alreadyExists) {
    return
  }
  const result = dispatch(
    new AddClipKeyframeCommand({
      target: { kind: 'clip', clipId, channel },
      time,
      value,
    }),
  )
  if (!result.ok) {
    throw result.error
  }
}

export function autoKeyClipEdit(
  engine: EnginePublic,
  dispatch: DispatchCommand,
  clipId: string,
  channel: AnimationProperty,
  time: number,
  value: number,
): void {
  const keyframes = engine.getClipChannelKeyframes(clipId, channel)
  const existing = keyframes.find((kf) => kf.time === time)
  if (existing) {
    if (existing.value !== value) {
      dispatch(
        new SetClipKeyframeValueCommand({
          target: { kind: 'clip', clipId, channel },
          keyframeId: existing.id,
          newValue: value,
        }),
      )
    }
    return
  }
  dispatch(
    new AddClipKeyframeCommand({
      target: { kind: 'clip', clipId, channel },
      time,
      value,
    }),
  )
}
