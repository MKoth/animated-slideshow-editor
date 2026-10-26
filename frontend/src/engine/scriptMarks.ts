/**
 * Source-span edits for script `mark("...")` labels: moving a mark rewrites
 * (or inserts) its wrapping `at(t)`, renaming rewrites the definition plus
 * every `at("...")` / `markTime("...")` reference. Span-based so formatting
 * and surrounding statements are preserved verbatim.
 */

import { parseAnimationScript, type SourceSpan } from './animationScriptParser'

export interface ScriptMarkDefinition {
  readonly name: string
  readonly nameSpan: SourceSpan
  /** Whole `mark("...")` statement span (innermost, without any `at`). */
  readonly markSpan: SourceSpan
  /** Innermost wrapping `at(...)` numeric time expression span, if present. */
  readonly atTimeSpan?: SourceSpan
  /** Innermost wrapping `at("...")` marker literal span, if present. */
  readonly atMarkerSpan?: SourceSpan
}

interface TextEdit {
  readonly span: SourceSpan
  readonly text: string
}

function applyEdits(source: string, edits: readonly TextEdit[]): string {
  const ordered = [...edits].sort((a, b) => b.span.start - a.span.start)
  let out = source
  for (const edit of ordered) {
    out = out.slice(0, edit.span.start) + edit.text + out.slice(edit.span.end)
  }
  return out
}

function isNode(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.kind !== 'string') return false
  const span = record.span as { start?: unknown; end?: unknown } | undefined
  return !!span && typeof span.start === 'number' && typeof span.end === 'number'
}

/** Generic depth-first walk over parser AST nodes (plain objects). */
function walkScriptNodes(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkScriptNodes(item, visit)
    return
  }
  if (!isNode(value)) return
  visit(value)
  for (const key of Object.keys(value)) {
    if (key === 'span') continue
    walkScriptNodes(value[key], visit)
  }
}

/**
 * Top-level `mark("...")` definitions in source order, unwrapping only `at`
 * wrappers. Marks nested in parallel/repeat/function bodies are excluded —
 * they label local/loop time, not slide seconds.
 */
export function findTopLevelMarkDefinitions(source: string): ScriptMarkDefinition[] {
  const program = parseAnimationScript(source)
  const defs: ScriptMarkDefinition[] = []
  for (const statement of program.statements) {
    let node: unknown = statement
    let atTimeSpan: SourceSpan | undefined
    let atMarkerSpan: SourceSpan | undefined
    while (
      typeof node === 'object' &&
      node !== null &&
      (node as { kind?: unknown }).kind === 'at'
    ) {
      const at = node as {
        time?: { span: SourceSpan }
        marker?: string
        markerSpan?: SourceSpan
        statement: unknown
      }
      // Innermost wrapper wins (its own time overrides outer placements).
      atTimeSpan = at.time?.span
      atMarkerSpan = at.markerSpan
      node = at.statement
    }
    if (
      typeof node === 'object' &&
      node !== null &&
      (node as { kind?: unknown }).kind === 'mark' &&
      !('target' in (node as Record<string, unknown>))
    ) {
      const mark = node as { name: string; nameSpan: SourceSpan; span: SourceSpan }
      if (typeof mark.name === 'string') {
        defs.push({
          name: mark.name,
          nameSpan: mark.nameSpan,
          markSpan: mark.span,
          atTimeSpan,
          atMarkerSpan,
        })
      }
    }
  }
  return defs
}

function formatScriptTime(time: number): string {
  return String(Number(time.toFixed(2)))
}

/**
 * Move the nth top-level definition of `name` to `newTime` seconds.
 * Returns the rewritten source, or null when the definition is not found.
 */
export function moveScriptMark(
  source: string,
  name: string,
  newTime: number,
  occurrence = 0,
): string | null {
  const matches = findTopLevelMarkDefinitions(source).filter((def) => def.name === name)
  const def = matches[occurrence]
  if (!def) return null
  const text = formatScriptTime(Math.max(0, newTime))
  if (def.atTimeSpan) return applyEdits(source, [{ span: def.atTimeSpan, text }])
  if (def.atMarkerSpan) return applyEdits(source, [{ span: def.atMarkerSpan, text }])
  return applyEdits(source, [
    { span: { start: def.markSpan.start, end: def.markSpan.start }, text: `at(${text}) ` },
  ])
}

/**
 * Rename a mark definition plus every `at("...")` / `markTime("...")`
 * reference. Returns the rewritten source, or null when `oldName` defines
 * nothing. Name quoting is JSON-escaped so any string stays valid source.
 */
export function renameScriptMark(source: string, oldName: string, newName: string): string | null {
  if (oldName === newName) return source
  const program = parseAnimationScript(source)
  const edits: TextEdit[] = []
  let defined = false
  walkScriptNodes(program.statements, (node) => {
    if (node.kind === 'mark' && !('target' in node) && node.name === oldName) {
      defined = true
      edits.push({ span: node.nameSpan as SourceSpan, text: JSON.stringify(newName) })
    } else if (node.kind === 'at' && node.marker === oldName && node.markerSpan) {
      edits.push({ span: node.markerSpan as SourceSpan, text: JSON.stringify(newName) })
    } else if (
      node.kind === 'call' &&
      node.callee === 'markTime' &&
      Array.isArray(node.args) &&
      node.args.length > 0
    ) {
      const first = node.args[0] as Record<string, unknown> | undefined
      if (first && first.kind === 'string' && first.value === oldName && first.span) {
        edits.push({ span: first.span as SourceSpan, text: JSON.stringify(newName) })
      }
    }
  })
  if (!defined) return null
  return applyEdits(source, edits)
}
