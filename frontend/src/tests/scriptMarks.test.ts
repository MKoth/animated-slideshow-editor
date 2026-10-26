import { describe, expect, it } from 'vitest'
import {
  findTopLevelMarkDefinitions,
  moveScriptMark,
  renameScriptMark,
} from '../engine/scriptMarks'
import { CreateProjectCommand, CreateSlideCommand, createCommandSystem } from '../engine/commands'
import { checkAnimationScript } from '../engine/animationScriptCheck'

describe('scriptMarks source edits', () => {
  it('finds bare, numeric-at, and marker-at definitions in source order', () => {
    const source = [
      'script "Demo" from 0',
      'mark("part-0")',
      'at(3.04) mark("part-1")',
      'at("part-0") mark("part-x")',
    ].join('\n')
    const defs = findTopLevelMarkDefinitions(source)
    expect(defs.map((d) => d.name)).toEqual(['part-0', 'part-1', 'part-x'])
    expect(defs[0]!.atTimeSpan).toBeUndefined()
    expect(defs[0]!.atMarkerSpan).toBeUndefined()
    expect(defs[1]!.atTimeSpan).toBeDefined()
    expect(defs[2]!.atMarkerSpan).toBeDefined()
  })

  it('ignores sweep-effect marks and marks nested in parallel children', () => {
    const source = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'mark(hero, at: 1, over: 1)',
      'mark("top")',
      'parallel {',
      '  mark("nested")',
      '}',
    ].join('\n')
    const defs = findTopLevelMarkDefinitions(source)
    expect(defs.map((d) => d.name)).toEqual(['top'])
  })

  it('moves a bare mark by inserting at(t)', () => {
    const out = moveScriptMark('script "D" from 0\nmark("part-0")', 'part-0', 5.52)
    expect(out).toBe('script "D" from 0\nat(5.52) mark("part-0")')
  })

  it('moves a numeric-at mark by replacing the time', () => {
    const out = moveScriptMark('at(3.04) mark("part-1")', 'part-1', 7)
    expect(out).toBe('at(7) mark("part-1")')
  })

  it('moves a marker-at mark by replacing the marker with a number', () => {
    const out = moveScriptMark('at("part-0") mark("part-x")', 'part-x', 2.5)
    expect(out).toBe('at(2.5) mark("part-x")')
  })

  it('moves the nth occurrence and returns null when missing', () => {
    const source = 'mark("a")\nat(1) mark("a")'
    expect(moveScriptMark(source, 'a', 9, 1)).toBe('mark("a")\nat(9) mark("a")')
    expect(moveScriptMark(source, 'missing', 9)).toBeNull()
  })

  it('renames the definition plus at()/markTime() references, nothing else', () => {
    const source = [
      'script "D" from 0',
      'mark("part-1")',
      'at("part-1") reveal(hero)',
      'let t = markTime("part-1") + 2',
      'create text "part-1" as label',
    ].join('\n')
    const out = renameScriptMark(source, 'part-1', 'intro')
    expect(out).toBe(
      [
        'script "D" from 0',
        'mark("intro")',
        'at("intro") reveal(hero)',
        'let t = markTime("intro") + 2',
        'create text "part-1" as label',
      ].join('\n'),
    )
  })

  it('rename returns null when the mark is not defined', () => {
    expect(renameScriptMark('mark("a")', 'missing', 'b')).toBeNull()
  })
})

describe('compiler exposes marks', () => {
  it('check result carries mark names and times in source order', () => {
    const system = createCommandSystem(() => {})
    const ok = (command: { readonly type: string }) => {
      const result = system.dispatcher.dispatch(command as never)
      if (!result.ok) throw new Error(`command failed: ${result.error.message}`)
    }
    ok(new CreateProjectCommand({ name: 'Lesson' }))
    ok(new CreateSlideCommand({ name: 'Slide 1' }))
    const slide = system.engine.getActiveSlide()
    if (!slide) throw new Error('expected an active slide')
    const result = checkAnimationScript(
      system.engine,
      slide.id,
      [
        'script "Demo" from 0',
        'mark("part-0")',
        'wait(3.04s)',
        'mark("part-1")',
        'at(4.64) mark("part-2")',
      ].join('\n'),
    )
    expect(result.marks).toEqual([
      { name: 'part-0', time: 0 },
      { name: 'part-1', time: 3.04 },
      { name: 'part-2', time: 4.64 },
    ])
  })
})
