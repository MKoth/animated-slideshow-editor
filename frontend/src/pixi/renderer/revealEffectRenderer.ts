import type { Scene } from '../../engine'
import type { SceneEffect } from '../../engine/sceneEffect'
import { revealCoverage } from '../../engine/sceneEffect'
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
  readonly #masks = new Map<string, PixiGraphics>()
  readonly #paws = new Map<string, PixiGraphics>()
  readonly #assetPerformers = new Map<
    string,
    { readonly nodeId: string; readonly sprite: PixiSprite }
  >()

  constructor(
    world: PixiContainer,
    pixi: RendererPixi,
    textureCache: TextureCache,
    resolveAssetState: (nodeId: string, time: number) => RevealPerformerAssetState | null,
  ) {
    this.#world = world
    this.#pixi = pixi
    this.#textureCache = textureCache
    this.#resolveAssetState = resolveAssetState
  }

  clear(containers: ReadonlyMap<string, PixiContainer>): void {
    for (const [nodeId, mask] of this.#masks) {
      const container = containers.get(nodeId)
      if (container) container.mask = null
      this.#world.removeChild(mask)
      mask.destroy()
    }
    this.#masks.clear()
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
    for (const nodeId of targetIds) {
      const container = containers.get(nodeId)
      if (!container) continue
      let mask = this.#masks.get(nodeId)
      if (!mask) {
        mask = new this.#pixi.Graphics()
        mask.renderable = false
        this.#world.addChild(mask)
        container.mask = mask
        this.#masks.set(nodeId, mask)
      }
      const relevant = effects
        .filter((effect) => effect.nodeIds.includes(nodeId))
        .sort((a, b) => a.start - b.start || effects.indexOf(a) - effects.indexOf(b))
      const effect =
        [...relevant].reverse().find((candidate) => candidate.start <= time) ?? relevant[0]
      if (!effect) continue
      const fieldWidth = Math.max(0, effect.bounds.maxX - effect.bounds.minX)
      const progress = revealCoverage(effect, time)
      mask.clear()
      if (fieldWidth > 0) {
        const x =
          effect.kind === 'wipe' ? effect.bounds.minX + fieldWidth * progress : effect.bounds.minX
        const width = effect.kind === 'wipe' ? fieldWidth * (1 - progress) : fieldWidth * progress
        mask
          .rect(x, effect.bounds.minY, width, effect.bounds.maxY - effect.bounds.minY)
          .fill({ color: 0xffffff })
      }
    }

    const active = effects.filter(
      (effect) => time >= effect.start && time <= effect.start + effect.duration,
    )
    const performers = active.filter((effect) => {
      const index = effects.indexOf(effect)
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
    const pawIds = new Set(
      performers
        .filter((effect) => effect.visual.kind === 'paw' || effect.visual.kind === 'cloth')
        .map((effect) => effect.id),
    )
    const assetEffects = new Map(
      performers
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
      const x =
        effect.bounds.minX +
        progress * (effect.bounds.maxX - effect.bounds.minX) +
        Math.sin(progress * Math.PI * 6) * height * 0.02
      const y =
        (effect.bounds.minY + effect.bounds.maxY) / 2 +
        Math.sin(progress * Math.PI * 4) * height * 0.02
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
    if (performer?.nodeId !== nodeId) {
      if (performer) {
        this.#world.removeChild(performer.sprite)
        performer.sprite.destroy()
      }
      const sprite = new this.#pixi.Sprite(this.#textureCache.get(state.assetId))
      sprite.zIndex = Number.MAX_SAFE_INTEGER
      this.#world.addChild(sprite)
      performer = { nodeId, sprite }
      this.#assetPerformers.set(effect.id, performer)
    }
    const sprite = performer.sprite
    sprite.anchor.set(0.5)
    sprite.position.set(x, y)
    sprite.rotation = state.rotation
    sprite.width = state.size.width * Math.abs(state.scaleX)
    sprite.height = state.size.height * Math.abs(state.scaleY)
    sprite.tint = state.tint
    sprite.alpha = state.alpha
  }
}
