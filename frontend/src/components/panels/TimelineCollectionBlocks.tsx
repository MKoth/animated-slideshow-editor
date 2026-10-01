import { useEffect, useMemo, useRef, useState } from 'react'
import type { SceneNode } from '../../engine'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { useNotificationStore } from '../../stores/notificationStore'
import { useTimelineViewStore } from '../../stores/timelineViewStore'
import {
  MIN_VISUAL_DURATION,
  packCollectionLanesForParent,
  CLIP_LANE_HEIGHT_PX,
} from '../../engine/animationManagerModel'
import {
  collectionLaneEnvFromEngine,
  commitCollectionMove,
  commitCollectionReorder,
  commitCollectionStretch,
} from '../../app/collectionLaneActions'
import { executeCollectionFreeze, previewCollectionFreeze } from '../../engine/collectionFreeze'
import type { FreezePoseSource } from '../../engine/collectionFreeze'
import { DeleteCollectionPlacementCommand } from '../../engine/commands'

interface DragState {
  mode: 'move' | 'resize-left' | 'resize-right' | 'reorder'
  placementId: string
  collectionId: string
  parentNodeId: string
  initialStart: number
  initialVisual: number
  rightEdge: number
  startX: number
  startY: number
  initialIndex: number
  previewStart: number
  previewVisual: number
  previewIndex: number
}

export function TimelineCollectionBlocks({
  node,
  duration,
  pps,
}: {
  node: SceneNode
  duration: number
  pps: number
}) {
  const { engine, dispatch, undoStack } = useEngine()
  const notify = useNotificationStore((s) => s.notify)
  const gridSnapEnabled = useTimelineViewStore((s) => s.gridSnapEnabled)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; placementId: string } | null>(null)
  const [tick, setTick] = useState(0)
  // Latest drag snapshot for window listeners attached once per gesture.
  // Without this, re-subscribing on every preview update stacks pointerup
  // handlers and commits the move N times (placement jumps far → looks frozen).
  const dragRef = useRef<DragState | null>(null)
  const ppsRef = useRef(pps)
  const durationRef = useRef(duration)
  const gridSnapRef = useRef(gridSnapEnabled)
  const placementsCountRef = useRef(node.collectionPlacements.length)
  const engineRef = useRef(engine)
  const dispatchRef = useRef(dispatch)
  useEffect(() => {
    ppsRef.current = pps
  }, [pps])
  useEffect(() => {
    durationRef.current = duration
  }, [duration])
  useEffect(() => {
    gridSnapRef.current = gridSnapEnabled
  }, [gridSnapEnabled])
  useEffect(() => {
    placementsCountRef.current = node.collectionPlacements.length
  }, [node.collectionPlacements.length])
  useEffect(() => {
    engineRef.current = engine
  }, [engine])
  useEffect(() => {
    dispatchRef.current = dispatch
  }, [dispatch])
  const startDrag = (d: DragState) => {
    dragRef.current = d
    setDrag(d)
  }

  // Invalidate the packed lanes on ANY engine mutation (placement deleted in
  // the Animation Manager, undo/redo, member edits elsewhere). Scene nodes
  // are mutated in place, so the lanes memo on stable node/engine refs would
  // otherwise keep showing deleted blocks as ghosts.
  useEngineEvent(() => setTick((t) => t + 1))

  const getClip = (id: string) => {
    try {
      return engine.getClip(id)
    } catch {
      return null
    }
  }
  const getCollection = (id: string) => {
    try {
      return engine.getClipCollection(id)
    } catch {
      return null
    }
  }

  const preview = useMemo(() => {
    if (!drag) return undefined
    const m = new Map<string, { startTime: number; visualDuration?: number }>()
    m.set(drag.placementId, { startTime: drag.previewStart, visualDuration: drag.previewVisual })
    return m
  }, [drag])

  const lanes = useMemo(() => {
    void tick
    // Reorder preview: virtually reorder placements so stacking preview follows drag
    if (drag?.mode === 'reorder') {
      const placements = [...node.collectionPlacements]
      const from = drag.initialIndex
      const to = drag.previewIndex
      if (from !== to && placements[from]) {
        const [moved] = placements.splice(from, 1)
        placements.splice(to, 0, moved!)
      }
      const tmp = { ...node, collectionPlacements: placements } as typeof node
      return packCollectionLanesForParent(tmp, getClip, getCollection, pps, undefined)
    }
    return packCollectionLanesForParent(node, getClip, getCollection, pps, preview)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, engine, pps, preview, tick, drag?.mode, drag?.previewIndex])

  const hasDrag = drag !== null
  useEffect(() => {
    if (!hasDrag) return
    const onMove = (e: PointerEvent) => {
      const cur = dragRef.current
      if (!cur) return
      const ppsNow = ppsRef.current
      const deltaPx = e.clientX - cur.startX
      const deltaY = e.clientY - cur.startY
      if (cur.mode === 'move') {
        // vertical dominance → reorder
        if (Math.abs(deltaY) > Math.abs(deltaPx) && Math.abs(deltaY) > 8) {
          const next = Math.max(
            0,
            Math.min(
              placementsCountRef.current - 1,
              Math.round(cur.initialIndex + deltaY / CLIP_LANE_HEIGHT_PX),
            ),
          )
          const updated: DragState = { ...cur, mode: 'reorder', previewIndex: next }
          dragRef.current = updated
          setDrag(updated)
          return
        }
        let raw = cur.initialStart + deltaPx / ppsNow
        raw = Math.max(0, raw)
        // Clamp to slide duration: beyond-duration placements never evaluate
        // and go invisible in the Animation Manager (%-positioned, clipped),
        // while lingering in the timeline padding zone as phantoms.
        raw = Math.min(raw, durationRef.current)
        if (gridSnapRef.current) {
          // light grid snap to 0.1s like timeline ruler; full bar-edge snap
          // would need sibling edges — keep move simple on main lane.
          raw = Math.round(raw * 10) / 10
          raw = Math.min(raw, durationRef.current)
        }
        const updated: DragState = { ...cur, previewStart: raw }
        dragRef.current = updated
        setDrag(updated)
      } else if (cur.mode === 'resize-right') {
        let visual = cur.initialVisual + deltaPx / ppsNow
        visual = Math.max(MIN_VISUAL_DURATION, visual)
        visual = Math.min(visual, durationRef.current - cur.initialStart)
        if (visual < MIN_VISUAL_DURATION) visual = MIN_VISUAL_DURATION
        const updated: DragState = { ...cur, previewVisual: visual }
        dragRef.current = updated
        setDrag(updated)
      } else if (cur.mode === 'resize-left') {
        const rawStart = cur.initialStart + deltaPx / ppsNow
        let visual = cur.rightEdge - rawStart
        visual = Math.max(MIN_VISUAL_DURATION, visual)
        let start = cur.rightEdge - visual
        if (start < 0) {
          start = 0
          visual = Math.max(cur.rightEdge - start, MIN_VISUAL_DURATION)
        }
        const updated: DragState = { ...cur, previewStart: start, previewVisual: visual }
        dragRef.current = updated
        setDrag(updated)
      } else if (cur.mode === 'reorder') {
        const next = Math.max(
          0,
          Math.min(
            placementsCountRef.current - 1,
            Math.round(cur.initialIndex + deltaY / CLIP_LANE_HEIGHT_PX),
          ),
        )
        const updated: DragState = { ...cur, previewIndex: next }
        dragRef.current = updated
        setDrag(updated)
      }
    }
    const onUp = () => {
      const cur = dragRef.current
      dragRef.current = null
      setDrag(null)
      if (!cur) return
      const env = collectionLaneEnvFromEngine(engineRef.current)
      try {
        if (cur.mode === 'move') {
          commitCollectionMove(
            env,
            dispatchRef.current as never,
            cur.placementId,
            cur.previewStart,
            cur.initialStart,
            { maxStartTime: durationRef.current },
          )
        } else if (cur.mode === 'resize-right') {
          commitCollectionStretch(env, dispatchRef.current as never, {
            placementId: cur.placementId,
            initialStart: cur.initialStart,
            initialVisual: cur.initialVisual,
            previewStart: cur.initialStart,
            previewVisual: cur.previewVisual,
            isLeftHandle: false,
          })
        } else if (cur.mode === 'resize-left') {
          commitCollectionStretch(env, dispatchRef.current as never, {
            placementId: cur.placementId,
            initialStart: cur.initialStart,
            initialVisual: cur.initialVisual,
            previewStart: cur.previewStart,
            previewVisual: cur.previewVisual,
            isLeftHandle: true,
          })
        } else if (cur.mode === 'reorder') {
          if (cur.previewIndex !== cur.initialIndex) {
            commitCollectionReorder(
              dispatchRef.current as never,
              cur.parentNodeId,
              cur.placementId,
              cur.previewIndex,
            )
          }
        }
      } catch (err) {
        useNotificationStore.getState().notify(err instanceof Error ? err.message : String(err))
      }
      setTick((t) => t + 1)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [hasDrag])

  const runFreeze = (placementId: string, source: FreezePoseSource) => {
    const previewRes = previewCollectionFreeze(engine, { placementId, source })
    if (previewRes.totalWrites === 0) {
      notify(previewRes.warnings.join('; ') || 'Nothing to freeze')
      return
    }
    const label = source === 'first' ? 'first' : 'last'
    const res = executeCollectionFreeze(engine, dispatch as never, undoStack, {
      placementId,
      source,
    })
    if (!res.ok) notify(res.error)
    else {
      const extra = res.warnings.length > 0 ? ` · ${res.warnings[0]}` : ''
      notify(
        `Froze ${label} pose: ${res.writtenCount} keyframe(s) at ${res.targetTime.toFixed(2)}s${extra}`,
      )
      setTick((t) => t + 1)
    }
  }

  return (
    <div
      data-testid={`timeline-collection-lane-${node.id}`}
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
    >
      {lanes.map((lane) => {
        const isDragging = drag?.placementId === lane.placement.id
        const nudge = Math.min(lane.track, 3) * 2
        return (
          <div
            key={lane.placement.id}
            data-testid={`timeline-collection-block-${lane.placement.id}`}
            data-placement-id={lane.placement.id}
            title={`${lane.collection.name}\nstart ${lane.start.toFixed(2)}s · visual ${lane.visualDuration.toFixed(2)}s · right-click: freeze pose`}
            style={{
              position: 'absolute',
              left: lane.start * pps,
              width: Math.max(8, lane.visualDuration * pps),
              top: 2 + nudge,
              height: 24 - nudge,
              background: isDragging ? 'var(--color-accent, #7c5cff)' : '#d4c5ff',
              border: '1px solid #7c5cff',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              padding: '0 6px',
              boxSizing: 'border-box',
              cursor: isDragging ? 'grabbing' : 'grab',
              zIndex: 10 + lane.track,
              userSelect: 'none',
              overflow: 'hidden',
              opacity: lane.track > 0 ? 0.92 : 1,
            }}
            onPointerDown={(e) => {
              if (e.button !== 0) return
              const t = e.target as HTMLElement
              if (t.dataset.handle) return
              e.preventDefault()
              e.stopPropagation()
              const idx = node.collectionPlacements.findIndex((p) => p.id === lane.placement.id)
              startDrag({
                mode: 'move',
                placementId: lane.placement.id,
                collectionId: lane.collection.id,
                parentNodeId: node.id,
                initialStart: lane.start,
                initialVisual: lane.visualDuration,
                rightEdge: lane.start + lane.visualDuration,
                startX: e.clientX,
                startY: e.clientY,
                initialIndex: idx === -1 ? lane.track : idx,
                previewStart: lane.start,
                previewVisual: lane.visualDuration,
                previewIndex: idx === -1 ? lane.track : idx,
              })
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setMenu({ x: e.clientX, y: e.clientY, placementId: lane.placement.id })
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                pointerEvents: 'none',
                color: isDragging ? '#fff' : '#2e2e2e',
              }}
            >
              {lane.collection.name}
            </span>
            <div
              data-handle="left"
              data-testid={`timeline-collection-handle-left-${lane.placement.id}`}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: 6,
                cursor: 'ew-resize',
                background: 'rgba(0,0,0,0.08)',
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                e.stopPropagation()
                const idx = node.collectionPlacements.findIndex((p) => p.id === lane.placement.id)
                startDrag({
                  mode: 'resize-left',
                  placementId: lane.placement.id,
                  collectionId: lane.collection.id,
                  parentNodeId: node.id,
                  initialStart: lane.start,
                  initialVisual: lane.visualDuration,
                  rightEdge: lane.start + lane.visualDuration,
                  startX: e.clientX,
                  startY: e.clientY,
                  initialIndex: idx === -1 ? lane.track : idx,
                  previewStart: lane.start,
                  previewVisual: lane.visualDuration,
                  previewIndex: idx === -1 ? lane.track : idx,
                })
              }}
            />
            <div
              data-handle="right"
              data-testid={`timeline-collection-handle-right-${lane.placement.id}`}
              style={{
                position: 'absolute',
                right: 0,
                top: 0,
                bottom: 0,
                width: 6,
                cursor: 'ew-resize',
                background: 'rgba(0,0,0,0.08)',
              }}
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.preventDefault()
                e.stopPropagation()
                const idx = node.collectionPlacements.findIndex((p) => p.id === lane.placement.id)
                startDrag({
                  mode: 'resize-right',
                  placementId: lane.placement.id,
                  collectionId: lane.collection.id,
                  parentNodeId: node.id,
                  initialStart: lane.start,
                  initialVisual: lane.visualDuration,
                  rightEdge: lane.start + lane.visualDuration,
                  startX: e.clientX,
                  startY: e.clientY,
                  initialIndex: idx === -1 ? lane.track : idx,
                  previewStart: lane.start,
                  previewVisual: lane.visualDuration,
                  previewIndex: idx === -1 ? lane.track : idx,
                })
              }}
            />
          </div>
        )
      })}
      {menu && (
        <>
          <div
            data-testid="timeline-collection-context-backdrop"
            style={{ position: 'fixed', inset: 0, zIndex: 1099 }}
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div
            role="menu"
            data-testid="timeline-collection-context-menu"
            style={{
              position: 'fixed',
              left: menu.x,
              top: menu.y,
              background: 'var(--color-bg, #fff)',
              border: '1px solid var(--color-border, #ddd)',
              borderRadius: 6,
              padding: 4,
              zIndex: 1100,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              minWidth: 230,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              role="menuitem"
              data-testid="timeline-collection-freeze-first"
              style={menuItemStyle}
              onClick={() => {
                const id = menu.placementId
                setMenu(null)
                runFreeze(id, 'first')
              }}
            >
              Freeze FIRST pose after block
            </button>
            <button
              role="menuitem"
              data-testid="timeline-collection-freeze-last"
              style={menuItemStyle}
              onClick={() => {
                const id = menu.placementId
                setMenu(null)
                runFreeze(id, 'last')
              }}
            >
              Freeze LAST pose after block
            </button>
            <button
              role="menuitem"
              data-testid="timeline-collection-delete"
              style={{ ...menuItemStyle, color: 'var(--color-danger, #c00)' }}
              onClick={() => {
                const id = menu.placementId
                let name = id.slice(0, 8)
                try {
                  const placement = engine.getCollectionPlacement(id)
                  name = engine.getClipCollection(placement.collectionId).name
                } catch {
                  // fall back to short id
                }
                setMenu(null)
                if (!window.confirm(`Delete collection placement "${name}" and its clip lanes?`))
                  return
                const result = dispatch(
                  new DeleteCollectionPlacementCommand({ placementId: id }) as never,
                )
                if (!result.ok) notify(result.error.message)
                else {
                  const count =
                    (result.inverse as { memberInstances?: readonly unknown[] }).memberInstances
                      ?.length ?? 0
                  notify(
                    count > 0
                      ? `Deleted collection placement (+${count} clip lane(s) removed)`
                      : 'Deleted collection placement',
                  )
                  setTick((t) => t + 1)
                }
              }}
            >
              Delete placement
            </button>
            <div style={{ fontSize: 10, color: '#888', padding: '4px 10px' }}>
              Copies first/last clip keys to node tracks at block end so the pose holds after the
              collection ends, plus a hold key at block start on untouched tracks. Add blocks in
              Animation Manager.
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 10px',
  border: 'none',
  background: 'transparent',
  cursor: 'pointer',
  fontSize: 12,
}
