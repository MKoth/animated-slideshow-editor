import type { AssetDefinition } from '../api'
import type { EnginePublic } from '../engine'
import { collectReferencedDefinitionIds } from '../engine/missingAssets'
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
    default:
      return 'application/octet-stream'
  }
}
