import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentTimeSource } from '../pixi/renderer/sceneRenderer'
import {
  FRAME_STEP_SECONDS,
  PLAYBACK_SPEEDS,
  formatTimeCode,
  usePlaybackController,
} from '../stores/playbackStore'
import type { PlaybackEvent } from '../stores/playbackStore'

describe('PlaybackController', () => {
  beforeEach(() => {
    usePlaybackController.setState({
      currentTimes: {},
      status: 'stopped',
      playbackSpeed: 1,
      loopEnabled: false,
    })
    localStorage.clear()
  })

  it('defaults current time to 0 for every slide', () => {
    const store = usePlaybackController.getState()
    expect(store.getTime('slide-1')).toBe(0)
    expect(store.getTime('slide-2')).toBe(0)
  })

  it('stores current time keyed per slide id', () => {
    usePlaybackController.getState().setCurrentTime('slide-1', 3.5, 10)
    usePlaybackController.getState().setCurrentTime('slide-2', 7, 10)
    const store = usePlaybackController.getState()
    expect(store.getTime('slide-1')).toBe(3.5)
    expect(store.getTime('slide-2')).toBe(7)
  })

  it('clamps current time to [0, duration]', () => {
    const store = usePlaybackController.getState()
    store.setCurrentTime('a', -2, 10)
    expect(store.getTime('a')).toBe(0)
    store.setCurrentTime('a', 12, 10)
    expect(store.getTime('a')).toBe(10)
    store.setCurrentTime('a', 5, 0)
    expect(store.getTime('a')).toBe(0)
  })

  it('notifies subscribers when current time changes', () => {
    const listener = vi.fn()
    const unsubscribe = usePlaybackController.subscribe(listener)
    usePlaybackController.getState().setCurrentTime('a', 1, 10)
    expect(listener).toHaveBeenCalledTimes(1)
    usePlaybackController.getState().setCurrentTime('a', 1, 10)
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('conforms to the renderer CurrentTimeSource contract', () => {
    const source: CurrentTimeSource = {
      getTime: (slideId) => usePlaybackController.getState().getTime(slideId),
      subscribe: (listener) => usePlaybackController.subscribe(listener),
    }
    expect(source.getTime('a')).toBe(0)
    expect(typeof source.subscribe).toBe('function')
    const listener = vi.fn()
    const unsubscribe = source.subscribe(listener)
    usePlaybackController.getState().setCurrentTime('a', 1, 10)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('never persists current time into localStorage', () => {
    usePlaybackController.getState().setCurrentTime('a', 4.2, 10)
    expect(Object.keys(localStorage)).toHaveLength(0)
  })
})

describe('formatTimeCode', () => {
  it('formats seconds as MM:SS.mmm', () => {
    expect(formatTimeCode(0)).toBe('00:00.000')
    expect(formatTimeCode(0.5)).toBe('00:00.500')
    expect(formatTimeCode(1.05)).toBe('00:01.050')
    expect(formatTimeCode(65.432)).toBe('01:05.432')
    expect(formatTimeCode(599.999)).toBe('09:59.999')
    expect(formatTimeCode(600)).toBe('10:00.000')
  })
})

describe('PlaybackController playback', () => {
  const SLIDE = 'slide-1'

  beforeEach(() => {
    usePlaybackController.setState({
      currentTimes: {},
      status: 'stopped',
      playbackSpeed: 1,
      loopEnabled: false,
    })
    localStorage.clear()
  })

  afterEach(() => {
    const state = usePlaybackController.getState()
    if (state.status === 'playing') {
      state.pause()
    }
  })

  function play(duration = 10): void {
    usePlaybackController.getState().play(SLIDE, duration)
  }

  it('defaults to stopped, 1× speed and no loop', () => {
    const state = usePlaybackController.getState()
    expect(state.status).toBe('stopped')
    expect(state.playbackSpeed).toBe(1)
    expect(state.loopEnabled).toBe(false)
  })

  it('starts playing from the playhead and advances current time', () => {
    vi.useFakeTimers()
    try {
      usePlaybackController.getState().setCurrentTime(SLIDE, 2, 10)
      const events: PlaybackEvent[] = []
      const unsubscribe = usePlaybackController
        .getState()
        .subscribeEvents((event) => events.push(event))

      play()
      expect(usePlaybackController.getState().status).toBe('playing')
      expect(events[0]).toEqual({ type: 'PlaybackStarted', slideId: SLIDE, time: 2 })

      vi.advanceTimersByTime(2000)
      const time = usePlaybackController.getState().getTime(SLIDE)
      expect(time).toBeCloseTo(4, 3)
      expect(usePlaybackController.getState().status).toBe('playing')
      const FAKE_TIMER_FRAME_MS = 16
      expect(events.filter((event) => event.type === 'CurrentTimeChanged')).toHaveLength(
        2000 / FAKE_TIMER_FRAME_MS,
      )
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts from 0 when played from the end without looping', () => {
    vi.useFakeTimers()
    try {
      const events: PlaybackEvent[] = []
      const unsubscribe = usePlaybackController
        .getState()
        .subscribeEvents((event) => events.push(event))
      usePlaybackController.getState().setCurrentTime(SLIDE, 10, 10)

      play()
      expect(usePlaybackController.getState().getTime(SLIDE)).toBe(0)
      expect(events.some((event) => event.type === 'CurrentTimeChanged')).toBe(true)
      expect(events.some((event) => event.type === 'PlaybackStarted' && event.time === 0)).toBe(
        true,
      )

      vi.advanceTimersByTime(1000)
      expect(usePlaybackController.getState().getTime(SLIDE)).toBeGreaterThan(0)
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts from the end and wraps on the first frame when looping', () => {
    vi.useFakeTimers()
    try {
      const events: PlaybackEvent[] = []
      const unsubscribe = usePlaybackController
        .getState()
        .subscribeEvents((event) => events.push(event))
      usePlaybackController.getState().setLoopEnabled(true)
      usePlaybackController.getState().setCurrentTime(SLIDE, 10, 10)

      play()
      expect(usePlaybackController.getState().getTime(SLIDE)).toBe(10)
      expect(events.some((event) => event.type === 'PlaybackStarted' && event.time === 10)).toBe(
        true,
      )

      vi.advanceTimersByTime(16)
      expect(usePlaybackController.getState().getTime(SLIDE)).toBeLessThan(1)
      expect(usePlaybackController.getState().status).toBe('playing')
      expect(events.some((event) => event.type === 'PlaybackLooped')).toBe(true)
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops immediately on a zero-duration slide even when looping', () => {
    vi.useFakeTimers()
    try {
      const events: PlaybackEvent[] = []
      const unsubscribe = usePlaybackController
        .getState()
        .subscribeEvents((event) => events.push(event))
      usePlaybackController.getState().setLoopEnabled(true)

      play(0)
      vi.advanceTimersByTime(1000)

      const state = usePlaybackController.getState()
      expect(state.status).toBe('stopped')
      expect(state.getTime(SLIDE)).toBe(0)
      expect(events.some((event) => event.type === 'PlaybackFinished')).toBe(true)
      expect(events.some((event) => event.type === 'PlaybackLooped')).toBe(false)
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('pauses, preserves the position and stops advancing time', () => {
    vi.useFakeTimers()
    try {
      const events: PlaybackEvent[] = []
      const unsubscribe = usePlaybackController
        .getState()
        .subscribeEvents((event) => events.push(event))
      play()
      vi.advanceTimersByTime(1000)

      usePlaybackController.getState().pause()
      const pausedTime = usePlaybackController.getState().getTime(SLIDE)
      expect(pausedTime).toBeGreaterThan(0)
      expect(usePlaybackController.getState().status).toBe('paused')
      expect(events[events.length - 1]).toEqual({
        type: 'PlaybackPaused',
        slideId: SLIDE,
        time: pausedTime,
      })

      vi.advanceTimersByTime(2000)
      expect(usePlaybackController.getState().getTime(SLIDE)).toBe(pausedTime)

      usePlaybackController.getState().play(SLIDE, 10)
      vi.advanceTimersByTime(1000)
      expect(usePlaybackController.getState().getTime(SLIDE)).toBeGreaterThan(pausedTime)
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop ends playback and resets the current time to 0', () => {
    vi.useFakeTimers()
    try {
      const events: PlaybackEvent[] = []
      const unsubscribe = usePlaybackController
        .getState()
        .subscribeEvents((event) => events.push(event))
      play()
      vi.advanceTimersByTime(1000)

      usePlaybackController.getState().stop(SLIDE)
      expect(usePlaybackController.getState().status).toBe('stopped')
      expect(usePlaybackController.getState().getTime(SLIDE)).toBe(0)
      expect(events.some((event) => event.type === 'PlaybackStopped')).toBe(true)

      vi.advanceTimersByTime(2000)
      expect(usePlaybackController.getState().getTime(SLIDE)).toBe(0)
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('advances at every supported speed', () => {
    vi.useFakeTimers()
    try {
      expect(PLAYBACK_SPEEDS).toEqual([0.25, 0.5, 1, 1.5, 2, 4])
      for (const speed of PLAYBACK_SPEEDS) {
        usePlaybackController.getState().setPlaybackSpeed(speed)
        play()
        vi.advanceTimersByTime(2000)
        expect(usePlaybackController.getState().getTime(SLIDE)).toBeCloseTo(2 * speed, 3)
        usePlaybackController.getState().stop(SLIDE)
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops at the slide duration and emits PlaybackFinished when not looping', () => {
    vi.useFakeTimers()
    try {
      const events: PlaybackEvent[] = []
      const unsubscribe = usePlaybackController
        .getState()
        .subscribeEvents((event) => events.push(event))

      play(2)
      vi.advanceTimersByTime(2000)

      const state = usePlaybackController.getState()
      expect(state.status).toBe('stopped')
      expect(state.getTime(SLIDE)).toBe(2)
      expect(events.some((event) => event.type === 'PlaybackFinished')).toBe(true)
      expect(events.some((event) => event.type === 'PlaybackLooped')).toBe(false)
      expect(events.every((event) => event.type !== 'PlaybackStopped')).toBe(true)
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('wraps around the duration and continues when looping', () => {
    vi.useFakeTimers()
    try {
      const events: PlaybackEvent[] = []
      const unsubscribe = usePlaybackController
        .getState()
        .subscribeEvents((event) => events.push(event))
      usePlaybackController.getState().setLoopEnabled(true)

      play(1)
      vi.advanceTimersByTime(2000)

      const state = usePlaybackController.getState()
      expect(state.status).toBe('playing')
      expect(state.getTime(SLIDE)).toBeGreaterThanOrEqual(0)
      expect(state.getTime(SLIDE)).toBeLessThan(1)
      expect(events.some((event) => event.type === 'PlaybackLooped')).toBe(true)
      expect(events.some((event) => event.type === 'PlaybackFinished')).toBe(false)
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('continues from a scrubbed position during playback', () => {
    vi.useFakeTimers()
    try {
      play()
      vi.advanceTimersByTime(500)

      usePlaybackController.getState().setCurrentTime(SLIDE, 4, 10)
      expect(usePlaybackController.getState().status).toBe('playing')

      vi.advanceTimersByTime(1000)
      expect(usePlaybackController.getState().getTime(SLIDE)).toBeGreaterThan(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('steps forward and backward by exactly 1/60 s while paused, clamped to the duration', () => {
    vi.useFakeTimers()
    try {
      const store = usePlaybackController.getState()
      store.setCurrentTime(SLIDE, 3, 10)
      store.pause()

      store.stepFrame('forward', SLIDE, 10)
      expect(usePlaybackController.getState().getTime(SLIDE)).toBeCloseTo(3 + FRAME_STEP_SECONDS, 9)
      store.stepFrame('backward', SLIDE, 10)
      expect(usePlaybackController.getState().getTime(SLIDE)).toBeCloseTo(3, 9)

      store.setCurrentTime(SLIDE, 0.001, 10)
      store.stepFrame('backward', SLIDE, 10)
      expect(usePlaybackController.getState().getTime(SLIDE)).toBe(0)

      store.setCurrentTime(SLIDE, 10, 10)
      store.stepFrame('forward', SLIDE, 10)
      expect(usePlaybackController.getState().getTime(SLIDE)).toBe(10)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores frame stepping while playing', () => {
    vi.useFakeTimers()
    try {
      play()
      vi.advanceTimersByTime(500)
      const before = usePlaybackController.getState().getTime(SLIDE)

      usePlaybackController.getState().stepFrame('forward', SLIDE, 10)
      expect(usePlaybackController.getState().getTime(SLIDE)).toBe(before)
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits exactly its store events and nothing else', () => {
    vi.useFakeTimers()
    try {
      const events: PlaybackEvent[] = []
      const unsubscribe = usePlaybackController
        .getState()
        .subscribeEvents((event) => events.push(event))

      usePlaybackController.getState().setCurrentTime(SLIDE, 1, 10)
      play(2)
      vi.advanceTimersByTime(2000)
      play(2)
      vi.advanceTimersByTime(1000)
      usePlaybackController.getState().pause()
      usePlaybackController.getState().stop(SLIDE)

      const types = new Set(events.map((event) => event.type))
      expect(types).toEqual(
        new Set([
          'CurrentTimeChanged',
          'PlaybackStarted',
          'PlaybackFinished',
          'PlaybackPaused',
          'PlaybackStopped',
        ]),
      )
      expect(events.some((event) => event.type === 'PlaybackLooped')).toBe(false)
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits CurrentTimeChanged when scrubbing and keeps the status untouched', () => {
    const events: PlaybackEvent[] = []
    const unsubscribe = usePlaybackController
      .getState()
      .subscribeEvents((event) => events.push(event))
    usePlaybackController.getState().setCurrentTime(SLIDE, 2.5, 10)
    expect(events).toEqual([{ type: 'CurrentTimeChanged', slideId: SLIDE, time: 2.5 }])
    expect(usePlaybackController.getState().status).toBe('stopped')
    unsubscribe()
  })

  it('emits PlaybackLooped when looping wraps the time', () => {
    vi.useFakeTimers()
    try {
      const events: PlaybackEvent[] = []
      const unsubscribe = usePlaybackController
        .getState()
        .subscribeEvents((event) => events.push(event))
      usePlaybackController.getState().setLoopEnabled(true)
      usePlaybackController.getState().setCurrentTime(SLIDE, 0.9, 1)
      play(1)
      vi.advanceTimersByTime(1000)

      const looped = events.filter((event) => event.type === 'PlaybackLooped')
      expect(looped.length).toBeGreaterThan(0)
      expect(usePlaybackController.getState().status).toBe('playing')
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })

  it('changes loop and speed settings without emitting events', () => {
    const events: PlaybackEvent[] = []
    const unsubscribe = usePlaybackController
      .getState()
      .subscribeEvents((event) => events.push(event))
    usePlaybackController.getState().setLoopEnabled(true)
    usePlaybackController.getState().setPlaybackSpeed(2)
    expect(usePlaybackController.getState().loopEnabled).toBe(true)
    expect(usePlaybackController.getState().playbackSpeed).toBe(2)
    expect(events).toEqual([])
    unsubscribe()
  })

  it('never persists playback state into localStorage', () => {
    usePlaybackController.getState().play(SLIDE, 10)
    usePlaybackController.getState().setLoopEnabled(true)
    usePlaybackController.getState().setPlaybackSpeed(4)
    expect(Object.keys(localStorage)).toHaveLength(0)
  })
})

describe('PlaybackController reset', () => {
  beforeEach(() => {
    usePlaybackController.setState({
      currentTimes: {},
      status: 'stopped',
      playbackSpeed: 1,
      loopEnabled: false,
    })
    localStorage.clear()
  })

  it('clears every per-slide current time and stops playback', () => {
    const state = usePlaybackController.getState()
    state.setCurrentTime('slide-a', 3, 10)
    state.setCurrentTime('slide-b', 7, 10)
    usePlaybackController.setState({ status: 'playing' })

    usePlaybackController.getState().reset()

    const after = usePlaybackController.getState()
    expect(after.currentTimes).toEqual({})
    expect(after.getTime('slide-a')).toBe(0)
    expect(after.getTime('slide-b')).toBe(0)
    expect(after.status).toBe('stopped')
  })

  it('stops an active playback loop and never advances afterwards', () => {
    vi.useFakeTimers()
    try {
      usePlaybackController.getState().play('slide-a', 10)
      vi.advanceTimersByTime(500)

      usePlaybackController.getState().reset()
      expect(usePlaybackController.getState().status).toBe('stopped')

      vi.advanceTimersByTime(2000)
      expect(usePlaybackController.getState().getTime('slide-a')).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('emits no playback events', () => {
    const events: PlaybackEvent[] = []
    const unsubscribe = usePlaybackController
      .getState()
      .subscribeEvents((event) => events.push(event))
    usePlaybackController.getState().setCurrentTime('slide-a', 3, 10)

    usePlaybackController.getState().reset()

    expect(events).toEqual([{ type: 'CurrentTimeChanged', slideId: 'slide-a', time: 3 }])
    unsubscribe()
  })
})
