import type { EmbeddedAsset } from './embeddedAsset'
import type { LessonLibraryJSON } from './json'
import { isRecord } from './guards'

export function embeddedLibraryJSON(assets: readonly EmbeddedAsset[]): LessonLibraryJSON {
  return {
    assets: assets.map((asset) => ({
      id: asset.id,
      name: asset.name,
      data: asset.data,
      mimeType: asset.mimeType,
      ...(asset.metadata !== undefined ? { metadata: asset.metadata } : {}),
    })),
    materials: [],
    shaders: [],
  }
}

export function validateLibrary(errors: string[], library: unknown): void {
  if (library === undefined) {
    return
  }
  if (!isRecord(library)) {
    errors.push('Invalid lesson JSON: library must be an object')
    return
  }
  for (const reserved of ['materials', 'shaders'] as const) {
    if (library[reserved] !== undefined && !Array.isArray(library[reserved])) {
      errors.push(`Invalid lesson JSON: library.${reserved} must be an array`)
    }
  }
  const assets = library.assets
  if (assets === undefined) {
    return
  }
  if (!Array.isArray(assets)) {
    errors.push('Invalid lesson JSON: library.assets must be an array')
    return
  }
  const assetIds = new Set<string>()
  for (const asset of assets) {
    if (!isRecord(asset)) {
      errors.push('Library asset must be an object')
      continue
    }
    requireNonEmptyString(errors, asset.id, 'Library asset id')
    requireNonEmptyString(errors, asset.name, 'Library asset name')
    if (typeof asset.data !== 'string' || asset.data === '') {
      errors.push(`Library asset "${String(asset.id)}" data must be a non-empty base64 string`)
    }
    if (typeof asset.mimeType !== 'string' || asset.mimeType === '') {
      errors.push(`Library asset "${String(asset.id)}" mimeType must be a non-empty string`)
    }
    if (asset.metadata !== undefined && !isRecord(asset.metadata)) {
      errors.push(`Library asset "${String(asset.id)}" metadata must be an object`)
    }
    if (typeof asset.id === 'string' && asset.id !== '') {
      if (assetIds.has(asset.id)) {
        errors.push(`A library asset with id "${asset.id}" already exists`)
      } else {
        assetIds.add(asset.id)
      }
    }
  }
}

export function buildEmbeddedAssetsFromJSON(library: unknown): EmbeddedAsset[] {
  if (!isRecord(library) || !Array.isArray(library.assets)) {
    return []
  }
  const assets: EmbeddedAsset[] = []
  for (const asset of library.assets) {
    if (
      !isRecord(asset) ||
      typeof asset.id !== 'string' ||
      asset.id === '' ||
      typeof asset.name !== 'string' ||
      asset.name === '' ||
      typeof asset.data !== 'string' ||
      typeof asset.mimeType !== 'string'
    ) {
      continue
    }
    assets.push({
      id: asset.id,
      name: asset.name,
      data: asset.data,
      mimeType: asset.mimeType,
      ...(isRecord(asset.metadata) ? { metadata: asset.metadata } : {}),
    })
  }
  return assets
}

function requireNonEmptyString(errors: string[], value: unknown, what: string): void {
  if (typeof value !== 'string' || value === '') {
    errors.push(`${what} must be a non-empty string`)
  }
}
