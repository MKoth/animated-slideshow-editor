import { describe, expect, it } from 'vitest'
import { createEngineInternal } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { MoveAudioClipCommand, MovePrompterPartCommand } from '../engine/commands'

function setup() {
  const engine = createEngineInternal()
  const undo = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undo, () => {})
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  return { engine, undo, dispatcher, slide }
}

describe('handoff: bidirectional move sync + push', () => {
  it('audio move follows linked part (no push): part + sibling ride along', () => {
    const { engine, dispatcher, slide } = setup()
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'Hello', duration: 2 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'World', duration: 2 })
    const voice = engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 2,
    })
    engine.setPrompterPartAudio(slide.id, 'p1', voice.id, null)
    const res = dispatcher.dispatch(
      new MoveAudioClipCommand({ slideId: slide.id, clipId: voice.id, timelineStart: 5 }),
    )
    expect(res.ok).toBe(true)
    const s = engine.getSlide(slide.id)
    expect(s.prompter!.parts.find((p) => p.id === 'p1')!.startTime).toBeCloseTo(5, 6)
    // p2 untouched (no push, gap preserved even though p1 [5,7] overlaps p2 [2,4]? no overlap — ok)
    expect(s.prompter!.parts.find((p) => p.id === 'p2')!.startTime).toBeCloseTo(2, 6)
  })

  it('audio drag with push moves part and pushes downstream prompter + same-track audio', () => {
    const { engine, dispatcher, slide } = setup()
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'A', duration: 2 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'B', duration: 2 })
    // p1 [0,2], p2 [2,4]
    const voice = engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 2,
    })
    engine.setPrompterPartAudio(slide.id, 'p1', voice.id, null)
    const other = engine.createAudioClip(slide.id, {
      assetId: 'a2',
      trackId: 'voice',
      timelineStart: 5,
      sourceStart: 0,
      sourceEnd: 1,
    })
    // drag voice to 4.5 with push: part p1 follows to 4.5 [4.5,6.5], pushes p2 [2,4]-> stays? p2 [2,4] vs cursor 6.5? p2 sorted before p1 now.
    // After follow + sort: p2 [2,4], p1 [4.5,6.5]. No downstream overlap. Audio: voice [4.5,6.5], other [5,6] overlaps -> pushed to 6.5.
    const res = dispatcher.dispatch(
      new MoveAudioClipCommand({
        slideId: slide.id,
        clipId: voice.id,
        timelineStart: 4.5,
        push: true,
      }),
    )
    expect(res.ok).toBe(true)
    const s = engine.getSlide(slide.id)
    expect(s.prompter!.parts.find((p) => p.id === 'p1')!.startTime).toBeCloseTo(4.5, 6)
    const otherAfter = s.audio.clips.find((c) => c.id === other.id)!
    expect(otherAfter.timelineStart).toBeCloseTo(6.5, 6)
  })

  it('prompter drag with push shifts downstream parts and their clips, gaps preserved', () => {
    const { engine, dispatcher, slide } = setup()
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'A', duration: 2 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'B', duration: 2 })
    engine.createPrompterPart(slide.id, { id: 'p3', text: 'C', duration: 2 })
    // p1 [0,2], p2 [2,4], p3 [4,6]
    const c2 = engine.createAudioClip(slide.id, {
      assetId: 'a2',
      trackId: 'voice',
      timelineStart: 2,
      sourceStart: 0,
      sourceEnd: 2,
    })
    engine.setPrompterPartAudio(slide.id, 'p2', c2.id, null)
    const res = dispatcher.dispatch(
      new MovePrompterPartCommand({ slideId: slide.id, partId: 'p1', newStartTime: 1, push: true }),
    )
    expect(res.ok).toBe(true)
    const s = engine.getSlide(slide.id)
    const p1 = s.prompter!.parts.find((p) => p.id === 'p1')!
    const p2 = s.prompter!.parts.find((p) => p.id === 'p2')!
    const p3 = s.prompter!.parts.find((p) => p.id === 'p3')!
    expect(p1.startTime).toBeCloseTo(1, 6)
    expect(p2.startTime).toBeCloseTo(3, 6) // pushed from 2 to 3
    expect(p3.startTime).toBeCloseTo(5, 6) // cascaded from 4 to 5
    // p2's clip rode along
    expect(s.audio.clips.find((c) => c.id === c2.id)!.timelineStart).toBeCloseTo(3, 6)
    // no overlaps
    const sorted = [...s.prompter!.parts].sort((a, b) => a.startTime - b.startTime)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.startTime).toBeGreaterThanOrEqual(sorted[i - 1]!.endTime - 1e-9)
    }
  })

  it('prompter drag without push preserves old behavior (overlap allowed live)', () => {
    const { engine, dispatcher, slide } = setup()
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'A', duration: 2 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'B', duration: 2 })
    dispatcher.dispatch(
      new MovePrompterPartCommand({ slideId: slide.id, partId: 'p1', newStartTime: 1 }),
    )
    const s = engine.getSlide(slide.id)
    expect(s.prompter!.parts.find((p) => p.id === 'p1')!.startTime).toBeCloseTo(1, 6)
    expect(s.prompter!.parts.find((p) => p.id === 'p2')!.startTime).toBeCloseTo(2, 6)
  })

  it('audio push is same-track only', () => {
    const { engine, dispatcher, slide } = setup()
    const v1 = engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 2,
    })
    const v2 = engine.createAudioClip(slide.id, {
      assetId: 'a2',
      trackId: 'voice',
      timelineStart: 3,
      sourceStart: 0,
      sourceEnd: 2,
    })
    const m1 = engine.createAudioClip(slide.id, {
      assetId: 'a3',
      trackId: 'music',
      timelineStart: 1,
      sourceStart: 0,
      sourceEnd: 2,
    })
    dispatcher.dispatch(
      new MoveAudioClipCommand({ slideId: slide.id, clipId: v1.id, timelineStart: 2, push: true }),
    )
    const s = engine.getSlide(slide.id)
    // v1 [2,4] overlaps v2 [3,5] -> v2 pushed to 4
    expect(s.audio.clips.find((c) => c.id === v2.id)!.timelineStart).toBeCloseTo(4, 6)
    // music untouched
    expect(s.audio.clips.find((c) => c.id === m1.id)!.timelineStart).toBeCloseTo(1, 6)
  })

  it('undo restores pushed chain for prompter move', () => {
    const { engine, dispatcher, undo, slide } = setup()
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'A', duration: 2 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'B', duration: 2 })
    dispatcher.dispatch(
      new MovePrompterPartCommand({ slideId: slide.id, partId: 'p1', newStartTime: 1, push: true }),
    )
    expect(
      engine.getSlide(slide.id).prompter!.parts.find((p) => p.id === 'p2')!.startTime,
    ).toBeCloseTo(3, 6)
    undo.undo(engine)
    const s = engine.getSlide(slide.id)
    expect(s.prompter!.parts.find((p) => p.id === 'p1')!.startTime).toBeCloseTo(0, 6)
    expect(s.prompter!.parts.find((p) => p.id === 'p2')!.startTime).toBeCloseTo(2, 6)
  })

  it('undo restores audio follow + push', () => {
    const { engine, dispatcher, undo, slide } = setup()
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'A', duration: 2 })
    const voice = engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 2,
    })
    engine.setPrompterPartAudio(slide.id, 'p1', voice.id, null)
    const other = engine.createAudioClip(slide.id, {
      assetId: 'a2',
      trackId: 'voice',
      timelineStart: 5,
      sourceStart: 0,
      sourceEnd: 1,
    })
    dispatcher.dispatch(
      new MoveAudioClipCommand({
        slideId: slide.id,
        clipId: voice.id,
        timelineStart: 4.5,
        push: true,
      }),
    )
    undo.undo(engine)
    const s = engine.getSlide(slide.id)
    expect(s.audio.clips.find((c) => c.id === voice.id)!.timelineStart).toBeCloseTo(0, 6)
    expect(s.prompter!.parts.find((p) => p.id === 'p1')!.startTime).toBeCloseTo(0, 6)
    expect(s.audio.clips.find((c) => c.id === other.id)!.timelineStart).toBeCloseTo(5, 6)
  })
})
