import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ExportVideoDialog } from '../components/export/ExportVideoDialog'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { ApiClient, ApiError } from '../api/apiClient'
import { ExportApi } from '../api/exportApi'
import { AddKeyframeCommand, CommandDispatcher, UndoStack } from '../engine/commands'

function animateCamera(internal: Engine, slideId: string): void {
  const slide = internal.getSlide(slideId)
  const dispatcher = new CommandDispatcher(internal, new UndoStack(), () => {})
  const result = dispatcher.dispatch(
    new AddKeyframeCommand({
      target: { kind: 'node', nodeId: slide.scene.camera.id, property: 'positionX' },
      time: 0,
      value: 0,
    }),
  )
  if (!result.ok) throw result.error
}

function makeEngineWithSlides(): { internal: Engine; readonly: ReturnType<typeof toReadOnly> } {
  const internal = createEngineInternal()
  internal.createProject({ name: 'My Lesson!' })
  const s1 = internal.createSlide('S1')
  internal.setSlideDuration(s1.id, 2)
  internal.createPrompterPart(s1.id, { id: 'p1', text: 'Hello', duration: 1 })
  internal.createPrompterPart(s1.id, { id: 'p2', text: 'World', duration: 1 })
  const s2 = internal.createSlide('S2')
  internal.setSlideDuration(s2.id, 3)
  internal.createPrompterPart(s2.id, { id: 'q1', text: 'Again', duration: 1.5 })
  return { internal, readonly: toReadOnly(internal) }
}

function makeApi(overrides: Partial<ExportApi> = [] as unknown as Partial<ExportApi>): ExportApi {
  const api = new ExportApi(new ApiClient())
  // Default stubs: no running jobs, instant done job.
  api.listJobs = vi.fn().mockResolvedValue([])
  api.createJob = vi.fn().mockResolvedValue({
    jobId: 'job-1',
    status: 'queued',
    version: 1,
    settings: {},
    expectedFrameCount: 150,
    totalDuration: 5,
    totalFrames: 150,
    determinismKey: 'k',
    concatMethod: 'concat demuxer',
    videoPixelFormat: 'yuv420p',
    videoMovflags: '+faststart',
    audioLoudnorm: 'loudnorm=I=-16:TP=-1.5:LRA=11',
  })
  api.uploadFrame = vi.fn().mockImplementation(async (jobId: string) => ({
    jobId,
    status: 'rendering',
    version: 1,
    settings: {},
    expectedFrameCount: 150,
    totalDuration: 5,
    totalFrames: 150,
    determinismKey: 'k',
    concatMethod: 'concat demuxer',
    videoPixelFormat: 'yuv420p',
    videoMovflags: '+faststart',
    audioLoudnorm: 'loudnorm',
  }))
  api.completeJob = vi.fn().mockResolvedValue({
    jobId: 'job-1',
    status: 'done',
    version: 1,
    settings: {},
    expectedFrameCount: 150,
    totalDuration: 5,
    totalFrames: 150,
    determinismKey: 'k',
    concatMethod: 'concat demuxer',
    videoPixelFormat: 'yuv420p',
    videoMovflags: '+faststart',
    audioLoudnorm: 'loudnorm',
    artifactReady: true,
  })
  api.getJob = vi.fn().mockImplementation(async (jobId: string) => ({
    jobId,
    status: 'done',
    version: 1,
    settings: {},
    expectedFrameCount: 150,
    totalDuration: 5,
    totalFrames: 150,
    determinismKey: 'k',
    concatMethod: 'concat demuxer',
    videoPixelFormat: 'yuv420p',
    videoMovflags: '+faststart',
    audioLoudnorm: 'loudnorm',
    artifactReady: true,
  }))
  api.downloadArtifact = vi.fn().mockResolvedValue(new Blob(['zip'], { type: 'application/zip' }))
  api.uploadAudio = vi.fn().mockResolvedValue({ jobId: 'job-1', assetId: 'a', stored: true })
  api.cancelJob = vi.fn().mockResolvedValue({
    jobId: 'job-1',
    status: 'cancelled',
    version: 1,
    settings: {},
    expectedFrameCount: 150,
    totalDuration: 5,
    totalFrames: 150,
    determinismKey: 'k',
    concatMethod: 'concat demuxer',
    videoPixelFormat: 'yuv420p',
    videoMovflags: '+faststart',
    audioLoudnorm: 'loudnorm',
  })
  Object.assign(api, overrides)
  return api
}

beforeEach(() => {
  vi.restoreAllMocks()
  // jsdom URL.createObjectURL is undefined — stub for download.
  ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = vi
    .fn()
    .mockReturnValue('blob:mock')
  ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn()
})

describe('ExportVideoDialog', () => {
  it('checkboxes default to all, totals show cue counts + duration + frames', async () => {
    const { readonly } = makeEngineWithSlides()
    const api = makeApi()
    render(<ExportVideoDialog engine={readonly} exportApi={api} onClose={() => {}} />)

    const dialog = await screen.findByTestId('export-video-dialog')
    expect(dialog).toBeInTheDocument()
    const boxes = screen.getAllByRole('checkbox')
    // 2 slides + subtitles toggle
    expect(boxes).toHaveLength(3)
    const slideBoxes = boxes.slice(0, 2)
    for (const box of slideBoxes) expect(box).toBeChecked()
    // 2 + 1 cues, 5s, 150 frames (2*30 + 3*30)
    expect(screen.getByTestId('export-totals')).toHaveTextContent('3 cues')
    expect(screen.getByTestId('export-totals')).toHaveTextContent('5.0s')
    expect(screen.getByTestId('export-totals')).toHaveTextContent('150 frames')
    expect(screen.getByTestId('export-start')).not.toBeDisabled()
  })

  it('zero-duration note, empty selection disables export', async () => {
    const internal = createEngineInternal()
    internal.createProject({ name: 'Demo' })
    const s1 = internal.createSlide('S1')
    internal.setSlideDuration(s1.id, 2)
    const zero = internal.createSlide('Zero')
    zero.duration = 0
    const readonly = toReadOnly(internal)
    const api = makeApi()
    render(<ExportVideoDialog engine={readonly} exportApi={api} onClose={() => {}} />)
    expect(await screen.findByTestId('export-zero-note')).toHaveTextContent('1 slide')

    const user = userEvent.setup()
    await user.click(screen.getByTestId(`export-slide-checkbox-${s1.id}`))
    await waitFor(() => {
      expect(screen.getByTestId('export-start')).toBeDisabled()
    })
  })

  it('block-on-running message when a job is active or creation returns 409', async () => {
    const { readonly } = makeEngineWithSlides()
    const api = makeApi({
      listJobs: vi.fn().mockResolvedValue([
        {
          jobId: 'running',
          status: 'rendering',
          version: 1,
          settings: {},
          expectedFrameCount: 10,
          totalDuration: 1,
          totalFrames: 10,
          determinismKey: 'k',
          concatMethod: 'concat demuxer',
          videoPixelFormat: 'yuv420p',
          videoMovflags: '+faststart',
          audioLoudnorm: 'loudnorm',
        },
      ]),
    } as unknown as Partial<ExportApi>)
    const first = render(<ExportVideoDialog engine={readonly} exportApi={api} onClose={() => {}} />)
    expect(await screen.findByTestId('export-blocked-message')).toHaveTextContent('already running')
    expect(screen.getByTestId('export-start')).toBeDisabled()
    first.unmount()

    // 409 on create also surfaces the blocked message
    const api2 = makeApi({
      createJob: vi
        .fn()
        .mockRejectedValue(
          new ApiError('conflict', 409, '/api/export/jobs', 'export already in progress'),
        ),
    } as unknown as Partial<ExportApi>)
    const { internal: internal2, readonly: ro2 } = makeEngineWithSlides()
    for (const slide of internal2.project!.slides) animateCamera(internal2, slide.id)
    render(<ExportVideoDialog engine={ro2} exportApi={api2} onClose={() => {}} />)
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('export-start'))
    expect(await screen.findByTestId('export-blocked-message')).toHaveTextContent('already running')
  })

  it('full flow uploads frames, completes, and downloads the ZIP', async () => {
    const { internal, readonly } = makeEngineWithSlides()
    // Shrink durations so the frame loop stays fast in jsdom.
    for (const slide of internal.project!.slides) slide.duration = 0.2
    for (const slide of internal.project!.slides) animateCamera(internal, slide.id)
    const api = makeApi()
    // Expected frames: 0.2*30=6 per slide, 12 total.
    render(
      <ExportVideoDialog
        engine={readonly}
        exportApi={api}
        onClose={() => {}}
        captureFrame={async () => 'data:image/png;base64,AAA'}
      />,
    )
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('export-start'))
    await waitFor(() => {
      expect(api.createJob).toHaveBeenCalled()
    })
    await waitFor(
      () => {
        expect(api.completeJob).toHaveBeenCalled()
      },
      { timeout: 5000 },
    )
    await waitFor(() => {
      expect(api.downloadArtifact).toHaveBeenCalled()
    })
  })

  it('uploads embedded audio bytes for unmuted clips before encoding', async () => {
    const { CommandDispatcher, UndoStack } = await import('../engine/commands')
    const { CreateAudioAssetCommand, CreateAudioClipCommand } = await import('../engine/commands')
    const internal = createEngineInternal()
    internal.createProject({ name: 'Audio Export' })
    const slide = internal.createSlide('S1')
    internal.setSlideDuration(slide.id, 0.2)
    const undo = new UndoStack()
    const dispatcher = new CommandDispatcher(internal, undo, () => {})
    const sampleRate = 44100
    const dataSize = sampleRate * 2
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)
    const write = (off: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
    }
    write(0, 'RIFF')
    view.setUint32(4, 36 + dataSize, true)
    write(8, 'WAVE')
    const bytes = new Uint8Array(buffer)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    const assetRes = dispatcher.dispatch(
      new CreateAudioAssetCommand({
        name: 'voice',
        data: btoa(bin),
        mimeType: 'audio/wav',
        metadata: { duration: 1, sampleRate, channels: 1 },
      }),
    )
    expect(assetRes.ok).toBe(true)
    if (!assetRes.ok) throw assetRes.error
    const assetId = (assetRes.inverse as { assetId: string }).assetId
    dispatcher.dispatch(
      new CreateAudioClipCommand({
        slideId: slide.id,
        assetId,
        trackId: 'voice',
        timelineStart: 0,
        sourceEnd: 0.2,
      }),
    )
    const readonly = toReadOnly(internal)
    for (const slide of internal.project!.slides) animateCamera(internal, slide.id)
    const api = makeApi()
    render(
      <ExportVideoDialog
        engine={readonly}
        exportApi={api}
        onClose={() => {}}
        captureFrame={async () => 'data:image/png;base64,AAA'}
      />,
    )
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('export-start'))
    await waitFor(
      () => {
        expect(api.uploadAudio).toHaveBeenCalledWith(
          'job-1',
          expect.objectContaining({ assetId, mimeType: 'audio/wav' }),
        )
      },
      { timeout: 5000 },
    )
  })

  it('refuses export when a selected slide has no camera keyframes', async () => {
    const { internal, readonly } = makeEngineWithSlides()
    for (const slide of internal.project!.slides) slide.duration = 0.2
    // Animate only the first slide's camera.
    animateCamera(internal, internal.project!.slides[0]!.id)
    const api = makeApi()
    render(
      <ExportVideoDialog
        engine={readonly}
        exportApi={api}
        onClose={() => {}}
        captureFrame={async () => 'data:image/png;base64,AAA'}
      />,
    )
    // The dialog names the offending slide before anything is uploaded.
    expect(await screen.findByTestId('export-camera-note')).toHaveTextContent('S2')
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('export-start'))
    expect(await screen.findByTestId('export-error')).toHaveTextContent('Camera animation required')
    expect(await screen.findByTestId('export-error')).toHaveTextContent('S2')
    expect(api.createJob).not.toHaveBeenCalled()
  })

  it('fails loudly when frames cannot be captured instead of uploading placeholders', async () => {
    const { internal, readonly } = makeEngineWithSlides()
    for (const slide of internal.project!.slides) slide.duration = 0.2
    for (const slide of internal.project!.slides) animateCamera(internal, slide.id)
    const api = makeApi()
    render(
      <ExportVideoDialog
        engine={readonly}
        exportApi={api}
        onClose={() => {}}
        captureFrame={async () => null}
      />,
    )
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('export-start'))
    expect(await screen.findByTestId('export-error')).toHaveTextContent('Could not capture frame')
    expect(api.uploadFrame).not.toHaveBeenCalled()
    expect(api.completeJob).not.toHaveBeenCalled()
  })
})
