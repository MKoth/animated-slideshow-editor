/**
 * Prompt-block splitting for Generate Script (planner).
 *
 * Mirrors manual prompter import (`splitImportText`) so generated slides
 * arrive pre-split like pasted text: sentence chunks on
 * `splitChars` plus isolated foreign words/phrases as their own blocks.
 *
 * Foreign vocabulary comes from the stored chalk HTML
 * (`<strong class="foreign">…</strong>`) with fallback to the stored
 * `foreignWords` list — the render already highlights author `**marks**`,
 * the LLM list, and the Spanish table column, so parsing it captures the
 * full highlight set without another model call.
 */

import { splitImportText } from '../engine/prompter'
import { findForeignSpans } from '../engine/scenarioChalkRender'

/** Extract visible foreign phrases from chalk HTML highlights. Pure. */
export function extractForeignWordsFromHtml(html: string): string[] {
  if (typeof html !== 'string' || html === '') return []
  const out: string[] = []
  // `<strong class="foreign">…</strong>` — class may carry extra tokens,
  // quotes may be single, attributes may precede class.
  const re =
    /<strong\b[^>]*\bclass\s*=\s*["'][^"']*\bforeign\b[^"']*["'][^>]*>([\s\S]*?)<\/strong>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    const inner = (match[1] ?? '').replace(/<[^>]+>/g, '')
    const decoded = unescapeHtmlEntities(inner).replace(/\s+/g, ' ').trim()
    if (decoded !== '') out.push(decoded)
  }
  return out
}

function unescapeHtmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function combineForeignLists(primary: readonly string[], fallback: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of [primary, fallback]) {
    for (const raw of list) {
      if (typeof raw !== 'string') continue
      const cleaned = raw.replace(/\s+/g, ' ').trim()
      if (cleaned === '') continue
      const key = cleaned.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(cleaned)
    }
  }
  return out
}

/**
 * Split a step narrator into prompt-block texts:
 * 1. sentence chunks via `splitImportText` (same delimiters as manual paste),
 * 2. each chunk further split to isolate foreign spans as standalone blocks.
 *
 * Delimiters are stripped (like manual import) and whitespace-only pieces
 * are dropped. Falls back to the trimmed verbatim narrator when splitting
 * yields nothing so the slide never ends up with zero parts.
 */
export function splitNarratorToPromptParts(
  narrator: string,
  splitChars: readonly string[],
  foreignWords: readonly string[],
): string[] {
  const source = typeof narrator === 'string' ? narrator : ''
  if (source.trim() === '') return []
  const sentences = splitImportText(source, splitChars)
  const base = sentences.length > 0 ? sentences : [source.trim()].filter((t) => t !== '')
  if (foreignWords.length === 0) return base
  const out: string[] = []
  for (const sentence of base) {
    const spans = findForeignSpans(sentence, foreignWords)
    if (spans.length === 0) {
      if (sentence.trim() !== '') out.push(sentence.trim())
      continue
    }
    let cursor = 0
    for (const span of spans) {
      if (span.start < cursor) continue
      const gap = sentence.slice(cursor, span.start).replace(/\s+/g, ' ').trim()
      if (gap !== '') out.push(gap)
      const foreign = sentence.slice(span.start, span.end).replace(/\s+/g, ' ').trim()
      if (foreign !== '') out.push(foreign)
      cursor = span.end
    }
    const tail = sentence.slice(cursor).replace(/\s+/g, ' ').trim()
    if (tail !== '') out.push(tail)
  }
  if (out.length === 0) {
    const fallback = source.replace(/\s+/g, ' ').trim()
    return fallback !== '' ? [fallback] : []
  }
  return out
}

/** Resolve the effective foreign list: HTML highlights first, stored list as fallback/union. */
export function resolveForeignWords(
  html: string | undefined,
  stored: readonly string[] | undefined,
): string[] {
  const fromHtml = typeof html === 'string' && html !== '' ? extractForeignWordsFromHtml(html) : []
  const fromStored = Array.isArray(stored) ? stored.filter((w) => typeof w === 'string') : []
  return combineForeignLists(fromHtml, fromStored)
}
