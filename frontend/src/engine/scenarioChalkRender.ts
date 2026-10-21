/**
 * Scenario chalk render pure seam (issue #464).
 *
 * Deterministic client-side markdown → static blackboard HTML. No I/O, no
 * backend model call, no engine access — tested at the pure seam.
 *
 * Contract (from #459 generation decision):
 * - One mandatory chalk theme (Crayon Libre headings + body, fixed
 *   chalk tokens on a repeating tilable board tile, grain + wobble borders,
 *   offline embedded fonts, print fallback) with no picker or variant.
 * - Static single scrolling page: one `<section>` per `## Step N` heading in
 *   markdown order, blocks narrator → visuals → table → text (+ standalone
 *   `label` blocks for orphan `> Label:` lines), skipped sections for
 *   missing optional blocks, never erroring on sparse steps.
 * - Standalone reading document, not video cues: the `**Narrator:**` role
 *   prefix renders as a plain paragraph without the marker word, and each
 *   `> Label:` board text renders as the caption directly beneath its own
 *   image (no "Label:" marker word) — centered, enlarged, and cycling the
 *   chalk accent palette by figure order — never piled far from its figure.
 *   Content blocks keep document order — visuals, text, and tables
 *   interleaved as authored. Briefs stay in markdown (plus manifest
 *   metadata) and reuse names stay internal and unrendered.
 * - Lively but deterministic color: step headings cycle the chalk accent
 *   palette by step index; figure labels, standalone labels, and body copy
 *   share one page-wide cycle in document order. `**bold**` author-marked
 *   foreign words render
 *   as `<strong class="foreign">` highlights (plus the Spanish column of
 *   Spanish|English tables). Narrator sentences additionally highlight an
 *   LLM-provided foreign word/phrase list (`foreignWords` option), matched
 *   verbatim and case-insensitively against each sentence — the model
 *   detects, the render only spans. Identical inputs yield byte-identical
 *   HTML.
 * - No scripts, no timeline playback, no runtime fetches, relative
 *   `assets/` paths only, file-protocol safe.
 * - Page images reference the assets folder by slug filename with free-text
 *   alt preserved.
 */

import { normalizeAssetKey, parseScenarioMarkdown } from './scenarioMarkdown'
import type { ScenarioVisual } from './scenarioMarkdown'

export interface ScenarioChalkRenderOptions {
  /** Normalized asset key → filename inside `assets/` (e.g. `cat.png`). */
  readonly imageFiles: Readonly<Record<string, string>>
  /** Page `<title>` override; defaults to the first H1 or `Scenario`. */
  readonly title?: string
  /**
   * LLM-detected foreign words/phrases to highlight in narrator sentences.
   * Matched verbatim (case-insensitive, whole words/phrases) — entries never
   * leak into the output, only `<strong class="foreign">` spans around
   * existing text. Omit for marks-only rendering.
   */
  readonly foreignWords?: readonly string[]
  /**
   * Rewrite for one `assets/`-relative reference: bound image filenames
   * (`young-doctor.png`) plus theme keys (`fonts/….woff2`, `board-tile.png`).
   * Defaults to the portable `assets/<file>` relative path (zip context).
   * The modal preview passes a resolver returning `data:` URIs instead:
   * `srcDoc` iframes inherit the app origin as their base URL, so relative
   * `assets/` paths 404 there and every image — plus fonts and the board
   * tile — renders broken even with all bytes bound.
   */
  readonly resolveAssetUrl?: (file: string) => string
}

const KNOWN_MIME_EXT: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Safe filename stem mirroring the normalized asset key.
 * Lowercase, runs of non `[a-z0-9]` collapse to one hyphen, trimmed.
 */
export function slugFilenameForAssetKey(key: string): string {
  const normalized = normalizeAssetKey(key || '')
  const slugged = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slugged || 'visual'
}

/** Extension without dot, lowercased; `png` fallback. */
export function extensionFromMimeOrFilename(mime?: string, filename?: string): string {
  const cleanMime = (mime || '').trim().toLowerCase()
  if (cleanMime && KNOWN_MIME_EXT[cleanMime]) return KNOWN_MIME_EXT[cleanMime]!
  const hint = (filename || '').trim()
  const dot = hint.lastIndexOf('.')
  if (dot >= 0 && dot < hint.length - 1) {
    const raw = hint
      .slice(dot + 1)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
    if (raw.length >= 2 && raw.length <= 5) {
      if (raw === 'jpeg') return 'jpg'
      return raw
    }
  }
  if (cleanMime.startsWith('image/')) {
    const subtype = cleanMime
      .slice('image/'.length)
      .split(/[+;]/)[0]!
      .replace(/[^a-z0-9]/g, '')
    if (subtype.length >= 2 && subtype.length <= 5) {
      if (subtype === 'jpeg') return 'jpg'
      return subtype
    }
  }
  return 'png'
}

/**
 * Filename (`stem.ext`) for one normalized key, suffixed `-2`, `-3`, …
 * when `taken` already holds the candidate.
 */
export function scenarioImageFilename(
  key: string,
  mimeOrFilename?: string,
  taken?: ReadonlySet<string> | readonly string[],
): string {
  const stem = slugFilenameForAssetKey(key)
  const hint = mimeOrFilename || ''
  const ext = hint.includes('/')
    ? extensionFromMimeOrFilename(hint, undefined)
    : extensionFromMimeOrFilename(undefined, hint || undefined)
  const owned: Set<string> = taken instanceof Set ? taken : new Set(taken ?? [])
  let candidate = `${stem}.${ext}`
  let counter = 2
  while (owned.has(candidate)) {
    candidate = `${stem}-${counter}.${ext}`
    counter += 1
  }
  return candidate
}

/**
 * Deterministic key → filename map in first-appearance order.
 * Duplicate keys collapse (checklist dedupes); distinct keys slugging to
 * the same filename gain numeric suffixes so zip entries never collide.
 */
export function buildScenarioImageFiles(
  keys: readonly string[],
  resolve: (key: string) => { readonly mime?: string; readonly filenameHint?: string } | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  const taken = new Set<string>()
  for (const key of keys) {
    if (!key || key in out) continue
    const hint = resolve(key)
    const ext = extensionFromMimeOrFilename(hint?.mime, hint?.filenameHint)
    const stem = slugFilenameForAssetKey(key)
    let candidate = `${stem}.${ext}`
    let counter = 2
    while (taken.has(candidate)) {
      candidate = `${stem}-${counter}.${ext}`
      counter += 1
    }
    taken.add(candidate)
    out[key] = candidate
  }
  return out
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim()
  const inner = trimmed.startsWith('|') && trimmed.endsWith('|') ? trimmed.slice(1, -1) : trimmed
  return inner.split('|').map((c) => c.trim())
}

/**
 * Inline text: HTML-escaped, with `**word**` (author-marked foreign words
 * inside base-language text) rendered as colored `<strong class="foreign">`
 * highlights. Unmatched asterisks pass through literally.
 */
const MARKED_SPAN_RE = /\*\*(.+?)\*\*/g
function renderInline(text: string): string {
  return escapeHtml(text).replace(MARKED_SPAN_RE, (_match, inner: string) => {
    return `<strong class="foreign">${inner}</strong>`
  })
}

/** Escape a literal for embedding in a RegExp alternation. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const MAX_FOREIGN_WORDS = 200
const MAX_FOREIGN_WORD_CHARS = 120

/**
 * Normalize an LLM-returned foreign word/phrase list for matching: trim,
 * drop empties and overlong entries, dedupe case-insensitively (first
 * casing wins), longest-first so phrases beat their subwords. Pure;
 * tested directly.
 */
export function normalizeForeignWords(words: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of words) {
    if (typeof raw !== 'string') continue
    const cleaned = raw.replace(/\s+/g, ' ').trim()
    if (cleaned === '' || cleaned.length > MAX_FOREIGN_WORD_CHARS) continue
    const key = cleaned.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(cleaned)
  }
  out.sort((a, b) => b.length - a.length)
  return out.slice(0, MAX_FOREIGN_WORDS)
}

/**
 * Non-overlapping match ranges of the foreign list inside raw text.
 * Case-insensitive, whole-word/phrase boundaries on both ends (single
 * letters included — the list is authoritative), longest-first so
 * `de roble` wins over `roble`. Pure; tested directly.
 */
export function findForeignSpans(
  text: string,
  words: readonly string[],
): Array<{ start: number; end: number }> {
  const normalized = normalizeForeignWords(words)
  if (normalized.length === 0 || text === '') return []
  const pattern = normalized.map(escapeRegExp).join('|')
  let matcher: RegExp
  try {
    matcher = new RegExp(`(?<![\\p{L}\\p{M}])(?:${pattern})(?![\\p{L}\\p{M}])`, 'giu')
  } catch {
    return []
  }
  const spans: Array<{ start: number; end: number }> = []
  let match: RegExpExecArray | null
  matcher.lastIndex = 0
  while ((match = matcher.exec(text)) !== null) {
    if (match[0] === '') break
    spans.push({ start: match.index, end: match.index + match[0].length })
  }
  return spans
}

/** Wrap foreign spans in highlight tags; everything else HTML-escaped. */
function applyForeignSpans(text: string, words: readonly string[]): string {
  const spans = findForeignSpans(text, words)
  if (spans.length === 0) return escapeHtml(text)
  let out = ''
  let cursor = 0
  for (const span of spans) {
    if (span.start < cursor) continue
    out += escapeHtml(text.slice(cursor, span.start))
    out += `<strong class="foreign">${escapeHtml(text.slice(span.start, span.end))}</strong>`
    cursor = span.end
  }
  out += escapeHtml(text.slice(cursor))
  return out
}

/**
 * Narrator sentence rendering: author `**marks**` highlight as before,
 * plus the LLM-detected foreign word/phrase list matched verbatim against
 * each sentence (case-insensitive, whole words/phrases only — list entries
 * never leak into the output, only spans around existing text).
 */
function renderNarrator(text: string, foreignWords: readonly string[]): string {
  const segments = text.split(/(\*\*.+?\*\*)/g)
  return segments
    .map((segment) => {
      const markedMatch = /^\*\*(.+)\*\*$/s.exec(segment)
      if (markedMatch) {
        return `<strong class="foreign">${escapeHtml(markedMatch[1])}</strong>`
      }
      return applyForeignSpans(segment, foreignWords)
    })
    .join('')
}

function renderTable(tableMarkdown: string): string {
  const lines = tableMarkdown
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length < 2) {
    return `<p class="chalk-text">${renderInline(tableMarkdown)}</p>`
  }
  const header = splitTableCells(lines[0]!)
  const bodyRows = lines.slice(2).map(splitTableCells)
  // A Spanish|English vocabulary table: highlight the Spanish body column.
  const spanishFirstCol = header.length > 1 && header[0]!.trim().toLowerCase() === 'spanish'
  const head = header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')
  const body = bodyRows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, index) => {
            const inner = renderInline(cell)
            const highlighted =
              spanishFirstCol && index === 0 && cell.trim() !== '' && !/\*\*/.test(cell)
                ? `<strong class="foreign">${inner}</strong>`
                : inner
            return `<td>${highlighted}</td>`
          })
          .join('')}</tr>`,
    )
    .join('')
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

function renderParagraphs(text: string): string {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p) => `<p class="chalk-text">${renderInline(p)}</p>`)
    .join('\n')
}

/**
 * Chalk theme assets: Crayon Libre (Public Domain, Regular + Italic) for
 * headings and body, plus a tilable dark-board PNG repeating behind the
 * page. Zip paths are the portable contract (`assets/`-relative); the
 * preview rewriter maps the same assets-relative keys to `data:` URIs
 * because a `srcDoc` iframe inherits the app origin, where relative
 * `assets/` URLs 404 — exactly like the bound image bytes.
 */
export const SCENARIO_THEME_FONT_FAMILY = 'Crayon Libre'
export const SCENARIO_THEME_FONT_FILES = {
  regular: 'crayon-libre-regular.woff2',
  italic: 'crayon-libre-italic.woff2',
} as const
/** Zip paths of the embedded woff2 binaries. */
export const SCENARIO_THEME_FONT_ZIP_PATHS = [
  `assets/fonts/${SCENARIO_THEME_FONT_FILES.regular}`,
  `assets/fonts/${SCENARIO_THEME_FONT_FILES.italic}`,
] as const
/** Zip path of the repeating board background tile. */
export const SCENARIO_THEME_BOARD_TILE_ZIP_PATH = 'assets/board-tile.png'

/** Assets-relative key (`assets/` prefix stripped) for the preview rewriter. */
export function scenarioThemeAssetKey(zipPath: string): string {
  return zipPath.replace(/^assets\//, '')
}

function themeUrl(assetsRelative: string, resolveAssetUrl?: (file: string) => string): string {
  return resolveAssetUrl ? resolveAssetUrl(assetsRelative) : `assets/${assetsRelative}`
}

/**
 * Chalk theme stylesheet. Without a resolver every `url()` is a portable
 * relative `assets/` path (zip context); the modal preview passes the same
 * resolver it uses for bound images so fonts and the board tile embed as
 * `data:` URIs instead of 404ing.
 */
export function buildScenarioChalkCss(resolveAssetUrl?: (file: string) => string): string {
  const fontRegular = themeUrl(`fonts/${SCENARIO_THEME_FONT_FILES.regular}`, resolveAssetUrl)
  const fontItalic = themeUrl(`fonts/${SCENARIO_THEME_FONT_FILES.italic}`, resolveAssetUrl)
  const boardTile = themeUrl('board-tile.png', resolveAssetUrl)
  return [
    ':root {',
    '  color-scheme: dark;',
    '  --board: #20302A;',
    '  --chalk: #F4F1E8;',
    '  --chalk-dim: #C9CFC4;',
    '  --chalk-yellow: #F2D98C;',
    '  --chalk-pink: #F2A9C4;',
    '  --chalk-blue: #A9CDF2;',
    '  --chalk-green: #A8D5A2;',
    '  --chalk-orange: #F2B880;',
    '  --board-line: rgba(244,241,232,.55);',
    `  --font-head: '${SCENARIO_THEME_FONT_FAMILY}', cursive;`,
    `  --font-body: '${SCENARIO_THEME_FONT_FAMILY}', cursive, system-ui;`,
    '}',
    `@font-face { font-family: '${SCENARIO_THEME_FONT_FAMILY}'; font-style: normal; font-weight: 400; font-display: swap; src: url('${fontRegular}') format('woff2'); unicode-range: U+0000-00FF, U+0100-024F; }`,
    `@font-face { font-family: '${SCENARIO_THEME_FONT_FAMILY}'; font-style: italic; font-weight: 400; font-display: swap; src: url('${fontItalic}') format('woff2'); unicode-range: U+0000-00FF, U+0100-024F; }`,
    'html { background: var(--board); }',
    `body { background-color: var(--board); background-image: url('${boardTile}'); background-repeat: repeat; color: var(--chalk); font-family: var(--font-body); line-height: 1.5; margin: 0; padding: 32px 16px 64px; }`,
    '.grain { position: fixed; inset: 0; pointer-events: none; opacity: 1; background-image: url("data:image/svg+xml,%3Csvg xmlns=%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27 width=%27120%27 height=%27120%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.9%27 numOctaves=%272%27/%3E%3C/filter%3E%3Crect width=%27120%27 height=%27120%27 filter=%27url(%23n)%27 opacity=%270.05%27/%3E%3C/svg%3E"), radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.28) 100%); }',
    'main { max-width: 70ch; margin: 0 auto; }',
    'h1 { font-family: var(--font-head); font-weight: 700; line-height: 1.2; letter-spacing: .01em; text-shadow: 0 0 1px currentColor; }',
    'section.step { border: 2px solid var(--board-line); border-radius: 255px 15px 225px 15px/15px 225px 15px 255px; padding: 20px 22px; margin: 0 0 28px; }',
    'section.step h2 { font-family: var(--font-head); font-weight: 700; line-height: 1.2; margin: 0 0 12px; }',
    '.accent-yellow { color: var(--chalk-yellow); }',
    '.accent-pink { color: var(--chalk-pink); }',
    '.accent-blue { color: var(--chalk-blue); }',
    '.accent-green { color: var(--chalk-green); }',
    '.accent-orange { color: var(--chalk-orange); }',
    'p.narrator { color: var(--chalk); font-size: 1.08em; }',
    'p.chalk-text { font-size: 1.3em; text-align: right; }',
    'strong.foreign { color: var(--chalk-pink); }',
    'figure.visual { margin: 16px 0; border: 2px solid var(--board-line); border-radius: 255px 15px 225px 15px/15px 225px 15px 255px; padding: 10px; }',
    'figure.visual img { display: block; max-width: 100%; height: auto; border-radius: 12px; }',
    'figure.visual figcaption { font-size: 1.15em; margin-top: 6px; text-align: center; }',
    'p.board-label { font-size: 1.15em; margin: 16px 0; text-align: center; }',
    '.table-wrap { overflow-x: auto; margin: 16px 0; }',
    'table { border-collapse: collapse; width: 100%; }',
    'th, td { border: 1px solid var(--board-line); padding: 8px 10px; text-align: left; }',
    'th { font-family: var(--font-head); color: var(--chalk-yellow); }',
    'td { color: var(--chalk); }',
    'a { color: var(--chalk-blue); }',
    '@media print { body { background: #fff; background-image: none; color: #000; } .grain { display: none; } section.step, figure.visual { border-color: #000; } th, td { border-color: #000; } th { color: #000; } p.narrator { color: #000; } strong.foreign { color: #000; } section.step h2 { color: #000; } figure.visual figcaption { color: #000; } p.board-label { color: #000; } }',
    '@media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; } }',
  ].join('\n')
}

const CHALK_CSS = buildScenarioChalkCss()

function pageTitle(markdown: string, override?: string): string {
  if (override && override.trim() !== '') return override.trim()
  const firstH1 = (markdown || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^#\s+/.test(l))
  if (firstH1) {
    const text = firstH1.replace(/^#\s+/, '').trim()
    if (text !== '') return text
  }
  return 'Scenario'
}

/**
 * Step-heading accent, cycling the chalk palette by step index so the page
 * reads lively but stays byte-deterministic for identical inputs.
 */
const STEP_ACCENTS = [
  'accent-yellow',
  'accent-pink',
  'accent-blue',
  'accent-green',
  'accent-orange',
] as const

function stepAccentClass(index: number): string {
  const at = (((index - 1) % STEP_ACCENTS.length) + STEP_ACCENTS.length) % STEP_ACCENTS.length
  return STEP_ACCENTS[at]!
}

/**
 * One figure with its label captioned directly beneath it, so the
 * image↔label connection is obvious. No "Label:" marker word — the label
 * content alone is the caption, centered and enlarged. Each label cycles
 * the chalk accent palette by a page-wide ordinal shared with standalone
 * labels (deterministic: identical inputs yield byte-identical HTML).
 * Figures without a label render bare.
 */
function renderFigure(
  visual: ScenarioVisual,
  imageFiles: Readonly<Record<string, string>>,
  resolveAssetUrl: ((file: string) => string) | undefined,
  accentOrdinal: number,
): string {
  const file = imageFiles[visual.key] ?? `${slugFilenameForAssetKey(visual.key)}.png`
  const src = resolveAssetUrl ? resolveAssetUrl(file) : `assets/${file.replace(/^assets\//, '')}`
  const alt = escapeHtml(visual.alt)
  const caption =
    visual.label !== undefined && visual.label.trim() !== ''
      ? `<figcaption class="${stepAccentClass(accentOrdinal)}">${renderInline(visual.label)}</figcaption>`
      : ''
  return `<figure class="visual"><img src="${escapeHtml(src)}" alt="${alt}" loading="lazy">${caption}</figure>`
}

/**
 * Render the current markdown plus resolved asset filenames to a static
 * single scrolling blackboard page. Deterministic: identical inputs yield
 * byte-identical HTML. Never throws on sparse steps.
 */
export function renderScenarioChalkHtml(
  markdown: string,
  options: ScenarioChalkRenderOptions,
): string {
  const source = markdown || ''
  const imageFiles = options.imageFiles ?? {}
  let steps: ReturnType<typeof parseScenarioMarkdown>['steps'] = []
  try {
    steps = parseScenarioMarkdown(source).steps
  } catch {
    steps = []
  }
  const title = pageTitle(source, options.title)
  const foreignWords = options.foreignWords ?? []

  // Page-wide accent ordinal in document order. Figures and standalone
  // (orphan) labels share one cycle so neighbouring labels always differ.
  let accentOrdinal = 0
  const renderNextFigure = (visual: ScenarioVisual): string => {
    accentOrdinal += 1
    return renderFigure(visual, imageFiles, options.resolveAssetUrl, accentOrdinal)
  }

  const sections = steps.map((step) => {
    const parts: string[] = []
    parts.push(
      `<h2 class="${stepAccentClass(step.index)}">Step ${step.index} — ${escapeHtml(step.title)}</h2>`,
    )
    if (step.narrator !== undefined) {
      parts.push(`<p class="narrator">${renderNarrator(step.narrator, foreignWords)}</p>`)
    }
    // Document order: visuals, text paragraphs, and tables interleaved as
    // authored, so each image sits directly above its own label caption
    // instead of all images piling up first and all text after.
    if (step.blocks.length > 0) {
      for (const block of step.blocks) {
        if (block.kind === 'visual') {
          parts.push(renderNextFigure(block.visual))
        } else if (block.kind === 'table') {
          parts.push(renderTable(block.table))
        } else if (block.kind === 'label') {
          // Standalone (orphan) label: no figure to caption, so it renders
          // as its own centered paragraph with the same label styling.
          accentOrdinal += 1
          parts.push(
            `<p class="board-label ${stepAccentClass(accentOrdinal)}">${renderInline(block.text)}</p>`,
          )
        } else {
          // Body copy shares the page-wide accent cycle with labels.
          accentOrdinal += 1
          parts.push(
            `<p class="chalk-text ${stepAccentClass(accentOrdinal)}">${renderInline(block.text)}</p>`,
          )
        }
      }
    } else {
      // Defensive fallback for steps built without blocks: legacy grouping.
      for (const visual of step.visuals) {
        parts.push(renderNextFigure(visual))
      }
      if (step.table !== undefined) {
        parts.push(renderTable(step.table))
      }
      if (step.text !== undefined) {
        parts.push(renderParagraphs(step.text))
      }
    }
    return `<section class="step" data-step="${step.index}">\n${parts.join('\n')}\n</section>`
  })

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    '<style>',
    options.resolveAssetUrl ? buildScenarioChalkCss(options.resolveAssetUrl) : CHALK_CSS,
    '</style>',
    '</head>',
    '<body>',
    '<div class="grain" aria-hidden="true"></div>',
    '<main>',
    `<h1>${escapeHtml(title)}</h1>`,
    ...sections,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n')
}
