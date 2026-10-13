import { describe, expect, it } from 'vitest'
import { extractLegacyScriptBlock, transpileLegacyScript } from '../ai/legacyScript'
import type { EnginePublic } from '../engine/engine'

describe('legacy animation script conversion', () => {
  it('parses a legacy command embedded in a fenced block', () => {
    const block = extractLegacyScriptBlock(
      '```engine-command\nSetSlideAnimationScript {"slide":"Slide 1","duration":5,"tracks":[]}\n```',
    )
    expect(block?.slideHint).toBe('Slide 1')
    expect(block?.payload.duration).toBe(5)
  })

  it('transpiles transform keys to explicit local DSL without an LLM', () => {
    const block = extractLegacyScriptBlock(
      'SetSlideAnimationScript {"slide":"Slide 1","duration":5,"tracks":[{"node":"n1","type":"transform","keys":[{"t":0,"pos":[10,20],"rot":0},{"t":2,"pos":[30,40],"rot":1,"ease":"easeOut"}]}]}',
    )!
    const node = { id: 'n1', name: 'Cat', components: { mesh: undefined } }
    const engine = {
      getSlide: () => ({ scene: { id: 'scene', getNode: () => node } }),
      clips: [],
    } as unknown as EnginePublic
    const source = transpileLegacyScript(block, engine, 'slide-1')
    expect(source).toContain('bind n0 = node("Cat")')
    expect(source).toContain('at(0) n0.set({ x: 10, y: 20, rotation: 0 })')
    expect(source).toContain('at(0) n0.tween({ x: 30, y: 40, rotation: 1 }, 2, easeOut)')
  })

  it('rejects malformed or unsupported legacy tracks for the existing LLM fallback', () => {
    expect(extractLegacyScriptBlock('SetSlideAnimationScript {bad json}')).toBeNull()
    const block = extractLegacyScriptBlock(
      'SetSlideAnimationScript {"duration":5,"tracks":[{"node":"n1","type":"unknown"}]}',
    )!
    const engine = {
      getSlide: () => ({ scene: { id: 'scene', getNode: () => ({ id: 'n1', name: 'Cat' }) } }),
      clips: [],
    } as unknown as EnginePublic
    expect(transpileLegacyScript(block, engine, 'slide-1')).toBeNull()
  })
})
