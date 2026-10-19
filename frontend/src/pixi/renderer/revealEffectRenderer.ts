import type { Scene } from '../../engine'
import type { RevealEffect, SceneEffect, WipeEffect } from '../../engine/sceneEffect'
import {
  carryPosition,
  markLifecycle,
  revealCoverage,
  selectActiveCarries,
  selectActiveMarks,
  selectRevealWipeForNode,
} from '../../engine/sceneEffect'

/**
 * Erratic segments across one sweep when no wobbleSpeed is set; knots
 * interpolate smoothly. Matches the original fixed wobble character.
 */
const LEGACY_WOBBLE_SEGMENTS = 6
/** Clamp for rate-derived segment counts: keeps per-frame knot sampling cheap. */
const MIN_WOBBLE_SEGMENTS = 2
const MAX_WOBBLE_SEGMENTS = 64

/** Default grabber size for a carry paw (carries have no sweep bounds). */
const CARRY_GRABBER_HEIGHT = 80

function hashSeed(text: string): number {
  let hash = 2166136261 >>> 0
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Erratic segment count for a sweep: the legacy fixed rate when wobbleSpeed
 * is unset, otherwise ~2 segments per wiggle at the requested wiggles/second
 * rate over the effect duration.
 */
export function wobbleSegmentCount(effect: {
  readonly duration: number
  readonly wobbleSpeed?: number
}): number {
  if (effect.wobbleSpeed === undefined) return LEGACY_WOBBLE_SEGMENTS
  const count = Math.round(effect.wobbleSpeed * effect.duration * 2)
  return Math.min(MAX_WOBBLE_SEGMENTS, Math.max(MIN_WOBBLE_SEGMENTS, count))
}

function wobbleKnots(
  seedKey: string,
  from: number,
  to: number,
  salt: string,
  segments: number,
): number[] {
  const random = mulberry32(hashSeed(`${seedKey}:${salt}:${segments}`))
  const knots: number[] = [0]
  for (let index = 1; index < segments; index += 1) {
    const magnitude = from + random() * (to - from)
    const sign = random() < 0.5 ? -1 : 1
    knots.push(sign * magnitude)
  }
  knots.push(0)
  return knots
}

function sampleKnots(knots: readonly number[], progress: number): number {
  const segments = knots.length - 1
  const clamped = Math.min(1, Math.max(0, progress))
  const position = clamped * segments
  const index = Math.min(segments - 1, Math.floor(position))
  const fraction = position - index
  const smooth = fraction * fraction * (3 - 2 * fraction)
  return knots[index] * (1 - smooth) + knots[index + 1] * smooth
}

/**
 * Deterministic erratic offset for one axis: per-wiggle magnitudes sampled
 * from [from, to] with a random sign, smoothstep-interpolated across the
 * sweep and seeded by the effect id so previews and exports agree. Starts and
 * ends at zero so the pen lands exactly on the sweep edges.
 */
export function erraticWobble(
  seedKey: string,
  progress: number,
  range: { readonly from: number; readonly to: number } | undefined,
  salt: string,
  segments: number = LEGACY_WOBBLE_SEGMENTS,
): number {
  if (!range || (range.from === 0 && range.to === 0)) return 0
  return sampleKnots(wobbleKnots(seedKey, range.from, range.to, salt, segments), progress)
}

/** Pen point for a reveal/wipe sweep: directional base plus legacy wobble plus erratic offsets. */
export function sweepPenPosition(
  effect: RevealEffect | WipeEffect,
  progress: number,
): { readonly x: number; readonly y: number } {
  const width = effect.bounds.maxX - effect.bounds.minX
  const height = effect.bounds.maxY - effect.bounds.minY
  const rightToLeft = effect.direction === 'right-to-left'
  const baseX = rightToLeft
    ? effect.bounds.maxX - progress * width
    : effect.bounds.minX + progress * width
  const baseY = (effect.bounds.minY + effect.bounds.maxY) / 2
  const legacyX = Math.sin(progress * Math.PI * 6) * height * 0.02
  const legacyY = Math.sin(progress * Math.PI * 4) * height * 0.02
  const segments = wobbleSegmentCount(effect)
  return {
    x: baseX + legacyX + erraticWobble(effect.id, progress, effect.wobbleX, 'x', segments),
    y: baseY + legacyY + erraticWobble(effect.id, progress, effect.wobbleY, 'y', segments),
  }
}

/** Mask rectangle for a reveal/wipe sweep, honoring the sweep direction. */
export function sweepMask(
  effect: RevealEffect | WipeEffect,
  progress: number,
): { readonly x: number; readonly width: number } {
  const width = Math.max(0, effect.bounds.maxX - effect.bounds.minX)
  const rightToLeft = effect.direction === 'right-to-left'
  if (effect.kind === 'wipe') {
    return rightToLeft
      ? { x: effect.bounds.minX, width: width * (1 - progress) }
      : { x: effect.bounds.minX + width * progress, width: width * (1 - progress) }
  }
  return rightToLeft
    ? { x: effect.bounds.maxX - width * progress, width: width * progress }
    : { x: effect.bounds.minX, width: width * progress }
}
import type { WorldSize } from './worldGeometry'
import type { PixiContainer, PixiGraphics, PixiSprite, RendererPixi } from './pixi'
import type { TextureCache } from './textureCache'

export interface RevealPerformerAssetState {
  readonly assetId: string
  readonly size: WorldSize
  readonly rotation: number
  readonly scaleX: number
  readonly scaleY: number
  readonly tint: number
  readonly alpha: number
}

/** Draws persisted reveal masks and performers from the current slide timestamp. */
export class RevealEffectRenderer {
  readonly #world: PixiContainer
  readonly #pixi: RendererPixi
  readonly #textureCache: TextureCache
  readonly #resolveAssetState: (nodeId: string, time: number) => RevealPerformerAssetState | null
  readonly #resolveAssetUrl: (assetId: string) => string | null
  readonly #masks = new Map<string, PixiGraphics>()
  readonly #marks = new Map<string, PixiGraphics>()
  readonly #paws = new Map<string, PixiGraphics>()
  readonly #assetPerformers = new Map<
    string,
    { readonly nodeId: string; readonly assetId: string; readonly sprite: PixiSprite }
  >()

  constructor(
    world: PixiContainer,
    pixi: RendererPixi,
    textureCache: TextureCache,
    resolveAssetState: (nodeId: string, time: number) => RevealPerformerAssetState | null,
    resolveAssetUrl: (assetId: string) => string | null,
  ) {
    this.#world = world
    this.#pixi = pixi
    this.#textureCache = textureCache
    this.#resolveAssetState = resolveAssetState
    this.#resolveAssetUrl = resolveAssetUrl
  }

  clear(containers: ReadonlyMap<string, PixiContainer>): void {
    for (const [nodeId, mask] of this.#masks) {
      const container = containers.get(nodeId)
      if (container) container.mask = null
      this.#world.removeChild(mask)
      mask.destroy()
    }
    this.#masks.clear()
    for (const mark of this.#marks.values()) {
      this.#world.removeChild(mark)
      mark.destroy()
    }
    this.#marks.clear()
    for (const performers of [
      this.#paws.values(),
      [...this.#assetPerformers.values()].map((entry) => entry.sprite),
    ]) {
      for (const performer of performers) {
        this.#world.removeChild(performer)
        performer.destroy()
      }
    }
    this.#paws.clear()
    this.#assetPerformers.clear()
  }

  update(
    effects: readonly SceneEffect[],
    scene: Scene,
    time: number,
    containers: ReadonlyMap<string, PixiContainer>,
  ): void {
    const targetIds = new Set(
      effects
        .filter((effect) => effect.kind === 'reveal' || effect.kind === 'wipe')
        .flatMap((effect) => effect.nodeIds)
        .filter((nodeId) => scene.getNode(nodeId) !== undefined),
    )
    for (const [nodeId, mask] of this.#masks) {
      if (targetIds.has(nodeId)) continue
      const container = containers.get(nodeId)
      if (container) container.mask = null
      this.#world.removeChild(mask)
      mask.destroy()
      this.#masks.delete(nodeId)
    }

    const activeMarks = selectActiveMarks(effects, time)
    for (const [id, graphic] of this.#marks) {
      if (activeMarks.some((effect) => effect.id === id)) continue
      this.#world.removeChild(graphic)
      graphic.destroy()
      this.#marks.delete(id)
    }
    for (const effect of activeMarks) {
      let graphic = this.#marks.get(effect.id)
      if (!graphic) {
        graphic = new this.#pixi.Graphics()
        graphic.zIndex = Number.MAX_SAFE_INTEGER
        this.#world.addChild(graphic)
        this.#marks.set(effect.id, graphic)
      }
      const { drawProgress, opacity } = markLifecycle(effect, time)
      const width = effect.bounds.maxX - effect.bounds.minX
      const height = effect.bounds.maxY - effect.bounds.minY
      // A fixed, deterministic open loop; the trigonometric perturbation gives
      // the sampled ellipse a hand-drawn character without per-frame randomness.
      const count = 49
      const startAngle = -Math.PI * 0.82
      const endAngle = startAngle + Math.PI * 1.82
      const point = (index: number) => {
        const angle = startAngle + ((endAngle - startAngle) * index) / (count - 1)
        const irregularity = 1 + 0.035 * Math.sin(index * 2.31) + 0.018 * Math.sin(index * 0.73)
        return {
          x:
            (effect.bounds.minX + effect.bounds.maxX) / 2 +
            Math.cos(angle) * width * 0.55 * irregularity,
          y:
            (effect.bounds.minY + effect.bounds.maxY) / 2 +
            Math.sin(angle) * height * 0.55 * irregularity,
        }
      }
      const lastPoint = Math.ceil(drawProgress * (count - 1))
      graphic.clear()
      if (lastPoint > 0) {
        const first = point(0)
        graphic.moveTo(first.x, first.y)
        for (let index = 1; index <= lastPoint; index += 1) {
          const next = point(index)
          graphic.lineTo(next.x, next.y)
        }
        graphic.stroke({
          width: Math.max(2, Math.min(width, height) * 0.025),
          color: 0xe53935,
          alpha: opacity,
        })
      }
      if (effect.visual.kind === 'asset') {
        const pen = point(lastPoint)
        this.#drawAsset(effect, pen.x, pen.y, time)
      }
    }
    for (const nodeId of targetIds) {
      const container = containers.get(nodeId)
      if (!container) continue
      let mask = this.#masks.get(nodeId)
      if (!mask) {
        mask = new this.#pixi.Graphics()
        // Do NOT set renderable = false here: Pixi v8 hides assigned masks
        // from normal rendering itself (StencilMask sets includeInBuild =
        // false), while renderable = false also skips the mask's geometry in
        // the stencil pass — leaving every masked node fully hidden.
        this.#world.addChild(mask)
        container.mask = mask
        this.#masks.set(nodeId, mask)
      }
      const effect = selectRevealWipeForNode(effects, nodeId, time)
      if (!effect) continue
      const fieldWidth = Math.max(0, effect.bounds.maxX - effect.bounds.minX)
      const progress = revealCoverage(effect, time)
      mask.clear()
      if (fieldWidth > 0) {
        const rect = sweepMask(effect, progress)
        mask
          .rect(rect.x, effect.bounds.minY, rect.width, effect.bounds.maxY - effect.bounds.minY)
          .fill({ color: 0xffffff })
      }
    }

    const active = effects.filter(
      (effect): effect is RevealEffect | WipeEffect =>
        (effect.kind === 'reveal' || effect.kind === 'wipe') &&
        time >= effect.start &&
        time <= effect.start + effect.duration,
    )
    const performers = active.filter((effect) => {
      const index = effects.indexOf(effect)
      // Later scheduled sweeps keep governing the mask after their performer
      // window ends, so suppression looks at any started later effect — unlike
      // selectActiveMarks, which only considers still-active marks.
      return !effects.some((other) => {
        const later =
          other.start > effect.start ||
          (other.start === effect.start && effects.indexOf(other) > index)
        return (
          later &&
          other.start <= time &&
          other.nodeIds.some((nodeId) => effect.nodeIds.includes(nodeId))
        )
      })
    })
    const activeCarries = selectActiveCarries(effects, time)
    const pawIds = new Set(
      [
        ...performers.filter(
          (effect) => effect.visual.kind === 'paw' || effect.visual.kind === 'cloth',
        ),
        ...activeCarries.filter((effect) => effect.visual.kind === 'paw'),
      ].map((effect) => effect.id),
    )
    const assetEffects = new Map(
      [...performers, ...activeMarks, ...activeCarries]
        .filter((effect) => effect.visual.kind === 'asset')
        .map((effect) => [effect.id, effect] as const),
    )
    for (const [id, paw] of this.#paws) {
      if (pawIds.has(id)) continue
      this.#world.removeChild(paw)
      paw.destroy()
      this.#paws.delete(id)
    }
    for (const [id, performer] of this.#assetPerformers) {
      if (assetEffects.has(id)) continue
      this.#world.removeChild(performer.sprite)
      performer.sprite.destroy()
      this.#assetPerformers.delete(id)
    }
    for (const effect of performers) {
      const progress = revealCoverage(effect, time)
      const height = effect.bounds.maxY - effect.bounds.minY
      const pen = sweepPenPosition(effect as RevealEffect | WipeEffect, progress)
      const x = pen.x
      const y = pen.y
      if (effect.visual.kind === 'paw' || effect.visual.kind === 'cloth') {
        let paw = this.#paws.get(effect.id)
        if (!paw) {
          paw = new this.#pixi.Graphics()
          paw.zIndex = Number.MAX_SAFE_INTEGER
          this.#world.addChild(paw)
          this.#paws.set(effect.id, paw)
        }
        if (effect.visual.kind === 'cloth') this.#drawCloth(paw, x, y, height)
        else this.#drawPaw(paw, x, y, height)
      } else if (effect.visual.kind === 'asset') {
        this.#drawAsset(effect, x, y, time)
      }
    }
    for (const effect of activeCarries) {
      const grab = carryPosition(effect, time)
      if (effect.visual.kind === 'paw') {
        let paw = this.#paws.get(effect.id)
        if (!paw) {
          paw = new this.#pixi.Graphics()
          paw.zIndex = Number.MAX_SAFE_INTEGER
          this.#world.addChild(paw)
          this.#paws.set(effect.id, paw)
        }
        this.#drawPaw(paw, grab.x, grab.y, CARRY_GRABBER_HEIGHT)
      } else if (effect.visual.kind === 'asset') {
        this.#drawAsset(effect, grab.x, grab.y, time)
      }
    }
  }

  #drawPaw(paw: PixiGraphics, x: number, y: number, height: number): void {
    const radius = Math.max(5, height * 0.035)
    paw.clear()
    paw.circle(x, y, radius).fill({ color: 0xffffff }).stroke({ width: 1, color: 0x222222 })
    for (let toe = 0; toe < 3; toe += 1) {
      paw
        .circle(x + (toe - 1) * radius, y - radius * 1.3, Math.max(2, height * 0.015))
        .fill({ color: 0xffffff })
        .stroke({ width: 1, color: 0x222222 })
    }
  }

  #drawCloth(cloth: PixiGraphics, x: number, y: number, height: number): void {
    const width = Math.max(14, height * 0.16)
    const clothHeight = Math.max(8, height * 0.09)
    cloth.clear()
    cloth
      .rect(x - width / 2, y - clothHeight / 2, width, clothHeight)
      .fill({ color: 0x4aa8d8 })
      .stroke({ width: 1, color: 0x17384a })
    cloth
      .moveTo(x - width / 2, y + clothHeight / 2)
      .lineTo(x - width / 3, y + clothHeight / 2 + clothHeight * 0.35)
      .lineTo(x - width / 6, y + clothHeight / 2)
      .lineTo(x, y + clothHeight / 2 + clothHeight * 0.35)
      .lineTo(x + width / 6, y + clothHeight / 2)
      .lineTo(x + width / 3, y + clothHeight / 2 + clothHeight * 0.35)
      .lineTo(x + width / 2, y + clothHeight / 2)
      .stroke({ width: 1, color: 0x17384a })
  }

  #drawAsset(effect: SceneEffect, x: number, y: number, time: number): void {
    if (effect.visual.kind !== 'asset') return
    const nodeId = effect.visual.nodeId
    const state = this.#resolveAssetState(nodeId, time)
    if (!state) return
    let performer = this.#assetPerformers.get(effect.id)
    if (performer?.nodeId !== nodeId || performer.assetId !== state.assetId) {
      if (performer) {
        this.#world.removeChild(performer.sprite)
        performer.sprite.destroy()
      }
      const sprite = new this.#pixi.Sprite(this.#textureCache.get(state.assetId))
      sprite.zIndex = Number.MAX_SAFE_INTEGER
      this.#world.addChild(sprite)
      performer = { nodeId, assetId: state.assetId, sprite }
      this.#assetPerformers.set(effect.id, performer)
      const url = this.#resolveAssetUrl(state.assetId)
      if (url) {
        void this.#textureCache.load(url, state.assetId).then((loaded) => {
          if (
            loaded.real &&
            this.#assetPerformers.get(effect.id)?.sprite === sprite &&
            !sprite.destroyed
          ) {
            sprite.texture = loaded.texture
          }
        })
      }
    }
    const sprite = performer.sprite
    const tuning = effect.visual.kind === 'asset' ? effect.visual : null
    const scale = tuning?.scale ?? 1
    sprite.anchor.set(tuning?.anchorX ?? 0.5, tuning?.anchorY ?? 0.5)
    sprite.position.set(x + (tuning?.dx ?? 0), y + (tuning?.dy ?? 0))
    sprite.rotation = state.rotation
    sprite.width = state.size.width * Math.abs(state.scaleX) * scale
    sprite.height = state.size.height * Math.abs(state.scaleY) * scale
    sprite.tint = state.tint
    sprite.alpha = state.alpha
  }
}
