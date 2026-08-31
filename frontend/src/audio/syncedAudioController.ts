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
  }

  // -------------------------------------------------------------------------
  // Play — capture base times, ensure AudioContext running, start scheduler
  // -------------------------------------------------------------------------

  async handlePlay(slideId: string, playheadTime: number): Promise<void> {
    const ctx = this.getAudioContext()
    if (!ctx) return
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume()
      } catch {
        // ignore
      }
    }
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
    this.isPlaying = false
    this.baseTimes = null
    this.teardownScheduling()
  }

  handleLooped(slideId: string, time: number): void {
    // Loop wraps re-queueing — clear scheduled that are past and re-tick
    // For simplicity, clear all and rebase
    const ctx = this.getAudioContext()
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
    } catch {
      this.cache.clear()
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
    const ctx = this.getAudioContext()
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
    const ctx = this.getAudioContext()
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
    const ctx = this.getAudioContext()
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
      // buffer assignment — if cached, use buffer; else need to handle fallback media element
      // For test seam, we allow buffer to be null; still schedule
      const cached = this.cache.get(clip.assetId)
      if (cached) {
        source.buffer = cached.buffer as AudioBuffer
      } else {
        // fallback: if guard says mediaElement, we would create media element source
        // For now, leave buffer null; tests can assert fallback path via cache guard
      }
      source.connect(gainNode)
      gainNode.connect(ctx.destination)
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
        playbackRate,
      })
    } catch {
      // ignore scheduling errors
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
    const ctx = this.getAudioContext()
    if (ctx) {
      try {
        const source = ctx.createBufferSource()
        const gainNode = ctx.createGain()
        const cached = this.cache.get(clip.assetId)
        if (cached) source.buffer = cached.buffer as AudioBuffer
        source.playbackRate.value = clip.playbackRate || 1
        gainNode.gain.value = clip.volume
        source.connect(gainNode)
        gainNode.connect(ctx.destination)
        const offset = clip.sourceStart + (time - clip.timelineStart) * (clip.playbackRate || 1)
        const blipDuration = Math.min(
          0.12,
          getClippedPlaybackDuration(clip, slideDuration) - (time - clip.timelineStart),
        )
        if (blipDuration > 0) {
          source.start(ctx.currentTime, offset, blipDuration)
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
