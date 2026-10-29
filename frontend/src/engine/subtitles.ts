// subtitles.ts — Export subtitles from Prompter parts (Spec 473)
// One cue per PrompterPart over a continuous timeline from 0.
// - Cue text = trimmed part.text; whitespace-only parts skipped.
// - start = slideOffset + part.startTime, end = slideOffset + part.endTime.
// - slideOffset = sum of durations of preceding *selected* slides (project order).
// - AudioSegments ignored (no word-level cues). `stale` parts included as-is.
// - Slides with no prompter contribute a silent gap (no cues, offset still advances).
// - Muting/deleting audio never removes cues (subtitles follow text, not mix state).

import type { Project } from './project'
import type { Slide } from './slide'

export interface ExportSubtitleCue {
  readonly index: number // 1-based sequence over the joined timeline
  readonly text: string // trimmed part text
  readonly start: number // seconds on the continuous timeline
  readonly end: number // seconds on the continuous timeline
  readonly slideId: string
  readonly partId: string
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0')
}

function splitTimestamp(totalMs: number): { hh: number; mm: number; ss: number; ms: number } {
  const clamped = Math.max(0, totalMs)
  const ms = clamped % 1000
  const totalSeconds = Math.floor(clamped / 1000)
  const ss = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const mm = totalMinutes % 60
  const hh = Math.floor(totalMinutes / 60)
  return { hh, mm, ss, ms }
}

/** SRT timestamp: HH:MM:SS,mmm */
export function formatSrtTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds)) throw new Error('timestamp must be finite')
  const totalMs = Math.round(seconds * 1000)
  const { hh, mm, ss, ms } = splitTimestamp(totalMs)
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)},${pad3(ms)}`
}

/** VTT timestamp: HH:MM:SS.mmm */
export function formatVttTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds)) throw new Error('timestamp must be finite')
  const totalMs = Math.round(seconds * 1000)
  const { hh, mm, ss, ms } = splitTimestamp(totalMs)
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}.${pad3(ms)}`
}

function cuesForSlideInOrder(
  slide: Slide,
  slideOffset: number,
  startIndex: number,
): ExportSubtitleCue[] {
  const cues: ExportSubtitleCue[] = []
  const parts = slide.prompter?.parts ?? []
  let index = startIndex
  for (const part of parts) {
    const text = part.text.trim()
    if (text.length === 0) continue
    const start = slideOffset + part.startTime
    const end = slideOffset + part.endTime
    // Guard against degenerate timing (e.g. zero-length part): still emit if text present?
    // Emit with clamped end >= start so SRT/VTT stay valid.
    const safeEnd = end < start ? start : end
    index += 1
    cues.push({ index, text, start, end: safeEnd, slideId: slide.id, partId: part.id })
  }
  return cues
}

/**
 * Build subtitle cues for a slide subset over a continuous timeline from 0.
 * - `slideIds` may be in any order; output follows project slide order (deterministic).
 * - Zero-duration slides are excluded (callers may pre-filter; we also skip them here
 *   so offsets and cues never include an empty segment).
 * - Unknown slide ids are ignored.
 */
export function buildExportSubtitleCues(
  project: Project,
  slideIds: readonly string[],
): ExportSubtitleCue[] {
  const wanted = new Set(slideIds)
  const ordered = project.slides.filter((slide) => wanted.has(slide.id) && slide.duration > 0)
  const cues: ExportSubtitleCue[] = []
  let offset = 0
  let index = 0
  for (const slide of ordered) {
    const slideCues = cuesForSlideInOrder(slide, offset, index)
    for (const cue of slideCues) cues.push(cue)
    index += slideCues.length
    offset += slide.duration
  }
  return cues
}

/** Per-slide cue counts for the dialog preview (project order, zero-duration excluded). */
export function getExportSubtitleCueCounts(
  project: Project,
  slideIds: readonly string[],
): ReadonlyMap<string, number> {
  const cues = buildExportSubtitleCues(project, slideIds)
  const counts = new Map<string, number>()
  for (const id of slideIds) counts.set(id, 0)
  for (const cue of cues) counts.set(cue.slideId, (counts.get(cue.slideId) ?? 0) + 1)
  // Drop zero-duration / unknown slides from the map so the dialog only shows selectable rows.
  const selectable = new Set(
    project.slides.filter((s) => slideIds.includes(s.id) && s.duration > 0).map((s) => s.id),
  )
  for (const id of [...counts.keys()]) {
    if (!selectable.has(id)) counts.delete(id)
  }
  return counts
}

/** Number of cues a single slide would contribute (trimmed, non-empty parts only). */
export function countCuesForSlide(slide: Slide): number {
  const parts = slide.prompter?.parts ?? []
  let count = 0
  for (const part of parts) {
    if (part.text.trim().length > 0) count += 1
  }
  return count
}

export function buildSrtDocument(cues: readonly ExportSubtitleCue[]): string {
  if (cues.length === 0) return ''
  const blocks = cues.map(
    (cue) =>
      `${cue.index}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\n${cue.text}`,
  )
  return `${blocks.join('\n\n')}\n`
}

export function buildVttDocument(cues: readonly ExportSubtitleCue[]): string {
  if (cues.length === 0) return 'WEBVTT\n'
  const blocks = cues.map(
    (cue) =>
      `${cue.index}\n${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}\n${cue.text}`,
  )
  return `WEBVTT\n\n${blocks.join('\n\n')}\n`
}

/** Basename for `<name>.zip` / `<name>.mp4/.srt/.vtt` (sanitized project name). */
export function sanitizeExportBasename(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'export'
  // Keep word chars, dots and dashes; everything else becomes a dash.
  const replaced = trimmed.replace(/[^a-zA-Z0-9-_.]+/g, '-').replace(/-+/g, '-')
  const stripped = replaced.replace(/^[-_.]+|[-_.]+$/g, '')
  return stripped.length > 0 ? stripped.slice(0, 120) : 'export'
}
