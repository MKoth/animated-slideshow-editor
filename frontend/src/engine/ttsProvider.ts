import type { EmbeddedAsset } from './embeddedAsset'

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
