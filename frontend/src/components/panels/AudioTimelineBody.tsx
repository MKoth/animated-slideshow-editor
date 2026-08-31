import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { Slide } from '../../engine'
import { useEngine } from '../../app/useEngine'
import { AUDIO_TRACK_IDS, type AudioTrackId } from '../../engine/audioClip'
import { CreateAudioClipCommand } from '../../engine/commands'
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
import { snapAudioTime } from '../../engine/timelineSnapping'
import { ASSET_DEFINITION_MIME, AUDIO_ASSET_MIME } from '../../pixi/renderer/dropPlacement'
import { useNotificationStore } from '../../stores/notificationStore'

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
  const { engine, dispatch } = useEngine()
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

  const getAssetDuration = useCallback((assetId: string): number => {
    const asset = engine.getEmbeddedAsset(assetId)
    if (asset?.metadata && typeof (asset.metadata as Record<string, unknown>).duration === 'number') {
      return (asset.metadata as Record<string, unknown>).duration as number
    }
    return 1
  }, [engine])

  const [ghost, setGhost] = useState<{ trackId: AudioTrackId; timelineStart: number; width: number } | null>(null)
  const [dragOverTrack, setDragOverTrack] = useState<AudioTrackId | null>(null)

  const resolveTrackFromEvent = (event: React.DragEvent): AudioTrackId | null => {
    const target = event.target as HTMLElement
    const lane = target.closest<HTMLElement>('[data-track]')
    const track = lane?.dataset.track as AudioTrackId | undefined
    if (track && (AUDIO_TRACK_IDS as readonly string[]).includes(track)) return track
    return null
  }

  const computeSnappedTime = useCallback((rawTime: number): number => {
    const state = useTimelineViewStore.getState()
    const gridStep = rulerTickStep(pixelsPerSecond(state.zoomLevel))
    const prompterBoundaries = (slide.prompter?.parts ?? []).flatMap((p) => [p.startTime, p.endTime])
    return snapAudioTime(rawTime, {
      gridEnabled: state.gridSnapEnabled,
      pps: pixelsPerSecond(state.zoomLevel),
      gridStep,
      prompterBoundaries,
    })
  }, [slide.prompter])

  const handleAudioDragOver = (event: React.DragEvent) => {
    const hasAudio = event.dataTransfer.types.includes(AUDIO_ASSET_MIME)
    const hasImage = event.dataTransfer.types.includes(ASSET_DEFINITION_MIME)
    if (hasImage && !hasAudio) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'none'
      return
    }
    if (!hasAudio) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    const assetId = event.dataTransfer.getData(AUDIO_ASSET_MIME) || ''
    // If getData not available during dragover (security), fallback to stored assetId from previous dragenter
    const laneTrack = resolveTrackFromEvent(event) ?? dragOverTrack ?? 'voice'
    const rawTime = timeFromClientX(event.clientX)
    const snapped = computeSnappedTime(rawTime)
    const assetDuration = assetId ? getAssetDuration(assetId) : 1
    // For ghost during dragover when getData empty, we try to find any embedded audio asset duration fallback
    const fallbackDuration = engine.embeddedAssets.find((a) => a.mimeType.startsWith('audio/'))?.metadata
      ? Number((engine.embeddedAssets.find((a) => a.mimeType.startsWith('audio/'))?.metadata as Record<string, unknown>)?.duration ?? 1)
      : 1
    const durationVal = assetDuration || fallbackDuration
    setGhost({ trackId: laneTrack as AudioTrackId, timelineStart: snapped, width: durationVal * pps })
    setDragOverTrack(laneTrack as AudioTrackId)
  }

  const handleAudioDragLeave = (event: React.DragEvent) => {
    const related = event.relatedTarget as HTMLElement | null
    if (related && event.currentTarget.contains(related)) return
    setGhost(null)
    setDragOverTrack(null)
  }

  const handleAudioDrop = (event: React.DragEvent) => {
    const hasAudio = event.dataTransfer.types.includes(AUDIO_ASSET_MIME)
    const hasImage = event.dataTransfer.types.includes(ASSET_DEFINITION_MIME)
    if (hasImage && !hasAudio) {
      event.preventDefault()
      useNotificationStore.getState().notify('Image assets cannot be dropped on audio lanes')
      setGhost(null)
      setDragOverTrack(null)
      return
    }
    if (!hasAudio) return
    event.preventDefault()
    const assetId = event.dataTransfer.getData(AUDIO_ASSET_MIME)
    if (!assetId) {
      setGhost(null)
      return
    }
    const asset = engine.getEmbeddedAsset(assetId)
    if (!asset || !asset.mimeType.startsWith('audio/')) {
      useNotificationStore.getState().notify('Invalid audio asset')
      setGhost(null)
      return
    }
    const rawDuration = (asset.metadata as Record<string, unknown>)?.duration
    const assetDuration = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : 1
    const trackId = resolveTrackFromEvent(event) ?? dragOverTrack ?? 'voice'
    const rawTime = timeFromClientX(event.clientX)
    const snapped = computeSnappedTime(rawTime)
    // Validate timelineStart within slide? Allow at slide duration boundary, clipped visually
    const result = dispatch(
      new CreateAudioClipCommand({
        slideId: slide.id,
        assetId,
        trackId: trackId as AudioTrackId,
        timelineStart: snapped,
        sourceEnd: assetDuration,
      }),
    )
    if (!result.ok) {
      useNotificationStore.getState().notify(result.error.message)
    }
    setGhost(null)
    setDragOverTrack(null)
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
                onDragOver={handleAudioDragOver}
                onDragLeave={handleAudioDragLeave}
                onDrop={handleAudioDrop}
                style={{ position: 'relative', height: AUDIO_LANE_HEIGHT * 3, width: contentWidth }}
              >
                {ghost && (
                  <div
                    className="audio-clip audio-clip--ghost"
                    data-testid="audio-ghost"
                    data-track={ghost.trackId}
                    style={{
                      position: 'absolute',
                      top: ghost.trackId === 'voice' ? 8 : ghost.trackId === 'sfx' ? 64 : 120,
                      height: 40,
                      left: ghost.timelineStart * pps,
                      width: ghost.width,
                      background: 'rgba(124,92,255,0.35)',
                      border: '1px dashed var(--color-accent)',
                      borderRadius: 6,
                      display: 'flex',
                      alignItems: 'center',
                      padding: '0 8px',
                      fontSize: 11,
                      pointerEvents: 'none',
                      zIndex: 5,
                    }}
                  >
                    <span>ghost · drop to create</span>
                  </div>
                )}
                {AUDIO_TRACK_IDS.map((trackId) => {
                  const laneClips = clips.filter((c) => c.trackId === trackId)
                  const isDragOver = dragOverTrack === trackId
                  return (
                    <div
                      key={trackId}
                      className={`audio-lane${isDragOver ? ' audio-lane--dragover' : ''}`}
                      data-track={trackId}
                      data-testid={`audio-lane-${trackId}`}
                      style={{
                        height: AUDIO_LANE_HEIGHT,
                        borderBottom: '1px solid var(--color-border)',
                        position: 'relative',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'stretch',
                        background: isDragOver ? 'rgba(124,92,255,0.08)' : undefined,
                        outline: isDragOver ? '1px dashed #7c5cff' : undefined,
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
