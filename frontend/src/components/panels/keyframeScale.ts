import { useRef, useState } from 'react'
import { MoveKeyframesCommand } from '../../engine/commands'
import type { DispatchCommand } from '../../engine/commands'
import { dispatchKeyframeCommands } from '../../engine/keyframeEdit'
import { groupRefsByTarget, groupMaterialRefsByTarget } from '../../app/keyframeSelectionActions'
import type { KeyframeRef, MaterialKeyframeRef } from '../../app/keyframeSelectionActions'
import {
  useTimelineSelectionStore,
  selectedKeyframeIdsOf,
} from '../../stores/timelineSelectionStore'
import { useTimelineViewStore } from '../../stores/timelineViewStore'
import { snapKeyframeTime } from '../../engine/timelineSnapping'

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

interface MorphKeyframeRefForScale {
  readonly nodeId: string
  readonly keyframeId: string
  readonly time: number
  readonly morph: true
}

interface ScaleSession {
  readonly keyframeRefs: ReadonlyMap<
    string,
    KeyframeRef | MaterialKeyframeRef | MorphKeyframeRefForScale
  >
  readonly isAlt: boolean
  readonly playheadTime: number
  readonly edge: 'left' | 'right'
  readonly minTime: number
  readonly maxTime: number
}

export interface KeyframeScaleOptions {
  readonly keyframeRefs: ReadonlyMap<
    string,
    KeyframeRef | MaterialKeyframeRef | MorphKeyframeRefForScale
  >
  readonly duration: number
  readonly pps: number
  readonly timeFromClientX: (clientX: number) => number
  readonly dispatch: DispatchCommand
  readonly notify: (message: string) => void
}

export interface KeyframeScale {
  readonly scalePreview: ReadonlyMap<string, number> | null
  startScale(edge: 'left' | 'right', clientX: number, isAlt: boolean, playheadTime: number): void
}

export interface SelectionBounds {
  readonly minTime: number
  readonly maxTime: number
  readonly minRowIndex: number
  readonly maxRowIndex: number
}

export function computeSelectionBounds(
  selectedKeyframeIds: readonly string[],
  keyframeRefs: ReadonlyMap<string, KeyframeRef | MaterialKeyframeRef | MorphKeyframeRefForScale>,
): SelectionBounds | null {
  if (selectedKeyframeIds.length === 0) {
    return null
  }
  let minTime = Infinity
  let maxTime = -Infinity
  let minRowIndex = Infinity
  let maxRowIndex = -Infinity
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
    if ('rowIndex' in ref) {
      const ri = (ref as KeyframeRef & { rowIndex?: number }).rowIndex ?? 0
      if (ri < minRowIndex) {
        minRowIndex = ri
      }
      if (ri > maxRowIndex) {
        maxRowIndex = ri
      }
    }
  }
  if (minTime === Infinity) {
    return null
  }
  return {
    minTime,
    maxTime,
    minRowIndex: minRowIndex === Infinity ? 0 : minRowIndex,
    maxRowIndex: maxRowIndex === -Infinity ? 0 : maxRowIndex,
  }
}

export function useKeyframeScale(options: KeyframeScaleOptions): KeyframeScale {
  const { keyframeRefs, duration, pps, timeFromClientX, dispatch, notify } = options
  const [scalePreview, setScalePreview] = useState<ReadonlyMap<string, number> | null>(null)
  const scalePreviewRef = useRef<ReadonlyMap<string, number> | null>(null)
  const sessionRef = useRef<ScaleSession | null>(null)

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

    const propertyRefs: (KeyframeRef & { keyframeId: string })[] = []
    const materialRefs: (MaterialKeyframeRef & { keyframeId: string })[] = []
    const morphRefs: (MorphKeyframeRefForScale & { keyframeId: string })[] = []

    for (const [id, ref] of session.keyframeRefs) {
      if (!wanted.has(id)) {
        continue
      }
      if ('morph' in ref && (ref as MorphKeyframeRefForScale).morph) {
        morphRefs.push(ref as MorphKeyframeRefForScale & { keyframeId: string })
      } else if ('property' in ref) {
        propertyRefs.push(ref as KeyframeRef & { keyframeId: string })
      } else if ('parameter' in ref) {
        materialRefs.push(ref as MaterialKeyframeRef & { keyframeId: string })
      }
    }

    const commands: MoveKeyframesCommand[] = []

    for (const group of groupRefsByTarget(propertyRefs, (ref) => ref.keyframeId)) {
      const moves = group.items
        .map((keyframeId) => {
          const previewTime = preview.get(keyframeId)
          const ref = session.keyframeRefs.get(keyframeId)
          if (previewTime === undefined || !ref || previewTime === ref.time) {
            return null
          }
          return { keyframeId, newTime: previewTime }
        })
        .filter((move): move is { keyframeId: string; newTime: number } => move !== null)
      if (moves.length > 0) {
        commands.push(
          new MoveKeyframesCommand({
            target: { kind: 'node', nodeId: group.nodeId, property: group.property },
            moves,
          }),
        )
      }
    }

    for (const group of groupMaterialRefsByTarget(materialRefs, (ref) => ref.keyframeId)) {
      const moves = group.items
        .map((keyframeId) => {
          const previewTime = preview.get(keyframeId)
          const ref = session.keyframeRefs.get(keyframeId)
          if (previewTime === undefined || !ref || previewTime === ref.time) {
            return null
          }
          return { keyframeId, newTime: previewTime }
        })
        .filter((move): move is { keyframeId: string; newTime: number } => move !== null)
      if (moves.length > 0) {
        commands.push(
          new MoveKeyframesCommand({
            target: { kind: 'node', nodeId: group.nodeId, parameter: group.parameter },
            moves,
          }),
        )
      }
    }

    // morph moves grouped by node
    {
      const groups = new Map<
        string,
        { nodeId: string; items: { keyframeId: string; newTime: number }[] }
      >()
      for (const ref of morphRefs) {
        const previewTime = preview.get(ref.keyframeId)
        if (previewTime === undefined || previewTime === ref.time) continue
        let entry = groups.get(ref.nodeId)
        if (!entry) {
          entry = { nodeId: ref.nodeId, items: [] }
          groups.set(ref.nodeId, entry)
        }
        entry.items.push({ keyframeId: ref.keyframeId, newTime: previewTime })
      }
      for (const group of groups.values()) {
        commands.push(
          new MoveKeyframesCommand({
            target: { kind: 'morph', nodeId: group.nodeId },
            moves: group.items,
          }),
        )
      }
    }

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

    const bounds = computeSelectionBounds(selectedIds, keyframeRefs)
    if (!bounds) {
      return
    }

    const session: ScaleSession = {
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
      const raw = timeFromClientX(event.clientX)
      const viewState = useTimelineViewStore.getState()
      const gridEnabled = viewState.gridSnapEnabled
      const keyframesEnabled = viewState.snapToKeyframesEnabled
      const draggedIds = new Set(selectedIds)
      const candidateTimes: number[] = []
      if (keyframesEnabled) {
        for (const [id, ref] of keyframeRefs) {
          if (!draggedIds.has(id)) {
            candidateTimes.push(ref.time)
          }
        }
      }

      const pivot = isAlt ? playheadTime : edge === 'left' ? s.maxTime : s.minTime
      const originalEdgeTime = edge === 'left' ? s.minTime : s.maxTime
      const denom = originalEdgeTime - pivot
      if (Math.abs(denom) < 1e-9) {
        return
      }

      const newEdgeTime = clamp(raw, 0, duration)
      const factor = (newEdgeTime - pivot) / denom
      if (factor <= 0) {
        return
      }

      const next = new Map<string, number>()
      for (const id of selectedIds) {
        const ref = keyframeRefs.get(id)
        if (!ref) {
          continue
        }
        const rawTime = pivot + (ref.time - pivot) * factor
        const snapped = snapKeyframeTime(rawTime, {
          gridEnabled,
          keyframesEnabled,
          candidateTimes,
          pps,
        })
        next.set(id, clamp(snapped, 0, duration))
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
