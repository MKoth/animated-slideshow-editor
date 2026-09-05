/**
 * PROTOTYPE — throwaway branch research/shadow-silhouette — do not merge
 * Shadow Effect types for silhouette prototype.
 * Mirrors grilling decisions #290 #291 #292: ShadowEffect 10 params, Cast Shadow per-node.
 * See ADR 0009 vocabulary: Shadow Effect / Shadow Source / Silhouette / Shadow Projection / Cast Shadow
 */

// ── ShadowEffect — per-group effect (one per isGroupNode) ──────────────
// Ownership: SceneNode.shadowEffect? (not NodeComponents) per #290
export interface ShadowEffect {
  offsetX: number // px world, any finite
  offsetY: number // px world
  scaleX: number // multiplier
  scaleY: number
  skewX: number // degrees, Pixi skew
  skewY: number // degrees
  rotation: number // degrees CCW
  blur: number // px radius → BlurFilter strength, clamped 0..32
  opacity: number // 0..1
  color: string // '#rrggbb' strict
}

export const DEFAULT_SHADOW_EFFECT: ShadowEffect = {
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

export const SHADOW_EFFECT_DEFAULTS_TABLE: Record<keyof ShadowEffect, unknown> = {
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

// Preset: ground-squash (writes 6 fields atomically, per #292 #294)
export const GROUND_PRESET: Partial<ShadowEffect> = {
  scaleX: 1.1,
  scaleY: 0.2,
  skewX: -12,
  blur: 11,
  opacity: 0.25,
  offsetY: 8,
}

export function applyGroundPreset(effect: ShadowEffect): ShadowEffect {
  return { ...effect, ...GROUND_PRESET }
}

// ── Cast Shadow flag ─────────────────────────────────────────────────────
// SceneNode.castShadow?: boolean — default true for renderables, false for Bone/Ghost/Camera
export function getCastShadow(node: {
  components: Record<string, unknown>
  castShadow?: boolean
}): boolean {
  const c = node.components as Record<string, unknown>
  if (c.bone || c.ghost || c.camera) return false
  return node.castShadow ?? true
}

export function isCasterRenderable(node: { components: Record<string, unknown> }): boolean {
  const c = node.components as Record<string, unknown>
  return !!(c.assetInstance || c.text || c.mesh || c.circle || c.table || c.tableRow || c.tableCell || c.chart)
  // groups (no components) → false; Ghost/Bone/Camera already false via getCastShadow
}

// ── Collector — pure pruning walk, per #291 ──────────────────────────────
export interface ProtoSceneNode {
  id: string
  name: string
  components: Record<string, unknown>
  castShadow?: boolean
  children: ProtoSceneNode[]
  // minimal renderable marker for demo — not full SceneNode
  isGroup?: boolean
}

export function collectShadowCasters(host: ProtoSceneNode): ProtoSceneNode[] {
  // Children-only source in v1 — host excluded
  const out: ProtoSceneNode[] = []
  const stack: ProtoSceneNode[] = [...host.children].reverse()
  while (stack.length) {
    const cur = stack.pop()!
    if (!getCastShadow(cur as unknown as { components: Record<string, unknown>; castShadow?: boolean })) continue // prune subtree
    if (isCasterRenderable(cur as unknown as { components: Record<string, unknown> })) out.push(cur)
    for (let i = cur.children.length - 1; i >= 0; i--) stack.push(cur.children[i])
  }
  return out
}

// ── Validation (clamp + warn, additive tolerance per #292) ───────────────
export function clampShadowEffect(effect: ShadowEffect): ShadowEffect {
  const out = { ...effect }
  if (!Number.isFinite(out.blur) || out.blur < 0) out.blur = 0
  else if (out.blur > 32) out.blur = 32
  if (!Number.isFinite(out.opacity)) out.opacity = 0.35
  else out.opacity = Math.max(0, Math.min(1, out.opacity))
  if (!/^#[0-9a-f]{6}$/i.test(out.color)) {
    console.warn(`[shadow] bad color "${out.color}" → #000000`)
    out.color = '#000000'
  }
  for (const k of ['offsetX', 'offsetY', 'scaleX', 'scaleY', 'skewX', 'skewY', 'rotation'] as const) {
    if (!Number.isFinite(out[k])) {
      console.warn(`[shadow] bad ${k} ${out[k]} → 0`)
      // offset/skew/rotation → 0; scale → 1
      out[k] = k.startsWith('scale') ? 1 : 0
    }
  }
  if (out.scaleX === 0 || out.scaleY === 0) console.warn('[shadow] degenerate scale 0 — renders collapsed')
  return out
}

export function hexStringToTint(hex: string): number {
  return parseInt(hex.slice(1), 16)
}

// ── Shadow property keys for bespoke tracks (10 lanes per #292 #294) ──────
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
