/**
 * Scenario versioned edits pure seam (issue #462).
 *
 * Client mirror of `backend/app/ai/scenario_versions.py`: intent
 * classification with explicit ask/edit prefix override, one-line summary
 * plus touched-step parsing, mixed-reply splitting, line-or-block diff,
 * restore summary, and the last-writer-wins concurrency rule.
 *
 * No I/O, no engine access — tested at the pure seam. Stored version links
 * (not raw content) drive all History and chat rendering.
 */

export type ScenarioChatIntent = 'edit' | 'question-only'

export interface ParsedScenarioReply {
  readonly intent: ScenarioChatIntent
  readonly summary: string | null
  readonly touchedSteps: readonly number[]
  readonly editContent: string
  readonly questionText: string | null
}

export interface ScenarioLineDiff {
  readonly type: 'same' | 'add' | 'del'
  readonly line: string
  readonly oldLineNo: number | null
  readonly newLineNo: number | null
}

/** Concurrency rule for markdown applies: last write wins, no version check. */
export const SCENARIO_CONCURRENCY_RULE = 'last-writer-wins' as const

const ASK_PREFIX_RE = /^\s*ask\s*:/i
const EDIT_PREFIX_RE = /^\s*edit\s*:/i
const INTENT_EDIT_RE = /intent\s*:\s*edit\b/i
const INTENT_QUESTION_RE = /intent\s*:\s*question(?:-only)?\b/i
const TAG_EDIT_RE = /\[\s*edit\s*\]/i
const TAG_QUESTION_RE = /\[\s*question(?:-only)?\s*\]/i
const SUMMARY_RE = /^\s*summary\s*:\s*(.+?)\s*$/gim
const TOUCHED_RE = /^\s*(?:touched(?:-steps)?|steps)\s*:\s*(.+?)\s*$/gim
const QUESTION_HEADER_RE = /^\s*question\s*:\s*(.*)$/i
const STEP_HEADING_RE = /^##\s+Step\s+(\d+)\b/gim
const METADATA_LINE_RE = /^\s*(?:intent\s*:|summary\s*:|touched(?:-steps)?\s*:|steps\s*:)\s*.*$/i

export function parseUserPrefix(text: string): 'ask' | 'edit' | null {
  if (ASK_PREFIX_RE.test(text || '')) return 'ask'
  if (EDIT_PREFIX_RE.test(text || '')) return 'edit'
  return null
}

export function parseIntentLabel(assistantText: string): ScenarioChatIntent | null {
  const text = assistantText || ''
  let editAt = -1
  let questionAt = -1
  for (const re of [INTENT_EDIT_RE, TAG_EDIT_RE]) {
    re.lastIndex = 0
    const m = re.exec(text)
    if (m && (editAt === -1 || m.index < editAt)) editAt = m.index
  }
  for (const re of [INTENT_QUESTION_RE, TAG_QUESTION_RE]) {
    re.lastIndex = 0
    const m = re.exec(text)
    if (m && (questionAt === -1 || m.index < questionAt)) questionAt = m.index
  }
  if (editAt !== -1 && questionAt !== -1) return editAt < questionAt ? 'edit' : 'question-only'
  if (editAt !== -1) return 'edit'
  if (questionAt !== -1) return 'question-only'
  return null
}

export function classifyScenarioIntent(
  userText: string,
  assistantText: string,
): ScenarioChatIntent {
  const prefix = parseUserPrefix(userText || '')
  if (prefix === 'ask') return 'question-only'
  if (prefix === 'edit') return 'edit'
  const label = parseIntentLabel(assistantText || '')
  if (label === 'edit' || label === 'question-only') return label
  STEP_HEADING_RE.lastIndex = 0
  if (STEP_HEADING_RE.test(assistantText || '')) return 'edit'
  return 'question-only'
}

export function parseSummary(assistantText: string): string | null {
  SUMMARY_RE.lastIndex = 0
  const m = SUMMARY_RE.exec(assistantText || '')
  if (!m) return null
  const s = (m[1] ?? '').trim()
  return s || null
}

export function parseTouchedSteps(assistantText: string): number[] {
  TOUCHED_RE.lastIndex = 0
  const m = TOUCHED_RE.exec(assistantText || '')
  if (!m) return []
  const raw = m[1] ?? ''
  const out: number[] = []
  for (const token of raw.split(/[\s,;]+/)) {
    if (!token) continue
    const range = /^(\d+)-(\d+)$/.exec(token)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      const step = end >= start ? 1 : -1
      for (let n = start; step > 0 ? n <= end : n >= end; n += step) {
        if (n > 0 && !out.includes(n)) out.push(n)
      }
      continue
    }
    if (/^\d+$/.test(token)) {
      const n = Number(token)
      if (n > 0 && !out.includes(n)) out.push(n)
    }
  }
  return out
}

export function touchedStepsFromMarkdown(markdown: string): number[] {
  const seen: number[] = []
  STEP_HEADING_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = STEP_HEADING_RE.exec(markdown || '')) !== null) {
    const n = Number(m[1])
    if (!seen.includes(n)) seen.push(n)
  }
  return seen
}

export function extractQuestionText(assistantText: string): string | null {
  const lines = (assistantText || '').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const m = QUESTION_HEADER_RE.exec(lines[i]!.trim())
    if (m) {
      const head = (m[1] ?? '').trim()
      const tail = lines
        .slice(i + 1)
        .join('\n')
        .trim()
      const combined = head ? `${head}\n${tail}`.trim() : tail
      return combined || null
    }
  }
  return null
}

export function extractEditContent(assistantText: string): string {
  const lines = (assistantText || '').split('\n')
  const kept: string[] = []
  for (const line of lines) {
    if (QUESTION_HEADER_RE.test(line.trim())) break
    if (METADATA_LINE_RE.test(line)) continue
    const stripped = line.trim().toLowerCase()
    if (stripped === '[edit]' || stripped === '[question]' || stripped === '[question-only]')
      continue
    kept.push(line)
  }
  let text = kept.join('\n').trim()
  text = text.replace(/<!--\s*intent\s*:\s*(?:edit|question(?:-only)?)\s*-->/gi, '')
  text = text.replace(/\[\s*(?:edit|question(?:-only)?)\s*\]/gi, '')
  return text.trim()
}

export function parseAssistantReply(userText: string, assistantText: string): ParsedScenarioReply {
  const intent = classifyScenarioIntent(userText || '', assistantText || '')
  const questionText = extractQuestionText(assistantText || '')
  if (intent === 'question-only') {
    const content = extractEditContent(assistantText || '')
    const chatText = questionText || content || (assistantText || '').trim()
    return {
      intent,
      summary: null,
      touchedSteps: [],
      editContent: '',
      questionText: chatText || null,
    }
  }
  const editContent = extractEditContent(assistantText || '')
  let summary = parseSummary(assistantText || '')
  if (!summary) {
    const first =
      editContent
        .split('\n')
        .map((l) => l.trim())
        .find(Boolean) ?? ''
    summary = first.slice(0, 120) || 'Scenario edit'
  }
  let touched = parseTouchedSteps(assistantText || '')
  if (touched.length === 0) touched = touchedStepsFromMarkdown(editContent)
  return { intent, summary, touchedSteps: touched, editContent, questionText }
}

export function buildRestoreSummary(sourceSummary: string, sourceId: string): string {
  const short = (sourceId || '').slice(0, 8)
  const base = (sourceSummary || '').trim() || 'version'
  return `Restore ${short}: ${base}`.slice(0, 200)
}

export function diffScenarioLines(oldText: string, newText: string): ScenarioLineDiff[] {
  const oldLines = (oldText || '').split('\n')
  const newLines = (newText || '').split('\n')
  if (oldText === newText) {
    return oldLines.map((line, i) => ({
      type: 'same' as const,
      line,
      oldLineNo: i + 1,
      newLineNo: i + 1,
    }))
  }
  let head = 0
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) {
    head += 1
  }
  let tail = 0
  while (
    tail < oldLines.length - head &&
    tail < newLines.length - head &&
    oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]
  ) {
    tail += 1
  }
  const out: ScenarioLineDiff[] = []
  for (let i = 0; i < head; i += 1) {
    out.push({ type: 'same', line: oldLines[i]!, oldLineNo: i + 1, newLineNo: i + 1 })
  }
  for (let i = head; i < oldLines.length - tail; i += 1) {
    out.push({ type: 'del', line: oldLines[i]!, oldLineNo: i + 1, newLineNo: null })
  }
  for (let i = head; i < newLines.length - tail; i += 1) {
    out.push({ type: 'add', line: newLines[i]!, oldLineNo: null, newLineNo: i + 1 })
  }
  for (let o = 0; o < tail; o += 1) {
    const oldNo = oldLines.length - tail + o + 1
    const newNo = newLines.length - tail + o + 1
    out.push({
      type: 'same',
      line: oldLines[oldLines.length - tail + o]!,
      oldLineNo: oldNo,
      newLineNo: newNo,
    })
  }
  return out
}
