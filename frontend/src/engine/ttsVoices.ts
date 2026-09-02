// Canonical voice metadata per spec #253 — keep aligned with backend app/tts/registry.py
export interface VoiceMeta {
  description: string
  nativeLanguage: string
  iso: string
}

export const SPEAKER_META: Record<string, VoiceMeta> = {
  Vivian: { description: 'Bright edgy young female', nativeLanguage: 'Chinese', iso: 'zh' },
  Serena: { description: 'Warm gentle young female', nativeLanguage: 'Chinese', iso: 'zh' },
  Uncle_Fu: { description: 'Seasoned low mellow', nativeLanguage: 'Chinese', iso: 'zh' },
  Dylan: { description: 'Beijing', nativeLanguage: 'Chinese', iso: 'zh' },
  Eric: { description: 'Chengdu', nativeLanguage: 'Chinese', iso: 'zh' },
  Ryan: { description: 'Dynamic', nativeLanguage: 'English', iso: 'en' },
  Aiden: { description: 'Sunny American', nativeLanguage: 'English', iso: 'en' },
  Ono_Anna: { description: 'Playful', nativeLanguage: 'Japanese', iso: 'ja' },
  Sohee: { description: 'Warm rich', nativeLanguage: 'Korean', iso: 'ko' },
}

export const SPEAKER_HINTS: Record<string, string> = Object.fromEntries(
  Object.entries(SPEAKER_META).map(([k, v]) => [k, `${v.description}, ${v.nativeLanguage}`]),
)

export const LEGACY_VOICE_TO_CANONICAL: Record<string, string> = {
  nova: 'Ryan',
}

export const CANONICAL_CUSTOMVOICE_SPEAKERS: readonly string[] = [
  'Vivian',
  'Serena',
  'Uncle_Fu',
  'Dylan',
  'Eric',
  'Ryan',
  'Aiden',
  'Ono_Anna',
  'Sohee',
] as const

export function speakerHint(speaker: string): string {
  return SPEAKER_HINTS[speaker] ?? speaker
}

export function voiceLabel(speaker: string, includeHint = true): string {
  if (!includeHint) return speaker
  const hint = SPEAKER_HINTS[speaker]
  return hint ? `${speaker} — ${hint}` : speaker
}

export function dropdownLabelForVoice(speaker: string): string {
  // Matches spec hint style: Vivian (Bright edgy young female, Chinese)
  const meta = SPEAKER_META[speaker]
  if (!meta) return speaker
  return `${speaker} (${meta.description}, ${meta.nativeLanguage})`
}

// Per-model fallback mirrors backend/app/tts/registry.py
// CustomVoice: 9 canonical; Base/VoiceDesign: no fixed speakers (voice_clone / voice_design)
export function getFallbackSpeakersForModel(modelId: string): string[] {
  const FALLBACK: Record<string, string[]> = {
    'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16': [...CANONICAL_CUSTOMVOICE_SPEAKERS],
    'mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-bf16': [...CANONICAL_CUSTOMVOICE_SPEAKERS],
    'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16': [],
    'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16': [],
    'mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16': [],
  }
  return FALLBACK[modelId] ?? [...CANONICAL_CUSTOMVOICE_SPEAKERS]
}

export function getModelMode(modelId: string): 'custom_voice' | 'voice_clone' | 'voice_design' {
  if (modelId.includes('-Base-')) return 'voice_clone'
  if (modelId.includes('-VoiceDesign-')) return 'voice_design'
  return 'custom_voice'
}

export function isCustomVoiceModel(modelId: string): boolean {
  return getModelMode(modelId) === 'custom_voice'
}

export function isVoiceCloneModel(modelId: string): boolean {
  return getModelMode(modelId) === 'voice_clone'
}

export function defaultSpeakerForModel(modelId: string, language?: string | null): string {
  const lang = (language ?? '').toLowerCase()
  const isZh = lang.startsWith('zh') || lang === 'chinese'
  const preferred = isZh ? 'Vivian' : 'Ryan'
  const speakers = getFallbackSpeakersForModel(modelId)
  const lowerSet = new Set(speakers.map((s) => s.toLowerCase()))
  if (lowerSet.has(preferred.toLowerCase())) return preferred
  return speakers[0] ?? preferred
}

export function normalizeVoice(
  raw: string | null | undefined,
  modelId?: string | null,
): string | null {
  if (raw == null) return null
  const stripped = raw.trim()
  if (stripped === '') return null
  const key = stripped.toLowerCase()
  if (key in LEGACY_VOICE_TO_CANONICAL) return LEGACY_VOICE_TO_CANONICAL[key]!
  const candidates = modelId ? getFallbackSpeakersForModel(modelId) : Object.keys(SPEAKER_META)
  const lowerMap = Object.fromEntries(candidates.map((c) => [c.toLowerCase(), c]))
  if (key in lowerMap) return lowerMap[key]!
  const globalMap = Object.fromEntries(Object.keys(SPEAKER_META).map((k) => [k.toLowerCase(), k]))
  if (key in globalMap) return globalMap[key]!
  return null
}

export function isValidVoiceForModel(
  voice: string | null | undefined,
  modelId: string,
  backendSpeakers?: string[] | null,
): boolean {
  if (!voice || voice.trim() === '') return false
  const key = voice.trim().toLowerCase()
  // legacy alias is valid (will migrate)
  if (key in LEGACY_VOICE_TO_CANONICAL) {
    const target = LEGACY_VOICE_TO_CANONICAL[key]!.toLowerCase()
    const speakers = backendSpeakers ?? getFallbackSpeakersForModel(modelId)
    return speakers.some((s) => s.toLowerCase() === target)
  }
  const speakers = backendSpeakers ?? getFallbackSpeakersForModel(modelId)
  return speakers.some((s) => s.toLowerCase() === key)
}

export function migrateStoredVoice(
  raw: string | null | undefined,
  modelId?: string | null,
  language?: string | null,
  backendSpeakers?: string[] | null,
): { value: string; isUnknown: boolean; warning: string | null; normalized: string | null } {
  if (raw == null || raw.trim() === '') {
    return { value: '', isUnknown: false, warning: null, normalized: null }
  }
  const stripped = raw.trim()
  const key = stripped.toLowerCase()
  const mid = modelId ?? 'mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-bf16'
  // legacy nova -> Ryan (not unknown)
  if (key in LEGACY_VOICE_TO_CANONICAL) {
    return {
      value: LEGACY_VOICE_TO_CANONICAL[key]!,
      isUnknown: false,
      warning: null,
      normalized: LEGACY_VOICE_TO_CANONICAL[key]!,
    }
  }
  const speakers = backendSpeakers ?? getFallbackSpeakersForModel(mid)
  const lowerMap: Record<string, string> = Object.fromEntries(speakers.map((s) => [s.toLowerCase(), s]))
  if (key in lowerMap) {
    return { value: lowerMap[key]!, isUnknown: false, warning: null, normalized: lowerMap[key]! }
  }
  // Known globally but not in this model -> unknown for this model
  const globalKnown = Object.keys(SPEAKER_META).some((k) => k.toLowerCase() === key)
  if (globalKnown) {
    const def = defaultSpeakerForModel(mid, language)
    const shortModel = mid.split('/').pop() ?? mid
    return {
      value: '',
      isUnknown: true,
      warning: `Voice '${stripped}' not supported by ${shortModel} — using default (${def})`,
      normalized: null,
    }
  }
  // Completely unknown
  const def = defaultSpeakerForModel(mid, language)
  const shortModel = mid.split('/').pop() ?? mid
  void shortModel
  return {
    value: '',
    isUnknown: true,
    warning: `Unknown voice '${stripped}' — using default (${def})`,
    normalized: null,
  }
}

export function migrateStoredVoiceForDisplay(
  raw: string | null | undefined,
  modelId: string | null | undefined,
  backendSpeakers?: string[] | null,
): { value: string; isUnknown: boolean; warning: string | null } {
  const res = migrateStoredVoice(raw, modelId ?? undefined, null, backendSpeakers ?? undefined)
  return { value: res.value, isUnknown: res.isUnknown, warning: res.warning }
}

// Language-aware filtering removed per ChatGPT review: speakers and languages are independent.
// Any speaker can speak any of the 10 languages; nativeLanguage is a quality hint, not a restriction.
// Kept for backward compat but returns all speakers unfiltered.
export function filterSpeakersByLanguage(
  speakers: string[],
  _languageIso: string | null | undefined,
): { filtered: string[]; isExact: boolean } {
  return { filtered: speakers, isExact: true }
}

export function getSpeakersForModelAndLanguage(
  modelId: string,
  _languageIso: string | null | undefined,
  backendSpeakers?: string[] | null,
): { speakers: string[]; isExact: boolean; baseCount: number } {
  const base = backendSpeakers ?? getFallbackSpeakersForModel(modelId)
  return { speakers: base, isExact: true, baseCount: base.length }
}
