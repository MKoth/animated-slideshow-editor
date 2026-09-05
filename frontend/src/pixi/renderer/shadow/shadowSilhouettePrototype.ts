/**
 * PROTOTYPE — throwaway branch research/shadow-silhouette — do not merge
 * Core silhouette loop proof for Wayfinder #296.
 *
 * Proves: BBox-sized RenderTexture from Cast-Shadow-gated subtree (solid-white alpha mask)
 * → Sprite transform+filters (offset/scale/skew/rotation/blur/opacity/color)
 * → sibling-under compositing beneath group
 * → dirty optimization (skip RT when nothing changed)
 * → live updates on move/rotate/scale/deform/opacity.
 *
 * Rendering decisions per grilling #293:
 * - RT per-group, no Po2, 4×4 → 2048 cap, padded ceil(blur*2+4)
 * - Silhouette clone+white-alpha filter vec4(a) preserving soft edges, placeholder casts
 * - Transform position→rotation→scale→skew via Sprite props pivot 0,0
 * - BlurFilter only quality 2 kernel 5 (no Kawase)
 * - Tint+alpha normal blend, sibling-under compositing with tableCell owningTable
 * - Two-tier dirty (frame-hash + shadowDirty Set) post-morph-bones
 *
 * Flag-gated: only active when VITE_SHADOW_PROTOTYPE === 'true' or window.__SHADOW_PROTOTYPE__
 * This file is throwaway — see research/shadow-silhouette-findings.md for what-broke + perf.
 */

import { collectShadowCasters, clampShadowEffect, hexStringToTint } from './shadowEffectPrototype'
import type { ShadowEffect, ProtoSceneNode } from './shadowEffectPrototype'

// ── Feature flag ─────────────────────────────────────────────────────────
export const SHADOW_PROTOTYPE_ENABLED =
  typeof import.meta !== 'undefined' &&
  // @ts-expect-error vite env
  (import.meta.env?.VITE_SHADOW_PROTOTYPE === 'true' ||
    // allow runtime toggle for demo
    (typeof window !== 'undefined' && (window as unknown as { __SHADOW_PROTOTYPE__?: boolean }).__SHADOW_PROTOTYPE__ === true))

// ── Types ────────────────────────────────────────────────────────────────
export type WorldRect = { x: number; y: number; width: number; height: number }
export type WorldAabb = { minX: number; minY: number; maxX: number; maxY: number }

// Minimal Pixi-ish interfaces so prototype compiles without Pixi dependency in tests
export interface PixiLikeRenderer {
  render(options: { container: unknown; target: unknown; clear?: boolean; clearColor?: number }): void
}
export interface PixiLikeRenderTexture {
  width: number
  height: number
  resize(w: number, h: number): void
  destroy(): void
}
export interface PixiLikeSprite {
  texture: unknown
  x: number
  y: number
  rotation: number // rad
  scale: { x: number; y: number; set(x: number, y: number): void }
  skew: { x: number; y: number; set(x: number, y: number): void }
  alpha: number
  tint: number
  visible: boolean
  filters: unknown[] | null
}
export interface PixiLikeContainer {
  label?: string
  visible: boolean
  children: unknown[]
  addChild(child: unknown): void
  addChildAt(child: unknown, index: number): void
  removeChild(child: unknown): void
  destroy(opts?: { children?: boolean }): void
}

// ── BBox sizing ───────────────────────────────────────────────────────────
// Union via worldAabbOf + merge + expand + pad per #288 #293
export function worldAabbOf(node: ProtoSceneNode, evaluated: Map<string, { x: number; y: number; rotation: number; scaleX: number; scaleY: number }>, sizes: Map<string, { width: number; height: number; offsetX?: number; offsetY?: number }>): WorldAabb | null {
  const size = sizes.get(node.id)
  const tr = evaluated.get(node.id)
  if (!size || !tr) return null
  // Simplified hitTest.aabbOf — four corners rotated
  const hw = (size.width * tr.scaleX) / 2
  const hh = (size.height * tr.scaleY) / 2
  const ox = (size.offsetX ?? 0) * tr.scaleX
  const oy = (size.offsetY ?? 0) * tr.scaleY
  const cx = tr.x + ox * Math.cos(tr.rotation) - oy * Math.sin(tr.rotation)
  const cy = tr.y + ox * Math.sin(tr.rotation) + oy * Math.cos(tr.rotation)
  const cos = Math.cos(tr.rotation)
  const sin = Math.sin(tr.rotation)
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  }))
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  }
}

export function mergeAabb(a: WorldAabb, b: WorldAabb): WorldAabb {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }
}

export function rtSizeForAabb(aabb: WorldAabb | null, blur: number): { width: number; height: number; pad: number } {
  const pad = Math.ceil(blur * 2 + 4) // heuristic per #293 Q1 (kernelSize 5)
  if (!aabb) return { width: 4, height: 4, pad }
  const w = Math.ceil(aabb.maxX - aabb.minX + pad * 2)
  const h = Math.ceil(aabb.maxY - aabb.minY + pad * 2)
  // clamp longest edge 2048, min 4×4, no Po2
  const cap = 2048
  let rw = Math.max(4, Math.min(cap, w))
  let rh = Math.max(4, Math.min(cap, h))
  // preserve aspect when capping
  if (w > cap || h > cap) {
    const s = cap / Math.max(w, h)
    rw = Math.max(4, Math.ceil(w * s))
    rh = Math.max(4, Math.ceil(h * s))
    console.warn(`[shadow] RT clamped to ${rw}×${rh} (was ${w}×${h})`)
  }
  return { width: rw, height: rh, pad }
}

// ── Dirty tracking ───────────────────────────────────────────────────────
// Two-tier: frame-hash at handleTimeChanged + shadowDirty Set populated by transform/opacity/visibility/mesh/morph handlers
export type ShadowState = {
  groupId: string
  container: PixiLikeContainer
  sprite: PixiLikeSprite
  rt: PixiLikeRenderTexture
  blurFilter: unknown | null
  lastCasterHash: string
  lastParamHash: string
  lastAabb: WorldAabb | null
  lastPad: number
}

export function casterHashForGroup(
  host: ProtoSceneNode,
  evaluated: Map<string, { x: number; y: number; rotation: number; scaleX: number; scaleY: number; visible: boolean; worldAlpha: number; w: number; h: number }>,
): string {
  const casters = collectShadowCasters(host)
  const parts: string[] = []
  for (const c of casters) {
    const e = evaluated.get(c.id)
    if (!e) continue
    parts.push(`${c.id}:${e.x.toFixed(2)},${e.y.toFixed(2)},${e.rotation.toFixed(3)},${e.scaleX.toFixed(3)},${e.scaleY.toFixed(3)},${e.visible ? 1 : 0},${e.worldAlpha.toFixed(3)},${e.w}x${e.h}`)
  }
  // include group world for BBox origin
  const g = evaluated.get(host.id)
  if (g) parts.push(`g:${g.x.toFixed(2)},${g.y.toFixed(2)}`)
  // deformation hash would be #sizes morph coefficient — for prototype use hash of parts
  return parts.join('|')
}

export function paramHash(effect: ShadowEffect): string {
  const e = clampShadowEffect(effect)
  return `${e.offsetX},${e.offsetY},${e.scaleX},${e.scaleY},${e.skewX},${e.skewY},${e.rotation},${e.blur},${e.opacity},${e.color}`
}

// ── Silhouette generation ────────────────────────────────────────────────
// Clone + white-alpha filter vec4(a) preserving soft edges — per #293 Q2
// In real Pixi: clone subtree, strip placeholder.filters, attach Filter.from({ fragment: "vec4 c=texture(uTexture,vTextureCoord); gl_FragColor=vec4(c.a,c.a,c.a,c.a);" })
// Here we stub for headless testability and document the real call.
export const WHITE_ALPHA_FRAGMENT = `in vec2 vTextureCoord; uniform sampler2D uTexture; void main(){ vec4 c = texture(uTexture, vTextureCoord); gl_FragColor = vec4(c.a, c.a, c.a, c.a); }`
// premul vec4(a) — correct for soft edges; binary threshold would hard-edge hair/feathers

export function silhouetteFilterDescriptor(): { fragment: string; note: string } {
  return {
    fragment: WHITE_ALPHA_FRAGMENT,
    note: 'Filter.from({ glProgram: GlProgram.from({ fragment }) }) — preserves soft alpha, correct premultiplied vec4(a,a,a,a); threshold alpha>0.01 → keep else 0',
  }
}

// ── Per-frame update ─────────────────────────────────────────────────────
// Returns true if RT was regenerated (dirty), false if reused (hash hit)
export function updateShadowForGroup(opts: {
  host: ProtoSceneNode
  effect: ShadowEffect
  evaluated: Map<string, { x: number; y: number; rotation: number; scaleX: number; scaleY: number; visible: boolean; worldAlpha: number; w: number; h: number }>
  sizes: Map<string, { width: number; height: number; offsetX?: number; offsetY?: number }>
  evaluatedTransforms: Map<string, { x: number; y: number; rotation: number; scaleX: number; scaleY: number }>
  renderer: PixiLikeRenderer
  state: ShadowState
  // for BBox union — if null, skip RT sizing update (use lastAabb)
  computeAabb?: (casterIds: string[]) => WorldAabb | null
}): boolean {
  const { host, effect, evaluated, sizes, evaluatedTransforms, renderer, state } = opts
  const casterHash = casterHashForGroup(host, evaluated, effect)
  const pHash = paramHash(effect)
  const hashesEqual = casterHash === state.lastCasterHash && pHash === state.lastParamHash
  if (hashesEqual) {
    // dirty reuse — skip RT render
    return false
  }

  // BBox union via worldAabbOf + pad
  const casters = collectShadowCasters(host)
  let union: WorldAabb | null = null
  for (const c of casters) {
    // gate render-time visible/opacity >0.01 (second phase per #291)
    const ev = evaluated.get(c.id)
    if (!ev || !ev.visible || ev.worldAlpha <= 0.01) continue
    const aabb = worldAabbOf(c as unknown as ProtoSceneNode, evaluatedTransforms, sizes)
    if (!aabb) continue
    union = union ? mergeAabb(union, aabb) : aabb
  }
  const { width, height, pad } = rtSizeForAabb(union, effect.blur)
  if (width !== state.rt.width || height !== state.rt.height) {
    state.rt.resize(width, height)
  }
  state.lastAabb = union
  state.lastPad = pad

  // In real Pixi: clone filtered subtree rendered centered at (pad,pad) inside RT
  // const clone = cloneCasterSubtree(host) // strip filters, add white-alpha filter
  // clone.position.set(pad, pad)
  // renderer.render({ container: clone, target: state.rt, clear: true, clearColor: 0x00000000 })
  // clone.destroy({children:true})
  // For prototype we call renderer stub to prove the call site exists:
  renderer.render({ container: { __silhouetteCloneOf: host.id, pad, casters: casters.map((c) => c.id) }, target: state.rt, clear: true, clearColor: 0x00000000 as unknown as number })

  // Transform: position→rotation→scale→skew via Sprite props pivot 0,0 (per #293 Q3)
  const e = clampShadowEffect(effect)
  state.sprite.x = e.offsetX
  state.sprite.y = e.offsetY
  state.sprite.rotation = (e.rotation * Math.PI) / 180
  state.sprite.scale.set(e.scaleX, e.scaleY)
  state.sprite.skew.set((e.skewX * Math.PI) / 180, (e.skewY * Math.PI) / 180)
  state.sprite.alpha = e.opacity // baked with group worldAlpha in real code: * evaluatedGroupWorldAlpha
  state.sprite.tint = hexStringToTint(e.color)
  // BlurFilter only quality 2 kernel 5 (per #293 Q4)
  if (e.blur <= 0) state.sprite.filters = null
  else {
    // In real Pixi: new BlurFilter({ strength: e.blur, quality: 2, kernelSize: 5, repeatEdgePixels: false })
    state.sprite.filters = [{ __blurFilter: true, strength: e.blur, quality: 2, kernelSize: 5 }]
    state.blurFilter = state.sprite.filters[0]
  }

  // Visibility mirrors evaluatedVisible of group (per #293 Q6 sibling-under)
  const groupEv = evaluated.get(host.id)
  state.container.visible = groupEv ? groupEv.visible : true

  state.lastCasterHash = casterHash
  state.lastParamHash = pHash
  return true
}

// ── Sibling-under compositing ─────────────────────────────────────────────
// Per-group sibling-under, not global layer — per #293 Q6
// For each group with shadowEffect: create shadowContainer label='shadow:<groupId>' → sprite(RT) child,
// attached via (parentContainer ?? world).addChildAt(shadowContainer, indexOf(groupContainer))
export function attachShadowSiblingUnder(
  worldOrParent: PixiLikeContainer,
  groupContainer: PixiLikeContainer,
  shadowContainer: PixiLikeContainer,
): void {
  const idx = worldOrParent.children.indexOf(groupContainer as unknown)
  const at = idx >= 0 ? idx : worldOrParent.children.length
  // parent.sortableChildren = true (tables already) — shadows need it for table zIndex
  worldOrParent.addChildAt(shadowContainer as unknown, at)
}

// ── Lifecycle ────────────────────────────────────────────────────────────
export function createShadowState(
  groupId: string,
  rt: PixiLikeRenderTexture,
  sprite: PixiLikeSprite,
  container: PixiLikeContainer,
): ShadowState {
  return {
    groupId,
    container,
    sprite,
    rt,
    blurFilter: null,
    lastCasterHash: '',
    lastParamHash: '',
    lastAabb: null,
    lastPad: 0,
  }
}

export function destroyShadowState(state: ShadowState): void {
  // Mirrors FullscreenPass#destroy + TextureCache.dispose
  try {
    state.sprite.filters = null
    state.blurFilter = null
    state.container.destroy({ children: true })
    state.rt.destroy()
  } catch {
    // prototype — swallow
  }
}
