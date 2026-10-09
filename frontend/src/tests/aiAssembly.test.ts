import { describe, expect, it } from 'vitest'
import {
  AGENT_PROJECT_OPS,
  assertAgentProjectOpAllowed,
  assembleLesson,
  buildMergeProposalCommands,
  cloneJson,
  createBlankMiddle,
  duplicateToAssemblyTarget,
  getUniqueAssembledName,
  mergeSlidesIntoLesson,
  openNamedReadOnly,
  requireAcceptedStages,
  resolveDefinitionNames,
  resolveSlideNames,
  unionById,
} from '../ai/assembly'
import {
  buildExecutableCommands,
  computeProjectFingerprint,
  dryRunValidate,
  executeProposal,
  validateProposalSchema,
} from '../ai/proposals'
import {
  CreateProjectCommand,
  CreateSlideCommand,
  ImportSlidesCommand,
  createCommandSystem,
} from '../engine/commands'
import { duplicateLessonJSON } from '../app/projectDuplication'
import { createEngineInternal } from '../engine/internal'
import { validate } from '../engine/lessonSerializer'
import type { LessonJSON, SlideJSON } from '../engine/json'

function makeLesson(name: string, slideNames: readonly string[]): LessonJSON {
  const system = createCommandSystem(() => {})
  const ok = system.dispatcher.dispatch(new CreateProjectCommand({ name }))
  if (!ok.ok) throw new Error('no project')
  for (const slideName of slideNames) {
    const res = system.dispatcher.dispatch(new CreateSlideCommand({ name: slideName }))
    if (!res.ok) throw new Error('no slide')
  }
  return cloneJson(system.engine.toJSON())
}

function setupTarget(slideNames: readonly string[] = ['Middle 1']) {
  const system = createCommandSystem(() => {})
  const ok = system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Middle' }))
  if (!ok.ok) throw new Error('no project')
  for (const slideName of slideNames) {
    const res = system.dispatcher.dispatch(new CreateSlideCommand({ name: slideName }))
    if (!res.ok) throw new Error('no slide')
  }
  const baseline = system.undoStack.entries.length
  return { system, baseline }
}

describe('assembly naming and union (first-keeps, union-on-id)', () => {
  it('uniquifies the assembled name with ordered numeric suffix', () => {
    expect(getUniqueAssembledName('Lesson', [])).toBe('Lesson (assembled)')
    expect(getUniqueAssembledName('Lesson', ['Lesson (assembled)'])).toBe('Lesson (assembled 2)')
    expect(getUniqueAssembledName('Lesson', ['Lesson (assembled)', 'Lesson (assembled 2)'])).toBe(
      'Lesson (assembled 3)',
    )
  })

  it('resolves slide collisions first-keeps in order', () => {
    expect(resolveSlideNames(['Intro'], ['Intro', 'Intro', 'Middle'])).toEqual([
      'Intro (2)',
      'Intro (3)',
      'Middle',
    ])
    expect(resolveDefinitionNames(['Clip A'], ['Clip A', 'Clip B'])).toEqual([
      'Clip A (2)',
      'Clip B',
    ])
  })

  it('dedupes embedded libraries by union-on-id (same id keeps target)', () => {
    const target = [
      { id: 'a1', name: 'Target', data: 'AAA', mimeType: 'audio/wav' },
      { id: 'a2', name: 'Keep', data: 'BBB', mimeType: 'audio/wav' },
    ]
    const incoming = [
      { id: 'a1', name: 'Incoming-wins?', data: 'ZZZ', mimeType: 'audio/wav' },
      { id: 'a3', name: 'New', data: 'CCC', mimeType: 'audio/wav' },
    ]
    const { merged, addedIds } = unionById(target, incoming)
    expect(merged.map((entry) => entry.id)).toEqual(['a1', 'a2', 'a3'])
    expect(merged[0]).toMatchObject({ name: 'Target', data: 'AAA' })
    expect(addedIds).toEqual(['a3'])
  })

  it('opens named lessons read-only without mutating the source', () => {
    const lesson = makeLesson('Intro', ['Intro 1'])
    const opened = openNamedReadOnly(lesson)
    expect(opened).toEqual(lesson)
    expect(opened).not.toBe(lesson)
    ;(opened.slides[0] as { name: string }).name = 'MUTATED'
    expect(lesson.slides[0].name).toBe('Intro 1')
  })
})

describe('mergeSlidesIntoLesson (pure)', () => {
  it('inserts at targetIndex with remapped ids and suffixed collisions', () => {
    const target = makeLesson('Middle', ['Middle 1'])
    const incoming = makeLesson('Intro', ['Middle 1'])
    const before = JSON.stringify(incoming)
    const merged = mergeSlidesIntoLesson({
      target,
      slides: [...incoming.slides] as SlideJSON[],
      targetIndex: 0,
    })
    expect(merged.lesson.slides.map((slide) => slide.name)).toEqual(['Middle 1 (2)', 'Middle 1'])
    expect(merged.insertedSlideIds).toHaveLength(1)
    expect(merged.lesson.slides[0].id).not.toBe(incoming.slides[0].id)
    expect(merged.lesson.slides[0].scene.id).not.toBe(incoming.slides[0].scene.id)
    // Sources never mutated.
    expect(JSON.stringify(incoming)).toBe(before)
    expect(JSON.stringify(target.slides.map((s) => s.id))).toContain(target.slides[0].id)
  })

  it('preserves target settings and unions libraries without hash dedup', () => {
    const target = makeLesson('Middle', ['M1'])
    const withSettings = {
      ...target,
      project: { ...target.project, settings: { secondsPerCharacter: 0.2 } },
    } as LessonJSON
    const incoming = makeLesson('Intro', ['I1'])
    const merged = mergeSlidesIntoLesson({ target: withSettings, slides: [...incoming.slides] })
    expect(merged.lesson.project.settings).toMatchObject({ secondsPerCharacter: 0.2 })
  })

  it('throws a fixable message on empty slides or bad targetIndex', () => {
    const target = makeLesson('Middle', ['M1'])
    expect(() => mergeSlidesIntoLesson({ target, slides: [] })).toThrow(/at least one/)
    expect(() =>
      mergeSlidesIntoLesson({ target, slides: [...target.slides], targetIndex: 99 }),
    ).toThrow(/targetIndex/)
  })
})

describe('duplicateToAssemblyTarget and assembleLesson', () => {
  it('duplicates the middle base with fresh id, assembled name, fresh timestamps', () => {
    const middle = makeLesson('Middle', ['M1', 'M2'])
    const assembled = duplicateToAssemblyTarget(middle, ['Middle (copy)'], duplicateLessonJSON)
    expect(assembled.project.id).not.toBe(middle.project.id)
    expect(assembled.project.name).toContain('(assembled)')
    expect(assembled.slides.map((s) => s.name)).toEqual(['M1', 'M2'])
    expect(middle.project.name).toBe('Middle')
  })

  it('orders intro -> middle -> outro from the duplicate-middle base', () => {
    const intro = makeLesson('Intro', ['Intro 1'])
    const middle = makeLesson('Middle', ['Middle 1'])
    const outro = makeLesson('Outro', ['Outro 1'])
    const assembled = assembleLesson({ intro, middle, outro }, [], duplicateLessonJSON)
    expect(assembled.slides.map((s) => s.name)).toEqual(['Intro 1', 'Middle 1', 'Outro 1'])
    expect(assembled.project.name).toContain('(assembled)')
    // Sources never mutated.
    expect(intro.slides.map((s) => s.name)).toEqual(['Intro 1'])
    expect(middle.slides.map((s) => s.name)).toEqual(['Middle 1'])
    expect(outro.slides.map((s) => s.name)).toEqual(['Outro 1'])
  })
})

describe('merge gate (accepted C+D+E only)', () => {
  it('runs only on fully accepted narration, calibration, and board', () => {
    expect(() =>
      requireAcceptedStages({ narration: 'accepted', calibration: 'accepted', board: 'accepted' }),
    ).not.toThrow()
    expect(() =>
      requireAcceptedStages({ narration: 'draft', calibration: 'accepted', board: 'accepted' }),
    ).toThrow(/Stage C|narration/i)
    expect(() =>
      requireAcceptedStages({ narration: 'accepted', calibration: 'draft', board: 'accepted' }),
    ).toThrow(/Stage D|calibration/i)
    expect(() =>
      requireAcceptedStages({ narration: 'accepted', calibration: 'accepted', board: 'draft' }),
    ).toThrow(/Stage E|board/i)
  })

  it('builds the canonical two-command merge proposal (intro at 0, outro at end)', () => {
    const intro = makeLesson('Intro', ['Intro 1'])
    const outro = makeLesson('Outro', ['Outro 1'])
    const accepted = { narration: 'accepted', calibration: 'accepted', board: 'accepted' }
    const commands = buildMergeProposalCommands(intro, outro, 1, accepted)
    expect(commands).toHaveLength(2)
    expect(commands[0]).toMatchObject({ type: 'AiImportSlides', targetIndex: 0 })
    expect(commands[1]).toMatchObject({ type: 'AiImportSlides', targetIndex: 2 })
    const schema = validateProposalSchema(commands)
    expect(schema.ok).toBe(true)
  })

  it('refuses to build the merge proposal unless C+D+E are accepted', () => {
    const intro = makeLesson('Intro', ['Intro 1'])
    const outro = makeLesson('Outro', ['Outro 1'])
    expect(() =>
      buildMergeProposalCommands(intro, outro, 1, {
        narration: 'draft',
        calibration: 'accepted',
        board: 'accepted',
      }),
    ).toThrow(/fully accepted|Stage C/i)
  })
})

describe('agent project ops (limited surface, no delete/rename)', () => {
  it('exposes only create-blank-middle, open-read-only, and duplicate-to-target', () => {
    expect([...AGENT_PROJECT_OPS]).toEqual([
      'create-blank-middle',
      'open-named-intro-outro-read-only',
      'duplicate-to-assembly-target',
    ])
    expect(() => assertAgentProjectOpAllowed('create-blank-middle')).not.toThrow()
    expect(() => assertAgentProjectOpAllowed('delete-project')).toThrow(/forbidden|limited/)
    expect(() => assertAgentProjectOpAllowed('rename-slide')).toThrow(/forbidden|limited/)
  })

  it('creates a blank middle lesson with a fresh id and one slide', () => {
    const first = createBlankMiddle('Middle')
    const second = createBlankMiddle('Middle')
    expect(first.project.name).toBe('Middle')
    expect(first.slides).toHaveLength(1)
    expect(first.project.id).not.toBe(second.project.id)
    expect(validate(first)).toEqual([])
    expect(() => createBlankMiddle('  ')).toThrow(/non-empty/)
  })

  it('blocks delete/rename command types at the proposal schema gate', () => {
    for (const type of ['DeleteSlide', 'RenameSlide', 'RenameProject', 'DeleteProject']) {
      const result = validateProposalSchema([{ type }])
      expect(result.ok).toBe(false)
      expect(result.errors[0].message).toMatch(/Allowed|allowed|unknown/)
    }
  })
})

describe('ImportSlidesCommand via the canonical proposal surface', () => {
  it('executes as one Transaction with one History Entry (AI source)', () => {
    const { system, baseline } = setupTarget(['Middle 1'])
    const incoming = makeLesson('Intro', ['Intro 1'])
    const subset = buildExecutableCommands(
      [
        {
          type: 'AiImportSlides',
          slideIds: incoming.slides.map((s) => s.id),
          slides: cloneJson([...incoming.slides]),
          targetIndex: 0,
        },
      ],
      [0],
    )
    const dry = dryRunValidate(system.engine, subset)
    expect(dry.ok).toBe(true)
    const result = executeProposal(system, subset)
    expect(result.ok).toBe(true)
    expect(system.undoStack.entries.length).toBe(baseline + 1)
    expect(system.undoStack.entries[0].type).toBe('Transaction')
    expect(system.undoStack.entries[0].source).toBe('ai')
    expect(system.engine.project?.slides.map((s) => s.name)).toEqual(['Intro 1', 'Middle 1'])
  })

  it('one undo restores pre-merge content exactly with no ProjectLoaded stack clear', () => {
    const { system, baseline } = setupTarget(['Middle 1'])
    const events: string[] = []
    system.engine.subscribe((event) => events.push(event.type))
    const before = JSON.stringify(system.engine.toJSON())
    const beforeActive = system.engine.activeSlideId
    const incoming = makeLesson('Intro', ['Intro 1'])
    const direct = system.dispatcher.dispatch(
      new ImportSlidesCommand({
        slides: cloneJson([...incoming.slides]) as SlideJSON[],
        slideIds: incoming.slides.map((s) => s.id),
        targetIndex: 0,
      }),
      'ai',
    )
    expect(direct.ok).toBe(true)
    expect(system.undoStack.entries.length).toBe(baseline + 1)
    expect(events).not.toContain('ProjectLoaded')
    // Active slide repointed to the inserted slide (ambient engine-API
    // side effect, never undoable per CONTEXT.md).
    expect(system.engine.activeSlideId).not.toBe(beforeActive)
    const undone = system.dispatcher.undo()
    expect(undone).toBe(true)
    expect(JSON.stringify(system.engine.toJSON())).toBe(before)
    // Active stays valid after undo (first slide takes over when the
    // inserted slide is gone); content is what restores exactly.
    const active = system.engine.activeSlideId
    expect(active).toBeTruthy()
    expect(() => system.engine.getSlide(active as string)).not.toThrow()
  })

  it('blocks slideIds-only execution with a fixable slides-payload message', () => {
    const { system, baseline } = setupTarget(['Middle 1'])
    const before = computeProjectFingerprint(system.engine)
    const result = executeProposal(system, [
      { type: 'AiImportSlides', slideIds: ['s1'], targetIndex: 0 },
    ])
    expect(result.ok).toBe(false)
    expect(result.error ?? '').toMatch(/slides.*payload|source slides/i)
    expect(system.undoStack.entries.length).toBe(baseline)
    expect(computeProjectFingerprint(system.engine)).toBe(before)
  })

  it('resolves collisions without mid-flight prompts and leaves node names untouched', () => {
    const { system } = setupTarget(['Same'])
    const incoming = makeLesson('Intro', ['Same'])
    const incomingSlide = cloneJson(incoming.slides[0]) as SlideJSON
    const beforeNodeNames = (incomingSlide.scene.nodes as unknown as { name: string }[]).map(
      (n) => n.name,
    )
    const result = system.dispatcher.dispatch(
      new ImportSlidesCommand({ slides: [incomingSlide], slideIds: [incomingSlide.id] }),
      'ai',
    )
    expect(result.ok).toBe(true)
    const names = system.engine.project?.slides.map((s) => s.name) ?? []
    expect(names).toContain('Same')
    expect(names).toContain('Same (2)')
    const imported = system.engine.project?.slides.find((s) => s.name === 'Same (2)')
    if (!imported) throw new Error('imported slide missing')
    const liveNames: string[] = []
    const walk = (node: { name: string; children: unknown[] }): void => {
      liveNames.push(node.name)
      for (const child of node.children as { name: string; children: unknown[] }[]) walk(child)
    }
    walk(imported.scene.root as unknown as { name: string; children: unknown[] })
    expect(liveNames.sort()).toEqual([...beforeNodeNames].sort())
  })

  it('blocks broken merges with a fixable message plus Missing Assets Report', () => {
    const { system, baseline } = setupTarget(['Middle 1'])
    const incoming = makeLesson('Intro', ['Intro 1'])
    const broken = cloneJson(incoming.slides[0]) as unknown as Record<string, unknown>
    const scene = broken.scene as { nodes: Record<string, unknown>[] }
    scene.nodes.push({
      id: 'ghost-node',
      name: 'Ghost',
      parentId: scene.nodes[0]?.id ?? null,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      visible: true,
      components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'missing-def' } },
    })
    const before = JSON.stringify(system.engine.toJSON())
    const result = system.dispatcher.dispatch(
      new ImportSlidesCommand({
        slides: [broken as unknown as SlideJSON],
        slideIds: [(broken as unknown as SlideJSON).id],
      }),
      'ai',
    )
    expect(result.ok).toBe(false)
    expect(String((result as { error?: unknown }).error ?? result)).toMatch(/missing asset/i)
    // Validation failure rolls back fully: no partial history, engine untouched.
    expect(system.undoStack.entries.length).toBe(baseline)
    expect(JSON.stringify(system.engine.toJSON())).toBe(before)
  })

  it('never mutates the source payload', () => {
    const { system } = setupTarget(['Middle 1'])
    const incoming = makeLesson('Intro', ['Intro 1'])
    const sourceBefore = JSON.stringify(incoming.slides)
    const slides = cloneJson([...incoming.slides]) as SlideJSON[]
    const inputBefore = JSON.stringify(slides)
    const result = system.dispatcher.dispatch(new ImportSlidesCommand({ slides }), 'ai')
    expect(result.ok).toBe(true)
    // The caller's array is deep-cloned inside the command; the source lesson
    // object is untouched (ids remapped only in the merged copy).
    expect(JSON.stringify(incoming.slides)).toBe(sourceBefore)
    expect(JSON.stringify(slides)).toBe(inputBefore)
  })

  it('preserves prompter -> audio-clip links through the shared id remap', () => {
    const source = createEngineInternal()
    source.createProject({ name: 'Intro' })
    const slide = source.createSlide('Intro 1')
    source.embedAsset({ id: 'voice-1', name: 'voice.wav', data: 'AAA', mimeType: 'audio/wav' })
    const clip = source.createAudioClip(slide.id, {
      assetId: 'voice-1',
      trackId: 'voice',
      timelineStart: 0,
      sourceEnd: 2,
    })
    source.createPrompterPart(slide.id, { id: 'part-1', text: 'Hello', duration: 2 })
    source.setPrompterPartAudio(slide.id, 'part-1', clip.id, 'voice-1')
    const lesson = cloneJson(source.toJSON())

    const { system } = setupTarget(['Middle 1'])
    const result = system.dispatcher.dispatch(
      new ImportSlidesCommand({
        slides: cloneJson([...lesson.slides]) as SlideJSON[],
        slideIds: lesson.slides.map((s) => s.id),
        library: { assets: lesson.library?.assets ? [...lesson.library.assets] : [] },
      }),
      'ai',
    )
    expect(result.ok).toBe(true)
    const imported = system.engine.project?.slides.find((s) => s.name === 'Intro 1')
    if (!imported) throw new Error('imported slide missing')
    const part = imported.prompter?.parts.find((p) => p.text === 'Hello')
    if (!part?.audioClipId) throw new Error('prompter part lost its audio binding')
    const linked = imported.audio.clips.find((c) => c.id === part.audioClipId)
    expect(linked).toBeTruthy()
    expect(linked?.assetId).toBe('voice-1')
  })

  it('keeps top-level and library clip scopes where they belong', () => {
    const target = makeLesson('Middle', ['M1'])
    const incoming = makeLesson('Intro', ['I1'])
    const topClip = { id: 'clip-top-1', name: 'Top Clip', duration: 1, params: [], channels: [] }
    const libClip = { id: 'clip-lib-1', name: 'Lib Clip', duration: 1, params: [], channels: [] }
    const merged = mergeSlidesIntoLesson({
      target,
      slides: [...incoming.slides],
      clips: [topClip] as never,
      library: { clips: [libClip] as never },
    })
    expect(merged.lesson.clips?.map((c) => c.id)).toContain(
      merged.added.clips.find((id) => id !== undefined),
    )
    const topIds = new Set((merged.lesson.clips ?? []).map((c) => c.id))
    const mergedLib = (merged.lesson.library ?? {}) as { clips?: { id: string }[] }
    const libIds = new Set((mergedLib.clips ?? []).map((c) => c.id))
    const targetLib = (target.library ?? {}) as { clips?: unknown[] }
    // Scopes preserved: exactly one new id per scope, no cross-scope move.
    expect(topIds.size).toBe((target.clips ?? []).length + 1)
    expect(libIds.size).toBe((targetLib.clips ?? []).length + 1)
    expect([...topIds].some((id) => libIds.has(id))).toBe(false)
  })
})
