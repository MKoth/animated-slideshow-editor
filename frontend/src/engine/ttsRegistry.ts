export const SUPPORTED_MODELS: readonly string[] = [
  'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16',
  'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16',
  'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16',
  'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16',
  'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16',
  'sonic-3.6',
] as const

export const DEFAULT_MODEL_ID: string = SUPPORTED_MODELS[0]
export const DEFAULT_PROVIDER = 'auto' as const
export const SUPPORTED_PROVIDERS: readonly string[] = ['auto', 'sine', 'mlx', 'cartesia'] as const

/** Remote Cartesia model (no local weights) + user's saved "Mike" voice default. */
export const CARTESIA_MODEL_ID = 'sonic-3.6' as const
export const DEFAULT_CARTESIA_VOICE_ID = 'f6184e65-98f2-4e3d-84e5-a2eb198b8688' as const

export function isCartesiaProvider(provider: string | null | undefined): boolean {
  return (provider ?? '').trim().toLowerCase() === 'cartesia'
}

export function isCartesiaModel(modelId: string | null | undefined): boolean {
  return (modelId ?? '').trim() === CARTESIA_MODEL_ID
}

export type TtsProviderId = (typeof SUPPORTED_PROVIDERS)[number]

export interface ModelCapabilities {
  languages: string[]
  speakers: string[]
  instructionSupported: boolean
  speakerHints?: Record<string, string>
  speakerMeta?: Record<string, { description: string; nativeLanguage: string; iso: string }>
  downloaded?: boolean
  mode?: 'custom_voice' | 'voice_clone' | 'voice_design' | 'cartesia' | string
}

// Static fallback capabilities (mirrors backend registry)
// CustomVoice: 9 fixed speakers; Base: voice_clone (reference audio, no fixed speakers); VoiceDesign: voice_design (prompt)
const FALLBACK_CAPABILITIES: Record<string, ModelCapabilities> = {
  'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16': {
    languages: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'],
    speakers: [
      'Vivian',
      'Serena',
      'Uncle_Fu',
      'Dylan',
      'Eric',
      'Ryan',
      'Aiden',
      'Ono_Anna',
      'Sohee',
    ],
    instructionSupported: false,
    mode: 'custom_voice',
  },
  'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16': {
    languages: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'],
    speakers: [
      'Vivian',
      'Serena',
      'Uncle_Fu',
      'Dylan',
      'Eric',
      'Ryan',
      'Aiden',
      'Ono_Anna',
      'Sohee',
    ],
    instructionSupported: true,
    mode: 'custom_voice',
  },
  'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16': {
    languages: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'],
    speakers: [],
    instructionSupported: false,
    mode: 'voice_clone',
  },
  'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16': {
    languages: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'],
    speakers: [],
    instructionSupported: false,
    mode: 'voice_clone',
  },
  'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16': {
    languages: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'ru', 'pt', 'es', 'it'],
    speakers: [],
    instructionSupported: true,
    mode: 'voice_design',
  },
  'sonic-3.6': {
    languages: [
      'en',
      'fr',
      'de',
      'es',
      'pt',
      'zh',
      'ja',
      'hi',
      'ko',
      'it',
      'nl',
      'pl',
      'ru',
      'sv',
      'tr',
      'tl',
      'bg',
      'ro',
      'ar',
      'cs',
      'el',
      'fi',
      'hr',
      'ms',
      'sk',
      'da',
      'ta',
      'uk',
      'hu',
      'no',
      'vi',
      'bn',
      'th',
      'he',
      'ka',
      'id',
      'te',
      'gu',
      'kn',
      'ml',
      'mr',
      'pa',
      'or',
      'ur',
    ],
    speakers: [],
    instructionSupported: false,
    mode: 'cartesia',
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
