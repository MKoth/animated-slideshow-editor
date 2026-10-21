/**
 * Scenario portable zip pure seam (issue #465).
 *
 * Self-contained blackboard pack: top-level page + `assets/` images +
 * embedded fonts + license text + manifest port contract. Deterministic
 * client-side build with no backend model call — the zip exporter is a
 * separate builder from lesson download, sharing only the embedded-asset
 * guarantee (bytes resolve from embedded/library snapshots, never synthesized).
 *
 * Port contract:
 * - `index.html` — static chalk page from `renderScenarioChalkHtml`.
 * - `assets/<stem>.<ext>` — one file per normalized asset key.
 * - `assets/board-tile.png` — repeating board background referenced by the
 *   chalk theme CSS.
 * - `assets/fonts/*.woff2` — Crayon Libre binaries matching the
 *   `@font-face` URLs in the chalk theme (real bytes passed in via
 *   `themeFiles`; deterministic placeholder stubs when omitted, e.g. tests).
 * - `assets/fonts/FONT-LICENSE.txt` — theme license attribution.
 * - `manifest.json` — `{ format, generator, page, visuals[], fonts[] }`
 *   where each visual carries the authoritative normalized `asset` key plus
 *   `file` and `mime` (and `alt`/`brief`/`label` metadata; reuse names stay internal
 *   and are never shipped).
 *
 * Guarantees:
 * - Filenames derive from the normalized-key transform with `-2`, `-3`, …
 *   collision and sanitization against traversal and control characters;
 *   the manifest `asset` name (normalized key) is authoritative, never the
 *   filename.
 * - The page passes a relative-path-only scan rejecting remote URL patterns
 *   before zipping; file-protocol open with network disabled shows zero
 *   failed requests (every `src`/`url()` resolves inside the zip).
 * - Already-compressed images (png/jpg/webp/gif/avif), woff2 fonts, and the
 *   board tile store without recompression while the page and manifest
 *   deflate; sizes warn around
 *   100MB and block around 500MB, and large packs yield to the event loop
 *   while resolving bytes so failure is graceful, never silent corruption.
 */

import { zipSync, strToU8 } from 'fflate'
import {
  SCENARIO_THEME_BOARD_TILE_ZIP_PATH,
  SCENARIO_THEME_FONT_FAMILY,
  SCENARIO_THEME_FONT_ZIP_PATHS,
  buildScenarioImageFiles,
  extensionFromMimeOrFilename,
  renderScenarioChalkHtml,
  slugFilenameForAssetKey,
} from './scenarioChalkRender'
import { parseScenarioMarkdown } from './scenarioMarkdown'

export const SCENARIO_ZIP_FORMAT = 'scenario-blackboard-pack/1'
export const SCENARIO_ZIP_PAGE_NAME = 'index.html'
export const SCENARIO_ZIP_MANIFEST_NAME = 'manifest.json'
export const SCENARIO_ZIP_GENERATOR = 'animated-slideshow-editor scenario-blackboard-pack/1'
export const SCENARIO_ZIP_WARN_BYTES = 100 * 1024 * 1024
export const SCENARIO_ZIP_BLOCK_BYTES = 500 * 1024 * 1024

/** Fixed mtime so identical inputs yield byte-identical zips. */
const SCENARIO_ZIP_MTIME = new Date('1980-01-01T00:00:00Z')

const SCENARIO_ZIP_FONT_FILES = SCENARIO_THEME_FONT_ZIP_PATHS

const SCENARIO_ZIP_BOARD_TILE_FILE = SCENARIO_THEME_BOARD_TILE_ZIP_PATH

const SCENARIO_ZIP_LICENSE_FILE = 'assets/fonts/FONT-LICENSE.txt'

const SCENARIO_ZIP_LICENSE_TEXT = [
  'Scenario blackboard pack — embedded theme licenses',
  '',
  `Chalk typeface: "${SCENARIO_THEME_FONT_FAMILY}" (Regular + Italic) by GGBotNet,`,
  'released as Public Domain (source:',
  'https://www.fontspace.com/crayon-libre-font-f105058). Embedded under',
  'assets/fonts/ as WOFF2 for the portable page @font-face rules.',
  '',
  'Background tile: assets/board-tile.png repeats behind the page',
  '(background-color #20302A fallback).',
  '',
  'Reuse names from the scenario doc stay internal to the editor and are',
  'never shipped in this pack.',
  '',
].join('\n')

export interface ScenarioZipImageBytes {
  readonly bytes: Uint8Array
  readonly mime: string
  readonly alt?: string
  readonly brief?: string
}

export interface ScenarioZipManifestVisual {
  readonly asset: string
  readonly alt: string
  readonly file: string
  readonly mime: string
  readonly brief?: string
  readonly label?: string
}

export interface ScenarioZipManifest {
  readonly format: string
  readonly generator: string
  readonly page: string
  readonly visuals: readonly ScenarioZipManifestVisual[]
  readonly fonts: readonly { readonly file: string; readonly license: string }[]
}

export interface ScenarioPortablePackInput {
  readonly markdown: string
  readonly imageFiles: Readonly<Record<string, string>>
  readonly imageBytes: Readonly<Record<string, ScenarioZipImageBytes>>
  readonly title?: string
  readonly generator?: string
  /** LLM-detected foreign words/phrases for narrator highlights (stored at Generate). */
  readonly foreignWords?: readonly string[]
  /**
   * Real theme bytes keyed by zip path (`assets/fonts/….woff2`,
   * `assets/board-tile.png`). The modal resolves these from the served
   * `scenario-theme/` files at download time; when omitted (e.g. unit
   * tests) deterministic placeholder stubs keep the pack shape stable.
   */
  readonly themeFiles?: Readonly<Record<string, Uint8Array>>
  /** Test-only total-byte override to exercise warn/block gates without 500MB fixtures. */
  readonly sizeOverrideForTest?: number
}

export interface ScenarioPortablePack {
  readonly pageName: string
  readonly manifestName: string
  readonly pageHtml: string
  readonly manifest: ScenarioZipManifest
  readonly files: Readonly<Record<string, Uint8Array>>
  readonly compression: Readonly<Record<string, 'deflate' | 'store'>>
  readonly imageFiles: Readonly<Record<string, string>>
  readonly totalBytes: number
  readonly sizeStatus: 'ok' | 'warn'
  readonly sizeWarning?: string
}

/**
 * Safe filename (`stem.ext`) for one normalized key. Mirrors
 * `scenarioImageFilename` then strips anything that could escape `assets/`:
 * traversal (`..`, `/`, `\`), leading dots, and control characters.
 */
export function sanitizeScenarioZipFilename(key: string, mimeOrFilename?: string): string {
  const ext = (mimeOrFilename ?? '').includes('/')
    ? extensionFromMimeOrFilename(mimeOrFilename, undefined)
    : extensionFromMimeOrFilename(undefined, mimeOrFilename || undefined)
  let stem = slugFilenameForAssetKey(key)
  // Belt-and-braces: the normalized-key stem is already `[a-z0-9-]`, but
  // key transform did not anticipate (controls, unicode, dots, slashes).
  stem = stem
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (stem === '' || stem === '.' || stem === '..') stem = 'visual'
  // Never allow traversal even if a future stem change regresses.
  stem = stem.replace(/\.+/g, '-').replace(/^-+|-+$/g, '') || 'visual'
  return `${stem}.${ext}`
}

/** Normalized asset keys in markdown first-appearance order (checklist source of truth). */
function orderedScenarioKeys(markdown: string): string[] {
  const parsed = parseScenarioMarkdown(markdown || '')
  const keys: string[] = []
  for (const step of parsed.steps) {
    for (const visual of step.visuals) {
      if (visual.key === '' || keys.includes(visual.key)) continue
      keys.push(visual.key)
    }
  }
  return keys
}

/** Total uncompressed bytes across pack files. */
export function estimateScenarioZipBytes(files: Readonly<Record<string, Uint8Array>>): number {
  let total = 0
  for (const bytes of Object.values(files)) total += bytes.length
  return total
}

export function checkScenarioZipSize(totalBytes: number): {
  readonly status: 'ok' | 'warn' | 'block'
  readonly message?: string
} {
  if (totalBytes > SCENARIO_ZIP_BLOCK_BYTES) {
    return {
      status: 'block',
      message: `Scenario pack is ${(totalBytes / 1024 / 1024).toFixed(1)}MB — over the 500MB block limit; remove or downscale visuals and retry.`,
    }
  }
  if (totalBytes > SCENARIO_ZIP_WARN_BYTES) {
    return {
      status: 'warn',
      message: `Scenario pack is ${(totalBytes / 1024 / 1024).toFixed(1)}MB — over the 100MB warning threshold; the download still proceeds.`,
    }
  }
  return { status: 'ok' }
}

/** Remote-URL / non-portable patterns rejected before zipping. */
export function listScenarioHtmlPortabilityViolations(html: string): string[] {
  const violations: string[] = []
  const lower = html.toLowerCase()
  if (lower.includes('<script')) violations.push('page must not contain <script')
  if (html.includes('fetch(')) violations.push('page must not contain fetch(')
  if (html.includes('http://') || html.includes('https://')) {
    violations.push('page must not contain remote http(s) URLs')
  }
  if (/<\s*(img|source|video|audio)[^>]*\s+src\s*=\s*["']\s*\/\//i.test(html)) {
    violations.push('page must not contain protocol-relative src URLs')
  }
  if (/\bhref\s*=\s*["']\s*https?:/i.test(html) || /\bhref\s*=\s*["']\s*\/\//i.test(html)) {
    violations.push('page must not contain remote href URLs')
  }
  if (/\burl\s*\(\s*["']?\s*https?:/i.test(html) || /\burl\s*\(\s*["']?\s*\/\//i.test(html)) {
    violations.push('page must not contain remote url() references')
  }
  if (/@import/i.test(html)) violations.push('page must not contain @import')
  for (const match of html.matchAll(/\bsrc\s*=\s*"([^"]*)"/gi)) {
    const src = match[1] ?? ''
    if (src.startsWith('data:')) {
      violations.push(
        `page src must be a relative assets/ path, got data: URL (${src.slice(0, 32)}…)`,
      )
    } else if (!src.startsWith('assets/')) {
      violations.push(`page src must start with assets/, got "${src.slice(0, 80)}"`)
    }
    if (src.includes('..') || src.includes('\\')) {
      violations.push(`page src must not contain traversal, got "${src.slice(0, 80)}"`)
    }
  }
  return violations
}

/** Throw when the page is not safe to ship offline. */
export function assertScenarioHtmlPortable(html: string): void {
  const violations = listScenarioHtmlPortabilityViolations(html)
  if (violations.length > 0) {
    throw new Error(`Scenario page is not portable offline: ${violations.join('; ')}`)
  }
}

function validateImageFilename(filename: string): void {
  if (filename.includes('://') || filename.startsWith('//')) {
    throw new Error(`Scenario pack image file must be a relative filename, got "${filename}"`)
  }
  if (/^https?:/i.test(filename)) {
    throw new Error(`Scenario pack image file must be a relative filename, got "${filename}"`)
  }
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error(`Scenario pack image file must not contain traversal, got "${filename}"`)
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(filename)) {
    throw new Error(`Scenario pack image file must not contain control characters`)
  }
  if (filename.trim() === '') throw new Error('Scenario pack image file must be non-empty')
}

function themePlaceholderBytes(name: string): Uint8Array {
  return strToU8(`scenario-blackboard-pack theme placeholder for ${name}\n`)
}

/**
 * Decode base64 image bytes (embedded-asset snapshots) to a Uint8Array.
 * Works in browsers (atob) and Node (Buffer) without extra dependencies.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, '')
  const maybeBuffer = (
    globalThis as unknown as { Buffer?: { from(s: string, e: string): Uint8Array } }
  ).Buffer
  if (maybeBuffer && typeof maybeBuffer.from === 'function') {
    return new Uint8Array(maybeBuffer.from(clean, 'base64'))
  }
  const binary = atob(clean)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/** Yield to the event loop so large packs resolve without jank. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Build the deterministic portable pack: page HTML + manifest + image bytes
 * + fonts + license. Throws when bytes are missing (never ship broken image
 * references), when the page fails the relative-path-only scan, or when the
 * pack exceeds the 500MB block gate.
 */
export function buildScenarioPortablePack(input: ScenarioPortablePackInput): ScenarioPortablePack {
  const generator = input.generator ?? SCENARIO_ZIP_GENERATOR
  // Filename derivation (normalized-key stem + `-2`/`-3` collision suffixes)
  // lives in `buildScenarioImageFiles`, shared verbatim with Generate — the
  // caller passes that mapping in via `imageFiles` and this builder validates
  // it (portable, unique) rather than re-deriving, so render and zip cannot drift.
  const orderedKeys = orderedScenarioKeys(input.markdown || '')
  const parsed = parseScenarioMarkdown(input.markdown || '')
  const altByKey = new Map<string, string>()
  const briefByKey = new Map<string, string>()
  const labelByKey = new Map<string, string>()
  for (const step of parsed.steps) {
    for (const visual of step.visuals) {
      if (visual.key === '') continue
      if (!altByKey.has(visual.key)) altByKey.set(visual.key, visual.alt)
      if (visual.brief !== undefined && !briefByKey.has(visual.key)) {
        briefByKey.set(visual.key, visual.brief)
      }
      if (visual.label !== undefined && !labelByKey.has(visual.key)) {
        labelByKey.set(visual.key, visual.label)
      }
    }
  }

  // Filenames are caller-supplied (shared with Generate via
  // buildScenarioImageFiles) — validate they are portable and unique.
  const seenFiles = new Map<string, string>()
  for (const key of orderedKeys) {
    const file = input.imageFiles[key]
    if (!file) throw new Error(`Scenario pack is missing a filename for asset "${key}"`)
    validateImageFilename(file)
    const clash = seenFiles.get(file)
    if (clash !== undefined && clash !== key) {
      throw new Error(
        `Scenario pack filenames collide: "${clash}" and "${key}" both map to "${file}"`,
      )
    }
    seenFiles.set(file, key)
  }

  const pageHtml = renderScenarioChalkHtml(input.markdown || '', {
    imageFiles: input.imageFiles,
    title: input.title,
    foreignWords: input.foreignWords ?? [],
  })
  assertScenarioHtmlPortable(pageHtml)

  const visuals: ScenarioZipManifestVisual[] = []
  // Keep zip entry order deterministic: markdown first-appearance order.
  const imageEntries: Array<{ readonly path: string; readonly bytes: Uint8Array }> = []
  for (const key of orderedKeys) {
    const record = input.imageBytes[key]
    if (!record || !(record.bytes instanceof Uint8Array) || record.bytes.length === 0) {
      throw new Error(`Scenario pack is missing image bytes for asset "${key}"`)
    }
    const file = input.imageFiles[key]!
    const mime = (record.mime || '').trim() || 'image/png'
    const alt = record.alt ?? altByKey.get(key) ?? key
    const brief = record.brief ?? briefByKey.get(key)
    const label = labelByKey.get(key)
    visuals.push({
      asset: key,
      alt,
      file: `assets/${file}`,
      mime,
      ...(brief !== undefined ? { brief } : {}),
      ...(label !== undefined ? { label } : {}),
    })
    imageEntries.push({ path: `assets/${file}`, bytes: record.bytes })
  }

  const manifest: ScenarioZipManifest = {
    format: SCENARIO_ZIP_FORMAT,
    generator,
    page: SCENARIO_ZIP_PAGE_NAME,
    visuals,
    fonts: SCENARIO_ZIP_FONT_FILES.map((file) => ({ file, license: SCENARIO_ZIP_LICENSE_FILE })),
  }
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`

  const files: Record<string, Uint8Array> = {}
  const compression: Record<string, 'deflate' | 'store'> = {}
  files[SCENARIO_ZIP_PAGE_NAME] = strToU8(pageHtml)
  compression[SCENARIO_ZIP_PAGE_NAME] = 'deflate'
  files[SCENARIO_ZIP_MANIFEST_NAME] = strToU8(manifestJson)
  compression[SCENARIO_ZIP_MANIFEST_NAME] = 'deflate'
  files[SCENARIO_ZIP_LICENSE_FILE] = strToU8(SCENARIO_ZIP_LICENSE_TEXT)
  compression[SCENARIO_ZIP_LICENSE_FILE] = 'deflate'
  for (const font of SCENARIO_ZIP_FONT_FILES) {
    files[font] = input.themeFiles?.[font] ?? themePlaceholderBytes(font)
    compression[font] = 'store'
  }
  files[SCENARIO_ZIP_BOARD_TILE_FILE] =
    input.themeFiles?.[SCENARIO_ZIP_BOARD_TILE_FILE] ??
    themePlaceholderBytes(SCENARIO_ZIP_BOARD_TILE_FILE)
  compression[SCENARIO_ZIP_BOARD_TILE_FILE] = 'store'
  for (const entry of imageEntries) {
    files[entry.path] = entry.bytes
    compression[entry.path] = 'store'
  }

  const totalBytes = input.sizeOverrideForTest ?? estimateScenarioZipBytes(files)
  const gate = checkScenarioZipSize(totalBytes)
  if (gate.status === 'block') throw new Error(gate.message)
  return {
    pageName: SCENARIO_ZIP_PAGE_NAME,
    manifestName: SCENARIO_ZIP_MANIFEST_NAME,
    pageHtml,
    manifest,
    files,
    compression,
    imageFiles: { ...input.imageFiles },
    totalBytes,
    sizeStatus: gate.status === 'warn' ? 'warn' : 'ok',
    ...(gate.status === 'warn' && gate.message ? { sizeWarning: gate.message } : {}),
  }
}

/**
 * Encode a built pack to zip bytes. Page + manifest (+ license) deflate;
 * already-compressed images and woff2 fonts store. Fixed mtime keeps
 * identical inputs byte-identical.
 */
export function encodeScenarioPortableZip(pack: ScenarioPortablePack): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 | 9; mtime: Date }]> = {}
  for (const [path, bytes] of Object.entries(pack.files)) {
    const mode = pack.compression[path] ?? 'store'
    entries[path] = [bytes, { level: mode === 'deflate' ? 9 : 0, mtime: SCENARIO_ZIP_MTIME }]
  }
  return zipSync(entries, { mtime: SCENARIO_ZIP_MTIME })
}

/**
 * Resolve the ordered image filenames for a markdown doc, sharing the
 * normalized-key mapping with Generate (numeric suffixes on collision). Thin wrapper kept
 * next to the pack builder so the modal cannot drift from the pure seam.
 */
export function resolveScenarioZipImageFiles(
  markdown: string,
  resolve: (key: string) => { readonly mime?: string; readonly filenameHint?: string } | undefined,
): Record<string, string> {
  return buildScenarioImageFiles(orderedScenarioKeys(markdown), resolve)
}
