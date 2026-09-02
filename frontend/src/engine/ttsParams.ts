// TTS generation params presets + slider ranges per Issue #254
// Keep aligned with backend app/tts/engine.py allowlist: temperature, top_k, top_p, repetition_penalty, max_tokens

export const TTS_PARAM_RANGES = {
  temperature: { min: 0.5, max: 1.2, step: 0.05, default: 0.9 },
  top_k: { min: 10, max: 100, step: 1, default: 50 },
  top_p: { min: 0.5, max: 1.0, step: 0.05, default: 1.0 },
  repetition_penalty: { min: 1.0, max: 1.2, step: 0.01, default: 1.05 },
  max_tokens: { min: 1024, max: 4096, step: 128, default: 2048 },
} as const

export type TtsParamKey = keyof typeof TTS_PARAM_RANGES

export const TTS_PRESET_NAMES = ['Creative', 'Balanced', 'Precise'] as const
export type TtsPresetName = typeof TTS_PRESET_NAMES[number]

export const TTS_PRESETS: Record<TtsPresetName, Record<TtsParamKey, number>> = {
  Creative: {
    temperature: 1.1,
    top_k: 80,
    top_p: 1.0,
    repetition_penalty: 1.0,
    max_tokens: 3000,
  },
  Balanced: {
    temperature: 0.9,
    top_k: 50,
    top_p: 1.0,
    repetition_penalty: 1.05,
    max_tokens: 2048,
  },
  Precise: {
    temperature: 0.7,
    top_k: 20,
    top_p: 0.85,
    repetition_penalty: 1.1,
    max_tokens: 2048,
  },
}

export function getDefaultTtsParams(): Record<TtsParamKey, number> {
  return {
    temperature: TTS_PARAM_RANGES.temperature.default,
    top_k: TTS_PARAM_RANGES.top_k.default,
    top_p: TTS_PARAM_RANGES.top_p.default,
    repetition_penalty: TTS_PARAM_RANGES.repetition_penalty.default,
    max_tokens: TTS_PARAM_RANGES.max_tokens.default,
  }
}

export function clampParam(key: TtsParamKey, value: number): number {
  const r = TTS_PARAM_RANGES[key]
  const clamped = Math.min(r.max, Math.max(r.min, value))
  // For integer keys, round
  if (key === 'top_k' || key === 'max_tokens') return Math.round(clamped)
  return clamped
}

export function paramsMatchPreset(params: Record<string, unknown> | null | undefined): TtsPresetName | null {
  if (!params || typeof params !== 'object') return null
  for (const name of TTS_PRESET_NAMES) {
    const preset = TTS_PRESETS[name]
    let match = true
    for (const k of Object.keys(preset) as TtsParamKey[]) {
      const pv = (params as Record<string, unknown>)[k]
      const presetVal = preset[k]
      // Compare with tolerance for floats
      if (typeof pv !== 'number' || Math.abs(pv - presetVal) > 1e-6) {
        match = false
        break
      }
    }
    if (match) return name
  }
  return null
}

export function extractTtsParams(params: Record<string, unknown> | null | undefined): Record<TtsParamKey, number> {
  const defaults = getDefaultTtsParams()
  if (!params || typeof params !== 'object') return { ...defaults }
  const out: Record<TtsParamKey, number> = { ...defaults }
  for (const k of Object.keys(defaults) as TtsParamKey[]) {
    const v = (params as Record<string, unknown>)[k]
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = clampParam(k, v)
    }
  }
  return out
}

export function mergeTtsParams(
  existing: Record<string, unknown> | null | undefined,
  ttsUpdates: Partial<Record<TtsParamKey, number>>,
): Record<string, unknown> {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {}
  for (const k of Object.keys(ttsUpdates) as TtsParamKey[]) {
    const v = ttsUpdates[k]
    if (v === undefined) continue
    base[k] = clampParam(k, v as number)
  }
  return base
}

export function buildParamsWithPreset(
  existing: Record<string, unknown> | null | undefined,
  preset: TtsPresetName,
): Record<string, unknown> {
  return mergeTtsParams(existing, TTS_PRESETS[preset])
}

export function isDefaultParams(params: Record<string, unknown> | null | undefined): boolean {
  const defaults = getDefaultTtsParams()
  if (!params) return true
  for (const k of Object.keys(defaults) as TtsParamKey[]) {
    const v = (params as Record<string, unknown>)[k]
    if (typeof v === 'number' && Math.abs(v - defaults[k]) > 1e-6) return false
    if (v !== undefined && typeof v !== 'number') return false
  }
  // non-TTS keys don't affect default check; only TTS keys matter
  return true
}
