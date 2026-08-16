import { useRef, useState } from 'react'
import type { AnimationProperty } from '../../engine'
import { MoveKeyframesCommand } from '../../engine/commands'
import type { DispatchCommand } from '../../engine/commands'
import { dispatchKeyframeCommands } from '../../engine/keyframeEdit'
import { groupRefsByTarget } from '../../app/keyframeSelectionActions'
import type { KeyframeRef } from '../../app/keyframeSelectionActions'
import { useSelectionStore } from '../../stores/selectionStore'
import { rulerTickStep, snapTimeToGrid } from '../../stores/timelineViewStore'

interface DragMove {
  readonly keyframeId: string
  readonly nodeId: string
  readonly property: AnimationProperty
  readonly originalTime: number
}

interface DragSession {
  readonly pointerStartTime: number
  readonly moves: readonly DragMove[]
}

export interface KeyframeDragOptions {
  readonly keyframeRefs: ReadonlyMap<string, KeyframeRef>
  readonly duration: number
  readonly pps: number
  readonly timeFromClientX: (clientX: number) => number
  readonly dispatch: DispatchCommand
  readonly notify: (message: string) => void
}

export interface KeyframeDrag {
  readonly dragPreview: ReadonlyMap<string, number> | null
  selectForDrag(keyframeId: string, additive: boolean): boolean
  startDrag(clientX: number): void
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function useKeyframeDrag(options: KeyframeDragOptions): KeyframeDrag {
  const { keyframeRefs, duration, pps, timeFromClientX, dispatch, notify } = options
  const [dragPreview, setDragPreview] = useState<ReadonlyMap<string, number> | null>(null)
  const dragPreviewRef = useRef<ReadonlyMap<string, number> | null>(null)
  const dragSessionRef = useRef<DragSession | null>(null)

  const selectForDrag = (keyframeId: string, additive: boolean): boolean => {
    const store = useSelectionStore.getState()
    if (additive) {
      if (store.selectedKeyframeIds.includes(keyframeId)) {
        store.toggleKeyframe(keyframeId)
        return useSelectionStore.getState().selectedKeyframeIds.length > 0
      }
      store.selectKeyframes([...store.selectedKeyframeIds, keyframeId])
      return true
    }
    if (!store.selectedKeyframeIds.includes(keyframeId)) {
      store.selectKeyframes([keyframeId])
    }
    return true
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
    const commands = groupRefsByTarget(moved, (move) => ({
      keyframeId: move.keyframeId,
      newTime: move.newTime,
    })).map(
      (group) =>
        new MoveKeyframesCommand({
          target: { kind: 'node', nodeId: group.nodeId, property: group.property },
          moves: group.items,
        }),
    )
    const result = dispatchKeyframeCommands(dispatch, commands)
    if (result && !result.ok) {
      notify(result.error.message)
    }
  }

  const startDrag = (clientX: number): void => {
    const moves: DragMove[] = []
    for (const keyframeId of useSelectionStore.getState().selectedKeyframeIds) {
      const ref = keyframeRefs.get(keyframeId)
      if (ref) {
        moves.push({
          keyframeId,
          nodeId: ref.nodeId,
          property: ref.property,
          originalTime: ref.time,
        })
      }
    }
    if (moves.length === 0) {
      return
    }
    dragSessionRef.current = { pointerStartTime: timeFromClientX(clientX), moves }
    const onMove = (event: PointerEvent) => {
      const session = dragSessionRef.current
      if (!session) {
        return
      }
      const delta = timeFromClientX(event.clientX) - session.pointerStartTime
      const step = rulerTickStep(pps)
      const next = new Map<string, number>()
      for (const move of session.moves) {
        next.set(
          move.keyframeId,
          clamp(snapTimeToGrid(move.originalTime + delta, step), 0, duration),
        )
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

  return { dragPreview, selectForDrag, startDrag }
}
