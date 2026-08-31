import { describe, expect, it, vi } from 'vitest'
import {
  bucketCountForDuration,
  computePeaksFromAudioBuffer,
  slicePeaksForClip,
  formatDurationBadge,
  shouldDecodeFrontend,
} from '../audio/waveform'

function mockAudioBuffer(duration: number, sampleRate: number, channels: number, values: Float32Array[]): AudioBuffer {
  const length = Math.floor(duration * sampleRate)
  return {
    duration,
    sampleRate,
    numberOfChannels: channels,
    length,
    getChannelData: (ch: number) => values[ch] ?? new Float32Array(length),
  } as unknown as AudioBuffer
}

describe('waveform buckets', () => {
  it('clamps to 800–2000 at 20 px/s', () => {
    expect(bucketCountForDuration(null)).toBe(800)
    expect(bucketCountForDuration(0)).toBe(800)
    expect(bucketCountForDuration(2)).toBe(800) // 2*20=40 → 800 min
    expect(bucketCountForDuration(10)).toBe(800)
    expect(bucketCountForDuration(40)).toBe(800)
    expect(bucketCountForDuration(50)).toBe(1000)
    expect(bucketCountForDuration(100)).toBe(2000)
    expect(bucketCountForDuration(200)).toBe(2000)
  })

  it('computes 8-bit peaks max-abs per bucket', () => {
    const sr = 1000
    const duration = 2 // buckets 800
    const length = sr * duration
    const ch0 = new Float32Array(length)
    for (let i = 0; i < length; i++) ch0[i] = Math.sin((2 * Math.PI * i) / 100) * 0.5
    const buf = mockAudioBuffer(duration, sr, 1, [ch0])
    const peaks = computePeaksFromAudioBuffer(buf)
    expect(peaks.length).toBe(800)
    expect(peaks.every((p) => p >= 0 && p <= 255)).toBe(true)
    // sine 0.5 amplitude → ~127
    expect(Math.max(...peaks)).toBeGreaterThan(100)
    expect(Math.min(...peaks)).toBeGreaterThanOrEqual(0)
  })

  it('slicePeaksForClip maps sourceStart/sourceEnd to peak indices', () => {
    const peaks = Array.from({ length: 800 }, (_, i) => i % 256)
    const assetDuration = 10
    const sliced = slicePeaksForClip(peaks, assetDuration, 2, 6) // 20%..60%
    expect(sliced.length).toBeGreaterThan(300)
    expect(sliced.length).toBeLessThan(500)
    // start idx ~ 0.2*800=160, end ~0.6*800=480
    expect(sliced[0]).toBe(peaks[160])
  })

  it('formatDurationBadge mm:ss from cached duration', () => {
    expect(formatDurationBadge(0)).toBe('00:00')
    expect(formatDurationBadge(65)).toBe('01:05')
    expect(formatDurationBadge(2.5)).toBe('00:02.5')
    expect(formatDurationBadge(125.7)).toBe('02:05')
  })

  it('shouldDecodeFrontend only for <30 s', () => {
    expect(shouldDecodeFrontend(29.9)).toBe(true)
    expect(shouldDecodeFrontend(30)).toBe(false)
    expect(shouldDecodeFrontend(60)).toBe(false)
    expect(shouldDecodeFrontend(null)).toBe(false)
  })
})
