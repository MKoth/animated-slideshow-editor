import { describe, expect, it } from 'vitest'
import {
  boardAcceptBlockers,
  boardMoveRequested,
  buildBoardCommands,
  buildTemplateSource,
  marksForParts,
  marksMapForParts,
  middlePartsFromNarration,
  rejectForbiddenWrites,
  slideDurationForParts,
  validateBoardContent,
  validateHardLock,
  validateMarksPresent,
  validateScriptHeader,
  validateTargetsAndBindings,
  verifyBoardScene,
} from '../ai/board'
import { checkAnimationScript } from '../engine/animationScriptCheck'
import { validateProposalSchema } from '../ai/proposals'
import { CreateProjectCommand, CreateSlideCommand, createCommandSystem } from '../engine/commands'

const PARTS = [
  {
    stepId: 'm1',
    order: 0,
    spokenLine: 'Ser is for who you are.',
    estimatedDuration: 4.6,
    audioDuration: 2,
    timelineStart: 0,
    timelineEnd: 2,
  },
  {
    stepId: 'm2',
    order: 1,
    spokenLine: 'Estar is for where you are.',
    estimatedDuration: 5.4,
    audioDuration: 3,
    timelineStart: 2,
    timelineEnd: 5,
  },
]

const GOOD_SOURCE = [
  'script "Board middle" from 0',
  'mark("part-0")',
  'create text "Ser is" as line0',
  'reveal(line0)',
  'mark("part-1")',
  'create text "Estar is" as line1',
  'reveal(line1)',
].join('\n')

describe('Stage E board helpers (hard-locked blackboard scripts)', () => {
  it('templates one fresh script from zero with marks at every boundary', () => {
    expect(slideDurationForParts(PARTS)).toBeCloseTo(5)
    expect(marksForParts(PARTS).map((m) => m.mark)).toEqual(['part-0', 'part-1'])
    expect(marksMapForParts(PARTS)['part-0']).toMatchObject({ stepId: 'm1', time: 0 })
    const source = buildTemplateSource(PARTS)
    expect(validateScriptHeader(source)).toEqual([])
    expect(validateMarksPresent(source, PARTS)).toEqual([])
    expect(validateBoardContent(source)).toEqual([])
    expect(() => middlePartsFromNarration([])).toThrow(/nothing to script/)
    const mixed = [
      {
        stepId: 'i1',
        order: -1,
        spokenLine: 'Hi!',
        timelineStart: 0,
        timelineEnd: 1,
        partTag: 'intro',
      },
      ...PARTS,
    ]
    expect(middlePartsFromNarration(mixed as never).map((p) => p.stepId)).toEqual(['m1', 'm2'])
    expect(() =>
      middlePartsFromNarration([
        { stepId: 'm9', order: 0, spokenLine: 'Hi', timelineStart: 0, timelineEnd: 0 } as never,
      ]),
    ).toThrow(/empty narration window|no measurable/)
  })

  it('header must start at zero and marks must cover parts', () => {
    expect(validateScriptHeader('script "B" from 2\nmark("part-0")').length).toBeGreaterThan(0)
    expect(
      validateMarksPresent(GOOD_SOURCE.replace('mark("part-1")', ''), PARTS).length,
    ).toBeGreaterThan(0)
    expect(validateScriptHeader('')).toHaveLength(1)
  })

  it('content is create-then-reveal with built-ins only, disappear via opacity', () => {
    expect(validateBoardContent(GOOD_SOURCE)).toEqual([])
    const table = [
      'script "B" from 0',
      'mark("part-0")',
      'create table "Grid" as grid',
      'reveal(subtree(grid))',
      'mark("part-1")',
      'create text "x" as a',
      'reveal(a)',
    ].join('\n')
    expect(validateBoardContent(table)).toEqual([])
    expect(
      validateBoardContent('script "B" from 0\nmark("part-0")\nreveal(x)').length,
    ).toBeGreaterThan(0)
    expect(
      validateBoardContent(`${GOOD_SOURCE}\nfunction fill(t: node) {}`).length,
    ).toBeGreaterThan(0)
    expect(validateBoardContent(`${GOOD_SOURCE}\ntitle.play(clip1)`).length).toBeGreaterThan(0)
    expect(
      validateBoardContent(`${GOOD_SOURCE}\ntitle.tween({ visible: 1 })`).length,
    ).toBeGreaterThan(0)
  })

  it('board scene defaults to no cat and static camera', () => {
    expect(verifyBoardScene([], []).ok).toBe(true)
    expect(verifyBoardScene(['cat-1'], []).ok).toBe(false)
    expect(verifyBoardScene([], [{ property: 'rotation' }]).ok).toBe(false)
    expect(verifyBoardScene([], [{ property: 'positionX' }]).ok).toBe(false)
    expect(verifyBoardScene([], [{ property: 'positionX' }], true).ok).toBe(true)
    expect(boardMoveRequested(['Chalk text appears on the blackboard'])).toBe(false)
    expect(boardMoveRequested(['Slow pan across the board, left to right'])).toBe(true)
    expect(boardMoveRequested(['Welcome to the company'])).toBe(false)
    expect(validateBoardContent(`${GOOD_SOURCE}\n// this board stays visible throughout`)).toEqual(
      [],
    )
  })

  it('hard lock blocks overrun and drift with no auto-shift', () => {
    const marks = marksMapForParts(PARTS)
    const good = [{ from: 0, to: 5, effects: [{ start: 0.5, duration: 1 }] }]
    expect(validateHardLock(PARTS, good, marks)).toEqual([])
    const overrun = [{ from: 0, to: 5, effects: [{ start: 1.5, duration: 1 }] }]
    expect(validateHardLock(PARTS, overrun, marks).length).toBeGreaterThan(0)
    const drifted = { ...marks, 'part-1': { stepId: 'm2', time: 2.5 } }
    expect(validateHardLock(PARTS, good, drifted).length).toBeGreaterThan(0)
    expect(validateHardLock(PARTS, [{ from: 1, to: 5 }], marks).length).toBeGreaterThan(0)
    expect(validateHardLock(PARTS, [], marks).length).toBeGreaterThan(0)
  })

  it('invalid targets and unresolved bindings block at compile time', () => {
    expect(
      validateTargetsAndBindings([
        { severity: 'error', message: 'reveal target has no visible content' },
      ]).length,
    ).toBeGreaterThan(0)
    expect(
      validateTargetsAndBindings([{ severity: 'error', message: 'Unknown binding "Title"' }])
        .length,
    ).toBeGreaterThan(0)
    expect(validateTargetsAndBindings([{ severity: 'warning', message: 'slow' }])).toEqual([])
    expect(
      validateTargetsAndBindings([], [{ from: 0, to: 1, entryVersions: { fill: 3 } }]).length,
    ).toBeGreaterThan(0)
  })

  it('board proposals execute as SetSlideAnimationScript only', () => {
    const commands = buildBoardCommands([{ slideId: 's1', source: GOOD_SOURCE }])
    expect(commands[0].type).toBe('SetSlideAnimationScript')
    expect(validateProposalSchema(commands).ok).toBe(true)
    expect(rejectForbiddenWrites(commands)).toEqual([])
    expect(
      rejectForbiddenWrites([{ type: 'AiCreateBoardText', slideId: 's', text: 'hi' }]).length,
    ).toBeGreaterThan(0)
    expect(() => buildBoardCommands([{ slideId: '', source: GOOD_SOURCE }])).toThrow(/no slideId/)
    expect(() => buildBoardCommands([{ slideId: 's1', source: '  ' }])).toThrow(/empty/)
  })

  it('accept gate stays blocked until everything is green', () => {
    const marks = marksMapForParts(PARTS)
    const board = {
      parts: PARTS,
      scripts: [{ slideId: 's1', source: GOOD_SOURCE }],
      footprints: [{ from: 0, to: 5, effects: [{ start: 0.5, duration: 1 }] }],
      marksMap: marks,
      diagnostics: [],
      checks: { parts: PARTS, scene: { catNodes: [], cameraKeys: [] } },
    }
    expect(boardAcceptBlockers(board)).toEqual([])
    expect(
      boardAcceptBlockers({
        ...board,
        footprints: [{ from: 0, to: 5, effects: [{ start: 1.5, duration: 1 }] }],
      }).length,
    ).toBeGreaterThan(0)
    expect(
      boardAcceptBlockers({
        ...board,
        checks: { parts: PARTS, scene: { catNodes: ['cat'], cameraKeys: [] } },
      }).length,
    ).toBeGreaterThan(0)
  })

  it('board template compiles through the Check seam (script compile-then-evaluate)', () => {
    const system = createCommandSystem(() => {})
    const project = system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
    if (!project.ok) throw new Error('no project')
    const slide = system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Middle' }))
    if (!slide.ok) throw new Error('no slide')
    const slideId = (slide.inverse as { slideId: string }).slideId
    // Slide duration must equal the narration sum or the segment window errors.
    system.engine.getSlide(slideId).duration = slideDurationForParts(PARTS)
    const source = buildTemplateSource(PARTS)
    const checked = checkAnimationScript(system.engine, slideId, source)
    // Template placeholders use create-then-reveal; the Check seam reports
    // the compile diagnostics the accept gate consumes (invalid targets and
    // unresolved bindings block). The gate helper must surface them.
    const diagnostics = checked.diagnostics.map((d) => ({
      severity: d.severity,
      message: d.message,
    }))
    const blockers = validateTargetsAndBindings(diagnostics, [
      {
        from: checked.summary.from,
        to: checked.summary.to,
        entryVersions: checked.footprint.entryVersions as Record<string, number>,
      },
    ])
    // Either the template compiles clean (no blockers) or the gate blocks
    // with a fixable compile message — never a silent pass on broken scripts.
    if (!checked.runnable) {
      expect(blockers.length).toBeGreaterThan(0)
    } else {
      expect(checked.summary.from).toBe(0)
      expect(validateScriptHeader(source)).toEqual([])
    }
  })
})
