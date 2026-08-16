import { useEffect, useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { AnimationProperty, Scene } from '../../engine'
import { addKeyframeAtPlayhead, addPoseKeyframesAtPlayhead } from '../../app/keyframeActions'
import { deleteSelectedKeyframes, keyframeRefsOfScene } from '../../app/keyframeSelectionActions'
import { useEngine } from '../../app/useEngine'
import { DeleteKeyframesCommand } from '../../engine/commands'
import { useNotificationStore } from '../../stores/notificationStore'
import { usePlaybackController } from '../../stores/playbackStore'
import { useSelectionStore } from '../../stores/selectionStore'
import {
  DEFAULT_TIMELINE_VIEWPORT_WIDTH,
  pixelsPerSecond,
  rulerTickStep,
  rulerTickTimes,
  snapTimeToGrid,
  tickLabel,
  TRAILING_SCROLL_PADDING_PX,
  useTimelineViewStore,
} from '../../stores/timelineViewStore'
import { useKeyframeDrag } from './keyframeDrag'
import { ROW_HEIGHT, TRACK_HEADER_WIDTH, PROPERTY_LABELS } from './timelineTracks'
import type { TimelineRow } from './timelineTracks'
import { KeyframeMarker, TimelineContextMenu, TrackRow } from './timelineComponents'
import type { TimelineMenuState } from './timelineComponents'

export function TimelineBody({
  slideId,
  duration,
  scene,
  rows,
  scrollerRef,
  tracksRef,
  timeAreaRef,
  viewportWidth,
  lastPointerTimeRef,
}: {
  slideId: string
  duration: number
  scene: Scene
  rows: readonly TimelineRow[]
  scrollerRef: RefObject<HTMLDivElement | null>
  tracksRef: RefObject<HTMLDivElement | null>
  timeAreaRef: RefObject<HTMLDivElement | null>
  viewportWidth: number
  lastPointerTimeRef: RefObject<number | null>
}) {
  const { engine, dispatch } = useEngine()
  const notify = useNotificationStore((state) => state.notify)
  const zoomLevel = useTimelineViewStore((state) => state.zoomLevel)
  const scrollTime = useTimelineViewStore((state) => state.scrollTime)
  const expandedNodeIds = useTimelineViewStore((state) => state.expandedNodeIds)
  const currentTime = usePlaybackController((state) => state.currentTimes[slideId] ?? 0)
  const playbackStatus = usePlaybackController((state) => state.status)
  const selectedKeyframeIds = useSelectionStore((state) => state.selectedKeyframeIds)
  const [menu, setMenu] = useState<TimelineMenuState | null>(null)
  const pps = pixelsPerSecond(zoomLevel)

  const timeFromClientX = (clientX: number): number => {
    const rect = timeAreaRef.current?.getBoundingClientRect()
    const state = useTimelineViewStore.getState()
    const p = pixelsPerSecond(state.zoomLevel)
    return state.scrollTime + (clientX - (rect?.left ?? 0)) / p
  }

  const keyframeRefs = new Map(
    keyframeRefsOfScene(engine, scene).map((ref) => [ref.keyframeId, ref] as const),
  )
  const { dragPreview, selectForDrag, startDrag } = useKeyframeDrag({
    keyframeRefs,
    duration,
    pps,
    timeFromClientX,
    dispatch,
    notify,
  })

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) {
      return
    }
    const target = scrollTime * pps
    if (Math.abs(el.scrollLeft - target) > 0.5) {
      el.scrollLeft = target
    }
  }, [scrollTime, pps, scrollerRef])

  useEffect(() => {
    const state = useTimelineViewStore.getState()
    const p = pixelsPerSecond(state.zoomLevel)
    const px = currentTime * p
    const viewLeft = state.scrollTime * p
    const viewRight = viewLeft + viewportWidth
    const margin = Math.min(80, viewportWidth / 6)
    if (playbackStatus === 'playing') {
      if (px < viewLeft + margin) {
        state.setScrollTime(currentTime - margin / p, viewportWidth, duration)
      } else if (px > viewRight - margin) {
        state.setScrollTime(currentTime + margin / p - viewportWidth / p, viewportWidth, duration)
      }
    } else if (playbackStatus === 'stopped' && currentTime === 0 && px < viewLeft) {
      state.setScrollTime(0, viewportWidth, duration)
    }
  }, [currentTime, playbackStatus, viewportWidth, duration])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) {
      return
    }
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return
      }
      event.preventDefault()
      const state = useTimelineViewStore.getState()
      const p = pixelsPerSecond(state.zoomLevel)
      const rect = timeAreaRef.current?.getBoundingClientRect()
      const anchor = state.scrollTime + (event.clientX - (rect?.left ?? 0)) / p
      const viewport = el.clientWidth > 0 ? el.clientWidth : DEFAULT_TIMELINE_VIEWPORT_WIDTH
      const factor = event.deltaY < 0 ? 2 : 0.5
      state.setZoom(state.zoomLevel * factor, anchor, viewport, duration)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [scrollerRef, timeAreaRef, duration])

  const handleScroll = () => {
    const el = scrollerRef.current
    if (!el) {
      return
    }
    const tracks = tracksRef.current
    if (tracks && tracks.scrollTop !== el.scrollTop) {
      tracks.scrollTop = el.scrollTop
    }
    const state = useTimelineViewStore.getState()
    const p = pixelsPerSecond(state.zoomLevel)
    const viewport = el.clientWidth > 0 ? el.clientWidth : DEFAULT_TIMELINE_VIEWPORT_WIDTH
    state.setScrollTime(el.scrollLeft / p, viewport, duration)
  }

  const handleTracksScroll = () => {
    const tracks = tracksRef.current
    const el = scrollerRef.current
    if (tracks && el && el.scrollTop !== tracks.scrollTop) {
      el.scrollTop = tracks.scrollTop
    }
  }

  const recordPointerTime = (event: React.PointerEvent) => {
    const rect = timeAreaRef.current?.getBoundingClientRect()
    const state = useTimelineViewStore.getState()
    const p = pixelsPerSecond(state.zoomLevel)
    lastPointerTimeRef.current = state.scrollTime + (event.clientX - (rect?.left ?? 0)) / p
  }

  const dragPlayhead = (clientX: number) => {
    const raw = timeFromClientX(clientX)
    usePlaybackController
      .getState()
      .setCurrentTime(slideId, snapTimeToGrid(raw, rulerTickStep(pps)), duration)
  }

  const startPlayheadDrag = (event: React.PointerEvent) => {
    event.preventDefault()
    dragPlayhead(event.clientX)
    const move = (ev: PointerEvent) => dragPlayhead(ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const handleKeyframePointerDown = (event: React.PointerEvent, keyframe: { id: string }) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const additive = event.ctrlKey || event.metaKey
    if (selectForDrag(keyframe.id, additive)) {
      startDrag(event.clientX)
    }
  }

  const handleKeyframeContextMenu = (
    event: React.MouseEvent,
    row: Extract<TimelineRow, { kind: 'subtrack' }>,
    keyframe: { id: string },
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      x: event.clientX,
      y: event.clientY,
      nodeId: row.node.id,
      property: row.property,
      keyframeId: keyframe.id,
    })
  }

  const handleTrackListContextMenu = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement
    const subtrack = target.closest<HTMLElement>('[data-property]')
    if (subtrack) {
      const nodeId = subtrack.dataset.nodeId
      const property = subtrack.dataset.property
      if (nodeId && property) {
        event.preventDefault()
        setMenu({
          x: event.clientX,
          y: event.clientY,
          nodeId,
          property: property as AnimationProperty,
        })
      }
      return
    }
    const row = target.closest<HTMLElement>('[data-node-id]')
    if (row) {
      const nodeId = row.dataset.nodeId
      if (nodeId) {
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY, nodeId })
      }
    }
  }

  const addKeyframeFromMenu = () => {
    const target = menu
    setMenu(null)
    if (!target) {
      return
    }
    const result = target.property
      ? addKeyframeAtPlayhead(engine, dispatch, slideId, target.nodeId, target.property)
      : addPoseKeyframesAtPlayhead(engine, dispatch, slideId, target.nodeId)
    if (result && !result.ok) {
      notify(result.error.message)
    }
  }

  const deleteKeyframeFromMenu = () => {
    const target = menu
    setMenu(null)
    if (!target?.property || !target.keyframeId) {
      return
    }
    if (useSelectionStore.getState().selectedKeyframeIds.includes(target.keyframeId)) {
      deleteSelectedKeyframes(engine, dispatch)
      return
    }
    const result = dispatch(
      new DeleteKeyframesCommand({
        target: { kind: 'node', nodeId: target.nodeId, property: target.property },
        keyframeIds: [target.keyframeId],
      }),
    )
    if (result && !result.ok) {
      notify(result.error.message)
    }
    useSelectionStore.getState().clearKeyframes()
  }

  const step = rulerTickStep(pps)
  const visibleEnd = scrollTime + viewportWidth / pps
  const ticks = rulerTickTimes(scrollTime, visibleEnd, step)
  const contentWidth = Math.max(viewportWidth, duration * pps + TRAILING_SCROLL_PADDING_PX)

  return (
    <div className="timeline-body" onPointerMove={recordPointerTime}>
      <div
        className="timeline-tracks"
        ref={tracksRef}
        style={{ width: TRACK_HEADER_WIDTH }}
        onScroll={handleTracksScroll}
      >
        <ul className="timeline-tracks__list" onContextMenu={handleTrackListContextMenu}>
          {rows.map((row) =>
            row.kind === 'subtrack' ? (
              <li
                key={`${row.node.id}:${row.property}`}
                className="timeline-subtrack"
                data-node-id={row.node.id}
                data-property={row.property}
                data-depth={row.depth}
                style={{ paddingLeft: 12 + row.depth * 16 }}
              >
                <span className="timeline-subtrack__label">{PROPERTY_LABELS[row.property]}</span>
                <button
                  className="timeline-subtrack__add"
                  aria-label={`Add Keyframe to ${PROPERTY_LABELS[row.property]}`}
                  title="Add keyframe at the playhead"
                  onClick={() => {
                    const result = addKeyframeAtPlayhead(
                      engine,
                      dispatch,
                      slideId,
                      row.node.id,
                      row.property,
                    )
                    if (result && !result.ok) {
                      notify(result.error.message)
                    }
                  }}
                >
                  +
                </button>
              </li>
            ) : (
              <TrackRow
                key={row.node.id}
                {...row}
                expanded={expandedNodeIds[row.node.id] === true}
              />
            ),
          )}
        </ul>
      </div>
      <div
        className="timeline-scroller"
        data-testid="timeline-scroller"
        ref={scrollerRef}
        onScroll={handleScroll}
      >
        <div className="timeline-content" style={{ width: contentWidth }}>
          <div className="timeline-time-area" ref={timeAreaRef}>
            <div
              className="timeline-ruler"
              role="slider"
              aria-label="Playhead"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={currentTime}
              onPointerDown={startPlayheadDrag}
            >
              {ticks.map((time) => (
                <div className="timeline-tick" key={time} style={{ left: time * pps }}>
                  <span className="timeline-tick__label">{tickLabel(time, step)}</span>
                  <span className="timeline-tick__mark" />
                </div>
              ))}
              <div
                className="timeline-ruler__playhead-marker"
                style={{ left: currentTime * pps }}
              />
            </div>
            <div
              className="timeline-lanes"
              style={{ height: rows.length * ROW_HEIGHT, width: contentWidth }}
            >
              {rows.map((row, index) => {
                if (row.kind !== 'subtrack') {
                  return null
                }
                const keyframes = engine.getKeyframes(row.node.id, row.property)
                return (
                  <div
                    key={`${row.node.id}:${row.property}`}
                    className="timeline-lane-row"
                    data-property={row.property}
                    style={{ top: index * ROW_HEIGHT }}
                  >
                    {keyframes.map((keyframe) => {
                      const previewTime = dragPreview?.get(keyframe.id)
                      const shownTime = previewTime ?? keyframe.time
                      const selected = selectedKeyframeIds.includes(keyframe.id)
                      return (
                        <KeyframeMarker
                          key={keyframe.id}
                          keyframeId={keyframe.id}
                          shownTime={shownTime}
                          property={row.property}
                          selected={selected}
                          pps={pps}
                          step={step}
                          onPointerDown={(event) => handleKeyframePointerDown(event, keyframe)}
                          onContextMenu={(event) => handleKeyframeContextMenu(event, row, keyframe)}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
            <div
              className="timeline-playhead"
              data-testid="timeline-playhead"
              style={{ left: currentTime * pps }}
            />
          </div>
        </div>
      </div>
      {menu && (
        <TimelineContextMenu
          menu={menu}
          onAdd={addKeyframeFromMenu}
          onDelete={deleteKeyframeFromMenu}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
