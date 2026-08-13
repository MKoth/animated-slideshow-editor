import { create } from 'zustand'
import type { Unsubscribe } from '../engine'

export const FRAME_STEP_SECONDS = 1 / 60
export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4] as const

export function formatTimeCode(seconds: number): string {
  const finite = Number.isFinite(seconds) ? seconds : 0
  const totalMs = Math.max(0, Math.round(finite * 1000))
  const minutes = Math.floor(totalMs / 60000)
  const rest = totalMs % 60000
  const secs = Math.floor(rest / 1000)
  const ms = rest % 1000
  return `${pad(minutes, 2)}:${pad(secs, 2)}.${pad(ms, 3)}`
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

export type PlaybackStatus = 'playing' | 'paused' | 'stopped'

export interface PlaybackStartedEvent {
  readonly type: 'PlaybackStarted'
  readonly slideId: string
  readonly time: number
}

export interface PlaybackPausedEvent {
  readonly type: 'PlaybackPaused'
  readonly slideId: string
  readonly time: number
}

export interface PlaybackStoppedEvent {
  readonly type: 'PlaybackStopped'
  readonly slideId: string
  readonly time: number
}

export interface PlaybackFinishedEvent {
  readonly type: 'PlaybackFinished'
  readonly slideId: string
  readonly time: number
}

export interface PlaybackLoopedEvent {
  readonly type: 'PlaybackLooped'
  readonly slideId: string
  readonly time: number
}

export interface CurrentTimeChangedEvent {
  readonly type: 'CurrentTimeChanged'
  readonly slideId: string
  readonly time: number
}

export type PlaybackEvent =
  | PlaybackStartedEvent
  | PlaybackPausedEvent
  | PlaybackStoppedEvent
  | PlaybackFinishedEvent
  | PlaybackLoopedEvent
  | CurrentTimeChangedEvent

export type PlaybackEventListener = (event: PlaybackEvent) => void

const listeners = new Set<PlaybackEventListener>()

function emit(event: PlaybackEvent): void {
  listeners.forEach((listener) => listener(event))
}

export interface PlaybackControllerState {
  readonly currentTimes: Readonly<Record<string, number>>
  readonly status: PlaybackStatus
  readonly playbackSpeed: number
  readonly loopEnabled: boolean
  getTime(slideId: string): number
  setCurrentTime(slideId: string, time: number, duration: number): void
  play(slideId: string, duration: number): void
  pause(): void
  stop(slideId: string): void
  setLoopEnabled(enabled: boolean): void
  setPlaybackSpeed(speed: number): void
  stepFrame(direction: 'forward' | 'backward', slideId: string, duration: number): void
  subscribe(listener: () => void): Unsubscribe
  subscribeEvents(listener: PlaybackEventListener): Unsubscribe
}

interface ActivePlayback {
  readonly slideId: string
  readonly duration: number
}

let rafId: number | null = null
let lastFrameTimestamp = 0
let activePlayback: ActivePlayback | null = null

function nowSeconds(): number {
  return performance.now() / 1000
}

function withTime(
  times: Readonly<Record<string, number>>,
  slideId: string,
  time: number,
): Readonly<Record<string, number>> {
  return { ...times, [slideId]: time }
}

function clampTime(time: number, duration: number): number {
  const finite = Number.isFinite(time) ? time : 0
  const max = Math.max(0, duration)
  return Math.min(Math.max(finite, 0), max)
}

function cancelLoop(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

function setTimeAndEmit(slideId: string, time: number): void {
  const state = usePlaybackController.getState()
  usePlaybackController.setState({ currentTimes: withTime(state.currentTimes, slideId, time) })
  emit({ type: 'CurrentTimeChanged', slideId, time })
}

function finishAt(slideId: string, duration: number): void {
  usePlaybackController.setState({ status: 'stopped' })
  setTimeAndEmit(slideId, duration)
  emit({ type: 'PlaybackFinished', slideId, time: duration })
  cancelLoop()
  activePlayback = null
}

function tick(): void {
  rafId = null
  const state = usePlaybackController.getState()
  const current = activePlayback
  if (state.status !== 'playing' || !current) {
    return
  }
  const now = nowSeconds()
  const delta = (now - lastFrameTimestamp) * state.playbackSpeed
  lastFrameTimestamp = now
  advance(current.slideId, current.duration, delta)
  if (usePlaybackController.getState().status === 'playing') {
    rafId = requestAnimationFrame(tick)
  }
}

function advance(slideId: string, duration: number, delta: number): void {
  const state = usePlaybackController.getState()
  const current = state.currentTimes[slideId] ?? 0
  const next = current + delta
  if (next < duration) {
    setTimeAndEmit(slideId, next)
    return
  }
  if (state.loopEnabled && duration > 0) {
    const wrapped = next % duration
    setTimeAndEmit(slideId, wrapped)
    emit({ type: 'PlaybackLooped', slideId, time: wrapped })
    return
  }
  finishAt(slideId, duration)
}

export const usePlaybackController = create<PlaybackControllerState>()((set, get) => ({
  currentTimes: {},
  status: 'stopped',
  playbackSpeed: 1,
  loopEnabled: false,

  getTime: (slideId: string): number => get().currentTimes[slideId] ?? 0,

  setCurrentTime: (slideId: string, time: number, duration: number): void => {
    const bounded = clampTime(time, duration)
    const previous = get().currentTimes[slideId] ?? 0
    set({ currentTimes: withTime(get().currentTimes, slideId, bounded) })
    if (bounded !== previous) {
      emit({ type: 'CurrentTimeChanged', slideId, time: bounded })
    }
  },

  play: (slideId: string, duration: number): void => {
    const state = get()
    if (state.status === 'playing') {
      return
    }
    let time = state.currentTimes[slideId] ?? 0
    if (time >= duration && !state.loopEnabled) {
      time = 0
      set({ currentTimes: withTime(state.currentTimes, slideId, 0) })
      emit({ type: 'CurrentTimeChanged', slideId, time: 0 })
    }
    activePlayback = { slideId, duration }
    lastFrameTimestamp = nowSeconds()
    set({ status: 'playing' })
    emit({ type: 'PlaybackStarted', slideId, time })
    if (rafId !== null) {
      cancelAnimationFrame(rafId)
    }
    rafId = requestAnimationFrame(tick)
  },

  pause: (): void => {
    const state = get()
    if (state.status !== 'playing') {
      return
    }
    cancelLoop()
    const slideId = activePlayback?.slideId ?? null
    const time = slideId !== null ? (state.currentTimes[slideId] ?? 0) : 0
    activePlayback = null
    set({ status: 'paused' })
    if (slideId !== null) {
      emit({ type: 'PlaybackPaused', slideId, time })
    }
  },

  stop: (slideId: string): void => {
    const wasActive = get().status !== 'stopped'
    const previous = get().currentTimes[slideId] ?? 0
    cancelLoop()
    activePlayback = null
    set({ status: 'stopped', currentTimes: withTime(get().currentTimes, slideId, 0) })
    if (wasActive) {
      emit({ type: 'PlaybackStopped', slideId, time: previous })
    }
    if (previous !== 0) {
      emit({ type: 'CurrentTimeChanged', slideId, time: 0 })
    }
  },

  setLoopEnabled: (enabled: boolean): void => {
    set({ loopEnabled: enabled })
  },

  setPlaybackSpeed: (speed: number): void => {
    set({ playbackSpeed: speed })
  },

  stepFrame: (direction: 'forward' | 'backward', slideId: string, duration: number): void => {
    const state = get()
    if (state.status === 'playing') {
      return
    }
    const current = state.currentTimes[slideId] ?? 0
    const delta = direction === 'forward' ? FRAME_STEP_SECONDS : -FRAME_STEP_SECONDS
    const next = clampTime(current + delta, duration)
    if (next !== current) {
      set({ currentTimes: withTime(state.currentTimes, slideId, next) })
      emit({ type: 'CurrentTimeChanged', slideId, time: next })
    }
  },

  subscribe: (listener: () => void): Unsubscribe => usePlaybackController.subscribe(listener),

  subscribeEvents: (listener: PlaybackEventListener): Unsubscribe => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}))
