/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import {
  getManagerRows,
  type ManagerTab,
  getOrphanKeyframes,
  packClipLanesForNode,
  collectBarEdgesForSnap,
  MIN_VISUAL_DURATION,
  MIN_CLIP_SPEED,
  CLIP_HANDLE_WIDTH_PX,
  CLIP_LANE_HEIGHT_PX,
  CLIP_LANE_BAR_HEIGHT_PX,
  clampedSpeedForVisual,
  snapStartTime,
} from '../../engine/animationManagerModel'
import { useTimelineViewStore, pixelsPerSecond } from '../../stores/timelineViewStore'
import { usePlaybackController } from '../../stores/playbackStore'
import {
  SetClipInstanceStartTimeCommand,
  SetClipInstanceSpeedCommand,
  TransactionCommand,
} from '../../engine/commands'

interface AnimationManagerModalProps {
  open: boolean
  parentNodeId: string | null
  onClose: () => void
}

type DragState =
  | {
      mode: 'move'
      nodeId: string
      instanceId: string
      clipId: string
      clipDuration: number
      initialStart: number
      initialSpeed: number
      initialVisual: number
      rightEdge: number
      startX: number
      previewStart: number
      previewSpeed: number
      previewVisual: number
    }
  | {
      mode: 'resize-right'
      nodeId: string
      instanceId: string
      clipId: string
      clipDuration: number
      initialStart: number
      initialSpeed: number
      initialVisual: number
      rightEdge: number
      startX: number
      previewStart: number
      previewSpeed: number
      previewVisual: number
    }
  | {
      mode: 'resize-left'
      nodeId: string
      instanceId: string
      clipId: string
      clipDuration: number
      initialStart: number
      initialSpeed: number
      initialVisual: number
      rightEdge: number
      startX: number
      previewStart: number
      previewSpeed: number
      previewVisual: number
    }

export function AnimationManagerModal({ open, parentNodeId, onClose }: AnimationManagerModalProps) {
  const { engine, dispatch } = useEngine()
  const [, setTick] = useState(0)
  const [activeTab, setActiveTab] = useState<ManagerTab>('clips')
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<{ clipId: string; nodeId: string } | null>(null)
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)

  const zoomLevel = useTimelineViewStore((s) => s.zoomLevel)
  const gridSnapEnabled = useTimelineViewStore((s) => s.gridSnapEnabled)
  const pps = pixelsPerSecond(zoomLevel)

  useEngineEvent(() => setTick((t) => t + 1))

  // Reset tab and expanded when opening parent changes

  useEffect(() => {
    if (open) {
      setActiveTab('clips')
      setExpandedMap({})
      setEditing(null)
      setSelectedInstanceId(null)
      setDragState(null)
    }
  }, [open, parentNodeId])

  // Esc handling: drills back from editor (stub), second Esc closes
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editing) {
          setEditing(null)
          e.stopPropagation()
        } else if (dragState) {
          setDragState(null)
          e.stopPropagation()
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, editing, dragState, onClose])

  const activeSlide = open ? engine.getActiveSlide() : null
  const parentNode = useMemo(() => {
    if (!open || !parentNodeId) return null
    try {
      return engine.getNode(parentNodeId)
    } catch {
      return null
    }
  }, [open, parentNodeId, engine])

  const managerRows = useMemo(() => {
    if (!activeSlide || !parentNode) return []
    const getClip = (clipId: string) => {
      try {
        return engine.getClip(clipId)
      } catch {
        return null
      }
    }
    return getManagerRows(parentNode, activeSlide, engine.materialDefinitions, getClip)
  }, [activeSlide, parentNode, engine])

  const overlayLabel = parentNode ? `Animation Manager — ${parentNode.name}` : 'Animation Manager'

  // Candidate times for snap – computed from committed state, excluding dragging instance
  const snapCandidateTimes = useMemo(() => {
    if (!dragState || dragState.mode !== 'move') return []
    const getClip = (clipId: string) => {
      try {
        return engine.getClip(clipId)
      } catch {
        return null
      }
    }
    const nodes = managerRows.map((r) => r.node)
    const edges = collectBarEdgesForSnap(nodes, getClip, {
      nodeId: dragState.nodeId,
      instanceId: dragState.instanceId,
    })
    // Add playhead time
    if (activeSlide) {
      const playhead = usePlaybackController.getState().getTime(activeSlide.id)
      // Include playhead as candidate – snapKeyframeTime will apply 5px threshold
      return [...edges, playhead]
    }
    return [...edges]
  }, [managerRows, engine, dragState, activeSlide])

  // Window drag listeners
  useEffect(() => {
    if (!dragState) return
    const onPointerMove = (e: PointerEvent) => {
      const deltaPx = e.clientX - dragState.startX
      if (dragState.mode === 'move') {
        const raw = dragState.initialStart + deltaPx / pps
        const clampedRaw = Math.max(0, raw)
        const snapped = gridSnapEnabled
          ? snapStartTime(clampedRaw, pps, true, snapCandidateTimes)
          : clampedRaw
        setDragState((prev) => (prev ? ({ ...prev, previewStart: snapped } as DragState) : prev))
      } else if (dragState.mode === 'resize-right') {
        const newWidthPx = dragState.initialVisual * pps + deltaPx
        let newVisual = newWidthPx / pps
        if (newVisual < MIN_VISUAL_DURATION) newVisual = MIN_VISUAL_DURATION
        const newSpeed = clampedSpeedForVisual(dragState.clipDuration, newVisual)
        // Recompute visual to reflect speed clamp (in case speed hit MIN)
        let finalVisual = dragState.clipDuration / newSpeed
        if (finalVisual < MIN_VISUAL_DURATION) finalVisual = MIN_VISUAL_DURATION
        // If speed clamped to MIN, finalVisual may differ from newVisual; use finalVisual
        setDragState((prev) =>
          prev
            ? ({
                ...prev,
                previewVisual: finalVisual,
                previewSpeed: newSpeed,
              } as DragState)
            : prev,
        )
      } else if (dragState.mode === 'resize-left') {
        const deltaSec = deltaPx / pps
        const rawStart = dragState.initialStart + deltaSec
        const rightEdge = dragState.rightEdge
        let newVisualRaw = rightEdge - rawStart
        if (newVisualRaw < MIN_VISUAL_DURATION) newVisualRaw = MIN_VISUAL_DURATION
        let newSpeed = clampedSpeedForVisual(dragState.clipDuration, newVisualRaw)
        let finalVisual = dragState.clipDuration / newSpeed
        if (finalVisual < MIN_VISUAL_DURATION) finalVisual = MIN_VISUAL_DURATION
        // right edge pinned: previewStart = rightEdge - finalVisual
        let previewStart = rightEdge - finalVisual
        if (previewStart < 0) {
          // Clamp start to 0, recompute visual as rightEdge - 0 = rightEdge, then speed
          previewStart = 0
          const clampedVisual2 = Math.max(rightEdge - previewStart, MIN_VISUAL_DURATION)
          const speed2 = clampedSpeedForVisual(dragState.clipDuration, clampedVisual2)
          const visual2 = dragState.clipDuration / speed2
          finalVisual = visual2 < MIN_VISUAL_DURATION ? MIN_VISUAL_DURATION : visual2
          previewStart = rightEdge - finalVisual
          if (previewStart < 0) previewStart = 0
          newSpeed = speed2
        }
        setDragState((prev) =>
          prev
            ? ({
                ...prev,
                previewStart,
                previewSpeed: newSpeed,
                previewVisual: finalVisual,
              } as DragState)
            : prev,
        )
      }
    }
    const onPointerUp = () => {
      if (!dragState) return
      const current = dragState
      if (current.mode === 'move') {
        const delta = Math.abs(current.previewStart - current.initialStart)
        if (delta > 1e-6) {
          const cmd = new SetClipInstanceStartTimeCommand({
            nodeId: current.nodeId,
            instanceId: current.instanceId,
            startTime: current.previewStart,
          })
          dispatch(cmd)
        }
      } else if (current.mode === 'resize-right') {
        const delta = Math.abs(current.previewSpeed - current.initialSpeed)
        if (delta > 1e-9) {
          // Reject zero speed
          const speedToSet =
            current.previewSpeed < MIN_CLIP_SPEED ? MIN_CLIP_SPEED : current.previewSpeed
          if (speedToSet >= MIN_CLIP_SPEED && speedToSet !== 0) {
            const cmd = new SetClipInstanceSpeedCommand({
              nodeId: current.nodeId,
              instanceId: current.instanceId,
              speed: speedToSet,
            })
            dispatch(cmd)
          }
        }
      } else if (current.mode === 'resize-left') {
        const startDelta = Math.abs(current.previewStart - current.initialStart)
        const speedDelta = Math.abs(current.previewSpeed - current.initialSpeed)
        if (startDelta > 1e-6 || speedDelta > 1e-9) {
          const speedToSet =
            current.previewSpeed < MIN_CLIP_SPEED ? MIN_CLIP_SPEED : current.previewSpeed
          if (speedToSet >= MIN_CLIP_SPEED && speedToSet !== 0) {
            const startCmd = new SetClipInstanceStartTimeCommand({
              nodeId: current.nodeId,
              instanceId: current.instanceId,
              startTime: Math.max(0, current.previewStart),
            })
            const speedCmd = new SetClipInstanceSpeedCommand({
              nodeId: current.nodeId,
              instanceId: current.instanceId,
              speed: speedToSet,
            })
            const tx = new TransactionCommand([startCmd, speedCmd])
            dispatch(tx)
          }
        }
      }
      setDragState(null)
    }
    window.addEventListener('pointermove', onPointerMove as unknown as EventListener)
    window.addEventListener('pointerup', onPointerUp as unknown as EventListener)
    return () => {
      window.removeEventListener('pointermove', onPointerMove as unknown as EventListener)
      window.removeEventListener('pointerup', onPointerUp as unknown as EventListener)
    }
  }, [dragState, pps, gridSnapEnabled, snapCandidateTimes, dispatch])

  if (!open) return null

  const handleBackdropClick = () => {
    if (dragState) {
      setDragState(null)
      return
    }
    if (editing) {
      setEditing(null)
    } else {
      onClose()
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={overlayLabel}
      data-testid="animation-manager-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={handleBackdropClick}
    >
      <div
        className="modal"
        data-testid="animation-manager-modal"
        style={{
          background: 'var(--color-bg, #ffffff)',
          borderRadius: 8,
          padding: 16,
          minWidth: 760,
          maxWidth: 960,
          width: '92vw',
          minHeight: 520,
          maxHeight: '88vh',
          overflow: 'auto',
          border: '1px solid var(--color-border, #ddd)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 16 }} data-testid="animation-manager-title">
            {editing ? (
              <>
                <button
                  onClick={() => setEditing(null)}
                  data-testid="manager-back-button"
                  style={{
                    marginRight: 8,
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border, #ddd)',
                    background: 'var(--color-bg-elevated, #f5f5f5)',
                    cursor: 'pointer',
                  }}
                >
                  ← Back
                </button>
                Editing{' '}
                {(() => {
                  try {
                    return engine.getClip(editing.clipId).name
                  } catch {
                    return editing.clipId
                  }
                })()}{' '}
                —{' '}
                {(() => {
                  try {
                    return engine.getNode(editing.nodeId).name
                  } catch {
                    return editing.nodeId
                  }
                })()}
              </>
            ) : parentNode ? (
              `Animation Manager — ${parentNode.name}`
            ) : (
              'Animation Manager'
            )}
          </h3>
          <button
            onClick={() => (editing ? setEditing(null) : onClose())}
            data-testid="animation-manager-close"
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid var(--color-border, #ddd)',
              background: 'var(--color-bg, #fff)',
              cursor: 'pointer',
            }}
          >
            {editing ? 'Back' : 'Close'}
          </button>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Manager views"
          style={{
            display: 'flex',
            gap: 4,
            background: 'var(--color-bg-elevated, #f0f0f0)',
            borderRadius: 6,
            padding: 2,
            width: 'fit-content',
          }}
          data-testid="manager-tabs"
        >
          <button
            role="tab"
            aria-selected={activeTab === 'collections'}
            data-testid="manager-tab-collections"
            onClick={() => setActiveTab('collections')}
            style={{
              padding: '6px 14px',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
              border: 'none',
              background:
                activeTab === 'collections' ? 'var(--color-accent, #7c5cff)' : 'transparent',
              color: activeTab === 'collections' ? '#fff' : 'var(--color-text-muted, #666)',
            }}
          >
            Collections
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'clips'}
            data-testid="manager-tab-clips"
            onClick={() => setActiveTab('clips')}
            style={{
              padding: '6px 14px',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'clips' ? 'var(--color-accent, #7c5cff)' : 'transparent',
              color: activeTab === 'clips' ? '#fff' : 'var(--color-text-muted, #666)',
            }}
          >
            Clips
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'orphans'}
            data-testid="manager-tab-orphans"
            onClick={() => setActiveTab('orphans')}
            style={{
              padding: '6px 14px',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'orphans' ? 'var(--color-accent, #7c5cff)' : 'transparent',
              color: activeTab === 'orphans' ? '#fff' : 'var(--color-text-muted, #666)',
            }}
          >
            Orphans
          </button>
        </div>

        {/* Stub for editor drill-in: if editing, show placeholder */}
        {editing ? (
          <div
            data-testid="manager-editor-placeholder"
            style={{
              border: '1px solid var(--color-border, #ddd)',
              borderRadius: 6,
              padding: 24,
              textAlign: 'center',
              color: 'var(--color-text-muted, #666)',
              fontSize: 13,
            }}
          >
            Clip editor for {editing.clipId} (stubbed in this slice). Press Esc to go back, Esc
            again to close.
          </div>
        ) : managerRows.length === 0 ? (
          <div
            data-testid="manager-empty"
            style={{
              fontSize: 13,
              color: 'var(--color-text-muted, #666)',
              padding: 12,
              border: '1px dashed var(--color-border, #ddd)',
              borderRadius: 6,
              textAlign: 'center',
            }}
          >
            No animated children under "{parentNode?.name ?? 'parent'}". Add keyframes or assign a
            clip to a descendant to see it here.
          </div>
        ) : (
          <div
            data-testid="manager-rows"
            style={{
              border: '1px solid var(--color-border, #ddd)',
              borderRadius: 6,
              overflow: 'hidden',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Column-like rows: group headers + animated params + clip lanes */}
            {managerRows.map((row) => {
              const isExpanded = expandedMap[row.node.id] ?? true
              const animatedParamCount = row.animatedParams.length
              // Compute clip lanes for this node (for clips tab)
              const getClip = (clipId: string) => {
                try {
                  return engine.getClip(clipId)
                } catch {
                  return null
                }
              }
              const previewOverrides =
                dragState && dragState.nodeId === row.node.id
                  ? new Map<string, { startTime: number; speed: number }>([
                      [
                        dragState.instanceId,
                        { startTime: dragState.previewStart, speed: dragState.previewSpeed },
                      ],
                    ])
                  : undefined
              const packedLanes = packClipLanesForNode(row.node, getClip, pps, previewOverrides)
              const trackCount =
                packedLanes.length > 0 ? Math.max(...packedLanes.map((l) => l.track)) + 1 : 0
              const lanesHeight = trackCount * CLIP_LANE_HEIGHT_PX
              // Container width: based on slide duration and max lane end
              const maxEnd = packedLanes.length > 0 ? Math.max(...packedLanes.map((l) => l.end)) : 0
              const slideDuration = activeSlide?.duration ?? 10
              const timelineWidth = Math.max(slideDuration, maxEnd + 1) * pps
              return (
                <div
                  key={row.node.id}
                  data-testid={`manager-row-${row.node.id}`}
                  style={{ borderBottom: '1px solid var(--color-border, #ddd)' }}
                >
                  <div
                    role="button"
                    aria-expanded={isExpanded}
                    data-testid={`manager-toggle-${row.node.id}`}
                    onClick={() =>
                      setExpandedMap((prev) => ({ ...prev, [row.node.id]: !isExpanded }))
                    }
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 12px',
                      background: 'var(--color-bg-elevated, #fafafa)',
                      cursor: 'pointer',
                      userSelect: 'none',
                      paddingLeft: `${12 + row.depth * 16}px`,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        display: 'inline-block',
                        width: 16,
                        textAlign: 'center',
                        fontSize: 12,
                      }}
                    >
                      {isExpanded ? '−' : '+'}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{row.node.name}</span>
                    {row.node.semanticName && (
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--color-text-muted, #666)',
                          marginLeft: 6,
                        }}
                        title={`Semantic: ${row.node.semanticName}`}
                      >
                        ({row.node.semanticName})
                      </span>
                    )}
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: 11,
                        color: 'var(--color-text-muted, #666)',
                      }}
                    >
                      {animatedParamCount} param{animatedParamCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  {isExpanded && (
                    <div style={{ background: 'var(--color-bg-panel, #fff)' }}>
                      {/* Clip Lanes section – only when tab is clips */}
                      {activeTab === 'clips' && packedLanes.length > 0 && (
                        <div
                          data-testid={`manager-clip-lanes-${row.node.id}`}
                          style={{
                            position: 'relative',
                            height: lanesHeight > 0 ? lanesHeight : CLIP_LANE_HEIGHT_PX,
                            margin: '6px 12px 6px 32px',
                            border: '1px solid var(--color-border, #eee)',
                            borderRadius: 4,
                            background: 'var(--color-bg, #fafafa)',
                            overflowX: 'auto',
                            overflowY: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              position: 'relative',
                              width: `${timelineWidth}px`,
                              height: '100%',
                            }}
                          >
                            {packedLanes.map((lane) => {
                              const isSelected = selectedInstanceId === lane.instance.id
                              const isDragging = dragState?.instanceId === lane.instance.id
                              const isEnabled = lane.instance.enabled
                              const barStyle: React.CSSProperties = {
                                position: 'absolute',
                                left: lane.left,
                                width: lane.width,
                                top: lane.track * CLIP_LANE_HEIGHT_PX + 2,
                                height: CLIP_LANE_BAR_HEIGHT_PX,
                                background: isEnabled
                                  ? isSelected
                                    ? 'var(--color-accent, #7c5cff)'
                                    : '#b8a6ff'
                                  : '#e5e5e5',
                                border: isEnabled
                                  ? `1px solid ${isSelected ? '#4c1d95' : '#7c5cff'}`
                                  : '1px dashed #888',
                                borderRadius: 4,
                                opacity: isEnabled ? 1 : 0.5,
                                display: 'flex',
                                alignItems: 'center',
                                padding: '0 8px',
                                boxSizing: 'border-box',
                                cursor: isEnabled ? (isDragging ? 'grabbing' : 'grab') : 'default',
                                zIndex: lane.zIndex,
                                userSelect: 'none',
                                overflow: 'hidden',
                              }
                              const handleStyle = (
                                side: 'left' | 'right',
                              ): React.CSSProperties => ({
                                position: 'absolute',
                                top: 0,
                                bottom: 0,
                                width: CLIP_HANDLE_WIDTH_PX,
                                ...(side === 'left' ? { left: 0 } : { right: 0 }),
                                cursor: 'ew-resize',
                                background: 'rgba(0,0,0,0.06)',
                                borderLeft:
                                  side === 'left' ? '1px solid rgba(0,0,0,0.15)' : undefined,
                                borderRight:
                                  side === 'right' ? '1px solid rgba(0,0,0,0.15)' : undefined,
                              })
                              const handlePointerDown = (
                                e: React.PointerEvent,
                                mode: 'resize-left' | 'resize-right',
                              ) => {
                                if (!isEnabled) return
                                if (e.button !== 0) return
                                e.preventDefault()
                                e.stopPropagation()
                                setSelectedInstanceId(lane.instance.id)
                                const rightEdge = lane.start + lane.visualDuration
                                setDragState({
                                  mode,
                                  nodeId: row.node.id,
                                  instanceId: lane.instance.id,
                                  clipId: lane.clip.id,
                                  clipDuration: lane.clip.duration,
                                  initialStart: lane.start,
                                  initialSpeed: lane.instance.speed,
                                  initialVisual: lane.visualDuration,
                                  rightEdge,
                                  startX: e.clientX,
                                  previewStart: lane.start,
                                  previewSpeed: lane.instance.speed,
                                  previewVisual: lane.visualDuration,
                                } as DragState)
                              }
                              const barPointerDown = (e: React.PointerEvent) => {
                                // If clicking on handle, ignore (handle already handled)
                                const target = e.target as HTMLElement
                                if (target.dataset.testid?.startsWith('clip-handle')) return
                                if (!isEnabled) {
                                  // selectable but not draggable
                                  e.stopPropagation()
                                  setSelectedInstanceId(lane.instance.id)
                                  return
                                }
                                if (e.button !== 0) return
                                // Check if near edge but we treat handle zones separately; body drag is interior
                                e.preventDefault()
                                e.stopPropagation()
                                setSelectedInstanceId(lane.instance.id)
                                const rightEdge = lane.start + lane.visualDuration
                                setDragState({
                                  mode: 'move',
                                  nodeId: row.node.id,
                                  instanceId: lane.instance.id,
                                  clipId: lane.clip.id,
                                  clipDuration: lane.clip.duration,
                                  initialStart: lane.start,
                                  initialSpeed: lane.instance.speed,
                                  initialVisual: lane.visualDuration,
                                  rightEdge,
                                  startX: e.clientX,
                                  previewStart: lane.start,
                                  previewSpeed: lane.instance.speed,
                                  previewVisual: lane.visualDuration,
                                } as DragState)
                              }
                              return (
                                <div
                                  key={lane.instance.id}
                                  data-testid={`clip-lane-${row.node.id}-${lane.instance.id}`}
                                  data-clip-instance-id={lane.instance.id}
                                  data-track={String(lane.track)}
                                  data-start={String(lane.start)}
                                  data-visual={String(lane.visualDuration)}
                                  data-enabled={String(isEnabled)}
                                  data-selected={String(isSelected)}
                                  title={`${lane.clip.name} — start ${lane.start.toFixed(2)}s visual ${lane.visualDuration.toFixed(2)}s speed ${lane.instance.speed.toFixed(3)}${isEnabled ? '' : ' (disabled)'}`}
                                  style={barStyle}
                                  onPointerDown={barPointerDown}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setSelectedInstanceId(lane.instance.id)
                                  }}
                                >
                                  <span
                                    data-testid={`clip-lane-label-${lane.instance.id}`}
                                    style={{
                                      fontSize: 11,
                                      fontWeight: 500,
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      flex: 1,
                                      pointerEvents: 'none',
                                      color: isEnabled ? (isSelected ? '#fff' : '#2e2e2e') : '#666',
                                    }}
                                  >
                                    {lane.clip.name}
                                  </span>
                                  {isEnabled && (
                                    <>
                                      <div
                                        data-testid={`clip-handle-left-${lane.instance.id}`}
                                        data-handle="left"
                                        style={handleStyle('left')}
                                        onPointerDown={(e) => handlePointerDown(e, 'resize-left')}
                                      />
                                      <div
                                        data-testid={`clip-handle-right-${lane.instance.id}`}
                                        data-handle="right"
                                        style={handleStyle('right')}
                                        onPointerDown={(e) => handlePointerDown(e, 'resize-right')}
                                      />
                                    </>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {activeTab === 'clips' &&
                        packedLanes.length === 0 &&
                        row.node.clipInstances.length > 0 && (
                          <div
                            data-testid={`manager-clip-lanes-empty-${row.node.id}`}
                            style={{
                              padding: '6px 12px 6px 32px',
                              fontSize: 11,
                              color: 'var(--color-text-muted, #888)',
                            }}
                          >
                            No clip lanes (missing clip definition)
                          </div>
                        )}
                      {/* Animated params list – always rendered when expanded (for compatibility), scrollable */}
                      <div
                        data-testid={`manager-params-${row.node.id}`}
                        style={{ background: 'var(--color-bg-panel, #fff)' }}
                      >
                        {row.animatedParams.length === 0 ? (
                          <div
                            style={{
                              padding: '6px 12px 6px 32px',
                              fontSize: 12,
                              color: 'var(--color-text-muted, #666)',
                            }}
                          >
                            No animated params (clip without channels)
                          </div>
                        ) : (
                          row.animatedParams.map((param) => {
                            const orphanKeyframes = activeSlide
                              ? getOrphanKeyframes(row.node, activeSlide, param)
                              : []
                            const showDiamonds =
                              activeTab === 'orphans' && orphanKeyframes.length > 0
                            return (
                              <div
                                key={`${row.node.id}-${param.kind}-${param.key}`}
                                data-testid={`manager-param-${row.node.id}-${param.key}`}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 12,
                                  padding: '6px 12px 6px 32px',
                                  borderTop: '1px solid var(--color-border, #eee)',
                                  fontSize: 12,
                                }}
                              >
                                <span style={{ flex: 1 }}>{param.label}</span>
                                {activeTab !== 'orphans' && (
                                  <span
                                    style={{ fontSize: 10, color: 'var(--color-text-muted, #888)' }}
                                    data-testid={`manager-param-kind-${row.node.id}-${param.key}`}
                                  >
                                    {param.kind}
                                  </span>
                                )}
                                {showDiamonds && (
                                  <span
                                    style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                                    data-testid={`manager-orphan-diamonds-${row.node.id}-${param.key}`}
                                  >
                                    {orphanKeyframes.map((kf) => (
                                      <span
                                        key={kf.id}
                                        data-testid={`orphan-diamond-${kf.id}`}
                                        title={`orphan keyframe at ${kf.time}s`}
                                        aria-label={`orphan keyframe at ${kf.time}s`}
                                        style={{
                                          width: 8,
                                          height: 8,
                                          background: 'var(--color-accent, #7c5cff)',
                                          border: '1px solid #fff',
                                          transform: 'rotate(45deg)',
                                          display: 'inline-block',
                                          flexShrink: 0,
                                        }}
                                      />
                                    ))}
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: 'var(--color-text-muted, #666)',
                                        marginLeft: 4,
                                      }}
                                    >
                                      {orphanKeyframes.length} orphan
                                    </span>
                                  </span>
                                )}
                                {activeTab === 'orphans' &&
                                  !showDiamonds &&
                                  orphanKeyframes.length === 0 && (
                                    <span
                                      style={{
                                        fontSize: 10,
                                        color: 'var(--color-text-muted, #999)',
                                      }}
                                      data-testid={`manager-no-orphan-${row.node.id}-${param.key}`}
                                    >
                                      no orphan
                                    </span>
                                  )}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Footer hint */}
        <div style={{ fontSize: 11, color: 'var(--color-text-muted, #888)' }}>
          Press Esc to close{editing ? ' (Esc drills back first)' : ''} • Click backdrop to close •
          Filtered to animated descendants only (pre-order)
        </div>
      </div>
    </div>
  )
}
