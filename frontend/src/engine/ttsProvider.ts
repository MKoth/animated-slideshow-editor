import type { EmbeddedAsset } from './embeddedAsset'
import type { ApiClient } from '../api/apiClient'
import { newId } from './ids'

export interface TTSRequest {
  readonly text: string
  readonly promptId?: string
  readonly language?: string
  readonly voice?: string
  readonly instruction?: string
}

export interface TTSProvider {
  generate(request: TTSRequest): Promise<EmbeddedAsset>
}

function arrayBufferToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export function parseWavHeader(bytes: Uint8Array): { sampleRate: number; channels: number; byteRate: number; dataSize: number; duration: number } | null {
  if (bytes.length < 12) return null
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    // Verify RIFF/WAVE
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
    const wave = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (riff !== 'RIFF' || wave !== 'WAVE') return null

    let offset = 12
    let sampleRate: number | null = null
    let channels: number | null = null
    let byteRate: number | null = null
    let dataSize: number | null = null
    let bitsPerSample: number | null = null

    while (offset + 8 <= bytes.length) {
      const chunkId = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3])
      const chunkSize = view.getUint32(offset + 4, true)
      // Guard against insane size
      if (chunkSize > bytes.length) break
      if (chunkId === 'fmt ') {
        if (chunkSize >= 16 && offset + 8 + 16 <= bytes.length) {
          // fmt layout: audioFormat(2), channels(2), sampleRate(4), byteRate(4), blockAlign(2), bitsPerSample(2)
          channels = view.getUint16(offset + 8 + 2, true)
          sampleRate = view.getUint32(offset + 8 + 4, true)
          byteRate = view.getUint32(offset + 8 + 8, true)
          bitsPerSample = view.getUint16(offset + 8 + 14, true)
        }
      } else if (chunkId === 'data') {
        dataSize = chunkSize
        // don't break – there may be fmt after data in malformed files, but usually fmt before data
        // we need both, so continue scanning if fmt not yet found
        if (sampleRate !== null && byteRate !== null) break
      }
      // chunk data is padded to even byte boundary
      offset += 8 + chunkSize + (chunkSize % 2)
    }

    if (sampleRate === null || channels === null || dataSize === null) return null
    // Derive byteRate if missing but we have bitsPerSample
    let effectiveByteRate = byteRate
    if ((!effectiveByteRate || effectiveByteRate === 0) && bitsPerSample !== null) {
      effectiveByteRate = sampleRate * channels * (bitsPerSample / 8)
    }
    if (!effectiveByteRate || effectiveByteRate === 0) return null
    const duration = dataSize / effectiveByteRate
    if (!Number.isFinite(duration) || duration <= 0) return null
    return { sampleRate, channels, byteRate: effectiveByteRate, dataSize, duration }
  } catch {
    return null
  }
}

export function wavDurationFromBytes(bytes: Uint8Array): number | null {
  const parsed = parseWavHeader(bytes)
  return parsed ? parsed.duration : null
}

export class TtsApi implements TTSProvider {
  private readonly client: ApiClient

  constructor(client: ApiClient) {
    this.client = client
  }

  async generate(request: TTSRequest): Promise<EmbeddedAsset> {
    if (!request.text || request.text.trim() === '') throw new Error('TTSRequest text must be a non-empty string')
    const body = JSON.stringify(request)
    const bytes = await this.client.postForWav('/api/tts/generate', body)
    const base64 = arrayBufferToBase64(bytes)
    // Try to decode duration from WAV header; fallback to 1s per 15 chars heuristic
    const parsedHeader = parseWavHeader(bytes)
    const headerDuration = parsedHeader?.duration ?? null
    let sampleRate = parsedHeader?.sampleRate ?? 24000
    let channels = parsedHeader?.channels ?? 1
    let waveformPeaks: number[] | undefined
    const duration = headerDuration ?? Math.max(0.5, request.text.length * 0.06 + 0.35)
    // waveformPeaks could be computed via decode, but keep undefined for now (RecordModal computes)
    const id = newId('audio-asset')
    const name = `TTS ${request.text.slice(0, 20)}`
    return {
      id,
      name,
      data: base64,
      mimeType: 'audio/wav',
      metadata: {
        duration,
        sampleRate,
        channels,
        ...(waveformPeaks ? { waveformPeaks } : {}),
      },
    }
  }
}

export interface VoicePrompt {
  readonly id: string
  readonly title: string
  readonly instruction: string
  readonly language?: string
  readonly voice?: string
  readonly params?: Readonly<Record<string, unknown>>
}

export function validateVoicePrompt(value: unknown): string[] {
  const errors: string[] = []
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push('VoicePrompt must be an object')
    return errors
  }
  const v = value as Record<string, unknown>
  if (typeof v.id !== 'string' || v.id === '') errors.push('VoicePrompt id must be a non-empty string')
  if (typeof v.title !== 'string' || v.title === '') errors.push('VoicePrompt title must be a non-empty string')
  if (typeof v.instruction !== 'string' || v.instruction === '') errors.push('VoicePrompt instruction must be a non-empty string')
  if (v.language !== undefined && typeof v.language !== 'string') errors.push('VoicePrompt language must be a string')
  if (v.voice !== undefined && typeof v.voice !== 'string') errors.push('VoicePrompt voice must be a string')
  return errors
}
