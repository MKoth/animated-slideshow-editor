/**
 * Shadow Effect — per-group effect (one per isGroupNode).
 * See ADR 0009 and Wayfinder map #286.
 */

export interface ShadowEffect {
  offsetX: number // px world, any finite
  offsetY: number // px world
  scaleX: number // multiplier, 0 degenerate allowed
  scaleY: number
  skewX: number // degrees, Pixi skew
  skewY: number // degrees
  rotation: number // degrees CCW
  blur: number // px radius 0..32 -> BlurFilter strength
  opacity: number // 0..1
  color: string // '#rrggbb' strict
}

export const DEFAULT_SHADOW_EFFECT: Readonly<ShadowEffect> = {
  offsetX: 12,
  offsetY: 18,
  scaleX: 1,
  scaleY: 1,
  skewX: 0,
  skewY: 0,
  rotation: 0,
  blur: 8,
  opacity: 0.35,
  color: '#000000',
}

export type ShadowEffectJSON = {
  readonly offsetX: number
  readonly offsetY: number
  readonly scaleX: number
  readonly scaleY: number
  readonly skewX: number
  readonly skewY: number
  readonly rotation: number
  readonly blur: number
  readonly opacity: number
  readonly color: string
}

export const SHADOW_PROPERTIES = [
  'offsetX',
  'offsetY',
  'scaleX',
  'scaleY',
  'skewX',
  'skewY',
  'rotation',
  'blur',
  'opacity',
  'color',
] as const
export type ShadowProperty = (typeof SHADOW_PROPERTIES)[number]

export const SHADOW_LABELS: Record<ShadowProperty, string> = {
  offsetX: 'Offset X',
  offsetY: 'Offset Y',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  skewX: 'Skew X',
  skewY: 'Skew Y',
  rotation: 'Rotation',
  blur: 'Blur',
  opacity: 'Opacity',
  color: 'Color',
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

export function cloneShadowEffect(effect: ShadowEffect): ShadowEffect {
  return { ...effect }
}

export function shadowEffectToJSON(effect: ShadowEffect): ShadowEffectJSON {
  return { ...effect }
}

export function clampShadowEffect(effect: ShadowEffect, nodeId?: string): ShadowEffect {
  const out = { ...effect }
  const prefix = nodeId ? `Node "${nodeId}" shadowEffect` : 'ShadowEffect'
  if (!Number.isFinite(out.blur) || out.blur < 0) {
    if (out.blur !== undefined && !Number.isFinite(out.blur)) {
      console.warn(`[shadow] ${prefix} bad blur ${String(out.blur)} → 0`)
    }
    out.blur = 0
  } else if (out.blur > 32) {
    out.blur = 32
  }
  if (!Number.isFinite(out.opacity)) {
    console.warn(`[shadow] ${prefix} bad opacity ${String(out.opacity)} → 0.35`)
    out.opacity = 0.35
  } else {
    out.opacity = Math.max(0, Math.min(1, out.opacity))
  }
  if (typeof out.color !== 'string' || !HEX_COLOR_RE.test(out.color)) {
    console.warn(`[shadow] ${prefix} bad color "${String(out.color)}" → #000000`)
    out.color = '#000000'
  } else {
    // normalize to lower? keep as is but ensure # prefix
    out.color = out.color.toLowerCase()
  }
  for (const k of [
    'offsetX',
    'offsetY',
    'scaleX',
    'scaleY',
    'skewX',
    'skewY',
    'rotation',
  ] as const) {
    const v = out[k] as unknown
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      console.warn(`[shadow] ${prefix} bad ${k} ${String(v)} → ${k.startsWith('scale') ? 1 : 0}`)
      out[k] = (k.startsWith('scale') ? 1 : 0) as never
    }
  }
  if (out.scaleX === 0 || out.scaleY === 0) {
    console.warn(`[shadow] ${prefix} degenerate scale 0 — renders collapsed`)
  }
  return out
}

export function shadowEffectFromJSON(value: unknown, nodeId: string): ShadowEffect | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    console.warn(`[shadow] Node "${nodeId}" shadowEffect must be an object — ignoring`)
    return undefined
  }
  const r = value as Record<string, unknown>
  // Helper to extract numeric
  const getNum = (key: keyof ShadowEffect): number | undefined => {
    const v = r[key]
    return typeof v === 'number' ? v : undefined
  }
  const getStr = (key: keyof ShadowEffect): string | undefined => {
    const v = r[key]
    return typeof v === 'string' ? v : undefined
  }

  const candidate: ShadowEffect = {
    offsetX: getNum('offsetX') ?? DEFAULT_SHADOW_EFFECT.offsetX,
    offsetY: getNum('offsetY') ?? DEFAULT_SHADOW_EFFECT.offsetY,
    scaleX: getNum('scaleX') ?? DEFAULT_SHADOW_EFFECT.scaleX,
    scaleY: getNum('scaleY') ?? DEFAULT_SHADOW_EFFECT.scaleY,
    skewX: getNum('skewX') ?? DEFAULT_SHADOW_EFFECT.skewX,
    skewY: getNum('skewY') ?? DEFAULT_SHADOW_EFFECT.skewY,
    rotation: getNum('rotation') ?? DEFAULT_SHADOW_EFFECT.rotation,
    blur: getNum('blur') ?? DEFAULT_SHADOW_EFFECT.blur,
    opacity: getNum('opacity') ?? DEFAULT_SHADOW_EFFECT.opacity,
    color: getStr('color') ?? DEFAULT_SHADOW_EFFECT.color,
  }

  // Detect missing fields to warn
  for (const k of SHADOW_PROPERTIES) {
    if (!(k in r)) {
      console.warn(
        `[shadow] Node "${nodeId}" shadowEffect missing "${k}" → ${String(candidate[k])}`,
      )
    }
  }
  // Detect extra type mismatches already handled via fallback, but warn if wrong type
  for (const k of SHADOW_PROPERTIES) {
    const rawVal = r[k]
    if (rawVal !== undefined) {
      if (k === 'color') {
        if (typeof rawVal !== 'string' || !HEX_COLOR_RE.test(rawVal as string)) {
          // will be warned in clamp
        }
      } else if (typeof rawVal !== 'number' || !Number.isFinite(rawVal as number)) {
        console.warn(
          `[shadow] Node "${nodeId}" shadowEffect bad ${k} ${String(rawVal)} → ${String(candidate[k])}`,
        )
      }
    }
  }

  return clampShadowEffect(candidate, nodeId)
}

export function hexStringToTint(hex: string): number {
  return parseInt(hex.slice(1), 16)
}

export function isShadowEffectEqual(a: ShadowEffect, b: ShadowEffect): boolean {
  return (
    a.offsetX === b.offsetX &&
    a.offsetY === b.offsetY &&
    a.scaleX === b.scaleX &&
    a.scaleY === b.scaleY &&
    a.skewX === b.skewX &&
    a.skewY === b.skewY &&
    a.rotation === b.rotation &&
    a.blur === b.blur &&
    a.opacity === b.opacity &&
    a.color === b.color
  )
}

export function getCastShadow(node: { components: unknown; castShadow?: boolean }): boolean {
  const c = node.components as Record<string, unknown>
  if (c.bone !== undefined || c.ghost !== undefined || c.camera !== undefined) {
    return false
  }
  return (node as { castShadow?: boolean }).castShadow ?? true
}

export function isCasterRenderable(node: { components: unknown }): boolean {
  const c = node.components as Record<string, unknown>
  return !!(
    c.assetInstance ||
    c.text ||
    c.mesh ||
    c.circle ||
    c.table ||
    c.chart ||
    c.tableRow ||
    c.tableCell
  )
}

export function collectShadowCasters(host: { children: readonly unknown[] }): unknown[] {
  const out: unknown[] = []
  const stack: unknown[] = [...(host.children as unknown[])].reverse()
  while (stack.length) {
    const cur = stack.pop() as {
      components: Record<string, unknown>
      castShadow?: boolean
      children: readonly unknown[]
    }
    if (!cur) continue
    if (!getCastShadow(cur as { components: Record<string, unknown>; castShadow?: boolean })) {
      continue
    }
    if (isCasterRenderable(cur as { components: Record<string, unknown> })) {
      out.push(cur)
    }
    for (let i = cur.children.length - 1; i >= 0; i--) {
      stack.push(cur.children[i])
    }
  }
  return out
}

// Typed convenience for SceneNode callers (avoids import cycle at runtime — type-only)
export type CastShadowNode = {
  components: Record<string, unknown>
  castShadow?: boolean
  children: readonly unknown[]
}
