import type { EnginePublic } from '../../engine'

interface PreviewCache<T> {
  readonly entries: Map<string, T | null>
}

const previewCaches = new WeakMap<EnginePublic, PreviewCache<unknown>>()

function previewCacheFor<T>(engine: EnginePublic): PreviewCache<T> {
  const existing = previewCaches.get(engine)
  if (existing) return existing as PreviewCache<T>
  const cache: PreviewCache<T> = { entries: new Map() }
  previewCaches.set(engine, cache as PreviewCache<unknown>)
  engine.subscribe(() => cache.entries.clear())
  return cache
}

export function getCachedCollectionSilhouettePreview<T>(
  engine: EnginePublic,
  key: string,
  build: () => T | null,
): T | null {
  const cache = previewCacheFor<T>(engine)
  if (cache.entries.has(key)) return cache.entries.get(key) ?? null
  const preview = build()
  cache.entries.set(key, preview)
  return preview
}

export function refreshCollectionSilhouettePreviews(engine: EnginePublic): void {
  previewCacheFor(engine).entries.clear()
}
