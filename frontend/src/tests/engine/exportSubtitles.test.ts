import { describe, expect, it, beforeEach } from 'vitest'
import { createEngineInternal } from '../../engine/internal'
import {
  buildExportSubtitleCues,
  buildSrtDocument,
  buildVttDocument,
  countCuesForSlide,
  formatSrtTimestamp,
  formatVttTimestamp,
  getExportSubtitleCueCounts,
  sanitizeExportBasename,
} from '../../engine/subtitles'
import {
  buildExportJobDescriptorForSlides,
  EXPORT_VIDEO_FPS,
  getFixedExportSettings,
} from '../../engine/export'

function createEngine() {
  return createEngineInternal()
}

describe('Spec 473 — Export subtitles seam', () => {
  let engine: ReturnType<typeof createEngine>

  beforeEach(() => {
    engine = createEngine()
    engine.createProject({ name: 'My Lesson!' })
  })

  it('one cue per part with continuous offsets, trim, skip-empty, stale included', () => {
    const s1 = engine.createSlide('S1')
    engine.setSlideDuration(s1.id, 4)
    engine.createPrompterPart(s1.id, { id: 'p1', text: '  Hello world  ', duration: 1 })
    engine.createPrompterPart(s1.id, { id: 'p2', text: '   ', duration: 1 })
    engine.createPrompterPart(s1.id, { id: 'p3', text: 'Second line', duration: 2 })
    // Mark p3 stale — must still be included with frozen timing
    s1.prompter!.parts[2]!.status = 'stale'

    const s2 = engine.createSlide('S2')
    engine.setSlideDuration(s2.id, 3)
    engine.createPrompterPart(s2.id, { id: 'q1', text: 'Slide two opens', duration: 1.5 })

    const project = engine.project!
    const cues = buildExportSubtitleCues(project, [s1.id, s2.id])
    // p2 whitespace-only skipped; 2 cues from s1 + 1 from s2
    expect(cues).toHaveLength(3)
    expect(cues[0]!.text).toBe('Hello world')
    expect(cues[1]!.text).toBe('Second line')
    expect(cues[2]!.text).toBe('Slide two opens')
    // s1 starts at 0; p1 [0,1], p3 [2,4] (gap preserved: p2 still occupies [1,2] but no cue)
    expect(cues[0]!.start).toBeCloseTo(0)
    expect(cues[0]!.end).toBeCloseTo(1)
    expect(cues[1]!.start).toBeCloseTo(2)
    expect(cues[1]!.end).toBeCloseTo(4)
    // s2 offset by s1 duration (4s): q1 [4, 5.5]
    expect(cues[2]!.start).toBeCloseTo(4)
    expect(cues[2]!.end).toBeCloseTo(5.5)
    expect(cues.map((c) => c.index)).toEqual([1, 2, 3])
  })

  it('slides with no prompter contribute a silent gap (no cues, offset advances)', () => {
    const s1 = engine.createSlide('S1')
    engine.setSlideDuration(s1.id, 2)
    engine.createPrompterPart(s1.id, { id: 'p1', text: 'Intro', duration: 2 })
    const gap = engine.createSlide('Gap')
    engine.setSlideDuration(gap.id, 5)
    // no prompter parts on gap slide
    const s3 = engine.createSlide('S3')
    engine.setSlideDuration(s3.id, 2)
    engine.createPrompterPart(s3.id, { id: 'r1', text: 'After gap', duration: 2 })

    const cues = buildExportSubtitleCues(engine.project!, [s1.id, gap.id, s3.id])
    expect(cues).toHaveLength(2)
    expect(cues[0]!.start).toBeCloseTo(0)
    // s3 offset = 2 + 5 = 7
    expect(cues[1]!.start).toBeCloseTo(7)
    expect(cues[1]!.end).toBeCloseTo(9)
  })

  it('muting/deleting audio never removes cues (subtitles follow text)', () => {
    const s1 = engine.createSlide('S1')
    engine.setSlideDuration(s1.id, 2)
    engine.createPrompterPart(s1.id, { id: 'p1', text: 'Keep me', duration: 2 })
    // No audio clips at all — cue must still exist
    expect(countCuesForSlide(s1)).toBe(1)
    const cues = buildExportSubtitleCues(engine.project!, [s1.id])
    expect(cues).toHaveLength(1)
    expect(cues[0]!.text).toBe('Keep me')
  })

  it('golden SRT/VTT fixtures for a two-slide selection', () => {
    const s1 = engine.createSlide('S1')
    engine.setSlideDuration(s1.id, 4)
    engine.createPrompterPart(s1.id, { id: 'p1', text: 'Hello', duration: 1.5 })
    engine.createPrompterPart(s1.id, { id: 'p2', text: 'World', duration: 2.5 })
    const s2 = engine.createSlide('S2')
    engine.setSlideDuration(s2.id, 2)
    engine.createPrompterPart(s2.id, { id: 'q1', text: 'Again', duration: 2 })

    const cues = buildExportSubtitleCues(engine.project!, [s2.id, s1.id])
    // Output follows project order regardless of tick order
    expect(cues.map((c) => c.slideId)).toEqual([s1.id, s1.id, s2.id])

    const srt = buildSrtDocument(cues)
    expect(srt).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nHello\n\n' +
        '2\n00:00:01,500 --> 00:00:04,000\nWorld\n\n' +
        '3\n00:00:04,000 --> 00:00:06,000\nAgain\n',
    )
    const vtt = buildVttDocument(cues)
    expect(vtt).toBe(
      'WEBVTT\n\n' +
        '1\n00:00:00.000 --> 00:00:01.500\nHello\n\n' +
        '2\n00:00:01.500 --> 00:00:04.000\nWorld\n\n' +
        '3\n00:00:04.000 --> 00:00:06.000\nAgain\n',
    )
  })

  it('timestamp formatting is exact for both formats', () => {
    expect(formatSrtTimestamp(0)).toBe('00:00:00,000')
    expect(formatSrtTimestamp(61.5)).toBe('00:01:01,500')
    expect(formatSrtTimestamp(3661.007)).toBe('01:01:01,007')
    expect(formatVttTimestamp(0)).toBe('00:00:00.000')
    expect(formatVttTimestamp(61.5)).toBe('00:01:01.500')
    expect(formatVttTimestamp(3661.007)).toBe('01:01:01.007')
  })

  it('empty cue list emits valid empty documents', () => {
    expect(buildSrtDocument([])).toBe('')
    expect(buildVttDocument([])).toBe('WEBVTT\n')
  })

  it('sanitizeExportBasename', () => {
    expect(sanitizeExportBasename('My Lesson!')).toBe('My-Lesson')
    expect(sanitizeExportBasename('  ')).toBe('export')
    expect(sanitizeExportBasename('a/b\\c:d')).toBe('a-b-c-d')
  })

  it('dialog preview: per-slide cue counts plus totals', () => {
    const s1 = engine.createSlide('S1')
    engine.setSlideDuration(s1.id, 2)
    engine.createPrompterPart(s1.id, { id: 'p1', text: 'A', duration: 1 })
    engine.createPrompterPart(s1.id, { id: 'p2', text: 'B', duration: 1 })
    const s2 = engine.createSlide('S2')
    engine.setSlideDuration(s2.id, 3)
    // no prompter on s2
    const counts = getExportSubtitleCueCounts(engine.project!, [s1.id, s2.id])
    expect(counts.get(s1.id)).toBe(2)
    expect(counts.get(s2.id)).toBe(0)
  })
})

describe('Spec 473 — Subset descriptor seam', () => {
  let engine: ReturnType<typeof createEngine>

  beforeEach(() => {
    engine = createEngine()
    engine.createProject({ name: 'Subset Test' })
  })

  it('selection filtering preserves project order, frame counts = round(duration*30)', () => {
    const s1 = engine.createSlide('S1')
    engine.setSlideDuration(s1.id, 2)
    const s2 = engine.createSlide('S2')
    engine.setSlideDuration(s2.id, 1.5)
    const s3 = engine.createSlide('S3')
    engine.setSlideDuration(s3.id, 3)
    const settings = getFixedExportSettings()
    expect(settings.fps).toBe(30)
    expect(settings.width).toBe(1920)
    expect(settings.height).toBe(1080)

    // Tick order reversed — output must follow project order
    const job = buildExportJobDescriptorForSlides(engine.project!, [s3.id, s1.id], settings)
    expect(job.slides.map((s) => s.slideId)).toEqual([s1.id, s3.id])
    expect(job.slides[0]!.frameCount).toBe(Math.round(2 * EXPORT_VIDEO_FPS))
    expect(job.slides[1]!.frameCount).toBe(Math.round(3 * EXPORT_VIDEO_FPS))
    expect(job.global.totalDuration).toBeCloseTo(5)
    expect(job.global.totalFrames).toBe(Math.round(2 * 30) + Math.round(3 * 30))
  })

  it('zero-duration slides excluded; empty selection rejected', () => {
    const s1 = engine.createSlide('S1')
    engine.setSlideDuration(s1.id, 2)
    const zero = engine.createSlide('Zero')
    // Engine clamps durations via setSlideDuration (min 0.1); zero-duration
    // slides arrive via legacy/deserialized data — simulate by direct assignment.
    zero.duration = 0
    const settings = getFixedExportSettings()

    const job = buildExportJobDescriptorForSlides(engine.project!, [s1.id, zero.id], settings)
    expect(job.slides.map((s) => s.slideId)).toEqual([s1.id])

    expect(() => buildExportJobDescriptorForSlides(engine.project!, [], settings)).toThrow()
    expect(() => buildExportJobDescriptorForSlides(engine.project!, [zero.id], settings)).toThrow()
    expect(() =>
      buildExportJobDescriptorForSlides(engine.project!, ['missing-id'], settings),
    ).toThrow()
  })

  it('engine seam exposes subset builder', () => {
    const s1 = engine.createSlide('S1')
    engine.setSlideDuration(s1.id, 1)
    const job = engine.buildExportJobDescriptorForSlides([s1.id], { fps: 30 })
    expect(job.slides).toHaveLength(1)
    expect(job.slides[0]!.slideId).toBe(s1.id)
  })
})
