// Cartesia delivery guidance (emotion / speed / volume) for sonic-3+.
// Keep aligned with backend app/tts/registry.py: CARTESIA_EMOTIONS,
// CARTESIA_SPEED_MIN/MAX, CARTESIA_VOLUME_MIN/MAX.
// All fields are optional — Auto/omit means Cartesia infers from transcript.

export const CARTESIA_EMOTIONS: readonly string[] = [
  'neutral',
  'happy',
  'excited',
  'enthusiastic',
  'elated',
  'euphoric',
  'triumphant',
  'amazed',
  'surprised',
  'flirtatious',
  'curious',
  'content',
  'peaceful',
  'serene',
  'calm',
  'grateful',
  'affectionate',
  'trust',
  'sympathetic',
  'anticipation',
  'mysterious',
  'angry',
  'mad',
  'outraged',
  'frustrated',
  'agitated',
  'threatened',
  'disgusted',
  'contempt',
  'envious',
  'sarcastic',
  'ironic',
  'sad',
  'dejected',
  'melancholic',
  'disappointed',
  'hurt',
  'guilty',
  'bored',
  'tired',
  'rejected',
  'nostalgic',
  'wistful',
  'apologetic',
  'hesitant',
  'insecure',
  'confused',
  'resigned',
  'anxious',
  'panicked',
  'alarmed',
  'scared',
  'proud',
  'confident',
  'distant',
  'skeptical',
  'contemplative',
  'determined',
] as const

export const CARTESIA_PRIMARY_EMOTIONS: readonly string[] = [
  'neutral',
  'calm',
  'angry',
  'content',
  'sad',
  'scared',
] as const

export const CARTESIA_SPEED = { min: 0.6, max: 1.5, step: 0.05 } as const
export const CARTESIA_VOLUME = { min: 0.5, max: 2.0, step: 0.05 } as const

export interface CartesiaDelivery {
  /** "" = Auto (omit, let Cartesia infer). Otherwise a CARTESIA_EMOTIONS value. */
  emotion: string
  /** null = Auto (omit). Otherwise clamped to CARTESIA_SPEED range. */
  speed: number | null
  /** null = Auto (omit). Otherwise clamped to CARTESIA_VOLUME range. */
  volume: number | null
}

export function getDefaultCartesiaDelivery(): CartesiaDelivery {
  return { emotion: '', speed: null, volume: null }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

export function normalizeCartesiaEmotion(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const t = raw.trim()
  if (!t || t.toLowerCase() === 'auto') return ''
  const lowered = t.toLowerCase()
  return (CARTESIA_EMOTIONS as readonly string[]).includes(lowered) ? lowered : ''
}

export function normalizeCartesiaSpeed(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t || t.toLowerCase() === 'auto') return null
    const n = Number(t)
    if (!Number.isFinite(n)) return null
    return clamp(n, CARTESIA_SPEED.min, CARTESIA_SPEED.max)
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return clamp(raw, CARTESIA_SPEED.min, CARTESIA_SPEED.max)
  }
  return null
}

export function normalizeCartesiaVolume(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t || t.toLowerCase() === 'auto') return null
    const n = Number(t)
    if (!Number.isFinite(n)) return null
    return clamp(n, CARTESIA_VOLUME.min, CARTESIA_VOLUME.max)
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return clamp(raw, CARTESIA_VOLUME.min, CARTESIA_VOLUME.max)
  }
  return null
}

export function extractCartesiaDelivery(
  params: Record<string, unknown> | null | undefined,
): CartesiaDelivery {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return getDefaultCartesiaDelivery()
  }
  return {
    emotion: normalizeCartesiaEmotion((params as Record<string, unknown>).emotion),
    speed: normalizeCartesiaSpeed((params as Record<string, unknown>).speed),
    volume: normalizeCartesiaVolume((params as Record<string, unknown>).volume),
  }
}

/** Merge delivery into params: Auto values are omitted (deleted). */
export function mergeCartesiaDelivery(
  existing: Record<string, unknown> | null | undefined,
  delivery: CartesiaDelivery,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    existing && typeof existing === 'object' && !Array.isArray(existing) ? { ...existing } : {}
  if (delivery.emotion) base.emotion = delivery.emotion
  else delete base.emotion
  if (delivery.speed !== null) base.speed = delivery.speed
  else delete base.speed
  if (delivery.volume !== null) base.volume = delivery.volume
  else delete base.volume
  return base
}

/** Strip delivery keys (when saving a non-Cartesia prompt). */
export function stripCartesiaDelivery(
  existing: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return undefined
  const { emotion: _e, speed: _s, volume: _v, ...rest } = existing as Record<string, unknown>
  void _e
  void _s
  void _v
  return Object.keys(rest).length ? rest : undefined
}

export function isDefaultCartesiaDelivery(d: CartesiaDelivery): boolean {
  return d.emotion === '' && d.speed === null && d.volume === null
}
