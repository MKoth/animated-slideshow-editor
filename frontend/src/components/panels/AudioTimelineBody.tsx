import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Slide } from '../../engine'
import { useEngine } from '../../app/useEngine'
import {
  AUDIO_TRACK_IDS,
  type AudioTrackId,
  getAudioClipPlaybackDuration,
  getOverlappingClipIds,
} from '../../engine/audioClip'
import {
  CreateAudioClipCommand,
  DeleteAudioClipCommand,
  DuplicateAudioClipCommand,
  MoveAudioClipCommand,
  SplitAudioClipCommand,
  TrimAudioClipCommand,
} from '../../engine/commands'
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
import { useAudioClipSelectionStore } from '../../stores/audioClipSelectionStore'

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

  const { engine, dispatch } = useEngine()
  const [, setTick] = useState(0)
  useEffect(() => {
    const unsub = engine.subscribe(() => setTick((t) => t + 1))
    return unsub
  }, [engine])

  const selectedClipIds = useAudioClipSelectionStore((s) => s.selectedClipIds)

  const timeFromClientX = (clientX: number): number => {
    const rect = timeAreaRef.current?.getBoundingClientRect()
    const state = useTimelineViewStore.getState()
    const p = pixelsPerSecond(state.zoomLevel)
    return state.scrollTime + (clientX - (rect?.left ?? 0)) / p
  }

  const trackFromClientY = (clientY: number): AudioTrackId | null => {
    const lanes = timeAreaRef.current?.querySelector('.audio-lanes')?.getBoundingClientRect()
    if (!lanes) return null
    const y = clientY - lanes.top
    const idx = Math.floor(y / AUDIO_LANE_HEIGHT)
    if (idx < 0 || idx >= AUDIO_TRACK_IDS.length) return null
    return AUDIO_TRACK_IDS[idx]
  }

  const getAssetDuration = useCallback(
    (assetId: string): number => {
      const asset = engine.getEmbeddedAsset(assetId)
      if (
        asset?.metadata &&
        typeof (asset.metadata as Record<string, unknown>).duration === 'number'
      ) {
        return (asset.metadata as Record<string, unknown>).duration as number
      }
      return 1
    },
    [engine],
  )

  const [ghost, setGhost] = useState<{
    trackId: AudioTrackId
    timelineStart: number
    width: number
  } | null>(null)
  const [dragOverTrack, setDragOverTrack] = useState<AudioTrackId | null>(null)

  // Move drag state
  const moveRef = useRef<{
    clipId: string
    startX: number
    startTime: number
    startTrack: AudioTrackId
    currentTrack: AudioTrackId
  } | null>(null)
  const [movePreview, setMovePreview] = useState<{
    clipId: string
    timelineStart: number
    trackId: AudioTrackId
  } | null>(null)

  // Trim state
  const [trimPreview, setTrimPreview] = useState<{
    clipId: string
    sourceStart: number
    sourceEnd: number
    left: number
    width: number
  } | null>(null)

  const resolveTrackFromEvent = (event: React.DragEvent): AudioTrackId | null => {
    const target = event.target as HTMLElement
    const lane = target.closest<HTMLElement>('[data-track]')
    const track = lane?.dataset.track as AudioTrackId | undefined
    if (track && (AUDIO_TRACK_IDS as readonly string[]).includes(track)) return track
    return null
  }

  const computeSnappedTime = useCallback(
    (rawTime: number): number => {
      const state = useTimelineViewStore.getState()
      const gridStep = rulerTickStep(pixelsPerSecond(state.zoomLevel))
      const prompterBoundaries = (slide.prompter?.parts ?? []).flatMap((p) => [
        p.startTime,
        p.endTime,
      ])
      return snapAudioTime(rawTime, {
        gridEnabled: state.gridSnapEnabled,
        pps: pixelsPerSecond(state.zoomLevel),
        gridStep,
        prompterBoundaries,
      })
    },
    [slide.prompter],
  )

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
    const laneTrack = resolveTrackFromEvent(event) ?? dragOverTrack ?? 'voice'
    const rawTime = timeFromClientX(event.clientX)
    const snapped = computeSnappedTime(rawTime)
    const assetDuration = assetId ? getAssetDuration(assetId) : 1
    const fallbackDuration = engine.embeddedAssets.find((a) => a.mimeType.startsWith('audio/'))
      ?.metadata
      ? Number(
          (
            engine.embeddedAssets.find((a) => a.mimeType.startsWith('audio/'))?.metadata as Record<
              string,
              unknown
            >
          )?.duration ?? 1,
        )
      : 1
    const durationVal = assetDuration || fallbackDuration
    setGhost({
      trackId: laneTrack as AudioTrackId,
      timelineStart: snapped,
      width: durationVal * pps,
    })
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
    const assetDuration =
      typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : 1
    const trackId = resolveTrackFromEvent(event) ?? dragOverTrack ?? 'voice'
    const rawTime = timeFromClientX(event.clientX)
    const snapped = computeSnappedTime(rawTime)
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

  // Selection
  const handleClipPointerDownSelect = (e: React.MouseEvent, clipId: string) => {
    // if handle drag, ignore selection logic for handles (handled separately)
    if ((e.target as HTMLElement).closest('.audio-clip__handle')) return
    const isMulti = e.metaKey || e.ctrlKey
    if (isMulti) useAudioClipSelectionStore.getState().toggle(clipId)
    else useAudioClipSelectionStore.getState().select(clipId)
  }

  // Move handling
  const onClipMovePointerDown = (e: React.PointerEvent, clipId: string) => {
    if ((e.target as HTMLElement).closest('.audio-clip__handle')) return
    e.preventDefault()
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) return
    // selection side-effect: ensure clip is selected
    if (!selectedClipIds.has(clipId) && !(e.ctrlKey || e.metaKey)) {
      useAudioClipSelectionStore.getState().select(clipId)
    }
    moveRef.current = {
      clipId,
      startX: e.clientX,
      startTime: clip.timelineStart,
      startTrack: clip.trackId,
      currentTrack: clip.trackId,
    }
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      if (!moveRef.current) return
      const dx = ev.clientX - moveRef.current.startX
      const dt = dx / pps
      const raw = moveRef.current.startTime + dt
      const snapped = computeSnappedTime(Math.max(0, raw))
      const newTrack = trackFromClientY(ev.clientY) ?? moveRef.current.currentTrack
      moveRef.current.currentTrack = newTrack
      setMovePreview({ clipId, timelineStart: snapped, trackId: newTrack })
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!moveRef.current) return
      const preview = movePreview ?? null
      // compute final values from preview or recompute
      const dx = ev.clientX - moveRef.current.startX
      const dt = dx / pps
      const raw = moveRef.current.startTime + dt
      const snapped = computeSnappedTime(Math.max(0, raw))
      const finalTrack = trackFromClientY(ev.clientY) ?? moveRef.current.startTrack
      // only dispatch if changed
      const original = slide.audio.clips.find((c) => c.id === clipId)
      if (
        original &&
        (Math.abs(original.timelineStart - snapped) > 1e-6 || original.trackId !== finalTrack)
      ) {
        const result = dispatch(
          new MoveAudioClipCommand({
            slideId: slide.id,
            clipId,
            timelineStart: snapped,
            trackId: finalTrack,
          }),
        )
        if (!result.ok) useNotificationStore.getState().notify(result.error.message)
      }
      setMovePreview(null)
      moveRef.current = null
      void preview
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Trim handling
  const onTrimPointerDown = (e: React.PointerEvent, clipId: string, side: 'left' | 'right') => {
    e.preventDefault()
    e.stopPropagation()
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) return
    const startSourceStart = clip.sourceStart
    const startSourceEnd = clip.sourceEnd
    const startX = e.clientX
    const playbackRate = clip.playbackRate || 1
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dtPlayback = dx / pps
      // for left: moving left handle left => decrease sourceStart? Actually dx positive (drag right) => sourceStart increases
      // Map playback delta to source delta via playbackRate
      if (side === 'left') {
        const newSourceStart = Math.max(0, startSourceStart + dtPlayback * playbackRate)
        // ensure < sourceEnd - epsilon
        const clamped = Math.min(newSourceStart, startSourceEnd - 0.01)
        const newSourceEnd = startSourceEnd
        const newWidth = ((newSourceEnd - clamped) / playbackRate) * pps
        const clipLeft = slide.audio.clips.find((c) => c.id === clipId)?.timelineStart ?? 0
        // left handle does not move timelineStart, so waveform preview clipped at new bounds: we show preview with adjusted left offset?
        // For visual: keep left at same timelineStart, width shrinks
        setTrimPreview({
          clipId,
          sourceStart: clamped,
          sourceEnd: newSourceEnd,
          left: clipLeft * pps,
          width: newWidth,
        })
      } else {
        const newSourceEnd = startSourceEnd + dtPlayback * playbackRate
        const clamped = Math.max(startSourceStart + 0.01, newSourceEnd)
        const newWidth = ((clamped - startSourceStart) / playbackRate) * pps
        const clipLeft = slide.audio.clips.find((c) => c.id === clipId)?.timelineStart ?? 0
        setTrimPreview({
          clipId,
          sourceStart: startSourceStart,
          sourceEnd: clamped,
          left: clipLeft * pps,
          width: newWidth,
        })
      }
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const dx = ev.clientX - startX
      const dtPlayback = dx / pps
      let patch: { sourceStart?: number; sourceEnd?: number } = {}
      if (side === 'left') {
        const newSourceStart = Math.max(0, startSourceStart + dtPlayback * playbackRate)
        const clamped = Math.min(newSourceStart, startSourceEnd - 0.01)
        if (Math.abs(clamped - startSourceStart) > 1e-6) patch = { sourceStart: clamped }
      } else {
        const newSourceEnd = startSourceEnd + dtPlayback * playbackRate
        const clamped = Math.max(startSourceStart + 0.01, newSourceEnd)
        if (Math.abs(clamped - startSourceEnd) > 1e-6) patch = { sourceEnd: clamped }
      }
      if (patch.sourceStart !== undefined || patch.sourceEnd !== undefined) {
        const result = dispatch(new TrimAudioClipCommand({ slideId: slide.id, clipId, ...patch }))
        if (!result.ok) useNotificationStore.getState().notify(result.error.message)
      }
      setTrimPreview(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Keyboard shortcuts for duplicate/delete/split
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement?.closest(
        '[data-testid="audio-timeline-body"], [data-testid="audio-lanes"]',
      )
      const inAudioTab = Boolean(document.querySelector('[data-testid="audio-timeline-body"]'))
      if (!inAudioTab && !active) return
      // Delete / Backspace
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipIds.size > 0) {
        // avoid when editing input
        if (
          (e.target as HTMLElement)?.tagName === 'INPUT' ||
          (e.target as HTMLElement)?.tagName === 'TEXTAREA'
        )
          return
        e.preventDefault()
        for (const clipId of Array.from(selectedClipIds)) {
          const result = dispatch(new DeleteAudioClipCommand({ slideId: slide.id, clipId }))
          if (!result.ok) useNotificationStore.getState().notify(result.error.message)
        }
        useAudioClipSelectionStore.getState().clear()
      }
      // Duplicate Ctrl/Cmd+D
      if (
        (e.key === 'd' || e.key === 'D') &&
        (e.metaKey || e.ctrlKey) &&
        selectedClipIds.size > 0
      ) {
        if (
          (e.target as HTMLElement)?.tagName === 'INPUT' ||
          (e.target as HTMLElement)?.tagName === 'TEXTAREA'
        )
          return
        e.preventDefault()
        for (const clipId of Array.from(selectedClipIds)) {
          const result = dispatch(new DuplicateAudioClipCommand({ slideId: slide.id, clipId }))
          if (!result.ok) useNotificationStore.getState().notify(result.error.message)
          else {
            const newId = (result.inverse as { newClipId: string }).newClipId
            // select new duplicate
            useAudioClipSelectionStore.getState().select(newId)
          }
        }
      }
      // Split at playhead: key 'S' or 's' when single selected clip contains playhead
      if (
        (e.key === 's' || e.key === 'S') &&
        !e.metaKey &&
        !e.ctrlKey &&
        selectedClipIds.size === 1
      ) {
        const clipId = Array.from(selectedClipIds)[0]
        const clip = slide.audio.clips.find((c) => c.id === clipId)
        if (!clip) return
        const playbackDuration = getAudioClipPlaybackDuration(clip)
        const start = clip.timelineStart
        const end = start + playbackDuration
        if (currentTime > start && currentTime < end) {
          e.preventDefault()
          const result = dispatch(
            new SplitAudioClipCommand({ slideId: slide.id, clipId, atTime: currentTime }),
          )
          if (!result.ok) useNotificationStore.getState().notify(result.error.message)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [slide.id, selectedClipIds, dispatch, currentTime, slide.audio.clips])

  const handleSplitClick = () => {
    if (selectedClipIds.size !== 1) {
      useNotificationStore.getState().notify('Select a single clip to split at playhead')
      return
    }
    const clipId = Array.from(selectedClipIds)[0]
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) return
    const playbackDuration = getAudioClipPlaybackDuration(clip)
    const start = clip.timelineStart
    const end = start + playbackDuration
    if (currentTime <= start || currentTime >= end) {
      useNotificationStore.getState().notify('Playhead must be inside the selected clip')
      return
    }
    const result = dispatch(
      new SplitAudioClipCommand({ slideId: slide.id, clipId, atTime: currentTime }),
    )
    if (!result.ok) useNotificationStore.getState().notify(result.error.message)
  }

  const handleDeleteSelected = () => {
    for (const clipId of Array.from(selectedClipIds)) {
      const result = dispatch(new DeleteAudioClipCommand({ slideId: slide.id, clipId }))
      if (!result.ok) useNotificationStore.getState().notify(result.error.message)
    }
    useAudioClipSelectionStore.getState().clear()
  }

  const handleDuplicateSelected = () => {
    for (const clipId of Array.from(selectedClipIds)) {
      const result = dispatch(new DuplicateAudioClipCommand({ slideId: slide.id, clipId }))
      if (!result.ok) useNotificationStore.getState().notify(result.error.message)
      else {
        const newId = (result.inverse as { newClipId: string }).newClipId
        useAudioClipSelectionStore.getState().select(newId)
      }
    }
  }

  const step = rulerTickStep(pps)
  const visibleEnd = scrollTime + viewportWidth / pps
  const ticks = rulerTickTimes(scrollTime, visibleEnd, step)
  const contentWidth = Math.max(viewportWidth, duration * pps + TRAILING_SCROLL_PADDING_PX)

  const clips = slide.audio.clips
  const prompterParts = slide.prompter?.parts ?? []
  const overlappingIds = getOverlappingClipIds(clips)

  return (
    <div
      className="audio-timeline-body"
      onPointerMove={recordPointerTime}
      data-testid="audio-timeline-body"
      tabIndex={0}
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
              <div style={{ position: 'absolute', right: 8, top: 2, display: 'flex', gap: 4 }}>
                <button
                  data-testid="audio-split-btn"
                  onClick={handleSplitClick}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                >
                  Split at Playhead
                </button>
                <button
                  data-testid="audio-duplicate-btn"
                  onClick={handleDuplicateSelected}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                >
                  Duplicate (Cmd+D)
                </button>
                <button
                  data-testid="audio-delete-btn"
                  onClick={handleDeleteSelected}
                  style={{ fontSize: 10, padding: '2px 6px' }}
                >
                  Delete
                </button>
              </div>
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
                      <small
                        style={{ marginLeft: 4, fontSize: 9, color: 'var(--color-text-muted)' }}
                      >
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
                  const laneClips = clips
                    .filter((c) => c.trackId === trackId)
                    .slice()
                    .sort((a, b) => a.timelineStart - b.timelineStart)
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
                          laneClips.map((clip, idx) => {
                            const isMovePreview = movePreview?.clipId === clip.id
                            const effectiveTrack = isMovePreview
                              ? movePreview.trackId
                              : clip.trackId
                            // if move preview changed track, only show in target lane; skip rendering in original lane when moved
                            if (isMovePreview && effectiveTrack !== trackId) return null
                            const displayStart = isMovePreview
                              ? movePreview.timelineStart
                              : clip.timelineStart
                            // trim preview overrides source bounds
                            const isTrimPreview = trimPreview?.clipId === clip.id
                            const displaySourceStart = isTrimPreview
                              ? trimPreview.sourceStart
                              : clip.sourceStart
                            const displaySourceEnd = isTrimPreview
                              ? trimPreview.sourceEnd
                              : clip.sourceEnd
                            const playbackDuration =
                              (displaySourceEnd - displaySourceStart) / (clip.playbackRate || 1)
                            const clipEnd = displayStart + playbackDuration
                            const isOverflow = clipEnd > duration + 1e-9
                            const visibleDuration = isOverflow
                              ? Math.max(0, duration - displayStart)
                              : playbackDuration
                            const width = isTrimPreview ? trimPreview.width : visibleDuration * pps
                            const left = isTrimPreview ? trimPreview.left : displayStart * pps
                            const isSelected = selectedClipIds.has(clip.id)
                            const isOverlapping = overlappingIds.has(clip.id)
                            const zIndex = idx + 1 // later clip on top within lane; no auto crossfade
                            return (
                              <div
                                key={clip.id}
                                className={`audio-clip audio-clip--${trackId}${isOverflow ? ' audio-clip--overflow' : ''}${isSelected ? ' audio-clip--selected' : ''}${isOverlapping ? ' audio-clip--overlap' : ''}`}
                                data-testid="audio-clip"
                                data-clip-id={clip.id}
                                data-track={trackId}
                                title={
                                  isOverflow
                                    ? 'clipped-with-overflow past slide.duration'
                                    : undefined
                                }
                                onClick={(e) => handleClipPointerDownSelect(e, clip.id)}
                                onPointerDown={(e) => onClipMovePointerDown(e, clip.id)}
                                style={{
                                  position: 'absolute',
                                  top: 8,
                                  height: 40,
                                  left,
                                  width,
                                  background:
                                    trackId === 'voice'
                                      ? 'var(--color-accent)'
                                      : trackId === 'sfx'
                                        ? '#2e9a6a'
                                        : '#e67e22',
                                  border: isSelected
                                    ? '2px solid #fff'
                                    : '1px solid var(--color-border)',
                                  borderRadius: 6,
                                  display: 'flex',
                                  alignItems: 'center',
                                  padding: '0 8px',
                                  fontSize: 11,
                                  overflow: 'hidden',
                                  whiteSpace: 'nowrap',
                                  borderRight: isOverflow ? '3px solid #ff4d4d' : undefined,
                                  opacity: clip.muted ? 0.5 : 1,
                                  zIndex,
                                  cursor: 'grab',
                                }}
                              >
                                <span
                                  className="audio-clip__label"
                                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}
                                >
                                  {clip.assetId}
                                </span>
                                {isOverlapping && (
                                  <span
                                    data-testid="audio-overlap-badge"
                                    className="audio-clip__overlap-badge"
                                    style={{
                                      fontSize: 8,
                                      marginLeft: 4,
                                      background: '#ff4d4d',
                                      color: '#fff',
                                      borderRadius: 4,
                                      padding: '1px 4px',
                                    }}
                                  >
                                    overlap
                                  </span>
                                )}
                                {clip.fadeIn !== undefined || clip.fadeOut !== undefined ? (
                                  <span style={{ fontSize: 8, marginLeft: 4, opacity: 0.8 }}>
                                    fade {clip.fadeIn ?? 0}/{clip.fadeOut ?? 0}
                                  </span>
                                ) : null}
                                {isOverflow && (
                                  <span style={{ fontSize: 9, marginLeft: 4 }}>⤳ overflow</span>
                                )}
                                <div
                                  className="audio-clip__handle audio-clip__handle--left"
                                  data-testid="audio-clip-handle-left"
                                  onPointerDown={(e) => onTrimPointerDown(e, clip.id, 'left')}
                                  style={{
                                    position: 'absolute',
                                    left: 0,
                                    top: 0,
                                    bottom: 0,
                                    width: 8,
                                    cursor: 'ew-resize',
                                    background: 'rgba(255,255,255,0.2)',
                                  }}
                                />
                                <div
                                  className="audio-clip__handle audio-clip__handle--right"
                                  data-testid="audio-clip-handle-right"
                                  onPointerDown={(e) => onTrimPointerDown(e, clip.id, 'right')}
                                  style={{
                                    position: 'absolute',
                                    right: 0,
                                    top: 0,
                                    bottom: 0,
                                    width: 8,
                                    cursor: 'ew-resize',
                                    background: 'rgba(255,255,255,0.2)',
                                  }}
                                />
                                {/* Waveform clipped preview during trim: faint overlay */}
                                {isTrimPreview && (
                                  <div
                                    data-testid="audio-waveform-preview"
                                    style={{
                                      position: 'absolute',
                                      inset: 0,
                                      background:
                                        'repeating-linear-gradient(90deg, rgba(255,255,255,0.15) 0 4px, transparent 4px 8px)',
                                      pointerEvents: 'none',
                                      borderRadius: 6,
                                    }}
                                  />
                                )}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )
                })}
                {/* Move preview ghost when moving across lanes: render overlay ghost */}
                {movePreview &&
                  (() => {
                    const clip = clips.find((c) => c.id === movePreview.clipId)
                    if (!clip) return null
                    const playbackDuration = getAudioClipPlaybackDuration(clip)
                    const width = playbackDuration * pps
                    const top =
                      movePreview.trackId === 'voice' ? 8 : movePreview.trackId === 'sfx' ? 64 : 120
                    return (
                      <div
                        data-testid="audio-move-preview"
                        style={{
                          position: 'absolute',
                          top,
                          left: movePreview.timelineStart * pps,
                          width,
                          height: 40,
                          background: 'rgba(124,92,255,0.45)',
                          border: '1px dashed #fff',
                          borderRadius: 6,
                          pointerEvents: 'none',
                          zIndex: 20,
                        }}
                      />
                    )
                  })()}
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
