import type { AssetDefinition } from '../api'
import type { EnginePublic } from '../engine'
import { collectReferencedDefinitionIds, collectReferencedAudioAssetIds } from '../engine/missingAssets'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'

const inFlight = new Map<string, Promise<boolean>>()

export async function captureAssetSnapshot(
  engine: EnginePublic,
  definitionId: string,
): Promise<boolean> {
  if (engine.getEmbeddedAsset(definitionId) !== undefined) {
    return true
  }
  const pending = inFlight.get(definitionId)
  if (pending) {
    return pending
  }
  const attempt = doCapture(engine, definitionId)
  inFlight.set(definitionId, attempt)
  try {
    return await attempt
  } finally {
    if (inFlight.get(definitionId) === attempt) {
      inFlight.delete(definitionId)
    }
  }
}

async function doCapture(engine: EnginePublic, definitionId: string): Promise<boolean> {
  const definition = libraryDefinition(definitionId)
  if (!definition) {
    return false
  }
  const url = definition.original_url
  if (!url) {
    return false
  }
  const bytes = await fetchImageBytes(url)
  if (bytes === null) {
    return false
  }
  engine.embedAsset({
    id: definition.id,
    name: definition.name,
    data: bytes.data,
    mimeType: bytes.mimeType,
    metadata: { ...definition },
  })
  return true
}

export async function ensureReferencedEmbedded(engine: EnginePublic): Promise<void> {
  const project = engine.project
  if (!project) {
    return
  }
  const referenced = collectReferencedDefinitionIds(project)
  await Promise.all([...referenced].map((id) => captureAssetSnapshot(engine, id)))
}

const inFlightAudio = new Map<string, Promise<boolean>>()

export async function captureAudioSnapshot(
  engine: EnginePublic,
  assetId: string,
): Promise<boolean> {
  if (engine.getEmbeddedAsset(assetId) !== undefined) {
    return true
  }
  const pending = inFlightAudio.get(assetId)
  if (pending) return pending
  const attempt = doCaptureAudio(engine, assetId)
  inFlightAudio.set(assetId, attempt)
  try {
    return await attempt
  } finally {
    if (inFlightAudio.get(assetId) === attempt) inFlightAudio.delete(assetId)
  }
}

async function doCaptureAudio(engine: EnginePublic, assetId: string): Promise<boolean> {
  const definition = libraryDefinition(assetId)
  if (!definition) return false
  // Only for audio definitions
  const isAudio = definition.category === 'audio' || definition.mimeType?.startsWith('audio/') || /\.(wav|mp3|mpeg|ogg|webm)$/i.test(definition.original_filename)
  if (!isAudio) return false
  const url = definition.original_url
  if (!url) return false
  const bytes = await fetchImageBytes(url)
  if (bytes === null) return false
  // Prefer mimeType from definition if available
  const mimeType = definition.mimeType ?? bytes.mimeType
  // Preserve audio metadata (duration, sampleRate, etc) in embedded metadata
  const metadata: Record<string, unknown> = { ...(definition.metadata as Record<string, unknown> | undefined) }
  if (definition.mimeType) metadata.mimeType = definition.mimeType
  // Ensure category preserved for filtering
  metadata.category = definition.category
  engine.embedAsset({
    id: definition.id,
    name: definition.name,
    data: bytes.data,
    mimeType: mimeType.startsWith('audio/') ? mimeType : 'audio/wav',
    metadata,
  })
  return true
}

export async function ensureReferencedAudioEmbedded(engine: EnginePublic): Promise<void> {
  const project = engine.project
  if (!project) return
  const referenced = collectReferencedAudioAssetIds(project)
  // Only for those not already embedded and that are global definitions
  const toCapture = [...referenced].filter((id) => engine.getEmbeddedAsset(id) === undefined)
  await Promise.all(toCapture.map((id) => captureAudioSnapshot(engine, id)))
}

export function embeddedDataUrl(asset: {
  readonly data: string
  readonly mimeType: string
}): string {
  return `data:${asset.mimeType};base64,${asset.data}`
}

function libraryDefinition(definitionId: string): AssetDefinition | null {
  return (
    useAssetLibraryStore
      .getState()
      .definitions.find((definition) => definition.id === definitionId) ?? null
  )
}

const ENCODE_CHUNK_BYTES = 0x8000

async function fetchImageBytes(url: string): Promise<{ data: string; mimeType: string } | null> {
  let response: Response
  try {
    response = await fetch(url)
  } catch {
    return null
  }
  if (!response.ok) {
    return null
  }
  const blob = await response.blob()
  if (blob.size === 0) {
    return null
  }
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += ENCODE_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + ENCODE_CHUNK_BYTES))
    await yieldToEventLoop()
  }
  return { data: btoa(binary), mimeType: mimeTypeFor(url, blob.type) }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function mimeTypeFor(url: string, contentType: string): string {
  if (contentType !== '') {
    return contentType.split(';')[0].trim() || 'application/octet-stream'
  }
  const extension = /\.([a-zA-Z0-9]+)$/.exec(url)?.[1]?.toLowerCase()
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    case 'wav':
      return 'audio/wav'
    case 'mp3':
    case 'mpeg':
      return 'audio/mpeg'
    case 'ogg':
      return 'audio/ogg'
    case 'webm':
      return 'audio/webm'
    default:
      return 'application/octet-stream'
  }
}
