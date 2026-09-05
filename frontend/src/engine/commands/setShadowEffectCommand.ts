import type { Engine } from '../internal'
import type { Command } from './command'
import type { ShadowEffect } from '../shadowEffect'
import type { ShadowTrackJSON } from '../json'
import { clampShadowEffect, DEFAULT_SHADOW_EFFECT } from '../shadowEffect'
import { isGroupNode } from '../sceneNode'

export interface SetShadowEffectParameters {
  readonly nodeId: string
  readonly shadowEffect: ShadowEffect | null // null = disable
}

export interface SetShadowEffectInverse {
  readonly nodeId: string
  readonly oldShadowEffect: ShadowEffect | null
  readonly oldShadowTracks?: readonly ShadowTrackJSON[]
}

export class SetShadowEffectCommand implements Command<SetShadowEffectInverse> {
  readonly type = 'SetShadowEffect'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #shadowEffect: ShadowEffect | null

  constructor(input: SetShadowEffectParameters) {
    this.#nodeId = input.nodeId
    // clone to avoid external mutation
    this.#shadowEffect = input.shadowEffect ? { ...input.shadowEffect } : null
    this.parameters = {
      nodeId: input.nodeId,
      shadowEffect: this.#shadowEffect ? { ...this.#shadowEffect } : null,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    // For tracer bullet, require group node (single selection)
    // But allow any node with warning? Spec says group node; we enforce.
    if (this.#shadowEffect !== null && !isGroupNode(node)) {
      throw new Error(`SetShadowEffect: node "${this.#nodeId}" is not a group node`)
    }
    if (this.#shadowEffect !== null) {
      const clamped = clampShadowEffect(this.#shadowEffect, this.#nodeId)
      // Validate after clamp: ensure color etc are correct shape
      // No extra throw, clamp is truthy
      void clamped
    }
  }

  execute(engine: Engine): SetShadowEffectInverse {
    const node = engine.getNode(this.#nodeId)
    const old = node.shadowEffect ? { ...node.shadowEffect } : null
    // Capture shadowTracks before mutation (for lifecycle)
    let oldTracks: readonly ShadowTrackJSON[] | undefined
    try {
      const slide = engine.getSlideOfNode(this.#nodeId) as unknown as { animation: { node: (id: string) => { shadowTracksJSON: () => ShadowTrackJSON[] } | undefined } }
      oldTracks = slide.animation.node(this.#nodeId)?.shadowTracksJSON()
    } catch {
      oldTracks = undefined
    }
    if (this.#shadowEffect === null) {
      engine.setShadowEffect(this.#nodeId, null)
      // Destroy shadow tracks + RT lifecycle (one entry)
      try {
        engine.clearShadowTracks(this.#nodeId)
      } catch {
        void 0
      }
    } else {
      // Use default fallback if caller passed incomplete? Already validated
      const effect = this.#shadowEffect ?? { ...DEFAULT_SHADOW_EFFECT }
      engine.setShadowEffect(this.#nodeId, effect)
    }
    return { nodeId: this.#nodeId, oldShadowEffect: old, ...(oldTracks && oldTracks.length > 0 ? { oldShadowTracks: oldTracks } : {}) }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
