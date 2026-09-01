import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  ImportPrompterCommand,
  MoveAudioClipCommand,
  MovePrompterPartCommand,
  SplitAudioClipCommand,
  TrimAudioClipCommand,
  UpdatePrompterPartCommand,
  UpdatePrompterPartWithShiftCommand,
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
import { useAudioPlaybackStore } from '../../stores/audioPlaybackStore'
import { getActivePrompterPartId } from '../../engine/audioSync'
import { WaveformCanvas } from '../audio/WaveformCanvas'
import { slicePeaksForClip } from '../../audio/waveform'
import { assetsApi } from '../../api'
import { RecordModal } from '../audio/RecordModal'
import { TtsModal } from '../audio/TtsModal'
import { WordLevelTtsModal } from '../audio/WordLevelTtsModal'
import { getPrompterRecordingShortcut } from '../../engine/prompter'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { captureAudioSnapshot } from '../../app/assetSnapshot'

const PROMPTER_STRIP_HEIGHT = 42
const AUDIO_LANE_HEIGHT = 56

/** Exported for tests: compute nudge delta from rulerTickStep */
// eslint-disable-next-line react-refresh/only-export-components
export function audioNudgeDelta(step: number, shift: boolean): number {
  return shift ? step * 10 : step
}

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
  const playbackStatus = usePlaybackController((state) => state.status)
  const pps = pixelsPerSecond(zoomLevel)

  const { engine, dispatch } = useEngine()
  const [, setTick] = useState(0)
  useEffect(() => {
    const unsub = engine.subscribe(() => setTick((t) => t + 1))
    return unsub
  }, [engine])

  const selectedClipIds = useAudioClipSelectionStore((s) => s.selectedClipIds)
  const activeClipId = useAudioClipSelectionStore((s) => s.activeClipId)
  const marqueeRect = useAudioClipSelectionStore((s) => s.marquee)
  const mutedTracks = useAudioPlaybackStore((s) => s.mutedTracks)
  const soloTracks = useAudioPlaybackStore((s) => s.soloTracks)

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
      // Check global audio definition
      const def = useAssetLibraryStore.getState().definitions.find((d) => d.id === assetId)
      if (def) {
        const meta = def.metadata as Record<string, unknown> | undefined
        if (meta && typeof meta.duration === 'number' && Number.isFinite(meta.duration)) return meta.duration as number
        if (def.mimeType?.startsWith('audio/') || def.category === 'audio') {
          // fallback to duration from metadata or 1
          if (typeof (def as unknown as { duration?: unknown }).duration === 'number') return (def as unknown as { duration: number }).duration
        }
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

  // Prompter move/trim state (like audio clips: draggable, resizable)
  const prompterMoveRef = useRef<{ partId: string; startX: number; startTime: number } | null>(null)
  const [prompterMovePreview, setPrompterMovePreview] = useState<{ partId: string; startTime: number } | null>(null)
  const [prompterTrimPreview, setPrompterTrimPreview] = useState<{
    partId: string
    duration: number
    left: number
    width: number
  } | null>(null)

  // Word-level selection for TTS replacement (Spec 15.10)
  const [wordSelection, setWordSelection] = useState<{ partId: string; start: number; end: number } | null>(null)
  const [wordLevelTts, setWordLevelTts] = useState<{ partId: string; start: number; end: number; text: string } | null>(null)

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

  const handleAudioDrop = async (event: React.DragEvent) => {
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
    // Resolve duration from either embedded (recorded/project) or global (backend) asset
    let assetDuration = 1
    let isValidAudio = false
    const embedded = engine.getEmbeddedAsset(assetId)
    if (embedded && embedded.mimeType.startsWith('audio/')) {
      isValidAudio = true
      const rawDuration = (embedded.metadata as Record<string, unknown>)?.duration
      assetDuration = typeof rawDuration === 'number' && Number.isFinite(rawDuration) ? rawDuration : 1
    } else {
      const def = useAssetLibraryStore.getState().definitions.find((d) => d.id === assetId)
      if (def) {
        const isAudioDef = def.mimeType?.startsWith('audio/') || def.category === 'audio' || /\.(wav|mp3|mpeg|ogg|webm)$/i.test(def.original_filename)
        if (isAudioDef) {
          isValidAudio = true
          const meta = def.metadata as Record<string, unknown> | undefined
          const dur = meta && typeof meta.duration === 'number' ? (meta.duration as number) : null
          assetDuration = dur !== null && Number.isFinite(dur) ? dur : 1
        }
      }
    }
    if (!isValidAudio) {
      useNotificationStore.getState().notify('Invalid audio asset')
      setGhost(null)
      return
    }
    // For global assets, ensure embedded snapshot exists before creating clip (portability)
    if (!embedded) {
      try {
        await captureAudioSnapshot(engine as unknown as import('../../engine').EnginePublic, assetId)
      } catch {
        // snapshot is best-effort; clip can still reference global id
      }
    }
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
    } else {
      // For global assets, capture snapshot so .lesson remains self-contained
      if (!embedded) {
        void captureAudioSnapshot(engine as unknown as import('../../engine').EnginePublic, assetId)
      }
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

  // Ordered ids for range selection and roving tabindex
  const orderedClipIds = useMemo(() => {
    const clips = [...slide.audio.clips].sort((a, b) => a.timelineStart - b.timelineStart)
    return clips.map((c) => c.id)
  }, [slide.audio.clips])
  const prompterPartIds = useMemo(
    () => (slide.prompter?.parts ?? []).map((p) => p.id),
    [slide.prompter],
  )
  const orderedFocusableIds = useMemo(
    () => [...prompterPartIds, ...orderedClipIds],
    [prompterPartIds, orderedClipIds],
  )

  const [focusedId, setFocusedId] = useState<string | null>(() => orderedFocusableIds[0] ?? null)
  useEffect(() => {
    if (focusedId && !orderedFocusableIds.includes(focusedId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFocusedId(orderedFocusableIds[0] ?? null)
    } else if (!focusedId && orderedFocusableIds.length > 0) {
      setFocusedId(orderedFocusableIds[0])
    }
  }, [focusedId, orderedFocusableIds])

  // Selection gesture handlers
  const handleClipPointerDownSelect = (e: React.MouseEvent, clipId: string) => {
    if ((e.target as HTMLElement).closest('.audio-clip__handle')) return
    const isMulti = e.metaKey || e.ctrlKey
    const isRange = e.shiftKey
    const store = useAudioClipSelectionStore.getState()
    if (isRange) {
      store.selectRange(clipId, orderedClipIds)
    } else if (isMulti) {
      store.toggle(clipId)
    } else {
      store.select(clipId)
    }
    setFocusedId(clipId)
  }

  const handlePrompterPointerDownSelect = (e: React.MouseEvent, partId: string) => {
    // Prompter parts are focusable but not part of clip selection; focus only
    e.preventDefault()
    setFocusedId(partId)
  }

  // Marquee selection
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null)
  const marqueeActiveRef = useRef(false)
  const [localMarqueeRect, setLocalMarqueeRect] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)

  const handleTimeAreaPointerDown = useCallback(
    (event: React.PointerEvent) => {
      const target = event.target as HTMLElement
      if (
        target.closest('[data-clip-id]') ||
        target.closest('[data-prompter-id]') ||
        target.closest('.timeline-ruler') ||
        target.closest('.audio-clip__handle')
      ) {
        return
      }
      if (event.button !== 0) return
      const rect = timeAreaRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      marqueeStartRef.current = { x, y }
      marqueeActiveRef.current = false
      setLocalMarqueeRect({ x, y, width: 0, height: 0 })
      useAudioClipSelectionStore.getState().marqueeStart(x, y)

      const onMove = (ev: PointerEvent) => {
        if (!marqueeStartRef.current) return
        const cx = ev.clientX - rect.left
        const cy = ev.clientY - rect.top
        const dx = cx - marqueeStartRef.current.x
        const dy = cy - marqueeStartRef.current.y
        if (!marqueeActiveRef.current && Math.hypot(dx, dy) < 4) return
        marqueeActiveRef.current = true
        const width = Math.abs(dx)
        const height = Math.abs(dy)
        const left = Math.min(marqueeStartRef.current.x, cx)
        const top = Math.min(marqueeStartRef.current.y, cy)
        setLocalMarqueeRect({ x: left, y: top, width, height })
        useAudioClipSelectionStore.getState().marqueeUpdate(width, height)
      }

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        if (marqueeActiveRef.current) {
          const markers = document.querySelectorAll<HTMLElement>('[data-clip-id]')
          const intersecting: string[] = []
          const mLeft = Math.min(marqueeStartRef.current!.x, ev.clientX - rect.left)
          const mTop = Math.min(marqueeStartRef.current!.y, ev.clientY - rect.top)
          const mRight = mLeft + Math.abs(ev.clientX - rect.left - marqueeStartRef.current!.x)
          const mBottom = mTop + Math.abs(ev.clientY - rect.top - marqueeStartRef.current!.y)
          for (const marker of markers) {
            const markerRect = marker.getBoundingClientRect()
            const relLeft = markerRect.left - rect.left
            const relTop = markerRect.top - rect.top
            const relRight = relLeft + markerRect.width
            const relBottom = relTop + markerRect.height
            if (relLeft < mRight && relRight > mLeft && relTop < mBottom && relBottom > mTop) {
              const id = marker.dataset.clipId
              if (id) intersecting.push(id)
            }
          }
          useAudioClipSelectionStore.getState().marqueeEnd(intersecting)
        } else {
          // Click on empty clears selection
          if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
            useAudioClipSelectionStore.getState().clear()
            setWordSelection(null)
          }
          useAudioClipSelectionStore.getState().marqueeEnd([])
        }
        marqueeStartRef.current = null
        marqueeActiveRef.current = false
        setLocalMarqueeRect(null)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [timeAreaRef],
  )

  // Move handling
  const onClipMovePointerDown = (e: React.PointerEvent, clipId: string) => {
    if ((e.target as HTMLElement).closest('.audio-clip__handle')) return
    e.preventDefault()
    const clip = slide.audio.clips.find((c) => c.id === clipId)
    if (!clip) return
    if (!selectedClipIds.has(clipId) && !(e.ctrlKey || e.metaKey || e.shiftKey)) {
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
      const dx = ev.clientX - moveRef.current.startX
      const dt = dx / pps
      const raw = moveRef.current.startTime + dt
      const snapped = computeSnappedTime(Math.max(0, raw))
      const finalTrack = trackFromClientY(ev.clientY) ?? moveRef.current.startTrack
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
      if (side === 'left') {
        const newSourceStart = Math.max(0, startSourceStart + dtPlayback * playbackRate)
        const clamped = Math.min(newSourceStart, startSourceEnd - 0.01)
        const newSourceEnd = startSourceEnd
        const newWidth = ((newSourceEnd - clamped) / playbackRate) * pps
        const clipLeft = slide.audio.clips.find((c) => c.id === clipId)?.timelineStart ?? 0
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

  // Prompter move (reorder, gap-free) — like audio clip move
  const onPrompterMovePointerDown = (e: React.PointerEvent, partId: string) => {
    if (e.button !== 0) return
    const targetEl = e.target as HTMLElement
    if (targetEl.closest('[data-prompter-handle]')) return
    if (targetEl.closest('button')) return
    if (targetEl.closest('[data-testid^="record-btn"]')) return
    e.preventDefault()
    e.stopPropagation()
    const part = slide.prompter?.parts.find((p) => p.id === partId)
    if (!part) return
    setFocusedId(partId)
    prompterMoveRef.current = { partId, startX: e.clientX, startTime: part.startTime }
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      if (!prompterMoveRef.current) return
      const dx = ev.clientX - prompterMoveRef.current.startX
      const dt = dx / pps
      const raw = prompterMoveRef.current.startTime + dt
      const snapped = computeSnappedTime(Math.max(0, raw))
      setPrompterMovePreview({ partId, startTime: snapped })
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (!prompterMoveRef.current) return
      const dx = ev.clientX - prompterMoveRef.current.startX
      const dt = dx / pps
      const raw = prompterMoveRef.current.startTime + dt
      const snapped = computeSnappedTime(Math.max(0, raw))
      const part = slide.prompter?.parts.find((p) => p.id === partId)
      if (part && Math.abs(snapped - part.startTime) > 1e-6) {
        const result = dispatch(new MovePrompterPartCommand({ slideId: slide.id, partId, newStartTime: snapped }))
        if (!result.ok) useNotificationStore.getState().notify(result.error.message)
      }
      setPrompterMovePreview(null)
      prompterMoveRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Prompter trim (make shorter/longer) — right handle changes duration, left handle also changes duration
  const onPrompterTrimPointerDown = (e: React.PointerEvent, partId: string, side: 'left' | 'right') => {
    e.preventDefault()
    e.stopPropagation()
    const part = slide.prompter?.parts.find((p) => p.id === partId)
    if (!part) return
    const startDuration = part.duration
    const startX = e.clientX
    const partStart = part.startTime
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      const dt = dx / pps
      let newDuration: number
      let newLeft = partStart * pps
      if (side === 'right') {
        newDuration = Math.max(0.2, startDuration + dt)
        const width = newDuration * pps
        setPrompterTrimPreview({ partId, duration: newDuration, left: newLeft, width })
      } else {
        newDuration = Math.max(0.2, startDuration - dt)
        newLeft = (partStart + (startDuration - newDuration)) * pps
        const width = newDuration * pps
        setPrompterTrimPreview({ partId, duration: newDuration, left: newLeft, width })
      }
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const dx = ev.clientX - startX
      const dt = dx / pps
      if (side === 'right') {
        const newDuration = Math.max(0.2, startDuration + dt)
        if (Math.abs(newDuration - startDuration) > 1e-6) {
          const shift = ev.shiftKey
          const Cmd = shift ? UpdatePrompterPartWithShiftCommand : UpdatePrompterPartCommand
          const result = dispatch(new Cmd({ slideId: slide.id, partId, duration: newDuration, ...(shift ? { shiftDownstream: true } : {}) } as never))
          if (!result.ok) useNotificationStore.getState().notify(result.error.message)
        }
      } else {
        const newDuration = Math.max(0.2, startDuration - dt)
        const newStart = Math.max(0, partStart + (startDuration - newDuration))
        // Left handle: move start and change duration, keep end fixed
        if (Math.abs(newDuration - startDuration) > 1e-6 || Math.abs(newStart - partStart) > 1e-6) {
          const moveRes = dispatch(new MovePrompterPartCommand({ slideId: slide.id, partId, newStartTime: newStart }))
          if (!moveRes.ok) useNotificationStore.getState().notify(moveRes.error.message)
          else {
            const durRes = dispatch(new UpdatePrompterPartCommand({ slideId: slide.id, partId, duration: newDuration }))
            if (!durRes.ok) useNotificationStore.getState().notify(durRes.error.message)
          }
        }
      }
      setPrompterTrimPreview(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Keyboard shortcuts for duplicate/delete/split + nudging + roving
  const nudgeSelected = useCallback(
    (delta: number, opts?: { home?: boolean; end?: boolean; vertical?: number }) => {
      if (selectedClipIds.size === 0) return
      const step = rulerTickStep(pps)
      void step
      for (const clipId of Array.from(selectedClipIds)) {
        const clip = slide.audio.clips.find((c) => c.id === clipId)
        if (!clip) continue
        if (opts?.home) {
          if (clip.timelineStart !== 0) {
            dispatch(new MoveAudioClipCommand({ slideId: slide.id, clipId, timelineStart: 0 }))
          }
          continue
        }
        if (opts?.end) {
          const playbackDuration = getAudioClipPlaybackDuration(clip)
          const target = Math.max(0, duration - playbackDuration)
          if (Math.abs(clip.timelineStart - target) > 1e-6) {
            dispatch(new MoveAudioClipCommand({ slideId: slide.id, clipId, timelineStart: target }))
          }
          continue
        }
        if (opts?.vertical !== undefined) {
          // Vertical nudge adjusts duration via trim (sourceEnd) – simple: expand/shrink by delta
          const newSourceEnd = clip.sourceEnd + opts.vertical * (clip.playbackRate || 1)
          const minEnd = clip.sourceStart + 0.01
          const clampedEnd = Math.max(minEnd, newSourceEnd)
          if (Math.abs(clampedEnd - clip.sourceEnd) > 1e-6) {
            dispatch(new TrimAudioClipCommand({ slideId: slide.id, clipId, sourceEnd: clampedEnd }))
          }
          continue
        }
        const nextStart = Math.max(0, clip.timelineStart + delta)
        const snapped = computeSnappedTime(nextStart)
        // clamp to duration? allow overflow but Home/End handles; just dispatch move
        if (Math.abs(snapped - clip.timelineStart) > 1e-9) {
          dispatch(new MoveAudioClipCommand({ slideId: slide.id, clipId, timelineStart: snapped }))
        }
      }
    },
    [selectedClipIds, slide.audio.clips, slide.id, duration, pps, dispatch, computeSnappedTime],
  )

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const audioBody = document.querySelector('[data-testid="audio-timeline-body"]')
      const active = document.activeElement
      const isInsideAudio = Boolean(
        active?.closest('[data-testid="audio-timeline-body"]') ||
        audioBody?.contains(active) ||
        active?.hasAttribute('data-clip-id') ||
        active?.hasAttribute('data-prompter-id') ||
        audioBody?.contains(active),
      )
      const inAudioTab = Boolean(document.querySelector('[data-testid="audio-timeline-body"]'))
      // Only handle when audio tab is visible; if not inside, still handle global playback/zoom if audio tab focused
      if (!inAudioTab && !isInsideAudio) return

      // Avoid when editing input
      if (
        (e.target as HTMLElement)?.tagName === 'INPUT' ||
        (e.target as HTMLElement)?.tagName === 'TEXTAREA' ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return
      }

      // Ctrl/Cmd+D duplicate at +0.5s
      if (
        (e.key === 'd' || e.key === 'D') &&
        (e.metaKey || e.ctrlKey) &&
        selectedClipIds.size > 0
      ) {
        e.preventDefault()
        const newIds: string[] = []
        for (const clipId of Array.from(selectedClipIds)) {
          const result = dispatch(new DuplicateAudioClipCommand({ slideId: slide.id, clipId }))
          if (!result.ok) useNotificationStore.getState().notify(result.error.message)
          else {
            const newId = (result.inverse as { newClipId: string }).newClipId
            newIds.push(newId)
          }
        }
        if (newIds.length === 1) {
          useAudioClipSelectionStore.getState().select(newIds[0])
        } else if (newIds.length > 1) {
          useAudioClipSelectionStore.setState({
            selectedClipIds: new Set(newIds),
            activeClipId: newIds[newIds.length - 1],
          })
        }
        return
      }

      // Delete / Backspace
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedClipIds.size > 0) {
        e.preventDefault()
        for (const clipId of Array.from(selectedClipIds)) {
          const result = dispatch(new DeleteAudioClipCommand({ slideId: slide.id, clipId }))
          if (!result.ok) useNotificationStore.getState().notify(result.error.message)
        }
        useAudioClipSelectionStore.getState().clear()
        return
      }

      // Home / End
      if (e.key === 'Home' && selectedClipIds.size > 0) {
        e.preventDefault()
        nudgeSelected(0, { home: true })
        return
      }
      if (e.key === 'End' && selectedClipIds.size > 0) {
        e.preventDefault()
        nudgeSelected(0, { end: true })
        return
      }

      // Arrow nudges
      const step = rulerTickStep(pps)
      const delta = audioNudgeDelta(step, e.shiftKey)
      if (e.key === 'ArrowLeft' && selectedClipIds.size > 0) {
        // Check if roving should move focus instead? Left/Right for nudge, Up/Down for roving
        // Prioritize nudge when clips selected
        e.preventDefault()
        nudgeSelected(-delta)
        return
      }
      if (e.key === 'ArrowRight' && selectedClipIds.size > 0) {
        e.preventDefault()
        nudgeSelected(delta)
        return
      }
      if (e.key === 'ArrowUp' && selectedClipIds.size > 0) {
        // Interpret Up as increase duration, Down decrease
        e.preventDefault()
        nudgeSelected(0, { vertical: delta })
        return
      }
      if (e.key === 'ArrowDown' && selectedClipIds.size > 0) {
        e.preventDefault()
        nudgeSelected(0, { vertical: -delta })
        return
      }

      // Roving tabindex navigation when focus is inside prompter/clip
      if (
        (e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight') &&
        orderedFocusableIds.length > 0
      ) {
        // If no selection, allow roving to move focus via Up/Down
        if (selectedClipIds.size === 0 && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          const currentIndex = focusedId ? orderedFocusableIds.indexOf(focusedId) : -1
          let nextIndex = currentIndex
          if (e.key === 'ArrowDown') {
            nextIndex = Math.min(orderedFocusableIds.length - 1, currentIndex + 1)
          } else {
            nextIndex = Math.max(0, currentIndex - 1)
          }
          if (nextIndex !== currentIndex) {
            e.preventDefault()
            const nextId = orderedFocusableIds[nextIndex]
            setFocusedId(nextId)
            // focus element
            const el = document.querySelector<HTMLElement>(
              `[data-clip-id="${nextId}"], [data-prompter-id="${nextId}"]`,
            )
            el?.focus()
          }
          return
        }
      }

      // Play/pause/frame-step and zoom/scroll shortcuts (shared stores)
      // Space for play/pause
      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        // Only if audio body has focus or contains active element
        if (isInsideAudio) {
          e.preventDefault()
          const ctrl = usePlaybackController.getState()
          if (ctrl.status === 'playing') ctrl.pause()
          else ctrl.play(slide.id, duration)
          return
        }
      }
      // Frame step: '.' and ',' or ArrowLeft/Right when paused and no selection? Use ',' and '.'
      if ((e.key === ',' || e.key === '<') && playbackStatus !== 'playing' && isInsideAudio) {
        e.preventDefault()
        usePlaybackController.getState().stepFrame('backward', slide.id, duration)
        return
      }
      if ((e.key === '.' || e.key === '>') && playbackStatus !== 'playing' && isInsideAudio) {
        e.preventDefault()
        usePlaybackController.getState().stepFrame('forward', slide.id, duration)
        return
      }
      // Zoom: '+' '=' and '-' '_'
      if ((e.key === '+' || e.key === '=') && (e.ctrlKey || e.metaKey) && isInsideAudio) {
        e.preventDefault()
        const state = useTimelineViewStore.getState()
        const p = pixelsPerSecond(state.zoomLevel)
        const anchor = state.scrollTime + viewportWidth / 2 / p
        state.zoomIn(anchor, viewportWidth, duration)
        return
      }
      if ((e.key === '-' || e.key === '_') && (e.ctrlKey || e.metaKey) && isInsideAudio) {
        e.preventDefault()
        const state = useTimelineViewStore.getState()
        const p = pixelsPerSecond(state.zoomLevel)
        const anchor = state.scrollTime + viewportWidth / 2 / p
        state.zoomOut(anchor, viewportWidth, duration)
        return
      }
      // Alternative zoom without ctrl: '+' and '-'
      if (
        e.key === '+' &&
        !e.ctrlKey &&
        !e.metaKey &&
        isInsideAudio &&
        selectedClipIds.size === 0
      ) {
        e.preventDefault()
        const state = useTimelineViewStore.getState()
        const p = pixelsPerSecond(state.zoomLevel)
        const anchor = state.scrollTime + viewportWidth / 2 / p
        state.zoomIn(anchor, viewportWidth, duration)
        return
      }
      if (
        e.key === '-' &&
        !e.ctrlKey &&
        !e.metaKey &&
        isInsideAudio &&
        selectedClipIds.size === 0
      ) {
        e.preventDefault()
        const state = useTimelineViewStore.getState()
        const p = pixelsPerSecond(state.zoomLevel)
        const anchor = state.scrollTime + viewportWidth / 2 / p
        state.zoomOut(anchor, viewportWidth, duration)
        return
      }
      // Scroll via horizontal arrows when no selection and not nudging? Use Shift+Arrow to scroll?
      if (e.key === 'ArrowLeft' && selectedClipIds.size === 0 && isInsideAudio) {
        // scroll left by step
        e.preventDefault()
        const state = useTimelineViewStore.getState()
        const target = Math.max(0, state.scrollTime - step)
        state.setScrollTime(target, viewportWidth, duration)
        return
      }
      if (e.key === 'ArrowRight' && selectedClipIds.size === 0 && isInsideAudio) {
        e.preventDefault()
        const state = useTimelineViewStore.getState()
        const target = state.scrollTime + step
        state.setScrollTime(target, viewportWidth, duration)
        return
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
  }, [
    slide.id,
    selectedClipIds,
    dispatch,
    currentTime,
    slide.audio.clips,
    pps,
    nudgeSelected,
    duration,
    viewportWidth,
    playbackStatus,
    orderedFocusableIds,
    focusedId,
  ])

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
    const newIds: string[] = []
    for (const clipId of Array.from(selectedClipIds)) {
      const result = dispatch(new DuplicateAudioClipCommand({ slideId: slide.id, clipId }))
      if (!result.ok) useNotificationStore.getState().notify(result.error.message)
      else {
        const newId = (result.inverse as { newClipId: string }).newClipId
        newIds.push(newId)
      }
    }
    if (newIds.length === 1) useAudioClipSelectionStore.getState().select(newIds[0])
    else if (newIds.length > 1)
      useAudioClipSelectionStore.setState({
        selectedClipIds: new Set(newIds),
        activeClipId: newIds[newIds.length - 1],
      })
  }

  const step = rulerTickStep(pps)
  const visibleEnd = scrollTime + viewportWidth / pps
  const ticks = rulerTickTimes(scrollTime, visibleEnd, step)
  const contentWidth = Math.max(viewportWidth, duration * pps + TRAILING_SCROLL_PADDING_PX)

  const clips = slide.audio.clips
  const prompterParts = useMemo(() => slide.prompter?.parts ?? [], [slide.prompter])
  const overlappingIds = getOverlappingClipIds(clips)
  const [recordPartId, setRecordPartId] = useState<string | null>(null)
  const recordPart = useMemo(() => prompterParts.find((p) => p.id === recordPartId) ?? null, [prompterParts, recordPartId])
  const [ttsPartId, setTtsPartId] = useState<string | null>(null)
  const ttsPart = useMemo(() => prompterParts.find((p) => p.id === ttsPartId) ?? null, [prompterParts, ttsPartId])
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('Hello, world')
  const selectedWordPart = useMemo(() => (wordSelection ? prompterParts.find((p) => p.id === wordSelection.partId) ?? null : null), [prompterParts, wordSelection])
  const selectedWordText = useMemo(() => {
    if (!wordSelection || !selectedWordPart) return ''
    const words = selectedWordPart.text.match(/\S+/g) ?? []
    const start = Math.min(wordSelection.start, wordSelection.end)
    const end = Math.max(wordSelection.start, wordSelection.end)
    return words.slice(start, end + 1).join(' ')
  }, [wordSelection, selectedWordPart])

  // Recording shortcut handler (when prompter part focused and no modal open)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (recordPartId !== null) return
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const settings = engine.project?.settings ?? {}
      const shortcut = getPrompterRecordingShortcut(settings)
      if (e.key.toLowerCase() !== shortcut) return
      // Only when focused is a prompter part
      if (focusedId && prompterPartIds.includes(focusedId)) {
        e.preventDefault()
        setRecordPartId(focusedId)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [engine, focusedId, prompterPartIds, recordPartId])
  const displayMarquee =
    localMarqueeRect ??
    (marqueeRect
      ? { x: marqueeRect.x, y: marqueeRect.y, width: marqueeRect.width, height: marqueeRect.height }
      : null)

  return (
    <div
      className="audio-timeline-body"
      onPointerMove={recordPointerTime}
      data-testid="audio-timeline-body"
      tabIndex={0}
      role="region"
      aria-label="Audio timeline"
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
            style={{
              height: PROMPTER_STRIP_HEIGHT,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 4px',
              fontSize: 10,
              color: 'var(--color-text-muted)',
              borderBottom: '1px solid var(--color-border)',
            }}
          >
            <span>Prompter</span>
            <button
              data-testid="prompter-import-btn"
              onClick={() => setShowImport(true)}
              style={{
                fontSize: 8,
                padding: '2px 4px',
                borderRadius: 3,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                cursor: 'pointer',
              }}
            >
              Import
            </button>
          </li>
          {AUDIO_TRACK_IDS.map((trackId) => {
            const isMuted = mutedTracks.has(trackId)
            const isSolo = soloTracks.has(trackId)
            return (
              <li
                key={trackId}
                className="audio-tracks__label"
                style={{
                  height: AUDIO_LANE_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid var(--color-border)',
                  fontSize: 11,
                  padding: '0 4px',
                }}
              >
                <span>{trackId === 'voice' ? 'Voice' : trackId === 'sfx' ? 'SFX' : 'Music'}</span>
                <span style={{ display: 'flex', gap: 2 }}>
                  <button
                    data-testid={`audio-mute-${trackId}`}
                    aria-pressed={isMuted}
                    aria-label={`Mute ${trackId}`}
                    onClick={() => useAudioPlaybackStore.getState().toggleMute(trackId)}
                    style={{
                      fontSize: 9,
                      padding: '2px 4px',
                      background: isMuted ? '#ff4d4d' : 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                  >
                    M
                  </button>
                  <button
                    data-testid={`audio-solo-${trackId}`}
                    aria-pressed={isSolo}
                    aria-label={`Solo ${trackId}`}
                    onClick={() => useAudioPlaybackStore.getState().toggleSolo(trackId)}
                    style={{
                      fontSize: 9,
                      padding: '2px 4px',
                      background: isSolo ? '#7c5cff' : 'var(--color-bg)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 4,
                      cursor: 'pointer',
                      color: isSolo ? '#fff' : undefined,
                    }}
                  >
                    S
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      </div>
      <div
        className="timeline-scroller"
        data-testid="timeline-scroller"
        ref={scrollerRef}
        onScroll={handleScroll}
      >
        <div className="timeline-content" style={{ width: contentWidth }}>
          <div
            className="timeline-time-area"
            ref={timeAreaRef}
            onPointerDown={handleTimeAreaPointerDown}
          >
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
                  position: 'relative',
                  overflow: 'hidden',
                  borderBottom: '1px solid var(--color-border)',
                  background: 'var(--color-bg-panel)',
                }}
              >
                <div style={{ position: 'relative', width: contentWidth, height: '100%' }}>
                  {prompterParts.length === 0 ? (
                    <span
                      style={{
                        position: 'absolute',
                        left: 8,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        fontSize: 11,
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      No prompter parts — click Import
                    </span>
                  ) : (
                    (() => {
                      const activeId = getActivePrompterPartId(prompterParts, currentTime)
                      return prompterParts.map((part, idx) => {
                        const isFocused = focusedId === part.id
                        const isActive = activeId === part.id
                        const isSelected = false
                        const isMovePreview = prompterMovePreview?.partId === part.id
                        const isTrimPreview = prompterTrimPreview?.partId === part.id
                        const displayDuration = isTrimPreview ? prompterTrimPreview!.duration : part.duration
                        const displayLeft = isTrimPreview ? prompterTrimPreview!.left : isMovePreview ? prompterMovePreview!.startTime * pps : part.startTime * pps
                        const displayWidth = isTrimPreview ? prompterTrimPreview!.width : displayDuration * pps
                        return (
                          <div
                            key={part.id}
                            role="button"
                            tabIndex={isFocused ? 0 : -1}
                            data-testid="prompter-chip"
                            data-prompter-id={part.id}
                            data-start={part.startTime}
                            data-end={part.endTime}
                            aria-selected={isSelected}
                            onFocus={() => setFocusedId(part.id)}
                            onClick={(e) => handlePrompterPointerDownSelect(e, part.id)}
                            // eslint-disable-next-line react-hooks/refs
                            onPointerDown={(e) => onPrompterMovePointerDown(e, part.id)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              setFocusedId(part.id)
                              setRecordPartId(part.id)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                                e.preventDefault()
                                const next = orderedFocusableIds[idx + 1]
                                if (next) {
                                  setFocusedId(next)
                                  document
                                    .querySelector<HTMLElement>(
                                      `[data-clip-id="${next}"], [data-prompter-id="${next}"]`,
                                    )
                                    ?.focus()
                                }
                              }
                              if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                                e.preventDefault()
                                const prev = orderedFocusableIds[idx - 1]
                                if (prev) {
                                  setFocusedId(prev)
                                  document
                                    .querySelector<HTMLElement>(
                                      `[data-clip-id="${prev}"], [data-prompter-id="${prev}"]`,
                                    )
                                    ?.focus()
                                }
                              }
                            }}
                            className={`audio-prompter-chip${part.status === 'stale' ? ' audio-prompter-chip--stale' : ''}${isFocused ? ' audio-prompter-chip--focused' : ''}${isActive ? ' audio-prompter-chip--active' : ''}${part.segments ? ' audio-prompter-chip--segments' : ''}`}
                            data-active={isActive ? 'true' : 'false'}
                            style={{
                              position: 'absolute',
                              top: 4,
                              height: 34,
                              left: displayLeft,
                              width: Math.max(40, displayWidth),
                              padding: '4px 8px',
                              borderRadius: 12,
                              background: isActive
                                ? 'rgba(124,92,255,0.25)'
                                : isFocused
                                  ? 'var(--color-accent)'
                                  : 'var(--color-bg)',
                              border: isActive ? '1px solid #7c5cff' : '1px solid var(--color-border)',
                              fontSize: 11,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              outline: isFocused ? '2px solid #7c5cff' : undefined,
                              cursor: 'grab',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <span style={{ display: 'inline-flex', gap: 1, alignItems: 'center', flexWrap: 'nowrap', overflow: 'hidden' }}>
                              {(() => {
                                const tokens = part.text.split(/(\s+)/)
                                let wIdx = -1
                                return tokens.map((tok, ti) => {
                                  if (tok === '') return null
                                  if (/^\s+$/.test(tok)) {
                                    return (
                                      <span key={`ws-${ti}`} style={{ whiteSpace: 'pre' }}>
                                        {tok}
                                      </span>
                                    )
                                  }
                                  wIdx += 1
                                  const wi = wIdx
                                  const isSelected = wordSelection?.partId === part.id && wi >= Math.min(wordSelection.start, wordSelection.end) && wi <= Math.max(wordSelection.start, wordSelection.end)
                                  const isSegment = part.segments?.some((s) => s.text.trim() === tok.trim())
                                  return (
                                    <span
                                      key={`w-${wi}`}
                                      data-testid="prompter-word"
                                      data-word-index={wi}
                                      data-part-id={part.id}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        e.preventDefault()
                                        setFocusedId(part.id)
                                        if (wordSelection && wordSelection.partId === part.id && e.shiftKey) {
                                          const start = Math.min(wordSelection.start, wi)
                                          const end = Math.max(wordSelection.end, wi)
                                          setWordSelection({ partId: part.id, start, end })
                                        } else {
                                          setWordSelection({ partId: part.id, start: wi, end: wi })
                                        }
                                      }}
                                      style={{
                                        padding: '1px 2px',
                                        borderRadius: 4,
                                        cursor: 'text',
                                        background: isSelected ? '#7c5cff' : isSegment ? 'rgba(46,154,106,0.25)' : 'transparent',
                                        color: isSelected ? '#fff' : undefined,
                                        border: isSelected ? '1px solid #fff' : isSegment ? '1px solid #2e9a6a' : '1px solid transparent',
                                        userSelect: 'none',
                                      }}
                                      title={isSegment ? 'AudioSegment' : 'Click to select word, Shift+click to extend selection'}
                                    >
                                      {tok}
                                    </span>
                                  )
                                })
                              })()}
                            </span>
                            <small style={{ marginLeft: 4, fontSize: 9, color: 'var(--color-text-muted)' }}>
                              {part.startTime.toFixed(1)}–{part.endTime.toFixed(1)}
                            </small>
                            {part.segments && part.segments.length > 0 && (
                              <span data-testid="segment-badge" title={`${part.segments.length} AudioSegment(s)`} style={{ fontSize: 8, background: '#2e9a6a', color: '#fff', borderRadius: 4, padding: '1px 4px', marginLeft: 2 }}>
                                {part.segments.length} seg
                              </span>
                            )}
                            <button
                              data-testid={`record-btn-${part.id}`}
                              aria-label={`Record ${part.text}`}
                              onPointerDown={(e) => {
                                e.stopPropagation()
                              }}
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setFocusedId(part.id)
                                setRecordPartId(part.id)
                              }}
                              style={{
                                marginLeft: 4,
                                padding: '2px 6px',
                                fontSize: 9,
                                borderRadius: 8,
                                border: '1px solid #7c5cff',
                                background: part.audioClipId ? '#ff4d4d' : '#7c5cff',
                                color: '#fff',
                                cursor: 'pointer',
                              }}
                            >
                              ● Rec
                            </button>
                            <button
                              data-testid={`tts-btn-${part.id}`}
                              aria-label={`TTS ${part.text}`}
                              onPointerDown={(e) => {
                                e.stopPropagation()
                              }}
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                setFocusedId(part.id)
                                setTtsPartId(part.id)
                              }}
                              style={{
                                marginLeft: 2,
                                padding: '2px 6px',
                                fontSize: 9,
                                borderRadius: 8,
                                border: '1px solid #2e9a6a',
                                background: '#2e9a6a',
                                color: '#fff',
                                cursor: 'pointer',
                              }}
                            >
                              TTS
                            </button>
                            <div
                              data-testid="prompter-handle-left"
                              data-prompter-handle="left"
                              onPointerDown={(e) => onPrompterTrimPointerDown(e, part.id, 'left')}
                              style={{
                                position: 'absolute',
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: 8,
                                cursor: 'ew-resize',
                                background: 'rgba(255,255,255,0.2)',
                                borderRadius: '12px 0 0 12px',
                              }}
                            />
                            <div
                              data-testid="prompter-handle-right"
                              data-prompter-handle="right"
                              onPointerDown={(e) => onPrompterTrimPointerDown(e, part.id, 'right')}
                              style={{
                                position: 'absolute',
                                right: 0,
                                top: 0,
                                bottom: 0,
                                width: 8,
                                cursor: 'ew-resize',
                                background: 'rgba(255,255,255,0.2)',
                                borderRadius: '0 12px 12px 0',
                              }}
                            />
                          </div>
                        )
                      })
                    })()
                  )}
                  {prompterMovePreview && (
                    <div
                      data-testid="prompter-move-preview"
                      style={{
                        position: 'absolute',
                        top: 4,
                        height: 34,
                        left: prompterMovePreview.startTime * pps,
                        width: (slide.prompter?.parts.find((p) => p.id === prompterMovePreview.partId)?.duration ?? 1) * pps,
                        background: 'rgba(124,92,255,0.35)',
                        border: '1px dashed #fff',
                        borderRadius: 12,
                        pointerEvents: 'none',
                        zIndex: 5,
                      }}
                    />
                  )}
                </div>
                {wordSelection && selectedWordPart && (
                  <div data-testid="word-selection-bar" style={{ position: 'absolute', bottom: 2, left: 8, right: 8, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(124,92,255,0.12)', border: '1px solid #7c5cff', borderRadius: 6, padding: '4px 8px', fontSize: 10, zIndex: 6 }}>
                    <span style={{ color: '#e0d8ff' }}>Selected &quot;{selectedWordText}&quot; in &quot;{selectedWordPart.text.slice(0, 30)}&quot; (words {Math.min(wordSelection.start, wordSelection.end)}–{Math.max(wordSelection.start, wordSelection.end)})</span>
                    <button
                      data-testid="word-tts-trigger"
                      onClick={() => {
                        const start = Math.min(wordSelection.start, wordSelection.end)
                        const end = Math.max(wordSelection.start, wordSelection.end)
                        setWordLevelTts({ partId: wordSelection.partId, start, end, text: selectedWordText })
                      }}
                      style={{ marginLeft: 'auto', padding: '3px 8px', background: '#2e9a6a', color: '#fff', border: '1px solid #2e9a6a', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}
                    >
                      Replace with TTS
                    </button>
                    <button data-testid="word-selection-clear" onClick={() => setWordSelection(null)} style={{ padding: '3px 6px', background: '#333', color: '#e0e0e0', border: '1px solid #444', borderRadius: 4, cursor: 'pointer', fontSize: 10 }}>Clear</button>
                  </div>
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
                            if (isMovePreview && effectiveTrack !== trackId) return null
                            const displayStart = isMovePreview
                              ? movePreview.timelineStart
                              : clip.timelineStart
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
                            const isFocused = focusedId === clip.id
                            const isActive = activeClipId === clip.id
                            const zIndex = idx + 1
                            return (
                              <div
                                key={clip.id}
                                role="button"
                                tabIndex={isFocused ? 0 : -1}
                                aria-selected={isSelected}
                                aria-label={`Audio clip ${clip.assetId} at ${clip.timelineStart}`}
                                className={`audio-clip audio-clip--${trackId}${isOverflow ? ' audio-clip--overflow' : ''}${isSelected ? ' audio-clip--selected' : ''}${isOverlapping ? ' audio-clip--overlap' : ''}${isActive ? ' audio-clip--active' : ''}${isFocused ? ' audio-clip--focused' : ''}`}
                                data-testid="audio-clip"
                                data-clip-id={clip.id}
                                data-track={trackId}
                                title={
                                  isOverflow
                                    ? 'clipped-with-overflow past slide.duration'
                                    : undefined
                                }
                                onFocus={() => setFocusedId(clip.id)}
                                onClick={(e) => handleClipPointerDownSelect(e, clip.id)}
                                onPointerDown={(e) => onClipMovePointerDown(e, clip.id)}
                                onKeyDown={(e) => {
                                  // Roving within clip focus: Up/Down moves to adjacent focusable
                                  const focusIndex = orderedFocusableIds.indexOf(clip.id)
                                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                    // Let global handler handle nudging when selected; otherwise rove
                                    if (selectedClipIds.size > 0) return
                                    e.preventDefault()
                                    const dir = e.key === 'ArrowDown' ? 1 : -1
                                    const next = orderedFocusableIds[focusIndex + dir]
                                    if (next) {
                                      setFocusedId(next)
                                      document
                                        .querySelector<HTMLElement>(
                                          `[data-clip-id="${next}"], [data-prompter-id="${next}"]`,
                                        )
                                        ?.focus()
                                    }
                                  }
                                }}
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
                                    : isFocused
                                      ? '2px solid #7c5cff'
                                      : '1px solid var(--color-border)',
                                  borderRadius: 6,
                                  display: 'flex',
                                  alignItems: 'center',
                                  padding: '0 8px',
                                  fontSize: 11,
                                  overflow: 'hidden',
                                  whiteSpace: 'nowrap',
                                  borderRight: isOverflow ? '3px solid #ff4d4d' : undefined,
                                  opacity:
                                    clip.muted || mutedTracks.has(trackId)
                                      ? 0.5
                                      : soloTracks.size > 0 && !soloTracks.has(trackId)
                                        ? 0.3
                                        : 1,
                                  zIndex,
                                  cursor: 'grab',
                                  outline: isFocused ? '2px solid #7c5cff' : undefined,
                                }}
                              >
                                {(() => {
                                  const asset = engine.getEmbeddedAsset(clip.assetId)
                                  const meta = asset?.metadata as Record<string, unknown> | undefined
                                  const assetDuration = typeof meta?.duration === 'number' ? (meta.duration as number) : clip.sourceEnd - clip.sourceStart
                                  const rawPeaks = Array.isArray(meta?.waveformPeaks) ? (meta.waveformPeaks as number[]) : null
                                  const clipped = rawPeaks ? slicePeaksForClip(rawPeaks, assetDuration, displaySourceStart, displaySourceEnd) : rawPeaks
                                  // If no peaks cached and asset is long, try backend peaks once
                                  // placeholder uses null to show fallback
                                  void assetsApi // keep import used; backend long handled via BackendAudioCell
                                  return (
                                    <div style={{ position: 'absolute', inset: '4px 8px', opacity: 0.85, pointerEvents: 'none' }}>
                                      <WaveformCanvas peaks={clipped} width={Math.max(40, width - 16)} height={24} color="rgba(255,255,255,0.9)" background="transparent" barGap={1} testId="audio-clip-waveform" />
                                    </div>
                                  )
                                })()}
                                <span
                                  className="audio-clip__label"
                                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, position: 'relative', zIndex: 1 }}
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
                {displayMarquee && (
                  <div
                    data-testid="audio-marquee"
                    style={{
                      position: 'absolute',
                      left: displayMarquee.x,
                      top: displayMarquee.y,
                      width: displayMarquee.width,
                      height: displayMarquee.height,
                      border: '1px solid var(--color-accent)',
                      background: 'rgba(124,92,255,0.1)',
                      pointerEvents: 'none',
                      zIndex: 30,
                    }}
                  />
                )}
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
      {recordPart && (
        <RecordModal
          slideId={slide.id}
          partId={recordPart.id}
          partText={recordPart.text}
          partStartTime={recordPart.startTime}
          plannedDuration={recordPart.duration}
          onClose={() => setRecordPartId(null)}
        />
      )}
      {ttsPart && (
        <TtsModal
          slideId={slide.id}
          partId={ttsPart.id}
          partText={ttsPart.text}
          partStartTime={ttsPart.startTime}
          plannedDuration={ttsPart.duration}
          onClose={() => setTtsPartId(null)}
        />
      )}
      {wordLevelTts && (
        <WordLevelTtsModal
          slideId={slide.id}
          partId={wordLevelTts.partId}
          partText={engine.getSlide(slide.id).prompter?.parts.find((p) => p.id === wordLevelTts.partId)?.text ?? wordLevelTts.text}
          startWordIndex={wordLevelTts.start}
          endWordIndex={wordLevelTts.end}
          selectedText={wordLevelTts.text}
          onClose={() => {
            setWordLevelTts(null)
            setWordSelection(null)
          }}
        />
      )}
      {showImport && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Import prompter"
          data-testid="prompter-import-modal"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowImport(false)
          }}
        >
          <div
            style={{
              background: '#2a2a2a',
              border: '1px solid #444',
              borderRadius: 8,
              width: 420,
              padding: 16,
              color: '#e0e0e0',
            }}
          >
            <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Import prompter</h3>
            <p style={{ fontSize: 11, color: '#888', margin: '0 0 8px' }}>
              Paste narration — auto-splits on <code>[.,;:!?{"\\n"}—]</code> (consecutive collapsed, no empty parts). Duration = chars ×{' '}
              <code>secondsPerCharacter 0.2</code>
            </p>
            <textarea
              data-testid="prompter-import-textarea"
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Hello, world"
              autoFocus
              style={{
                width: '100%',
                minHeight: 80,
                background: '#1e1e1e',
                color: '#e0e0e0',
                border: '1px solid #444',
                borderRadius: 4,
                padding: 8,
                fontSize: 12,
                resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                data-testid="prompter-import-cancel"
                onClick={() => setShowImport(false)}
                style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid #444', background: '#333', color: '#e0e0e0', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                data-testid="prompter-import-confirm"
                onClick={() => {
                  const result = dispatch(new ImportPrompterCommand({ slideId: slide.id, rawText: importText }))
                  if (!result.ok) useNotificationStore.getState().notify(result.error.message)
                  setShowImport(false)
                }}
                style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid #7c5cff', background: '#7c5cff', color: '#fff', cursor: 'pointer' }}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
