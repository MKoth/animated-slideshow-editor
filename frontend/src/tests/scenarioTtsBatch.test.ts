import { describe, expect, it, vi } from 'vitest'
import { createEngineInternal } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import {
  buildScenarioTtsCommands,
  collectScenarioTtsTargets,
  planScenarioTtsCommits,
  resolveTtsLanguage,
  runScenarioTtsBatch,
  type ScenarioTtsCommitPlan,
} from '../ai/scenarioTtsBatch'
import type { TTSProvider } from '../engine/ttsProvider'
import { newId } from '../engine/ids'

function mockTts(
  durations: number[],
  onCall?: (index: number) => void,
): TTSProvider & { calls: number } {
  let calls = 0
  const provider = {
    get calls() {
      return calls
    },
    async generate(request: { text: string }) {
      const index = calls
      calls += 1
      onCall?.(index)
      const duration = durations[index] ?? 1
      return {
        id: newId('audio-asset'),
        name: `TTS ${request.text.slice(0, 20)}`,
        data: 'dGVzdA==',
        mimeType: 'audio/wav',
        metadata: { duration, sampleRate: 24000, channels: 1 },
      }
    },
  }
  return provider as TTSProvider & { calls: number }
}

describe('collectScenarioTtsTargets', () => {
  it('collects slide-ordered non-empty blocks with timing', () => {
    const targets = collectScenarioTtsTargets({
      slides: [
        {
          id: 's1',
          prompter: {
            parts: [
              { id: 'p1', text: 'Hello', duration: 1, startTime: 0 },
              { id: 'p2', text: '   ', duration: 0.5, startTime: 1 },
              { id: 'p3', text: 'World', duration: 2, startTime: 1.5 },
            ],
          },
        },
        { id: 's2', prompter: null },
      ],
    })
    expect(targets).toHaveLength(2)
    expect(targets[0]).toMatchObject({ slideId: 's1', partId: 'p1', startTime: 0 })
    expect(targets[1]).toMatchObject({ slideId: 's1', partId: 'p3', startTime: 1.5 })
  })
})

describe('planScenarioTtsCommits', () => {
  const asset = (id: string): ScenarioTtsCommitPlan['asset'] => ({
    id,
    name: `TTS ${id}`,
    data: 'dGVzdA==',
    mimeType: 'audio/wav',
    metadata: { duration: 1 },
  })
  const targets = [
    { slideId: 's1', position: 1, partId: 'p1', text: 'a', plannedDuration: 2, startTime: 0 },
    { slideId: 's1', position: 1, partId: 'p2', text: 'b', plannedDuration: 2, startTime: 2 },
  ]

  it('stretch keeps prompter timing via playbackRate', () => {
    const plans = planScenarioTtsCommits(
      targets,
      [4, 2.1],
      [asset('a1'), asset('a2')],
      {},
      'stretch',
    )
    expect(plans[0]!.playbackRate).toBeCloseTo(2)
    expect(plans[0]!.fitTextToClip).toBeUndefined()
    expect(plans[0]!.timelineStart).toBe(0)
    // Within threshold (0.1 < max(0.3, 5%)) commits verbatim.
    expect(plans[1]!.playbackRate).toBe(1)
    expect(plans[1]!.fitTextToClip).toBeUndefined()
  })

  it('trim rewrites durations and pre-shifts downstream starts', () => {
    const longTargets = [
      { slideId: 's1', position: 1, partId: 'p1', text: 'a', plannedDuration: 1, startTime: 0 },
      { slideId: 's1', position: 1, partId: 'p2', text: 'b', plannedDuration: 1, startTime: 1 },
    ]
    const plans = planScenarioTtsCommits(
      longTargets,
      [3, 1],
      [asset('a1'), asset('a2')],
      {},
      'trim',
    )
    expect(plans[0]!.fitTextToClip).toMatchObject({ duration: 3, shiftDownstream: true })
    expect(plans[0]!.timelineStart).toBe(0)
    // Second block starts after the extended first block.
    expect(plans[1]!.timelineStart).toBeCloseTo(3)
  })
})

describe('runScenarioTtsBatch', () => {
  it('generates sequentially with progress then commits one Transaction', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'Hello world', duration: 1 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'Second block', duration: 1 })
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    const order: number[] = []
    const tts = mockTts([1, 1], (i) => order.push(i))

    const progress: Array<[number, number]> = []
    const result = await runScenarioTtsBatch(
      { dispatcher, undoStack },
      {
        slides: engine.project!.slides.map((s) => ({
          id: s.id,
          prompter: s.prompter
            ? {
                parts: s.prompter.parts.map((p) => ({
                  id: p.id,
                  text: p.text,
                  duration: p.duration,
                  startTime: p.startTime,
                })),
              }
            : null,
        })),
        settings: engine.project!.settings,
      },
      tts,
      { mode: 'stretch', onProgress: (done, total) => progress.push([done, total]) },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.count).toBe(2)
    // Sequential: one generation at a time, progress 1/2 then 2/2.
    expect(order).toEqual([0, 1])
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])
    expect(undoStack.entries.length).toBe(1)
    expect(undoStack.entries[0]!.type).toBe('Transaction')
    const parts = engine.getSlide(slide.id).prompter!.parts
    expect(parts[0]!.audioClipId).toBeDefined()
    expect(parts[1]!.audioClipId).toBeDefined()
    expect(engine.getSlide(slide.id).audio.clips).toHaveLength(2)
    // Commands are well-formed CommitTts ops.
    const cmds = buildScenarioTtsCommands(
      planScenarioTtsCommits(
        collectScenarioTtsTargets({
          slides: [
            { id: 's', prompter: { parts: [{ id: 'p', text: 'x', duration: 1, startTime: 0 }] } },
          ],
        }),
        [1],
        [
          {
            id: 'a',
            name: 'TTS x',
            data: 'dGVzdA==',
            mimeType: 'audio/wav',
            metadata: { duration: 1 },
          },
        ],
        {},
        'stretch',
      ),
    )
    expect(cmds).toHaveLength(1)
    expect(cmds[0]!.type).toBe('CommitTts')
  })

  it('aborts atomically when a generation fails mid-batch', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'First', duration: 1 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'Second', duration: 1 })
    engine.createPrompterPart(slide.id, { id: 'p3', text: 'Third', duration: 1 })
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    let calls = 0
    const failing: TTSProvider = {
      async generate(request) {
        calls += 1
        if (calls === 2) throw new Error('synthesis blew up')
        return {
          id: newId('audio-asset'),
          name: `TTS ${request.text.slice(0, 10)}`,
          data: 'dGVzdA==',
          mimeType: 'audio/wav',
          metadata: { duration: 1, sampleRate: 24000, channels: 1 },
        }
      },
    }
    const progress: Array<[number, number]> = []
    const result = await runScenarioTtsBatch(
      { dispatcher, undoStack },
      {
        slides: engine.project!.slides.map((s) => ({
          id: s.id,
          prompter: s.prompter
            ? {
                parts: s.prompter.parts.map((p) => ({
                  id: p.id,
                  text: p.text,
                  duration: p.duration,
                  startTime: p.startTime,
                })),
              }
            : null,
        })),
        settings: engine.project!.settings,
      },
      failing,
      { mode: 'stretch', onProgress: (done, total) => progress.push([done, total]) },
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/block 2 of 3/)
    expect(result.done).toBe(1)
    expect(result.total).toBe(3)
    expect(progress).toEqual([[1, 3]])
    // Nothing written: no clips, no history.
    expect(engine.getSlide(slide.id).audio.clips).toHaveLength(0)
    expect(undoStack.entries.length).toBe(0)
    expect(vi).toBeDefined()
  })

  it('restricts generation to the requested positions', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    const first = engine.createSlide('S1')
    const second = engine.createSlide('S2')
    engine.createPrompterPart(first.id, { id: 'p1', text: 'First block', duration: 1 })
    engine.createPrompterPart(second.id, { id: 'p2', text: 'Second block', duration: 1 })
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    const seen: string[] = []
    const tts = mockTts([1, 1], (i) => seen.push(i === 0 ? 'first' : 'second'))
    const snapshot = {
      slides: engine.project!.slides.map((s) => ({
        id: s.id,
        prompter: s.prompter
          ? {
              parts: s.prompter.parts.map((p) => ({
                id: p.id,
                text: p.text,
                duration: p.duration,
                startTime: p.startTime,
              })),
            }
          : null,
      })),
      settings: engine.project!.settings,
    }
    const result = await runScenarioTtsBatch({ dispatcher, undoStack }, snapshot, tts, {
      mode: 'stretch',
      positions: [2],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.count).toBe(1)
    // Only the second step's block was synthesized.
    expect(engine.getSlide(first.id).prompter!.parts[0]!.audioClipId).toBeUndefined()
    expect(engine.getSlide(second.id).prompter!.parts[0]!.audioClipId).toBeDefined()
    expect(seen).toEqual(['first'])
  })
})

describe('resolveTtsLanguage', () => {
  it('speaks foreign-word blocks in Spanish, everything else in English', () => {
    const foreign = ['ser', 'de roble']
    expect(resolveTtsLanguage('ser', foreign)).toBe('es')
    expect(resolveTtsLanguage('Ser is for who you are', foreign)).toBe('en')
    expect(resolveTtsLanguage('de roble', foreign)).toBe('es')
    expect(resolveTtsLanguage('Roble', foreign)).toBe('en')
  })

  it('matches case- and whitespace-insensitively', () => {
    expect(resolveTtsLanguage('  SER  ', ['ser'])).toBe('es')
    expect(resolveTtsLanguage('De   Roble', ['de roble'])).toBe('es')
  })

  it('defaults to English without a foreign list', () => {
    expect(resolveTtsLanguage('ser', undefined)).toBe('en')
    expect(resolveTtsLanguage('ser', [])).toBe('en')
    expect(resolveTtsLanguage('', ['ser'])).toBe('en')
  })
})

describe('runScenarioTtsBatch language', () => {
  it('sends Spanish for foreign-word blocks and English for the rest', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'Ser is for who you are', duration: 2 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'ser', duration: 0.5 })
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    const seenLanguages: Array<string | undefined> = []
    const tts: TTSProvider = {
      async generate(request) {
        seenLanguages.push(request.language)
        return {
          id: newId('audio-asset'),
          name: `TTS ${request.text.slice(0, 10)}`,
          data: 'dGVzdA==',
          mimeType: 'audio/wav',
          metadata: { duration: 1, sampleRate: 24000, channels: 1 },
        }
      },
    }
    const snapshot = {
      slides: engine.project!.slides.map((s) => ({
        id: s.id,
        prompter: s.prompter
          ? {
              parts: s.prompter.parts.map((p) => ({
                id: p.id,
                text: p.text,
                duration: p.duration,
                startTime: p.startTime,
              })),
            }
          : null,
      })),
      settings: engine.project!.settings,
    }
    const result = await runScenarioTtsBatch({ dispatcher, undoStack }, snapshot, tts, {
      mode: 'stretch',
      foreignWords: ['ser'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.count).toBe(2)
    // Sentence block in English, carved-out foreign word in Spanish.
    expect(seenLanguages).toEqual(['en', 'es'])
    expect(result.foreignCount).toBe(1)
  })
})

describe('runScenarioTtsBatch foreign voice', () => {
  it('clones the Spanish reference for foreign blocks only', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'Ser is for who you are', duration: 2 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'ser', duration: 0.5 })
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    const seen: Array<{ text: string; referenceAssetId?: string; refText?: string }> = []
    const tts: TTSProvider = {
      async generate(request) {
        seen.push({
          text: request.text,
          referenceAssetId: request.referenceAssetId,
          refText: request.refText,
        })
        return {
          id: newId('audio-asset'),
          name: `TTS ${request.text.slice(0, 10)}`,
          data: 'dGVzdA==',
          mimeType: 'audio/wav',
          metadata: { duration: 1, sampleRate: 24000, channels: 1 },
        }
      },
    }
    const snapshot = {
      slides: engine.project!.slides.map((s) => ({
        id: s.id,
        prompter: s.prompter
          ? {
              parts: s.prompter.parts.map((p) => ({
                id: p.id,
                text: p.text,
                duration: p.duration,
                startTime: p.startTime,
              })),
            }
          : null,
      })),
      settings: engine.project!.settings,
    }
    const result = await runScenarioTtsBatch({ dispatcher, undoStack }, snapshot, tts, {
      mode: 'stretch',
      foreignWords: ['ser'],
      foreignReferenceAssetId: 'spanish-asset',
      foreignRefText: 'ser es la palabra',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.count).toBe(2)
    // English block: no reference (default voice). Spanish block: clone ref.
    expect(seen[0]).toMatchObject({ text: 'Ser is for who you are' })
    expect(seen[0]!.referenceAssetId).toBeUndefined()
    expect(seen[1]).toMatchObject({
      text: 'ser',
      referenceAssetId: 'spanish-asset',
      refText: 'ser es la palabra',
    })
  })

  it('sends no reference when no Spanish voice is configured', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'ser', duration: 0.5 })
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    const seen: Array<{ referenceAssetId?: string }> = []
    const tts: TTSProvider = {
      async generate(request) {
        seen.push({ referenceAssetId: request.referenceAssetId })
        return {
          id: newId('audio-asset'),
          name: 'TTS',
          data: 'dGVzdA==',
          mimeType: 'audio/wav',
          metadata: { duration: 1, sampleRate: 24000, channels: 1 },
        }
      },
    }
    const snapshot = {
      slides: engine.project!.slides.map((s) => ({
        id: s.id,
        prompter: s.prompter
          ? {
              parts: s.prompter.parts.map((p) => ({
                id: p.id,
                text: p.text,
                duration: p.duration,
                startTime: p.startTime,
              })),
            }
          : null,
      })),
      settings: engine.project!.settings,
    }
    const result = await runScenarioTtsBatch({ dispatcher, undoStack }, snapshot, tts, {
      mode: 'stretch',
      foreignWords: ['ser'],
    })
    expect(result.ok).toBe(true)
    expect(seen).toEqual([{ referenceAssetId: undefined }])
  })
})

describe('runScenarioTtsBatch errors', () => {
  it('refuses when there are no prompter blocks', async () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'P' })
    engine.createSlide('Empty')
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    const result = await runScenarioTtsBatch(
      { dispatcher, undoStack },
      {
        slides: engine.project!.slides.map((s) => ({ id: s.id, prompter: null })),
        settings: engine.project!.settings,
      },
      mockTts([]),
      { mode: 'stretch' },
    )
    expect(result.ok).toBe(false)
  })
})
