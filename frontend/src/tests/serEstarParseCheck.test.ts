import { describe, expect, it } from 'vitest'
import serEstarScript from '../../e2e/fixtures/ser-estar-lesson.script?raw'
import { parseAnimationScript } from '../engine/animationScriptParser'

describe('ser-estar lesson script parses clean', () => {
  it('has zero parse diagnostics', () => {
    const parsed = parseAnimationScript(serEstarScript)
    expect(parsed.diagnostics).toEqual([])
  })
})
