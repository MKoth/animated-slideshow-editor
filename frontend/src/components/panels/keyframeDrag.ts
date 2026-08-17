import { useRef, useState } from 'react'
import type { AnimationProperty } from '../../engine'
import { MoveKeyframesCommand } from '../../engine/commands'
import type { DispatchCommand } from '../../engine/commands'
import { dispatchKeyframeCommands } from '../../engine/keyframeEdit'
import { groupRefsByTarget, groupMaterialRefsByTarget } from '../../app/keyframeSelectionActions'
import type { KeyframeRef, MaterialKeyframeRef } from '../../app/keyframeSelectionActions'
import {
  useTimelineSelectionStore,
  selectedKeyframeIdsOf,
} from '../../stores/timelineSelectionStore'
import { rulerTickStep, snapTimeToGrid } from '../../stores/timelineViewStore'

interface DragMove {
  readonly keyframeId: string
  readonly nodeId: string
  readonly property?: AnimationProperty
  readonly parameter?: string
  readonly originalTime: number
}

interface DragSession {
  readonly pointerStartTime: number
  readonly moves: readonly DragMove[]
}

export interface KeyframeDragOptions {
  readonly keyframeRefs: ReadonlyMap<string, KeyframeRef | MaterialKeyframeRef>
  readonly duration: number
  readonly pps: number
  readonly timeFromClientX: (clientX: number) => number
  readonly dispatch: DispatchCommand
  readonly notify: (message: string) => void
}

export interface KeyframeDrag {
  readonly dragPreview: ReadonlyMap<string, number> | null
  isDraggable(): boolean
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

  const isDraggable = (): boolean => {
    return selectedKeyframeIdsOf(useTimelineSelectionStore.getState()).length > 0
  }

  const buildMoves = (): DragMove[] => {
    const moves: DragMove[] = []
    for (const keyframeId of selectedKeyframeIdsOf(useTimelineSelectionStore.getState())) {
      const ref = keyframeRefs.get(keyframeId)
      if (ref) {
        if ('property' in ref) {
          moves.push({
            keyframeId,
            nodeId: ref.nodeId,
            property: ref.property,
            originalTime: ref.time,
          })
        } else if ('parameter' in ref) {
          moves.push({
            keyframeId,
            nodeId: ref.nodeId,
            parameter: (ref as MaterialKeyframeRef).parameter,
            originalTime: ref.time,
          })
        }
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
    type MovedDragMove = DragMove & { readonly newTime: number }
    const propertyMoves = moved.filter(
      (move): move is MovedDragMove & { property: AnimationProperty } =>
        move.property !== undefined,
    )
    const materialMoves = moved.filter(
      (move): move is MovedDragMove & { parameter: string } => move.parameter !== undefined,
    )
    const commands: MoveKeyframesCommand[] = []
    for (const group of groupRefsByTarget(propertyMoves, (move) => ({
      keyframeId: move.keyframeId,
      newTime: move.newTime,
    }))) {
      commands.push(
        new MoveKeyframesCommand({
          target: { kind: 'node', nodeId: group.nodeId, property: group.property },
          moves: group.items,
        }),
      )
    }
    for (const group of groupMaterialRefsByTarget(materialMoves, (move) => ({
      keyframeId: move.keyframeId,
      newTime: move.newTime,
    }))) {
      commands.push(
        new MoveKeyframesCommand({
          target: { kind: 'node', nodeId: group.nodeId, parameter: group.parameter },
          moves: group.items,
        }),
      )
    }
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
    dragSessionRef.current = { pointerStartTime: startTime, moves }
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

  return { dragPreview, isDraggable, startDrag }
}
