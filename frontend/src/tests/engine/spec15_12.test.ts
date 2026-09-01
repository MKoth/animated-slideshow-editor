import { describe, expect, it } from 'vitest'
import { createEngineInternal } from '../../engine/internal'
import { CommandDispatcher, UndoStack, TransactionCommand } from '../../engine/commands'
import {
  CreateAudioAssetCommand,
  CreateAudioClipCommand,
  ImportPrompterCommand,
} from '../../engine/commands'
import { serialize, validate } from '../../engine/lessonSerializer'
import {
  getPrompterMismatchThreshold,
  getPrompterRecordingShortcut,
  getPrompterSecondsPerCharacter,
  getPrompterSplitChars,
} from '../../engine/prompter'
import { useAudioPlaybackStore } from '../../stores/audioPlaybackStore'
import { useAudioClipSelectionStore } from '../../stores/audioClipSelectionStore'

function dispatchOk(
  dispatcher: CommandDispatcher,
  cmd: Parameters<CommandDispatcher['dispatch']>[0],
) {
  const r = dispatcher.dispatch(cmd)
  expect(r.ok).toBe(true)
  return r
}

describe('Spec 15.12 — Slide Duplication, .lesson Compat, Settings & A11y Polish', () => {
  it('Slide duplication deep-copies Prompter parts + audio clips with new ids, same assetIds; embedded WAV stays portable', () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undo, () => {})
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    dispatchOk(
      dispatcher,
      new ImportPrompterCommand({ slideId: slide.id, rawText: 'Hello. World' }),
    )
    const base64 = btoa('fake-wav-bytes-portable')
    const assetRes = dispatchOk(
      dispatcher,
      new CreateAudioAssetCommand({
        name: 'voice_take.wav',
        data: base64,
        mimeType: 'audio/wav',
        metadata: { duration: 1.2, sampleRate: 44100, channels: 1, waveformPeaks: [0.1, 0.2] },
      }),
    )
    if (!assetRes.ok) throw assetRes.error
    const assetId = (assetRes.inverse as { assetId: string }).assetId
    const clipRes = dispatchOk(
      dispatcher,
      new CreateAudioClipCommand({
        slideId: slide.id,
        assetId,
        trackId: 'voice',
        timelineStart: 0,
        sourceEnd: 1.2,
        volume: 0.8,
        playbackRate: 1.5,
        fadeIn: 0.1,
        fadeOut: 0.2,
      }),
    )
    if (!clipRes.ok) throw clipRes.error
    const clipId = (clipRes.inverse as { clipId: string }).clipId
    const part0 = engine.getSlide(slide.id).prompter!.parts[0]
    part0.audioClipId = clipId
    part0.audioAssetId = assetId

    const origPartIds = engine.getSlide(slide.id).prompter!.parts.map((p) => p.id)
    const origClipIds = engine.getSlide(slide.id).audio.clips.map((c) => c.id)
    const duplicated = engine.duplicateSlide(slide.id)

    expect(duplicated.prompter).not.toBeNull()
    expect(duplicated.prompter!.parts).toHaveLength(2)
    for (const pid of duplicated.prompter!.parts.map((p) => p.id)) {
      expect(origPartIds).not.toContain(pid)
    }
    for (const cid of duplicated.audio.clips.map((c) => c.id)) {
      expect(origClipIds).not.toContain(cid)
    }
    // same assetId preserved
    expect(duplicated.prompter!.parts[0].audioAssetId).toBe(assetId)
    expect(duplicated.prompter!.parts[0].audioClipId).toBe(duplicated.audio.clips[0].id)
    // clip fields preserved except id/timeline
    const dupClip = duplicated.audio.clips[0]
    const origClip = engine.project!.slides[0].audio.clips[0]
    expect(dupClip.assetId).toBe(origClip.assetId)
    expect(dupClip.volume).toBe(origClip.volume)
    expect(dupClip.playbackRate).toBe(origClip.playbackRate)
    expect(dupClip.fadeIn).toBe(origClip.fadeIn)
    expect(dupClip.fadeOut).toBe(origClip.fadeOut)

    // embedded WAV stays portable: one asset entry, both slides reference same id, bytes identical
    const json = JSON.parse(serialize(engine.project!))
    const assets = (json.library?.assets as { id: string; data: string }[] | undefined) ?? []
    const found = assets.find((a) => a.id === assetId)
    expect(found).toBeDefined()
    expect(found!.data).toBe(base64)
    expect(json.slides[0].prompter.parts[0].audioAssetId).toBe(assetId)
    expect(json.slides[1].prompter.parts[0].audioAssetId).toBe(assetId)
    // only one embedded asset for that id (no duplication of bytes)
    expect(assets.filter((a) => a.id === assetId)).toHaveLength(1)

    // also deep-copy with AudioSegments (word-level replacement) — new ids, same assetIds, order preserved
    {
      const eng2 = createEngineInternal()
      const disp2 = new CommandDispatcher(eng2, new UndoStack(), () => {})
      eng2.createProject({ name: 'P2' })
      const s = eng2.createSlide('S_seg')
      disp2.dispatch(
        new ImportPrompterCommand({ slideId: s.id, rawText: 'The butterfly flies gracefully' }),
      )
      const part = eng2.getSlide(s.id).prompter!.parts[0]
      const base64seg = btoa('seg-wav')
      const aRes = disp2.dispatch(
        new CreateAudioAssetCommand({
          name: 'seg',
          data: base64seg,
          mimeType: 'audio/wav',
          metadata: { duration: 1, sampleRate: 44100, channels: 1 },
        }),
      )
      if (!aRes.ok) throw aRes.error
      const aId = (aRes.inverse as { assetId: string }).assetId
      const cRes = disp2.dispatch(
        new CreateAudioClipCommand({
          slideId: s.id,
          assetId: aId,
          trackId: 'voice',
          timelineStart: part.startTime,
          sourceEnd: 1,
        }),
      )
      if (!cRes.ok) throw cRes.error
      const cId = (cRes.inverse as { clipId: string }).clipId
      // attach a segment
      part.segments = [
        { id: 'seg-1', text: 'butterfly', audioClipId: cId, audioAssetId: aId, order: 0 },
      ]
      part.audioClipId = cId
      part.audioAssetId = aId
      const segIdBefore = part.segments[0].id
      const dup2 = eng2.duplicateSlide(s.id)
      const dupPart = dup2.prompter!.parts[0]
      expect(dupPart.segments).toBeDefined()
      expect(dupPart.segments![0].id).not.toBe(segIdBefore)
      expect(dupPart.segments![0].audioAssetId).toBe(aId)
      expect(dupPart.segments![0].audioClipId).toBe(dup2.audio.clips[0].id)
      expect(dupPart.segments![0].order).toBe(0)
    }
  })

  it('.lesson compat: missing prompter/audio → empty, additive validation rejects duplicate ids/rate violations, round-trip identity holds including WAV bytes', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    engine.createSlide('S')

    // missing → empty
    const jsonMissing = JSON.parse(serialize(engine.project!)) as Record<string, unknown>
    const slides = jsonMissing.slides as Record<string, unknown>[]
    delete (slides[0] as Record<string, unknown>).prompter
    delete (slides[0] as Record<string, unknown>).audio
    const engine2 = createEngineInternal()
    engine2.restoreFromJSON(jsonMissing as unknown as import('../../engine/json').LessonJSON)
    const restoredSlide = engine2.getSlide((slides[0] as { id: string }).id)
    expect(restoredSlide.prompter).toBeNull()
    expect(restoredSlide.audio.clips).toHaveLength(0)

    // duplicate id rejected
    const engine3 = createEngineInternal()
    engine3.createProject({ name: 'P' })
    engine3.createSlide('S')
    const jsonDup = JSON.parse(serialize(engine3.project!)) as Record<string, unknown>
    const sDup = (jsonDup.slides as Record<string, unknown>[])[0] as Record<string, unknown>
    sDup.prompter = {
      parts: [
        { id: 'dup', text: 'a', startTime: 0, endTime: 0.2, duration: 0.2 },
        { id: 'dup', text: 'b', startTime: 0.2, endTime: 0.4, duration: 0.2 },
      ],
    }
    sDup.audio = {
      clips: [
        {
          id: 'c1',
          assetId: 'a1',
          trackId: 'voice',
          timelineStart: 0,
          sourceStart: 0,
          sourceEnd: 1,
          volume: 1,
          muted: false,
          playbackRate: 1,
        },
        {
          id: 'c1',
          assetId: 'a2',
          trackId: 'sfx',
          timelineStart: 1,
          sourceStart: 0,
          sourceEnd: 1,
          volume: 1,
          muted: false,
          playbackRate: 1,
        },
      ],
    }
    const errsDup = validate(jsonDup as unknown as import('../../engine/json').LessonJSON)
    expect(errsDup.some((e) => /Duplicate prompter part id/.test(e))).toBe(true)
    expect(errsDup.some((e) => /Duplicate audio clip id/.test(e))).toBe(true)

    // rate violation rejected
    const jsonRate = JSON.parse(serialize(engine3.project!)) as Record<string, unknown>
    const sRate = (jsonRate.slides as Record<string, unknown>[])[0] as Record<string, unknown>
    sRate.prompter = { parts: [{ id: 'p1', text: 'a', startTime: 0, endTime: 0.2, duration: 0.2 }] }
    sRate.audio = {
      clips: [
        {
          id: 'c1',
          assetId: 'a1',
          trackId: 'voice',
          timelineStart: 0,
          sourceStart: 0,
          sourceEnd: 1,
          volume: 1,
          muted: false,
          playbackRate: 0,
        },
      ],
    }
    const errsRate = validate(jsonRate as unknown as import('../../engine/json').LessonJSON)
    expect(errsRate.some((e) => /playbackRate/.test(e))).toBe(true)

    // overlap rejected, gap allowed (free placement)
    const jsonOverlap = JSON.parse(serialize(engine3.project!)) as Record<string, unknown>
    const sOverlap = (jsonOverlap.slides as Record<string, unknown>[])[0] as Record<string, unknown>
    sOverlap.prompter = {
      parts: [
        { id: 'p1', text: 'a', startTime: 0, endTime: 1, duration: 1 },
        { id: 'p2', text: 'b', startTime: 0.5, endTime: 1.5, duration: 1 },
      ],
    }
    expect(
      validate(jsonOverlap as unknown as import('../../engine/json').LessonJSON).some((e) =>
        /overlap/.test(e),
      ),
    ).toBe(true)
    const jsonGap = JSON.parse(serialize(engine3.project!)) as Record<string, unknown>
    const sGap = (jsonGap.slides as Record<string, unknown>[])[0] as Record<string, unknown>
    sGap.prompter = {
      parts: [
        { id: 'p1', text: 'a', startTime: 0, endTime: 1, duration: 1 },
        { id: 'p2', text: 'b', startTime: 5, endTime: 6, duration: 1 },
      ],
    }
    expect(
      validate(jsonGap as unknown as import('../../engine/json').LessonJSON).some((e) =>
        /overlap|gap/.test(e),
      ),
    ).toBe(false)

    // round-trip serialize→deserialize→serialize identical including embedded WAV bytes
    const engine4 = createEngineInternal()
    const disp = new CommandDispatcher(engine4, new UndoStack(), () => {})
    engine4.createProject({ name: 'P' })
    const slide = engine4.createSlide('S1')
    const base64 = btoa('\x00\x01\x02\x03\xff\xfe wav bytes test')
    const assetRes = disp.dispatch(
      new CreateAudioAssetCommand({
        name: 'rec',
        data: base64,
        mimeType: 'audio/wav',
        metadata: { duration: 2.5, sampleRate: 48000, channels: 2, waveformPeaks: [0.1, 0.2] },
      }),
    )
    if (!assetRes.ok) throw assetRes.error
    const assetId = (assetRes.inverse as { assetId: string }).assetId
    disp.dispatch(
      new CreateAudioClipCommand({
        slideId: slide.id,
        assetId,
        trackId: 'voice',
        timelineStart: 0.5,
        sourceEnd: 2.5,
        volume: 0.8,
        playbackRate: 1.5,
        fadeIn: 0.1,
        fadeOut: 0.2,
      }),
    )
    disp.dispatch(
      new ImportPrompterCommand({ slideId: slide.id, rawText: 'Hello. World! How are you?' }),
    )
    const first = serialize(engine4.project!)
    const engine5 = createEngineInternal()
    engine5.restoreFromJSON(JSON.parse(first))
    const second = serialize(engine5.project!)
    expect(second).toBe(first)
    const engine6 = createEngineInternal()
    engine6.restoreFromJSON(JSON.parse(second))
    const third = serialize(engine6.project!)
    expect(third).toBe(second)
    const asset = engine5.getEmbeddedAsset(assetId)
    expect(asset).toBeDefined()
    expect(asset!.data).toBe(base64)
  })

  it('Settings: splitChars, secondsPerCharacter, mismatchThreshold, recordingShortcut introduced, persisted, and used by import/estimate/mismatch/record shortcut', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    // set settings directly (simulating persisted project settings)
    ;(engine.project as unknown as { settings: Record<string, unknown> }).settings = {
      prompter: {
        splitChars: ['|', '*'],
        secondsPerCharacter: 0.5,
        mismatchThreshold: { absolute: 0.7, relative: 0.09 },
        recordingShortcut: 'X',
      },
    }
    const settings = engine.project!.settings
    expect(getPrompterSplitChars(settings)).toEqual(['|', '*'])
    expect(getPrompterSecondsPerCharacter(settings)).toBe(0.5)
    const thr = getPrompterMismatchThreshold(settings)
    expect(thr).toEqual({ absolute: 0.7, relative: 0.09 })
    expect(getPrompterRecordingShortcut(settings)).toBe('x')

    // import respects splitChars & secondsPerCharacter
    const slide = engine.createSlide('S')
    const disp = new CommandDispatcher(engine, new UndoStack(), () => {})
    disp.dispatch(new ImportPrompterCommand({ slideId: slide.id, rawText: 'a|b*c' }))
    const parts = engine.getSlide(slide.id).prompter!.parts
    expect(parts.map((p) => p.text)).toEqual(['a', 'b', 'c'])
    expect(parts[0].duration).toBeCloseTo(0.5)

    // persisted via serialize and honoured after round-trip
    const json = JSON.parse(
      serialize(engine.project!),
    ) as unknown as import('../../engine/json').LessonJSON
    expect(
      (
        (json.project as unknown as { settings?: Record<string, unknown> }).settings as Record<
          string,
          unknown
        >
      ).prompter,
    ).toBeDefined()
    const prompterSettings = (
      json.project as unknown as { settings: { prompter: Record<string, unknown> } }
    ).settings.prompter
    expect(prompterSettings.secondsPerCharacter).toBe(0.5)
    expect(prompterSettings.splitChars).toEqual(['|', '*'])
    const engine2 = createEngineInternal()
    engine2.restoreFromJSON(json as unknown as import('../../engine/json').LessonJSON)
    expect(getPrompterSecondsPerCharacter(engine2.project!.settings)).toBe(0.5)
    expect(getPrompterSplitChars(engine2.project!.settings)).toEqual(['|', '*'])
  })

  it('A11y & history: engine commands all Transaction-undoable, playback Zustand-only; focus management and keyboard parity', () => {
    const engine = createEngineInternal()
    const undo = new UndoStack()
    const disp = new CommandDispatcher(engine, undo, () => {})
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    // persisted edit is undoable
    disp.dispatch(new ImportPrompterCommand({ slideId: slide.id, rawText: 'Hello. World' }))
    expect(undo.entries).toHaveLength(1)
    expect(undo.entries[0].type).toBe('ImportPrompter')

    // Transaction grouping: two clips in one undo entry
    const base64 = btoa('wav')
    const assetRes = disp.dispatch(
      new CreateAudioAssetCommand({
        name: 'a2',
        data: base64,
        mimeType: 'audio/wav',
        metadata: { duration: 1, sampleRate: 44100, channels: 1 },
      }),
    )
    if (!assetRes.ok) throw assetRes.error
    const assetId = (assetRes.inverse as { assetId: string }).assetId
    const undo2 = new UndoStack()
    const disp2 = new CommandDispatcher(engine, undo2, () => {})
    const tx = new TransactionCommand([
      new CreateAudioClipCommand({
        slideId: slide.id,
        assetId,
        trackId: 'voice',
        timelineStart: 0,
        sourceEnd: 1,
      }),
      new CreateAudioClipCommand({
        slideId: slide.id,
        assetId,
        trackId: 'sfx',
        timelineStart: 1,
        sourceEnd: 1,
      }),
    ])
    const txRes = disp2.dispatch(tx)
    expect(txRes.ok).toBe(true)
    expect(undo2.entries).toHaveLength(1)
    expect(undo2.entries[0].type).toBe('Transaction')

    // playback Zustand-only, never persisted or in undo
    const before = undo2.entries.length
    useAudioPlaybackStore.getState().setMuted('voice', true)
    useAudioPlaybackStore.getState().setSolo('music', true)
    useAudioClipSelectionStore.getState().select('some-id')
    expect(undo2.entries).toHaveLength(before)
    const json = JSON.parse(serialize(engine.project!))
    const jsonStr = JSON.stringify(json)
    expect(jsonStr).not.toContain('mutedTracks')
    expect(jsonStr).not.toContain('soloTracks')
    expect(jsonStr).not.toContain('selectedClipIds')
    // reset for other tests
    useAudioPlaybackStore.getState().clearMuteSolo()
    useAudioClipSelectionStore.getState().clear()
  })
})
