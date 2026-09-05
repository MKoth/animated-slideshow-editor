import type { Engine } from '../internal'
import type { Command } from './command'
import type { ShadowProperty } from '../shadowEffect'
import { SHADOW_PROPERTIES } from '../shadowEffect'

export interface SetShadowParamParameters {
  readonly nodeId: string
  readonly property: ShadowProperty
  readonly value: number | string
}

export interface SetShadowParamInverse {
  readonly nodeId: string
  readonly property: ShadowProperty
  readonly oldValue: number | string
}

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

export class SetShadowParamCommand implements Command<SetShadowParamInverse> {
  readonly type = 'SetShadowParam'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #property: ShadowProperty
  readonly #value: number | string

  constructor(input: SetShadowParamParameters) {
    if (
      !SHADOW_PROPERTIES.includes(input.property as unknown as (typeof SHADOW_PROPERTIES)[number])
    ) {
      throw new Error(`SetShadowParam: unknown property "${String(input.property)}"`)
    }
    this.#nodeId = input.nodeId
    this.#property = input.property
    this.#value = input.value
    this.parameters = {
      nodeId: input.nodeId,
      property: input.property,
      value: input.value,
    }
  }

  validate(engine: Engine): void {
    const node = engine.getNode(this.#nodeId)
    if (!node.shadowEffect) {
      throw new Error(`SetShadowParam: node "${this.#nodeId}" has no shadowEffect`)
    }
    const prop = this.#property
    const raw = this.#value
    // Validation / clamping per spec
    if (prop === 'color') {
      if (typeof raw !== 'string' || !HEX_COLOR_RE.test(raw)) {
        // Will warn and clamp to #000000 on execute, but not throw – tolerant
        // To allow warnings, we validate but don't throw for color; just note
        // For strict spec, we clamp, not reject
      }
      return
    }
    if (prop === 'blur') {
      if (typeof raw !== 'number') {
        throw new Error(`SetShadowParam: blur must be a number`)
      }
      if (!Number.isFinite(raw)) {
        // NaN/Inf → 0 + warn, not throw
        return
      }
      // finite blur will be clamped 0..32 on execute
      return
    }
    if (prop === 'opacity') {
      if (typeof raw !== 'number') {
        throw new Error(`SetShadowParam: opacity must be a number`)
      }
      if (!Number.isFinite(raw)) {
        // NaN/Inf → 0 + warn, allow but will clamp
        return
      }
      // will clamp 0..1
      return
    }
    if (prop === 'scaleX' || prop === 'scaleY') {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        throw new Error(`SetShadowParam: ${prop} must be a finite number (0 allowed)`)
      }
      return
    }
    // offsetX, offsetY, skewX, skewY, rotation : any finite
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new Error(`SetShadowParam: ${prop} must be a finite number`)
    }
  }

  execute(engine: Engine): SetShadowParamInverse {
    const node = engine.getNode(this.#nodeId)
    if (!node.shadowEffect) {
      throw new Error(`SetShadowParam: node "${this.#nodeId}" has no shadowEffect`)
    }
    const prop = this.#property
    const oldValue = node.shadowEffect[prop] as number | string
    let next: number | string = this.#value

    // Clamping / warning logic mirroring clampShadowEffect but per-field
    if (prop === 'blur') {
      const raw = this.#value as number
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        console.warn(`[shadow] Node "${this.#nodeId}" shadowEffect bad blur ${String(raw)} → 0`)
        next = 0
      } else if (raw < 0) {
        next = 0
      } else if (raw > 32) {
        next = 32
      } else {
        next = raw
      }
    } else if (prop === 'opacity') {
      const raw = this.#value as number
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        console.warn(
          `[shadow] Node "${this.#nodeId}" shadowEffect bad opacity ${String(raw)} → 0.35`,
        )
        next = 0.35
      } else {
        next = Math.max(0, Math.min(1, raw))
      }
    } else if (prop === 'color') {
      const raw = String(this.#value)
      if (!HEX_COLOR_RE.test(raw)) {
        console.warn(
          `[shadow] Node "${this.#nodeId}" shadowEffect bad color "${String(raw)}" → #000000`,
        )
        next = '#000000'
      } else {
        next = raw.toLowerCase()
      }
    } else if (prop === 'scaleX' || prop === 'scaleY') {
      // already validated finite; allow 0 degenerate with warn
      const raw = this.#value as number
      next = raw
      if (raw === 0) {
        console.warn(
          `[shadow] Node "${this.#nodeId}" shadowEffect degenerate scale 0 — renders collapsed`,
        )
      }
    } else {
      // offset, skew, rotation – any finite
      next = this.#value as number
    }

    // Apply via engine
    engine.setShadowParam(this.#nodeId, prop, next)

    return { nodeId: this.#nodeId, property: prop, oldValue }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
