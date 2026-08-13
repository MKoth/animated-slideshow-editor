import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentTimeSource } from '../pixi/renderer/sceneRenderer'
import { formatTimeCode, usePlaybackController } from '../stores/playbackStore'

describe('PlaybackController', () => {
  beforeEach(() => {
    usePlaybackController.setState({ currentTimes: {} })
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
