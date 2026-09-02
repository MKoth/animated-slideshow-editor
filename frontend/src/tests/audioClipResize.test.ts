import { beforeEach, describe, expect, it } from 'vitest'
import { createEngineInternal } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { TrimAudioClipCommand } from '../engine/commands/trimAudioClipCommand'
import { SetAudioClipPlaybackRateCommand } from '../engine/commands/setAudioClipPlaybackRateCommand'
import {
  createAudioClip,
  computeAudioClipTrimPatch,
  computeAudioClipStretchPlaybackRate,
  getAudioClipPlaybackDuration,
  getAudioClipSourceDuration,
} from '../engine/audioClip'
import { getDerivedAssetCacheKey, getRubberbandTempoForPlaybackRate } from '../engine/export'
import { useAudioResizePreferenceStore } from '../stores/audioResizePreferenceStore'

describe('Issue #246 — Audio clip resize: Trim vs Time-stretch', () => {
  beforeEach(() => {
    localStorage.clear()
    useAudioResizePreferenceStore.setState({
      preferences: { voice: null, sfx: null, music: null },
    })
    useAudioResizePreferenceStore.persist.clearStorage()
  })

  describe('pure helpers', () => {
    it('computeAudioClipTrimPatch — right handle expands sourceEnd', () => {
      const clip = createAudioClip({
        id: 'c1',
        assetId: 'a1',
        trackId: 'voice',
        timelineStart: 0,
        sourceStart: 0,
        sourceEnd: 2,
        playbackRate: 1,
      })
      // drag right outward by dt 0.5s playback => sourceEnd increases by 0.5
      const patch = computeAudioClipTrimPatch(clip, 'right', 0.5)
      expect(patch).not.toBeNull()
      expect(patch!.sourceEnd).toBeCloseTo(2.5, 6)
      expect(patch!.sourceStart).toBeUndefined()
    })

    it('computeAudioClipTrimPatch — left handle trims sourceStart', () => {
      const clip = createAudioClip({
        id: 'c1',
        assetId: 'a1',
        trackId: 'voice',
        timelineStart: 0,
        sourceStart: 0.5,
        sourceEnd: 2.5,
        playbackRate: 1,
      })
      // dragging left right by 0.3 shrinks from start
      const patch = computeAudioClipTrimPatch(clip, 'left', 0.3)
      expect(patch!.sourceStart).toBeCloseTo(0.8, 6)
    })

    it('computeAudioClipTrimPatch returns null for no change', () => {
      const clip = createAudioClip({
        id: 'c1',
        assetId: 'a1',
        trackId: 'voice',
        timelineStart: 0,
        sourceStart: 0,
        sourceEnd: 2,
        playbackRate: 2,
      })
      const patch = computeAudioClipTrimPatch(clip, 'right', 0)
      expect(patch).toBeNull()
    })

    it('computeAudioClipStretchPlaybackRate — right handle increases duration => rate decreases, source preserved', () => {
      const clip = createAudioClip({
        id: 'c1',
        assetId: 'a1',
        trackId: 'music',
        timelineStart: 0,
        sourceStart: 0,
        sourceEnd: 2,
        playbackRate: 1,
      })
      // sourceDuration 2, playback 2, drag right by +1 (desired playback 3) => newRate = 2/3 ≈0.666
      const rate = computeAudioClipStretchPlaybackRate(clip, 'right', 1)
      expect(rate).toBeCloseTo(2 / 3, 6)
    })

    it('computeAudioClipStretchPlaybackRate — left handle symmetric', () => {
      const clip = createAudioClip({
        id: 'c1',
        assetId: 'a1',
        trackId: 'sfx',
        timelineStart: 0,
        sourceStart: 0,
        sourceEnd: 4,
        playbackRate: 1,
      })
      // playback 4, drag left right by +0.5 shrinks desired to 3.5 => rate =4/3.5
      const rate = computeAudioClipStretchPlaybackRate(clip, 'left', 0.5)
      expect(rate).toBeCloseTo(4 / 3.5, 6)
    })

    it('stretch rate clamps minimal playback to 0.01', () => {
      const clip = createAudioClip({
        id: 'c1',
        assetId: 'a1',
        trackId: 'voice',
        timelineStart: 0,
        sourceStart: 0,
        sourceEnd: 1,
        playbackRate: 1,
      })
      // huge negative drag right -> desired would be negative but clamped to 0.01 => rate =1/0.01=100
      const rate = computeAudioClipStretchPlaybackRate(clip, 'right', -5)
      expect(rate).toBeCloseTo(1 / 0.01, 6)
    })

    it('stretch rate preserves source duration invariant playback = source / rate', () => {
      const clip = createAudioClip({
        id: 'c1',
        assetId: 'a1',
        trackId: 'voice',
        timelineStart: 0,
        sourceStart: 0,
        sourceEnd: 3,
        playbackRate: 1.5,
      })
      const source = getAudioClipSourceDuration(clip)
      const currentPlayback = getAudioClipPlaybackDuration(clip)
      expect(currentPlayback).toBeCloseTo(2, 6) // 3/1.5
      const rate = computeAudioClipStretchPlaybackRate(clip, 'right', 1) // desired playback 3
      expect(rate).not.toBeNull()
      const desired = 3
      expect(source / rate!).toBeCloseTo(desired, 6)
    })
  })

  describe('Trim mutates sourceStart/sourceEnd; Stretch sets playbackRate and preserves content', () => {
    it('Trim via command mutates source, playbackRate unchanged', () => {
      const engine = createEngineInternal()
      engine.createProject({ name: 'P' })
      const slide = engine.createSlide('S1')
      engine.embedAsset({
        id: 'a1',
        name: 'orig.wav',
        data: 'data:audio/wav;base64,AAA=',
        mimeType: 'audio/wav',
        metadata: { duration: 4, sampleRate: 44100, channels: 1 },
      })
      const clip = engine.createAudioClip(slide.id, {
        assetId: 'a1',
        trackId: 'voice',
        timelineStart: 0,
        sourceStart: 0,
        sourceEnd: 4,
        playbackRate: 1,
      })
      const undo = new UndoStack()
      const dispatcher = new CommandDispatcher(engine, undo, () => {})
      const patch = computeAudioClipTrimPatch(clip, 'right', -1) // shrink by 1 => sourceEnd 3
      expect(patch!.sourceEnd).toBeCloseTo(3, 6)
      const res = dispatcher.dispatch(
        new TrimAudioClipCommand({
          slideId: slide.id,
          clipId: clip.id,
          sourceEnd: patch!.sourceEnd,
        }),
      )
      expect(res.ok).toBe(true)
      const after = engine.getSlide(slide.id).audio.clips.find((c) => c.id === clip.id)!
      expect(after.sourceEnd).toBeCloseTo(3, 6)
      expect(after.sourceStart).toBe(0)
      expect(after.playbackRate).toBe(1)
      expect(getAudioClipSourceDuration(after)).toBeCloseTo(3, 6)
      // original asset unchanged
      const asset = engine.getEmbeddedAsset('a1')!
      expect(asset.data).toBe('data:audio/wav;base64,AAA=')
      expect((asset.metadata as Record<string, unknown>).duration).toBe(4)
    })

    it('Stretch via command sets playbackRate, preserves source', () => {
      const engine = createEngineInternal()
      engine.createProject({ name: 'P' })
      const slide = engine.createSlide('S1')
      engine.embedAsset({
        id: 'a1',
        name: 'orig.wav',
        data: 'data:audio/wav;base64,AAA=',
        mimeType: 'audio/wav',
        metadata: { duration: 4, sampleRate: 44100, channels: 1 },
      })
      const clip = engine.createAudioClip(slide.id, {
        assetId: 'a1',
        trackId: 'sfx',
        timelineStart: 0,
        sourceStart: 0,
        sourceEnd: 4,
        playbackRate: 1,
      })
      const undo = new UndoStack()
      const dispatcher = new CommandDispatcher(engine, undo, () => {})
      const newRate = computeAudioClipStretchPlaybackRate(clip, 'right', 2) // desired playback 6 => rate 0.666
      expect(newRate).toBeCloseTo(4 / 6, 6)
      const res = dispatcher.dispatch(
        new SetAudioClipPlaybackRateCommand({
          slideId: slide.id,
          clipId: clip.id,
          playbackRate: newRate!,
        }),
      )
      expect(res.ok).toBe(true)
      const after = engine.getSlide(slide.id).audio.clips.find((c) => c.id === clip.id)!
      expect(after.sourceStart).toBe(0)
      expect(after.sourceEnd).toBe(4)
      expect(after.playbackRate).toBeCloseTo(0.666666, 5)
      expect(getAudioClipSourceDuration(after)).toBe(4)
      expect(getAudioClipPlaybackDuration(after)).toBeCloseTo(6, 6)
      const asset = engine.getEmbeddedAsset('a1')!
      expect(asset.data).toBe('data:audio/wav;base64,AAA=')
      // export derives stretched asset via tempo 1/rate
      const tempo = getRubberbandTempoForPlaybackRate(after.playbackRate)
      expect(tempo).toBeCloseTo(1 / after.playbackRate, 6)
      const key = getDerivedAssetCacheKey(after.assetId, after.playbackRate)
      expect(key).toBe('a1:0.666667')
    })

    it('stretch is non-destructive either way (original bytes never rewritten)', () => {
      const engine = createEngineInternal()
      engine.createProject({ name: 'P' })
      const slide = engine.createSlide('S1')
      const origData = 'data:audio/wav;base64,BBBB'
      engine.embedAsset({
        id: 'a1',
        name: 'orig.wav',
        data: origData,
        mimeType: 'audio/wav',
        metadata: { duration: 2, sampleRate: 44100, channels: 1 },
      })
      const clip = engine.createAudioClip(slide.id, {
        assetId: 'a1',
        trackId: 'music',
        timelineStart: 1,
        sourceStart: 0,
        sourceEnd: 2,
        playbackRate: 1,
      })
      // trim then stretch sequence
      engine.trimAudioClip(slide.id, clip.id, { sourceEnd: 1.5 })
      const afterTrim = engine.getSlide(slide.id).audio.clips[0]
      expect(afterTrim.sourceEnd).toBe(1.5)
      expect(engine.getEmbeddedAsset('a1')!.data).toBe(origData)

      engine.setAudioClipPlaybackRate(slide.id, clip.id, 0.5)
      const afterStretch = engine.getSlide(slide.id).audio.clips[0]
      expect(afterStretch.playbackRate).toBe(0.5)
      expect(afterStretch.sourceEnd).toBe(1.5) // source stays trimmed
      expect(engine.getEmbeddedAsset('a1')!.data).toBe(origData)
      expect(engine.getEmbeddedAsset('a1')!.metadata).toEqual({
        duration: 2,
        sampleRate: 44100,
        channels: 1,
      })
    })
  })

  describe("per-track Don't ask again remembered and resettable", () => {
    it('store persists per track and survives reload via localStorage', () => {
      const store = useAudioResizePreferenceStore.getState()
      store.setPreference('voice', 'trim')
      store.setPreference('sfx', 'stretch')
      expect(store.getPreference('voice')).toBe('trim')
      expect(store.getPreference('sfx')).toBe('stretch')
      expect(store.getPreference('music')).toBeNull()

      // simulate reload: create new store reading from localStorage
      const raw = localStorage.getItem('audio-resize-preference')
      expect(raw).not.toBeNull()
      const parsed = JSON.parse(raw!)
      expect(parsed.state.preferences.voice).toBe('trim')
      expect(parsed.state.preferences.sfx).toBe('stretch')
    })

    it('clearPreference and clearAll reset', () => {
      const store = useAudioResizePreferenceStore.getState()
      store.setPreference('music', 'stretch')
      store.setPreference('voice', 'trim')
      store.clearPreference('voice')
      expect(store.getPreference('voice')).toBeNull()
      expect(store.getPreference('music')).toBe('stretch')
      store.clearAll()
      expect(store.getPreference('music')).toBeNull()
      expect(store.getPreference('sfx')).toBeNull()
      expect(store.getPreference('voice')).toBeNull()
    })

    it('store persists to localStorage and clearAll clears persisted', () => {
      const store = useAudioResizePreferenceStore.getState()
      store.setPreference('voice', 'stretch')
      // persisted
      expect(
        JSON.parse(localStorage.getItem('audio-resize-preference')!).state.preferences.voice,
      ).toBe('stretch')
      store.clearAll()
      const after = JSON.parse(localStorage.getItem('audio-resize-preference')!).state.preferences
      expect(after.voice).toBeNull()
      expect(after.sfx).toBeNull()
      expect(after.music).toBeNull()
    })
  })

  describe('export derives stretched asset, never rewrites original', () => {
    it('buildPerSlideExportDescriptor includes derived keys only for stretched clips', () => {
      const engine = createEngineInternal()
      engine.createProject({ name: 'P' })
      const slide = engine.createSlide('S1')
      engine.setSlideDuration(slide.id, 10)
      engine.embedAsset({
        id: 'a1',
        name: 'a1.wav',
        data: 'data:audio/wav;base64,AAA=',
        mimeType: 'audio/wav',
        metadata: { duration: 2, sampleRate: 44100, channels: 1 },
      })
      engine.embedAsset({
        id: 'a2',
        name: 'a2.wav',
        data: 'data:audio/wav;base64,BBB=',
        mimeType: 'audio/wav',
        metadata: { duration: 1, sampleRate: 44100, channels: 1 },
      })
      engine.createAudioClip(slide.id, {
        assetId: 'a1',
        trackId: 'voice',
        timelineStart: 0,
        sourceStart: 0,
        sourceEnd: 2,
        playbackRate: 2, // stretched
      })
      engine.createAudioClip(slide.id, {
        assetId: 'a2',
        trackId: 'sfx',
        timelineStart: 1,
        sourceStart: 0,
        sourceEnd: 1,
        playbackRate: 1, // not stretched
      })
      const desc = engine.buildPerSlideExportDescriptor(slide.id, { fps: 30 })
      const stretched = desc.audio.clips.find((c) => c.assetId === 'a1')!
      const notStretched = desc.audio.clips.find((c) => c.assetId === 'a2')!
      expect(stretched.isStretched).toBe(true)
      expect(stretched.derivedAssetKey).toBe('a1:2')
      expect(stretched.rubberbandTempo).toBeCloseTo(0.5, 6)
      expect(stretched.filterFragment).toContain('rubberband')
      expect(notStretched.isStretched).toBe(false)
      expect(notStretched.derivedAssetKey).toBeUndefined()
      // original assets unchanged
      expect(engine.getEmbeddedAsset('a1')!.data).toBe('data:audio/wav;base64,AAA=')
      expect(engine.getEmbeddedAsset('a2')!.data).toBe('data:audio/wav;base64,BBB=')
      // global descriptor has derived cache entry
      const job = engine.buildExportJobDescriptor({ fps: 30 })
      expect(job.derivedAssetCache.length).toBe(1)
      expect(job.derivedAssetCache[0].assetId).toBe('a1')
      expect(job.derivedAssetCache[0].cacheKey).toBe('a1:2')
    })
  })

  describe('undo restores correct state for trim vs stretch', () => {
    it('undo Trim restores source', () => {
      const engine = createEngineInternal()
      engine.createProject({ name: 'P' })
      const slide = engine.createSlide('S1')
      engine.embedAsset({
        id: 'a1',
        name: 'a.wav',
        data: 'data:audio/wav;base64,AAA=',
        mimeType: 'audio/wav',
        metadata: { duration: 2, sampleRate: 44100, channels: 1 },
      })
      const clip = engine.createAudioClip(slide.id, {
        assetId: 'a1',
        trackId: 'voice',
        timelineStart: 0,
        sourceStart: 0,
        sourceEnd: 2,
        playbackRate: 1,
      })
      const undo = new UndoStack()
      const dispatcher = new CommandDispatcher(engine, undo, () => {})
      dispatcher.dispatch(
        new TrimAudioClipCommand({ slideId: slide.id, clipId: clip.id, sourceEnd: 1 }),
      )
      expect(engine.getSlide(slide.id).audio.clips[0].sourceEnd).toBe(1)
      dispatcher.undo()
      expect(engine.getSlide(slide.id).audio.clips[0].sourceEnd).toBe(2)
    })

    it('undo Stretch restores playbackRate', () => {
      const engine = createEngineInternal()
      engine.createProject({ name: 'P' })
      const slide = engine.createSlide('S1')
      engine.embedAsset({
        id: 'a1',
        name: 'a.wav',
        data: 'data:audio/wav;base64,AAA=',
        mimeType: 'audio/wav',
        metadata: { duration: 2, sampleRate: 44100, channels: 1 },
      })
      const clip = engine.createAudioClip(slide.id, {
        assetId: 'a1',
        trackId: 'voice',
        timelineStart: 0,
        sourceStart: 0,
        sourceEnd: 2,
        playbackRate: 1,
      })
      const undo = new UndoStack()
      const dispatcher = new CommandDispatcher(engine, undo, () => {})
      dispatcher.dispatch(
        new SetAudioClipPlaybackRateCommand({
          slideId: slide.id,
          clipId: clip.id,
          playbackRate: 0.5,
        }),
      )
      expect(engine.getSlide(slide.id).audio.clips[0].playbackRate).toBe(0.5)
      dispatcher.undo()
      expect(engine.getSlide(slide.id).audio.clips[0].playbackRate).toBe(1)
    })
  })
})
