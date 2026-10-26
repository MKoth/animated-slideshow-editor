import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../../api'
import { TtsSettingsApi } from '../../api/ttsSettingsApi'
import {
  DEFAULT_MODEL_ID,
  DEFAULT_PROVIDER,
  SUPPORTED_MODELS,
  SUPPORTED_PROVIDERS,
  modelDownloadLabel,
  shortModelLabel,
} from '../../engine/ttsRegistry'

export function TtsGlobalSettings() {
  const api = useMemo(() => new TtsSettingsApi(apiClient), [])
  const [modelId, setModelId] = useState('')
  const [provider, setProvider] = useState('')
  const [models, setModels] = useState<string[]>([...SUPPORTED_MODELS])
  const [providers, setProviders] = useState<string[]>([...SUPPORTED_PROVIDERS])
  const [downloadedMap, setDownloadedMap] = useState<Record<string, boolean>>({})
  const [mlxAvailable, setMlxAvailable] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        // Try capabilities/models first for lists, then settings for defaults
        const [modelsData, settingsData] = await Promise.all([
          api.getModels().catch(() => null),
          api.getSettings().catch(() => null),
        ])
        if (cancelled) return
        if (modelsData) {
          if (Array.isArray(modelsData.models) && modelsData.models.length)
            setModels(modelsData.models)
          if (Array.isArray(modelsData.providers) && modelsData.providers.length)
            setProviders(modelsData.providers)
          const dl: Record<string, boolean> = {}
          const md = modelsData as unknown as {
            downloaded?: Record<string, boolean>
            modelsStatus?: Array<{ id: string; downloaded: boolean }>
            capabilities?: Record<string, { downloaded?: boolean }>
          }
          if (md.downloaded) Object.assign(dl, md.downloaded)
          else if (md.modelsStatus) for (const s of md.modelsStatus) dl[s.id] = s.downloaded
          else if (md.capabilities)
            for (const [k, v] of Object.entries(md.capabilities)) dl[k] = Boolean(v.downloaded)
          if (Object.keys(dl).length) setDownloadedMap(dl)
          const mlx = (modelsData as unknown as { mlxAvailable?: boolean }).mlxAvailable
          if (typeof mlx === 'boolean') setMlxAvailable(mlx)
        }
        if (settingsData) {
          const sd = settingsData as unknown as {
            downloaded?: Record<string, boolean>
            modelsStatus?: Array<{ id: string; downloaded: boolean }>
            mlxAvailable?: boolean
          }
          if (sd.downloaded) setDownloadedMap((prev) => ({ ...prev, ...sd.downloaded }))
          else if (sd.modelsStatus) {
            const dl: Record<string, boolean> = {}
            for (const s of sd.modelsStatus) dl[s.id] = s.downloaded
            setDownloadedMap((prev) => ({ ...prev, ...dl }))
          }
          if (typeof sd.mlxAvailable === 'boolean') setMlxAvailable(sd.mlxAvailable)
        }
        // Prefer settings endpoint for defaults, fallback to models endpoint
        const defModel =
          (settingsData?.modelId as string) ||
          (settingsData?.model_id as string) ||
          (modelsData?.defaultModel as string) ||
          (modelsData?.default_model_id as string) ||
          DEFAULT_MODEL_ID
        const defProv =
          (settingsData?.provider as string) ||
          (settingsData?.tts_provider as string) ||
          (modelsData?.defaultProvider as string) ||
          (modelsData?.default_provider as string) ||
          DEFAULT_PROVIDER
        setModelId(defModel)
        setProvider(defProv)
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
  }, [api])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await api.updateSettings({ modelId, provider })
      const newModel = (res.modelId || res.model_id || modelId) as string
      const newProv = (res.provider || res.tts_provider || provider) as string
      setModelId(newModel)
      setProvider(newProv)
      setSuccess(
        `Saved. Engine will use ${shortModelLabel(newModel)} with provider ${newProv} on next generation. Fallback to sine if mlx missing.`,
      )
      // Clear success after 3s
      setTimeout(() => setSuccess(null), 3000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const detail = (e as { detail?: string })?.detail ?? msg
      setError(detail)
    } finally {
      setSaving(false)
    }
  }

  const handleDownload = async () => {
    if (!modelId || downloading) return
    setDownloading(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await api.downloadModel(modelId)
      setDownloadedMap((prev) => ({ ...prev, [modelId]: res.downloaded }))
      setSuccess(
        res.downloaded
          ? `Downloaded ${shortModelLabel(modelId)} — ready to use.`
          : `Download finished but weights still incomplete for ${shortModelLabel(modelId)}.`,
      )
      setTimeout(() => setSuccess(null), 5000)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const detail = (e as { detail?: string })?.detail ?? msg
      setError(detail)
    } finally {
      setDownloading(false)
    }
  }

  if (loading) {
    return (
      <div data-testid="tts-global-settings-loading" style={{ fontSize: 11, color: '#888' }}>
        Loading TTS settings…
      </div>
    )
  }

  return (
    <div
      data-testid="tts-global-settings"
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <h3 style={{ margin: 0, fontSize: 13 }}>TTS Global Settings</h3>
      <p style={{ fontSize: 11, color: '#888', margin: 0 }}>
        Default model/provider used for new generations when no per-generation override is chosen.
        Changing here triggers engine singleton reload; next generation uses new id (fallback to
        sine on missing mlx).
      </p>
      {mlxAvailable === false && (
        <div
          data-testid="tts-global-mlx-warning"
          style={{
            padding: 8,
            background: '#3a2a1a',
            border: '1px solid #5a4a22',
            borderRadius: 4,
            fontSize: 11,
            color: '#ffb74d',
          }}
        >
          Backend TTS engine (mlx-audio) is not installed — all models fall back to sine beeps and
          selection does nothing. Install it with: <code>uv sync --extra tts</code> in{' '}
          <code>backend/</code>, then restart the backend.
        </div>
      )}
      {error && (
        <div
          data-testid="tts-global-error"
          style={{
            padding: 8,
            background: '#3a1a1a',
            border: '1px solid #5a2222',
            borderRadius: 4,
            fontSize: 11,
            color: '#ff6b6b',
          }}
        >
          {error}
        </div>
      )}
      {success && (
        <div
          data-testid="tts-global-success"
          style={{
            padding: 8,
            background: '#1a3a1a',
            border: '1px solid #2a5a2a',
            borderRadius: 4,
            fontSize: 11,
            color: '#6bff6b',
          }}
        >
          {success}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={{ fontSize: 11 }}>
          Default Model
          <select
            data-testid="tts-global-model"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 8px',
              background: '#1e1e1e',
              border: '1px solid #444',
              borderRadius: 4,
              color: '#e0e0e0',
              marginTop: 4,
            }}
          >
            {models.map((m) => (
              <option key={m} value={m}>
                {modelDownloadLabel(m, downloadedMap[m])}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>{modelId}</div>
          {modelId && downloadedMap[modelId] === false && (
            <div
              data-testid="tts-global-model-warning"
              style={{ fontSize: 10, color: '#ffb74d', marginTop: 2 }}
            >
              ↓ Not downloaded — press Download (1–4 GB, may take a few minutes) or generate to
              fetch on demand
            </div>
          )}
          {modelId && downloadedMap[modelId] === false && (
            <button
              data-testid="tts-global-download"
              onClick={() => void handleDownload()}
              disabled={downloading}
              style={{
                marginTop: 6,
                padding: '6px 12px',
                borderRadius: 4,
                border: '1px solid #7c5cff',
                background: downloading ? '#444' : 'transparent',
                color: '#fff',
                cursor: downloading ? 'not-allowed' : 'pointer',
              }}
            >
              {downloading ? 'Downloading… (do not close)' : 'Download model'}
            </button>
          )}
          {modelId && downloadedMap[modelId] === true && (
            <div
              data-testid="tts-global-model-ok"
              style={{ fontSize: 10, color: '#6bff6b', marginTop: 2 }}
            >
              ✓ Cached locally — ready to use
            </div>
          )}
        </label>
        <label style={{ fontSize: 11 }}>
          Default Provider
          <select
            data-testid="tts-global-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 8px',
              background: '#1e1e1e',
              border: '1px solid #444',
              borderRadius: 4,
              color: '#e0e0e0',
              marginTop: 4,
            }}
          >
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
            auto → mlx if available else sine
          </div>
        </label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          data-testid="tts-global-save"
          onClick={() => void handleSave()}
          disabled={saving}
          style={{
            padding: '6px 12px',
            borderRadius: 4,
            border: '1px solid #7c5cff',
            background: saving ? '#444' : '#7c5cff',
            color: '#fff',
            cursor: saving ? 'not-allowed' : 'pointer',
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? 'Saving…' : 'Save defaults'}
        </button>
      </div>
    </div>
  )
}

export function TtsGlobalSettingsModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="TTS Global Settings"
      data-testid="tts-global-settings-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: '#2a2a2a',
          border: '1px solid #444',
          borderRadius: 8,
          width: 520,
          padding: 16,
          color: '#e0e0e0',
        }}
      >
        <TtsGlobalSettings />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            data-testid="tts-global-close"
            onClick={onClose}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid #444',
              background: '#333',
              color: '#e0e0e0',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
