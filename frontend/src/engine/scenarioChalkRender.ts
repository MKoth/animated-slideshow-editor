/**
 * Scenario chalk render pure seam (issue #464).
 *
 * Deterministic client-side markdown → static blackboard HTML. No I/O, no
 * backend model call, no engine access — tested at the pure seam.
 *
 * Contract (from #459 generation decision):
 * - One mandatory chalk theme (sketch headings, handwritten body, fixed
 *   chalk tokens on dark board, grain + wobble borders, offline embedded
 *   fonts, print fallback) with no picker or variant.
 * - Static single scrolling page: one `<section>` per `## Step N` heading in
 *   markdown order, blocks narrator → visuals → table → text, skipped
 *   sections for missing optional blocks, never erroring on sparse steps.
 * - No scripts, no timeline playback, no runtime fetches, relative
 *   `assets/` paths only, file-protocol safe.
 * - Page images reference the assets folder by slug filename with free-text
 *   alt preserved; briefs stay in markdown (plus manifest metadata) and
 *   reuse names stay internal and unrendered.
 */

import { normalizeAssetKey, parseScenarioMarkdown } from './scenarioMarkdown'

export interface ScenarioChalkRenderOptions {
  /** Normalized asset key → filename inside `assets/` (e.g. `cat.png`). */
  readonly imageFiles: Readonly<Record<string, string>>
  /** Page `<title>` override; defaults to the first H1 or `Scenario`. */
  readonly title?: string
  /**
   * Rewrite for one image file reference. Defaults to the portable
   * `assets/<file>` relative path (zip context). The modal preview passes a
   * resolver returning `data:` URIs instead: `srcDoc` iframes inherit the
   * app origin as their base URL, so relative `assets/` paths 404 there and
   * every image renders broken even with all bytes bound.
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

function renderTable(tableMarkdown: string): string {
  const lines = tableMarkdown
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  if (lines.length < 2) {
    return `<p class="chalk-text">${escapeHtml(tableMarkdown)}</p>`
  }
  const header = splitTableCells(lines[0]!)
  const bodyRows = lines.slice(2).map(splitTableCells)
  const head = header.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')
  const body = bodyRows
    .map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`)
    .join('')
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

function renderParagraphs(text: string): string {
  return text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p) => `<p class="chalk-text">${escapeHtml(p)}</p>`)
    .join('\n')
}

const CHALK_CSS = [
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
  '  --board-erase: rgba(244,241,232,.08);',
  "  --font-head: 'Cabin Sketch', 'Kalam', cursive;",
  "  --font-body: 'Kalam', 'Shadows Into Light', cursive, system-ui;",
  '}',
  "@font-face { font-family: 'Cabin Sketch'; font-style: normal; font-weight: 700; font-display: swap; src: url('assets/fonts/cabin-sketch-700.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0100-024F; }",
  "@font-face { font-family: 'Kalam'; font-style: normal; font-weight: 400; font-display: swap; src: url('assets/fonts/kalam-400.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0100-024F; }",
  "@font-face { font-family: 'Kalam'; font-style: normal; font-weight: 700; font-display: swap; src: url('assets/fonts/kalam-700.woff2') format('woff2'); unicode-range: U+0000-00FF, U+0100-024F; }",
  'html { background: var(--board); }',
  'body { background: var(--board); color: var(--chalk); font-family: var(--font-body); line-height: 1.5; margin: 0; padding: 32px 16px 64px; }',
  '.grain { position: fixed; inset: 0; pointer-events: none; opacity: 1; background-image: url("data:image/svg+xml,%3Csvg xmlns=%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27 width=%27120%27 height=%27120%27%3E%3Cfilter id=%27n%27%3E%3CfeTurbulence type=%27fractalNoise%27 baseFrequency=%270.9%27 numOctaves=%272%27/%3E%3C/filter%3E%3Crect width=%27120%27 height=%27120%27 filter=%27url(%23n)%27 opacity=%270.05%27/%3E%3C/svg%3E"), radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.28) 100%); }',
  'main { max-width: 70ch; margin: 0 auto; }',
  'h1 { font-family: var(--font-head); font-weight: 700; line-height: 1.2; letter-spacing: .01em; text-shadow: 0 0 1px currentColor; }',
  'section.step { border: 2px solid var(--board-line); border-radius: 255px 15px 225px 15px/15px 225px 15px 255px; padding: 20px 22px; margin: 0 0 28px; background: var(--board-erase); }',
  'section.step h2 { font-family: var(--font-head); font-weight: 700; line-height: 1.2; margin: 0 0 12px; color: var(--chalk); }',
  'p.narrator { color: var(--chalk-dim); }',
  'p.narrator .role { color: var(--chalk-yellow); font-weight: 700; margin-right: 8px; }',
  'figure.visual { margin: 16px 0; border: 2px solid var(--board-line); border-radius: 255px 15px 225px 15px/15px 225px 15px 255px; padding: 10px; }',
  'figure.visual img { display: block; max-width: 100%; height: auto; border-radius: 12px; }',
  'figure.visual figcaption { color: var(--chalk-dim); font-size: .9em; margin-top: 6px; }',
  '.table-wrap { overflow-x: auto; margin: 16px 0; }',
  'table { border-collapse: collapse; width: 100%; }',
  'th, td { border: 1px solid var(--board-line); padding: 8px 10px; text-align: left; }',
  'th { font-family: var(--font-head); color: var(--chalk-yellow); }',
  'td { color: var(--chalk); }',
  'a { color: var(--chalk-blue); }',
  '.accent-pink { color: var(--chalk-pink); }',
  '.accent-green { color: var(--chalk-green); }',
  '.accent-orange { color: var(--chalk-orange); }',
  '@media print { body { background: #fff; color: #000; } .grain { display: none; } section.step, figure.visual { border-color: #000; background: none; } th, td { border-color: #000; } th { color: #000; } p.narrator { color: #333; } }',
  '@media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; } }',
].join('\n')

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

  const sections = steps.map((step) => {
    const parts: string[] = []
    parts.push(`<h2>Step ${step.index} — ${escapeHtml(step.title)}</h2>`)
    if (step.narrator !== undefined) {
      parts.push(
        `<p class="narrator"><span class="role">Narrator</span>${escapeHtml(step.narrator)}</p>`,
      )
    }
    for (const visual of step.visuals) {
      const file = imageFiles[visual.key] ?? `${slugFilenameForAssetKey(visual.key)}.png`
      const src = options.resolveAssetUrl
        ? options.resolveAssetUrl(file)
        : `assets/${file.replace(/^assets\//, '')}`
      const alt = escapeHtml(visual.alt)
      const caption = escapeHtml(visual.label ?? visual.alt)
      parts.push(
        `<figure class="visual"><img src="${escapeHtml(src)}" alt="${alt}" loading="lazy"><figcaption>${caption}</figcaption></figure>`,
      )
    }
    if (step.table !== undefined) {
      parts.push(renderTable(step.table))
    }
    if (step.text !== undefined) {
      parts.push(renderParagraphs(step.text))
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
    CHALK_CSS,
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
