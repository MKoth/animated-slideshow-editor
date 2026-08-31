import { isRecord, requireFiniteNumber, requireString } from './guards'
import { newId } from './ids'
import type { PrompterJSON } from './json'

export type PrompterPartStatus = 'stale'

export interface PrompterPart {
  readonly id: string
  text: string
  startTime: number
  endTime: number
  duration: number
  audioClipId?: string
  audioAssetId?: string
  promptId?: string
  status?: PrompterPartStatus
}

export interface Prompter {
  parts: PrompterPart[]
}

export function newPrompterPartId(): string {
  return newId('prompter-part')
}

export const PROMPTER_DURATION_TOLERANCE = 1e-6

export const DEFAULT_PROMPTER_SPLIT_CHARS: readonly string[] = [
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  '\n',
  '—',
]
export const DEFAULT_PROMPTER_SECONDS_PER_CHARACTER = 0.2

export const DEFAULT_PROMPTER_RECORDING_SHORTCUT = 'r'
export const DEFAULT_PROMPTER_MISMATCH_THRESHOLD = {
  absolute: 0.3,
  relative: 0.05,
} as const

export type PrompterMismatchThreshold = { absolute: number; relative: number }
export type PrompterMismatchKind = 'longer' | 'shorter' | 'none'

export function getPrompterRecordingShortcut(settings: unknown): string {
  if (!isRecord(settings)) return DEFAULT_PROMPTER_RECORDING_SHORTCUT
  const prompter = settings.prompter
  if (!isRecord(prompter)) return DEFAULT_PROMPTER_RECORDING_SHORTCUT
  const { recordingShortcut } = prompter as Record<string, unknown>
  if (typeof recordingShortcut !== 'string' || recordingShortcut.trim() === '') {
    return DEFAULT_PROMPTER_RECORDING_SHORTCUT
  }
  return recordingShortcut.trim().toLowerCase()
}

export function getPrompterMismatchThreshold(settings: unknown): PrompterMismatchThreshold {
  if (!isRecord(settings)) return { ...DEFAULT_PROMPTER_MISMATCH_THRESHOLD }
  const prompter = settings.prompter
  if (!isRecord(prompter)) return { ...DEFAULT_PROMPTER_MISMATCH_THRESHOLD }
  const raw = prompter.mismatchThreshold
  if (!isRecord(raw)) return { ...DEFAULT_PROMPTER_MISMATCH_THRESHOLD }
  const absolute =
    typeof raw.absolute === 'number' && Number.isFinite(raw.absolute) && raw.absolute >= 0
      ? raw.absolute
      : DEFAULT_PROMPTER_MISMATCH_THRESHOLD.absolute
  const relative =
    typeof raw.relative === 'number' && Number.isFinite(raw.relative) && raw.relative >= 0
      ? raw.relative
      : DEFAULT_PROMPTER_MISMATCH_THRESHOLD.relative
  return { absolute, relative }
}

export function getMismatchThresholdValue(
  plannedDuration: number,
  threshold: PrompterMismatchThreshold,
): number {
  return Math.max(threshold.absolute, threshold.relative * plannedDuration)
}

export function shouldShowMismatchDialog(
  recordedDuration: number,
  plannedDuration: number,
  threshold: PrompterMismatchThreshold,
): boolean {
  const limit = getMismatchThresholdValue(plannedDuration, threshold)
  return Math.abs(recordedDuration - plannedDuration) > limit
}

export function getMismatchKind(
  recordedDuration: number,
  plannedDuration: number,
  threshold: PrompterMismatchThreshold,
): PrompterMismatchKind {
  if (!shouldShowMismatchDialog(recordedDuration, plannedDuration, threshold)) return 'none'
  return recordedDuration > plannedDuration ? 'longer' : 'shorter'
}

/** playbackRate = planned / recorded — non-destructive stretch, pitch preserved via server FFmpeg RubberBand */
export function computePlaybackRate(plannedDuration: number, recordedDuration: number): number {
  if (recordedDuration <= 0) throw new Error('recordedDuration must be positive')
  return plannedDuration / recordedDuration
}

export function getPrompterSplitChars(settings: unknown): string[] {
  if (!isRecord(settings)) return [...DEFAULT_PROMPTER_SPLIT_CHARS]
  const prompter = settings.prompter
  if (!isRecord(prompter)) return [...DEFAULT_PROMPTER_SPLIT_CHARS]
  const { splitChars } = prompter as Record<string, unknown>
  if (!Array.isArray(splitChars)) return [...DEFAULT_PROMPTER_SPLIT_CHARS]
  const filtered = splitChars.filter((c) => typeof c === 'string' && c.length > 0) as string[]
  return filtered.length > 0 ? filtered : [...DEFAULT_PROMPTER_SPLIT_CHARS]
}

export function getPrompterSecondsPerCharacter(settings: unknown): number {
  if (!isRecord(settings)) return DEFAULT_PROMPTER_SECONDS_PER_CHARACTER
  const prompter = settings.prompter
  if (!isRecord(prompter)) return DEFAULT_PROMPTER_SECONDS_PER_CHARACTER
  const { secondsPerCharacter } = prompter as Record<string, unknown>
  if (
    typeof secondsPerCharacter !== 'number' ||
    !Number.isFinite(secondsPerCharacter) ||
    secondsPerCharacter <= 0
  ) {
    return DEFAULT_PROMPTER_SECONDS_PER_CHARACTER
  }
  return secondsPerCharacter
}

export function estimatePrompterDuration(text: string, secondsPerCharacter: number): number {
  return text.length * secondsPerCharacter
}

export function splitImportText(rawText: string, splitChars: readonly string[]): string[] {
  if (rawText.trim() === '') return []
  const splitSet = new Set(splitChars)
  const parts: string[] = []
  let current = ''
  let i = 0
  while (i < rawText.length) {
    const ch = rawText[i]
    if (splitSet.has(ch)) {
      if (current.trim().length > 0) parts.push(current.trim())
      current = ''
      // collapse consecutive delimiters
      i++
      while (i < rawText.length && splitSet.has(rawText[i])) i++
      continue
    }
    current += ch
    i++
  }
  const tail = current.trim()
  if (tail.length > 0) parts.push(tail)
  return parts
}

export function hasPrompterPartAudio(part: PrompterPart): boolean {
  return part.audioClipId !== undefined || part.audioAssetId !== undefined
}

export function redistributeDurations(
  originalDuration: number,
  texts: readonly string[],
): number[] {
  const totalLen = texts.reduce((sum, t) => sum + t.length, 0)
  if (totalLen === 0) return texts.map(() => 0)
  const durations = texts.map((t) => (t.length / totalLen) * originalDuration)
  // Adjust last to ensure sum equals original within tolerance (compensate floating error)
  const sum = durations.reduce((a, b) => a + b, 0)
  const delta = originalDuration - sum
  if (Math.abs(delta) > 1e-9 && durations.length > 0) {
    durations[durations.length - 1] += delta
  }
  return durations
}

export interface WordSplitResult {
  texts: string[]
}

export function splitPrompterPartText(
  text: string,
  wordIndex: number,
  mode: 'left' | 'right' | 'out',
): string[] {
  // Find word boundaries: sequences of non-whitespace
  const words: { word: string; start: number; end: number }[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    words.push({ word: m[0], start: m.index, end: m.index + m[0].length })
  }
  if (words.length === 0) return []
  if (wordIndex < 0 || wordIndex >= words.length)
    throw new Error(`Word index out of bounds: ${wordIndex}`)
  const target = words[wordIndex]
  let rawPieces: string[] = []
  if (mode === 'left') {
    // split before the word: left | word+right
    const left = text.slice(0, target.start)
    const right = text.slice(target.start)
    rawPieces = [left, right]
  } else if (mode === 'right') {
    const left = text.slice(0, target.end)
    const right = text.slice(target.end)
    rawPieces = [left, right]
  } else {
    const left = text.slice(0, target.start)
    const middle = text.slice(target.start, target.end)
    const right = text.slice(target.end)
    rawPieces = [left, middle, right]
  }
  // Discard whitespace-only pieces, preserve spacing for remaining pieces (keep as-is, do not trim internal except discarded)
  // For remaining pieces, keep original spacing as sliced (including leading/trailing spaces). But for clean display, we keep as-is.
  // If a piece is whitespace-only, discard.
  const filtered = rawPieces.filter((piece) => piece.trim().length > 0)
  return filtered
}

export function mergePrompterPartTexts(leftText: string, rightText: string): string {
  // Single-space join: trim trailing/leading whitespace and join with single space
  const a = leftText.trimEnd()
  const b = rightText.trimStart()
  if (a === '') return b
  if (b === '') return a
  return `${a} ${b}`
}

export function createPrompterPart(input: {
  id?: string
  text: string
  startTime: number
  endTime: number
  duration: number
  audioClipId?: string
  audioAssetId?: string
  promptId?: string
  status?: PrompterPartStatus
}): PrompterPart {
  const id = input.id ?? newPrompterPartId()
  requireString(id, 'PrompterPart id')
  if (typeof input.text !== 'string') throw new Error('PrompterPart text must be a string')
  const duration = requireFiniteNumber(input.duration, 'PrompterPart duration', (v) => v >= 0)
  const startTime = requireFiniteNumber(input.startTime, 'PrompterPart startTime', (v) => v >= 0)
  const endTime = requireFiniteNumber(input.endTime, 'PrompterPart endTime', (v) => v >= 0)
  if (Math.abs(duration - (endTime - startTime)) > PROMPTER_DURATION_TOLERANCE) {
    throw new Error('PrompterPart duration must equal endTime - startTime within tolerance')
  }
  const part: PrompterPart = { id, text: input.text, startTime, endTime, duration }
  if (input.audioClipId !== undefined)
    part.audioClipId = requireString(input.audioClipId, 'PrompterPart audioClipId')
  if (input.audioAssetId !== undefined)
    part.audioAssetId = requireString(input.audioAssetId, 'PrompterPart audioAssetId')
  if (input.promptId !== undefined)
    part.promptId = requireString(input.promptId, 'PrompterPart promptId')
  if (input.status !== undefined) {
    if (input.status !== 'stale') throw new Error('PrompterPart status must be stale')
    part.status = input.status
  }
  return part
}

export function createPrompter(parts: PrompterPart[] = []): Prompter {
  return { parts: [...parts] }
}

export function reflowPrompter(prompter: Prompter): void {
  let cursor = 0
  for (const part of prompter.parts) {
    part.startTime = cursor
    part.endTime = cursor + part.duration
    cursor = part.endTime
  }
}

export function prompterToJSON(prompter: Prompter): PrompterJSON {
  return {
    parts: prompter.parts.map((part) => ({
      id: part.id,
      text: part.text,
      startTime: part.startTime,
      endTime: part.endTime,
      duration: part.duration,
      ...(part.audioClipId !== undefined ? { audioClipId: part.audioClipId } : {}),
      ...(part.audioAssetId !== undefined ? { audioAssetId: part.audioAssetId } : {}),
      ...(part.promptId !== undefined ? { promptId: part.promptId } : {}),
      ...(part.status !== undefined ? { status: part.status } : {}),
    })),
  }
}

export function prompterFromJSON(json: PrompterJSON): Prompter {
  const parts = json.parts.map((partJson) =>
    createPrompterPart({
      id: requireString(partJson.id, 'PrompterPart id'),
      text: partJson.text,
      startTime: partJson.startTime,
      endTime: partJson.endTime,
      duration: partJson.duration,
      audioClipId: partJson.audioClipId,
      audioAssetId: partJson.audioAssetId,
      promptId: partJson.promptId,
      status: partJson.status as PrompterPartStatus | undefined,
    }),
  )
  return { parts }
}

export function validatePrompterJSON(errors: string[], value: unknown, slideId: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    errors.push(`Slide "${slideId}" prompter must be an object`)
    return
  }
  const v = value as Record<string, unknown>
  if (!Array.isArray(v.parts)) {
    errors.push(`Slide "${slideId}" prompter.parts must be an array`)
    return
  }
  const ids = new Set<string>()
  let expectedStart = 0
  for (let i = 0; i < v.parts.length; i++) {
    const part = v.parts[i] as Record<string, unknown>
    const where = `Slide "${slideId}" prompter.parts[${i}]`
    if (typeof part !== 'object' || part === null || Array.isArray(part)) {
      errors.push(`${where} must be an object`)
      continue
    }
    if (typeof part.id !== 'string' || part.id === '')
      errors.push(`${where} id must be a non-empty string`)
    else if (ids.has(part.id)) errors.push(`Duplicate prompter part id: ${part.id}`)
    else ids.add(part.id)
    if (typeof part.text !== 'string') errors.push(`${where} text must be a string`)
    if (
      typeof part.startTime !== 'number' ||
      !Number.isFinite(part.startTime) ||
      part.startTime < 0
    )
      errors.push(`${where} startTime must be a non-negative finite number`)
    if (typeof part.endTime !== 'number' || !Number.isFinite(part.endTime) || part.endTime < 0)
      errors.push(`${where} endTime must be a non-negative finite number`)
    if (typeof part.duration !== 'number' || !Number.isFinite(part.duration) || part.duration < 0)
      errors.push(`${where} duration must be a non-negative finite number`)
    if (
      typeof part.startTime === 'number' &&
      typeof part.endTime === 'number' &&
      typeof part.duration === 'number'
    ) {
      if (Math.abs(part.duration - (part.endTime - part.startTime)) > PROMPTER_DURATION_TOLERANCE)
        errors.push(`${where} duration must equal endTime - startTime`)
      // Allow gaps (user can leave space between parts or before first), but forbid overlaps and require sorted order
      if (part.startTime < expectedStart - PROMPTER_DURATION_TOLERANCE) {
        errors.push(
          `${where} startTime must not overlap previous end (previous end ${expectedStart}, got ${part.startTime})`,
        )
      }
      // For sorted check, ensure startTime >= previous startTime (already via expectedStart) — gaps allowed
      expectedStart = Math.max(expectedStart, part.endTime)
    }
    if (
      part.audioClipId !== undefined &&
      (typeof part.audioClipId !== 'string' || part.audioClipId === '')
    )
      errors.push(`${where} audioClipId must be a non-empty string`)
    if (
      part.audioAssetId !== undefined &&
      (typeof part.audioAssetId !== 'string' || part.audioAssetId === '')
    )
      errors.push(`${where} audioAssetId must be a non-empty string`)
    if (part.promptId !== undefined && (typeof part.promptId !== 'string' || part.promptId === ''))
      errors.push(`${where} promptId must be a non-empty string`)
    if (part.status !== undefined && part.status !== 'stale')
      errors.push(`${where} status must be stale`)
  }
}
