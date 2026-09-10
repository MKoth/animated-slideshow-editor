import { useRef, useState } from 'react'
import type { AnimationProperty } from '../../engine'
import { MoveClipKeyframesCommand } from '../../engine/commands'
import type { DispatchCommand } from '../../engine/commands'
import { dispatchKeyframeCommands } from '../../engine/keyframeEdit'
import {
  useTimelineSelectionStore,
  selectedKeyframeIdsOf,
} from '../../stores/timelineSelectionStore'
import { useTimelineViewStore } from '../../stores/timelineViewStore'
import { snapKeyframeTime } from '../../engine/timelineSnapping'
import { clamp } from './numberUtils'

interface ClipScaleSession {
  readonly clipId: string
  readonly keyframeRefs: ReadonlyMap<
    string,
    { readonly channel: AnimationProperty; readonly time: number }
  >
  readonly isAlt: boolean
  readonly playheadTime: number
  readonly edge: 'left' | 'right'
  readonly minTime: number
  readonly maxTime: number
}

export interface ClipKeyframeScaleOptions {
  readonly clipId: string
  readonly keyframeRefs: ReadonlyMap<
    string,
    { readonly channel: AnimationProperty; readonly time: number }
  >
  readonly duration: number
  readonly pps: number
  readonly timeFromClientX: (clientX: number) => number
  readonly dispatch: DispatchCommand
  readonly notify: (message: string) => void
}

export interface ClipKeyframeScale {
  readonly scalePreview: ReadonlyMap<string, number> | null
  startScale(edge: 'left' | 'right', clientX: number, isAlt: boolean, playheadTime: number): void
}

export interface ClipSelectionBounds {
  readonly minTime: number
  readonly maxTime: number
}

export function computeClipSelectionBounds(
  selectedKeyframeIds: readonly string[],
  keyframeRefs: ReadonlyMap<string, { readonly channel: AnimationProperty; readonly time: number }>,
): ClipSelectionBounds | null {
  if (selectedKeyframeIds.length === 0) {
    return null
  }
  let minTime = Infinity
  let maxTime = -Infinity
  for (const id of selectedKeyframeIds) {
    const ref = keyframeRefs.get(id)
    if (!ref) {
      continue
    }
    if (ref.time < minTime) {
      minTime = ref.time
    }
    if (ref.time > maxTime) {
      maxTime = ref.time
    }
  }
  if (minTime === Infinity) {
    return null
  }
  return { minTime, maxTime }
}

export function useClipKeyframeScale(options: ClipKeyframeScaleOptions): ClipKeyframeScale {
  const { clipId, keyframeRefs, duration, pps, timeFromClientX, dispatch, notify } = options
  const [scalePreview, setScalePreview] = useState<ReadonlyMap<string, number> | null>(null)
  const scalePreviewRef = useRef<ReadonlyMap<string, number> | null>(null)
  const sessionRef = useRef<ClipScaleSession | null>(null)

  const applyPreview = (next: ReadonlyMap<string, number> | null): void => {
    scalePreviewRef.current = next
    setScalePreview(next)
  }

  const finishScale = (): void => {
    const session = sessionRef.current
    sessionRef.current = null
    if (!session) {
      return
    }
    const preview = scalePreviewRef.current
    applyPreview(null)
    if (!preview) {
      return
    }

    const selectedIds = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
    const wanted = new Set(selectedIds)

    const grouped = new Map<AnimationProperty, { keyframeId: string; newTime: number }[]>()

    for (const [id, ref] of session.keyframeRefs) {
      if (!wanted.has(id)) {
        continue
      }
      const previewTime = preview.get(id)
      if (previewTime === undefined || previewTime === ref.time) {
        continue
      }
      const group = grouped.get(ref.channel) ?? []
      group.push({ keyframeId: id, newTime: previewTime })
      grouped.set(ref.channel, group)
    }

    const commands = [...grouped.entries()].map(
      ([channel, moves]) =>
        new MoveClipKeyframesCommand({
          target: { kind: 'clip', clipId: session.clipId, channel },
          moves,
        }),
    )

    const result = dispatchKeyframeCommands(dispatch, commands)
    if (result && !result.ok) {
      notify(result.error.message)
    }
  }

  const startScale = (
    edge: 'left' | 'right',
    _clientX: number,
    isAlt: boolean,
    playheadTime: number,
  ): void => {
    const selectedIds = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
    if (selectedIds.length < 2) {
      return
    }

    const bounds = computeClipSelectionBounds(selectedIds, keyframeRefs)
    if (!bounds) {
      return
    }

    const session: ClipScaleSession = {
      clipId,
      keyframeRefs,
      minTime: bounds.minTime,
      maxTime: bounds.maxTime,
      isAlt,
      playheadTime,
      edge,
    }
    sessionRef.current = session

    const onMove = (event: PointerEvent): void => {
      const s = sessionRef.current
      if (!s) {
        return
      }
      const rawSec = timeFromClientX(event.clientX)
      const viewState = useTimelineViewStore.getState()
      const gridEnabled = viewState.gridSnapEnabled
      const keyframesEnabled = viewState.snapToKeyframesEnabled
      const draggedIds = new Set(selectedIds)
      const dur = duration || 1
      const candidateTimesSec: number[] = []
      if (keyframesEnabled) {
        for (const [id, ref] of keyframeRefs) {
          if (!draggedIds.has(id)) {
            candidateTimesSec.push(ref.time * dur)
          }
        }
      }

      // Convert session normalized bounds to seconds for factor calculation
      const minSec = s.minTime * dur
      const maxSec = s.maxTime * dur
      const playheadSec = s.playheadTime * dur
      const pivotSec = s.isAlt ? playheadSec : edge === 'left' ? maxSec : minSec
      const originalEdgeSec = edge === 'left' ? minSec : maxSec
      const denomSec = originalEdgeSec - pivotSec
      if (Math.abs(denomSec) < 1e-9) {
        return
      }

      const newEdgeSec = clamp(rawSec, 0, duration)
      const factor = (newEdgeSec - pivotSec) / denomSec
      if (factor <= 0) {
        return
      }

      const next = new Map<string, number>()
      for (const id of selectedIds) {
        const ref = keyframeRefs.get(id)
        if (!ref) {
          continue
        }
        const refSec = ref.time * dur
        const rawTimeSec = pivotSec + (refSec - pivotSec) * factor
        const snappedSec = snapKeyframeTime(rawTimeSec, {
          gridEnabled,
          keyframesEnabled,
          candidateTimes: candidateTimesSec,
          pps,
        })
        const clampedSec = clamp(snappedSec, 0, duration)
        const nextNorm = dur > 0 ? clampedSec / dur : 0
        next.set(id, clamp(nextNorm, 0, 1))
      }
      applyPreview(next)
    }

    const onEnd = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      finishScale()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  return { scalePreview, startScale }
}
