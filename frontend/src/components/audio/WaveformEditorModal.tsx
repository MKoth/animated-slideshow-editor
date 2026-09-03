import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useEngine } from '../../app/useEngine'
import {
  TrimAudioClipCommand,
  CreateAudioClipCommand,
  TransactionCommand,
} from '../../engine/commands'
import { WaveformCanvas } from './WaveformCanvas'
import {
  bucketCountForDuration,
  computePeaksFromAudioBuffer,
  MAX_FRONTEND_DECODE_SECONDS,
} from '../../audio/waveform'
import { useNotificationStore } from '../../stores/notificationStore'
import { assetsApi } from '../../api'
import { rulerTickStep, rulerTickTimes, tickLabel } from '../../stores/timelineViewStore'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'

interface WaveformEditorModalProps {
  readonly slideId: string
  readonly clipId: string
  readonly onClose: () => void
}

function getAssetDurationFromMetadata(metadata: Record<string, unknown> | undefined): number | null {
  if (!metadata) return null
  const d = (metadata as Record<string, unknown>).duration
  if (typeof d === 'number' && Number.isFinite(d)) return d
  return null
}

function getWaveformPeaksFromMetadata(metadata: Record<string, unknown> | undefined): number[] | null {
  if (!metadata) return null
  const p = (metadata as Record<string, unknown>).waveformPeaks
  if (Array.isArray(p) && p.length > 0 && p.every((x) => typeof x === 'number')) return p as number[]
  return null
}

function base64ToBytes(base64: string): Uint8Array | null {
  try {
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

export function WaveformEditorModal({ slideId, clipId, onClose }: WaveformEditorModalProps) {
  const { engine, dispatch } = useEngine()
  // Hooks must be called unconditionally before any early return (rules-of-hooks)
  // Derive slide/clip safely; render fallback UI if missing after hooks
  let slide: ReturnType<typeof engine.getSlide> | undefined
  let clip: ReturnType<typeof engine.getSlide>['audio']['clips'][number] | undefined
  try {
    slide = engine.getSlide(slideId)
    clip = slide.audio.clips.find((c) => c.id === clipId)
  } catch {
    slide = undefined
    clip = undefined
  }
  const asset = clip ? engine.getEmbeddedAsset(clip.assetId) : undefined
  const globalDef = clip
    ? useAssetLibraryStore.getState().definitions.find((d) => d.id === clip.assetId)
    : undefined
  const assetMetadata = (asset?.metadata as Record<string, unknown> | undefined) ??
    (globalDef?.metadata as Record<string, unknown> | undefined)
  const assetDurationRaw = getAssetDurationFromMetadata(assetMetadata)
  // fallback: if no duration metadata, estimate from sourceEnd or assume 5
  const assetDuration = assetDurationRaw ?? Math.max(clip?.sourceEnd ?? 5, 5)

  const cachedPeaks = getWaveformPeaksFromMetadata(assetMetadata)

  const [peaks, setPeaks] = useState<number[] | null>(cachedPeaks)
  const [peaksSource, setPeaksSource] = useState<'cached' | 'decoded' | 'backend'>(
    cachedPeaks ? 'cached' : 'decoded',
  )
  const [isDecoding, setIsDecoding] = useState(false)

  // Trim state — editable via handles/inputs (defaults if clip missing)
  const [editStart, setEditStart] = useState(clip?.sourceStart ?? 0)
  const [editEnd, setEditEnd] = useState(clip?.sourceEnd ?? 5)
  // Selection for middle delete — interval inside [editStart, editEnd] to delete
  const [selStart, setSelStart] = useState<number | null>(null)
  const [selEnd, setSelEnd] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState<'left' | 'right' | 'selLeft' | 'selRight' | 'selMove' | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Derived: playbackRate to convert source seconds to timeline seconds
  const rate = clip?.playbackRate || 1

  // Load peaks: cached → decoded → backend canonical
  useEffect(() => {
    if (!clip) return
    let cancelled = false
    const load = async () => {
      // If we already have good cached peaks (>=800), keep them
      if (cachedPeaks && cachedPeaks.length >= 800) {
        setPeaks(cachedPeaks)
        setPeaksSource('cached')
        return
      }
      // Check if embedded and short enough to decode frontend quickly
      if (asset && assetDuration < MAX_FRONTEND_DECODE_SECONDS) {
        const bytes = base64ToBytes(asset.data)
        if (bytes) {
          setIsDecoding(true)
          try {
            const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
            const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
              ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
            if (Ctor) {
              const ctx = new Ctor()
              try {
                const audioBuffer = await ctx.decodeAudioData(buffer.slice(0))
                const computed = computePeaksFromAudioBuffer(audioBuffer, bucketCountForDuration(audioBuffer.duration))
                if (!cancelled) {
                  setPeaks(computed)
                  setPeaksSource('decoded')
                }
              } finally {
                await ctx.close().catch(() => {})
              }
            }
          } catch {
            // ignore
          } finally {
            if (!cancelled) setIsDecoding(false)
          }
        }
      } else if (globalDef && globalDef.original_url) {
        // For long or global assets, try quick decode via fetch then decodeAudioData (<30s)
        if (assetDuration < MAX_FRONTEND_DECODE_SECONDS) {
          try {
            const resp = await fetch(globalDef.original_url)
            if (resp.ok) {
              const buf = await resp.arrayBuffer()
              const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
                ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
              if (Ctor) {
                const ctx = new Ctor()
                try {
                  const audioBuffer = await ctx.decodeAudioData(buf)
                  const qp = computePeaksFromAudioBuffer(audioBuffer, bucketCountForDuration(audioBuffer.duration))
                  if (!cancelled) {
                    setPeaks(qp)
                    setPeaksSource('decoded')
                  }
                } finally {
                  await ctx.close().catch(() => {})
                }
              }
            }
          } catch {
            // quick decode best-effort
          }
        }
        // Always fetch backend canonical peaks afterwards (swap when available)
        try {
          const data = await assetsApi.getPeaks(clip.assetId)
          if (!cancelled && Array.isArray(data.peaks) && data.peaks.length >= 800) {
            setPeaks(data.peaks)
            setPeaksSource('backend')
          } else if (!cancelled && peaks === null) {
            // keep decoded if backend not available
          }
        } catch {
          // backend may be down — keep decoded/cached
        }
      } else if (asset) {
        // fallback decode for embedded long assets? only backend would have, but we tried
        // Try backend peaks even for embedded ids (maybe mirrored)
        try {
          const data = await assetsApi.getPeaks(clip.assetId)
          if (!cancelled && Array.isArray(data.peaks) && data.peaks.length >= 800) {
            setPeaks(data.peaks)
            setPeaksSource('backend')
          }
        } catch {
          // ignore
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [asset, globalDef, clip?.assetId, cachedPeaks, assetDuration, peaks, clip])

  // Sync editStart/editEnd when clip changes externally (but not while dragging)
  useEffect(() => {
    if (!clip) return
    if (isDragging) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditStart(clip.sourceStart)
    setEditEnd(clip.sourceEnd)
  }, [clip?.sourceStart, clip?.sourceEnd, isDragging, clip])

  // Ruler calculation — shares timeline ruler logic
  const width = 640
  const height = 96
  const pps = width / Math.max(assetDuration, 0.1)
  const tickStep = rulerTickStep(pps)
  const ticks = rulerTickTimes(0, assetDuration, tickStep)

  // Convert source time to pixel left
  const sourceToPx = useCallback(
    (t: number) => (t / assetDuration) * width,
    [assetDuration, width],
  )
  // const pxToSource = useCallback((px: number) => (px / width) * assetDuration, [assetDuration, width])

  const keptLeft = sourceToPx(editStart)
  const keptWidth = sourceToPx(editEnd) - keptLeft

  const selectionActive = selStart !== null && selEnd !== null && selStart < selEnd
  const selLeftPx = selectionActive ? sourceToPx(selStart!) : 0
  const selWidthPx = selectionActive ? sourceToPx(selEnd!) - selLeftPx : 0

  // Determine if selection is interior delete (middle delete) vs edge trim
  const isInteriorDelete = useMemo(() => {
    if (!selectionActive) return false
    const eps = 1e-6
    const a = selStart!
    const b = selEnd!
    return a > editStart + eps && b < editEnd - eps
  }, [selectionActive, selStart, selEnd, editStart, editEnd])

  const isEdgeTrimSelection = useMemo(() => {
    if (!selectionActive) return false
    return !isInteriorDelete
  }, [selectionActive, isInteriorDelete])

  const stopAudition = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      try {
        audio.pause()
        audio.currentTime = 0
        audio.src = ''
      } catch {
        // ignore
      }
      audioRef.current = null
    }
    setIsPlaying(false)
  }, [])

  useEffect(() => {
    return () => stopAudition()
  }, [stopAudition])

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopAudition()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, stopAudition])

  const handleAudition = useCallback(
    async (mode: 'kept' | 'selection' | 'full') => {
      if (!clip) return
      stopAudition()
      // Determine interval to play
      let startSrc: number
      let endSrc: number
      if (mode === 'selection' && selectionActive) {
        startSrc = selStart!
        endSrc = selEnd!
      } else if (mode === 'kept') {
        startSrc = editStart
        endSrc = editEnd
      } else {
        startSrc = 0
        endSrc = assetDuration
      }
      if (endSrc <= startSrc) {
        useNotificationStore.getState().notify('Nothing to audition — interval empty')
        return
      }
      // Resolve audio source
      let srcUrl: string
      if (asset) {
        // embedded data url
        srcUrl = `data:${asset.mimeType};base64,${asset.data}`
      } else if (globalDef) {
        srcUrl = globalDef.original_url
      } else {
        useNotificationStore.getState().notify('Asset not found for audition')
        return
      }
      const audio = new Audio(srcUrl)
      audioRef.current = audio
      // Respect volume/muted and playbackRate
      audio.volume = clip.muted ? 0 : clip.volume
      audio.muted = clip.muted
      audio.playbackRate = clip.playbackRate || 1
      audio.currentTime = startSrc
      // Play selected interval; stop after playback duration = (endSrc - startSrc)/rate
      const playbackDuration = (endSrc - startSrc) / rate
      audio.onended = () => {
        stopAudition()
      }
      audio.onerror = () => {
        useNotificationStore.getState().notify('Audition playback failed')
        stopAudition()
      }
      // Use timeupdate to stop at endSrc
      const onTimeUpdate = () => {
        if (audio.currentTime >= endSrc - 0.02) {
          audio.pause()
          stopAudition()
        }
      }
      audio.addEventListener('timeupdate', onTimeUpdate)
      try {
        await audio.play()
        setIsPlaying(true)
        // Fallback timer to stop after playbackDuration
        setTimeout(() => {
          if (audioRef.current === audio) {
            try {
              audio.pause()
            } catch {
              // ignore
            }
            stopAudition()
          }
        }, playbackDuration * 1000 + 300)
      } catch {
        useNotificationStore.getState().notify('Audition playback failed')
        stopAudition()
      }
    },
    [stopAudition, selectionActive, selStart, selEnd, editStart, editEnd, asset, globalDef, clip, assetDuration, rate],
  )

  const handleDragStart = useCallback(
    (which: 'left' | 'right' | 'selLeft' | 'selRight' | 'selMove', e: React.PointerEvent) => {
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      setIsDragging(which)
      const startX = e.clientX
      const startEditStart = editStart
      const startEditEnd = editEnd
      const startSelStart = selStart
      const startSelEnd = selEnd

      const pxToSourceDelta = (dx: number) => (dx / width) * assetDuration

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX
        const dt = pxToSourceDelta(dx)
        if (which === 'left') {
          const proposed = Math.max(0, Math.min(startEditStart + dt, editEnd - 0.05))
          setEditStart(Number(proposed.toFixed(3)))
          // Keep selection inside if needed
          if (selStart !== null && selEnd !== null) {
            const newSelStart = Math.max(proposed, Math.min(startSelStart!, startSelEnd! - 0.05))
            const newSelEnd = Math.min(editEnd, Math.max(startSelEnd!, newSelStart + 0.05))
            setSelStart(Number(newSelStart.toFixed(3)))
            setSelEnd(Number(newSelEnd.toFixed(3)))
          }
        } else if (which === 'right') {
          const proposed = Math.min(assetDuration, Math.max(startEditEnd + dt, editStart + 0.05))
          setEditEnd(Number(proposed.toFixed(3)))
          if (selStart !== null && selEnd !== null) {
            const newSelEnd = Math.min(proposed, Math.max(startSelEnd!, startSelStart! + 0.05))
            const newSelStart = Math.max(editStart, Math.min(startSelStart!, newSelEnd - 0.05))
            setSelStart(Number(newSelStart.toFixed(3)))
            setSelEnd(Number(newSelEnd.toFixed(3)))
          }
        } else if (which === 'selLeft') {
          if (startSelStart === null || startSelEnd === null) return
          const proposed = Math.max(editStart, Math.min(startSelStart + dt, startSelEnd - 0.05))
          setSelStart(Number(proposed.toFixed(3)))
        } else if (which === 'selRight') {
          if (startSelStart === null || startSelEnd === null) return
          const proposed = Math.min(editEnd, Math.max(startSelEnd + dt, startSelStart + 0.05))
          setSelEnd(Number(proposed.toFixed(3)))
        } else if (which === 'selMove') {
          if (startSelStart === null || startSelEnd === null) return
          const selLen = startSelEnd - startSelStart
          let newStart = startSelStart + dt
          let newEnd = newStart + selLen
          // Clamp inside kept interval
          if (newStart < editStart) {
            newStart = editStart
            newEnd = newStart + selLen
          }
          if (newEnd > editEnd) {
            newEnd = editEnd
            newStart = newEnd - selLen
          }
          setSelStart(Number(newStart.toFixed(3)))
          setSelEnd(Number(newEnd.toFixed(3)))
        }
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        setIsDragging(null)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [editStart, editEnd, selStart, selEnd, width, assetDuration],
  )

  const handleWaveformPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Click on waveform to set selection — drag to create interval
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = e.clientX - rect.left
      const t = (x / width) * assetDuration
      // Clamp to kept interval
      const clamped = Math.max(editStart, Math.min(editEnd, t))
      const startSel = Number(clamped.toFixed(3))
      setSelStart(startSel)
      setSelEnd(startSel)
      setIsDragging('selRight')
      const startX = e.clientX
      const pxToSourceDelta = (dx: number) => (dx / width) * assetDuration
      let curStart = startSel
      let curEnd = startSel
      const refinedMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX
        const dt = pxToSourceDelta(dx)
        const proposed = Math.max(editStart, Math.min(editEnd, startSel + dt))
        if (proposed >= startSel) {
          curStart = startSel
          curEnd = proposed
        } else {
          curStart = proposed
          curEnd = startSel
        }
        setSelStart(Number(curStart.toFixed(3)))
        setSelEnd(Number(curEnd.toFixed(3)))
      }
      window.addEventListener('pointermove', refinedMove)
      const refinedUp = () => {
        window.removeEventListener('pointermove', refinedMove)
        window.removeEventListener('pointerup', refinedUp)
        setIsDragging(null)
        if (Math.abs(curEnd - curStart) < 0.03) {
          setSelStart(null)
          setSelEnd(null)
        }
      }
      window.addEventListener('pointerup', refinedUp)
    },
    [width, assetDuration, editStart, editEnd],
  )

  const canSave = useMemo(() => {
    if (!clip) return false
    if (editStart < 0 || editEnd > assetDuration + 1e-6) return false
    if (editEnd - editStart < 0.05) return false
    if (selectionActive) {
      if (selStart! < editStart - 1e-6 || selEnd! > editEnd + 1e-6) return false
      if (selEnd! - selStart! < 0.03) return false
    }
    // Check if anything changed
    const trimChanged = Math.abs(editStart - clip.sourceStart) > 1e-6 || Math.abs(editEnd - clip.sourceEnd) > 1e-6
    const hasDelete = selectionActive && isInteriorDelete
    const hasEdgeDelete = selectionActive && isEdgeTrimSelection
    // If edge delete selection, it will be treated as trim to selection bounds? We consider it as trim
    return trimChanged || hasDelete || hasEdgeDelete
  }, [editStart, editEnd, assetDuration, selectionActive, selStart, selEnd, clip, isInteriorDelete, isEdgeTrimSelection])

  const handleSave = useCallback(() => {
    if (!clip || !slide) return
    // Build Transaction
    const commands: Array<Parameters<typeof dispatch>[0]> = []
    // Determine effective trim
    let effectiveStart = editStart
    let effectiveEnd = editEnd
    // If selection is edge trim (delete at edge), adjust effectiveStart/End to reflect delete
    if (selectionActive && isEdgeTrimSelection) {
      const a = selStart!
      const b = selEnd!
      const eps = 1e-6
      if (Math.abs(a - editStart) < eps && b < editEnd - eps) {
        // left edge delete: move start to b
        effectiveStart = b
      } else if (Math.abs(b - editEnd) < eps && a > editStart + eps) {
        effectiveEnd = a
      } else if (Math.abs(a - editStart) < eps && Math.abs(b - editEnd) < eps) {
        // whole kept deleted — would empty, block
        useNotificationStore.getState().notify('Cannot delete entire kept interval')
        return
      } else {
        // middle-ish but not interior? Treat as trim to either side? For now take effective trim as before
      }
    }

    const trimChanged = Math.abs(effectiveStart - clip.sourceStart) > 1e-6 || Math.abs(effectiveEnd - clip.sourceEnd) > 1e-6
    const hasInteriorDelete = selectionActive && isInteriorDelete

    if (hasInteriorDelete) {
      const delStart = selStart!
      const delEnd = selEnd!
      // Effective kept interval is [effectiveStart, effectiveEnd]; delete interior [delStart, delEnd] inside it
      // Validate delete inside effective
      if (delStart <= effectiveStart + 1e-6 || delEnd >= effectiveEnd - 1e-6) {
        useNotificationStore.getState().notify('Delete interval must be strictly inside kept interval')
        return
      }
      // First clip: trim to [effectiveStart, delStart]
      // If effectiveStart/ delStart differs from original, we need trim; otherwise keep original first part
      // We'll trim original clip to left part
      const needTrimLeft = Math.abs(effectiveStart - clip.sourceStart) > 1e-6 || Math.abs(delStart - clip.sourceEnd) > 1e-6
      if (needTrimLeft) {
        commands.push(
          new TrimAudioClipCommand({
            slideId,
            clipId,
            sourceStart: effectiveStart,
            sourceEnd: delStart,
          }),
        )
      }
      // Second clip: create with [delEnd, effectiveEnd] at gap-free position
      const leftPlayback = (delStart - effectiveStart) / rate
      const secondTimelineStart = clip.timelineStart + leftPlayback
      commands.push(
        new CreateAudioClipCommand({
          slideId,
          assetId: clip.assetId,
          trackId: clip.trackId,
          timelineStart: secondTimelineStart,
          sourceStart: delEnd,
          sourceEnd: effectiveEnd,
          volume: clip.volume,
          muted: clip.muted,
          fadeIn: clip.fadeIn,
          fadeOut: clip.fadeOut,
          playbackRate: clip.playbackRate,
        }),
      )
      // Note: if effectiveStart != clip.sourceStart, second's timelineStart computed from effectiveStart ensures gap-free as adjacent to trimmed first
      // No asset rewrite; original asset preserved
    } else if (trimChanged) {
      // Simple edge trim (including edge delete case)
      commands.push(
        new TrimAudioClipCommand({
          slideId,
          clipId,
          sourceStart: effectiveStart,
          sourceEnd: effectiveEnd,
        }),
      )
    } else {
      useNotificationStore.getState().notify('No changes to save')
      return
    }

    // Dispatch as single Transaction for one undo entry
    const tx = new TransactionCommand(commands as never[])
    const result = dispatch(tx)
    if (!result.ok) {
      useNotificationStore.getState().notify(result.error.message)
      return
    }
    // Timeline will reflect new clips via engine subscription
    stopAudition()
    onClose()
  }, [
    editStart,
    editEnd,
    selectionActive,
    isEdgeTrimSelection,
    selStart,
    selEnd,
    clip,
    slide,
    slideId,
    clipId,
    rate,
    dispatch,
    isInteriorDelete,
    stopAudition,
    onClose,
  ])

  const clippedPeaksForDisplay = useMemo(() => {
    // For performance, we slice peaks to full asset; WaveformCanvas will downsample internally
    // Keep full peaks; overlay highlights kept
    return peaks
  }, [peaks])

  if (!clip || !slide) {
    return (
      <div role="dialog" aria-label="Waveform Editor" data-testid="waveform-editor-modal">
        Clip not found
        <button onClick={onClose} data-testid="waveform-editor-close">Close</button>
      </div>
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Waveform Editor"
      data-testid="waveform-editor-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 500,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          stopAudition()
          onClose()
        }
      }}
    >
      <div
        style={{
          background: '#1e1e2e',
          border: '1px solid #333',
          borderRadius: 10,
          width: 720,
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 16,
          color: '#e0e0e0',
          boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Waveform Editor — {clip.assetId.slice(0, 8)}…</h3>
          <button
            data-testid="waveform-editor-close"
            onClick={() => {
              stopAudition()
              onClose()
            }}
            aria-label="Close"
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: '1px solid #444',
              background: '#2a2a3a',
              color: '#e0e0e0',
              cursor: 'pointer',
            }}
          >
            × Close
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#888', marginBottom: 8 }}>
          {asset ? `Project asset • ${asset.mimeType} • ${assetDuration.toFixed(2)}s` : `Global asset • ${globalDef?.original_filename} • ${assetDuration.toFixed(2)}s`}
          {peaksSource === 'cached' && ' • peaks cached'}
          {peaksSource === 'decoded' && ' • peaks decoded'}
          {peaksSource === 'backend' && ' • peaks canonical'}
          {isDecoding && ' • decoding…'}
          {clip.muted ? ' • muted' : ` • vol ${clip.volume.toFixed(2)}`}
          {rate !== 1 ? ` • rate ${rate}` : ''}
        </div>
        {/* Ruler sharing timeline ruler */}
        <div
          data-testid="waveform-ruler"
          style={{
            position: 'relative',
            width,
            height: 18,
            marginBottom: 2,
            background: '#2a2a3a',
            borderRadius: 4,
            overflow: 'hidden',
            border: '1px solid #333',
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
                width: 1,
                background: 'rgba(255,255,255,0.15)',
                fontSize: 8,
                color: '#aaa',
              }}
            >
              <span style={{ position: 'absolute', top: 1, left: 2, whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 8 }}>
                {tickLabel(t, tickStep)}
              </span>
            </div>
          ))}
          {/* playhead for audition? Show clip start marker */}
          <div
            data-testid="waveform-ruler-clip-start"
            style={{
              position: 'absolute',
              left: clip.timelineStart * pps, // timeline ruler share: clip's timelineStart vs asset duration not same scale, but show placeholder
              top: 0,
              bottom: 0,
              width: 2,
              background: 'rgba(124,92,255,0.0)',
            }}
          />
        </div>
        <div
          ref={containerRef}
          data-testid="waveform-editor-canvas-container"
          style={{
            position: 'relative',
            width,
            height,
            background: '#0f0f14',
            borderRadius: 6,
            overflow: 'hidden',
            border: '1px solid #333',
            cursor: 'crosshair',
            userSelect: 'none',
          }}
          onPointerDown={handleWaveformPointerDown}
        >
          <WaveformCanvas
            peaks={clippedPeaksForDisplay}
            width={width}
            height={height}
            color="#7c5cff"
            background="transparent"
            barGap={1}
            testId="waveform-editor-canvas"
            ariaLabel="waveform editor"
          />
          {/* Dim outside kept interval */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              pointerEvents: 'none',
            }}
          >
            <div style={{ width: keptLeft, background: 'rgba(0,0,0,0.55)' }} />
            <div style={{ flex: keptWidth, background: 'transparent', borderLeft: '1px solid rgba(255,255,255,0.2)', borderRight: '1px solid rgba(255,255,255,0.2)' }} />
            <div style={{ flex: 1, background: 'rgba(0,0,0,0.55)' }} />
          </div>
          {/* Selection overlay */}
          {selectionActive && (
            <div
              data-testid="waveform-selection"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: selLeftPx,
                width: selWidthPx,
                background: isInteriorDelete ? 'rgba(255,80,80,0.35)' : 'rgba(255,180,80,0.35)',
                border: `1px dashed ${isInteriorDelete ? '#ff4d4d' : '#ffb74d'}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                fontSize: 9,
                color: '#fff',
              }}
            >
              <span style={{ background: 'rgba(0,0,0,0.6)', padding: '1px 4px', borderRadius: 3 }}>
                {isInteriorDelete ? 'Delete → 2 clips' : 'Edge trim'}
              </span>
            </div>
          )}
          {/* Kept interval handles */}
          <div
            data-testid="waveform-handle-left"
            onPointerDown={(e) => handleDragStart('left', e)}
            style={{
              position: 'absolute',
              left: keptLeft - 6,
              top: 0,
              bottom: 0,
              width: 12,
              cursor: 'ew-resize',
              background: 'rgba(255,255,255,0.12)',
              borderLeft: '2px solid #fff',
              borderRight: '1px solid rgba(255,255,255,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2,
            }}
            title="Drag to trim sourceStart"
          >
            <span style={{ width: 3, height: 24, background: '#fff', borderRadius: 2 }} />
          </div>
          <div
            data-testid="waveform-handle-right"
            onPointerDown={(e) => handleDragStart('right', e)}
            style={{
              position: 'absolute',
              left: keptLeft + keptWidth - 6,
              top: 0,
              bottom: 0,
              width: 12,
              cursor: 'ew-resize',
              background: 'rgba(255,255,255,0.12)',
              borderRight: '2px solid #fff',
              borderLeft: '1px solid rgba(255,255,255,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2,
            }}
            title="Drag to trim sourceEnd"
          >
            <span style={{ width: 3, height: 24, background: '#fff', borderRadius: 2 }} />
          </div>
          {/* Selection handles */}
          {selectionActive && (
            <>
              <div
                data-testid="waveform-selection-handle-left"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  handleDragStart('selLeft', e)
                }}
                style={{
                  position: 'absolute',
                  left: selLeftPx - 6,
                  top: 0,
                  bottom: 0,
                  width: 12,
                  cursor: 'ew-resize',
                  background: 'rgba(255,80,80,0.18)',
                  borderLeft: '2px solid #ff4d4d',
                  zIndex: 3,
                }}
              />
              <div
                data-testid="waveform-selection-handle-right"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  handleDragStart('selRight', e)
                }}
                style={{
                  position: 'absolute',
                  left: selLeftPx + selWidthPx - 6,
                  top: 0,
                  bottom: 0,
                  width: 12,
                  cursor: 'ew-resize',
                  background: 'rgba(255,80,80,0.18)',
                  borderRight: '2px solid #ff4d4d',
                  zIndex: 3,
                }}
              />
              <div
                data-testid="waveform-selection-move"
                onPointerDown={(e) => {
                  e.stopPropagation()
                  handleDragStart('selMove', e)
                }}
                style={{
                  position: 'absolute',
                  left: selLeftPx,
                  top: '45%',
                  width: selWidthPx,
                  height: 18,
                  cursor: 'grab',
                  background: 'transparent',
                  zIndex: 3,
                }}
                title="Drag selection to move"
              />
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 11, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            sourceStart
            <input
              data-testid="waveform-source-start"
              type="number"
              step={0.01}
              min={0}
              max={editEnd - 0.05}
              value={editStart}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                if (Number.isFinite(v)) setEditStart(Math.max(0, Math.min(v, editEnd - 0.05)))
              }}
              style={{ width: 70, padding: '3px 6px', background: '#2a2a3a', border: '1px solid #444', borderRadius: 4, color: '#e0e0e0', fontSize: 11 }}
            />
          </label>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            sourceEnd
            <input
              data-testid="waveform-source-end"
              type="number"
              step={0.01}
              min={editStart + 0.05}
              max={assetDuration}
              value={editEnd}
              onChange={(e) => {
                const v = parseFloat(e.target.value)
                if (Number.isFinite(v)) setEditEnd(Math.min(assetDuration, Math.max(v, editStart + 0.05)))
              }}
              style={{ width: 70, padding: '3px 6px', background: '#2a2a3a', border: '1px solid #444', borderRadius: 4, color: '#e0e0e0', fontSize: 11 }}
            />
          </label>
          <span style={{ color: '#888' }}>kept {(editEnd - editStart).toFixed(2)}s • dur {assetDuration.toFixed(2)}s</span>
          {selectionActive && (
            <span style={{ color: isInteriorDelete ? '#ff6b6b' : '#ffb74d' }}>
              sel {selStart!.toFixed(2)}–{selEnd!.toFixed(2)} ({(selEnd! - selStart!).toFixed(2)}s) {isInteriorDelete ? '→ split gap-free' : '→ edge'}
            </span>
          )}
          <button
            data-testid="waveform-clear-selection"
            onClick={() => {
              setSelStart(null)
              setSelEnd(null)
            }}
            disabled={!selectionActive}
            style={{
              padding: '3px 8px',
              borderRadius: 4,
              border: '1px solid #444',
              background: selectionActive ? '#2a2a3a' : '#1a1a1a',
              color: selectionActive ? '#e0e0e0' : '#666',
              cursor: selectionActive ? 'pointer' : 'not-allowed',
              fontSize: 10,
            }}
          >
            Clear selection
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button
            data-testid="waveform-audition-kept"
            onClick={() => void handleAudition('kept')}
            disabled={isPlaying}
            style={{
              padding: '6px 10px',
              borderRadius: 4,
              border: '1px solid #444',
              background: isPlaying ? '#444' : '#2a2a3a',
              color: '#e0e0e0',
              cursor: isPlaying ? 'not-allowed' : 'pointer',
              fontSize: 11,
            }}
          >
            ▶ Kept
          </button>
          <button
            data-testid="waveform-audition-selection"
            onClick={() => void handleAudition('selection')}
            disabled={!selectionActive || isPlaying}
            style={{
              padding: '6px 10px',
              borderRadius: 4,
              border: `1px solid ${isInteriorDelete ? '#ff4d4d' : '#444'}`,
              background: selectionActive && !isPlaying ? (isInteriorDelete ? 'rgba(255,77,77,0.2)' : '#2a2a3a') : '#1a1a1a',
              color: selectionActive ? '#e0e0e0' : '#666',
              cursor: selectionActive && !isPlaying ? 'pointer' : 'not-allowed',
              fontSize: 11,
            }}
          >
            ▶ Selection {isInteriorDelete ? '(to delete)' : ''}
          </button>
          <button
            data-testid="waveform-audition-full"
            onClick={() => void handleAudition('full')}
            disabled={isPlaying}
            style={{
              padding: '6px 10px',
              borderRadius: 4,
              border: '1px solid #444',
              background: isPlaying ? '#444' : '#2a2a3a',
              color: '#e0e0e0',
              cursor: isPlaying ? 'not-allowed' : 'pointer',
              fontSize: 11,
            }}
          >
            ▶ Full
          </button>
          <button
            data-testid="waveform-audition-stop"
            onClick={stopAudition}
            disabled={!isPlaying}
            style={{
              padding: '6px 10px',
              borderRadius: 4,
              border: '1px solid #444',
              background: isPlaying ? '#7c5cff' : '#1a1a1a',
              color: isPlaying ? '#fff' : '#666',
              cursor: isPlaying ? 'pointer' : 'not-allowed',
              fontSize: 11,
            }}
          >
            ■ Stop
          </button>
          <span style={{ flex: 1 }} />
          <button
            data-testid="waveform-editor-cancel"
            onClick={() => {
              stopAudition()
              onClose()
            }}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid #444',
              background: '#2a2a3a',
              color: '#e0e0e0',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            Cancel
          </button>
          <button
            data-testid="waveform-editor-save"
            onClick={handleSave}
            disabled={!canSave}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: `1px solid ${canSave ? '#7c5cff' : '#444'}`,
              background: canSave ? '#7c5cff' : '#2a2a2a',
              color: canSave ? '#fff' : '#777',
              cursor: canSave ? 'pointer' : 'not-allowed',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            Save (Transaction)
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: '#777' }}>
          Drag on waveform to select middle interval; handles for edge trim; interior delete splits into <strong>two clips gap-free</strong> — timeline reflects new clips. Audition respects <code>volume {clip.volume} {clip.muted ? '(muted)' : ''}</code>. Single undo entry. Original asset bytes never rewritten.
        </div>
      </div>
    </div>
  )
}
