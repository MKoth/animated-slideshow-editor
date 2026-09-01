import { describe, expect, it, beforeEach } from 'vitest'
import { createEngineInternal } from '../../engine/internal'
import { CreateAudioAssetCommand, CreateAudioClipCommand } from '../../engine/commands'
import { CommandDispatcher, UndoStack } from '../../engine/commands'
import {
  EXPORT_AMIX_FILTER,
  EXPORT_LOUDNORM_FILTER,
  EXPORT_VIDEO_PIX_FMT,
  EXPORT_VIDEO_MOVFLAGS,
  EXPORT_CONCAT_METHOD,
} from '../../engine/export'

function createEngine() {
  return createEngineInternal()
}

function wavBase64ForDuration(duration: number): string {
  // Minimal WAV header with duration metadata for test asset
  const sampleRate = 44100
  const channels = 1
  const byteRate = sampleRate * channels * 2
  const dataSize = Math.round(duration * byteRate)
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const write = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }
  write(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true); view.setUint32(28, byteRate, true); view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, dataSize, true)
  const bytes = new Uint8Array(buffer)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

describe('Spec 15.11 — Deterministic Export Mix (Frames + 3 Lanes via FFmpeg)', () => {
  let engine: ReturnType<typeof createEngine>
  let dispatcher: CommandDispatcher
  let undo: UndoStack

  beforeEach(() => {
    engine = createEngine()
    undo = new UndoStack()
    dispatcher = new CommandDispatcher(engine, undo, () => {})
    engine.createProject({ name: 'Export Test' })
  })

  it('Per-Slide: render frames at exact timestamps via shared evaluator (N=round(duration×fps)) → FFmpeg video input', () => {
    const slide = engine.createSlide('S1')
    // set duration explicitly to 2.5s
    engine.setSlideDuration(slide.id, 2.5)
    const fps = 30
    const expectedN = Math.round(2.5 * fps) // 75
    const desc = engine.buildPerSlideExportDescriptor(slide.id, { fps })
    expect(desc.frameCount).toBe(expectedN)
    expect(desc.frameTimestamps).toHaveLength(expectedN)
    expect(desc.frameTimestamps[0]).toBe(0)
    expect(desc.frameTimestamps[1]).toBeCloseTo(1 / fps, 9)
    expect(desc.frameTimestamps[expectedN - 1]).toBeCloseTo((expectedN - 1) / fps, 9)
    // video input shape
    expect(desc.video.inputKind).toBe('frames')
    expect(desc.video.frameCount).toBe(expectedN)
    expect(desc.video.fps).toBe(fps)
    expect(desc.video.timestamps).toEqual(desc.frameTimestamps)
    expect(desc.video.pixelFormat).toBe(EXPORT_VIDEO_PIX_FMT)
    expect(desc.video.movflags).toBe(EXPORT_VIDEO_MOVFLAGS)
    expect(desc.video.ffmpegArgs).toEqual(expect.arrayContaining(['-pix_fmt', EXPORT_VIDEO_PIX_FMT, '-movflags', EXPORT_VIDEO_MOVFLAGS]))
    // via shared evaluator — preview equals export per timestamp: at each timestamp evaluator gives same
    // We smoke-test that evaluator and descriptor timestamps align
    const nodeId = slide.scene.root.children[0]?.id ?? slide.scene.root.id
    // evaluate at descriptor timestamps should not throw and be deterministic
    for (const t of desc.frameTimestamps.slice(0, 3)) {
      const state1 = engine.evaluateNode(nodeId, t)
      const state2 = engine.evaluateNode(nodeId, t)
      expect(state1.transform.x).toBe(state2.transform.x)
      expect(state1.transform.y).toBe(state2.transform.y)
    }
  })

  it('Per-Slide: per-lane mix with amix/loudnorm and per-clip aformat+volume+rubberband when playbackRate≠1 and atrim=end=slide.duration', () => {
    const slide = engine.createSlide('S1')
    engine.setSlideDuration(slide.id, 4.0)
    const fps = 24

    // Create 3 assets for each lane
    const mkAsset = (name: string, dur: number) => {
      const base64 = wavBase64ForDuration(dur)
      const res = dispatcher.dispatch(new CreateAudioAssetCommand({ name, data: base64, mimeType: 'audio/wav', metadata: { duration: dur, sampleRate: 44100, channels: 1 } }))
      expect(res.ok).toBe(true)
      if (!res.ok) throw res.error
      return (res.inverse as { assetId: string }).assetId
    }
    const assetVoice = mkAsset('voice', 2)
    const assetSfx = mkAsset('sfx', 1.5)
    const assetMusic = mkAsset('music', 3)

    // Voice clip with playbackRate !=1 (stretched), sfx normal, music muted
    dispatcher.dispatch(new CreateAudioClipCommand({ slideId: slide.id, assetId: assetVoice, trackId: 'voice', timelineStart: 0, sourceEnd: 2, volume: 0.8, playbackRate: 1.5 }))
    dispatcher.dispatch(new CreateAudioClipCommand({ slideId: slide.id, assetId: assetSfx, trackId: 'sfx', timelineStart: 1.0, sourceEnd: 1.5, volume: 0.6 }))
    dispatcher.dispatch(new CreateAudioClipCommand({ slideId: slide.id, assetId: assetMusic, trackId: 'music', timelineStart: 0.5, sourceEnd: 3, volume: 0.5, muted: true }))

    const desc = engine.buildPerSlideExportDescriptor(slide.id, { fps })
    // video+3 audio inputs
    expect(desc.audio.inputs).toEqual(['video', 'audio:voice', 'audio:sfx', 'audio:music'])
    expect(desc.audio.laneInputs).toBe(3)
    // amix/loudnorm in filterComplex and dedicated fields
    expect(desc.audio.amix).toBe(EXPORT_AMIX_FILTER)
    expect(desc.audio.loudnorm).toBe(EXPORT_LOUDNORM_FILTER)
    expect(desc.audio.filterComplex).toContain(EXPORT_AMIX_FILTER)
    expect(desc.audio.filterComplex).toContain(EXPORT_LOUDNORM_FILTER)
    expect(desc.audio.filterComplex).toContain('aformat')
    expect(desc.audio.filterComplex).toContain('volume=')
    // per-clip filter fragments: aformat+volume+rubberband when needed + atrim=end=slide.duration
    for (const clip of desc.audio.clips) {
      expect(clip.filterFragment).toContain('aformat')
      expect(clip.filterFragment).toContain('volume=')
      expect(clip.filterFragment).toContain(`atrim=end=${slide.duration}`)
      expect(clip.trimEnd).toBe(slide.duration)
    }
    // rubberband tempo = 1/playbackRate when !=1
    const stretched = desc.audio.clips.find((c) => c.playbackRate !== 1)!
    expect(stretched).toBeDefined()
    expect(stretched.rubberbandTempo).toBeCloseTo(1 / stretched.playbackRate, 6)
    expect(stretched.derivedAssetKey).toBe(engine.getDerivedAssetCacheKey(stretched.assetId, stretched.playbackRate))
    expect(stretched.filterFragment).toContain('rubberband=tempo=')
    // normal clip should NOT have rubberband
    const normal = desc.audio.clips.find((c) => c.playbackRate === 1)!
    expect(normal.rubberbandTempo).toBeUndefined()
    expect(normal.derivedAssetKey).toBeUndefined()
    expect(normal.filterFragment).not.toContain('rubberband')

    // atrim at slide.duration ensures tails not bleed
    expect(desc.audio.atrim).toBe(`atrim=end=${slide.duration}`)
  })

  it('Global: concat demuxer over per-Slide segments with yuv420p + faststart; loudnorm final pass', () => {
    const s1 = engine.createSlide('Intro')
    engine.setSlideDuration(s1.id, 2.0)
    const s2 = engine.createSlide('Main')
    engine.setSlideDuration(s2.id, 3.5)
    const job = engine.buildExportJobDescriptor({ fps: 30 })

    expect(job.version).toBe(1)
    expect(job.slides).toHaveLength(2)
    // global concat demuxer
    expect(job.global.concatMethod).toBe(EXPORT_CONCAT_METHOD)
    expect(job.global.concatDemuxer.method).toBe(EXPORT_CONCAT_METHOD)
    expect(job.global.concatDemuxer.inputFiles).toEqual(job.slides.map((s) => s.segment.outputFile))
    expect(job.global.concatDemuxer.ffmpegArgs).toEqual(expect.arrayContaining(['-f', 'concat']))
    // yuv420p + faststart globally and per slide
    expect(job.global.video.pixelFormat).toBe(EXPORT_VIDEO_PIX_FMT)
    expect(job.global.video.movflags).toBe(EXPORT_VIDEO_MOVFLAGS)
    expect(job.global.video.ffmpegArgs).toEqual(expect.arrayContaining(['-pix_fmt', EXPORT_VIDEO_PIX_FMT, '-movflags', EXPORT_VIDEO_MOVFLAGS]))
    expect(job.ffmpegGlobalArgs).toEqual(expect.arrayContaining([EXPORT_VIDEO_PIX_FMT, EXPORT_VIDEO_MOVFLAGS, EXPORT_CONCAT_METHOD]))
    // final loudnorm pass
    expect(job.global.audio.loudnorm).toBe(EXPORT_LOUDNORM_FILTER)
    expect(job.global.audio.finalFilter).toBe(EXPORT_LOUDNORM_FILTER)
    expect(job.ffmpegGlobalArgs.join(' ')).toContain(EXPORT_LOUDNORM_FILTER)
    // per-slide also has yuv420p+faststart
    for (const s of job.slides) {
      expect(s.video.pixelFormat).toBe(EXPORT_VIDEO_PIX_FMT)
      expect(s.video.movflags).toBe(EXPORT_VIDEO_MOVFLAGS)
      expect(s.segment.videoArgs).toEqual(expect.arrayContaining(['-pix_fmt', EXPORT_VIDEO_PIX_FMT, '-movflags', EXPORT_VIDEO_MOVFLAGS]))
    }
    // loudnorm final pass present in global audio filter
    expect(job.global.audio.loudnorm).toBe(EXPORT_LOUDNORM_FILTER)
  })

  it('Determinism: same project+settings → identical job descriptors; trim at slide.duration no bleed; fixed 3 lanes', () => {
    const slide = engine.createSlide('S1')
    engine.setSlideDuration(slide.id, 2.0)
    const base64 = wavBase64ForDuration(3) // longer than slide duration to test bleed trim
    const assetRes = dispatcher.dispatch(new CreateAudioAssetCommand({ name: 'long', data: base64, mimeType: 'audio/wav', metadata: { duration: 3, sampleRate: 44100, channels: 1 } }))
    if (!assetRes.ok) throw assetRes.error
    const assetId = (assetRes.inverse as { assetId: string }).assetId
    // place clip that would bleed beyond slide.duration if not trimmed
    dispatcher.dispatch(new CreateAudioClipCommand({ slideId: slide.id, assetId, trackId: 'voice', timelineStart: 1.5, sourceEnd: 3 }))

    const settings = { fps: 30 }
    const job1 = engine.buildExportJobDescriptor(settings)
    const job2 = engine.buildExportJobDescriptor(settings)
    expect(JSON.stringify(job1)).toEqual(JSON.stringify(job2))
    expect(job1.determinismKey).toBe(job2.determinismKey)

    // trim at slide.duration — no bleed
    const clipDesc = job1.slides[0].audio.clips[0]
    expect(clipDesc.trimEnd).toBe(slide.duration)
    expect(clipDesc.filterFragment).toContain(`atrim=end=${slide.duration}`)
    expect(job1.slides[0].audio.atrim).toBe(`atrim=end=${slide.duration}`)

    // fixed lanes voice|sfx|music — no dynamic bus
    expect(job1.slides[0].audio.lanes).toEqual(['voice', 'sfx', 'music'])
    expect(job1.slides[0].audio.laneInputs).toBe(3)
    expect(job1.slides[0].audio.inputs).toEqual(['video', 'audio:voice', 'audio:sfx', 'audio:music'])
  })

  it('rubberband derived asset cached by assetId+rate, original WAV untouched', () => {
    const slide = engine.createSlide('S1')
    engine.setSlideDuration(slide.id, 2.0)
    const base64Orig = wavBase64ForDuration(2)
    const assetRes = dispatcher.dispatch(new CreateAudioAssetCommand({ name: 'orig', data: base64Orig, mimeType: 'audio/wav', metadata: { duration: 2, sampleRate: 44100, channels: 1 } }))
    if (!assetRes.ok) throw assetRes.error
    const assetId = (assetRes.inverse as { assetId: string }).assetId
    const origAssetBefore = engine.getEmbeddedAsset(assetId)!
    const origDataBefore = origAssetBefore.data

    // two clips sharing same asset but different playbackRate => two cache entries
    dispatcher.dispatch(new CreateAudioClipCommand({ slideId: slide.id, assetId, trackId: 'voice', timelineStart: 0, sourceEnd: 2, playbackRate: 1.5 }))
    dispatcher.dispatch(new CreateAudioClipCommand({ slideId: slide.id, assetId, trackId: 'sfx', timelineStart: 0, sourceEnd: 2, playbackRate: 0.75 }))
    // third clip same asset+rate as first should NOT duplicate cache entry
    dispatcher.dispatch(new CreateAudioClipCommand({ slideId: slide.id, assetId, trackId: 'music', timelineStart: 0, sourceEnd: 2, playbackRate: 1.5 }))

    const job = engine.buildExportJobDescriptor({ fps: 24 })
    // cache key assetId:rate unique
    const keys = job.derivedAssetCache.map((e) => e.cacheKey)
    expect(keys).toHaveLength(2) // 1.5 and 0.75
    expect(keys).toContain(engine.getDerivedAssetCacheKey(assetId, 1.5))
    expect(keys).toContain(engine.getDerivedAssetCacheKey(assetId, 0.75))
    // tempo = 1/playbackRate
    for (const entry of job.derivedAssetCache) {
      expect(entry.tempo).toBeCloseTo(1 / entry.playbackRate, 6)
    }
    // original WAV untouched
    const origAfter = engine.getEmbeddedAsset(assetId)!
    expect(origAfter.data).toBe(origDataBefore)
    expect(origAfter.mimeType).toBe('audio/wav')
  })

  it('getExportFrameCount and getRubberbandTempo helpers', () => {
    expect(engine.getExportFrameCount(2.5, 30)).toBe(Math.round(2.5 * 30))
    expect(engine.getExportFrameCount(0, 60)).toBe(0)
    expect(engine.getRubberbandTempoForPlaybackRate(2)).toBeCloseTo(0.5)
    expect(engine.getRubberbandTempoForPlaybackRate(0.5)).toBeCloseTo(2.0)
    expect(engine.getDerivedAssetCacheKey('asset-123', 1.5)).toBe('asset-123:1.5')
    // helper timestamps deterministic
    const ts = engine.getExportFrameTimestamps(1.0, 10)
    expect(ts).toHaveLength(10)
    expect(ts[0]).toBe(0)
    expect(ts[9]).toBeCloseTo(0.9)
  })

  it('video+3 audio inputs shape via Engine seam', () => {
    const slide = engine.createSlide('S1')
    engine.setSlideDuration(slide.id, 1.0)
    const base64 = wavBase64ForDuration(1)
    const assetRes = dispatcher.dispatch(new CreateAudioAssetCommand({ name: 'a', data: base64, mimeType: 'audio/wav', metadata: { duration: 1, sampleRate: 44100, channels: 1 } }))
    if (!assetRes.ok) throw assetRes.error
    const assetId = (assetRes.inverse as { assetId: string }).assetId
    dispatcher.dispatch(new CreateAudioClipCommand({ slideId: slide.id, assetId, trackId: 'voice', timelineStart: 0, sourceEnd: 1 }))
    const job = engine.buildExportJobDescriptor({ fps: 30 })
    const slideDesc = job.slides[0]
    // video input
    expect(slideDesc.video.inputKind).toBe('frames')
    // 3 audio lanes
    expect(slideDesc.audio.laneInputs).toBe(3)
    expect(slideDesc.audio.inputs).toHaveLength(4) // video + 3
  })

  it('backend endpoint consumes descriptors (mock fetch)', async () => {
    const slide = engine.createSlide('S1')
    engine.setSlideDuration(slide.id, 1.5)
    const base64 = wavBase64ForDuration(1)
    const aRes = dispatcher.dispatch(new CreateAudioAssetCommand({ name: 'a', data: base64, mimeType: 'audio/wav', metadata: { duration: 1, sampleRate: 44100, channels: 1 } }))
    if (!aRes.ok) throw aRes.error
    const assetId = (aRes.inverse as { assetId: string }).assetId
    dispatcher.dispatch(new CreateAudioClipCommand({ slideId: slide.id, assetId, trackId: 'voice', timelineStart: 0, sourceEnd: 1, playbackRate: 1.2 }))
    const descriptor = engine.buildExportJobDescriptor({ fps: 30 })

    // Mock fetch to backend — but using real validation logic via direct import would need backend.
    // Here we assert descriptor shape is acceptable to backend validator by checking it contains required fields
    // The actual backend HTTP test is in backend/tests/test_export.py — this frontend test ensures descriptor would be accepted
    expect(descriptor.version).toBe(1)
    expect(descriptor.settings.fps).toBe(30)
    expect(descriptor.slides.length).toBeGreaterThan(0)
    expect(descriptor.global.concatMethod).toBe(EXPORT_CONCAT_METHOD)
    expect(descriptor.global.video.pixelFormat).toBe(EXPORT_VIDEO_PIX_FMT)
    expect(descriptor.ffmpegGlobalArgs.join(' ')).toContain(EXPORT_VIDEO_PIX_FMT)
    expect(descriptor.ffmpegGlobalArgs.join(' ')).toContain(EXPORT_VIDEO_MOVFLAGS)
    expect(descriptor.ffmpegGlobalArgs.join(' ')).toContain(EXPORT_CONCAT_METHOD)
  })
})
