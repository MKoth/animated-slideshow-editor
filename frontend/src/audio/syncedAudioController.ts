import { usePlaybackController } from '../stores/playbackStore'
import { useAudioPlaybackStore } from '../stores/audioPlaybackStore'
import {
  LOOKAHEAD_SECONDS,
  TICK_MS,
  DRIFT_POLL_MS,
  DRIFT_THRESHOLD_MS,
  SCRUB_SETTLE_MS,
  SCRUB_DEBOUNCE_MS,
  computeAudioTime,
  computePlayhead,
  shouldCorrectDrift,
  getAudibleClips,
  getScrubAuditionClip,
  getClippedPlaybackDuration,
  isClipAudibleWithSoloMute,
} from '../engine/audioSync'
import { AudioBufferCache } from '../engine/audioBufferCache'
import type { EnginePublic } from '../engine'
import { getAudioClipSourceDuration } from '../engine/audioClip'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { getTimeRatioForPlaybackRate, applyAudioEffects, getPitchScaleForSemitones } from './timeStretch'

type Engine = EnginePublic

// Types for mocked AudioContext
export interface AudioContextLike {
  readonly currentTime: number
  readonly state: string
  resume(): Promise<void>
  suspend?(): Promise<void>
  close?(): Promise<void>
  createBufferSource(): AudioBufferSourceNodeLike
  createGain(): GainNodeLike
  createMediaElementSource?(media: HTMLMediaElement): MediaElementAudioSourceNodeLike
  getOutputTimestamp?(): AudioTimestampLike
  decodeAudioData?(buffer: ArrayBuffer): Promise<AudioBuffer>
  destination: unknown
}

export interface AudioTimestampLike {
  readonly contextTime: number
  readonly performanceTime: number
}

export interface AudioBufferSourceNodeLike {
  buffer: unknown | null
  playbackRate: { value: number }
  connect(node: unknown): void
  start(when?: number, offset?: number, duration?: number): void
  stop(when?: number): void
  disconnect?(): void
}

export interface GainNodeLike {
  gain: { value: number }
  connect(node: unknown): void
  disconnect?(): void
}

export interface MediaElementAudioSourceNodeLike {
  connect(node: unknown): void
  disconnect?(): void
}

export type AudioContextFactory = () => AudioContextLike | null

export interface SyncedAudioControllerOptions {
  engine: Engine
  lookahead?: number
  tickMs?: number
  driftPollMs?: number
  driftThresholdMs?: number
  scrubDebounceMs?: number
  scrubSettleMs?: number
  getAudioContext?: AudioContextFactory
  getPerformanceNow?: () => number
  masterGain?: number
  trackGains?: Record<string, number>
}

interface ScheduledNode {
  readonly clipId: string
  readonly source: AudioBufferSourceNodeLike
  readonly gainNode: GainNodeLike
  readonly scheduledAtAudioTime: number
}

interface BaseTimes {
  baseAudioTime: number
  basePerfNow: number
  basePlayhead: number
  slideId: string
  slideDuration: number
}

export class SyncedAudioController {
  private readonly engine: Engine
  private readonly lookahead: number
  private readonly tickMs: number
  private readonly driftPollMs: number
  private readonly driftThresholdMs: number
  private readonly scrubDebounceMs: number
  private readonly scrubSettleMs: number
  private readonly getAudioContext: AudioContextFactory
  private readonly getPerformanceNow: () => number

  readonly cache: AudioBufferCache

  private baseTimes: BaseTimes | null = null
  private scheduled = new Map<string, ScheduledNode>() // clipId -> node
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private driftTimer: ReturnType<typeof setInterval> | null = null
  private rafId: number | null = null
  private scrubTimer: ReturnType<typeof setTimeout> | null = null
  private scrubSettleTimer: ReturnType<typeof setTimeout> | null = null
  private pendingScrubTime: number | null = null
  private pendingScrubSlideId: string | null = null
  private isPlaying = false

  private _activeSlideId: string | null = null
  private get activeSlideId(): string | null {
    return this._activeSlideId
  }
  private set activeSlideId(v: string | null) {
    this._activeSlideId = v
  }
  private readonly unsubs: Array<() => void> = []
  private _cachedCtx: AudioContextLike | null = null
  private _pendingDecodes = new Set<string>()
  private _playGen = 0
  // Time-stretch cache: key = `${assetId}:rate:${playbackRate}` -> stretched AudioBuffer
  private stretchedCache = new Map<string, { buffer: AudioBuffer; duration: number; byteSize: number }>()
  private pendingStretches = new Set<string>()

  // for tests: capture scheduled calls
  readonly scheduledHistory: Array<{
    clipId: string
    when: number
    offset: number
    duration: number
    gain: number
    playbackRate: number
  }> = []

  constructor(options: SyncedAudioControllerOptions) {
    this.engine = options.engine
    this.lookahead = options.lookahead ?? LOOKAHEAD_SECONDS
    this.tickMs = options.tickMs ?? TICK_MS
    this.driftPollMs = options.driftPollMs ?? DRIFT_POLL_MS
    this.driftThresholdMs = options.driftThresholdMs ?? DRIFT_THRESHOLD_MS
    this.scrubDebounceMs = options.scrubDebounceMs ?? SCRUB_DEBOUNCE_MS
    this.scrubSettleMs = options.scrubSettleMs ?? SCRUB_SETTLE_MS
    this.getAudioContext = options.getAudioContext ?? (() => null)
    this.getPerformanceNow = options.getPerformanceNow ?? (() => performance.now())
    this.cache = new AudioBufferCache()
  }

  private getCtx(): AudioContextLike | null {
    if (this._cachedCtx) return this._cachedCtx
    const ctx = this.getAudioContext()
    if (ctx) this._cachedCtx = ctx
    return ctx
  }

  private base64ToBytes(base64: string): Uint8Array | null {
    try {
      const bin = atob(base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return bytes
    } catch {
      return null
    }
  }

  private async decodeArrayBufferToBuffer(arrayBuffer: ArrayBuffer): Promise<{ buffer: AudioBuffer; byteSize: number; duration: number } | null> {
    // Try playback context decode first
    const ctx = this.getCtx()
    if (ctx?.decodeAudioData) {
      try {
        const buf = await ctx.decodeAudioData(arrayBuffer.slice(0))
        return { buffer: buf, byteSize: buf.length * buf.numberOfChannels * 4, duration: buf.duration }
      } catch {
        // fall through to ephemeral
      }
    }
    const Ctor = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    let tmp: AudioContext | null = null
    try {
      tmp = new Ctor()
      const buf = await tmp.decodeAudioData(arrayBuffer.slice(0))
      const computedByteSize = buf.length * buf.numberOfChannels * 4
      return { buffer: buf, byteSize: computedByteSize, duration: buf.duration }
    } catch {
      return null
    } finally {
      if (tmp) {
        try { await tmp.close() } catch { /* ignore */ }
      }
    }
  }

  private async decodeBase64ToBuffer(base64: string): Promise<{ buffer: AudioBuffer; byteSize: number; duration: number } | null> {
    const bytes = this.base64ToBytes(base64)
    if (!bytes) return null
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    return this.decodeArrayBufferToBuffer(arrayBuffer)
  }

  private isGlobalAudioDefinition(def: unknown): boolean {
    if (!def || typeof def !== 'object') return false
    const d = def as Record<string, unknown>
    if (typeof d.mimeType === 'string' && (d.mimeType as string).startsWith('audio/')) return true
    if (typeof d.category === 'string' && d.category === 'audio') return true
    const meta = d.metadata as Record<string, unknown> | undefined
    if (meta && typeof meta.mimeType === 'string' && (meta.mimeType as string).startsWith('audio/')) return true
    if (typeof d.original_filename === 'string' && /\.(wav|mp3|mpeg|ogg|webm)$/i.test(d.original_filename as string)) return true
    return false
  }

  private async ensureBufferForAsset(assetId: string): Promise<boolean> {
    if (this.cache.has(assetId)) return true
    if (this._pendingDecodes.has(assetId)) return false
    // Try embedded first (recorded/project-only)
    const asset = this.engine.getEmbeddedAsset(assetId)
    if (asset) {
      const meta = asset.metadata as Record<string, unknown> | undefined
      const metaDuration = typeof meta?.duration === 'number' ? (meta.duration as number) : undefined
      if (metaDuration !== undefined && this.cache.shouldUseMediaElement(metaDuration)) return false
      this._pendingDecodes.add(assetId)
      try {
        const decoded = await this.decodeBase64ToBuffer(asset.data)
        if (!decoded) return false
        if (this.cache.shouldUseMediaElement(decoded.duration)) return false
        this.cache.set(assetId, decoded.buffer, decoded.byteSize, decoded.duration)
        return true
      } finally {
        this._pendingDecodes.delete(assetId)
      }
    }
    // Try global audio definition via assetLibraryStore
    let globalDef: unknown = null
    try {
      globalDef = useAssetLibraryStore.getState().definitions.find((d) => d.id === assetId) ?? null
    } catch {
      globalDef = null
    }
    if (globalDef && this.isGlobalAudioDefinition(globalDef)) {
      const def = globalDef as { original_url: string; metadata?: Record<string, unknown> }
      const metaDuration = typeof def.metadata?.duration === 'number' ? (def.metadata.duration as number) : undefined
      if (metaDuration !== undefined && this.cache.shouldUseMediaElement(metaDuration)) return false
      this._pendingDecodes.add(assetId)
      try {
        // fetch bytes from original_url
        let arrayBuffer: ArrayBuffer | null = null
        try {
          const resp = await fetch(def.original_url)
          if (!resp.ok) return false
          arrayBuffer = await resp.arrayBuffer()
        } catch {
          return false
        }
        if (!arrayBuffer) return false
        const decoded = await this.decodeArrayBufferToBuffer(arrayBuffer)
        if (!decoded) return false
        if (this.cache.shouldUseMediaElement(decoded.duration)) return false
        this.cache.set(assetId, decoded.buffer, decoded.byteSize, decoded.duration)
        return true
      } finally {
        this._pendingDecodes.delete(assetId)
      }
    }
    return false
  }

  private async ensureBuffersForSlide(slideId: string): Promise<void> {
    let clips: readonly import('../engine/audioClip').AudioClip[] = []
    try {
      clips = this.engine.getSlide(slideId).audio.clips
    } catch {
      return
    }
    const uniqueAssetIds = [...new Set(clips.map((c) => c.assetId))]
    await Promise.all(uniqueAssetIds.map((id) => this.ensureBufferForAsset(id)))
    // Also warm stretched/effects buffers for clips with any non-default effect (pitch-preserving)
    await Promise.all(
      clips
        .filter((c) => this.hasClipEffects(c))
        .map((c) => this.ensureStretchedBufferForClip(c).catch(() => false)),
    )
  }

  private getStretchedKey(assetId: string, playbackRate: number, pitchSemitones = 0, noiseReduction = 0): string {
    return `${assetId}:stretch:${playbackRate.toFixed(6)}:pitch:${pitchSemitones.toFixed(2)}:nr:${noiseReduction.toFixed(2)}`
  }

  private hasClipEffects(clip: import('../engine/audioClip').AudioClip): boolean {
    const rate = clip.playbackRate || 1
    const pitch = clip.pitchSemitones || 0
    const nr = clip.noiseReduction || 0
    return Math.abs(rate - 1) > 1e-6 || Math.abs(pitch) > 1e-6 || nr > 1e-6
  }

  private async ensureStretchedBufferForClip(clip: import('../engine/audioClip').AudioClip): Promise<boolean> {
    const rate = clip.playbackRate || 1
    const pitch = clip.pitchSemitones ?? 0
    const nr = clip.noiseReduction ?? 0
    if (!this.hasClipEffects(clip)) return true
    const key = this.getStretchedKey(clip.assetId, rate, pitch, nr)
    if (this.stretchedCache.has(key)) return true
    if (this.pendingStretches.has(key)) return false
    // Need original buffer
    let originalEntry = this.cache.get(clip.assetId)
    if (!originalEntry) {
      const ok = await this.ensureBufferForAsset(clip.assetId)
      if (!ok) return false
      originalEntry = this.cache.get(clip.assetId)
    }
    if (!originalEntry) return false
    const originalBuffer = originalEntry.buffer as AudioBuffer
    if (!originalBuffer || typeof (originalBuffer as AudioBuffer).getChannelData !== 'function') return false
    const timeRatio = getTimeRatioForPlaybackRate(rate)
    const pitchScale = getPitchScaleForSemitones(pitch)
    // pitch does not change duration, only tempo does, so stretchedDuration still timeRatio * original
    const stretchedDuration = originalBuffer.duration * timeRatio
    void pitchScale
    if (this.cache.shouldUseMediaElement(stretchedDuration)) return false
    this.pendingStretches.add(key)
    try {
      const stretched = await applyAudioEffects(originalBuffer, timeRatio, pitch, nr)
      if (!stretched) return false
      const byteSize = stretched.length * stretched.numberOfChannels * 4
      this.stretchedCache.set(key, { buffer: stretched, duration: stretched.duration, byteSize })
      return true
    } catch {
      return false
    } finally {
      this.pendingStretches.delete(key)
    }
  }

  private getStretchedBuffer(assetId: string, playbackRate: number, pitchSemitones = 0, noiseReduction = 0): { buffer: AudioBuffer; duration: number } | null {
    const key = this.getStretchedKey(assetId, playbackRate, pitchSemitones, noiseReduction)
    const entry = this.stretchedCache.get(key)
    if (!entry) return null
    // LRU touch
    this.stretchedCache.delete(key)
    this.stretchedCache.set(key, entry)
    return entry
  }

  private getStretchedBufferForClip(clip: import('../engine/audioClip').AudioClip): { buffer: AudioBuffer; duration: number } | null {
    return this.getStretchedBuffer(clip.assetId, clip.playbackRate || 1, clip.pitchSemitones ?? 0, clip.noiseReduction ?? 0)
  }

  attach(): void {
    // Subscribe to playback events
    const unsubEvents = usePlaybackController.getState().subscribeEvents((event) => {
      if (event.type === 'PlaybackStarted') {
        void this.handlePlay(event.slideId, event.time)
      } else if (
        event.type === 'PlaybackPaused' ||
        event.type === 'PlaybackStopped' ||
        event.type === 'PlaybackFinished'
      ) {
        this.handlePauseOrStop()
      } else if (event.type === 'PlaybackLooped') {
        this.handleLooped(event.slideId, event.time)
      } else if (event.type === 'CurrentTimeChanged') {
        // Scrub seek when not playing — silent drag then debounced blip
        if (!this.isPlaying) {
          this.handleScrubSeek(event.slideId, event.time)
        } else {
          // When playing, if CurrentTimeChanged is due to seek during playback, update base times?
          // We treat scrub during playback as seek: rebase
          // For now, ignore unless isPlaying and time jump > threshold
        }
      }
    })
    this.unsubs.push(unsubEvents)

    // Subscribe to engine SlideActivated for teardown + cache eviction
    const unsubEngine = this.engine.subscribe((event) => {
      if (event.type === 'SlideActivated') {
        this.handleSlideSwitch(event.slideId)
      }
    })
    this.unsubs.push(unsubEngine)
  }

  detach(): void {
    this.teardownScheduling()
    this.clearScrubTimers()
    for (const unsub of this.unsubs) unsub()
    this.unsubs.length = 0
    this._cachedCtx = null
  }

  // -------------------------------------------------------------------------
  // Play — capture base times, ensure AudioContext running, start scheduler
  // -------------------------------------------------------------------------

  async handlePlay(slideId: string, playheadTime: number): Promise<void> {
    const gen = ++this._playGen
    const ctx = this.getCtx()
    if (!ctx) return
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        // ignore
      }
    }
    if (gen !== this._playGen) return
    // Preload decoded buffers for this slide's assets before scheduling
    // Do not block indefinitely — if decode fails, tick will skip silent clips
    try {
      await this.ensureBuffersForSlide(slideId)
    } catch {
      // ignore preload errors — tick will handle misses
    }
    if (gen !== this._playGen) return
    if (usePlaybackController.getState().status !== 'playing') return
    const perfNow = this.getPerformanceNow()
    const baseAudioTime = ctx.currentTime
    const duration = this.getSlideDuration(slideId)
    this.baseTimes = {
      baseAudioTime,
      basePerfNow: perfNow,
      basePlayhead: playheadTime,
      slideId,
      slideDuration: duration,
    }
    this.isPlaying = true
    this.activeSlideId = slideId
    this.scheduledHistory.length = 0
    this.clearScheduled() // ensure clean slate
    this.startScheduler()
    this.startRaf()
    this.startDriftPoll()
    // immediate tick
    this.tick()
  }

  handlePauseOrStop(): void {
    this._playGen++
    this.isPlaying = false
    this.baseTimes = null
    this.teardownScheduling()
  }

  handleLooped(slideId: string, time: number): void {
    // Loop wraps re-queueing — clear scheduled that are past and re-tick
    // For simplicity, clear all and rebase
    const ctx = this.getCtx()
    if (!ctx) return
    const perfNow = this.getPerformanceNow()
    const duration = this.getSlideDuration(slideId)
    this.baseTimes = {
      baseAudioTime: ctx.currentTime,
      basePerfNow: perfNow,
      basePlayhead: time,
      slideId,
      slideDuration: duration,
    }
    this.clearScheduled()
    this.tick()
  }

  handleSlideSwitch(nextSlideId: string): void {
    // Slide switch tears down nodes
    this._playGen++
    this.clearScheduled()
    this.isPlaying = false
    this.baseTimes = null
    this.teardownScheduling()
    this.clearScrubTimers()
    this.activeSlideId = nextSlideId
    // LRU eviction on slide switch — keep only buffers for next slide's clips
    try {
      const slide = this.engine.getSlide(nextSlideId)
      const keepIds = new Set(slide.audio.clips.map((c) => c.assetId))
      this.cache.evictOnSlideSwitch(keepIds)
      // Also evict stretched buffers for assets not in keepIds
      for (const key of [...this.stretchedCache.keys()]) {
        const assetId = key.split(':stretch:')[0]
        if (!keepIds.has(assetId)) this.stretchedCache.delete(key)
      }
    } catch {
      this.cache.clear()
      this.stretchedCache.clear()
    }
  }

  // -------------------------------------------------------------------------
  // Scheduler — look-ahead 100 ms / 25 ms tick
  // -------------------------------------------------------------------------

  private startScheduler(): void {
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.tickTimer = setInterval(() => this.tick(), this.tickMs)
  }

  private startDriftPoll(): void {
    if (this.driftTimer) clearInterval(this.driftTimer)
    this.driftTimer = setInterval(() => this.pollDrift(), this.driftPollMs)
  }

  private startRaf(): void {
    const raf = (globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number })
      .requestAnimationFrame
    const caf = (globalThis as unknown as { cancelAnimationFrame?: (id: number) => void })
      .cancelAnimationFrame
    if (!raf) return
    if (this.rafId !== null && caf) caf(this.rafId)
    const rafTick = () => {
      if (raf) this.rafId = raf(rafTick)
      this.updatePlayheadFromAudio()
    }
    this.rafId = raf(rafTick)
  }

  private teardownScheduling(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer)
      this.tickTimer = null
    }
    if (this.driftTimer) {
      clearInterval(this.driftTimer)
      this.driftTimer = null
    }
    if (this.rafId !== null) {
      const caf = (globalThis as unknown as { cancelAnimationFrame?: (id: number) => void })
        .cancelAnimationFrame
      if (caf) caf(this.rafId)
      this.rafId = null
    }
    this.clearScheduled()
  }

  private updatePlayheadFromAudio(): void {
    if (!this.baseTimes || !this.isPlaying) return
    const ctx = this.getCtx()
    if (!ctx) return
    const perfNow = this.getPerformanceNow()
    // Estimate via AudioContext.currentTime if available, else perf
    let audioTime: number
    if (ctx.getOutputTimestamp) {
      try {
        const ts = ctx.getOutputTimestamp()
        audioTime = ts.contextTime
      } catch {
        audioTime = computeAudioTime(
          this.baseTimes.baseAudioTime,
          this.baseTimes.basePerfNow,
          perfNow,
        )
      }
    } else {
      audioTime = computeAudioTime(
        this.baseTimes.baseAudioTime,
        this.baseTimes.basePerfNow,
        perfNow,
      )
    }
    const estimatedPlayhead =
      this.baseTimes.basePlayhead + (audioTime - this.baseTimes.baseAudioTime)
    const duration = this.baseTimes.slideDuration
    // clip at duration for playhead? playbackStore handles loop/finish
    const clamped = Math.min(Math.max(estimatedPlayhead, 0), duration)
    // Update playbackStore truth via setCurrentTime — but we need to avoid re-entrancy loops?
    // Use internal rAF interpolation: directly set playbackStore currentTimes
    const state = usePlaybackController.getState()
    if (state.status === 'playing' && state.currentTimes[this.baseTimes.slideId] !== clamped) {
      // Use setCurrentTime to emit CurrentTimeChanged? For rAF visuals we can use direct setState to avoid scrub logic
      // But spec says single playbackStore playhead is truth, so we sync it
      // Use playbackStore's setCurrentTime which emits event — but we guard scrub handling when isPlaying
      // So we can update via setState directly to avoid triggering scrub audition?
      // We'll use setState with silent update for visuals, drift poll will correct if needed
      usePlaybackController.setState({
        currentTimes: { ...state.currentTimes, [this.baseTimes.slideId]: clamped },
      })
    }
  }

  private pollDrift(): void {
    if (!this.baseTimes || !this.isPlaying) return
    const ctx = this.getCtx()
    if (!ctx) return
    const perfNow = this.getPerformanceNow()
    const estimatedAudioTime = computeAudioTime(
      this.baseTimes.baseAudioTime,
      this.baseTimes.basePerfNow,
      perfNow,
    )
    let actualAudioTime: number
    if (ctx.getOutputTimestamp) {
      try {
        const ts = ctx.getOutputTimestamp()
        actualAudioTime = ts.contextTime
      } catch {
        actualAudioTime = ctx.currentTime
      }
    } else {
      actualAudioTime = ctx.currentTime
    }
    if (shouldCorrectDrift(estimatedAudioTime, actualAudioTime, this.driftThresholdMs)) {
      // Correct drift: reset base times to actual, keeping playhead continuity
      const estimatedPlayhead = computePlayhead(
        this.baseTimes.basePlayhead,
        this.baseTimes.basePerfNow,
        perfNow,
      )
      // Rebase so that future estimated matches actual
      this.baseTimes = {
        baseAudioTime: actualAudioTime,
        basePerfNow: perfNow,
        basePlayhead: estimatedPlayhead,
        slideId: this.baseTimes.slideId,
        slideDuration: this.baseTimes.slideDuration,
      }
      // Also correct playbackStore if drift >15ms
      const state = usePlaybackController.getState()
      const current = state.currentTimes[this.baseTimes.slideId] ?? 0
      if (Math.abs(current - estimatedPlayhead) * 1000 > this.driftThresholdMs) {
        usePlaybackController.setState({
          currentTimes: { ...state.currentTimes, [this.baseTimes.slideId]: estimatedPlayhead },
        })
      }
    }
  }

  private tick(): void {
    if (!this.baseTimes || !this.isPlaying) return
    const ctx = this.getCtx()
    if (!ctx) return
    const perfNow = this.getPerformanceNow()
    const audioTime = ctx.getOutputTimestamp
      ? (() => {
          try {
            return ctx.getOutputTimestamp()!.contextTime
          } catch {
            return computeAudioTime(
              this.baseTimes!.baseAudioTime,
              this.baseTimes!.basePerfNow,
              perfNow,
            )
          }
        })()
      : computeAudioTime(this.baseTimes.baseAudioTime, this.baseTimes.basePerfNow, perfNow)

    // audioTime corresponds to playhead: playhead = basePlayhead + (audioTime - baseAudioTime)
    const playhead = this.baseTimes.basePlayhead + (audioTime - this.baseTimes.baseAudioTime)
    const slideId = this.baseTimes.slideId
    const slideDuration = this.baseTimes.slideDuration

    let clips: readonly import('../engine/audioClip').AudioClip[] = []
    try {
      clips = this.engine.getSlide(slideId).audio.clips
    } catch {
      return
    }

    const audibleWindow = getAudibleClips(clips, slideDuration, playhead, this.lookahead)
    const mutedTracks = useAudioPlaybackStore.getState().mutedTracks
    const soloTracks = useAudioPlaybackStore.getState().soloTracks

    for (const clip of audibleWindow) {
      if (this.scheduled.has(clip.id)) continue
      if (!isClipAudibleWithSoloMute(clip, mutedTracks, soloTracks)) continue
      const needsEffects = this.hasClipEffects(clip)
      if (needsEffects) {
        const stretched = this.getStretchedBufferForClip(clip)
        if (stretched) {
          this.scheduleStretchedClip(clip, playhead, audioTime, ctx, slideDuration, stretched.buffer)
          continue
        }
        // trigger async effects (ensures original decoded first)
        void this.ensureStretchedBufferForClip(clip).then((ok) => {
          if (ok && this.isPlaying) this.tick()
        })
        // Also ensure original is decoded for fallback debugging
        if (!this.cache.has(clip.assetId)) {
          void this.ensureBufferForAsset(clip.assetId).then((ok) => {
            if (ok && this.isPlaying) this.tick()
          })
        }
        continue
      }
      if (!this.cache.has(clip.assetId)) {
        // Trigger lazy decode and retry next tick when ready
        void this.ensureBufferForAsset(clip.assetId).then((ok) => {
          if (ok && this.isPlaying) this.tick()
        })
        continue
      }
      this.scheduleClip(clip, playhead, audioTime, ctx, slideDuration)
    }

    // Cleanup nodes that are no longer audible and have finished
    for (const [clipId, node] of [...this.scheduled.entries()]) {
      const clip = clips.find((c) => c.id === clipId)
      if (!clip) {
        this.unscheduleClip(clipId)
        continue
      }
      const clippedDuration = getClippedPlaybackDuration(clip, slideDuration)
      const clipEnd = clip.timelineStart + clippedDuration
      if (playhead >= clipEnd + 0.05) {
        this.unscheduleClip(clipId)
      } else if (!isClipAudibleWithSoloMute(clip, mutedTracks, soloTracks)) {
        // muted/solo changed — teardown
        this.unscheduleClip(clipId)
      } else {
        void node
      }
    }
  }

  private scheduleClip(
    clip: import('../engine/audioClip').AudioClip,
    playhead: number,
    audioTime: number,
    ctx: AudioContextLike,
    slideDuration: number,
  ): void {
    const clippedDuration = getClippedPlaybackDuration(clip, slideDuration)
    if (clippedDuration <= 1e-9) return
    const clipStart = clip.timelineStart
    const clipEnd = clipStart + clippedDuration
    // when to start in AudioContext time
    const delay = Math.max(0, clipStart - playhead)
    const when = ctx.currentTime + delay
    // offset into source buffer
    const sourceDuration = getAudioClipSourceDuration(clip)
    const playbackRate = clip.playbackRate || 1
    // If clip starts before playhead, we are in middle: offset accordingly
    let offset = clip.sourceStart
    let duration = clippedDuration
    if (playhead > clipStart) {
      const elapsedPlayback = playhead - clipStart
      const elapsedSource = elapsedPlayback * playbackRate
      offset = clip.sourceStart + elapsedSource
      duration = clipEnd - playhead
      // also clip duration to remaining source?
      const remainingSource = clip.sourceEnd - offset
      const remainingPlayback = remainingSource / playbackRate
      duration = Math.min(duration, remainingPlayback)
    } else {
      // not yet started, but ensure we don't exceed source
      duration = Math.min(duration, sourceDuration / playbackRate)
    }
    if (duration <= 1e-9) return
    if (offset < clip.sourceStart || offset >= clip.sourceEnd) return

    // Gain = volume*trackGain*masterGain (trackGain/masterGain default 1)
    const gainValue = clip.volume * 1 * 1

    try {
      const source = ctx.createBufferSource()
      const gainNode = ctx.createGain()
      source.playbackRate.value = playbackRate
      gainNode.gain.value = gainValue
      const cached = this.cache.get(clip.assetId)
      if (!cached) {
        // No decoded buffer yet — skip scheduling (mediaElement guard or decode pending)
        return
      }
      source.buffer = cached.buffer as AudioBuffer
      source.connect(gainNode)
      gainNode.connect(ctx.destination)
      // Web Audio start duration is source seconds, independent of playbackRate
      // (e.g. duration 2 source seconds at rate 2 plays as 1s wall time).
      // Our `duration` variable above is wall/playback time (clippedPlaybackDuration etc.),
      // so convert to source duration for the AudioBufferSourceNode.
      const sourceDurationParam = duration * playbackRate
      source.start(when, offset, sourceDurationParam)
      const node: ScheduledNode = {
        clipId: clip.id,
        source,
        gainNode,
        scheduledAtAudioTime: audioTime,
      }
      this.scheduled.set(clip.id, node)
      this.scheduledHistory.push({
        clipId: clip.id,
        when,
        offset,
        duration,
        gain: gainValue,
        playbackRate,
      })
    } catch {
      // ignore scheduling errors
    }
  }

  // Time-stretched path: playbackRate !=1 is rendered via RubberBand WASM so pitch is preserved.
  // We schedule the *stretched* AudioBuffer at playbackRate 1.
  private scheduleStretchedClip(
    clip: import('../engine/audioClip').AudioClip,
    playhead: number,
    audioTime: number,
    ctx: AudioContextLike,
    slideDuration: number,
    stretchedBuffer: AudioBuffer,
  ): void {
    const clippedDuration = getClippedPlaybackDuration(clip, slideDuration)
    if (clippedDuration <= 1e-9) return
    const clipStart = clip.timelineStart
    const clipEnd = clipStart + clippedDuration
    const delay = Math.max(0, clipStart - playhead)
    const when = ctx.currentTime + delay
    const playbackRate = clip.playbackRate || 1
    const timeRatio = getTimeRatioForPlaybackRate(playbackRate)
    // Stretched buffer's time is already `original * timeRatio`
    const stretchedSourceStart = clip.sourceStart * timeRatio
    const stretchedSourceEnd = clip.sourceEnd * timeRatio
    const stretchedDuration = stretchedSourceEnd - stretchedSourceStart

    let offset = stretchedSourceStart
    let duration = clippedDuration // wall time = stretched source time at rate 1
    if (playhead > clipStart) {
      const elapsedWall = playhead - clipStart
      offset = stretchedSourceStart + elapsedWall
      duration = clipEnd - playhead
      const remainingStretched = stretchedSourceEnd - offset
      duration = Math.min(duration, remainingStretched)
    } else {
      duration = Math.min(duration, stretchedDuration)
    }
    if (duration <= 1e-9) return
    if (offset < stretchedSourceStart || offset >= stretchedSourceEnd) return

    const gainValue = clip.volume * 1 * 1
    try {
      const source = ctx.createBufferSource()
      const gainNode = ctx.createGain()
      // Pitch-preserving: stretched buffer plays at 1.0, duration == wall
      source.playbackRate.value = 1
      gainNode.gain.value = gainValue
      source.buffer = stretchedBuffer as unknown as AudioBuffer
      source.connect(gainNode)
      gainNode.connect(ctx.destination)
      // For stretched buffer, source duration == wall duration (rate 1)
      source.start(when, offset, duration)
      const node: ScheduledNode = {
        clipId: clip.id,
        source,
        gainNode,
        scheduledAtAudioTime: audioTime,
      }
      this.scheduled.set(clip.id, node)
      this.scheduledHistory.push({
        clipId: clip.id,
        when,
        offset,
        duration,
        gain: gainValue,
        playbackRate: 1, // stretched playback is at 1 (preserved pitch)
      })
    } catch {
      // ignore
    }
  }

  private unscheduleClip(clipId: string): void {
    const entry = this.scheduled.get(clipId)
    if (!entry) return
    try {
      entry.source.stop()
    } catch {
      // ignore
    }
    try {
      entry.source.disconnect?.()
      entry.gainNode.disconnect?.()
    } catch {
      // ignore
    }
    this.scheduled.delete(clipId)
  }

  private clearScheduled(): void {
    for (const clipId of [...this.scheduled.keys()]) this.unscheduleClip(clipId)
  }

  private getSlideDuration(slideId: string): number {
    try {
      return this.engine.getSlide(slideId).duration
    } catch {
      return 0
    }
  }

  // -------------------------------------------------------------------------
  // Scrub audition — silent drag + debounced 50–120 ms blip (30 ms settle)
  // -------------------------------------------------------------------------

  private handleScrubSeek(slideId: string, time: number): void {
    // Cancel previous timers — scrub stays silent while dragging
    this.clearScrubTimers()
    this.pendingScrubTime = time
    this.pendingScrubSlideId = slideId
    // Debounce: after settle + debounce, emit audition blip if inside clip
    this.scrubSettleTimer = setTimeout(() => {
      this.scrubTimer = setTimeout(() => this.emitScrubBlip(), this.scrubDebounceMs)
    }, this.scrubSettleMs)
  }

  private clearScrubTimers(): void {
    if (this.scrubTimer) {
      clearTimeout(this.scrubTimer)
      this.scrubTimer = null
    }
    if (this.scrubSettleTimer) {
      clearTimeout(this.scrubSettleTimer)
      this.scrubSettleTimer = null
    }
  }

  private emitScrubBlip(): void {
    const slideId = this.pendingScrubSlideId
    const time = this.pendingScrubTime
    if (slideId === null || time === null) return
    let clips: readonly import('../engine/audioClip').AudioClip[] = []
    let slideDuration = 0
    try {
      const slide = this.engine.getSlide(slideId)
      clips = slide.audio.clips
      slideDuration = slide.duration
    } catch {
      return
    }
    const clip = getScrubAuditionClip(clips, slideDuration, time)
    if (!clip) return
    // Respect muted/solo preview
    const mutedTracks = useAudioPlaybackStore.getState().mutedTracks
    const soloTracks = useAudioPlaybackStore.getState().soloTracks
    if (!isClipAudibleWithSoloMute(clip, mutedTracks, soloTracks)) return
    // Emit audition blip — a short 30–120ms playback of the clip at time
    // For test seam, record as scheduledHistory or set audition state
    useAudioPlaybackStore.getState().setAuditioning(clip.id)
    // Schedule a short blip via AudioContext if available
    const ctx = this.getCtx()
    if (ctx) {
      try {
        const rate = clip.playbackRate || 1
        const needsEffects = this.hasClipEffects(clip)
        const stretched = needsEffects ? this.getStretchedBufferForClip(clip) : null
        // Try to ensure stretched for next time
        if (needsEffects && !stretched) {
          void this.ensureStretchedBufferForClip(clip)
        }
        let buffer: AudioBuffer | null = null
        let playbackRateForSource = rate
        let offset: number
        let blipDuration: number
        const clippedForClip = getClippedPlaybackDuration(clip, slideDuration) - (time - clip.timelineStart)
        blipDuration = Math.min(0.12, clippedForClip)
        if (blipDuration <= 0) {
          useAudioPlaybackStore.getState().setAuditioning(null)
          return
        }
        let blipSourceDuration: number
        if (stretched) {
          buffer = stretched.buffer
          playbackRateForSource = 1
          const timeRatio = getTimeRatioForPlaybackRate(rate)
          offset = clip.sourceStart * timeRatio + (time - clip.timelineStart)
          // stretched source duration == wall
          blipSourceDuration = blipDuration
        } else {
          const cached = this.cache.get(clip.assetId)
          if (!cached) {
            // Lazy decode for scrub audition
            void this.ensureBufferForAsset(clip.assetId)
            useAudioPlaybackStore.getState().setAuditioning(null)
            return
          }
          buffer = cached.buffer as AudioBuffer
          playbackRateForSource = rate
          offset = clip.sourceStart + (time - clip.timelineStart) * rate
          blipSourceDuration = blipDuration * rate
        }
        const source = ctx.createBufferSource()
        const gainNode = ctx.createGain()
        source.buffer = buffer as AudioBuffer
        source.playbackRate.value = playbackRateForSource
        gainNode.gain.value = clip.volume
        source.connect(gainNode)
        gainNode.connect(ctx.destination)
        if (blipDuration > 0) {
          source.start(ctx.currentTime, offset, blipSourceDuration)
          setTimeout(
            () => {
              try {
                source.stop()
                source.disconnect?.()
                gainNode.disconnect?.()
              } catch {
                // ignore
              }
              useAudioPlaybackStore.getState().setAuditioning(null)
            },
            blipDuration * 1000 + 20,
          )
        }
      } catch {
        useAudioPlaybackStore.getState().setAuditioning(null)
      }
    } else {
      setTimeout(() => useAudioPlaybackStore.getState().setAuditioning(null), 120)
    }
    this.pendingScrubTime = null
    this.pendingScrubSlideId = null
  }

  // Exposed for tests
  getScheduledClipIds(): string[] {
    return [...this.scheduled.keys()]
  }

  isTicking(): boolean {
    return this.tickTimer !== null
  }

  isDriftPolling(): boolean {
    return this.driftTimer !== null
  }

  getBaseTimes(): BaseTimes | null {
    return this.baseTimes
  }
}
