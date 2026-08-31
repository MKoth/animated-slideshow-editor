// Recording seam — pure helpers + injectable factories for testability
import { computePeaksFromAudioBuffer } from './waveform'

export interface RecordingErrorInfo {
  readonly kind: 'notAllowed' | 'notFound' | 'unknown'
  readonly message: string
  readonly hint: string
  readonly retryable: boolean
}

export function getRecordingErrorInfo(error: unknown): RecordingErrorInfo {
  const name = (error as { name?: string })?.name ?? ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return {
      kind: 'notAllowed',
      message: 'Microphone access denied.',
      hint: 'Please allow microphone access and retry. Check system settings → Privacy → Microphone.',
      retryable: true,
    }
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      kind: 'notFound',
      message: 'No microphone found.',
      hint: 'Connect a microphone and try again. Verify input device in system settings.',
      retryable: true,
    }
  }
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error')
  return {
    kind: 'unknown',
    message: `Recording failed: ${message}`,
    hint: 'Try again or check your audio input device.',
    retryable: true,
  }
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

/** Minimal WAV encoder for PCM float32 data (mono/stereo). Used if MediaRecorder gave webm and we need WAV base64. */
export function encodeWavFromAudioBuffer(buffer: AudioBuffer): string {
  const numChannels = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const interleaved = interleaveChannels(buffer)
  const wavBuffer = encodeWav(interleaved, numChannels, sampleRate, 16)
  const bytes = new Uint8Array(wavBuffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function interleaveChannels(buffer: AudioBuffer): Float32Array {
  const numChannels = buffer.numberOfChannels
  if (numChannels === 1) return buffer.getChannelData(0).slice()
  const length = buffer.length
  const out = new Float32Array(length * numChannels)
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      out[i * numChannels + ch] = buffer.getChannelData(ch)[i]
    }
  }
  return out
}

function encodeWav(samples: Float32Array, numChannels: number, sampleRate: number, bitsPerSample: number): ArrayBuffer {
  const bytesPerSample = bitsPerSample / 8
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  // RIFF
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // PCM
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)
  // PCM data
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    const intSample = s < 0 ? s * 0x8000 : s * 0x7fff
    view.setInt16(offset, intSample, true)
    offset += 2
  }
  return buffer
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
}

export interface DecodedAudioMetadata {
  readonly duration: number
  readonly sampleRate: number
  readonly channels: number
  readonly waveformPeaks?: number[]
}

export type AudioContextFactory = () => AudioContext | null

export function getAudioContextCtor(): typeof AudioContext | null {
  const w = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

export async function decodeAudioMetadata(
  base64: string,
  audioContextFactory?: AudioContextFactory,
): Promise<DecodedAudioMetadata> {
  const bytes = base64ToArrayBuffer(base64)
  // Try decode via factory or global AudioContext
  let ctx: AudioContext | null = null
  let ctor: typeof AudioContext | null = null
  if (audioContextFactory) {
    ctx = audioContextFactory()
  } else {
    ctor = getAudioContextCtor()
    if (ctor) ctx = new ctor()
  }
  if (!ctx) {
    // Fallback: parse WAV header for duration
    const view = new DataView(bytes)
    try {
      if (bytes.byteLength >= 44) {
        const sampleRate = view.getUint32(24, true)
        const channels = view.getUint16(22, true)
        const byteRate = view.getUint32(28, true)
        const dataSize = bytes.byteLength - 44
        const duration = byteRate ? dataSize / byteRate : 1
        return { duration, sampleRate: sampleRate || 44100, channels: channels || 1 }
      }
    } catch {
      // ignore
    }
    return { duration: 1, sampleRate: 44100, channels: 1 }
  }
  try {
    const buf = await ctx.decodeAudioData(bytes.slice(0))
    const peaks = buf.duration < 30 ? computePeaksFromAudioBuffer(buf) : undefined
    return {
      duration: buf.duration,
      sampleRate: buf.sampleRate,
      channels: buf.numberOfChannels,
      waveformPeaks: peaks,
    }
  } finally {
    try {
      await ctx.close()
    } catch {
      // ignore
    }
  }
}

export function createWavBase64FromBlobFallback(blob: Blob, decoded: DecodedAudioMetadata): string | null {
  void blob
  void decoded
  return null
}

// ----------------------------------------------------------------------------
// Injectable factories for tests
// ----------------------------------------------------------------------------

export type GetUserMediaLike = (constraints: MediaStreamConstraints) => Promise<MediaStream>
export type MediaRecorderCtorLike = new (stream: MediaStream, options?: MediaRecorderOptions) => MediaRecorderLike
export interface MediaRecorderLike {
  readonly state: string
  ondataavailable: ((event: { data: Blob }) => void) | null
  onstop: (() => void) | null
  start(): void
  stop(): void
  readonly stream: MediaStream
}

export interface RecordingControllerOptions {
  getUserMedia?: GetUserMediaLike
  MediaRecorderCtor?: MediaRecorderCtorLike
  AudioContextCtor?: new () => AudioContext
  analyserFftSize?: number
}

export interface RecordingHandle {
  readonly stream: MediaStream
  readonly mediaRecorder: MediaRecorderLike
  readonly audioContext: AudioContext | null
  readonly analyser: AnalyserNode | null
  readonly stop: () => void
  readonly getLevel: () => number // 0..1 instantaneous RMS-ish via AnalyserNode
  readonly cleanup: () => void
}
