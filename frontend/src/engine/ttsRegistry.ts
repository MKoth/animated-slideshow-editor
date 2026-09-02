export const SUPPORTED_MODELS: readonly string[] = [
  'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16',
  'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16',
  'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16',
  'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16',
  'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16',
] as const

export const DEFAULT_MODEL_ID: string = SUPPORTED_MODELS[0]
export const DEFAULT_PROVIDER = 'auto' as const
export const SUPPORTED_PROVIDERS: readonly string[] = ['auto', 'sine', 'mlx'] as const

export type TtsProviderId = (typeof SUPPORTED_PROVIDERS)[number]

export interface ModelCapabilities {
  languages: string[]
  speakers: string[]
  instructionSupported: boolean
  speakerHints?: Record<string, string>
  speakerMeta?: Record<string, { description: string; nativeLanguage: string; iso: string }>
  downloaded?: boolean
}

// Static fallback capabilities (mirrors backend registry)
const FALLBACK_CAPABILITIES: Record<string, ModelCapabilities> = {
  'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16': {
    languages: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'],
    speakers: ['Vivian', 'Serena', 'Uncle_Fu', 'Dylan', 'Eric', 'Ryan', 'Aiden', 'Ono_Anna', 'Sohee'],
    instructionSupported: false,
  },
  'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16': {
    languages: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'],
    speakers: ['Vivian', 'Serena', 'Uncle_Fu', 'Dylan', 'Eric', 'Ryan', 'Aiden', 'Ono_Anna', 'Sohee'],
    instructionSupported: true,
  },
  'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16': {
    languages: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'],
    speakers: ['Chelsie', 'Ethan', 'Vivian', 'Serena', 'Ryan', 'Aiden'],
    instructionSupported: false,
  },
  'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16': {
    languages: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'],
    speakers: ['Chelsie', 'Ethan', 'Vivian', 'Serena', 'Ryan', 'Aiden'],
    instructionSupported: false,
  },
  'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16': {
    languages: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'],
    speakers: ['Vivian', 'Serena', 'Ryan', 'Aiden', 'Ono_Anna', 'Sohee', 'Chelsie', 'Ethan'],
    instructionSupported: true,
  },
}

export function getFallbackCapabilities(modelId: string): ModelCapabilities {
  return FALLBACK_CAPABILITIES[modelId] ?? FALLBACK_CAPABILITIES[DEFAULT_MODEL_ID]!
}

export function isValidModel(modelId: string): boolean {
  return (SUPPORTED_MODELS as readonly string[]).includes(modelId)
}

export function isValidProvider(provider: string): boolean {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(provider)
}

export function shortModelLabel(modelId: string): string {
  // Show suffix for readability e.g. "0.6B-CustomVoice-bf16"
  const parts = modelId.split('/')
  return parts[parts.length - 1] ?? modelId
}

export function modelDownloadLabel(modelId: string, downloaded?: boolean): string {
  const base = shortModelLabel(modelId)
  if (downloaded === true) return `${base}  ✓ downloaded`
  if (downloaded === false) return `${base}  ↓ needs download`
  return base
}

export function modelDownloadStatusIcon(downloaded?: boolean): string {
  if (downloaded === true) return '✓'
  if (downloaded === false) return '↓'
  return ''
}
