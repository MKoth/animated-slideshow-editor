import type { EnginePublic } from '../engine/engine'

export interface LegacyScriptBlock {
  readonly slideHint: string | null
  readonly payload: Record<string, unknown>
}

/** Parse the historical SetSlideAnimationScript JSON payload without evaluating it. */
export function extractLegacyScriptBlock(content: string): LegacyScriptBlock | null {
  const start = content.indexOf('SetSlideAnimationScript')
  if (start < 0) return null
  const open = content.indexOf('{', start)
  if (open < 0) return null
  let depth = 0
  let quoted = false
  let escaped = false
  for (let i = open; i < content.length; i += 1) {
    const ch = content[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') quoted = false
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === '{') depth += 1
    else if (ch === '}' && --depth === 0) {
      try {
        const parsed: unknown = JSON.parse(content.slice(open, i + 1))
        if (!isRecord(parsed) || !Array.isArray(parsed.tracks)) return null
        return {
          payload: parsed,
          slideHint: typeof parsed.slide === 'string' ? parsed.slide : null,
        }
      } catch {
        return null
      }
    }
  }
  return null
}

/** Convert the supported legacy tracks to reviewable Animation Script DSL. */
export function transpileLegacyScript(
  block: LegacyScriptBlock,
  engine: EnginePublic,
  slideId: string,
): string | null {
  const slide = engine.getSlide(slideId)
  const duration = block.payload.duration
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return null
  const tracks = block.payload.tracks
  if (!Array.isArray(tracks)) return null
  const bindings = new Map<string, string>()
  const lines = [
    `script "Legacy animation (transpiled)" from 0`,
    `// Legacy blend maps are reduced to the strongest compatible shape pair for review.`,
  ]
  const aliasFor = (nodeId: string): string | null => {
    if (bindings.has(nodeId)) return bindings.get(nodeId)!
    try {
      const node = slide.scene.getNode(nodeId)
      if (!node) return null
      const alias = `n${bindings.size}`
      bindings.set(nodeId, alias)
      lines.push(`bind ${alias} = node(${JSON.stringify(node.name)})`)
      return alias
    } catch {
      return null
    }
  }
  const timed = (time: number, statement: string): void => {
    lines.push(`at(${time}) ${statement}`)
  }
  // Bindings are a script prelude, so declare every referenced resource first.
  for (const raw of tracks) {
    if (!isRecord(raw) || typeof raw.node !== 'string' || typeof raw.type !== 'string') return null
    if (!aliasFor(raw.node)) return null
    if (raw.type === 'clip') {
      if (typeof raw.clip !== 'string') return null
      const clip = engine.clips.find((candidate) => candidate.name === raw.clip)
      if (!clip) return null
      const clipAlias = `clip${bindings.size}`
      bindings.set(`clip:${raw.clip}`, clipAlias)
      lines.push(`bind ${clipAlias} = clip(${JSON.stringify(clip.name)})`)
    }
  }
  for (const raw of tracks) {
    if (!isRecord(raw) || typeof raw.node !== 'string' || typeof raw.type !== 'string') return null
    const alias = aliasFor(raw.node)
    if (!alias) return null
    if (raw.type === 'transform') {
      if (!Array.isArray(raw.keys) || raw.keys.length === 0) return null
      let priorTime: number | null = null
      for (const key of raw.keys) {
        if (!isRecord(key) || !validTime(key.t, duration)) return null
        const props: string[] = []
        const pos = key.pos
        if (pos !== undefined) {
          if (!Array.isArray(pos) || pos.length !== 2 || !pos.every(finiteNumber)) return null
          props.push(`x: ${pos[0]}`, `y: ${pos[1]}`)
        }
        if (key.rot !== undefined) {
          if (!finiteNumber(key.rot)) return null
          props.push(`rotation: ${key.rot}`)
        }
        if (props.length === 0) return null
        const values = `{ ${props.join(', ')} }`
        if (priorTime === null || key.t === priorTime) timed(key.t, `${alias}.set(${values})`)
        else {
          const ease = easeName(key.ease)
          if (!ease) return null
          timed(priorTime, `${alias}.tween(${values}, ${key.t - priorTime}, ${ease})`)
        }
        priorTime = key.t
      }
    } else if (raw.type === 'morph') {
      const node = slide.scene.getNode(raw.node)
      if (!node) return null
      if (!Array.isArray(raw.blends) || raw.blends.length === 0) return null
      const binding = engine.getMorphBinding(raw.node)
      const shapes = node.components.mesh?.shapes ?? []
      const from = binding?.fromShapeId ? shapes.find((s) => s.id === binding.fromShapeId) : null
      const to = binding?.toShapeId ? shapes.find((s) => s.id === binding.toShapeId) : null
      if (!from || !to) return null
      let priorTime: number | null = null
      for (const blend of raw.blends) {
        if (!isRecord(blend) || !validTime(blend.t, duration) || !isRecord(blend.shapes))
          return null
        const values = Object.entries(blend.shapes).filter((entry): entry is [string, number] =>
          finiteNumber(entry[1]),
        )
        if (values.length === 0) return null
        const dominant = values.reduce((best, candidate) =>
          candidate[1] > best[1] ? candidate : best,
        )
        const fromWeight = blend.shapes[from.name]
        const toWeight = blend.shapes[to.name]
        if (dominant[0] !== from.name && dominant[0] !== to.name) return null
        const denominator =
          (finiteNumber(fromWeight) ? fromWeight : 0) + (finiteNumber(toWeight) ? toWeight : 0)
        if (denominator <= 0) return null
        const coefficient = (finiteNumber(toWeight) ? toWeight : 0) / denominator
        if (priorTime === null || blend.t === priorTime)
          timed(blend.t, `${alias}.set({ morphCoefficient: ${coefficient} })`)
        else {
          const ease = easeName(blend.ease)
          if (!ease) return null
          timed(priorTime, `${alias}.morph(${coefficient}, ${blend.t - priorTime}, ${ease})`)
        }
        priorTime = blend.t
      }
    } else if (raw.type === 'clip') {
      if (typeof raw.clip !== 'string' || !validTime(raw.at, duration)) return null
      const clipAlias = bindings.get(`clip:${raw.clip}`)
      if (!clipAlias) return null
      timed(raw.at, `${alias}.play(${clipAlias})`)
    } else return null
  }
  return lines.join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function validTime(value: unknown, duration: number): value is number {
  return finiteNumber(value) && value >= 0 && value <= duration
}

function easeName(value: unknown): string | null {
  if (value === undefined) return 'easeInOut'
  return typeof value === 'string' &&
    ['easeIn', 'easeOut', 'easeInOut', 'linear', 'hold'].includes(value)
    ? value
    : null
}
