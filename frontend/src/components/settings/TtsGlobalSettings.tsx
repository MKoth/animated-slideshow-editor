import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../../api'
import { TtsSettingsApi } from '../../api/ttsSettingsApi'
import {
  CARTESIA_MODEL_ID,
  DEFAULT_MODEL_ID,
  DEFAULT_PROVIDER,
  SUPPORTED_MODELS,
  SUPPORTED_PROVIDERS,
  isCartesiaModel,
  modelDownloadLabel,
  shortModelLabel,
} from '../../engine/ttsRegistry'
import { useAudioResizePreferenceStore } from '../../stores/audioResizePreferenceStore'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { useTtsForeignVoiceStore } from '../../stores/ttsForeignVoiceStore'

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
  const [cartesiaConfigured, setCartesiaConfigured] = useState<boolean | null>(null)
  // Default voice mismatch handling (batch TTS + single TTS "don't ask
  // again" share this): stretch fits the clip to the text via playbackRate
  // (prompter timing untouched), trim fits the text to the clip (part
  // duration becomes the recorded length, downstream shifted), ask shows the
  // mismatch dialog per generation.
  const voiceMismatchPref = useAudioResizePreferenceStore((s) => s.preferences.voice)
  // Spanish (foreign) voice for the Script batch: reference asset cloned for
  // foreign-language blocks (Base voice-clone). English blocks always use the
  // default voice. Saved locally, like the other batch defaults here.
  const foreignReferenceAssetId = useTtsForeignVoiceStore((s) => s.referenceAssetId)
  const foreignReferenceTranscript = useTtsForeignVoiceStore((s) => s.referenceTranscript)
  const libraryAudioDefs = useAssetLibraryStore((s) => s.definitions)
  const libraryLoaded = useAssetLibraryStore((s) => s.loaded)
  const libraryLoading = useAssetLibraryStore((s) => s.loading)

  useEffect(() => {
    const store = useAssetLibraryStore.getState()
    if (!store.loaded && !store.loading) void store.loadLibrary()
  }, [])

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
          const cartesia = (modelsData as unknown as { cartesiaConfigured?: boolean })
            .cartesiaConfigured
          if (typeof cartesia === 'boolean') setCartesiaConfigured(cartesia)
        }
        if (settingsData) {
          const sd = settingsData as unknown as {
            downloaded?: Record<string, boolean>
            modelsStatus?: Array<{ id: string; downloaded: boolean }>
            mlxAvailable?: boolean
            cartesiaConfigured?: boolean
          }
          if (sd.downloaded) setDownloadedMap((prev) => ({ ...prev, ...sd.downloaded }))
          else if (sd.modelsStatus) {
            const dl: Record<string, boolean> = {}
            for (const s of sd.modelsStatus) dl[s.id] = s.downloaded
            setDownloadedMap((prev) => ({ ...prev, ...dl }))
          }
          if (typeof sd.mlxAvailable === 'boolean') setMlxAvailable(sd.mlxAvailable)
          if (typeof sd.cartesiaConfigured === 'boolean')
            setCartesiaConfigured(sd.cartesiaConfigured)
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
      {mlxAvailable === false && provider !== 'cartesia' && (
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
      {provider === 'cartesia' && cartesiaConfigured === false && (
        <div
          data-testid="tts-global-cartesia-warning"
          style={{
            padding: 8,
            background: '#3a2a1a',
            border: '1px solid #5a4a22',
            borderRadius: 4,
            fontSize: 11,
            color: '#ffb74d',
          }}
        >
          Cartesia API key is not configured — set <code>CARTESIA_API_KEY</code> in{' '}
          <code>backend/.env</code> (see <code>backend/.env.example</code>) and restart the backend.
          Voice list and generation need it.
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
          {isCartesiaModel(modelId) ? (
            <div
              data-testid="tts-global-model-ok"
              style={{ fontSize: 10, color: '#6bff6b', marginTop: 2 }}
            >
              ✓ Remote model ({CARTESIA_MODEL_ID}) — no download needed
            </div>
          ) : (
            <>
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
            </>
          )}
        </label>
        <label style={{ fontSize: 11 }}>
          Default Provider
          <select
            data-testid="tts-global-provider"
            value={provider}
            onChange={(e) => {
              const next = e.target.value
              setProvider(next)
              // Keep model/provider pairing valid: cartesia only serves sonic-3.6.
              if (next === 'cartesia' && !isCartesiaModel(modelId)) setModelId(CARTESIA_MODEL_ID)
              else if (next !== 'cartesia' && isCartesiaModel(modelId)) setModelId(DEFAULT_MODEL_ID)
            }}
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
            auto → mlx if available else sine · cartesia → remote Cartesia voices (needs API key)
          </div>
        </label>
      </div>
      <label style={{ fontSize: 11 }}>
        Default voice mismatch handling
        <select
          data-testid="tts-global-mismatch"
          value={voiceMismatchPref ?? 'ask'}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'ask') useAudioResizePreferenceStore.getState().clearPreference('voice')
            else if (v === 'stretch' || v === 'trim')
              useAudioResizePreferenceStore.getState().setPreference('voice', v)
          }}
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
          <option value="ask">Ask each time (mismatch dialog)</option>
          <option value="stretch">Fit clip to text — stretch audio (playbackRate)</option>
          <option value="trim">Fit text to clip — extend/shorten prompter + shift</option>
        </select>
        <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
          Used by single TTS when “Don&apos;t ask again” was chosen, and by the Script batch
          “Generate TTS for all prompts” (no dialogs there — batch needs a saved default).
        </div>
      </label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 11 }}>
          Spanish (foreign) voice for Script batch
          <select
            data-testid="tts-global-foreign-ref"
            value={foreignReferenceAssetId ?? ''}
            onChange={(e) =>
              useTtsForeignVoiceStore
                .getState()
                .setReferenceAssetId(e.target.value === '' ? null : e.target.value)
            }
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
            <option value="">— None (backend Spanish reference) —</option>
            {(Array.isArray(libraryAudioDefs) ? libraryAudioDefs : [])
              .filter(
                (d) =>
                  d.category === 'audio' ||
                  d.mimeType?.startsWith('audio/') ||
                  /\.(wav|mp3|mpeg|ogg|webm)$/i.test(d.original_filename),
              )
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.id.slice(0, 8)}
                </option>
              ))}
          </select>
        </label>
        {foreignReferenceAssetId && (
          <label style={{ fontSize: 11 }}>
            Exact transcript of that recording (word-for-word)
            <textarea
              data-testid="tts-global-foreign-ref-transcript"
              value={foreignReferenceTranscript}
              onChange={(e) =>
                useTtsForeignVoiceStore.getState().setReferenceTranscript(e.target.value)
              }
              placeholder="Type exactly what the Spanish recording says — cloning needs a word-for-word match"
              style={{
                width: '100%',
                minHeight: 44,
                padding: '6px 8px',
                background: '#1e1e1e',
                border: '1px solid #444',
                borderRadius: 4,
                color: '#e0e0e0',
                marginTop: 4,
                fontSize: 11,
              }}
            />
          </label>
        )}
        <div style={{ fontSize: 10, color: '#888' }}>
          {libraryLoaded || libraryLoading
            ? 'Batch foreign blocks clone this voice; leave empty to use the backend Spanish reference (my_voice_es.wav). English blocks always use the default voice. Base voice-clone models only — CustomVoice models ignore reference audio.'
            : 'Loading audio assets…'}
        </div>
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
