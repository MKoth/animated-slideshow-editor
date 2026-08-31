import { describe, expect, it, beforeEach } from 'vitest'
import { useAudioClipSelectionStore } from '../stores/audioClipSelectionStore'
import { useAudioPlaybackStore } from '../stores/audioPlaybackStore'
import { createEngineInternal } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import {
  MoveAudioClipCommand,
  CreateAudioClipCommand,
  DeleteAudioClipCommand,
} from '../engine/commands'
import { serialize, deserialize } from '../engine/lessonSerializer'
import { audioNudgeDelta } from '../components/panels/AudioTimelineBody'
import { pixelsPerSecond, rulerTickStep } from '../stores/timelineViewStore'

function resetSelectionStore() {
  useAudioClipSelectionStore.setState({
    selectedClipIds: new Set<string>(),
    activeClipId: null,
    marquee: null,
    soloMuted: new Set<string>(),
  })
}
function resetPlaybackStore() {
  useAudioPlaybackStore.setState({
    isAuditioning: false,
    auditionClipId: null,
    mutedTracks: new Set(),
    soloTracks: new Set(),
  })
}

describe('Spec 15.05 — Selection, Keyboard & Lane Mute/Solo Preview', () => {
  beforeEach(() => {
    resetSelectionStore()
    resetPlaybackStore()
  })

  it('audioClipSelectionStore separate from timelineSelectionStore: toggle/select/range/marquee', () => {
    const store = useAudioClipSelectionStore.getState()
    // single select
    store.select('a')
    expect(useAudioClipSelectionStore.getState().selectedClipIds.has('a')).toBe(true)
    expect(useAudioClipSelectionStore.getState().activeClipId).toBe('a')
    // toggle adds
    store.toggle('b')
    expect(useAudioClipSelectionStore.getState().selectedClipIds.has('b')).toBe(true)
    expect(useAudioClipSelectionStore.getState().selectedClipIds.size).toBe(2)
    // toggle removes
    store.toggle('a')
    expect(useAudioClipSelectionStore.getState().selectedClipIds.has('a')).toBe(false)
    expect(useAudioClipSelectionStore.getState().selectedClipIds.has('b')).toBe(true)
    // clear
    store.select('x')
    store.clear()
    expect(useAudioClipSelectionStore.getState().selectedClipIds.size).toBe(0)
    expect(useAudioClipSelectionStore.getState().activeClipId).toBeNull()

    // range: ordered [a,b,c,d], active a -> selectRange c should select a,b,c
    store.select('a')
    store.selectRange('c', ['a', 'b', 'c', 'd'])
    const sel = useAudioClipSelectionStore.getState().selectedClipIds
    expect(sel.has('a')).toBe(true)
    expect(sel.has('b')).toBe(true)
    expect(sel.has('c')).toBe(true)
    expect(sel.has('d')).toBe(false)

    // shift range reverse: active still a, range to b -> a,b
    store.clear()
    store.select('c')
    store.selectRange('a', ['a', 'b', 'c', 'd'])
    const sel2 = useAudioClipSelectionStore.getState().selectedClipIds
    expect(sel2.has('a')).toBe(true)
    expect(sel2.has('b')).toBe(true)
    expect(sel2.has('c')).toBe(true)

    // marquee
    store.clear()
    store.marqueeStart(0, 0)
    expect(useAudioClipSelectionStore.getState().marquee).not.toBeNull()
    store.marqueeUpdate(10, 10)
    expect(useAudioClipSelectionStore.getState().marquee?.width).toBe(10)
    store.marqueeEnd(['b', 'c'])
    const mSel = useAudioClipSelectionStore.getState().selectedClipIds
    expect(mSel.has('b')).toBe(true)
    expect(mSel.has('c')).toBe(true)
    expect(useAudioClipSelectionStore.getState().marquee).toBeNull()
    // empty marquee clears marquee but not selection? Our impl clears marquee only
    store.marqueeStart(5, 5)
    store.marqueeEnd([])
    expect(useAudioClipSelectionStore.getState().marquee).toBeNull()
  })

  it('keyboard nudges time math: arrows nudge by rulerTickStep, Shift 10x, Home/End, Delete, Ctrl+D at +0.5s', () => {
    // rulerTickStep math
    const pps = pixelsPerSecond(1) // 100
    const step = rulerTickStep(pps) // should be 0.5? Let's compute: candidates [0.05,0.1,0.2,0.5...] 0.5*100=50>=40 => step 0.5
    expect(step).toBe(0.5)
    expect(audioNudgeDelta(step, false)).toBe(0.5)
    expect(audioNudgeDelta(step, true)).toBe(5) // 10x

    const pps2 = pixelsPerSecond(2) // 200 => 0.2*200=40 => step 0.2
    expect(rulerTickStep(pps2)).toBe(0.2)
    expect(audioNudgeDelta(0.2, true)).toBe(2)

    // Home/End and nudge dispatch math via engine
    const engine = createEngineInternal()
    const undo = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undo, () => {})
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'N')
    // create clips
    const c1 = engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: 1,
      sourceStart: 0,
      sourceEnd: 1,
    })
    const c2 = engine.createAudioClip(slide.id, {
      assetId: 'a2',
      trackId: 'sfx',
      timelineStart: 2,
      sourceStart: 0,
      sourceEnd: 1,
    })
    // ArrowRight nudge by step
    dispatcher.dispatch(
      new MoveAudioClipCommand({
        slideId: slide.id,
        clipId: c1.id,
        timelineStart: c1.timelineStart + step,
      }),
    )
    expect(
      engine.getSlide(slide.id).audio.clips.find((c) => c.id === c1.id)!.timelineStart,
    ).toBeCloseTo(1.5, 6)
    // Shift+ Arrow 10x
    const shifted = step * 10
    dispatcher.dispatch(
      new MoveAudioClipCommand({
        slideId: slide.id,
        clipId: c2.id,
        timelineStart: c2.timelineStart + shifted,
      }),
    )
    expect(
      engine.getSlide(slide.id).audio.clips.find((c) => c.id === c2.id)!.timelineStart,
    ).toBeCloseTo(7, 6)
    // Home to 0
    dispatcher.dispatch(
      new MoveAudioClipCommand({ slideId: slide.id, clipId: c1.id, timelineStart: 0 }),
    )
    expect(engine.getSlide(slide.id).audio.clips.find((c) => c.id === c1.id)!.timelineStart).toBe(0)
    // End to duration - playbackDuration (duration default 10, playback 1 => 9)
    const dur = slide.duration // 10
    const targetEnd = dur - 1
    dispatcher.dispatch(
      new MoveAudioClipCommand({ slideId: slide.id, clipId: c1.id, timelineStart: targetEnd }),
    )
    expect(
      engine.getSlide(slide.id).audio.clips.find((c) => c.id === c1.id)!.timelineStart,
    ).toBeCloseTo(targetEnd, 6)
    // Delete removes
    const beforeCount = engine.getSlide(slide.id).audio.clips.length
    const delRes = dispatcher.dispatch(
      new DeleteAudioClipCommand({ slideId: slide.id, clipId: c2.id }),
    )
    expect(delRes.ok).toBe(true)
    expect(engine.getSlide(slide.id).audio.clips.length).toBe(beforeCount - 1)

    // Duplicate at +0.5 via engine.duplicateAudioClip
    const orig = engine.getSlide(slide.id).audio.clips[0]
    const dup = engine.duplicateAudioClip(slide.id, orig.id)
    expect(dup.timelineStart).toBeCloseTo(orig.timelineStart + 0.5, 6)
  })

  it('lane mute/solo preview Zustand-only, never in LessonJSON or undo', () => {
    // set mute/solo in playback store
    const pb = useAudioPlaybackStore.getState()
    pb.toggleMute('voice')
    pb.toggleSolo('music')
    expect(useAudioPlaybackStore.getState().mutedTracks.has('voice')).toBe(true)
    expect(useAudioPlaybackStore.getState().soloTracks.has('music')).toBe(true)

    // serialize/deserialize should not persist them
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.createNode(slide.scene.id, slide.scene.root.id, 'N')
    // need an audio asset for clip validation
    engine.embedAsset({
      id: 'a1',
      name: 'test.wav',
      data: 'data:audio/wav;base64,AAA=',
      mimeType: 'audio/wav',
      metadata: { duration: 1, sampleRate: 44100, channels: 1 },
    })
    engine.embedAsset({
      id: 'a2',
      name: 'test2.wav',
      data: 'data:audio/wav;base64,AAA=',
      mimeType: 'audio/wav',
      metadata: { duration: 1, sampleRate: 44100, channels: 1 },
    })
    engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: 0,
      sourceStart: 0,
      sourceEnd: 1,
    })
    const jsonStr = serialize(engine.project!)
    const parsed = JSON.parse(jsonStr)
    // LessonJSON should not have mutedTracks / soloTracks / selectedClipIds
    expect(JSON.stringify(parsed)).not.toContain('mutedTracks')
    expect(JSON.stringify(parsed)).not.toContain('soloTracks')
    expect(JSON.stringify(parsed)).not.toContain('selectedClipIds')
    // also audition not persisted
    expect(JSON.stringify(parsed)).not.toContain('audition')

    const restored = deserialize(jsonStr)
    void restored
    // after deserialize, playback store should still have previous mute/solo (not cleared by deserialize)
    // but restored project should not have mute/solo in its audio clips muted? clips muted is persisted per-clip muted boolean, but lane preview not.
    // Ensure per-clip muted still persisted, but lane preview not in JSON
    expect(useAudioPlaybackStore.getState().mutedTracks.has('voice')).toBe(true)
    // Now deserialize should not affect Zustand stores? We verify that after deserialize we still have lane mute
    // and that undo stack does not contain mute/solo
    const undo = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undo, () => {})
    // dispatch a clip create, undo entries should be 1, not include mute
    const res = dispatcher.dispatch(
      new CreateAudioClipCommand({
        slideId: slide.id,
        assetId: 'a2',
        trackId: 'sfx',
        timelineStart: 1,
        sourceEnd: 1,
      }),
    )
    expect(res.ok).toBe(true)
    expect(undo.entries.length).toBe(1)
    expect(undo.entries[0].type).toBe('CreateAudioClip')
    // toggling mute/solo should not add undo entry
    useAudioPlaybackStore.getState().toggleMute('sfx')
    expect(undo.entries.length).toBe(1)
    useAudioPlaybackStore.getState().toggleSolo('voice')
    expect(undo.entries.length).toBe(1)
    // selection also not in undo
    useAudioClipSelectionStore.getState().select('some-id')
    expect(undo.entries.length).toBe(1)
    expect(undo.entries[0].type).not.toBe('SelectAudioClip')
  })

  it('audioClipSelectionStore is separate from timelineSelectionStore', async () => {
    const { useTimelineSelectionStore } = await import('../stores/timelineSelectionStore')
    // modify audio selection
    useAudioClipSelectionStore.getState().select('clip-1')
    // timeline selection should be empty
    const tlSel = useTimelineSelectionStore.getState()
    expect(tlSel.selections[tlSel.editingContext].length).toBe(0)
    // modify timeline selection
    tlSel.selectKeyframe('kf-1', { time: 0, rowIndex: 0 })
    // audio selection should still have clip-1
    expect(useAudioClipSelectionStore.getState().selectedClipIds.has('clip-1')).toBe(true)
    // clear audio should not affect timeline
    useAudioClipSelectionStore.getState().clear()
    expect(
      useTimelineSelectionStore.getState().selections[
        useTimelineSelectionStore.getState().editingContext
      ].length,
    ).toBe(1)
    // cleanup
    useTimelineSelectionStore.getState().clearSelection()
  })
})
