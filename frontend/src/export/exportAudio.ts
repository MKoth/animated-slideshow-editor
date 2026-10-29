import type { EnginePublic } from '../engine/engine'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function guessMimeType(assetId: string, fallback = 'audio/wav'): string {
  const lower = assetId.toLowerCase()
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.ogg')) return 'audio/ogg'
  if (lower.endsWith('.webm')) return 'audio/webm'
  if (lower.endsWith('.wav')) return 'audio/wav'
  return fallback
}

/**
 * Resolve raw audio bytes for an export clip's assetId.
 *
 * Embedded (recorded/TTS) assets live in the project; library (imported)
 * assets are fetched from their `original_url` like the preview controller.
 * Returns base64 bytes + mimeType, or null when unresolvable.
 */
export async function resolveExportAudioBytes(
  engine: EnginePublic,
  assetId: string,
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const embedded = engine.getEmbeddedAsset(assetId)
    if (embedded?.data) {
      const raw = embedded.data.includes(',') ? embedded.data.split(',').pop()! : embedded.data
      return { data: raw, mimeType: embedded.mimeType || guessMimeType(assetId) }
    }
  } catch {
    // Fall through to library lookup.
  }
  try {
    const definitions = useAssetLibraryStore.getState().allDefinitions
    const definition = definitions.find((d) => d.id === assetId)
    const url = definition?.original_url
    if (!url) return null
    const response = await fetch(url)
    if (!response.ok) return null
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength === 0) return null
    const contentType = response.headers.get('content-type') ?? ''
    const mimeType = contentType.startsWith('audio/')
      ? contentType
      : (definition?.mimeType ?? guessMimeType(assetId))
    return { data: arrayBufferToBase64(buffer), mimeType }
  } catch {
    return null
  }
}
