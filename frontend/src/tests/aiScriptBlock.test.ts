import { describe, expect, it } from 'vitest'
import { extractScriptBlock, hasAppliableScript, resolveScriptSlideId } from '../ai/scriptBlock'

const SCRIPT = [
  '## What I found',
  'Cat [node-1] with sitting collection.',
  '',
  '## Script',
  '```engine-command',
  'slide: Slide 1',
  'script "Scene Animation Sequence" from 0',
  'bind cat = node("Cat")',
  '```',
  '',
  '## Open questions',
  'None',
].join('\n')

describe('scriptBlock', () => {
  it('extracts the DSL source and slide name from an engine-command block', () => {
    const block = extractScriptBlock(SCRIPT)
    expect(block).not.toBeNull()
    expect(block?.slideHint).toBe('Slide 1')
    expect(block?.source).toContain('script "Scene Animation Sequence" from 0')
    expect(block?.source).not.toContain('slide:')
    expect(hasAppliableScript(SCRIPT)).toBe(true)
  })

  it('returns null when there is no appliable block', () => {
    expect(extractScriptBlock('## Open questions\n- yawn in or silent?')).toBeNull()
    expect(extractScriptBlock('```typescript\nbind x = node("Y")\n```')).toBeNull()
    // Pseudo-syntax without a real script header is not appliable.
    expect(
      extractScriptBlock('```engine-command\nSetSlideAnimationScript { slide: "Slide 1" }\n```'),
    ).toBeNull()
    expect(hasAppliableScript('just prose')).toBe(false)
  })

  it('skips non-script engine-command blocks', () => {
    const content = [
      '```engine-command',
      'SomeOtherCommand {}',
      '```',
      '',
      '```engine-command',
      'slide: Slide 1',
      'script "Seq" from 0',
      '```',
    ].join('\n')
    expect(extractScriptBlock(content)?.slideHint).toBe('Slide 1')
  })

  it('resolves the slide id by name, id, single slide, then active slide', () => {
    const slides = [
      { id: 's-1', name: 'Slide 1' },
      { id: 's-2', name: 'Slide 2' },
    ]
    expect(resolveScriptSlideId(slides, 'slide 1', 's-2')).toBe('s-1')
    // Explicit override by stable slide id (context renders `Name [id]`).
    expect(resolveScriptSlideId(slides, 's-2', 's-1')).toBe('s-2')
    expect(resolveScriptSlideId(slides, null, 's-2')).toBe('s-2')
    expect(resolveScriptSlideId([{ id: 's-9', name: 'Only' }], null, null)).toBe('s-9')
    expect(resolveScriptSlideId(slides, 'Missing', null)).toBeNull()
  })
})
