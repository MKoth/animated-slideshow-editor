export const MAX_FRONTEND_DECODE_SECONDS = 30
export const PIXELS_PER_SECOND = 20
export const MIN_BUCKETS = 800
export const MAX_BUCKETS = 2000

export function bucketCountForDuration(duration: number | null | undefined): number {
  if (duration == null || !Number.isFinite(duration) || duration <= 0) return MIN_BUCKETS
  const raw = Math.round(duration * PIXELS_PER_SECOND)
  return Math.max(MIN_BUCKETS, Math.min(MAX_BUCKETS, raw))
}

export interface AudioMetadata {
  readonly duration: number
  readonly sampleRate: number
  readonly channels: number
}

export function computePeaksFromAudioBuffer(buffer: AudioBuffer, numBuckets?: number): number[] {
  const duration = buffer.duration
  const buckets = numBuckets ?? bucketCountForDuration(duration)
  if (buckets <= 0) return []
  const channels = buffer.numberOfChannels
  const length = buffer.length
  const samplesPerBucket = Math.max(1, Math.floor(length / buckets))
  const peaks: number[] = new Array(buckets).fill(0)
  for (let i = 0; i < buckets; i++) {
    const start = i * samplesPerBucket
    const end = i === buckets - 1 ? length : Math.min(length, start + samplesPerBucket)
    let maxAbs = 0
    for (let ch = 0; ch < channels; ch++) {
      const data = buffer.getChannelData(ch)
      for (let j = start; j < end; j++) {
        const v = Math.abs(data[j])
        if (v > maxAbs) maxAbs = v
      }
    }
    // clamp 0..1 -> 0..255 8-bit
    const scaled = Math.round(Math.min(1, maxAbs) * 255)
    peaks[i] = scaled
  }
  return peaks
}

export async function decodeAudioFile(file: File): Promise<{ buffer: AudioBuffer; metadata: AudioMetadata; peaks: number[] | null } | null> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    return decodeAudioArrayBuffer(arrayBuffer, file.name)
  } catch {
    return null
  }
}

export async function decodeAudioArrayBuffer(arrayBuffer: ArrayBuffer, _hintName?: string): Promise<{ buffer: AudioBuffer; metadata: AudioMetadata; peaks: number[] | null } | null> {
  const Ctor = getAudioContextCtor()
  if (!Ctor) return null
  const ctx = new Ctor()
  try {
    const buf = await ctx.decodeAudioData(arrayBuffer.slice(0))
    const metadata: AudioMetadata = {
      duration: buf.duration,
      sampleRate: buf.sampleRate,
      channels: buf.numberOfChannels,
    }
    const peaks = metadata.duration < MAX_FRONTEND_DECODE_SECONDS ? computePeaksFromAudioBuffer(buf) : null
    return { buffer: buf, metadata, peaks }
  } catch {
    return null
  } finally {
    try {
      await ctx.close()
    } catch {
      // ignore
    }
  }
}

export async function decodeBase64Audio(base64: string, mimeType: string): Promise<{ metadata: AudioMetadata; peaks: number[] | null } | null> {
  try {
    const bytes = base64ToBytes(base64)
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const Ctor = getAudioContextCtor()
    if (!Ctor) return fallbackMetadataFromBytes(bytes, mimeType)
    const ctx = new Ctor()
    try {
      const audioBuffer = await ctx.decodeAudioData(buffer.slice(0))
      const metadata: AudioMetadata = {
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        channels: audioBuffer.numberOfChannels,
      }
      const peaks = metadata.duration < MAX_FRONTEND_DECODE_SECONDS ? computePeaksFromAudioBuffer(audioBuffer) : null
      return { metadata, peaks }
    } finally {
      try { await ctx.close() } catch { /* ignore */ }
    }
  } catch {
    return null
  }
}

function fallbackMetadataFromBytes(bytes: Uint8Array, mimeType: string): { metadata: AudioMetadata; peaks: null } | null {
  void mimeType
  // Very rough: if wav, try to parse header without decode
  try {
    if (bytes.length >= 44 && bytes[0] === 0x52 && bytes[1] === 0x49) {
      // RIFF header
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const channels = view.getUint16(22, true)
      const sampleRate = view.getUint32(24, true)
      const byteRate = view.getUint32(28, true)
      const dataSize = bytes.length - 44
      const duration = byteRate ? dataSize / byteRate : 1
      if (Number.isFinite(duration) && duration > 0) {
        return { metadata: { duration, sampleRate, channels }, peaks: null }
      }
    }
  } catch { /* ignore */ }
  return null
}

function getAudioContextCtor(): typeof AudioContext | null {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

export function slicePeaksForClip(peaks: readonly number[], assetDuration: number, sourceStart: number, sourceEnd: number): number[] {
  if (!peaks.length || assetDuration <= 0) return [...peaks]
  const startRatio = Math.max(0, Math.min(1, sourceStart / assetDuration))
  const endRatio = Math.max(0, Math.min(1, sourceEnd / assetDuration))
  const startIdx = Math.floor(startRatio * peaks.length)
  const endIdx = Math.ceil(endRatio * peaks.length)
  return peaks.slice(startIdx, endIdx)
}

/** Frontend quick path: duration <30s decode peaks, else null (backend canonical). */
export function shouldDecodeFrontend(duration: number | null | undefined): boolean {
  return typeof duration === 'number' && Number.isFinite(duration) && duration < MAX_FRONTEND_DECODE_SECONDS
}

export function formatDurationBadge(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const fraction = Math.round((seconds % 1) * 10)
  const mm = String(mins).padStart(2, '0')
  const ss = String(secs).padStart(2, '0')
  if (fraction > 0 && seconds < 60) return `${mm}:${ss}.${fraction}`
  return `${mm}:${ss}`
}
