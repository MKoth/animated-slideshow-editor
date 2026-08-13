import { create } from 'zustand'
import type { Unsubscribe } from '../engine'

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

export interface PlaybackControllerState {
  readonly currentTimes: Readonly<Record<string, number>>
  getTime(slideId: string): number
  setCurrentTime(slideId: string, time: number, duration: number): void
  subscribe(listener: () => void): Unsubscribe
}

export const usePlaybackController = create<PlaybackControllerState>()((set, get) => ({
  currentTimes: {},

  getTime: (slideId: string): number => get().currentTimes[slideId] ?? 0,

  setCurrentTime: (slideId: string, time: number, duration: number): void => {
    const finite = Number.isFinite(time) ? time : 0
    const max = Math.max(0, duration)
    const bounded = Math.min(Math.max(finite, 0), max)
    set({ currentTimes: { ...get().currentTimes, [slideId]: bounded } })
  },

  subscribe: (listener: () => void): Unsubscribe => usePlaybackController.subscribe(listener),
}))
