/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
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
import { walkPreOrder } from '../../engine/sceneNode'
import {
  clipChannelRows,
  type ClipEditorRow,
  ROW_HEIGHT,
  TRACK_HEADER_WIDTH,
} from './timelineTracks'
import type { ClipDefinition } from '../../engine/clipDefinition'
import {
  SetClipInstanceStartTimeCommand,
  SetClipInstanceSpeedCommand,
  TransactionCommand,
  SetClipDurationCommand,
  AddClipChannelCommand,
  RemoveClipChannelCommand,
  AddClipKeyframeCommand,
  DeleteClipKeyframesCommand,
  MoveClipKeyframesCommand,
} from '../../engine/commands'
import { useNotificationStore } from '../../stores/notificationStore'

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

function countClipUses(engine: ReturnType<typeof useEngine>['engine'], clipId: string): number {
  const project = engine.project
  if (!project) return 0
  let n = 0
  for (const slide of project.slides) {
    for (const node of walkPreOrder(slide.scene.root)) {
      for (const inst of node.clipInstances) if (inst.clipId === clipId) n++
    }
  }
  return n
}

export function AnimationManagerModal({ open, parentNodeId, onClose }: AnimationManagerModalProps) {
  const { engine, dispatch } = useEngine()
  const [, setTick] = useState(0)
  const [activeTab, setActiveTab] = useState<ManagerTab>('clips')
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<{ clipId: string; nodeId: string } | null>(null)
  const [savedZoom, setSavedZoom] = useState<number | null>(null)
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [clipMenu, setClipMenu] = useState<{
    x: number
    y: number
    clipId: string
    nodeId: string
    instanceId: string
  } | null>(null)

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
      setClipMenu(null)
      setSavedZoom(null)
    }
  }, [open, parentNodeId])

  const restorePpsAndBack = useCallback(() => {
    if (savedZoom !== null) {
      useTimelineViewStore.setState({ zoomLevel: savedZoom })
      setSavedZoom(null)
    }
    setEditing(null)
  }, [savedZoom])

  // Esc handling: drills back from editor (restoring pps), second Esc closes
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editing) {
          restorePpsAndBack()
          e.stopPropagation()
        } else if (dragState) {
          setDragState(null)
          e.stopPropagation()
        } else if (clipMenu) {
          setClipMenu(null)
          e.stopPropagation()
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, editing, dragState, clipMenu, onClose, restorePpsAndBack])

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
    if (clipMenu) {
      setClipMenu(null)
      return
    }
    if (editing) {
      restorePpsAndBack()
    } else {
      onClose()
    }
  }

  const editingClip: ClipDefinition | null = (() => {
    if (!editing) return null
    try {
      return engine.getClip(editing.clipId)
    } catch {
      return null
    }
  })()

  const editingNodeName = (() => {
    if (!editing) return ''
    try {
      return engine.getNode(editing.nodeId).name
    } catch {
      return editing.nodeId
    }
  })()

  const handleEdit = (clipId: string, nodeId: string) => {
    // save pps before drill-in
    const currentZoom = useTimelineViewStore.getState().zoomLevel
    setSavedZoom(currentZoom)
    setEditing({ clipId, nodeId })
    setClipMenu(null)
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
            {editing && editingClip ? (
              <>
                <button
                  onClick={restorePpsAndBack}
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
                <span data-testid="manager-editing-header">
                  Editing {editingClip.name} — {editingNodeName}
                </span>
              </>
            ) : parentNode ? (
              `Animation Manager — ${parentNode.name}`
            ) : (
              'Animation Manager'
            )}
          </h3>
          <button
            onClick={() => (editing ? restorePpsAndBack() : onClose())}
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

        {/* Banner for shared clip */}
        {editing &&
          editingClip &&
          (() => {
            const uses = countClipUses(engine, editingClip.id)
            if (uses <= 1) return null
            return (
              <div
                data-testid="clip-editor-banner"
                style={{
                  fontSize: 12,
                  color: 'var(--color-warning-text, #7a4a00)',
                  background: 'var(--color-warning-bg, #fff3cd)',
                  border: '1px solid var(--color-warning-border, #ffecb5)',
                  padding: '6px 8px',
                  borderRadius: 4,
                }}
              >
                Edits affect all {uses} uses
              </div>
            )
          })()}

        {/* Tabs – hidden in editor */}
        {!editing && (
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
                background:
                  activeTab === 'orphans' ? 'var(--color-accent, #7c5cff)' : 'transparent',
                color: activeTab === 'orphans' ? '#fff' : 'var(--color-text-muted, #666)',
              }}
            >
              Orphans
            </button>
          </div>
        )}

        {/* Editor sub-view */}
        {editing && editingClip ? (
          <ManagerClipEditor
            clip={editingClip}
            nodeId={editing.nodeId}
            pps={pps}
            onBack={restorePpsAndBack}
          />
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
                              const handleContextMenu = (e: React.MouseEvent) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setClipMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  clipId: lane.clip.id,
                                  nodeId: row.node.id,
                                  instanceId: lane.instance.id,
                                })
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
                                  onContextMenu={handleContextMenu}
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

        {/* Clip lane context menu – Edit */}
        {clipMenu && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 1099 }}
              onClick={() => setClipMenu(null)}
              onContextMenu={(e) => {
                e.preventDefault()
                setClipMenu(null)
              }}
            />
            <div
              role="menu"
              data-testid="clip-lane-context-menu"
              style={{
                position: 'fixed',
                left: clipMenu.x,
                top: clipMenu.y,
                background: 'var(--color-bg, #fff)',
                border: '1px solid var(--color-border, #ddd)',
                borderRadius: 6,
                padding: 4,
                zIndex: 1100,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                minWidth: 140,
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                role="menuitem"
                data-testid="clip-lane-edit"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 10px',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
                onClick={() => handleEdit(clipMenu.clipId, clipMenu.nodeId)}
              >
                Edit
              </button>
            </div>
          </>
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

function ManagerClipEditor({
  clip,
  nodeId,
  pps,
}: {
  clip: ClipDefinition
  nodeId: string
  pps: number
  onBack: () => void
}) {
  const { engine, dispatch } = useEngine()
  const notify = useNotificationStore((s) => s.notify)
  const [tick, setTick] = useState(0)
  useEngineEvent(() => setTick((t) => t + 1))

  const rows = useMemo(() => clipChannelRows(clip), [clip, tick])
  // Force re-evaluation when clip mutates via engine events (tick)
  const clipDuration = clip.duration
  const [pickerOpen, setPickerOpen] = useState(false)
  const [diamondMenu, setDiamondMenu] = useState<{
    x: number
    y: number
    keyframeId: string
    row: ClipEditorRow
  } | null>(null)
  const [dragInfo, setDragInfo] = useState<{
    keyframeId: string
    row: ClipEditorRow
    startX: number
    originalNormalized: number
    originalLocal: number
  } | null>(null)
  const timeAreaRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  const animatableParams = useMemo(() => {
    try {
      return engine.getAnimatableParameters(nodeId)
    } catch {
      return []
    }
  }, [engine, nodeId])

  const contentWidth = Math.max(760, clipDuration * pps + 80)
  const editorPps = pps // clip-local; spec says 0..duration domain

  // Duration rescale – only in editor
  const handleDurationChange = (value: number) => {
    if (!Number.isFinite(value) || value < 0) return
    const result = dispatch(new SetClipDurationCommand({ clipId: clip.id, duration: value }))
    if (!result.ok) notify(result.error.message)
  }

  const handleAddChannel = (
    property: import('../../engine/animationProperties').AnimationProperty,
  ) => {
    setPickerOpen(false)
    const result = dispatch(new AddClipChannelCommand({ clipId: clip.id, channel: { property } }))
    if (!result.ok) notify(result.error.message)
  }

  const handleAddKeyframe = (row: ClipEditorRow) => {
    // add at normalized 0.5 (local 0.5*duration = mid) for uniform only
    if (row.kind !== 'clipChannel') {
      notify('Only uniform channels support adding keyframes in this editor slice')
      return
    }
    const time = 0.5 // normalized
    const result = dispatch(
      new AddClipKeyframeCommand({
        target: { kind: 'clip', clipId: clip.id, channel: row.channel },
        time,
        value: 0,
      }),
    )
    if (!result.ok) notify(result.error.message)
  }

  const handleDeleteKeyframe = () => {
    if (!diamondMenu) return
    const { keyframeId, row } = diamondMenu
    setDiamondMenu(null)
    if (row.kind !== 'clipChannel') {
      notify('Only uniform channels support delete in this slice')
      return
    }
    const result = dispatch(
      new DeleteClipKeyframesCommand({
        target: { kind: 'clip', clipId: clip.id, channel: row.channel },
        keyframeIds: [keyframeId],
      }),
    )
    if (!result.ok) notify(result.error.message)
  }

  // Diamond drag handling – move only for uniform channels
  useEffect(() => {
    if (!dragInfo) return
    const onMove = (e: PointerEvent) => {
      const cur = dragInfo
      if (!cur || cur.row.kind !== 'clipChannel') return
      const deltaPx = e.clientX - cur.startX
      const deltaLocal = deltaPx / editorPps
      const newLocal = cur.originalLocal + deltaLocal
      const clampedLocal = Math.max(0, Math.min(newLocal, clipDuration))
      const newNormalized = clipDuration > 0 ? clampedLocal / clipDuration : 0
      // preview via DOM direct mutation
      const el = document.querySelector(
        `[data-keyframe-id="${cur.keyframeId}"]`,
      ) as HTMLElement | null
      if (el) {
        el.style.left = `${clampedLocal * editorPps}px`
      }
      // store preview in state for commit (attach to ref)
      ;(cur as unknown as { previewNormalized: number }).previewNormalized = newNormalized
    }
    const onUp = () => {
      const cur = dragInfo
      setDragInfo(null)
      if (!cur || cur.row.kind !== 'clipChannel') return
      const preview = (cur as unknown as { previewNormalized?: number }).previewNormalized
      if (preview === undefined || Math.abs(preview - cur.originalNormalized) < 1e-6) return
      const result = dispatch(
        new MoveClipKeyframesCommand({
          target: {
            kind: 'clip',
            clipId: clip.id,
            channel: (cur.row as Extract<ClipEditorRow, { kind: 'clipChannel' }>).channel,
          },
          moves: [{ keyframeId: cur.keyframeId, newTime: preview }],
        }),
      )
      if (!result.ok) notify(result.error.message)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragInfo, editorPps, clipDuration, clip.id, dispatch, notify])

  // Helper to get keyframes for a row
  const getKeyframesForRow = (
    row: ClipEditorRow,
  ): readonly import('../../engine/keyframe').Keyframe[] => {
    try {
      const c = engine.getClip(clip.id)
      if (row.kind === 'clipChannel') return c.getChannelKeyframes(row.channel)
      if (row.kind === 'clipVisible') return c.getVisibleKeyframes()
      if (row.kind === 'clipMorph') return c.getMorphKeyframes()
      if (row.kind === 'clipCircle') return c.getCircleKeyframes(row.property)
      if (row.kind === 'clipShadow') return c.getShadowChannelKeyframes(row.property)
      if (row.kind === 'clipMaterial') return c.getMaterialChannelKeyframes(row.parameter)
      return []
    } catch {
      return []
    }
  }

  const handleDiamondPointerDown = (
    e: React.PointerEvent,
    row: ClipEditorRow,
    kf: import('../../engine/keyframe').Keyframe,
  ) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    if (row.kind !== 'clipChannel') return // only uniform draggable in this slice
    const normalized = kf.time
    const local = normalized * clipDuration
    setDragInfo({
      keyframeId: kf.id,
      row,
      startX: e.clientX,
      originalNormalized: normalized,
      originalLocal: local,
    })
  }

  const handleDiamondContextMenu = (e: React.MouseEvent, row: ClipEditorRow, kfId: string) => {
    e.preventDefault()
    e.stopPropagation()
    setDiamondMenu({ x: e.clientX, y: e.clientY, keyframeId: kfId, row })
  }

  const handleChannelContextMenu = (e: React.MouseEvent, row: ClipEditorRow) => {
    e.preventDefault()
    if (row.kind !== 'clipChannel') return
    // Could show remove channel menu – for now we expose remove via state?
    // Simple: right-click offers remove
    const shouldRemove = window.confirm(`Remove channel ${row.label}?`)
    if (shouldRemove) {
      const result = dispatch(
        new RemoveClipChannelCommand({ clipId: clip.id, channel: row.channel }),
      )
      if (!result.ok) notify(result.error.message)
    }
  }

  if (rows.length === 0) {
    return (
      <div
        data-testid="clip-editor-empty"
        style={{
          border: '1px solid var(--color-border, #ddd)',
          borderRadius: 6,
          padding: 24,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <div
          style={{ fontSize: 13, color: 'var(--color-text-muted, #666)' }}
          data-testid="clip-editor-empty-text"
        >
          No channels — + Add Channel
        </div>
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setPickerOpen((v) => !v)}
            data-testid="clip-editor-add-channel"
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid var(--color-border, #ddd)',
              background: 'var(--color-bg-elevated, #f5f5f5)',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            + Add Channel
          </button>
          {pickerOpen && (
            <ClipAddChannelPicker
              clip={clip}
              parameters={animatableParams}
              onSelect={handleAddChannel}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="clip-editor-subview"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flex: 1,
      }}
    >
      {/* Duration control – only in editor */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '6px 8px',
          background: 'var(--color-bg-elevated, #fafafa)',
          border: '1px solid var(--color-border, #ddd)',
          borderRadius: 6,
        }}
        data-testid="clip-editor-duration-row"
      >
        <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          Duration
          <input
            type="number"
            min={0}
            step={0.1}
            value={clipDuration}
            onChange={(e) => handleDurationChange(Number(e.target.value))}
            data-testid="clip-duration-input"
            style={{
              width: 80,
              padding: '4px 6px',
              borderRadius: 4,
              border: '1px solid var(--color-border, #ddd)',
              fontSize: 12,
            }}
          />
          <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>seconds</span>
        </label>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted, #888)', marginLeft: 'auto' }}>
          Clip-local time 0..{clipDuration.toFixed(2)}s • diamonds = normalized × duration
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          border: '1px solid var(--color-border, #ddd)',
          borderRadius: 6,
          overflow: 'hidden',
          minHeight: 360,
          flex: 1,
        }}
      >
        {/* Left headers */}
        <div
          style={{
            width: TRACK_HEADER_WIDTH,
            flexShrink: 0,
            background: 'var(--color-bg-elevated, #fafafa)',
            borderRight: '1px solid var(--color-border, #ddd)',
            overflowY: 'auto',
          }}
          data-testid="clip-editor-tracks"
        >
          <div
            style={{
              height: 28,
              borderBottom: '1px solid var(--color-border, #ddd)',
              display: 'flex',
              alignItems: 'center',
              padding: '0 8px',
              fontSize: 11,
              color: 'var(--color-text-muted, #666)',
              fontWeight: 600,
            }}
          >
            CHANNELS
          </div>
          {rows.map((row) => {
            const key =
              row.kind === 'clipChannel'
                ? row.channel
                : row.kind === 'clipCircle'
                  ? (row as Extract<ClipEditorRow, { kind: 'clipCircle' }>).property
                  : row.kind === 'clipShadow'
                    ? (row as Extract<ClipEditorRow, { kind: 'clipShadow' }>).property
                    : row.kind === 'clipMaterial'
                      ? (row as Extract<ClipEditorRow, { kind: 'clipMaterial' }>).parameter
                      : row.kind === 'clipVisible'
                        ? 'visible'
                        : 'clipMorph'
            const testId =
              row.kind === 'clipChannel'
                ? `clip-editor-row-${row.channel}`
                : `clip-editor-row-${row.kind}-${key}`
            return (
              <div
                key={`${row.kind}-${key}-${row.rowIndex}`}
                data-testid={testId}
                data-row-kind={row.kind}
                style={{
                  height: ROW_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 8px',
                  borderBottom: '1px solid var(--color-border, #eee)',
                  fontSize: 12,
                  gap: 6,
                }}
                onContextMenu={(e) => handleChannelContextMenu(e, row)}
              >
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {row.label}
                </span>
                {row.kind === 'clipChannel' && (
                  <button
                    title="Add keyframe at 0.5 normalized"
                    onClick={() => handleAddKeyframe(row)}
                    data-testid={`clip-editor-add-kf-${(row as Extract<ClipEditorRow, { kind: 'clipChannel' }>).channel}`}
                    style={{
                      padding: '2px 6px',
                      fontSize: 10,
                      borderRadius: 4,
                      border: '1px solid var(--color-border, #ddd)',
                      background: 'var(--color-bg, #fff)',
                      cursor: 'pointer',
                    }}
                  >
                    + KF
                  </button>
                )}
              </div>
            )
          })}
          <div
            style={{
              height: ROW_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              padding: '0 8px',
              position: 'relative',
            }}
            data-testid="clip-editor-add-row"
          >
            <button
              onClick={() => setPickerOpen((v) => !v)}
              data-testid="clip-editor-add-channel-2"
              style={{
                fontSize: 12,
                color: 'var(--color-text-muted, #666)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              + Add Channel
            </button>
            {pickerOpen && (
              <ClipAddChannelPicker
                clip={clip}
                parameters={animatableParams}
                onSelect={handleAddChannel}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>
        </div>

        {/* Right lanes */}
        <div
          ref={scrollerRef}
          style={{ flex: 1, overflow: 'auto', position: 'relative' }}
          data-testid="clip-editor-scroller"
        >
          <div style={{ width: contentWidth, position: 'relative' }}>
            <div
              ref={timeAreaRef}
              style={{
                position: 'relative',
                height: 28,
                borderBottom: '1px solid var(--color-border, #ddd)',
                background: 'var(--color-bg, #fff)',
                userSelect: 'none',
              }}
              data-testid="clip-editor-ruler"
            >
              {/* simple ticks 0..duration */}
              {Array.from({ length: Math.ceil(clipDuration) + 1 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: i * editorPps,
                    top: 0,
                    bottom: 0,
                    borderLeft: '1px solid var(--color-border, #ddd)',
                    fontSize: 10,
                    color: 'var(--color-text-muted, #666)',
                    paddingLeft: 4,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {i}s
                </div>
              ))}
            </div>
            <div
              style={{
                position: 'relative',
                height: rows.length * ROW_HEIGHT,
                width: contentWidth,
                background: 'var(--color-bg-panel, #fff)',
              }}
              data-testid="clip-editor-lanes"
            >
              {rows.map((row, idx) => {
                const kfs = getKeyframesForRow(row)
                return (
                  <div
                    key={`${row.kind}-${idx}`}
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: idx * ROW_HEIGHT,
                      height: ROW_HEIGHT,
                      borderBottom: '1px solid var(--color-border, #eee)',
                    }}
                    data-testid={`clip-editor-lane-${row.kind}-${idx}`}
                  >
                    {kfs.map((kf) => {
                      const left = kf.time * clipDuration * editorPps
                      return (
                        <div
                          key={kf.id}
                          data-keyframe-id={kf.id}
                          data-testid={`clip-diamond-${kf.id}`}
                          title={`kf ${kf.time.toFixed(3)} (local ${(kf.time * clipDuration).toFixed(2)}s) → ${String(kf.value)}`}
                          onPointerDown={(e) => handleDiamondPointerDown(e, row, kf)}
                          onContextMenu={(e) => handleDiamondContextMenu(e, row, kf.id)}
                          style={{
                            position: 'absolute',
                            left: left - 5,
                            top: '50%',
                            width: 10,
                            height: 10,
                            marginTop: -5,
                            transform: 'rotate(45deg)',
                            background: 'var(--color-accent, #7c5cff)',
                            border: '1px solid #fff',
                            boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                            cursor: row.kind === 'clipChannel' ? 'grab' : 'default',
                            zIndex: 2,
                          }}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {diamondMenu && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1098 }}
            onClick={() => setDiamondMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setDiamondMenu(null)
            }}
          />
          <div
            role="menu"
            data-testid="clip-diamond-context-menu"
            style={{
              position: 'fixed',
              left: diamondMenu.x,
              top: diamondMenu.y,
              background: 'var(--color-bg, #fff)',
              border: '1px solid var(--color-border, #ddd)',
              borderRadius: 6,
              padding: 4,
              zIndex: 1100,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              role="menuitem"
              data-testid="clip-diamond-delete"
              onClick={handleDeleteKeyframe}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              Delete Keyframe
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function ClipAddChannelPicker({
  clip,
  parameters,
  onSelect,
  onClose,
}: {
  clip: ClipDefinition
  parameters: readonly import('../../engine/animatableParameters').AnimatableParameter[]
  onSelect: (p: import('../../engine/animationProperties').AnimationProperty) => void
  onClose: () => void
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const clickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-testid="clip-add-channel-picker"]')) {
        // not closing on outside automatically – picker closes via Esc or selection
      }
    }
    window.addEventListener('keydown', esc)
    window.addEventListener('mousedown', clickOutside)
    return () => {
      window.removeEventListener('keydown', esc)
      window.removeEventListener('mousedown', clickOutside)
    }
  }, [onClose])
  const standard = parameters.filter((p) => p.source === 'standard')
  return (
    <div
      data-testid="clip-add-channel-picker"
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        minWidth: 200,
        background: 'var(--color-bg, #fff)',
        border: '1px solid var(--color-border, #ddd)',
        borderRadius: 6,
        padding: 4,
        zIndex: 30,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {standard.map((p) => {
        const already = clip.hasChannel(
          p.key as import('../../engine/animationProperties').AnimationProperty,
        )
        return (
          <button
            key={p.key}
            disabled={already}
            data-testid={`picker-item-${p.key}`}
            onClick={() =>
              !already &&
              onSelect(p.key as import('../../engine/animationProperties').AnimationProperty)
            }
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '6px 8px',
              border: 'none',
              background: 'transparent',
              cursor: already ? 'default' : 'pointer',
              opacity: already ? 0.4 : 1,
              fontSize: 12,
            }}
          >
            {p.label} {already ? '(added)' : ''}
          </button>
        )
      })}
      {standard.length === 0 && (
        <div style={{ padding: 8, fontSize: 12, color: 'var(--color-text-muted, #666)' }}>
          No animatable parameters
        </div>
      )}
      <button
        onClick={onClose}
        style={{
          marginTop: 4,
          fontSize: 11,
          color: 'var(--color-text-muted, #666)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        Close
      </button>
    </div>
  )
}
