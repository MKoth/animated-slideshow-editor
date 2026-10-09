import { describe, expect, it } from 'vitest'
import {
  buildCommitCommands,
  buildFillCommands,
  estimatePartDuration,
  layoutParts,
  matchPartsByVerbatimText,
  narrationAcceptBlockers,
  slideDurationForParts,
  verbatimPartsFromSteps,
} from '../ai/narration'
import { dryRunValidate, validateProposalSchema } from '../ai/proposals'
import { buildCommandFromJson } from '../ai/proposals'
import { CreateProjectCommand, CreateSlideCommand, createCommandSystem } from '../engine/commands'
import { CreatePrompterPartCommand } from '../engine/commands/createPrompterPartCommand'
import type { EmbeddedAsset } from '../engine/embeddedAsset'

const MIDDLE_STEPS = [
  { id: 's1', order: 0, partTag: 'middle', spokenLine: 'Ser is for who you are.' },
  { id: 's2', order: 1, partTag: 'middle', spokenLine: 'Estar: where, when?' },
] as const

function setupWithParts() {
  const system = createCommandSystem(() => {})
  const project = system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
  if (!project.ok) throw new Error('no project')
  const slide = system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Middle' }))
  if (!slide.ok) throw new Error('no slide')
  const slideId = (slide.inverse as { slideId: string }).slideId
  const parts = verbatimPartsFromSteps([...MIDDLE_STEPS.map((s) => ({ ...s }))], 0.2)
  const partIds: string[] = []
  for (const part of parts) {
    const created = system.dispatcher.dispatch(
      new CreatePrompterPartCommand({
        slideId,
        text: part.spokenLine,
        duration: part.estimatedDuration,
      }),
    )
    if (!created.ok) throw new Error(`no part: ${created.error.message}`)
    partIds.push((created.inverse as { partId: string }).partId)
  }
  const baseline = system.undoStack.entries.length
  return { system, slideId, parts, partIds, baseline }
}

function wavAsset(id: string): EmbeddedAsset {
  return {
    id,
    name: `TTS ${id}`,
    data: 'UklGRg==',
    mimeType: 'audio/wav',
    metadata: { duration: 1.5, sampleRate: 24000, channels: 1 },
  }
}

describe('Stage C narration helpers (verbatim fill + estimate/adopt timing)', () => {
  it('fills middle steps verbatim, never re-derived', () => {
    const parts = verbatimPartsFromSteps(
      [
        { id: 'i', order: 0, partTag: 'intro', spokenLine: 'Hello!' },
        { id: 'm', order: 1, partTag: 'middle', spokenLine: 'Ser is, for who you are; listen.' },
        { id: 'o', order: 2, partTag: 'outro', spokenLine: 'Bye!' },
      ],
      0.2,
    )
    expect(parts.map((p) => p.stepId)).toEqual(['m'])
    expect(parts[0].spokenLine).toBe('Ser is, for who you are; listen.')
  })

  it('estimates by char count with slide duration as the sum of parts', () => {
    expect(estimatePartDuration('Hi', 0.5)).toBe(1.0)
    const parts = verbatimPartsFromSteps([...MIDDLE_STEPS.map((s) => ({ ...s }))], 0.2)
    expect(parts[0].estimatedDuration).toBe('Ser is for who you are.'.length * 0.2)
    expect(slideDurationForParts(parts)).toBeCloseTo(
      parts[0].estimatedDuration + parts[1].estimatedDuration,
    )
    expect(parts[0].timelineStart).toBe(0)
    expect(parts[1].timelineStart).toBeCloseTo(parts[0].timelineEnd)
  })

  it('adopts TTS durations and shifts downstream gap-free, never stretched', () => {
    const parts = verbatimPartsFromSteps([...MIDDLE_STEPS.map((s) => ({ ...s }))], 0.2)
    const adopted = layoutParts(
      parts.map((p, i) => ({ ...p, audioDuration: i === 0 ? 2.5 : 0.4, status: 'ready' as const })),
    )
    expect(adopted[0].timelineEnd).toBeCloseTo(2.5)
    expect(adopted[1].timelineStart).toBeCloseTo(2.5)
    expect(adopted[1].timelineEnd).toBeCloseTo(2.9)
    expect(slideDurationForParts(adopted)).toBeCloseTo(2.9)
  })

  it('blocks the accept gate until every part is ready with an asset id', () => {
    const parts = verbatimPartsFromSteps([...MIDDLE_STEPS.map((s) => ({ ...s }))], 0.2)
    expect(narrationAcceptBlockers(parts).length).toBe(2)
    const failed = parts.map((p) => ({ ...p, status: 'failed' as const, error: 'boom' }))
    expect(narrationAcceptBlockers(failed).some((b) => /retry/i.test(b))).toBe(true)
    const ready = parts.map((p, i) => ({ ...p, status: 'ready' as const, assetId: `a-${i}` }))
    expect(narrationAcceptBlockers(ready)).toEqual([])
  })

  it('builds fill + commit proposals with asset ids, never inline base64', () => {
    const parts = verbatimPartsFromSteps([...MIDDLE_STEPS.map((s) => ({ ...s }))], 0.2)
    const fill = buildFillCommands(parts, 'slide-1')
    expect(validateProposalSchema(fill).ok).toBe(true)
    expect(fill[0]).toMatchObject({ type: 'CreatePrompterPart', text: 'Ser is for who you are.' })
    const ready = parts.map((p, i) => ({
      ...p,
      status: 'ready' as const,
      assetId: `asset-${i}`,
      audioDuration: 1.5,
    }))
    const commit = buildCommitCommands(ready, 'slide-1', { s1: 'part-1', s2: 'part-2' })
    expect(validateProposalSchema(commit).ok).toBe(true)
    expect(commit[0]).toEqual({
      type: 'AiCommitTts',
      slideId: 'slide-1',
      partId: 'part-1',
      assetId: 'asset-0',
      timelineStart: 0,
      sourceEnd: 1.5,
    })
    expect(JSON.stringify(commit).toLowerCase()).not.toContain('base64')
    expect(() => buildCommitCommands(parts, 'slide-1', { s1: 'p1', s2: 'p2' })).toThrow(/embed/i)
    const pending = parts.map((p) => ({ ...p, assetId: 'asset-x', audioDuration: 1.5 }))
    expect(() => buildCommitCommands(pending, 'slide-1', { s1: 'p1', s2: 'p2' })).toThrow(/retry/i)
  })

  it('matches live parts by verbatim text for the commit proposal', () => {
    const parts = verbatimPartsFromSteps([...MIDDLE_STEPS.map((s) => ({ ...s }))], 0.2)
    const { matched, unmatchedStepIds } = matchPartsByVerbatimText(
      [
        { id: 'pp-1', text: 'Ser is for who you are.' },
        { id: 'pp-2', text: 'Estar: where, when?' },
      ],
      parts,
    )
    expect(matched).toEqual({ s1: 'pp-1', s2: 'pp-2' })
    expect(unmatchedStepIds).toEqual([])
    const missing = matchPartsByVerbatimText([{ id: 'pp-9', text: 'Something else' }], parts)
    expect(missing.unmatchedStepIds).toEqual(['s1', 's2'])
  })
})

describe('Stage C AiCommitTts command (real, rate locked to 1)', () => {
  it('dry-runs against the live engine with fixable errors', () => {
    const { system, slideId, parts, partIds } = setupWithParts()
    system.engine.embedAsset(wavAsset('asset-0'))
    const good = [
      {
        type: 'AiCommitTts',
        slideId,
        partId: partIds[0],
        assetId: 'asset-0',
        timelineStart: 0,
        sourceEnd: 1.5,
      },
    ]
    expect(dryRunValidate(system.engine, good).ok).toBe(true)
    const missing = [
      {
        type: 'AiCommitTts',
        slideId,
        partId: partIds[0],
        assetId: 'no-such-asset',
        timelineStart: 0,
        sourceEnd: 1.5,
      },
    ]
    const result = dryRunValidate(system.engine, missing)
    expect(result.ok).toBe(false)
    expect(result.errors[0].message).toContain('no-such-asset')
    // Gap-free alignment: a start that drifted since validation fails the
    // dry-run instead of diverging clip vs. part.
    const drifted = [
      {
        type: 'AiCommitTts',
        slideId,
        partId: partIds[0],
        assetId: 'asset-0',
        timelineStart: 99,
        sourceEnd: 1.5,
      },
    ]
    const driftResult = dryRunValidate(system.engine, drifted)
    expect(driftResult.ok).toBe(false)
    expect(driftResult.errors[0].message).toMatch(/timelineStart|dry-run/)
    void parts
  })

  it('commits voice, adopts duration with downstream shift, never stretches', () => {
    const { system, slideId, partIds, baseline } = setupWithParts()
    system.engine.embedAsset(wavAsset('asset-0'))
    system.engine.embedAsset(wavAsset('asset-1'))
    const before = system.engine.getSlide(slideId).prompter?.parts.map((p) => p.duration) ?? []
    const command = buildCommandFromJson({
      type: 'AiCommitTts',
      slideId,
      partId: partIds[0],
      assetId: 'asset-0',
      timelineStart: 0,
      sourceEnd: 1.5,
    })
    const result = system.dispatcher.dispatch(command, 'ai')
    expect(result.ok).toBe(true)
    const slide = system.engine.getSlide(slideId)
    const first = slide.prompter?.parts.find((p) => p.id === partIds[0])
    expect(first?.audioAssetId).toBe('asset-0')
    // Adopted, not stretched: part duration equals the audio duration at rate 1.
    expect(first?.duration).toBeCloseTo(1.5)
    const clip = slide.audio.clips.find((c) => c.id === first?.audioClipId)
    expect(clip?.playbackRate).toBe(1)
    // Downstream shifted gap-free, not overlapped.
    const second = slide.prompter?.parts.find((p) => p.id === partIds[1])
    expect(second?.startTime).toBeCloseTo(first?.endTime ?? -1)
    expect(system.undoStack.entries.length).toBe(baseline + 1)
    void before
  })

  it('rolls back fully with one undo', () => {
    const { system, slideId, partIds } = setupWithParts()
    system.engine.embedAsset(wavAsset('asset-0'))
    const before = JSON.stringify(system.engine.toJSON())
    const command = buildCommandFromJson({
      type: 'AiCommitTts',
      slideId,
      partId: partIds[0],
      assetId: 'asset-0',
      timelineStart: 0,
      sourceEnd: 1.5,
    })
    const result = system.dispatcher.dispatch(command, 'ai')
    expect(result.ok).toBe(true)
    system.dispatcher.undo()
    expect(JSON.stringify(system.engine.toJSON())).toBe(before)
  })
})
