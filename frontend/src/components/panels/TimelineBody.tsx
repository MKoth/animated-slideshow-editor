import { memo, useEffect, useLayoutEffect } from 'react'
import type { RefObject } from 'react'
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
import { iconOf } from './nodeIconKinds'
import { LockIcon, NodeIcon, VisibilityIcon } from './nodeIcons'
import { ROW_HEIGHT, TRACK_HEADER_WIDTH } from './timelineTracks'
import type { TrackRowEntry } from './timelineTracks'

const TrackRow = memo(
  function TrackRow({ node, depth, name, visible }: TrackRowEntry) {
    const selected = useSelectionStore((state) => state.selectedIds.includes(node.id))
    return (
      <li>
        <button
          role="track"
          aria-label={name}
          aria-selected={selected}
          data-depth={depth}
          className={`timeline-track${selected ? ' timeline-track--selected' : ''}`}
          style={{ paddingLeft: 12 + depth * 16 }}
          onClick={(event) => {
            if (event.ctrlKey || event.metaKey) {
              useSelectionStore.getState().toggle(node.id)
            } else if (event.shiftKey) {
              useSelectionStore.getState().extend(node.id)
            } else {
              useSelectionStore.getState().select(node.id)
            }
          }}
        >
          <span className="timeline-track__icon" data-icon={iconOf(node)}>
            <NodeIcon node={node} />
          </span>
          <span className="timeline-track__name">{name}</span>
          <span className="timeline-track__indicators">
            <span className="timeline-track__indicator" title={visible ? 'Visible' : 'Hidden'}>
              <VisibilityIcon visible={visible} />
            </span>
            <span className="timeline-track__indicator" title="Locked">
              <LockIcon />
            </span>
          </span>
        </button>
      </li>
    )
  },
  (prev, next) =>
    prev.node.id === next.node.id &&
    prev.depth === next.depth &&
    prev.name === next.name &&
    prev.visible === next.visible,
)

export function TimelineBody({
  slideId,
  duration,
  rows,
  scrollerRef,
  tracksRef,
  timeAreaRef,
  viewportWidth,
  lastPointerTimeRef,
}: {
  slideId: string
  duration: number
  rows: readonly TrackRowEntry[]
  scrollerRef: RefObject<HTMLDivElement | null>
  tracksRef: RefObject<HTMLDivElement | null>
  timeAreaRef: RefObject<HTMLDivElement | null>
  viewportWidth: number
  lastPointerTimeRef: RefObject<number | null>
}) {
  const zoomLevel = useTimelineViewStore((state) => state.zoomLevel)
  const scrollTime = useTimelineViewStore((state) => state.scrollTime)
  const currentTime = usePlaybackController((state) => state.currentTimes[slideId] ?? 0)
  const pps = pixelsPerSecond(zoomLevel)

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
    const rect = timeAreaRef.current?.getBoundingClientRect()
    const state = useTimelineViewStore.getState()
    const p = pixelsPerSecond(state.zoomLevel)
    const raw = state.scrollTime + (clientX - (rect?.left ?? 0)) / p
    usePlaybackController
      .getState()
      .setCurrentTime(slideId, snapTimeToGrid(raw, rulerTickStep(p)), duration)
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
        <ul className="timeline-tracks__list">
          {rows.map((row) => (
            <TrackRow
              key={row.node.id}
              node={row.node}
              depth={row.depth}
              name={row.name}
              visible={row.visible}
            />
          ))}
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
            />
            <div
              className="timeline-playhead"
              data-testid="timeline-playhead"
              style={{ left: currentTime * pps }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
