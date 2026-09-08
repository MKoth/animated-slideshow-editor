// PROTOTYPE — throwaway branch research/manager-silhouette, do not merge to main
// Animation Manager modal: filtered lanes, clip bars with resize/move, inline clip editor
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { walkPreOrder } from '../../engine/sceneNode'
import { animatablePropertiesOf } from '../../app/keyframeActions'
import {
  pixelsPerSecond,
  rulerTickStep,
  rulerTickTimes,
  tickLabel,
  useTimelineViewStore,
  TRAILING_SCROLL_PADDING_PX,
} from '../../stores/timelineViewStore'
import { clipChannelRows, ROW_HEIGHT, TRACK_HEADER_WIDTH } from './timelineTracks'
import {
  SetClipInstanceStartTimeCommand,
  SetClipInstanceSpeedCommand,
  AddClipChannelCommand,
  AddClipKeyframeCommand,
  TransactionCommand,
} from '../../engine/commands'
import { useNotificationStore } from '../../stores/notificationStore'
import type { ClipDefinition } from '../../engine/clipDefinition'
import type { SceneNode } from '../../engine'

interface AnimationManagerModalProps {
  open: boolean
  parentNodeId: string | null
  onClose: () => void
}

const MIN_VISUAL = 0.25
const EPS = 1e-4

export function AnimationManagerModal({ open, parentNodeId, onClose }: AnimationManagerModalProps) {
  const { engine } = useEngine()
  const [, setTick] = useState(0)
  const zoomLevel = useTimelineViewStore((s) => s.zoomLevel)
  const scrollTime = useTimelineViewStore((s) => s.scrollTime)
  const pps = pixelsPerSecond(zoomLevel)
  const [editing, setEditing] = useState<{ clipId: string; nodeId: string } | null>(null)
  const [contextBar, setContextBar] = useState<{
    x: number
    y: number
    clipId: string
    nodeId: string
    instanceId: string
  } | null>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const timeAreaRef = useRef<HTMLDivElement>(null)

  // tick on any engine event so bars/ruler re-render after clip edits
  useEngineEvent(() => setTick((t) => t + 1))

  // close on Escape — in editor keep Esc→back→close (editing first, then close)
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editing) {
          setEditing(null)
        } else {
          onClose()
        }
      }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [open, editing, onClose])

  const activeSlide = engine.getActiveSlide()
  const duration = activeSlide?.duration ?? 10

  const parentNode = useMemo(() => {
    if (!open || !parentNodeId) return null
    try {
      return engine.getNode(parentNodeId)
    } catch {
      return null
    }
  }, [open, parentNodeId, engine, setTick])

  // filtered descendants: only animated children
  const managerRows = useMemo(() => {
    if (!activeSlide || !parentNode) return []
    const rows: { node: SceneNode; depth: number }[] = []
    const slide = activeSlide
    const hasAnyAnimation = (node: SceneNode): boolean => {
      if (node.clipInstances.length > 0) return true
      const anim = slide.animation.node(node.id)
      if (!anim) return false
      for (const prop of animatablePropertiesOf(node)) {
        if (anim.hasTrack(prop) && anim.keyframes(prop).length > 0) return true
      }
      if (anim.hasVisibleTrack()) return true
      if (anim.hasMorphTrack()) return true
      if (anim.materialTrackParameterKeys().length > 0) return true
      if (anim.shadowTrackKeys().length > 0) return true
      if (anim.hasSymmetryTrack()) return true
      if (node.components.circle) {
        // circle tracks stored as circleTracks
        // hasCircleTrack for each
        for (const key of anim.circleTrackKeys()) {
          if (anim.circleKeyframes(key).length > 0) return true
        }
      }
      // dataLabels
      if (anim.dataLabelTrackLabels().length > 0) return true
      if (anim.tableTrackKeys().length > 0) return true
      return false
    }
    const walk = (node: SceneNode, depth: number) => {
      for (const child of node.children) {
        if ((child.components as unknown as { camera?: unknown }).camera) continue
        if (hasAnyAnimation(child)) {
          rows.push({ node: child, depth })
        }
        // recurse always — filtered tree still needs to find nested animated descendants
        // but keep depth relative to parent (increment if parent counted, else keep)
        walk(child, depth + 1)
      }
    }
    walk(parentNode, 0)
    return rows
  }, [activeSlide, parentNode])

  const editingClip: ClipDefinition | null = useMemo(() => {
    if (!editing) return null
    try {
      return engine.getClip(editing.clipId)
    } catch {
      return null
    }
  }, [editing, engine, setTick])

  const editingNodeName = useMemo(() => {
    if (!editing) return ''
    try {
      return engine.getNode(editing.nodeId).name
    } catch {
      return editing.nodeId
    }
  }, [editing, engine, setTick])

  // ruler
  const step = rulerTickStep(pps)
  const viewportWidth = 760 // modal inner time area
  const visibleEnd = scrollTime + viewportWidth / pps
  const ticks = rulerTickTimes(scrollTime, visibleEnd, step)
  const contentWidth = Math.max(viewportWidth, duration * pps + TRAILING_SCROLL_PADDING_PX)

  const timeFromClientX = useCallback((clientX: number): number => {
    const rect = timeAreaRef.current?.getBoundingClientRect()
    const state = useTimelineViewStore.getState()
    const p = pixelsPerSecond(state.zoomLevel)
    return state.scrollTime + (clientX - (rect?.left ?? 0)) / p
  }, [])

  if (!open) return null

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={parentNode ? `Animation Manager — ${parentNode.name}` : 'Animation Manager'}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={() => {
        if (editing) setEditing(null)
        else onClose()
      }}
      data-testid="animation-manager-overlay"
    >
      <div
        className="modal"
        style={{
          background: 'var(--color-bg)',
          borderRadius: 8,
          padding: 16,
          minWidth: 760,
          maxWidth: 960,
          width: '92vw',
          minHeight: 520,
          maxHeight: '88vh',
          overflow: 'auto',
          border: '1px solid var(--color-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
        data-testid="animation-manager-modal"
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>
            {editing && editingClip ? (
              <>
                <button
                  onClick={() => setEditing(null)}
                  style={{
                    marginRight: 8,
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-bg-elevated)',
                    cursor: 'pointer',
                  }}
                  data-testid="manager-back-button"
                >
                  ← Back
                </button>
                Editing {editingClip.name} — {editingNodeName}
              </>
            ) : parentNode ? (
              <>Animation Manager — {parentNode.name}</>
            ) : (
              'Animation Manager'
            )}
          </h3>
          <button
            onClick={() => (editing ? setEditing(null) : onClose())}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              cursor: 'pointer',
            }}
            data-testid="animation-manager-close"
          >
            {editing ? 'Back' : 'Close'}
          </button>
        </div>

        {editing && editingClip && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-muted)',
              background: 'var(--color-bg-elevated)',
              padding: '6px 8px',
              borderRadius: 4,
            }}
            data-testid="clip-editor-banner"
          >
            Edits affect all {countClipUses(engine, editingClip.id)} uses of this clip (global
            ClipDefinition, no fork).
          </div>
        )}

        {!editing && parentNode && managerRows.length === 0 && (
          <div
            style={{
              fontSize: 13,
              color: 'var(--color-text-muted)',
              padding: 12,
              border: '1px dashed var(--color-border)',
              borderRadius: 6,
            }}
          >
            No animated children under "{parentNode.name}". Add keyframes or assign a clip to a
            descendant to see it here. This filtered view hides non-animated nodes and params.
          </div>
        )}

        {/* two-pane layout — left track headers, right lanes */}
        {!editing ? (
          <div
            style={{
              display: 'flex',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              overflow: 'hidden',
              minHeight: 360,
              flex: 1,
            }}
          >
            {/* left */}
            <div
              style={{
                width: TRACK_HEADER_WIDTH,
                flexShrink: 0,
                background: 'var(--color-bg-elevated)',
                borderRight: '1px solid var(--color-border)',
                overflowY: 'auto',
              }}
              data-testid="manager-tracks"
            >
              <div
                style={{
                  height: 28,
                  borderBottom: '1px solid var(--color-border)',
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 8px',
                  fontSize: 11,
                  color: 'var(--color-text-muted)',
                  fontWeight: 600,
                }}
              >
                TRACKS
              </div>
              {managerRows.map(({ node, depth }) => {
                const clipCount = node.clipInstances.length
                // count orphan param tracks for tooltip
                const anim = activeSlide?.animation.node(node.id)
                const orphanCount = anim ? countOrphanTracks(anim, node) : 0
                return (
                  <div
                    key={node.id}
                    style={{
                      height: ROW_HEIGHT,
                      display: 'flex',
                      alignItems: 'center',
                      paddingLeft: 12 + depth * 16,
                      paddingRight: 8,
                      borderBottom: '1px solid var(--color-border)',
                      fontSize: 12,
                      gap: 6,
                    }}
                    title={`${node.name} — ${clipCount} clip(s), ${orphanCount} orphan param track(s)`}
                    data-testid={`manager-row-${node.id}`}
                  >
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {node.name}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>
                      {clipCount} clip{clipCount === 1 ? '' : 's'}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* right time area */}
            <div
              ref={scrollerRef}
              style={{ flex: 1, overflow: 'auto', position: 'relative' }}
              data-testid="manager-scroller"
            >
              <div style={{ width: contentWidth, position: 'relative' }}>
                <div
                  ref={timeAreaRef}
                  style={{
                    position: 'relative',
                    height: 28,
                    borderBottom: '1px solid var(--color-border)',
                    background: 'var(--color-bg)',
                    userSelect: 'none',
                  }}
                >
                  {ticks.map((t) => (
                    <div
                      key={t}
                      style={{
                        position: 'absolute',
                        left: t * pps,
                        top: 0,
                        bottom: 0,
                        borderLeft: '1px solid var(--color-border)',
                        fontSize: 10,
                        color: 'var(--color-text-muted)',
                        paddingLeft: 4,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      {tickLabel(t, step)}
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    position: 'relative',
                    height: managerRows.length * ROW_HEIGHT,
                    width: contentWidth,
                    background: 'var(--color-bg-panel)',
                  }}
                  data-testid="manager-lanes"
                >
                  {managerRows.map(({ node }, rowIndex) => (
                    <div
                      key={node.id}
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: rowIndex * ROW_HEIGHT,
                        height: ROW_HEIGHT,
                        borderBottom: '1px solid var(--color-border)',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                      data-testid={`manager-lane-${node.id}`}
                    >
                      {node.clipInstances.map((inst) => {
                        let label = inst.clipId
                        let visualDuration = 7
                        try {
                          const clip = engine.getClip(inst.clipId)
                          label = clip.name
                          const raw =
                            clip.duration > 0 && inst.speed > EPS
                              ? clip.duration / inst.speed
                              : clip.duration || 7
                          visualDuration = Math.max(
                            MIN_VISUAL,
                            Math.min(raw, duration - inst.startTime),
                          )
                        } catch {
                          // missing clip — show id
                        }
                        const left = inst.startTime * pps
                        const width = Math.max(12, visualDuration * pps)
                        const disabled = !inst.enabled
                        return (
                          <ClipBar
                            key={inst.id}
                            nodeId={node.id}
                            instanceId={inst.id}
                            clipId={inst.clipId}
                            label={label}
                            left={left}
                            width={width}
                            duration={duration}
                            pps={pps}
                            disabled={disabled}
                            visualDuration={visualDuration}
                            timeFromClientX={timeFromClientX}
                            onEdit={(clipId) => setEditing({ clipId, nodeId: node.id })}
                            onContext={(e) => {
                              e.preventDefault()
                              setContextBar({
                                x: e.clientX,
                                y: e.clientY,
                                clipId: inst.clipId,
                                nodeId: node.id,
                                instanceId: inst.id,
                              })
                            }}
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : editingClip ? (
          <ClipEditorSubView
            clip={editingClip}
            nodeId={editing.nodeId}
            pps={pps}
            step={step}
            contentWidth={contentWidth}
          />
        ) : null}

        {contextBar && (
          <div
            role="menu"
            style={{
              position: 'fixed',
              left: contextBar.x,
              top: contextBar.y,
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              padding: 4,
              zIndex: 1100,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}
            data-testid="clip-bar-context-menu"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              role="menuitem"
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
              onClick={() => {
                const { clipId, nodeId } = contextBar
                setContextBar(null)
                setEditing({ clipId, nodeId })
              }}
              data-testid="clip-bar-edit"
            >
              Edit
            </button>
            <button
              role="menuitem"
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--color-text-muted)',
              }}
              onClick={() => setContextBar(null)}
            >
              Cancel
            </button>
          </div>
        )}
        {contextBar && (
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 1099 }}
            onClick={() => setContextBar(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setContextBar(null)
            }}
          />
        )}

        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span>
            Tip: drag bar to move • drag edges (ew-resize) to condense/stretch → drives{' '}
            <code>speed = duration / visualWidth</code> • right-click → Edit
          </span>
        </div>
      </div>
    </div>
  )
}

function countClipUses(engine: ReturnType<typeof useEngine>['engine'], clipId: string): number {
  const slide = engine.getActiveSlide()
  if (!slide) return 0
  let n = 0
  for (const node of walkPreOrder(slide.scene.root)) {
    for (const inst of node.clipInstances) if (inst.clipId === clipId) n++
  }
  return n
}

function countOrphanTracks(
  anim: NonNullable<ReturnType<import('../../engine/slideAnimation').SlideAnimation['node']>>,
  node: SceneNode,
): number {
  let c = 0
  for (const prop of animatablePropertiesOf(node)) {
    if (anim.hasTrack(prop)) c++
  }
  if (anim.hasVisibleTrack()) c++
  if (anim.hasMorphTrack()) c++
  return c
}

function ClipBar({
  nodeId,
  instanceId,
  clipId,
  label,
  left,
  width,
  duration,
  pps,
  disabled,
  visualDuration,
  timeFromClientX,
  onEdit,
  onContext,
}: {
  nodeId: string
  instanceId: string
  clipId: string
  label: string
  left: number
  width: number
  duration: number
  pps: number
  disabled: boolean
  visualDuration: number
  timeFromClientX: (x: number) => number
  onEdit: (clipId: string) => void
  onContext: (e: React.MouseEvent) => void
}) {
  const { engine, dispatch } = useEngine()
  const barRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    type: 'move' | 'left' | 'right'
    startX: number
    origStart: number
    origVisual: number
    clipDuration: number
  } | null>(null)

  const handlePointerDown = (e: React.PointerEvent, type: 'move' | 'left' | 'right') => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    let clipDuration = 7
    try {
      clipDuration = engine.getClip(clipId).duration
    } catch {
      // fallback
    }
    const inst = engine.getClipInstances(nodeId).find((i) => i.id === instanceId)
    const origStart = inst ? inst.startTime : 0
    const origVisual = visualDuration
    dragRef.current = { type, startX: e.clientX, origStart, origVisual, clipDuration }
    const onMove = (ev: PointerEvent) => {
      const cur = dragRef.current
      if (!cur) return
      if (cur.type === 'move') {
        const delta = (ev.clientX - cur.startX) / pps
        let newStart = cur.origStart + delta
        // snap
        const gs = useTimelineViewStore.getState()
        if (gs.gridSnapEnabled) {
          const step = rulerTickStep(pps)
          newStart = Math.round(newStart / step) * step
        }
        newStart = Math.max(0, Math.min(newStart, duration - cur.origVisual))
        if (barRef.current) {
          barRef.current.style.left = `${newStart * pps}px`
        }
      } else if (cur.type === 'right') {
        const raw = timeFromClientX(ev.clientX)
        let newVisual = raw - cur.origStart
        newVisual = Math.max(MIN_VISUAL, Math.min(newVisual, duration - cur.origStart))
        if (barRef.current) barRef.current.style.width = `${Math.max(12, newVisual * pps)}px`
      } else if (cur.type === 'left') {
        const raw = timeFromClientX(ev.clientX)
        const rightEdge = cur.origStart + cur.origVisual
        let newStart = raw
        const gs = useTimelineViewStore.getState()
        if (gs.gridSnapEnabled) {
          const step = rulerTickStep(pps)
          newStart = Math.round(newStart / step) * step
        }
        newStart = Math.max(0, Math.min(newStart, rightEdge - MIN_VISUAL))
        const newVisual = rightEdge - newStart
        if (barRef.current) {
          barRef.current.style.left = `${newStart * pps}px`
          barRef.current.style.width = `${Math.max(12, newVisual * pps)}px`
        }
      }
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      const cur = dragRef.current
      dragRef.current = null
      if (!cur) return
      try {
        if (cur.type === 'move') {
          const delta = (ev.clientX - cur.startX) / pps
          let newStart = cur.origStart + delta
          if (useTimelineViewStore.getState().gridSnapEnabled) {
            const step = rulerTickStep(pps)
            newStart = Math.round(newStart / step) * step
          }
          newStart = Math.max(0, Math.min(newStart, duration - cur.origVisual))
          // snap to other edges + playhead (5px via pixels) — simplified: grid only for prototype
          const res = dispatch(
            new SetClipInstanceStartTimeCommand({
              nodeId,
              instanceId,
              startTime: Number(newStart.toFixed(3)),
            }),
          )
          if (!res.ok) useNotificationStore.getState().notify(res.error.message)
        } else if (cur.type === 'right') {
          const raw = timeFromClientX(ev.clientX)
          let newVisual = raw - cur.origStart
          newVisual = Math.max(MIN_VISUAL, Math.min(newVisual, duration - cur.origStart))
          if (newVisual <= EPS) return
          const newSpeed = cur.clipDuration / newVisual
          const clamped = Math.max(EPS, newSpeed)
          const res = dispatch(
            new SetClipInstanceSpeedCommand({
              nodeId,
              instanceId,
              speed: Number(clamped.toFixed(4)),
            }),
          )
          if (!res.ok) useNotificationStore.getState().notify(res.error.message)
        } else if (cur.type === 'left') {
          const raw = timeFromClientX(ev.clientX)
          const rightEdge = cur.origStart + cur.origVisual
          let newStart = raw
          if (useTimelineViewStore.getState().gridSnapEnabled) {
            const step = rulerTickStep(pps)
            newStart = Math.round(newStart / step) * step
          }
          newStart = Math.max(0, Math.min(newStart, rightEdge - MIN_VISUAL))
          const newVisual = rightEdge - newStart
          if (newVisual <= EPS) return
          const newSpeed = cur.clipDuration / newVisual
          const clamped = Math.max(EPS, newSpeed)
          const tx = new TransactionCommand([
            new SetClipInstanceStartTimeCommand({
              nodeId,
              instanceId,
              startTime: Number(newStart.toFixed(3)),
            }),
            new SetClipInstanceSpeedCommand({
              nodeId,
              instanceId,
              speed: Number(clamped.toFixed(4)),
            }),
          ])
          const res = dispatch(tx)
          if (!res.ok) useNotificationStore.getState().notify(res.error.message)
        }
      } catch (err) {
        useNotificationStore.getState().notify(err instanceof Error ? err.message : String(err))
      }
      // force parent to re-read engine values (undo preview left style stale until tick)
      // engine event will fire, but ensure reflow
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const instForTitle = engine.getClipInstances(nodeId).find((i) => i.id === instanceId)
  const startForTitle = instForTitle ? instForTitle.startTime.toFixed(2) : '0.00'
  return (
    <div
      ref={barRef}
      data-testid={`clip-bar-${instanceId}`}
      title={`${label} — start ${startForTitle}s • visual ${visualDuration.toFixed(2)}s • speed ${(engine.getClip(clipId).duration / visualDuration).toFixed(2)} — drag to move, edges to stretch (speed = duration / visual)`}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).dataset.handle) return
        handlePointerDown(e, 'move')
      }}
      onContextMenu={onContext}
      onDoubleClick={() => onEdit(clipId)}
      style={{
        position: 'absolute',
        left,
        width,
        top: 4,
        height: ROW_HEIGHT - 8,
        background: disabled ? 'var(--color-bg-elevated)' : 'var(--color-accent)',
        border: disabled ? '1px dashed var(--color-border)' : '1px solid var(--color-accent)',
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        padding: '0 6px 0 8px',
        fontSize: 11,
        color: disabled ? 'var(--color-text-muted)' : '#fff',
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'grab',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        userSelect: 'none',
        zIndex: 2,
      }}
    >
      {/* left handle */}
      <div
        data-handle="left"
        data-testid={`clip-bar-handle-left-${instanceId}`}
        onPointerDown={(e) => handlePointerDown(e, 'left')}
        style={{
          position: 'absolute',
          left: -1,
          top: -1,
          bottom: -1,
          width: 6,
          cursor: 'ew-resize',
          background: 'var(--color-accent)',
          opacity: 0.7,
          borderRadius: '4px 0 0 4px',
        }}
      />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 8px' }}>
        {label}
      </span>
      {/* right handle */}
      <div
        data-handle="right"
        data-testid={`clip-bar-handle-right-${instanceId}`}
        onPointerDown={(e) => handlePointerDown(e, 'right')}
        style={{
          position: 'absolute',
          right: -1,
          top: -1,
          bottom: -1,
          width: 6,
          cursor: 'ew-resize',
          background: 'var(--color-accent)',
          opacity: 0.7,
          borderRadius: '0 4px 4px 0',
        }}
      />
    </div>
  )
}

function ClipEditorSubView({
  clip,
  nodeId,
  pps,
  step,
  contentWidth,
}: {
  clip: ClipDefinition
  nodeId: string
  pps: number
  step: number
  contentWidth: number
}) {
  const { engine, dispatch } = useEngine()
  const notify = useNotificationStore((s) => s.notify)
  const rows = clipChannelRows(clip)
  const [pickerOpen, setPickerOpen] = useState(false)
  const scrollerRef = useRef<HTMLDivElement>(null)

  // keep scroller synced
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const h = () => {
      const state = useTimelineViewStore.getState()
      const p = pixelsPerSecond(state.zoomLevel)
      const viewport = el.clientWidth > 0 ? el.clientWidth : 760
      state.setScrollTime(el.scrollLeft / p, viewport, clip.duration)
    }
    el.addEventListener('scroll', h)
    return () => el.removeEventListener('scroll', h)
  }, [clip.duration])

  const animatableParams = useMemo(() => {
    try {
      return engine.getAnimatableParameters(nodeId)
    } catch {
      return []
    }
  }, [engine, nodeId])

  const handleAddChannel = (
    property: import('../../engine/animationProperties').AnimationProperty,
  ) => {
    setPickerOpen(false)
    const res = dispatch(new AddClipChannelCommand({ clipId: clip.id, channel: { property } }))
    if (!res.ok) notify(res.error.message)
  }

  if (rows.length === 0) {
    return (
      <div
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 6,
          padding: 16,
          textAlign: 'center',
        }}
        data-testid="clip-editor-empty"
      >
        <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 8 }}>
          No channels — + Add Channel
        </div>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <button
            onClick={() => setPickerOpen((v) => !v)}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-elevated)',
              cursor: 'pointer',
              fontSize: 12,
            }}
            data-testid="clip-editor-add-channel"
          >
            + Add Channel
          </button>
          {pickerOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 20 }}>
              <div style={{ position: 'relative' }}>
                {/* reuse ParameterPicker but inline */}
                <PickerInline
                  clip={clip}
                  parameters={animatableParams}
                  onSelect={handleAddChannel}
                  onClose={() => setPickerOpen(false)}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        overflow: 'hidden',
        minHeight: 360,
        flex: 1,
      }}
      data-testid="clip-editor-subview"
    >
      {/* left channel list */}
      <div
        style={{
          width: TRACK_HEADER_WIDTH,
          flexShrink: 0,
          background: 'var(--color-bg-elevated)',
          borderRight: '1px solid var(--color-border)',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            height: 28,
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
            fontSize: 11,
            color: 'var(--color-text-muted)',
            fontWeight: 600,
          }}
        >
          {clip.name}
        </div>
        {rows.map((row) => (
          <div
            key={row.channel}
            style={{
              height: ROW_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              padding: '0 8px',
              borderBottom: '1px solid var(--color-border)',
              fontSize: 12,
            }}
            data-testid={`clip-editor-row-${row.channel}`}
          >
            {row.label}
            <button
              title="Add keyframe at 0.5s (prototype stub)"
              onClick={() => {
                const res = dispatch(
                  new AddClipKeyframeCommand({
                    target: { kind: 'clip', clipId: clip.id, channel: row.channel },
                    time: 0.5,
                    value: 0,
                  }),
                )
                if (!res.ok) notify(res.error.message)
              }}
              style={{
                marginLeft: 'auto',
                padding: '2px 6px',
                fontSize: 10,
                borderRadius: 4,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                cursor: 'pointer',
              }}
              data-testid={`clip-editor-add-kf-${row.channel}`}
            >
              + KF
            </button>
          </div>
        ))}
        <div
          style={{
            height: ROW_HEIGHT,
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
            position: 'relative' as const,
          }}
          data-testid="clip-editor-add-row"
        >
          <button
            onClick={() => setPickerOpen((v) => !v)}
            style={{
              fontSize: 12,
              color: 'var(--color-text-muted)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
            }}
            data-testid="clip-editor-add-channel-2"
          >
            + Add Channel
          </button>
          {pickerOpen && (
            <PickerInline
              clip={clip}
              parameters={animatableParams}
              onSelect={handleAddChannel}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      </div>
      {/* right lanes with diamonds */}
      <div ref={scrollerRef} style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <div style={{ width: contentWidth, position: 'relative' }}>
          <div
            style={{
              position: 'relative',
              height: 28,
              borderBottom: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              userSelect: 'none',
            }}
          >
            {rulerTickTimes(0, clip.duration, rulerTickStep(pps)).map((t) => (
              <div
                key={t}
                style={{
                  position: 'absolute',
                  left: t * pps,
                  top: 0,
                  bottom: 0,
                  borderLeft: '1px solid var(--color-border)',
                  fontSize: 10,
                  color: 'var(--color-text-muted)',
                  paddingLeft: 4,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                {tickLabel(t, step)}
              </div>
            ))}
          </div>
          <div
            style={{
              position: 'relative',
              height: rows.length * ROW_HEIGHT,
              width: contentWidth,
              background: 'var(--color-bg-panel)',
            }}
          >
            {rows.map((row, idx) => {
              const kfs = (() => {
                try {
                  return engine.getClipChannelKeyframes(clip.id, row.channel)
                } catch {
                  return []
                }
              })()
              return (
                <div
                  key={row.channel}
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: idx * ROW_HEIGHT,
                    height: ROW_HEIGHT,
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  {kfs.map((kf) => (
                    <div
                      key={kf.id}
                      data-keyframe-id={kf.id}
                      data-testid={`clip-kf-${kf.id}`}
                      title={`kf ${kf.time.toFixed(2)} → ${String(kf.value)}`}
                      style={{
                        position: 'absolute',
                        left: kf.time * pps,
                        top: '50%',
                        width: 10,
                        height: 10,
                        marginLeft: -5,
                        marginTop: -5,
                        transform: 'rotate(45deg)',
                        background: 'var(--color-accent)',
                        border: '1px solid #fff',
                        borderRadius: 1,
                      }}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function PickerInline({
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
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  const standard = parameters.filter((p) => p.source === 'standard')
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: '100%',
        minWidth: 200,
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        padding: 4,
        zIndex: 30,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      }}
      data-testid="picker-inline"
    >
      {standard.map((p) => {
        const already = clip.hasChannel(
          p.key as import('../../engine/animationProperties').AnimationProperty,
        )
        return (
          <button
            key={p.key}
            disabled={already}
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
            data-testid={`picker-item-${p.key}`}
          >
            {p.label} {already ? '(added)' : ''}
          </button>
        )
      })}
      {standard.length === 0 && (
        <div style={{ padding: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
          No animatable parameters
        </div>
      )}
      <button
        onClick={onClose}
        style={{
          marginTop: 4,
          fontSize: 11,
          color: 'var(--color-text-muted)',
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
