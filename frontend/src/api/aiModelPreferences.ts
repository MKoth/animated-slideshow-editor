import type { AiProvider } from './aiApi'

const MODEL_SELECTIONS_KEY = 'ai-model-selection-by-provider'
const MODEL_CATALOG_KEY_PREFIX = 'ai-model-catalog:'
export const AI_MODEL_CATALOG_TTL_MS = 24 * 60 * 60 * 1000

type ModelSelections = Partial<Record<AiProvider, string>>
type CachedCatalog = { models: string[]; fetchedAt: number }

export function getSavedAiModel(provider: AiProvider): string | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MODEL_SELECTIONS_KEY) ?? '{}')
    if (!value || typeof value !== 'object') return null
    const model = (value as ModelSelections)[provider]
    return typeof model === 'string' && model ? model : null
  } catch {
    return null
  }
}

export function saveAiModel(provider: AiProvider, model: string): void {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(MODEL_SELECTIONS_KEY) ?? '{}')
    const selections = value && typeof value === 'object' ? (value as ModelSelections) : {}
    localStorage.setItem(MODEL_SELECTIONS_KEY, JSON.stringify({ ...selections, [provider]: model }))
  } catch {
    // AI settings remain usable when browser storage is unavailable.
  }
}

export function getCachedAiModels(
  provider: AiProvider,
  now = Date.now(),
): { models: string[]; fresh: boolean } | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(`${MODEL_CATALOG_KEY_PREFIX}${provider}`) ?? 'null',
    )
    if (!value || typeof value !== 'object') return null
    const cached = value as CachedCatalog
    if (!Array.isArray(cached.models) || !cached.models.every((model) => typeof model === 'string'))
      return null
    return {
      models: cached.models,
      fresh: Number.isFinite(cached.fetchedAt) && now - cached.fetchedAt < AI_MODEL_CATALOG_TTL_MS,
    }
  } catch {
    return null
  }
}

export function cacheAiModels(provider: AiProvider, models: string[], now = Date.now()): void {
  try {
    localStorage.setItem(
      `${MODEL_CATALOG_KEY_PREFIX}${provider}`,
      JSON.stringify({ models, fetchedAt: now } satisfies CachedCatalog),
    )
  } catch {
    // AI settings remain usable when browser storage is unavailable.
  }
}
