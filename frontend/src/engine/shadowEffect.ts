/**
 * Shadow Effect — per-group effect (one per isGroupNode).
 * See ADR 0009 and Wayfinder map #286.
 * Spec 305: anchor + directional light auto-derive.
 */

export type ShadowAnchor = 'top' | 'bottom' | 'left' | 'right' | 'center'
export const SHADOW_ANCHORS = ['top', 'bottom', 'left', 'right', 'center'] as const

export function isShadowAnchor(value: unknown): value is ShadowAnchor {
  return typeof value === 'string' && (SHADOW_ANCHORS as readonly string[]).includes(value)
}

export function requireShadowAnchor(value: unknown): ShadowAnchor {
  if (!isShadowAnchor(value)) {
    throw new Error(`Unknown shadow anchor: ${String(value)}`)
  }
  return value as ShadowAnchor
}

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
  // Spec 305 additive — optional for back-compat. When auto=true, 7 DOF are derived from anchor+light.
  anchor?: ShadowAnchor // default 'bottom' when auto created
  lightAzimuth?: number // any finite → normalized 0–360, default 135
  lightElevation?: number // clamp 0..90, default 45
  lightDistance?: number // clamp 0..400, default 28
  anchorOffsetX?: number // fine contact adjustment in world px, default 0
  anchorOffsetY?: number // fine contact adjustment in world px, default 0
  mirrorX?: boolean // mirror silhouette across its local width, default false
  auto?: boolean // default true for newly-created derivation, undefined = false for legacy
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
  anchor: 'bottom',
  lightAzimuth: 135,
  lightElevation: 45,
  lightDistance: 28,
  anchorOffsetX: 0,
  anchorOffsetY: 0,
  mirrorX: false,
  auto: false,
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
  // additive optional
  readonly anchor?: ShadowAnchor
  readonly lightAzimuth?: number
  readonly lightElevation?: number
  readonly lightDistance?: number
  readonly anchorOffsetX?: number
  readonly anchorOffsetY?: number
  readonly mirrorX?: boolean
  readonly auto?: boolean
}

export const SHADOW_BASE_PROPERTIES = [
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
// Original 10 kept for legacy warnings (SHADOW_BASE_PROPERTIES)
// New combined includes light for keyframe handling (13)
export const SHADOW_LIGHT_PROPERTIES = ['lightAzimuth', 'lightElevation', 'lightDistance'] as const
export type ShadowLightProperty = (typeof SHADOW_LIGHT_PROPERTIES)[number]
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
  'lightAzimuth',
  'lightElevation',
  'lightDistance',
] as const
export type ShadowProperty = (typeof SHADOW_PROPERTIES)[number]
export const SHADOW_ALL_PROPERTIES = [
  ...SHADOW_BASE_PROPERTIES,
  ...SHADOW_LIGHT_PROPERTIES,
] as const
export type ShadowAnyProperty = ShadowProperty
export type ShadowAllProperty = (typeof SHADOW_ALL_PROPERTIES)[number]

// Raw 7 that are derived when auto
export const SHADOW_RAW_PROPERTIES = [
  'offsetX',
  'offsetY',
  'scaleX',
  'scaleY',
  'skewX',
  'skewY',
  'rotation',
] as const
export type ShadowRawProperty = (typeof SHADOW_RAW_PROPERTIES)[number]

export const SHADOW_SHARED_PROPERTIES = ['blur', 'opacity', 'color'] as const

export const SHADOW_LABELS: Record<ShadowProperty, string> & Record<ShadowLightProperty, string> = {
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
  lightAzimuth: 'Azimuth',
  lightElevation: 'Elevation',
  lightDistance: 'Distance',
} as Record<ShadowProperty, string> & Record<ShadowLightProperty, string>

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i
const HEX_COLOR_STRICT_RE = /^#[0-9a-fA-F]{6}$/

export function isShadowProperty(value: unknown): value is ShadowProperty {
  return typeof value === 'string' && (SHADOW_PROPERTIES as readonly string[]).includes(value)
}

export function isShadowLightProperty(value: unknown): value is ShadowLightProperty {
  return typeof value === 'string' && (SHADOW_LIGHT_PROPERTIES as readonly string[]).includes(value)
}

export function isShadowAnyProperty(value: unknown): value is ShadowAnyProperty {
  return isShadowProperty(value) || isShadowLightProperty(value)
}

export function isShadowAllProperty(value: unknown): value is ShadowAllProperty {
  return typeof value === 'string' && (SHADOW_ALL_PROPERTIES as readonly string[]).includes(value)
}

export function requireShadowProperty(value: unknown): ShadowProperty {
  // Accept light as well for keyframe targets (unified)
  if (typeof value === 'string' && (SHADOW_ALL_PROPERTIES as readonly string[]).includes(value)) {
    return value as ShadowProperty & ShadowLightProperty
  }
  if (typeof value !== 'string' || !(SHADOW_PROPERTIES as readonly string[]).includes(value)) {
    throw new Error(`Unknown shadow property: ${String(value)}`)
  }
  return value as ShadowProperty
}

export function requireShadowLightProperty(value: unknown): ShadowLightProperty {
  if (
    typeof value !== 'string' ||
    !(SHADOW_LIGHT_PROPERTIES as readonly string[]).includes(value)
  ) {
    throw new Error(`Unknown shadow light property: ${String(value)}`)
  }
  return value as ShadowLightProperty
}

export function requireShadowAnyProperty(value: unknown): ShadowAnyProperty {
  if (isShadowAnyProperty(value)) return value
  throw new Error(`Unknown shadow property: ${String(value)}`)
}

export function requireShadowAllProperty(value: unknown): ShadowAllProperty {
  if (isShadowAllProperty(value)) return value
  throw new Error(`Unknown shadow property: ${String(value)}`)
}

export function requireShadowKeyframeValue(
  property: ShadowProperty | ShadowLightProperty,
  value: unknown,
  what = 'Keyframe value',
): string | number {
  if (property === 'color') {
    if (typeof value !== 'string' || !HEX_COLOR_STRICT_RE.test(value)) {
      throw new Error(`${what} must be a hex color like #rrggbb`)
    }
    return value.toLowerCase()
  }
  if (property === 'opacity') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${what} must be a number between 0 and 1`)
    }
    return value
  }
  if (property === 'blur') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${what} must be a non-negative finite number`)
    }
    return value
  }
  if (property === 'lightAzimuth') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${what} must be a finite number`)
    }
    return normalizeAzimuth(value)
  }
  if (property === 'lightElevation') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${what} must be a finite number`)
    }
    if (value < 0 || value > 90) {
      throw new Error(`${what} must be a number between 0 and 90`)
    }
    return value
  }
  if (property === 'lightDistance') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 400) {
      throw new Error(`${what} must be a number between 0 and 400`)
    }
    return value
  }
  // offsetX/Y, scaleX/Y, skewX/Y, rotation: any finite
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${what} must be a finite number`)
  }
  return value
}

export function lerpHexColor(from: string, to: string, ratio: number): string {
  const fromRed = parseInt(from.slice(1, 3), 16)
  const fromGreen = parseInt(from.slice(3, 5), 16)
  const fromBlue = parseInt(from.slice(5, 7), 16)
  const toRed = parseInt(to.slice(1, 3), 16)
  const toGreen = parseInt(to.slice(3, 5), 16)
  const toBlue = parseInt(to.slice(5, 7), 16)
  const ch = (f: number, t: number) =>
    Math.round(f + (t - f) * ratio)
      .toString(16)
      .padStart(2, '0')
  return `#${ch(fromRed, toRed)}${ch(fromGreen, toGreen)}${ch(fromBlue, toBlue)}`.toLowerCase()
}

export function cloneShadowEffect(effect: ShadowEffect): ShadowEffect {
  return { ...effect }
}

export function shadowEffectToJSON(effect: ShadowEffect): ShadowEffectJSON {
  const json: ShadowEffectJSON = { ...effect } as ShadowEffectJSON
  // Ensure we return a plain copy
  return { ...json }
}

// ── Spec 305 helpers ───────────────────────────────────────────────────────
export function normalizeAzimuth(azimuth: number): number {
  if (!Number.isFinite(azimuth)) {
    console.warn(`[shadow] bad lightAzimuth ${String(azimuth)} → 135`)
    return 135
  }
  let n = azimuth % 360
  if (n < 0) n += 360
  // handle -0 case
  if (Object.is(n, -0)) n = 0
  return n
}

export function clampLightParams(
  params: Partial<
    Pick<ShadowEffect, 'anchor' | 'lightAzimuth' | 'lightElevation' | 'lightDistance' | 'auto'>
  >,
  nodeId?: string,
): Required<Pick<ShadowEffect, 'anchor' | 'lightAzimuth' | 'lightElevation' | 'lightDistance'>> &
  Pick<ShadowEffect, 'auto'> {
  const prefix = nodeId ? `Node "${nodeId}" shadowEffect` : 'ShadowEffect'
  let anchor: ShadowAnchor = 'bottom'
  if (params.anchor !== undefined) {
    if (isShadowAnchor(params.anchor)) {
      anchor = params.anchor
    } else {
      console.warn(`[shadow] ${prefix} bad anchor ${String(params.anchor)} → bottom`)
      anchor = 'bottom'
    }
  }
  let azimuth = params.lightAzimuth
  if (azimuth === undefined) azimuth = 135
  else if (!Number.isFinite(azimuth)) {
    console.warn(`[shadow] ${prefix} bad lightAzimuth ${String(azimuth)} → 135`)
    azimuth = 135
  } else {
    azimuth = normalizeAzimuth(azimuth)
  }
  let elevation = params.lightElevation
  if (elevation === undefined) elevation = 45
  else if (!Number.isFinite(elevation)) {
    console.warn(`[shadow] ${prefix} bad lightElevation ${String(elevation)} → 45`)
    elevation = 45
  } else {
    if (elevation < 0 || elevation > 90) {
      console.warn(`[shadow] ${prefix} lightElevation ${String(elevation)} clamped to 0..90`)
    }
    elevation = Math.max(0, Math.min(90, elevation))
  }
  let distance = params.lightDistance
  if (distance === undefined) distance = 28
  else if (!Number.isFinite(distance) || distance < 0) {
    if (distance !== undefined && (!Number.isFinite(distance) || (distance as number) < 0)) {
      console.warn(`[shadow] ${prefix} bad lightDistance ${String(distance)} → 28`)
    }
    // if NaN or negative, clamp to 0 then? spec says clamp 0..400, default 28
    // For NaN we fallback to 28, for negative clamp to 0 with warn
    if (!Number.isFinite(distance as number)) distance = 28
    else distance = Math.max(0, Math.min(400, distance as number))
  } else {
    distance = Math.max(0, Math.min(400, distance))
    if ((params.lightDistance as number) > 400) {
      // clamped above already with warn? distance >400 => clamp
      console.warn(
        `[shadow] ${prefix} lightDistance ${String(params.lightDistance)} clamped to 0..400`,
      )
    }
  }
  // Ensure final clamp for >400 case already
  if (distance !== undefined && distance > 400) distance = 400
  const out: Required<
    Pick<ShadowEffect, 'anchor' | 'lightAzimuth' | 'lightElevation' | 'lightDistance'>
  > &
    Pick<ShadowEffect, 'auto'> = {
    anchor,
    lightAzimuth: azimuth,
    lightElevation: elevation,
    lightDistance: distance,
  }
  if (params.auto !== undefined) out.auto = params.auto
  return out
}

export function isAutoShadowEffect(effect: ShadowEffect | undefined | null): boolean {
  return !!effect?.auto
}

// Pure, deterministic derivation
export function deriveShadowProjection(
  bounds: { w: number; h: number },
  anchor: ShadowAnchor,
  azimuth: number,
  elevation: number,
  distance: number,
  anchorOffset: { x?: number; y?: number } = {},
  mirrorX = false,
): {
  offsetX: number
  offsetY: number
  scaleX: number
  scaleY: number
  skewX: number
  skewY: number
  rotation: number
} {
  const az = normalizeAzimuth(azimuth)
  const elev = Math.max(0, Math.min(90, elevation))
  const dist = Math.max(0, Math.min(400, distance))
  const rad = (az * Math.PI) / 180
  const elevRad = (elev * Math.PI) / 180
  const cosElev = Math.cos(elevRad)
  const sinElev = Math.sin(elevRad)
  // Azimuth describes where the light comes from. The shadow projects away
  // from the light, so its planar displacement uses the opposite vector.
  const dx = -Math.cos(rad) * dist * cosElev
  const dy = -Math.sin(rad) * dist * cosElev
  const squash = 0.18 + (1.0 - 0.18) * sinElev // lerp(0.18,1,sin)
  let scaleX = 1
  let scaleY = 1
  let skewX = 0
  let skewY = 0
  let rotation = 0
  const w = bounds.w
  const h = bounds.h
  let offsetX = dx
  let offsetY = dy

  if (anchor === 'bottom') {
    scaleY = squash
    scaleX = 1 + (1 - squash) * 0.15
    rotation = (Math.atan2(dy, dx) - Math.PI / 2) * (180 / Math.PI)
  } else if (anchor === 'top') {
    scaleY = squash
    scaleX = 1 + (1 - squash) * 0.15
    rotation = (Math.atan2(dy, dx) + Math.PI / 2) * (180 / Math.PI)
  } else if (anchor === 'left') {
    scaleX = squash
    scaleY = 1 + (1 - squash) * 0.15
    rotation = Math.atan2(dy, dx) * (180 / Math.PI) - 180
  } else if (anchor === 'right') {
    scaleX = squash
    scaleY = 1 + (1 - squash) * 0.15
    rotation = Math.atan2(dy, dx) * (180 / Math.PI)
  } else {
    // center floating
    const uniform = 1.15 + (1 - 1.15) * sinElev // lerp(1.15,1,sin)
    scaleX = uniform
    scaleY = uniform
    skewX = 0
    skewY = 0
    offsetX = dx
    offsetY = dy
  }

  if (mirrorX) scaleX = -scaleX

  if (rotation > 180 || rotation <= -180) {
    rotation = ((((rotation + 180) % 360) + 360) % 360) - 180
  }

  if (anchor !== 'center') {
    const pivot =
      anchor === 'bottom'
        ? { x: w / 2, y: h }
        : anchor === 'top'
          ? { x: w / 2, y: 0 }
          : anchor === 'left'
            ? { x: 0, y: h / 2 }
            : { x: w, y: h / 2 }
    const angle = (rotation * Math.PI) / 180
    const transformedPivot = {
      x: Math.cos(angle) * scaleX * pivot.x - Math.sin(angle) * scaleY * pivot.y,
      y: Math.sin(angle) * scaleX * pivot.x + Math.cos(angle) * scaleY * pivot.y,
    }
    // Pixi's sprite origin is top-left. Translate so the chosen contact edge
    // remains attached while the silhouette rotates away from the light.
    offsetX = pivot.x + dx - transformedPivot.x
    offsetY = pivot.y + dy - transformedPivot.y
  }

  // Fine contact adjustment is deliberately applied after projection math so
  // it moves the pinned edge without changing the light direction.
  offsetX += Number.isFinite(anchorOffset.x) ? anchorOffset.x! : 0
  offsetY += Number.isFinite(anchorOffset.y) ? anchorOffset.y! : 0

  return { offsetX, offsetY, scaleX, scaleY, skewX, skewY, rotation }
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
  // ── Spec 305 additive clamp ──────────────────────────────────────────
  // anchor
  if (out.anchor !== undefined) {
    if (!isShadowAnchor(out.anchor)) {
      console.warn(`[shadow] ${prefix} bad anchor ${String(out.anchor)} → bottom`)
      out.anchor = 'bottom'
    }
  }
  // lightAzimuth: normalize if present
  if (out.lightAzimuth !== undefined) {
    if (!Number.isFinite(out.lightAzimuth)) {
      console.warn(`[shadow] ${prefix} bad lightAzimuth ${String(out.lightAzimuth)} → 135`)
      out.lightAzimuth = 135
    } else {
      const normalized = normalizeAzimuth(out.lightAzimuth)
      if (normalized !== out.lightAzimuth) {
        // normalize silently? but keep normalized
      }
      out.lightAzimuth = normalized
    }
  }
  // lightElevation: clamp 0..90
  if (out.lightElevation !== undefined) {
    if (!Number.isFinite(out.lightElevation)) {
      console.warn(`[shadow] ${prefix} bad lightElevation ${String(out.lightElevation)} → 45`)
      out.lightElevation = 45
    } else {
      if (out.lightElevation < 0 || out.lightElevation > 90) {
        console.warn(
          `[shadow] ${prefix} lightElevation ${String(out.lightElevation)} clamped to 0..90`,
        )
      }
      out.lightElevation = Math.max(0, Math.min(90, out.lightElevation))
    }
  }
  // lightDistance: clamp 0..400
  if (out.lightDistance !== undefined) {
    if (!Number.isFinite(out.lightDistance)) {
      console.warn(`[shadow] ${prefix} bad lightDistance ${String(out.lightDistance)} → 28`)
      out.lightDistance = 28
    } else {
      if (out.lightDistance < 0 || out.lightDistance > 400) {
        console.warn(
          `[shadow] ${prefix} lightDistance ${String(out.lightDistance)} clamped to 0..400`,
        )
      }
      out.lightDistance = Math.max(0, Math.min(400, out.lightDistance))
    }
  }
  // auto: ensure boolean if present
  if (out.auto !== undefined && typeof out.auto !== 'boolean') {
    console.warn(`[shadow] ${prefix} bad auto ${String(out.auto)} → false`)
    out.auto = false
  }
  for (const key of ['anchorOffsetX', 'anchorOffsetY'] as const) {
    if (out[key] !== undefined && !Number.isFinite(out[key])) {
      console.warn(`[shadow] ${prefix} bad ${key} ${String(out[key])} → 0`)
      out[key] = 0
    }
  }
  if (out.mirrorX !== undefined && typeof out.mirrorX !== 'boolean') {
    console.warn(`[shadow] ${prefix} bad mirrorX ${String(out.mirrorX)} → false`)
    out.mirrorX = false
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

  // Additive optional: only carry if present in JSON (tolerant)
  const anchorRaw = r.anchor
  if (anchorRaw !== undefined) {
    if (typeof anchorRaw === 'string' && isShadowAnchor(anchorRaw)) {
      candidate.anchor = anchorRaw
    } else {
      console.warn(
        `[shadow] Node "${nodeId}" shadowEffect bad anchor ${String(anchorRaw)} → bottom`,
      )
      candidate.anchor = 'bottom'
    }
  }
  const azRaw = r.lightAzimuth
  if (azRaw !== undefined) {
    if (typeof azRaw === 'number' && Number.isFinite(azRaw)) {
      candidate.lightAzimuth = normalizeAzimuth(azRaw)
    } else {
      console.warn(`[shadow] Node "${nodeId}" shadowEffect bad lightAzimuth ${String(azRaw)} → 135`)
      candidate.lightAzimuth = 135
    }
  }
  const elRaw = r.lightElevation
  if (elRaw !== undefined) {
    if (typeof elRaw === 'number' && Number.isFinite(elRaw)) {
      if (elRaw < 0 || elRaw > 90) {
        console.warn(
          `[shadow] Node "${nodeId}" shadowEffect bad lightElevation ${String(elRaw)} clamped to 0..90`,
        )
      }
      candidate.lightElevation = Math.max(0, Math.min(90, elRaw))
    } else {
      console.warn(
        `[shadow] Node "${nodeId}" shadowEffect bad lightElevation ${String(elRaw)} → 45`,
      )
      candidate.lightElevation = 45
    }
  }
  const distRaw = r.lightDistance
  if (distRaw !== undefined) {
    if (typeof distRaw === 'number' && Number.isFinite(distRaw)) {
      if (distRaw < 0 || distRaw > 400) {
        console.warn(
          `[shadow] Node "${nodeId}" shadowEffect bad lightDistance ${String(distRaw)} clamped to 0..400`,
        )
      }
      candidate.lightDistance = Math.max(0, Math.min(400, distRaw))
    } else {
      console.warn(
        `[shadow] Node "${nodeId}" shadowEffect bad lightDistance ${String(distRaw)} → 28`,
      )
      candidate.lightDistance = 28
    }
  }
  const autoRaw = r.auto
  if (autoRaw !== undefined) {
    if (typeof autoRaw === 'boolean') {
      candidate.auto = autoRaw
    } else {
      console.warn(`[shadow] Node "${nodeId}" shadowEffect bad auto ${String(autoRaw)} → false`)
      candidate.auto = false
    }
  }
  for (const key of ['anchorOffsetX', 'anchorOffsetY'] as const) {
    const raw = r[key]
    if (raw !== undefined) candidate[key] = typeof raw === 'number' ? raw : 0
  }
  if (typeof r.mirrorX === 'boolean') candidate.mirrorX = r.mirrorX

  // Detect missing fields to warn for required 10 (base, not light)
  for (const k of SHADOW_BASE_PROPERTIES) {
    if (!(k in r)) {
      console.warn(
        `[shadow] Node "${nodeId}" shadowEffect missing "${k}" → ${String(candidate[k as keyof ShadowEffect])}`,
      )
    }
  }
  // Detect extra type mismatches already handled via fallback, but warn if wrong type for required 10
  for (const k of SHADOW_BASE_PROPERTIES) {
    const rawVal = r[k]
    if (rawVal !== undefined) {
      if (k === 'color') {
        if (typeof rawVal !== 'string' || !HEX_COLOR_RE.test(rawVal as string)) {
          // will be warned in clamp
        }
      } else if (typeof rawVal !== 'number' || !Number.isFinite(rawVal as number)) {
        console.warn(
          `[shadow] Node "${nodeId}" shadowEffect bad ${k} ${String(rawVal)} → ${String(candidate[k as keyof ShadowEffect])}`,
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
    a.color === b.color &&
    a.anchor === b.anchor &&
    a.lightAzimuth === b.lightAzimuth &&
    a.lightElevation === b.lightElevation &&
    a.lightDistance === b.lightDistance &&
    a.anchorOffsetX === b.anchorOffsetX &&
    a.anchorOffsetY === b.anchorOffsetY &&
    a.mirrorX === b.mirrorX &&
    a.auto === b.auto
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
