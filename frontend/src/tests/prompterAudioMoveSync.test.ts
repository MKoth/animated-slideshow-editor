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

describe('audio clip movement is independent', () => {
  it('audio move can overlap another clip without moving it', () => {
    const { engine, dispatcher, slide } = setup()
    const moving = engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 2,
    })
    const stationary = engine.createAudioClip(slide.id, {
      assetId: 'a2',
      trackId: 'voice',
      timelineStart: 3,
      sourceStart: 0,
      sourceEnd: 2,
    })

    const res = dispatcher.dispatch(
      new MoveAudioClipCommand({ slideId: slide.id, clipId: moving.id, timelineStart: 4 }),
    )

    expect(res.ok).toBe(true)
    expect(
      engine.getSlide(slide.id).audio.clips.find((c) => c.id === moving.id)!.timelineStart,
    ).toBe(4)
    expect(
      engine.getSlide(slide.id).audio.clips.find((c) => c.id === stationary.id)!.timelineStart,
    ).toBe(3)
  })

  it('does not move linked prompter parts or unrelated overlapping audio', () => {
    const { engine, dispatcher, slide } = setup()
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'A', duration: 2 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'B', duration: 2 })
    const linked = engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 2,
    })
    engine.setPrompterPartAudio(slide.id, 'p1', linked.id, null)
    const unrelated = engine.createAudioClip(slide.id, {
      assetId: 'a2',
      trackId: 'voice',
      timelineStart: 2.5,
      sourceStart: 0,
      sourceEnd: 1,
    })

    const res = dispatcher.dispatch(
      new MoveAudioClipCommand({
        slideId: slide.id,
        clipId: linked.id,
        timelineStart: 1,
      }),
    )

    expect(res.ok).toBe(true)
    const updated = engine.getSlide(slide.id)
    const linkedPart = updated.prompter!.parts.find((p) => p.id === 'p1')!
    expect(linkedPart.startTime).toBe(1)
    expect(linkedPart.endTime).toBe(3)
    expect(updated.prompter!.parts.find((p) => p.id === 'p2')!.startTime).toBe(2)
    expect(updated.audio.clips.find((c) => c.id === unrelated.id)!.timelineStart).toBe(2.5)
  })

  it('prompter drag overlaps without shifting downstream parts or audio', () => {
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
      new MovePrompterPartCommand({ slideId: slide.id, partId: 'p1', newStartTime: 1 }),
    )
    expect(res.ok).toBe(true)
    const s = engine.getSlide(slide.id)
    const p1 = s.prompter!.parts.find((p) => p.id === 'p1')!
    const p2 = s.prompter!.parts.find((p) => p.id === 'p2')!
    const p3 = s.prompter!.parts.find((p) => p.id === 'p3')!
    expect(p1.startTime).toBeCloseTo(1, 6)
    expect(p2.startTime).toBeCloseTo(2, 6)
    expect(p3.startTime).toBeCloseTo(4, 6)
    expect(s.audio.clips.find((c) => c.id === c2.id)!.timelineStart).toBeCloseTo(2, 6)
  })

  it('prompter drag without push preserves old behavior (overlap allowed live)', () => {
    const { engine, dispatcher, slide } = setup()
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'A', duration: 2 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'B', duration: 2 })
    const linked = engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 2,
    })
    engine.setPrompterPartAudio(slide.id, 'p1', linked.id, null)
    const unrelated = engine.createAudioClip(slide.id, {
      assetId: 'a2',
      trackId: 'voice',
      timelineStart: 2.5,
      sourceStart: 0,
      sourceEnd: 1,
    })
    dispatcher.dispatch(
      new MovePrompterPartCommand({ slideId: slide.id, partId: 'p1', newStartTime: 1 }),
    )
    const s = engine.getSlide(slide.id)
    expect(s.prompter!.parts.find((p) => p.id === 'p1')!.startTime).toBeCloseTo(1, 6)
    expect(s.prompter!.parts.find((p) => p.id === 'p2')!.startTime).toBeCloseTo(2, 6)
    expect(s.audio.clips.find((c) => c.id === linked.id)!.timelineStart).toBe(1)
    expect(s.audio.clips.find((c) => c.id === unrelated.id)!.timelineStart).toBe(2.5)
  })

  it('undo restores only the moved prompter part', () => {
    const { engine, dispatcher, undo, slide } = setup()
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'A', duration: 2 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'B', duration: 2 })
    dispatcher.dispatch(
      new MovePrompterPartCommand({ slideId: slide.id, partId: 'p1', newStartTime: 1 }),
    )
    expect(
      engine.getSlide(slide.id).prompter!.parts.find((p) => p.id === 'p2')!.startTime,
    ).toBeCloseTo(2, 6)
    undo.undo(engine)
    const s = engine.getSlide(slide.id)
    expect(s.prompter!.parts.find((p) => p.id === 'p1')!.startTime).toBeCloseTo(0, 6)
    expect(s.prompter!.parts.find((p) => p.id === 'p2')!.startTime).toBeCloseTo(2, 6)
  })

  it('undo restores only the moved audio clip', () => {
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
      }),
    )
    undo.undo(engine)
    const s = engine.getSlide(slide.id)
    expect(s.audio.clips.find((c) => c.id === voice.id)!.timelineStart).toBeCloseTo(0, 6)
    expect(s.prompter!.parts.find((p) => p.id === 'p1')!.startTime).toBeCloseTo(0, 6)
    expect(s.audio.clips.find((c) => c.id === other.id)!.timelineStart).toBeCloseTo(5, 6)
  })
})
