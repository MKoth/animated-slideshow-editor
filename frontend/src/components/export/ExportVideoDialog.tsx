import { useEffect, useMemo, useRef, useState } from 'react'
import type { EnginePublic } from '../../engine/engine'
import type { ExportApi } from '../../api/exportApi'
import { ApiError } from '../../api/apiClient'
import {
  buildExportJobDescriptorForSlides,
  EXPORT_VIDEO_FPS,
  getFixedExportSettings,
} from '../../engine/export'
import {
  buildExportSubtitleCues,
  buildSrtDocument,
  buildVttDocument,
  countCuesForSlide,
  sanitizeExportBasename,
} from '../../engine/subtitles'
import {
  captureExportFrameAt,
  restorePreviewSnapshot,
  savePreviewSnapshot,
} from '../../export/frameCapture'
import { resolveExportAudioBytes } from '../../export/exportAudio'
import { slidesMissingCameraKeyframes } from '../../export/exportCamera'
import { usePlaybackController } from '../../stores/playbackStore'
import { useUiStore } from '../../stores/uiStore'
import { cameraFrameDimensions } from '../../engine/cameraFrameSize'

export type ExportFrameCapture = (slideId: string, timestamp: number) => Promise<string | null>

interface ExportVideoDialogProps {
  readonly engine: EnginePublic
  readonly exportApi: ExportApi
  readonly onClose: () => void
  readonly captureFrame?: ExportFrameCapture
}

type Phase = 'pick' | 'working' | 'done' | 'error'

const ACTIVE_STATUSES = new Set(['queued', 'rendering', 'encoding'])

/**
 * Default frame capture following the pixi/renderer/thumbnailRecorder.ts canvas
 * pattern: seeks the live preview to the exact export timestamp and reads the
 * rendered stage. Output uses the globally selected camera-frame dimensions.
 * time (never stretched). Returns null when no canvas is available; callers
 * fail the export loudly instead of uploading placeholder pixels.
 */
export async function captureExportFrameFromCanvas(): Promise<string | null> {
  try {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null
    if (!canvas) return null
    return canvas.toDataURL?.('image/png') ?? null
  } catch {
    return null
  }
}

export function ExportVideoDialog({
  engine,
  exportApi,
  onClose,
  captureFrame,
}: ExportVideoDialogProps) {
  const project = engine.project
  const cameraFrameSize = useUiStore((state) => state.cameraFrameSize)
  const frameDimensions = cameraFrameDimensions(cameraFrameSize)
  const selectable = useMemo(
    () => (project ? project.slides.filter((slide) => slide.duration > 0) : []),
    [project],
  )
  const zeroCount = project ? project.slides.filter((slide) => slide.duration <= 0).length : 0

  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(selectable.map((slide) => slide.id)),
  )
  const [subtitlesOn] = useState(true)
  const [phase, setPhase] = useState<Phase>('pick')
  const [blocked, setBlocked] = useState<string | null>(null)
  const [progress, setProgress] = useState({ received: 0, expected: 0, status: '' })
  const [error, setError] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [exportRoot, setExportRoot] = useState('')
  const [projectExports, setProjectExports] = useState<{
    directory: string
    slides: Record<string, { file: string; name: string; duration: number }>
    joinedReady: boolean
    joinedOutdated: boolean
    subtitlesReady: boolean
    subtitlesOutdated: boolean
  } | null>(null)
  const [action, setAction] = useState('')
  const cancelRequested = useRef(false)

  // Single-concurrency probe: if another export is running, block starting a new one.
  useEffect(() => {
    let cancelled = false
    void exportApi
      .listJobs()
      .then((jobs) => {
        if (cancelled) return
        if (jobs.some((job) => ACTIVE_STATUSES.has(job.status))) {
          setBlocked('An export is already running. Wait for it to finish before starting another.')
        }
      })
      .catch(() => {
        // Listing is best-effort; creation still enforces the rule with a 409.
      })
    return () => {
      cancelled = true
    }
  }, [exportApi])

  const refreshProjectExports = async () => {
    if (!project) return
    const [settings, exports] = await Promise.all([
      exportApi.getExportSettings(),
      exportApi.getProjectExports(project.id),
    ])
    setExportRoot(settings.exportRoot)
    setProjectExports(exports)
  }

  useEffect(() => {
    // The effect starts asynchronous synchronization; the setters run after requests settle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshProjectExports().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Could not load export folder')
    })
    // project id determines the persistent export directory
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportApi, project?.id])

  const orderedSelected = useMemo(() => {
    if (!project) return []
    const wanted = new Set(selected)
    return project.slides.filter((slide) => wanted.has(slide.id) && slide.duration > 0)
  }, [project, selected])

  const cueCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const slide of selectable) map.set(slide.id, countCuesForSlide(slide))
    return map
  }, [selectable])

  // Computed fresh on every render (not memoized): keyframes can be added
  // while the dialog is open, and validation must see the live engine state.
  const cameraMissingIds = new Set(
    slidesMissingCameraKeyframes(engine, selectable).map((slide) => slide.id),
  )
  const cameraMissing = orderedSelected.filter((slide) => cameraMissingIds.has(slide.id))

  const totals = useMemo(() => {
    if (!project) return { cues: 0, duration: 0, frames: 0 }
    const cues = subtitlesOn
      ? buildExportSubtitleCues(
          project,
          orderedSelected.map((s) => s.id),
        )
      : []
    const duration = orderedSelected.reduce((sum, slide) => sum + slide.duration, 0)
    const frames = orderedSelected.reduce(
      (sum, slide) => sum + Math.round(slide.duration * EXPORT_VIDEO_FPS),
      0,
    )
    return { cues: cues.length, duration, frames }
  }, [project, orderedSelected, subtitlesOn])

  const canExport = orderedSelected.length > 0 && phase !== 'working'

  const previewCameraPath = () => {
    useUiStore.getState().setCameraAnimationMode(true)
    onClose()
  }

  const toggleSlide = (slideId: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(slideId)) next.delete(slideId)
      else next.add(slideId)
      return next
    })
  }

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const handleExport = async () => {
    if (!project || orderedSelected.length === 0) return
    setError(null)
    setBlocked(null)
    const missingCamera = slidesMissingCameraKeyframes(engine, orderedSelected)
    if (missingCamera.length > 0) {
      const names = missingCamera.map((slide) => `"${slide.name}"`).join(', ')
      setPhase('error')
      setError(
        `Camera animation required: ${names} ${
          missingCamera.length === 1 ? 'has' : 'have'
        } no camera keyframes, so its desired position is unknown. ` +
          `Animate the camera (camera animation mode) or deselect the slide.`,
      )
      return
    }
    setPhase('working')
    cancelRequested.current = false
    setProgress({ received: 0, expected: totals.frames, status: 'queued' })
    try {
      const settings = getFixedExportSettings(frameDimensions.width, frameDimensions.height)
      const selectedIds = orderedSelected.map((slide) => slide.id)
      const descriptor = buildExportJobDescriptorForSlides(project, selectedIds, settings)
      const cues = subtitlesOn ? buildExportSubtitleCues(project, selectedIds) : []
      const srt = subtitlesOn ? buildSrtDocument(cues) : ''
      const vtt = subtitlesOn ? buildVttDocument(cues) : 'WEBVTT\n'
      let created
      try {
        created = await exportApi.createJob(descriptor, {
          projectName: project.name,
          subtitles: { srt, vtt },
        })
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setBlocked('An export is already running. Wait for it to finish before starting another.')
          setPhase('pick')
          return
        }
        throw err
      }
      setJobId(created.jobId)
      const expected = created.expectedFrameCount
      setProgress({ received: 0, expected, status: created.status })
      // Freeze the live preview while seeking: save times, pause, restore after.
      // Force camera-animation evaluation so frames render exactly what the
      // authored camera sees (not the ephemeral pan/zoom viewport).
      const snapshot = savePreviewSnapshot(engine)
      usePlaybackController.getState().pause()
      const prevCameraMode = useUiStore.getState().cameraAnimationMode
      useUiStore.getState().setCameraAnimationMode(true)
      // Upload real audio bytes so the backend can mix audible sound.
      // Embedded assets come from the project; library assets via original_url.
      // Missing/unresolvable assets are skipped — that slide renders silence.
      let sent = 0
      try {
        const assetIds = new Set<string>()
        for (const slide of descriptor.slides) {
          for (const clip of slide.audio.clips) {
            if (!clip.muted) assetIds.add(clip.assetId)
          }
        }
        for (const assetId of assetIds) {
          if (cancelRequested.current) return
          const resolved = await resolveExportAudioBytes(engine, assetId)
          if (!resolved) continue
          try {
            await exportApi.uploadAudio(created.jobId, {
              assetId,
              data: resolved.data,
              mimeType: resolved.mimeType,
            })
          } catch {
            // One bad asset must not sink the export; slide falls back to silence.
          }
        }
        const durations = new Map(descriptor.slides.map((s) => [s.slideId, s.duration]))
        const capture =
          captureFrame ??
          ((slideId: string, timestamp: number) =>
            captureExportFrameAt(engine, slideId, timestamp, durations.get(slideId) ?? 0))
        for (const slide of descriptor.slides) {
          for (let frameIndex = 0; frameIndex < slide.frameTimestamps.length; frameIndex += 1) {
            if (cancelRequested.current) return
            const timestamp = slide.frameTimestamps[frameIndex]!
            let data: string | null = null
            try {
              data = await capture(slide.slideId, timestamp)
            } catch {
              data = null
            }
            if (!data) {
              throw new Error(
                `Could not capture frame ${sent + 1}/${expected} (slide ${slide.slideId} t=${timestamp}). ` +
                  `Open the project in the editor so the canvas can render.`,
              )
            }
            const updated = await exportApi.uploadFrame(created.jobId, {
              slideId: slide.slideId,
              frameIndex: sent,
              timestamp,
              data,
            })
            sent += 1
            setProgress({ received: sent, expected, status: updated.status })
          }
        }
        if (cancelRequested.current) return
      } finally {
        useUiStore.getState().setCameraAnimationMode(prevCameraMode)
        restorePreviewSnapshot(engine, snapshot)
      }
      await exportApi.completeJob(created.jobId)
      // Poll the canonical job status (spec client flow: createJob then poll getJob).
      const polled = await exportApi.getJob(created.jobId)
      setProgress({ received: sent, expected, status: polled.status })
      if (polled.status !== 'done') {
        throw new Error(polled.error ?? `Export failed with status ${polled.status}`)
      }
      const blob = await exportApi.downloadArtifact(created.jobId)
      triggerDownload(blob, `${sanitizeExportBasename(project.name)}.zip`)
      setPhase('done')
    } catch (err) {
      setPhase('error')
      setError(err instanceof Error ? err.message : 'Export failed')
    }
  }

  const handleCancel = async () => {
    if (!jobId) return
    cancelRequested.current = true
    try {
      await exportApi.cancelJob(jobId)
    } catch {
      // Cancellation is best-effort; fall through to reset.
    }
    setPhase('pick')
    setJobId(null)
    setProgress({ received: 0, expected: 0, status: '' })
  }

  const generateSlideVideo = async (slideId: string): Promise<void> => {
    if (!project) return
    const slide = selectable.find((item) => item.id === slideId)
    if (!slide) return
    const descriptor = buildExportJobDescriptorForSlides(
      project,
      [slide.id],
      getFixedExportSettings(frameDimensions.width, frameDimensions.height),
    )
    const created = await exportApi.createJob(descriptor, {
      projectName: project.name,
      projectId: project.id,
      exportSlide: true,
    })
    setJobId(created.jobId)
    const snapshot = savePreviewSnapshot(engine)
    usePlaybackController.getState().pause()
    const previousCameraMode = useUiStore.getState().cameraAnimationMode
    useUiStore.getState().setCameraAnimationMode(true)
    try {
      const assets = new Set<string>()
      for (const clip of descriptor.slides[0]!.audio.clips)
        if (!clip.muted) assets.add(clip.assetId)
      for (const assetId of assets) {
        const audio = await resolveExportAudioBytes(engine, assetId)
        if (audio) {
          try {
            await exportApi.uploadAudio(created.jobId, {
              assetId,
              data: audio.data,
              mimeType: audio.mimeType,
            })
          } catch {
            /* Unavailable audio is handled as silence by the exporter. */
          }
        }
      }
      const timestamps = descriptor.slides[0]!.frameTimestamps
      for (let index = 0; index < timestamps.length; index += 1) {
        if (cancelRequested.current) throw new Error('Export cancelled')
        const timestamp = timestamps[index]!
        const data = await (
          captureFrame ??
          ((_id, time) => captureExportFrameAt(engine, slide.id, time, slide.duration))
        )(slide.id, timestamp)
        if (!data)
          throw new Error(
            `Could not capture frame ${index + 1}/${timestamps.length} for ${slide.name}`,
          )
        const status = await exportApi.uploadFrame(created.jobId, {
          slideId: slide.id,
          frameIndex: index,
          timestamp,
          data,
        })
        setProgress({ received: index + 1, expected: timestamps.length, status: status.status })
      }
      const completed = await exportApi.completeJob(created.jobId)
      if (completed.status !== 'done')
        throw new Error(completed.error ?? `Export failed: ${completed.status}`)
    } catch (err) {
      // A frame-capture/upload failure must release the backend's single job
      // slot and remove this slide's temporary frame directory.
      await exportApi.cancelJob(created.jobId).catch(() => undefined)
      throw err
    } finally {
      useUiStore.getState().setCameraAnimationMode(previousCameraMode)
      restorePreviewSnapshot(engine, snapshot)
    }
  }

  const handleGenerateSlides = async (slideIds: readonly string[]) => {
    if (!project || phase === 'working') return
    const missingCameraSlides = slideIds.filter((id) => cameraMissingIds.has(id))
    if (missingCameraSlides.length) {
      const names = selectable
        .filter((slide) => missingCameraSlides.includes(slide.id))
        .map((slide) => slide.name)
      setError(`Camera animation required for: ${names.join(', ')}.`)
      setPhase('error')
      return
    }
    const overwritten = slideIds.filter((id) => projectExports?.slides[id])
    if (
      overwritten.length &&
      !globalThis.confirm(
        `${overwritten.length} video(s) already exist. Regenerate and replace them?`,
      )
    )
      return
    setError(null)
    setPhase('working')
    cancelRequested.current = false
    setProgress({
      received: 0,
      expected: slideIds.reduce(
        (total, id) =>
          total +
          Math.round((selectable.find((s) => s.id === id)?.duration ?? 0) * EXPORT_VIDEO_FPS),
        0,
      ),
      status: 'queued',
    })
    try {
      for (const id of slideIds) {
        const slide = selectable.find((item) => item.id === id)
        if (!slide) continue
        setAction(`Generating ${slide.name}`)
        await generateSlideVideo(id)
        await refreshProjectExports()
      }
      setAction('Slide videos ready')
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Slide export failed')
      setPhase('error')
      await refreshProjectExports().catch(() => undefined)
    }
  }

  const handleJoinSlides = async () => {
    if (!project) return
    setPhase('working')
    setError(null)
    setAction('Joining slide videos')
    try {
      await exportApi.joinProjectExports(
        project.id,
        selectable.map((slide) => slide.id),
      )
      await refreshProjectExports()
      setAction('Joined video is up to date')
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Join failed')
      setPhase('error')
    }
  }

  const handleGenerateSrt = async () => {
    if (!project) return
    setPhase('working')
    setError(null)
    setAction('Generating SRT subtitles')
    try {
      const cues = buildExportSubtitleCues(
        project,
        selectable.map((slide) => slide.id),
      )
      await exportApi.saveProjectSubtitles(project.id, buildSrtDocument(cues))
      await refreshProjectExports()
      setAction('SRT subtitles saved')
      setPhase('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Subtitle generation failed')
      setPhase('error')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export video"
      data-testid="export-video-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 101,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== 'working') onClose()
      }}
    >
      <div
        style={{
          background: '#2a2a2a',
          border: '1px solid #444',
          borderRadius: 8,
          width: 520,
          maxHeight: '80vh',
          overflow: 'auto',
          padding: 16,
          color: '#e0e0e0',
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }}>Export video</h3>
        <button
          data-testid="export-preview-camera"
          onClick={previewCameraPath}
          style={{ display: 'block', marginBottom: 10, padding: '7px 12px' }}
        >
          View rendered camera path before export
        </button>
        <p style={{ margin: '0 0 12px', fontSize: 11, color: '#999' }}>
          Fixed 30 fps · {frameDimensions.width}×{frameDimensions.height} px · one MP4 per slide
        </p>

        <div
          data-testid="export-camera-preview-note"
          style={{
            marginBottom: 12,
            padding: 10,
            border: '1px solid #806b35',
            borderRadius: 4,
            background: '#332d20',
            fontSize: 12,
          }}
        >
          Export follows the animated camera for the entire video. Your free-navigation scene view
          may show a different area. Preview and scrub the camera path before exporting to check
          that every element stays in frame.
        </div>

        {blocked && (
          <p data-testid="export-blocked-message" style={{ fontSize: 12, color: '#ffb74d' }}>
            {blocked}
          </p>
        )}

        {!project || selectable.length === 0 ? (
          <p style={{ fontSize: 12 }}>No selectable slides. Add a slide with duration &gt; 0.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 8px' }}>
            {selectable.map((slide) => {
              const frames = Math.round(slide.duration * EXPORT_VIDEO_FPS)
              const cues = cueCounts.get(slide.id) ?? 0
              return (
                <li
                  key={slide.id}
                  style={{
                    marginBottom: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                    <input
                      type="checkbox"
                      data-testid={`export-slide-checkbox-${slide.id}`}
                      checked={selected.has(slide.id)}
                      onChange={() => toggleSlide(slide.id)}
                    />
                    <span>{slide.name}</span>
                    <span style={{ color: '#888' }}>
                      {slide.duration}s · {frames} frames · {cues} cues
                      {cameraMissingIds.has(slide.id) && (
                        <span style={{ color: '#ffb74d' }}> · no camera keyframes</span>
                      )}
                      {projectExports?.slides[slide.id] && (
                        <span style={{ color: '#9ccc65' }}> · generated</span>
                      )}
                    </span>
                  </label>
                  <button
                    data-testid={`export-slide-${slide.id}`}
                    disabled={phase === 'working' || cameraMissingIds.has(slide.id)}
                    onClick={() => void handleGenerateSlides([slide.id])}
                  >
                    {projectExports?.slides[slide.id] ? 'Regenerate' : 'Generate'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {zeroCount > 0 && (
          <p data-testid="export-zero-note" style={{ fontSize: 11, color: '#999' }}>
            {zeroCount} slide{zeroCount === 1 ? '' : 's'} with zero duration excluded.
          </p>
        )}

        <div
          data-testid="export-project-files"
          style={{ margin: '10px 0', padding: 9, background: '#222', fontSize: 11 }}
        >
          <div>
            Saved in: <code>{projectExports?.directory ?? exportRoot}</code>
          </div>
          <div>
            Joined video:{' '}
            {projectExports?.joinedReady
              ? projectExports.joinedOutdated
                ? 'outdated — join again'
                : 'up to date'
              : 'not generated'}
          </div>
          <div>
            Subtitles:{' '}
            {projectExports?.subtitlesReady
              ? projectExports.subtitlesOutdated
                ? 'outdated — generate again'
                : 'SRT generated'
              : 'not generated'}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          <button
            data-testid="export-generate-all"
            disabled={phase === 'working' || selectable.length === 0}
            onClick={() => void handleGenerateSlides(selectable.map((slide) => slide.id))}
          >
            Generate all slides
          </button>
          <button
            data-testid="export-join"
            disabled={
              phase === 'working' ||
              !selectable.length ||
              selectable.some((slide) => !projectExports?.slides[slide.id])
            }
            onClick={() => void handleJoinSlides()}
          >
            Join slides
          </button>
          <button
            data-testid="export-srt"
            disabled={phase === 'working'}
            onClick={() => void handleGenerateSrt()}
          >
            Generate SRT
          </button>
        </div>

        {cameraMissing.length > 0 && (
          <p data-testid="export-camera-note" style={{ fontSize: 11, color: '#ffb74d' }}>
            No camera keyframes on {cameraMissing.length} selected slide
            {cameraMissing.length === 1 ? '' : 's'} (
            {cameraMissing.map((slide) => slide.name).join(', ')}). Export renders exactly what the
            animated camera sees — add at least one camera keyframe (a single keyframe fixes the
            camera) or deselect the slide.
          </p>
        )}

        <p data-testid="export-totals" style={{ fontSize: 12, color: '#ccc' }}>
          {totals.cues} cues · {totals.duration.toFixed(1)}s · {totals.frames} frames
        </p>

        {phase === 'working' && (
          <p data-testid="export-progress" style={{ fontSize: 12 }}>
            {action || 'Frames'} · {progress.received}/{progress.expected} · {progress.status}
          </p>
        )}
        {error && (
          <p data-testid="export-error" style={{ fontSize: 12, color: '#ff8a80' }}>
            {error}
          </p>
        )}

        <details style={{ marginTop: 12, fontSize: 11, color: '#aaa' }}>
          <summary>Legacy full-project ZIP export</summary>
          <p>Exports the entire selected timeline as one ZIP. Prefer per-slide generation above.</p>
          <button
            data-testid="export-start"
            onClick={handleExport}
            disabled={!canExport || blocked !== null}
          >
            Export full project ZIP
          </button>
        </details>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          {phase === 'working' ? (
            <button data-testid="export-cancel" onClick={handleCancel}>
              Cancel
            </button>
          ) : (
            <>
              {phase === 'error' && (
                <button data-testid="export-retry" onClick={handleExport} disabled={!canExport}>
                  Retry
                </button>
              )}
              <button data-testid="export-close" onClick={onClose}>
                Close
              </button>
            </>
          )}
        </div>
        {phase === 'done' && (
          <p style={{ fontSize: 11, color: '#9ccc65' }}>{action || 'Export finished'}</p>
        )}
      </div>
    </div>
  )
}
