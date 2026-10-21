/**
 * Scenario theme runtime bundle (Crayon Libre + board tile).
 *
 * The pure seams reference theme assets by portable `assets/`-relative zip
 * paths. The browser resolves real bytes here, fetched once from the served
 * `scenario-theme/` public files and cached for the session:
 * - the portable-zip download packs them as `themeFiles` entries,
 * - the View-HTML preview embeds them as `data:` URIs through the same
 *   `resolveAssetUrl` rewriter as the bound images (a `srcDoc` iframe
 *   inherits the app origin, where relative `assets/` paths 404).
 *
 * Failures throw — both callers treat the theme as best-effort (a notify
 * plus placeholder/fallback rendering) so a missing theme never blocks
 * Generate, View, or Download.
 */

import {
  SCENARIO_THEME_BOARD_TILE_ZIP_PATH,
  SCENARIO_THEME_FONT_ZIP_PATHS,
  scenarioThemeAssetKey,
} from './scenarioChalkRender'
import { imageBytesToDataUrl } from './scenarioImageBytes'

export interface ScenarioThemeFile {
  /** Zip entry path, e.g. `assets/fonts/crayon-libre-regular.woff2`. */
  readonly zipPath: string
  /** `resolveAssetUrl` key, e.g. `fonts/crayon-libre-regular.woff2`. */
  readonly assetKey: string
  /** Served public path, e.g. `scenario-theme/fonts/….woff2`. */
  readonly publicPath: string
  readonly mime: string
}

function themeFile(zipPath: string, mime: string): ScenarioThemeFile {
  const assetKey = scenarioThemeAssetKey(zipPath)
  return { zipPath, assetKey, publicPath: `scenario-theme/${assetKey}`, mime }
}

export const SCENARIO_THEME_FILES: readonly ScenarioThemeFile[] = [
  themeFile(SCENARIO_THEME_FONT_ZIP_PATHS[0]!, 'font/woff2'),
  themeFile(SCENARIO_THEME_FONT_ZIP_PATHS[1]!, 'font/woff2'),
  themeFile(SCENARIO_THEME_BOARD_TILE_ZIP_PATH, 'image/png'),
]

export interface ScenarioThemeBundle {
  /** Zip entry path → bytes (pass as `themeFiles` to the pack builder). */
  readonly files: Record<string, Uint8Array>
  /** `resolveAssetUrl` key → `data:` URI (merge with bound-image URIs). */
  readonly dataUris: Record<string, string>
}

function publicUrl(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/'
  const trimmed = base.endsWith('/') ? base : `${base}/`
  return `${trimmed}${path}`
}

async function fetchThemeFile(file: ScenarioThemeFile): Promise<Uint8Array> {
  const response = await fetch(publicUrl(file.publicPath))
  if (!response.ok) {
    throw new Error(`Scenario theme asset ${file.publicPath} returned ${response.status}`)
  }
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength === 0) {
    throw new Error(`Scenario theme asset ${file.publicPath} is empty`)
  }
  return new Uint8Array(buffer)
}

/** Fetch every theme file; throws on the first failure. */
export async function loadScenarioThemeFiles(): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {}
  for (const file of SCENARIO_THEME_FILES) {
    out[file.zipPath] = await fetchThemeFile(file)
  }
  return out
}

/** Fetch + encode the whole theme bundle (bytes and preview data URIs). */
export async function loadScenarioTheme(): Promise<ScenarioThemeBundle> {
  const files = await loadScenarioThemeFiles()
  const dataUris: Record<string, string> = {}
  for (const file of SCENARIO_THEME_FILES) {
    dataUris[file.assetKey] = imageBytesToDataUrl(files[file.zipPath]!, file.mime)
  }
  return { files, dataUris }
}

let cachedTheme: Promise<ScenarioThemeBundle> | null = null

/** Session-cached bundle so preview/download never refetch the tile per click. */
export function getScenarioTheme(): Promise<ScenarioThemeBundle> {
  if (!cachedTheme) cachedTheme = loadScenarioTheme()
  return cachedTheme
}

/** Test hook: drop the cached promise so the next load refetches. */
export function clearScenarioThemeCacheForTest(): void {
  cachedTheme = null
}
