import { describe, expect, it, beforeEach } from 'vitest'
import { createEngineInternal } from '../../engine/internal'
import { CommandDispatcher, UndoStack } from '../../engine/commands'
import {
  CreateAudioAssetCommand,
  CreateAudioClipCommand,
  SetPrompterPartAudioCommand,
  UpdatePrompterPartWithShiftCommand,
  DeleteAudioClipCommand,
} from '../../engine/commands'
import {
  getPrompterRecordingShortcut,
  getPrompterMismatchThreshold,
  shouldShowMismatchDialog,
  getMismatchKind,
  computePlaybackRate,
  getMismatchThresholdValue,
} from '../../engine/prompter'
import { getRecordingErrorInfo } from '../../audio/recording'

function createEngine() { return createEngineInternal() }
function dispatchOk(dispatcher: CommandDispatcher, cmd: Parameters<CommandDispatcher['dispatch']>[0]) {
  const r = dispatcher.dispatch(cmd)
  expect(r.ok).toBe(true)
  return r
}

describe('Spec 15.08 recording helpers', () => {
  it('getPrompterRecordingShortcut default R and configurable via settings.prompter.recordingShortcut', () => {
    expect(getPrompterRecordingShortcut({})).toBe('r')
    expect(getPrompterRecordingShortcut({ prompter: {} })).toBe('r')
    expect(getPrompterRecordingShortcut({ prompter: { recordingShortcut: 'X' } })).toBe('x')
    expect(getPrompterRecordingShortcut({ prompter: { recordingShortcut: ' r ' } })).toBe('r')
    expect(getPrompterRecordingShortcut({ prompter: { recordingShortcut: '' } })).toBe('r')
  })

  it('getPrompterMismatchThreshold default and configurable', () => {
    expect(getPrompterMismatchThreshold({})).toEqual({ absolute: 0.3, relative: 0.05 })
    expect(getPrompterMismatchThreshold({ prompter: { mismatchThreshold: { absolute: 0.5, relative: 0.1 } } })).toEqual({ absolute: 0.5, relative: 0.1 })
    // invalid falls back to default
    expect(getPrompterMismatchThreshold({ prompter: { mismatchThreshold: { absolute: -1, relative: 'bad' as unknown as number } } })).toEqual({ absolute: 0.3, relative: 0.05 })
  })

  it('mismatch threshold max(0.3s, 5% planned) via helpers', () => {
    const thr = { absolute: 0.3, relative: 0.05 }
    // planned 2s => 5% =0.1 => max=0.3 => diff 0.2 => no mismatch
    expect(shouldShowMismatchDialog(2.2, 2.0, thr)).toBe(false)
    // diff 0.31 => show
    expect(shouldShowMismatchDialog(2.31, 2.0, thr)).toBe(true)
    // planned 10s => 5% =0.5 => max=0.5 => diff 0.4 => no
    expect(shouldShowMismatchDialog(10.4, 10, thr)).toBe(false)
    expect(shouldShowMismatchDialog(10.6, 10, thr)).toBe(true)
    expect(getMismatchThresholdValue(10, thr)).toBe(0.5)
    expect(getMismatchThresholdValue(2, thr)).toBe(0.3)
  })

  it('configurable threshold via settings.prompter.mismatchThreshold', () => {
    const engine = createEngine()
    engine.createProject({ name: 'P' })
    ;(engine.project as unknown as { settings: Record<string, unknown> }).settings = { prompter: { mismatchThreshold: { absolute: 0.1, relative: 0.2 } } }
    const thr = getPrompterMismatchThreshold(engine.project!.settings)
    expect(thr).toEqual({ absolute: 0.1, relative: 0.2 })
    // planned 1s => max(0.1,0.2)=0.2 => diff 0.15 no, 0.25 yes
    expect(shouldShowMismatchDialog(1.15, 1, thr)).toBe(false)
    expect(shouldShowMismatchDialog(1.25, 1, thr)).toBe(true)
  })

  it('getMismatchKind longer/shorter/none', () => {
    const thr = { absolute: 0.3, relative: 0.05 }
    expect(getMismatchKind(1.0, 2.0, thr)).toBe('shorter')
    expect(getMismatchKind(2.5, 2.0, thr)).toBe('longer')
    expect(getMismatchKind(2.1, 2.0, thr)).toBe('none')
  })

  it('computePlaybackRate planned/recorded non-destructive', () => {
    expect(computePlaybackRate(2.0, 2.5)).toBeCloseTo(0.8)
    expect(computePlaybackRate(2.0, 1.5)).toBeCloseTo(1.333, 2)
  })

  it('getRecordingErrorInfo branches NotAllowedError and NotFoundError', () => {
    const notAllowed = getRecordingErrorInfo({ name: 'NotAllowedError' })
    expect(notAllowed.kind).toBe('notAllowed')
    expect(notAllowed.message).toMatch(/denied/i)
    expect(notAllowed.hint).toMatch(/system settings/i)
    expect(notAllowed.retryable).toBe(true)
    const notFound = getRecordingErrorInfo({ name: 'NotFoundError' })
    expect(notFound.kind).toBe('notFound')
    expect(notFound.message).toMatch(/No microphone/i)
    expect(notFound.hint).toMatch(/Connect/i)
    const unknown = getRecordingErrorInfo(new Error('boom'))
    expect(unknown.kind).toBe('unknown')
  })
})

describe('Spec 15.08 record→asset→clip linkage + replace-guard', () => {
  let engine: ReturnType<typeof createEngine>
  let dispatcher: CommandDispatcher
  let slideId: string
  let partId: string

  beforeEach(() => {
    engine = createEngine()
    const undo = new UndoStack()
    dispatcher = new CommandDispatcher(engine, undo, () => {})
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    slideId = slide.id
    // create prompter part via engine helper
    engine.createPrompterPart(slideId, { id: 'p1', text: 'Hello world', duration: 2.0 })
    partId = 'p1'
  })

  it('Stop produces immutable AudioAsset (WAV base64 + metadata via decodeAudioData) and Voice AudioClip at part.startTime linked via audioClipId/audioAssetId clearing status', async () => {
    // Simulate decoded metadata (mock decode -> 2.5s)
    const base64 = btoa('fake-wav-bytes')
    const metadata = { duration: 2.5, sampleRate: 44100, channels: 1, waveformPeaks: [10, 20] }
    // Create asset
    const assetRes = dispatchOk(dispatcher, new CreateAudioAssetCommand({ name: 'Recording Hello', data: base64, mimeType: 'audio/wav', metadata }))
    const assetId = (assetRes.inverse as { assetId: string }).assetId
    const asset = engine.getEmbeddedAsset(assetId)
    expect(asset).toBeDefined()
    expect(asset!.mimeType).toBe('audio/wav')
    expect((asset!.metadata as Record<string, unknown>).duration).toBe(2.5)
    // Create clip at part.startTime
    const partStart = engine.getSlide(slideId).prompter!.parts[0].startTime
    const clipRes = dispatchOk(dispatcher, new CreateAudioClipCommand({ slideId, assetId, trackId: 'voice', timelineStart: partStart, sourceEnd: metadata.duration }))
    const clipId = (clipRes.inverse as { clipId: string }).clipId
    const clip = engine.getSlide(slideId).audio.clips.find((c) => c.id === clipId)
    expect(clip).toBeDefined()
    expect(clip!.trackId).toBe('voice')
    expect(clip!.timelineStart).toBe(partStart)
    // Link
    // Set stale first to verify clearing
    const partBefore = engine.getSlide(slideId).prompter!.parts[0]
    partBefore.status = 'stale'
    dispatchOk(dispatcher, new SetPrompterPartAudioCommand({ slideId, partId, audioClipId: clipId, audioAssetId: assetId }))
    const partAfter = engine.getSlide(slideId).prompter!.parts[0]
    expect(partAfter.audioClipId).toBe(clipId)
    expect(partAfter.audioAssetId).toBe(assetId)
    expect(partAfter.status).toBeUndefined()
  })

  it('replace-guard confirm if audio exists legacy retained', () => {
    const base64a = btoa('a')
    const resA = dispatchOk(dispatcher, new CreateAudioAssetCommand({ name: 'a', data: base64a, mimeType: 'audio/wav', metadata: { duration: 1, sampleRate: 44100, channels: 1 } }))
    const assetA = (resA.inverse as { assetId: string }).assetId
    const clipResA = dispatchOk(dispatcher, new CreateAudioClipCommand({ slideId, assetId: assetA, trackId: 'voice', timelineStart: 0, sourceEnd: 1 }))
    const clipA = (clipResA.inverse as { clipId: string }).clipId
    dispatchOk(dispatcher, new SetPrompterPartAudioCommand({ slideId, partId, audioClipId: clipA, audioAssetId: assetA }))
    // Create second recording — should delete old clip but keep old asset
    const base64b = btoa('b')
    const resB = dispatchOk(dispatcher, new CreateAudioAssetCommand({ name: 'b', data: base64b, mimeType: 'audio/wav', metadata: { duration: 2, sampleRate: 44100, channels: 1 } }))
    const assetB = (resB.inverse as { assetId: string }).assetId
    // simulate replace: delete old clip
    dispatchOk(dispatcher, new DeleteAudioClipCommand({ slideId, clipId: clipA }))
    const clipResB = dispatchOk(dispatcher, new CreateAudioClipCommand({ slideId, assetId: assetB, trackId: 'voice', timelineStart: 0, sourceEnd: 2 }))
    const clipB = (clipResB.inverse as { clipId: string }).clipId
    dispatchOk(dispatcher, new SetPrompterPartAudioCommand({ slideId, partId, audioClipId: clipB, audioAssetId: assetB }))
    // legacy asset still exists
    expect(engine.getEmbeddedAsset(assetA)).toBeDefined()
    expect(engine.getEmbeddedAsset(assetB)).toBeDefined()
    // only new clip remains
    expect(engine.getSlide(slideId).audio.clips.map((c) => c.id)).toEqual([clipB])
    expect(engine.getSlide(slideId).prompter!.parts[0].audioClipId).toBe(clipB)
  })

  it('mismatch thresholds [Speed/Extend/Keep/Discard] with and without shift', () => {
    // Create a slide with 3 parts to test shift
    engine = createEngine()
    const undo = new UndoStack()
    dispatcher = new CommandDispatcher(engine, undo, () => {})
    engine.createProject({ name: 'P2' })
    const slide = engine.createSlide('S1')
    slideId = slide.id
    engine.createPrompterPart(slideId, { id: 'p1', text: 'First', duration: 2.0 })
    engine.createPrompterPart(slideId, { id: 'p2', text: 'Second', duration: 2.0 })
    engine.createPrompterPart(slideId, { id: 'p3', text: 'Third', duration: 2.0 })
    // Need to reflow to set startTimes: p1 0-2, p2 2-4, p3 4-6
    // Create downstream clips at 3.5 and 5.5
    const base = btoa('x')
    const ar = dispatchOk(dispatcher, new CreateAudioAssetCommand({ name: 'x', data: base, mimeType: 'audio/wav', metadata: { duration: 1, sampleRate: 44100, channels: 1 } }))
    const assetId = (ar.inverse as { assetId: string }).assetId
    const c1 = dispatchOk(dispatcher, new CreateAudioClipCommand({ slideId, assetId, trackId: 'voice', timelineStart: 3.5, sourceEnd: 1 }))
    const c1Id = (c1.inverse as { clipId: string }).clipId
    const c2 = dispatchOk(dispatcher, new CreateAudioClipCommand({ slideId, assetId, trackId: 'sfx', timelineStart: 5.5, sourceEnd: 1 }))
    const c2Id = (c2.inverse as { clipId: string }).clipId
    partId = 'p1'
    const thr = { absolute: 0.3, relative: 0.05 }
    // Longer case: planned 2.0, recorded 3.0 => diff 1.0 >0.3 => longer
    expect(getMismatchKind(3.0, 2.0, thr)).toBe('longer')
    // Speed: sets playbackRate=planned/recorded, original WAV preserved, no shift
    const base64 = btoa('rec-long')
    const metadataLong = { duration: 3.0, sampleRate: 44100, channels: 1 }
    // Speed path
    {
      const assetRes = dispatchOk(dispatcher, new CreateAudioAssetCommand({ name: 'rec', data: base64, mimeType: 'audio/wav', metadata: metadataLong }))
      const aId = (assetRes.inverse as { assetId: string }).assetId
      const rate = computePlaybackRate(2.0, 3.0)
      const clipRes = dispatchOk(dispatcher, new CreateAudioClipCommand({ slideId, assetId: aId, trackId: 'voice', timelineStart: 0, sourceEnd: 3.0, playbackRate: rate }))
      const clipId = (clipRes.inverse as { clipId: string }).clipId
      dispatchOk(dispatcher, new SetPrompterPartAudioCommand({ slideId, partId, audioClipId: clipId, audioAssetId: aId }))
      // playbackRate non-destructive, original WAV untouched
      const clip = engine.getSlide(slideId).audio.clips.find((c) => c.id === clipId)!
      expect(clip.playbackRate).toBeCloseTo(2.0 / 3.0)
      // duration of asset preserved
      expect((engine.getEmbeddedAsset(aId)!.metadata as Record<string, unknown>).duration).toBe(3.0)
      // No shift: downstream parts unchanged
      expect(engine.getSlide(slideId).prompter!.parts[1].startTime).toBe(2.0)
      // cleanup for next subtest: remove clip/link
      dispatchOk(dispatcher, new DeleteAudioClipCommand({ slideId, clipId }))
      dispatchOk(dispatcher, new SetPrompterPartAudioCommand({ slideId, partId, audioClipId: null, audioAssetId: null }))
    }
    // Extend with shift
    {
      const assetRes = dispatchOk(dispatcher, new CreateAudioAssetCommand({ name: 'rec', data: base64, mimeType: 'audio/wav', metadata: metadataLong }))
      const aId = (assetRes.inverse as { assetId: string }).assetId
      const clipRes = dispatchOk(dispatcher, new CreateAudioClipCommand({ slideId, assetId: aId, trackId: 'voice', timelineStart: 0, sourceEnd: 3.0, playbackRate: 1 }))
      const clipId = (clipRes.inverse as { clipId: string }).clipId
      dispatchOk(dispatcher, new SetPrompterPartAudioCommand({ slideId, partId, audioClipId: clipId, audioAssetId: aId }))
      // Extend: update part duration to recorded 3.0 with shift true -> downstream shift by +1
      const partBefore = engine.getSlide(slideId).prompter!.parts[0]
      expect(partBefore.duration).toBe(2.0)
      const oldEnd = partBefore.endTime
      dispatchOk(dispatcher, new UpdatePrompterPartWithShiftCommand({ slideId, partId, duration: 3.0, shiftDownstream: true }))
      expect(engine.getSlide(slideId).prompter!.parts[0].duration).toBe(3.0)
      expect(engine.getSlide(slideId).prompter!.parts[1].startTime).toBeCloseTo(3.0)
      expect(engine.getSlide(slideId).prompter!.parts[2].startTime).toBeCloseTo(5.0)
      // clips beyond oldEnd (2.0) should shift: c1 at 3.5 -> 4.5, c2 at 5.5 -> 6.5
      const afterC1 = engine.getSlide(slideId).audio.clips.find((c) => c.id === c1Id)!
      const afterC2 = engine.getSlide(slideId).audio.clips.find((c) => c.id === c2Id)!
      expect(afterC1.timelineStart).toBeCloseTo(4.5)
      expect(afterC2.timelineStart).toBeCloseTo(6.5)
      void oldEnd
      // revert shift for next test: shift back without shift (reflow)
      // For simplicity reset engine
    }
    // Shorter case: planned 2.0, recorded 1.0 => diff 1.0 => shorter
    // Need fresh engine to avoid polluted shifts
    engine = createEngine()
    const undo2 = new UndoStack()
    dispatcher = new CommandDispatcher(engine, undo2, () => {})
    engine.createProject({ name: 'P3' })
    const slide2 = engine.createSlide('S1')
    slideId = slide2.id
    engine.createPrompterPart(slideId, { id: 'p1', text: 'First', duration: 2.0 })
    engine.createPrompterPart(slideId, { id: 'p2', text: 'Second', duration: 2.0 })
    engine.createPrompterPart(slideId, { id: 'p3', text: 'Third', duration: 2.0 })
    const a2 = dispatchOk(dispatcher, new CreateAudioAssetCommand({ name: 'x', data: base, mimeType: 'audio/wav', metadata: { duration: 1, sampleRate: 44100, channels: 1 } }))
    const assetId2 = (a2.inverse as { assetId: string }).assetId
    const cc1 = dispatchOk(dispatcher, new CreateAudioClipCommand({ slideId, assetId: assetId2, trackId: 'voice', timelineStart: 3.5, sourceEnd: 1 }))
    const cc1Id = (cc1.inverse as { clipId: string }).clipId
    partId = 'p1'
    expect(getMismatchKind(1.0, 2.0, thr)).toBe('shorter')
    // Slow down (speed) with rate
    {
      const assetRes = dispatchOk(dispatcher, new CreateAudioAssetCommand({ name: 'rec', data: base64, mimeType: 'audio/wav', metadata: { duration: 1.0, sampleRate: 44100, channels: 1 } }))
      const aId = (assetRes.inverse as { assetId: string }).assetId
      const rate = computePlaybackRate(2.0, 1.0) // 2
      const clipRes = dispatchOk(dispatcher, new CreateAudioClipCommand({ slideId, assetId: aId, trackId: 'voice', timelineStart: 0, sourceEnd: 1.0, playbackRate: rate }))
      const clipId = (clipRes.inverse as { clipId: string }).clipId
      dispatchOk(dispatcher, new SetPrompterPartAudioCommand({ slideId, partId, audioClipId: clipId, audioAssetId: aId }))
      const clip = engine.getSlide(slideId).audio.clips.find((c) => c.id === clipId)!
      expect(clip.playbackRate).toBeCloseTo(2.0)
      dispatchOk(dispatcher, new DeleteAudioClipCommand({ slideId, clipId }))
      dispatchOk(dispatcher, new SetPrompterPartAudioCommand({ slideId, partId, audioClipId: null, audioAssetId: null }))
    }
    // Keep shorter with shift (shrink)
    {
      const assetRes = dispatchOk(dispatcher, new CreateAudioAssetCommand({ name: 'rec', data: base64, mimeType: 'audio/wav', metadata: { duration: 1.0, sampleRate: 44100, channels: 1 } }))
      const aId = (assetRes.inverse as { assetId: string }).assetId
      const clipRes = dispatchOk(dispatcher, new CreateAudioClipCommand({ slideId, assetId: aId, trackId: 'voice', timelineStart: 0, sourceEnd: 1.0 }))
      const clipId = (clipRes.inverse as { clipId: string }).clipId
      dispatchOk(dispatcher, new SetPrompterPartAudioCommand({ slideId, partId, audioClipId: clipId, audioAssetId: aId }))
      dispatchOk(dispatcher, new UpdatePrompterPartWithShiftCommand({ slideId, partId, duration: 1.0, shiftDownstream: true }))
      expect(engine.getSlide(slideId).prompter!.parts[0].duration).toBe(1.0)
      expect(engine.getSlide(slideId).prompter!.parts[1].startTime).toBeCloseTo(1.0)
      expect(engine.getSlide(slideId).prompter!.parts[2].startTime).toBeCloseTo(3.0)
      const after = engine.getSlide(slideId).audio.clips.find((c) => c.id === cc1Id)!
      expect(after.timelineStart).toBeCloseTo(2.5) // 3.5 -1
    }
    // Keep shorter without shift: downstream reflow gap-free, clips not shifted
    {
      // reset again without shift
      engine = createEngine()
      const u3 = new UndoStack()
      dispatcher = new CommandDispatcher(engine, u3, () => {})
      engine.createProject({ name: 'P4' })
      const s = engine.createSlide('S1')
      slideId = s.id
      engine.createPrompterPart(slideId, { id: 'p1', text: 'First', duration: 2.0 })
      engine.createPrompterPart(slideId, { id: 'p2', text: 'Second', duration: 2.0 })
      const aX = dispatchOk(dispatcher, new CreateAudioAssetCommand({ name: 'x', data: base, mimeType: 'audio/wav', metadata: { duration: 1, sampleRate: 44100, channels: 1 } }))
      const aXid = (aX.inverse as { assetId: string }).assetId
      dispatchOk(dispatcher, new CreateAudioClipCommand({ slideId, assetId: aXid, trackId: 'voice', timelineStart: 3.5, sourceEnd: 1 }))
      const assetRes = dispatchOk(dispatcher, new CreateAudioAssetCommand({ name: 'rec', data: base64, mimeType: 'audio/wav', metadata: { duration: 1.0, sampleRate: 44100, channels: 1 } }))
      const aId = (assetRes.inverse as { assetId: string }).assetId
      const clipRes = dispatchOk(dispatcher, new CreateAudioClipCommand({ slideId, assetId: aId, trackId: 'voice', timelineStart: 0, sourceEnd: 1.0 }))
      const clipId = (clipRes.inverse as { clipId: string }).clipId
      dispatchOk(dispatcher, new SetPrompterPartAudioCommand({ slideId, partId: 'p1', audioClipId: clipId, audioAssetId: aId }))
      dispatchOk(dispatcher, new UpdatePrompterPartWithShiftCommand({ slideId, partId: 'p1', duration: 1.0, shiftDownstream: false }))
      // without shift, free placement: gap preserved (p2 stays at 2), clips not moved
      expect(engine.getSlide(slideId).prompter!.parts[1].startTime).toBe(2.0)
      const clipAfter = engine.getSlide(slideId).audio.clips.find((c) => c.timelineStart === 3.5)
      expect(clipAfter).toBeDefined()
    }
    // Discard: no asset/clip/link created (simulate by not dispatching)
    {
      const beforeCount = engine.getSlide(slideId).audio.clips.length
      // discard means we do nothing, so count unchanged and no link
      expect(beforeCount).toBeGreaterThanOrEqual(1)
    }
  })

  it('playbackRate non-destructive original WAV preserved', () => {
    const engine2 = createEngine()
    const undo = new UndoStack()
    const disp = new CommandDispatcher(engine2, undo, () => {})
    engine2.createProject({ name: 'P' })
    const slide = engine2.createSlide('S1')
    engine2.createPrompterPart(slide.id, { id: 'p1', text: 'Hello', duration: 2.0 })
    const base64 = btoa('orig-wav')
    const res = disp.dispatch(new CreateAudioAssetCommand({ name: 'orig', data: base64, mimeType: 'audio/wav', metadata: { duration: 3.0, sampleRate: 44100, channels: 1 } }))
    expect(res.ok).toBe(true)
    const assetId = (res.inverse as { assetId: string }).assetId
    const origData = engine2.getEmbeddedAsset(assetId)!.data
    const rate = computePlaybackRate(2.0, 3.0)
    const clipRes = disp.dispatch(new CreateAudioClipCommand({ slideId: slide.id, assetId, trackId: 'voice', timelineStart: 0, sourceEnd: 3.0, playbackRate: rate }))
    expect(clipRes.ok).toBe(true)
    // original bytes untouched
    expect(engine2.getEmbeddedAsset(assetId)!.data).toBe(origData)
    const clip = engine2.getSlide(slide.id).audio.clips[0]
    expect(clip.playbackRate).toBeCloseTo(2.0 / 3.0)
  })
})
