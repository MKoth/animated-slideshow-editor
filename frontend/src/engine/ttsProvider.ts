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

function wavDurationFromBytes(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    // RIFF/WAVE check could be added but we just parse fmt
    const sampleRate = view.getUint32(24, true)
    const channels = view.getUint16(22, true)
    const byteRate = view.getUint32(28, true)
    const dataSize = view.getUint32(40, true)
    if (!sampleRate || !byteRate) return null
    const duration = dataSize / byteRate
    if (!Number.isFinite(duration) || duration <= 0) return null
    void channels
    return duration
  } catch {
    return null
  }
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
    const headerDuration = wavDurationFromBytes(bytes)
    // Attempt decodeAudioData for sampleRate/channels if available in test/mocked env
    let sampleRate = 24000
    let channels = 1
    let waveformPeaks: number[] | undefined
    // Quick parse from header for sampleRate/channels
    try {
      if (bytes.length >= 44) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        sampleRate = view.getUint32(24, true) || sampleRate
        channels = view.getUint16(22, true) || channels
      }
    } catch {
      // ignore
    }
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
