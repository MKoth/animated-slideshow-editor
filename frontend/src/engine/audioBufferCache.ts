import {
  MAX_DURATION_GUARD_SECONDS,
  AUDIO_CACHE_MAX_ENTRIES,
  AUDIO_CACHE_MAX_BYTES,
} from './audioSync'

export interface CachedAudioBuffer {
  readonly assetId: string
  readonly buffer: unknown // AudioBuffer or mocked
  readonly byteSize: number
  readonly duration: number
}

export class AudioBufferCache {
  readonly maxEntries: number
  readonly maxBytes: number
  readonly guardSeconds: number

  private readonly map = new Map<string, CachedAudioBuffer>()
  private byteSize = 0

  constructor(
    maxEntries: number = AUDIO_CACHE_MAX_ENTRIES,
    maxBytes: number = AUDIO_CACHE_MAX_BYTES,
    guardSeconds: number = MAX_DURATION_GUARD_SECONDS,
  ) {
    this.maxEntries = maxEntries
    this.maxBytes = maxBytes
    this.guardSeconds = guardSeconds
  }

  get size(): number {
    return this.map.size
  }

  get totalBytes(): number {
    return this.byteSize
  }

  has(assetId: string): boolean {
    return this.map.has(assetId)
  }

  get(assetId: string): CachedAudioBuffer | undefined {
    const entry = this.map.get(assetId)
    if (!entry) return undefined
    // LRU: move to end (most recent)
    this.map.delete(assetId)
    this.map.set(assetId, entry)
    return entry
  }

  peek(assetId: string): CachedAudioBuffer | undefined {
    return this.map.get(assetId)
  }

  /**
   * Guard: durations > 600 s should fall back to MediaElementAudioSourceNode,
   * not be cached as AudioBuffer.
   */
  shouldUseMediaElement(duration: number): boolean {
    return duration > this.guardSeconds
  }

  getFallbackMode(duration: number): 'buffer' | 'mediaElement' {
    return this.shouldUseMediaElement(duration) ? 'mediaElement' : 'buffer'
  }

  set(assetId: string, buffer: unknown, byteSize: number, duration: number): boolean {
    if (this.shouldUseMediaElement(duration)) return false
    // evict existing to update size correctly
    if (this.map.has(assetId)) {
      const prev = this.map.get(assetId)!
      this.byteSize -= prev.byteSize
      this.map.delete(assetId)
    }
    const entry: CachedAudioBuffer = { assetId, buffer, byteSize, duration }
    this.map.set(assetId, entry)
    this.byteSize += byteSize
    this.evictIfNeeded()
    return true
  }

  delete(assetId: string): boolean {
    const entry = this.map.get(assetId)
    if (!entry) return false
    this.byteSize -= entry.byteSize
    this.map.delete(assetId)
    return true
  }

  clear(): void {
    this.map.clear()
    this.byteSize = 0
  }

  /**
   * Evict on slide switch — keep only buffers for the active slide's assetIds.
   * If keepIds is undefined/null, clear all.
   */
  evictOnSlideSwitch(keepIds?: ReadonlySet<string> | readonly string[] | null): void {
    if (!keepIds) {
      this.clear()
      return
    }
    const keep = keepIds instanceof Set ? keepIds : new Set(keepIds)
    for (const key of [...this.map.keys()]) {
      if (!keep.has(key)) {
        const entry = this.map.get(key)!
        this.byteSize -= entry.byteSize
        this.map.delete(key)
      }
    }
  }

  evictForSlideSwitch(keepIds?: ReadonlySet<string> | readonly string[] | null): void {
    this.evictOnSlideSwitch(keepIds)
  }

  keys(): string[] {
    return [...this.map.keys()]
  }

  entries(): CachedAudioBuffer[] {
    return [...this.map.values()]
  }

  private evictIfNeeded(): void {
    // evict oldest first until within limits
    while (
      (this.map.size > this.maxEntries || this.byteSize > this.maxBytes) &&
      this.map.size > 0
    ) {
      const oldestKey = this.map.keys().next().value as string
      const entry = this.map.get(oldestKey)!
      this.byteSize -= entry.byteSize
      this.map.delete(oldestKey)
    }
  }
}

// Singleton for active-slide LRU (8–12 / ~50 MB) — can be instantiated per controller as well
export const activeSlideAudioCache = new AudioBufferCache()
