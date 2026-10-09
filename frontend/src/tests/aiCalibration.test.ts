import { describe, expect, it } from 'vitest'
import {
  buildClipMouthCommands,
  buildControlMouthCommands,
  buildMouthCommands,
  calibrationAcceptBlockers,
  envelopeCoefficients,
  introOutroStepsFromScenario,
  mapWordsToShapes,
  rejectForbiddenWrites,
  splitWords,
  validateAlignerWords,
  validateCameraKeys,
  verifyCameraFraming,
  verifyFaceRig,
  verifyVoiceReuse,
} from '../ai/calibration'
import { validateProposalSchema } from '../ai/proposals'

const PHONEME_MAP: Record<string, string> = {
  AH: 'Open',
  OW: 'Oval',
  B: 'Closed',
  F: 'Bite',
  L: 'Tongue',
  S: 'Hiss',
  K: 'Back',
  T: 'Tip',
  H: 'Breath',
}
const SHAPES = ['Open', 'Oval', 'Closed', 'Bite', 'Tongue', 'Hiss', 'Back', 'Tip', 'Breath']

describe('Stage D calibration helpers (verify-only + phoneme-timed mouth)', () => {
  it('scopes to intro/outro verbatim, middle excluded', () => {
    const parts = introOutroStepsFromScenario([
      { id: 's1', order: 0, partTag: 'intro', spokenLine: 'Hello, friends!' },
      { id: 's2', order: 1, partTag: 'middle', spokenLine: 'Ser is.' },
      { id: 's3', order: 2, partTag: 'outro', spokenLine: 'Goodbye!' },
    ])
    expect(parts.map((p) => p.stepId)).toEqual(['s1', 's3'])
    expect(parts[0].spokenLine).toBe('Hello, friends!')
    expect(splitWords('Hello friends, I am Mao!')).toEqual(['Hello', 'friends,', 'I', 'am', 'Mao!'])
    expect(() =>
      introOutroStepsFromScenario([{ id: 's1', order: 0, partTag: 'middle', spokenLine: 'Ser.' }]),
    ).toThrow(/nothing to calibrate/)
  })

  it('validates forced-alignment words verbatim (never char-proportional)', () => {
    const spoken = 'Hello friends'
    const ok = [
      { word: 'Hello', start: 0, end: 0.5 },
      { word: 'friends', start: 0.5, end: 1 },
    ]
    expect(validateAlignerWords(spoken, 1, ok)).toEqual([])
    expect(mapWordsToShapes(ok, PHONEME_MAP).every((m) => m.shape)).toBe(true)
    expect(validateAlignerWords(spoken, 1, [ok[0]]).length).toBeGreaterThan(0)
    expect(validateAlignerWords(spoken, 0, ok).length).toBeGreaterThan(0)
  })

  it('builds the envelope fallback from peaks, marked and bounded', () => {
    const keys = envelopeCoefficients([0, 128, 255, 64], 2, 4)
    expect(keys).toHaveLength(4)
    expect(keys[2].open).toBeCloseTo(1)
    expect(keys[0].open).toBeCloseTo(0)
    expect(envelopeCoefficients(Array(800).fill(100), 4).length).toBeLessThanOrEqual(32)
    expect(() => envelopeCoefficients([], 1)).toThrow()
  })

  it('verify-only triple check creates nothing', () => {
    expect(verifyVoiceReuse(null, null, [{ stepId: 's1', audioDuration: 2 }]).ok).toBe(true)
    expect(verifyVoiceReuse(null, 'other', [{ stepId: 's1', audioDuration: 1 }]).ok).toBe(false)
    expect(verifyFaceRig(['Open', 'Closed'], { fromShape: 'Closed', toShape: 'Open' }).ok).toBe(
      true,
    )
    expect(verifyFaceRig([], { fromShape: 'A', toShape: 'B' }).ok).toBe(false)
    expect(verifyFaceRig(['Open'], null).ok).toBe(false)
    expect(verifyCameraFraming(1, [{ property: 'positionX', partTag: 'intro' }]).ok).toBe(true)
    expect(verifyCameraFraming(2, []).ok).toBe(false)
    expect(verifyCameraFraming(1, [{ property: 'rotation', partTag: 'intro' }]).ok).toBe(false)
    expect(verifyCameraFraming(1, [{ property: 'opacity', partTag: 'intro' }]).ok).toBe(false)
    expect(validateCameraKeys([{ property: 'rotation' }]).length).toBeGreaterThan(0)
    expect(validateCameraKeys([{ property: 'opacity', partTag: 'intro' }]).length).toBeGreaterThan(
      0,
    )
    expect(validateCameraKeys([{ property: 'positionX', partTag: 'intro' }])).toEqual([])
  })

  it('mouth builders write morphCoefficient tracks only on intro/outro', () => {
    const timings = [
      {
        stepId: 's1',
        partTag: 'intro',
        spokenLine: 'Hello friends',
        audioDuration: 1,
        words: [
          { word: 'Hello', start: 0, end: 0.5 },
          { word: 'friends', start: 0.5, end: 1 },
        ],
        fallback: false,
        envelope: [],
        missingShapes: [],
      },
      {
        stepId: 's4',
        partTag: 'outro',
        spokenLine: 'Goodbye friends',
        audioDuration: 2,
        words: [],
        fallback: true,
        envelope: envelopeCoefficients([0, 255], 2, 2),
        missingShapes: [],
      },
    ]
    const nodeIds = { s1: 'cat-intro', s4: 'cat-outro' }
    const { commands, warnings } = buildMouthCommands(timings, nodeIds, PHONEME_MAP, SHAPES)
    expect(warnings).toEqual([])
    expect(commands.length).toBeGreaterThan(0)
    expect(new Set(commands.map((c) => c.type))).toEqual(new Set(['AiSetMorphCoefficient']))
    expect(validateProposalSchema(commands).ok).toBe(true)
    expect(rejectForbiddenWrites(commands)).toEqual([])
    const controls = buildControlMouthCommands(timings, nodeIds, 'Open', PHONEME_MAP, SHAPES)
    expect(validateProposalSchema(controls.commands).ok).toBe(true)
    const clips = buildClipMouthCommands(timings, nodeIds, 'mouth-open', PHONEME_MAP, SHAPES)
    expect(validateProposalSchema(clips.commands).ok).toBe(true)
    expect(
      clips.commands.every((c) => (c as Record<string, unknown>).semanticName === 'mouth'),
    ).toBe(true)
    // Aligner-supplied phonemes win when the rig-local map knows them.
    expect(
      mapWordsToShapes([{ word: 'Hello', start: 0, end: 0.5, phoneme: 'OW' }], PHONEME_MAP)[0],
    ).toMatchObject({
      phoneme: 'OW',
      shape: 'Oval',
    })
    expect(() =>
      buildMouthCommands(
        [
          {
            stepId: 's2',
            partTag: 'middle',
            spokenLine: 'Ser is.',
            audioDuration: 1,
            words: [{ word: 'Ser', start: 0, end: 0.5 }],
            fallback: false,
            envelope: [],
            missingShapes: [],
          },
        ],
        { s2: 'board' },
        PHONEME_MAP,
        SHAPES,
      ),
    ).toThrow(/middle excluded/)
    expect(rejectForbiddenWrites([{ type: 'CreateSlide' }]).length).toBeGreaterThan(0)
  })

  it('accept gate stays blocked until checks green and every part timed; fallback marked ok', () => {
    const checks = { voice: { ok: true }, faceRig: { ok: true }, camera: { ok: true } }
    const aligned = {
      stepId: 's1',
      partTag: 'intro',
      spokenLine: 'Hello friends',
      audioDuration: 1,
      words: [{ word: 'Hello', start: 0, end: 1 }],
      fallback: false,
      envelope: [],
      missingShapes: [],
    }
    const fallback = {
      stepId: 's4',
      partTag: 'outro',
      spokenLine: 'Goodbye friends',
      audioDuration: 2,
      words: [],
      fallback: true,
      envelope: [{ t: 1, open: 0.5 }],
      missingShapes: [],
    }
    expect(calibrationAcceptBlockers({ checks, timings: [aligned, fallback] })).toEqual([])
    expect(
      calibrationAcceptBlockers({
        checks: {
          voice: { ok: false, message: 'mismatch' },
          faceRig: { ok: true },
          camera: { ok: true },
        },
        timings: [aligned],
      }).length,
    ).toBeGreaterThan(0)
    expect(
      calibrationAcceptBlockers({ checks, timings: [{ ...aligned, missingShapes: ['Open'] }] })
        .length,
    ).toBeGreaterThan(0)
  })
})
