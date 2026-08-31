import { useEffect, useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { Slide } from '../../engine'
import { useEngine } from '../../app/useEngine'
import { AUDIO_TRACK_IDS } from '../../engine/audioClip'
import { usePlaybackController } from '../../stores/playbackStore'
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

const PROMPTER_STRIP_HEIGHT = 42
const AUDIO_LANE_HEIGHT = 56

export function AudioTimelineBody({
  slide,
  duration,
  scrollerRef,
  tracksRef,
  timeAreaRef,
  viewportWidth,
  lastPointerTimeRef,
}: {
  slide: Slide
  duration: number
  scrollerRef: RefObject<HTMLDivElement | null>
  tracksRef: RefObject<HTMLDivElement | null>
  timeAreaRef: RefObject<HTMLDivElement | null>
  viewportWidth: number
  lastPointerTimeRef: RefObject<number | null>
}) {
  const zoomLevel = useTimelineViewStore((state) => state.zoomLevel)
  const scrollTime = useTimelineViewStore((state) => state.scrollTime)
  const currentTime = usePlaybackController((state) => state.currentTimes[slide.id] ?? 0)
  const pps = pixelsPerSecond(zoomLevel)

  // Keep engine reactive for audio/prompter changes
  const { engine } = useEngine()
  // Touch engine to subscribe? We rely on Slide object mutated in place; force re-render via engine events
  const [, setTick] = useState(0)
  useEffect(() => {
    const unsub = engine.subscribe(() => setTick((t) => t + 1))
    return unsub
  }, [engine])

  const timeFromClientX = (clientX: number): number => {
    const rect = timeAreaRef.current?.getBoundingClientRect()
    const state = useTimelineViewStore.getState()
    const p = pixelsPerSecond(state.zoomLevel)
    return state.scrollTime + (clientX - (rect?.left ?? 0)) / p
  }

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const target = scrollTime * pps
    if (Math.abs(el.scrollLeft - target) > 0.5) {
      el.scrollLeft = target
    }
  }, [scrollTime, pps, scrollerRef])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
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
    if (!el) return
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
      .setCurrentTime(slide.id, snapTimeToGrid(raw, rulerTickStep(pps)), duration)
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

  const clips = slide.audio.clips
  const prompterParts = slide.prompter?.parts ?? []

  return (
    <div
      className="audio-timeline-body"
      onPointerMove={recordPointerTime}
      data-testid="audio-timeline-body"
    >
      <div
        className="timeline-tracks"
        ref={tracksRef}
        style={{ width: 64 }}
        onScroll={handleTracksScroll}
      >
        <ul className="timeline-tracks__list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          <li className="timeline-tracks__ruler-spacer" aria-hidden="true" style={{ height: 22 }} />
          <li
            className="audio-tracks__prompter-label"
            aria-hidden="true"
            style={{
              height: PROMPTER_STRIP_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 8,
              fontSize: 10,
              color: 'var(--color-text-muted)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            Prompter
          </li>
          {AUDIO_TRACK_IDS.map((trackId) => (
            <li
              key={trackId}
              className="audio-tracks__label"
              style={{
                height: AUDIO_LANE_HEIGHT,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderBottom: '1px solid var(--color-border)',
                fontSize: 11,
              }}
            >
              {trackId === 'voice' ? 'Voice' : trackId === 'sfx' ? 'SFX' : 'Music'}
            </li>
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
              data-testid="audio-ruler"
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
                data-testid="audio-ruler-playhead"
              />
            </div>

            <div style={{ position: 'relative', width: contentWidth }}>
              <div
                className="audio-prompter-strip"
                data-testid="audio-prompter-strip"
                style={{
                  height: PROMPTER_STRIP_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '0 8px',
                  borderBottom: '1px solid var(--color-border)',
                  background: 'var(--color-bg-panel)',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {prompterParts.length === 0 ? (
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    No prompter parts
                  </span>
                ) : (
                  prompterParts.map((part) => (
                    <div
                      key={part.id}
                      className={`audio-prompter-chip${part.status === 'stale' ? ' audio-prompter-chip--stale' : ''}`}
                      data-testid="prompter-chip"
                      data-start={part.startTime}
                      data-end={part.endTime}
                      style={{
                        padding: '4px 8px',
                        borderRadius: 12,
                        background: 'var(--color-bg)',
                        border: '1px solid var(--color-border)',
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {part.text}
                      <small style={{ marginLeft: 4, fontSize: 9, color: 'var(--color-text-muted)' }}>
                        {part.startTime.toFixed(1)}–{part.endTime.toFixed(1)}
                      </small>
                    </div>
                  ))
                )}
              </div>

              <div
                className="audio-lanes"
                data-testid="audio-lanes"
                style={{ position: 'relative', height: AUDIO_LANE_HEIGHT * 3, width: contentWidth }}
              >
                {AUDIO_TRACK_IDS.map((trackId) => {
                  const laneClips = clips.filter((c) => c.trackId === trackId)
                  return (
                    <div
                      key={trackId}
                      className="audio-lane"
                      data-track={trackId}
                      data-testid={`audio-lane-${trackId}`}
                      style={{
                        height: AUDIO_LANE_HEIGHT,
                        borderBottom: '1px solid var(--color-border)',
                        position: 'relative',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'stretch',
                      }}
                    >
                      <div
                        className="audio-lane__track"
                        style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
                      >
                        {laneClips.length === 0 ? (
                          <div
                            className="audio-empty"
                            data-testid={`audio-empty-${trackId}`}
                            style={{
                              position: 'absolute',
                              inset: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'var(--color-text-muted)',
                              fontSize: 11,
                            }}
                          >
                            No audio — drag an audio asset or record
                          </div>
                        ) : (
                          laneClips.map((clip) => {
                            const playbackDuration =
                              (clip.sourceEnd - clip.sourceStart) / (clip.playbackRate || 1)
                            const clipEnd = clip.timelineStart + playbackDuration
                            const isOverflow = clipEnd > duration + 1e-9
                            const visibleDuration = isOverflow
                              ? Math.max(0, duration - clip.timelineStart)
                              : playbackDuration
                            const width = visibleDuration * pps
                            return (
                              <div
                                key={clip.id}
                                className={`audio-clip audio-clip--${trackId}${isOverflow ? ' audio-clip--overflow' : ''}`}
                                data-testid="audio-clip"
                                data-clip-id={clip.id}
                                data-track={trackId}
                                title={
                                  isOverflow ? 'clipped-with-overflow past slide.duration' : undefined
                                }
                                style={{
                                  position: 'absolute',
                                  top: 8,
                                  height: 40,
                                  left: clip.timelineStart * pps,
                                  width,
                                  background:
                                    trackId === 'voice'
                                      ? 'var(--color-accent)'
                                      : trackId === 'sfx'
                                        ? '#2e9a6a'
                                        : '#e67e22',
                                  border: '1px solid var(--color-border)',
                                  borderRadius: 6,
                                  display: 'flex',
                                  alignItems: 'center',
                                  padding: '0 8px',
                                  fontSize: 11,
                                  overflow: 'hidden',
                                  whiteSpace: 'nowrap',
                                  borderRight: isOverflow ? '3px solid #ff4d4d' : undefined,
                                }}
                              >
                                <span
                                  className="audio-clip__label"
                                  style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
                                >
                                  {clip.assetId}
                                </span>
                                {isOverflow && (
                                  <span style={{ fontSize: 9, marginLeft: 4 }}>⤳ overflow</span>
                                )}
                                <div
                                  className="audio-clip__handle audio-clip__handle--left"
                                  style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 0,
                                    bottom: 0,
                                    width: 6,
                                    cursor: 'ew-resize',
                                  }}
                                />
                                <div
                                  className="audio-clip__handle audio-clip__handle--right"
                                  style={{
                                    position: 'absolute',
                                    right: 0,
                                    top: 0,
                                    bottom: 0,
                                    width: 6,
                                    cursor: 'ew-resize',
                                  }}
                                />
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div
                className="audio-playhead"
                data-testid="audio-playhead"
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: currentTime * pps,
                  width: 2,
                  background: '#ff4d4d',
                  pointerEvents: 'none',
                  zIndex: 10,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
