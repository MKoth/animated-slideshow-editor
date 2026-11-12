import { afterEach, describe, expect, it } from 'vitest'
import {
  AI_MODEL_CATALOG_TTL_MS,
  cacheAiModels,
  getCachedAiModels,
  getSavedAiModel,
  saveAiModel,
} from '../api/aiModelPreferences'

describe('AI model preferences', () => {
  afterEach(() => localStorage.clear())

  it('keeps a separate selected model for each provider', () => {
    saveAiModel('opencode', 'kimi-k2.6')
    saveAiModel('openrouter', 'google/gemma-4-26b-it:free')

    expect(getSavedAiModel('opencode')).toBe('kimi-k2.6')
    expect(getSavedAiModel('openrouter')).toBe('google/gemma-4-26b-it:free')
  })

  it('reuses a cached catalog until its six-hour TTL expires', () => {
    cacheAiModels('openrouter', ['vendor/model-a', 'vendor/model-b'], 1000)

    expect(getCachedAiModels('openrouter', 1000 + AI_MODEL_CATALOG_TTL_MS - 1)).toEqual({
      models: ['vendor/model-a', 'vendor/model-b'],
      fresh: true,
    })
    expect(getCachedAiModels('openrouter', 1000 + AI_MODEL_CATALOG_TTL_MS)?.fresh).toBe(false)
  })
})
