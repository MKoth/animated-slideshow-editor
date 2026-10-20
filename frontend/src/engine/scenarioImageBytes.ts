/**
 * Scenario image byte resolution (issue #464 preview fix).
 *
 * Both the portable zip download and the View-HTML preview need the same
 * bytes-required guarantee: every bound key resolves to real image bytes,
 * embedded snapshots first, then library original URLs. The zip packs the
 * bytes as `assets/` entries; the preview embeds them as `data:` URIs
 * because a `srcDoc` iframe inherits the app origin, where relative
 * `assets/` paths 404 and every image renders broken.
 */

import { base64ToUint8Array, yieldToEventLoop } from './scenarioPortableZip'

export interface ScenarioEmbeddedImage {
  readonly id: string
  readonly data: string
  readonly mimeType: string
  readonly name: string
}

export interface ScenarioLibraryImage {
  readonly id: string
  readonly mime?: string
  readonly filenameHint?: string
  readonly url?: string
}

export interface ScenarioResolvedImage {
  readonly bytes: Uint8Array
  readonly mime: string
}

/**
 * Resolve every key to image bytes via its binding. Throws on the first
 * unresolvable key — callers surface the message (download aborts, preview
 * shows it) instead of shipping broken refs.
 */
export async function resolveScenarioImageBytes(
  keys: readonly string[],
  bindings: Readonly<Record<string, string>>,
  embeddedById: ReadonlyMap<string, { data: string; mimeType: string; name: string }>,
  libraryById: ReadonlyMap<string, { mime?: string; filenameHint?: string; url?: string }>,
): Promise<Record<string, ScenarioResolvedImage>> {
  const out: Record<string, ScenarioResolvedImage> = {}
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]!
    const binding = bindings[key]
    if (!binding) throw new Error(`Scenario pack is missing a binding for asset "${key}"`)
    const embedded = embeddedById.get(binding)
    if (embedded) {
      out[key] = {
        bytes: base64ToUint8Array(embedded.data),
        mime: embedded.mimeType,
      }
    } else {
      const def = libraryById.get(binding)
      if (!def?.url) throw new Error(`Scenario pack is missing image bytes for asset "${key}"`)
      const response = await fetch(def.url)
      if (!response.ok) throw new Error(`Scenario pack could not fetch bytes for asset "${key}"`)
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength === 0) {
        throw new Error(`Scenario pack fetched empty bytes for asset "${key}"`)
      }
      const mime =
        def.mime ?? response.headers.get('content-type')?.split(';')[0]?.trim() ?? 'image/png'
      out[key] = { bytes: new Uint8Array(buffer), mime }
    }
    if (i % 8 === 7) await yieldToEventLoop()
  }
  return out
}

/** Chunked bytes → base64 (avoids blowing the stack on large images). */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let out = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(out)
}

/** Embeddable `<img src>` for preview documents. */
export function imageBytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${uint8ArrayToBase64(bytes)}`
}
