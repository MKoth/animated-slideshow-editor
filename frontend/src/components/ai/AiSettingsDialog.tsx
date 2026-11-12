import { useEffect, useState } from 'react'
import { apiClient } from '../../api'
import { ApiError } from '../../api/apiClient'
import {
  cacheAiModels,
  getCachedAiModels,
  getSavedAiModel,
  saveAiModel,
} from '../../api/aiModelPreferences'
import {
  AI_PROVIDERS,
  AI_PROVIDER_DEFAULTS,
  normalizeAiProvider,
  AiApi,
  type AiProvider,
  type AiSettings,
} from '../../api/aiApi'
import { useAiStore } from '../../stores/aiStore'

const DEFAULT_SETTINGS: AiSettings = {
  provider: 'opencode',
  endpoint: AI_PROVIDER_DEFAULTS.opencode.endpoint,
  model: 'kimi-k2.6',
  temperature: 0.7,
  maxTokens: 2000,
  streaming: true,
  systemPrompt: '',
  keyMasked: '',
  hasKey: false,
}

const PROVIDER_KEY_LABELS: Record<AiProvider, string> = {
  opencode: 'OpenCode API key',
  openrouter: 'OpenRouter API key',
}

export function AiSettingsDialog() {
  const open = useAiStore((s) => s.settingsOpen)
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_SETTINGS)
  const [models, setModels] = useState<string[]>([])
  const [fallback, setFallback] = useState(false)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelSearch, setModelSearch] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const api = new AiApi(apiClient)
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const fetched = await api.getSettings()
        if (cancelled) return
        const provider = normalizeAiProvider(fetched.provider)
        const model = getSavedAiModel(provider) ?? fetched.model
        setSettings({ ...fetched, provider, model })
        const cached = getCachedAiModels(provider)
        if (cached) setModels(cached.models)
        if (cached?.fresh) {
          setFallback(false)
        } else {
          try {
            const modelList = await api.listModels(provider)
            if (cancelled) return
            if (!modelList.fallback) cacheAiModels(provider, modelList.models)
            setModels(modelList.models)
            setFallback(modelList.fallback)
          } catch {
            if (cancelled) return
            setModels(cached?.models ?? [model])
            setFallback(true)
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [open])

  if (!open) return null

  const handleProviderChange = (provider: AiProvider) => {
    setSettings((s) => ({
      ...s,
      provider,
      model: getSavedAiModel(provider) ?? s.model,
      // keyMasked belongs to the currently active provider. Keeping it here
      // makes the next provider appear to reuse the previous provider's key.
      keyMasked: '',
      hasKey: false,
      // Switching providers without an explicit endpoint resets to the new
      // provider default; the backend does the same when endpoint is omitted.
      endpoint: AI_PROVIDER_DEFAULTS[provider].endpoint,
    }))
    // Clear the key input: keys are stored per provider server-side, so a key
    // typed for the previous provider must not leak into the new one. The
    // model catalog refreshes after save; until then the dropdown keeps its
    // current options marked as fallback.
    setApiKey('')
    setNotice(null)
    const cached = getCachedAiModels(provider)
    if (cached) setModels(cached.models)
    if (cached?.fresh) {
      setFallback(false)
      return
    }
    setModelsLoading(true)
    void new AiApi(apiClient)
      .listModels(provider)
      .then((modelList) => {
        if (!modelList.fallback) cacheAiModels(provider, modelList.models)
        setModels(modelList.models)
        setFallback(modelList.fallback)
        setSettings((current) => ({
          ...current,
          model: modelList.models.includes(current.model)
            ? current.model
            : (modelList.models[0] ?? current.model),
        }))
      })
      .catch(() => {
        setModels(cached?.models ?? [])
        setFallback(true)
      })
      .finally(() => setModelsLoading(false))
  }

  const visibleModels = models.filter((model) =>
    model.toLowerCase().includes(modelSearch.trim().toLowerCase()),
  )

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setNotice(null)
    saveAiModel(settings.provider, settings.model)
    try {
      const api = new AiApi(apiClient)
      const updated = await api.updateSettings({
        provider: settings.provider,
        endpoint: settings.endpoint,
        model: settings.model,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        streaming: settings.streaming,
        systemPrompt: settings.systemPrompt,
        // Empty key keeps the existing server-side key per contract.
        apiKey,
      })
      setSettings({ ...updated, provider: normalizeAiProvider(updated.provider) })
      setApiKey('')
      // A newly saved key may make the provider's live model catalog available.
      // Refresh it after saving, while retaining the selected model if it is
      // not returned by the provider.
      try {
        const cached = getCachedAiModels(settings.provider)
        if (cached?.fresh) {
          setModels(cached.models)
          setFallback(false)
        } else {
          const modelList = await api.listModels(settings.provider)
          if (!modelList.fallback) cacheAiModels(settings.provider, modelList.models)
          setModels(modelList.models)
          setFallback(modelList.fallback)
        }
        setNotice('Saved.')
      } catch {
        setModels((current) => [...new Set([...current, updated.model])].filter(Boolean))
        setFallback(true)
        setNotice('Saved.')
      }
    } catch (e) {
      setError(
        e instanceof ApiError && e.detail ? e.detail : e instanceof Error ? e.message : String(e),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AI Settings"
      data-testid="ai-settings-dialog"
      className="ai-settings-dialog"
    >
      <h3>AI Settings</h3>
      {loading && <div data-testid="ai-settings-loading">Loading…</div>}
      {error && <div data-testid="ai-settings-error">{error}</div>}
      {notice && <div data-testid="ai-settings-notice">{notice}</div>}
      <label>
        Provider
        <select
          data-testid="ai-settings-provider"
          value={settings.provider}
          onChange={(e) => handleProviderChange(normalizeAiProvider(e.target.value))}
        >
          {AI_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {AI_PROVIDER_DEFAULTS[p].label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Endpoint (advanced)
        <input
          data-testid="ai-settings-endpoint"
          value={settings.endpoint}
          onChange={(e) => setSettings((s) => ({ ...s, endpoint: e.target.value }))}
        />
      </label>
      <label>
        {PROVIDER_KEY_LABELS[settings.provider]}
        <input
          data-testid="ai-settings-key"
          type="password"
          placeholder={settings.keyMasked || 'Enter a key, or leave blank to keep the saved key'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>
      <label>
        Search models
        <input
          data-testid="ai-settings-model-search"
          type="search"
          placeholder="Search model name or provider"
          value={modelSearch}
          onChange={(e) => setModelSearch(e.target.value)}
        />
      </label>
      <label>
        Model{modelsLoading ? ' (loading provider models…)' : ''}
        <select
          data-testid="ai-settings-model"
          value={settings.model}
          onChange={(e) => {
            const model = e.target.value
            setSettings((s) => ({ ...s, model }))
            saveAiModel(settings.provider, model)
          }}
        >
          {[...new Set([...visibleModels, settings.model])].filter(Boolean).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      {fallback && (
        <div data-testid="ai-settings-fallback">
          Showing fallback models (provider unreachable).
        </div>
      )}
      {!modelsLoading && modelSearch.trim() && visibleModels.length === 0 && (
        <div data-testid="ai-settings-no-models">No models match that search.</div>
      )}
      <label>
        Temperature
        <input
          data-testid="ai-settings-temperature"
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={settings.temperature}
          onChange={(e) => setSettings((s) => ({ ...s, temperature: Number(e.target.value) }))}
        />
      </label>
      <label>
        Max tokens
        <input
          data-testid="ai-settings-maxtokens"
          type="number"
          min={1}
          value={settings.maxTokens}
          onChange={(e) => setSettings((s) => ({ ...s, maxTokens: Number(e.target.value) }))}
        />
      </label>
      <label>
        Streaming
        <input
          data-testid="ai-settings-streaming"
          type="checkbox"
          checked={settings.streaming}
          onChange={(e) => setSettings((s) => ({ ...s, streaming: e.target.checked }))}
        />
      </label>
      <label>
        System prompt
        <textarea
          data-testid="ai-settings-system"
          value={settings.systemPrompt}
          onChange={(e) => setSettings((s) => ({ ...s, systemPrompt: e.target.value }))}
        />
      </label>
      <div>
        <button data-testid="ai-settings-save" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          data-testid="ai-settings-close"
          onClick={() => useAiStore.getState().setSettingsOpen(false)}
        >
          Close
        </button>
      </div>
    </div>
  )
}
