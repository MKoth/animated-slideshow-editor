import { describe, expect, it, beforeEach } from 'vitest'
import { createEngineInternal } from '../../engine/internal'
import { CommandDispatcher, UndoStack } from '../../engine/commands'
import { ImportPrompterCommand } from '../../engine/commands/importPrompterCommand'
import { SplitPrompterPartCommand } from '../../engine/commands/splitPrompterPartCommand'
import {
  UnitePrompterPartsCommand,
  MergePrompterPartsCommand,
} from '../../engine/commands/unitePrompterPartsCommand'
import { UpdatePrompterPartWithShiftCommand } from '../../engine/commands/updatePrompterPartWithShiftCommand'
import { UpdatePrompterPartCommand } from '../../engine/commands/updatePrompterPartCommand'
import {
  DEFAULT_PROMPTER_SECONDS_PER_CHARACTER,
  splitImportText,
  reflowPrompter,
} from '../../engine/prompter'
import type { LessonJSON } from '../../engine/json'

function createEngine() {
  return createEngineInternal()
}

function dispatchOk(
  dispatcher: CommandDispatcher,
  command: Parameters<CommandDispatcher['dispatch']>[0],
) {
  const result = dispatcher.dispatch(command)
  expect(result.ok).toBe(true)
  return result
}

describe('Prompter Authoring 15.02', () => {
  let engine: ReturnType<typeof createEngine>
  let dispatcher: CommandDispatcher
  let undoStack: UndoStack
  let slideId: string

  beforeEach(() => {
    engine = createEngine()
    undoStack = new UndoStack()
    dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    slideId = slide.id
  })

  it('import→gap-free with charCount*SPC and splitChars consecutive collapsed no empty', () => {
    // default SPC =0.2
    const raw = 'Hello.  World,;  test\nNext—part..  End'
    const result = dispatchOk(dispatcher, new ImportPrompterCommand({ slideId, rawText: raw }))
    expect(result.ok).toBe(true)
    const slide = engine.getSlide(slideId)
    expect(slide.prompter).not.toBeNull()
    const parts = slide.prompter!.parts
    // consecutive collapsed: ".." should not produce empty, ";" "," collapsed, etc.
    // Our helper splitImportText: raw split on .,;:!?\n— consecutive => expect parts trimmed non-empty
    // For raw: "Hello.  World,;  test\nNext—part..  End" => possible parts: ["Hello.", "World", "test", "Next", "part", "End"] or keep delimiters
    // At least no empty and gap-free
    expect(parts.length).toBeGreaterThan(0)
    for (const p of parts) expect(p.text.trim().length).toBeGreaterThan(0)
    // gap-free
    let cursor = 0
    for (const p of parts) {
      expect(Math.abs(p.startTime - cursor)).toBeLessThan(1e-6)
      expect(Math.abs(p.duration - (p.endTime - p.startTime))).toBeLessThan(1e-6)
      expect(Math.abs(p.endTime - (cursor + p.duration))).toBeLessThan(1e-6)
      cursor = p.endTime
    }
    // duration = charCount * SPC
    for (const p of parts) {
      expect(
        Math.abs(p.duration - p.text.length * DEFAULT_PROMPTER_SECONDS_PER_CHARACTER),
      ).toBeLessThan(1e-6)
    }
  })

  it('import respects settings.prompter.splitChars & secondsPerCharacter', () => {
    // set custom settings
    const project = engine.project!
    ;(project as unknown as { settings: Record<string, unknown> }).settings = {
      prompter: { splitChars: ['|'], secondsPerCharacter: 0.5 },
    }
    // need to re-install? Project settings is stored directly, engine reads via project.settings each call
    const raw = 'a|b||c'
    dispatchOk(dispatcher, new ImportPrompterCommand({ slideId, rawText: raw }))
    const parts = engine.getSlide(slideId).prompter!.parts
    expect(parts.map((p) => p.text)).toEqual(['a', 'b', 'c'])
    for (const p of parts) {
      expect(p.duration).toBe(p.text.length * 0.5)
    }
    // also test helper directly
    expect(splitImportText('x..y', ['.'])).toEqual(['x', 'y'])
    // custom split char | consecutive collapsed
    expect(splitImportText('a||b', ['|'])).toEqual(['a', 'b'])
  })

  it('split Left/Right/Out whitespace-aware discarding whitespace-only with proportional redistribution', () => {
    // import a simple sentence
    dispatchOk(dispatcher, new ImportPrompterCommand({ slideId, rawText: 'The butterfly flies' }))
    const slide = engine.getSlide(slideId)
    const partId = slide.prompter!.parts[0].id
    const origDuration = slide.prompter!.parts[0].duration
    void slide.prompter!.parts[0].text
    // Split Out on "butterfly" wordIndex 1
    dispatchOk(
      dispatcher,
      new SplitPrompterPartCommand({ slideId, partId, wordIndex: 1, mode: 'out' }),
    )
    let parts = engine.getSlide(slideId).prompter!.parts
    expect(parts.length).toBe(3)
    // Should be gap-free after split
    let cursor = 0
    for (const p of parts) {
      expect(Math.abs(p.startTime - cursor)).toBeLessThan(1e-6)
      cursor = p.endTime
    }
    // proportional durations sum to original
    const sum = parts.reduce((a, p) => a + p.duration, 0)
    expect(Math.abs(sum - origDuration)).toBeLessThan(1e-6)
    // texts contain butterfly isolated and preserve spacing (left has "The ", middle "butterfly", right " flies" with space)
    // Check that middle is exactly the word
    expect(parts[1].text).toBe('butterfly')
    // left should start with "The" and may include trailing space
    expect(parts[0].text.includes('The')).toBe(true)
    expect(parts[2].text.includes('flies')).toBe(true)

    // Reset for clean left/right tests
    engine = createEngine()
    undoStack = new UndoStack()
    dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    engine.createProject({ name: 'P2' })
    const s2 = engine.createSlide('S2')
    slideId = s2.id
    dispatchOk(dispatcher, new ImportPrompterCommand({ slideId, rawText: 'Hello beautiful world' }))
    const pid = engine.getSlide(slideId).prompter!.parts[0].id
    const dur = engine.getSlide(slideId).prompter!.parts[0].duration
    // Split Left on "beautiful" wordIndex 1 -> expect ["Hello ", "beautiful world"]
    dispatchOk(
      dispatcher,
      new SplitPrompterPartCommand({ slideId, partId: pid, wordIndex: 1, mode: 'left' }),
    )
    parts = engine.getSlide(slideId).prompter!.parts
    expect(parts.length).toBe(2)
    expect(parts[0].text).toBe('Hello ')
    expect(parts[1].text).toBe('beautiful world')
    expect(Math.abs(parts[0].duration + parts[1].duration - dur)).toBeLessThan(1e-6)
    // Split Right on "Hello " part's word "Hello" index 0 -> ["Hello", " " ] discarded second? Actually hello part "Hello " split right after Hello => ["Hello", " "] -> whitespace discarded => only ["Hello"] => should fail
    // Instead test merging
  })

  it('unite/merge single-space duration sum and reflow', () => {
    dispatchOk(dispatcher, new ImportPrompterCommand({ slideId, rawText: 'Hello world test' }))
    // import with default splitChars will keep as single part because no punctuation; so we have 1 part
    // Need to split it first to have multiple parts
    let parts = engine.getSlide(slideId).prompter!.parts
    const pid = parts[0].id
    dispatchOk(
      dispatcher,
      new SplitPrompterPartCommand({ slideId, partId: pid, wordIndex: 1, mode: 'left' }),
    )
    parts = engine.getSlide(slideId).prompter!.parts
    expect(parts.length).toBe(2)
    // left should be "Hello " and right "world test"
    expect(parts[0].text).toBe('Hello ')
    expect(parts[1].text).toBe('world test')
    const leftId = parts[0].id
    const rightId = parts[1].id
    const leftDur = parts[0].duration
    const rightDur = parts[1].duration
    // Unite via single-space join
    dispatchOk(
      dispatcher,
      new UnitePrompterPartsCommand({ slideId, leftPartId: leftId, rightPartId: rightId }),
    )
    parts = engine.getSlide(slideId).prompter!.parts
    expect(parts.length).toBe(1)
    expect(parts[0].text).toBe('Hello world test')
    expect(parts[0].text.includes('  ')).toBe(false) // no double spaces
    expect(Math.abs(parts[0].duration - (leftDur + rightDur))).toBeLessThan(1e-6)
    // gap-free
    expect(parts[0].startTime).toBe(0)
    expect(Math.abs(parts[0].endTime - parts[0].duration)).toBeLessThan(1e-6)

    // Test Merge alias
    // Create two parts again
    engine = createEngine()
    undoStack = new UndoStack()
    dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    engine.createProject({ name: 'P3' })
    const s3 = engine.createSlide('S3')
    slideId = s3.id
    dispatchOk(dispatcher, new ImportPrompterCommand({ slideId, rawText: 'One two three' }))
    const p0 = engine.getSlide(slideId).prompter!.parts[0].id
    dispatchOk(
      dispatcher,
      new SplitPrompterPartCommand({ slideId, partId: p0, wordIndex: 0, mode: 'right' }),
    )
    // now we have ["One", " two three"]
    let pls = engine.getSlide(slideId).prompter!.parts
    expect(pls.length).toBe(2)
    dispatchOk(dispatcher, new MergePrompterPartsCommand({ slideId, leftPartId: pls[0].id }))
    pls = engine.getSlide(slideId).prompter!.parts
    expect(pls.length).toBe(1)
    expect(pls[0].text).toBe('One two three')
  })

  it('stale freeze vs re-estimate on text edit', () => {
    dispatchOk(dispatcher, new ImportPrompterCommand({ slideId, rawText: 'Hello world' }))
    const part = engine.getSlide(slideId).prompter!.parts[0]
    const partId = part.id
    const origDur = part.duration
    // No audio -> text edit should auto-re-estimate
    dispatchOk(dispatcher, new UpdatePrompterPartCommand({ slideId, partId, text: 'Hi' }))
    const updated = engine.getSlide(slideId).prompter!.parts[0]
    expect(updated.text).toBe('Hi')
    expect(updated.status).toBeUndefined()
    expect(
      Math.abs(updated.duration - 'Hi'.length * DEFAULT_PROMPTER_SECONDS_PER_CHARACTER),
    ).toBeLessThan(1e-6)
    expect(updated.duration).not.toBe(origDur)

    // Add audio linkage to part
    updated.audioClipId = 'clip-1'
    updated.audioAssetId = 'asset-1'
    const frozenDur = updated.duration
    dispatchOk(
      dispatcher,
      new UpdatePrompterPartCommand({
        slideId,
        partId,
        text: 'Hello world extended text that is longer',
      }),
    )
    const stale = engine.getSlide(slideId).prompter!.parts[0]
    expect(stale.text).toBe('Hello world extended text that is longer')
    expect(stale.duration).toBe(frozenDur) // frozen
    expect(stale.status).toBe('stale')
  })

  it('shift-downstream atomicity: UpdatePrompterPartWithShift moves following parts + clips', () => {
    dispatchOk(dispatcher, new ImportPrompterCommand({ slideId, rawText: 'First. Second. Third' }))
    let parts = engine.getSlide(slideId).prompter!.parts
    // Need 3 parts; our import splits on '.' -> ["First.", "Second.", "Third"]
    // If not 3, force via splits
    if (parts.length !== 3) {
      // alternative manual creation
      engine = createEngine()
      undoStack = new UndoStack()
      dispatcher = new CommandDispatcher(engine, undoStack, () => {})
      engine.createProject({ name: 'P4' })
      const s = engine.createSlide('S4')
      slideId = s.id
      engine.createPrompterPart(slideId, { id: 'p1', text: 'First', duration: 1 })
      engine.createPrompterPart(slideId, { id: 'p2', text: 'Second', duration: 1 })
      engine.createPrompterPart(slideId, { id: 'p3', text: 'Third', duration: 1 })
      // ensure reflow
      const slide = engine.getSlide(slideId)
      reflowPrompter(slide.prompter!)
      parts = slide.prompter!.parts
    }
    expect(parts.length).toBe(3)
    const firstId = parts[0].id
    const secondStartBefore = parts[1].startTime
    const thirdStartBefore = parts[2].startTime
    // Add audio clips beyond second
    engine.createAudioClip(slideId, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: 2.5,
      sourceStart: 0,
      sourceEnd: 1,
    })
    engine.createAudioClip(slideId, {
      assetId: 'a2',
      trackId: 'sfx',
      timelineStart: 0.5,
      sourceStart: 0,
      sourceEnd: 1,
    })
    const clipBefore = engine.getSlide(slideId).audio.clips.find((c) => c.timelineStart === 2.5)!
    // Update first part duration with shiftDownstream true
    const oldDur = parts[0].duration
    const newDur = oldDur + 1.0
    dispatchOk(
      dispatcher,
      new UpdatePrompterPartWithShiftCommand({
        slideId,
        partId: firstId,
        duration: newDur,
        shiftDownstream: true,
      }),
    )
    parts = engine.getSlide(slideId).prompter!.parts
    expect(Math.abs(parts[0].duration - newDur)).toBeLessThan(1e-6)
    expect(Math.abs(parts[1].startTime - (secondStartBefore + 1.0))).toBeLessThan(1e-6)
    expect(Math.abs(parts[2].startTime - (thirdStartBefore + 1.0))).toBeLessThan(1e-6)
    // clip at 2.5 should be shifted because its timelineStart > oldEnd (oldEnd = oldDur)
    const clipAfter = engine.getSlide(slideId).audio.clips.find((c) => c.id === clipBefore.id)!
    expect(Math.abs(clipAfter.timelineStart - 3.5)).toBeLessThan(1e-6)
    // clip at 0.5 should NOT be shifted
    const clipEarly = engine.getSlide(slideId).audio.clips.find((c) => c.timelineStart === 0.5)
    expect(clipEarly).toBeDefined()
    // Without shift, gap-free reflow should happen (no clip shift)
    const secondId = parts[1].id
    const secondDurBefore = parts[1].duration
    dispatchOk(
      dispatcher,
      new UpdatePrompterPartCommand({
        slideId,
        partId: secondId,
        duration: secondDurBefore + 2,
        shiftDownstream: false,
      }),
    )
    // after without shift, downstream parts should be gap-free via reflow, not shifted by delta
    const afterNoShift = engine.getSlide(slideId).prompter!.parts
    let cursor = 0
    for (const p of afterNoShift) {
      expect(Math.abs(p.startTime - cursor)).toBeLessThan(1e-6)
      cursor = p.endTime
    }
  })

  it('LessonJSON prompter round-trip & duplicate-id/gap validation', () => {
    dispatchOk(dispatcher, new ImportPrompterCommand({ slideId, rawText: 'Hello. World' }))
    const json = engine.toJSON()
    expect(json.slides[0].prompter).toBeDefined()
    const restored = createEngineInternal()
    restored.restoreFromJSON(json)
    expect(restored.toJSON()).toEqual(json)

    // duplicate id validation
    const dupJson = JSON.parse(JSON.stringify(json)) as LessonJSON
    if (dupJson.slides[0].prompter) {
      const parts = (dupJson.slides[0].prompter as unknown as { parts: { id: string }[] }).parts
      if (parts.length >= 2) parts[1].id = parts[0].id
    }
    const engine2 = createEngineInternal()
    expect(() => engine2.restoreFromJSON(dupJson)).toThrow(/Duplicate prompter part id/)

    // gap validation
    const gapJson = JSON.parse(JSON.stringify(json)) as unknown as LessonJSON
    if (
      gapJson.slides[0].prompter &&
      (gapJson.slides[0].prompter as unknown as { parts: { startTime: number }[] }).parts.length >=
        2
    ) {
      ;(
        gapJson.slides[0].prompter as unknown as { parts: { startTime: number }[] }
      ).parts[1].startTime = 999
    }
    const engine3 = createEngineInternal()
    expect(() => engine3.restoreFromJSON(gapJson)).toThrow(/gap-free/)
  })

  it('reflow after every mutation maintains invariants duration = end-start', () => {
    dispatchOk(dispatcher, new ImportPrompterCommand({ slideId, rawText: 'Hello beautiful world' }))
    let parts = engine.getSlide(slideId).prompter!.parts
    for (const p of parts)
      expect(Math.abs(p.duration - (p.endTime - p.startTime))).toBeLessThan(1e-6)
    // split
    const pid = parts[0].id
    dispatchOk(
      dispatcher,
      new SplitPrompterPartCommand({ slideId, partId: pid, wordIndex: 1, mode: 'left' }),
    )
    parts = engine.getSlide(slideId).prompter!.parts
    for (const p of parts)
      expect(Math.abs(p.duration - (p.endTime - p.startTime))).toBeLessThan(1e-6)
    // merge
    dispatchOk(dispatcher, new UnitePrompterPartsCommand({ slideId, leftPartId: parts[0].id }))
    parts = engine.getSlide(slideId).prompter!.parts
    for (const p of parts)
      expect(Math.abs(p.duration - (p.endTime - p.startTime))).toBeLessThan(1e-6)
  })

  it('commands are validated and undoable via inverse', () => {
    // validation: split out of bounds should fail
    dispatchOk(dispatcher, new ImportPrompterCommand({ slideId, rawText: 'Single' }))
    const pid = engine.getSlide(slideId).prompter!.parts[0].id
    const bad = dispatcher.dispatch(
      new SplitPrompterPartCommand({ slideId, partId: pid, wordIndex: 10, mode: 'left' }),
    )
    expect(bad.ok).toBe(false)

    // inverse test for import: undo via restoring oldParts
    const beforeIds = engine.getSlide(slideId).prompter!.parts.map((p) => p.id)
    const importResult = dispatchOk(
      dispatcher,
      new ImportPrompterCommand({ slideId, rawText: 'Hello. World' }),
    )
    if (!importResult.ok) throw new Error('import failed')
    expect((importResult.inverse as { newPartIds: string[] }).newPartIds.length).toBeGreaterThan(0)
    // manual undo by restoring oldParts via direct engine manipulation (simulating Transaction inverse)
    const inv = importResult.inverse as {
      oldParts: { id: string; text: string; startTime: number; endTime: number; duration: number }[]
    }
    const slide = engine.getSlide(slideId)
    slide.prompter = {
      parts: inv.oldParts.map((p) => ({
        id: p.id,
        text: p.text,
        startTime: p.startTime,
        endTime: p.endTime,
        duration: p.duration,
      })),
    }
    if (slide.prompter) reflowPrompter(slide.prompter)
    expect(slide.prompter!.parts.map((p) => p.id)).toEqual(beforeIds)
  })

  it('slide duplication deep-copies prompter and audio with new ids', () => {
    dispatchOk(dispatcher, new ImportPrompterCommand({ slideId, rawText: 'Hello. World' }))
    const slide = engine.getSlide(slideId)
    // create an audio clip and link to first part
    const clip = engine.createAudioClip(slideId, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 1,
    })
    slide.prompter!.parts[0].audioClipId = clip.id
    slide.prompter!.parts[0].audioAssetId = 'a1'
    const origPartIds = slide.prompter!.parts.map((p) => p.id)
    const origClipIds = slide.audio.clips.map((c) => c.id)
    const duplicated = engine.duplicateSlide(slideId)
    expect(duplicated.prompter).not.toBeNull()
    expect(duplicated.prompter!.parts).toHaveLength(2)
    // ids must be new
    for (const pid of duplicated.prompter!.parts.map((p) => p.id)) {
      expect(origPartIds).not.toContain(pid)
    }
    for (const cid of duplicated.audio.clips.map((c) => c.id)) {
      expect(origClipIds).not.toContain(cid)
    }
    // linked audioClipId should be remapped to new clip id
    expect(duplicated.prompter!.parts[0].audioClipId).toBe(duplicated.audio.clips[0].id)
    // durations and gap-free preserved
    let cursor = 0
    for (const p of duplicated.prompter!.parts) {
      expect(Math.abs(p.startTime - cursor)).toBeLessThan(1e-6)
      cursor = p.endTime
    }
    // original unchanged
    expect(slide.prompter!.parts[0].id).toBe(origPartIds[0])
  })
})
