import { useEffect, useState } from 'react'
import { apiClient } from '../../api'
import { AiApi, type AiSettings } from '../../api/aiApi'
import { useAiStore } from '../../stores/aiStore'

const DEFAULT_SETTINGS: AiSettings = {
  endpoint: 'https://opencode.ai/zen/v1',
  model: 'anthropic/claude-sonnet-4-5',
  temperature: 0.7,
  maxTokens: 2000,
  streaming: true,
  systemPrompt: '',
  keyMasked: '',
  hasKey: false,
}

export function AiSettingsDialog() {
  const open = useAiStore((s) => s.settingsOpen)
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_SETTINGS)
  const [models, setModels] = useState<string[]>([])
  const [fallback, setFallback] = useState(false)
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
        const [fetched, modelList] = await Promise.all([
          api.getSettings(),
          api.listModels().catch(() => null),
        ])
        if (cancelled) return
        setSettings(fetched)
        if (modelList) {
          setModels(modelList.models)
          setFallback(modelList.fallback)
        } else {
          setModels([fetched.model])
          setFallback(true)
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

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const api = new AiApi(apiClient)
      const updated = await api.updateSettings({
        endpoint: settings.endpoint,
        model: settings.model,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        streaming: settings.streaming,
        systemPrompt: settings.systemPrompt,
        // Empty key keeps the existing server-side key per contract.
        apiKey,
      })
      setSettings(updated)
      setApiKey('')
      setNotice('Saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="AI Settings" data-testid="ai-settings-dialog">
      <h3>AI Settings (opencode.ai)</h3>
      {loading && <div data-testid="ai-settings-loading">Loading…</div>}
      {error && <div data-testid="ai-settings-error">{error}</div>}
      {notice && <div data-testid="ai-settings-notice">{notice}</div>}
      <label>
        Endpoint (advanced)
        <input
          data-testid="ai-settings-endpoint"
          value={settings.endpoint}
          onChange={(e) => setSettings((s) => ({ ...s, endpoint: e.target.value }))}
        />
      </label>
      <label>
        API key
        <input
          data-testid="ai-settings-key"
          type="password"
          placeholder={settings.keyMasked || 'No key saved'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </label>
      <label>
        Model
        <select
          data-testid="ai-settings-model"
          value={settings.model}
          onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
        >
          {[...new Set([...models, settings.model])].filter(Boolean).map((m) => (
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
