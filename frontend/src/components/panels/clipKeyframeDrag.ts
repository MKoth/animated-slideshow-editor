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

interface ClipDragMove {
  readonly keyframeId: string
  readonly channel: AnimationProperty
  readonly originalTime: number
}

interface ClipDragSession {
  readonly clipId: string
  readonly pointerStartTime: number
  readonly moves: readonly ClipDragMove[]
}

export interface ClipKeyframeDragOptions {
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

export interface ClipKeyframeDrag {
  readonly dragPreview: ReadonlyMap<string, number> | null
  isDraggable(): boolean
  startDrag(clientX: number): void
}

export function useClipKeyframeDrag(options: ClipKeyframeDragOptions): ClipKeyframeDrag {
  const { clipId, keyframeRefs, duration, pps, timeFromClientX, dispatch, notify } = options
  const [dragPreview, setDragPreview] = useState<ReadonlyMap<string, number> | null>(null)
  const dragPreviewRef = useRef<ReadonlyMap<string, number> | null>(null)
  const dragSessionRef = useRef<ClipDragSession | null>(null)

  const isDraggable = (): boolean => {
    return selectedKeyframeIdsOf(useTimelineSelectionStore.getState()).length > 0
  }

  const buildMoves = (): ClipDragMove[] => {
    const moves: ClipDragMove[] = []
    for (const keyframeId of selectedKeyframeIdsOf(useTimelineSelectionStore.getState())) {
      const ref = keyframeRefs.get(keyframeId)
      if (ref) {
        moves.push({
          keyframeId,
          channel: ref.channel,
          originalTime: ref.time,
        })
      }
    }
    return moves
  }

  const applyDragPreview = (next: ReadonlyMap<string, number> | null): void => {
    dragPreviewRef.current = next
    setDragPreview(next)
  }

  const finishKeyframeDrag = () => {
    const session = dragSessionRef.current
    dragSessionRef.current = null
    if (!session) {
      return
    }
    const preview = dragPreviewRef.current
    applyDragPreview(null)
    const moved = session.moves.flatMap((move) => {
      const newTime = preview?.get(move.keyframeId)
      if (newTime === undefined || newTime === move.originalTime) {
        return []
      }
      return [{ ...move, newTime }]
    })
    if (moved.length === 0) {
      return
    }

    const grouped = new Map<AnimationProperty, { keyframeId: string; newTime: number }[]>()
    for (const move of moved) {
      const group = grouped.get(move.channel) ?? []
      group.push({ keyframeId: move.keyframeId, newTime: move.newTime })
      grouped.set(move.channel, group)
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

  const startDrag = (clientX: number): void => {
    const moves = buildMoves()
    if (moves.length === 0) {
      return
    }
    const existing = dragSessionRef.current
    if (existing) {
      dragSessionRef.current = { ...existing, moves }
      return
    }
    const startTime = timeFromClientX(clientX)
    dragSessionRef.current = { clipId, pointerStartTime: startTime, moves }
    const onMove = (event: PointerEvent) => {
      const session = dragSessionRef.current
      if (!session) {
        return
      }
      const delta = timeFromClientX(event.clientX) - session.pointerStartTime
      const viewState = useTimelineViewStore.getState()
      const gridEnabled = viewState.gridSnapEnabled
      const keyframesEnabled = viewState.snapToKeyframesEnabled
      const draggedIds = new Set(session.moves.map((m) => m.keyframeId))
      const candidateTimes: number[] = []
      if (keyframesEnabled) {
        for (const [id, ref] of keyframeRefs) {
          if (!draggedIds.has(id)) {
            candidateTimes.push(ref.time)
          }
        }
      }
      const next = new Map<string, number>()
      for (const move of session.moves) {
        const raw = move.originalTime + delta
        const snapped = snapKeyframeTime(raw, {
          gridEnabled,
          keyframesEnabled,
          candidateTimes,
          pps,
        })
        next.set(move.keyframeId, clamp(snapped, 0, duration))
      }
      applyDragPreview(next)
    }
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      finishKeyframeDrag()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
  }

  return { dragPreview, isDraggable, startDrag }
}
