import { useEffect, useRef, useState } from 'react'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { addPoseKeyframesAtPlayhead } from '../../app/keyframeActions'
import { useNotificationStore } from '../../stores/notificationStore'
import { useObjectTimelineStore } from '../../stores/objectTimelineStore'
import { pixelsPerSecond, useTimelineViewStore } from '../../stores/timelineViewStore'
import type { EnginePublic } from '../../engine'
import type { TimelineRow } from './timelineTracks'
import { timelineRows } from './timelineTracks'
import { TimelineBody } from './TimelineBody'
import { NodeIcon } from './nodeIcons'
import { useViewportWidth } from './useViewportWidth'

/** Whether a non-header lane currently holds at least one keyframe. */
function rowHasKeyframes(engine: EnginePublic, slideId: string, row: TimelineRow): boolean {
  switch (row.kind) {
    case 'subtrack':
    case 'hiddenSubtrack':
      return engine.getKeyframes(row.node.id, row.property).length > 0
    case 'materialSubtrack':
      return engine.getMaterialKeyframes(row.node.id, row.parameter.key).length > 0
    case 'dataLabelSubtrack':
      return engine.getDataLabelKeyframes(row.node.id, row.label).length > 0
    case 'circleSubtrack':
      return engine.getCircleKeyframes(row.node.id, row.property).length > 0
    case 'visibleSubtrack':
      return engine.getVisibleKeyframes(row.node.id).length > 0
    case 'zIndexSubtrack':
      return engine.getZIndexKeyframes(row.node.id).length > 0
    case 'morphSubtrack':
      return engine.getMorphKeyframes(row.node.id).length > 0
    case 'symmetrySubtrack':
      return engine.getSymmetryKeyframes(row.node.id).length > 0
    case 'controlSubtrack':
      return (
        (
          engine.getSlide(slideId).animation.node(row.node.id)?.controlKeyframes(row.controlKey) ??
          []
        ).length > 0
      )
    case 'shadowSubtrack':
      return engine.getShadowKeyframes(row.node.id, row.property).length > 0
    default:
      return false
  }
}

/**
 * Focused dope sheet for one object, opened with the L shortcut. It renders
 * the same `TimelineBody` against the same engine/stores as the main timeline,
 * so every keyframe edit here is automatically reflected there (and vice
 * versa); zoom, scroll, playhead and keyframe selection are shared.
 */
export function ObjectTimelineModal() {
  const { engine, dispatch } = useEngine()
  const notify = useNotificationStore((state) => state.notify)
  const targetNodeId = useObjectTimelineStore((state) => state.nodeId)
  const close = useObjectTimelineStore((state) => state.close)
  const [, setTick] = useState(0)

  useEngineEvent((event) => {
    setTick((tick) => tick + 1)
    if (event.type === 'NodeRemoved' && event.nodeId === targetNodeId) {
      close()
    }
  })

  const [animatedOnly, setAnimatedOnly] = useState(false)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)
  const timeAreaRef = useRef<HTMLDivElement>(null)
  const lastPointerTimeRef = useRef<number | null>(null)

  const expandedNodeIds = useTimelineViewStore((state) => state.expandedNodeIds)
  const authoringModeByHost = useTimelineViewStore((state) => state.authoringModeByHost)

  const slide = engine.getActiveSlide()
  const scene = slide?.scene ?? null
  const node = scene && targetNodeId ? scene.getNode(targetNodeId) : undefined

  const viewportWidth = useViewportWidth(scrollerRef, [
    targetNodeId,
    animatedOnly,
    slide?.id ?? null,
  ])

  useEffect(() => {
    if (!targetNodeId) {
      return
    }
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [targetNodeId, close])

  if (!targetNodeId || !slide || !scene || !node) {
    return null
  }

  const allRows = timelineRows(
    scene,
    { ...expandedNodeIds, [node.id]: true },
    engine.materialDefinitions,
    authoringModeByHost,
    (clipId) => engine.clips.find((clip) => clip.id === clipId) ?? null,
  )
  let rows = allRows.filter(
    (row) => row.node.id === node.id && row.kind !== 'node' && row.kind !== 'bone',
  )
  if (animatedOnly) {
    rows = rows.filter((row) => rowHasKeyframes(engine, slide.id, row))
  }

  const zoomByStep = (direction: 'in' | 'out') => {
    const state = useTimelineViewStore.getState()
    const pps = pixelsPerSecond(state.zoomLevel)
    const anchor = state.scrollTime + viewportWidth / 2 / pps
    if (direction === 'in') {
      state.zoomIn(anchor, viewportWidth, slide.duration)
    } else {
      state.zoomOut(anchor, viewportWidth, slide.duration)
    }
  }

  const handleAddKeyframe = () => {
    const result = addPoseKeyframesAtPlayhead(engine, dispatch, slide.id, node.id)
    if (result && !result.ok) {
      notify(result.error.message)
    }
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Animation lanes — ${node.name}`}
      data-testid="object-timeline-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          close()
        }
      }}
    >
      <div
        className="object-timeline-modal"
        data-testid="object-timeline-modal"
        style={{
          background: 'var(--color-bg, #ffffff)',
          borderRadius: 8,
          border: '1px solid var(--color-border, #ddd)',
          padding: 12,
          width: '88vw',
          maxWidth: 1400,
          height: '72vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          overflow: 'hidden',
        }}
      >
        <div
          className="object-timeline-modal__header"
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
        >
          <span className="timeline-track__icon" data-icon="object" aria-hidden="true">
            <NodeIcon node={node} />
          </span>
          <h3 style={{ margin: 0, fontSize: 14 }} data-testid="object-timeline-title">
            {node.name}
          </h3>
          <span style={{ flex: 1 }} />
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              color: 'var(--color-text-muted)',
            }}
          >
            <input
              type="checkbox"
              checked={animatedOnly}
              data-testid="object-timeline-animated-only"
              onChange={(event) => setAnimatedOnly(event.target.checked)}
            />
            Animated only
          </label>
          <button
            className="timeline-toolbar__button"
            title="Add keyframes for every animated transform property at the playhead"
            aria-label="Add Keyframe"
            onClick={handleAddKeyframe}
          >
            + Keyframe
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button
              className="timeline-toolbar__button"
              aria-label="Zoom Out"
              title="Zoom Out"
              onClick={() => zoomByStep('out')}
            >
              −
            </button>
            <button
              className="timeline-toolbar__button"
              aria-label="Zoom In"
              title="Zoom In"
              onClick={() => zoomByStep('in')}
            >
              +
            </button>
            <button
              className="timeline-toolbar__button"
              aria-label="Fit Timeline"
              title="Fit Timeline"
              onClick={() =>
                useTimelineViewStore.getState().fitTimeline(slide.duration, viewportWidth)
              }
            >
              Fit
            </button>
          </div>
          <button
            className="timeline-toolbar__button"
            aria-label="Close animation lanes"
            data-testid="object-timeline-close"
            onClick={close}
          >
            ✕
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <TimelineBody
            slideId={slide.id}
            duration={slide.duration}
            scene={scene}
            rows={rows}
            scrollerRef={scrollerRef}
            tracksRef={tracksRef}
            timeAreaRef={timeAreaRef}
            viewportWidth={viewportWidth}
            lastPointerTimeRef={lastPointerTimeRef}
          />
        </div>
      </div>
    </div>
  )
}
