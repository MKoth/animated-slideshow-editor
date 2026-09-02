/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEngine } from '../../app/useEngine'
import { TtsApi, type TTSProvider } from '../../engine/ttsProvider'
import { apiClient, voicePromptsApi as defaultVoicePromptsApi } from '../../api'
import type { VoicePromptOut } from '../../api/voicePromptsApi'
import { VoicePromptsApi } from '../../api/voicePromptsApi'
import { ReplacePrompterWordsCommand } from '../../engine/commands'
import { LANGUAGE_OPTIONS, migrateStoredLanguage } from '../../engine/ttsLanguages'
import {
  defaultSpeakerForModel,
  filterSpeakersByLanguage,
  getFallbackSpeakersForModel,
  migrateStoredVoice,
  SPEAKER_HINTS,
} from '../../engine/ttsVoices'
import { TtsSettingsApi } from '../../api/ttsSettingsApi'
import {
  DEFAULT_MODEL_ID,
  DEFAULT_PROVIDER,
  SUPPORTED_MODELS,
  SUPPORTED_PROVIDERS,
  modelDownloadLabel,
} from '../../engine/ttsRegistry'

interface WordLevelTtsModalProps {
  slideId: string
  partId: string
  partText: string
  startWordIndex: number
  endWordIndex: number
  selectedText: string
  onClose: () => void
  ttsProvider?: TTSProvider
  voicePromptsApi?: VoicePromptsApi
}

export function WordLevelTtsModal({
  slideId,
  partId,
  partText,
  startWordIndex,
  endWordIndex,
  selectedText,
  onClose,
  ttsProvider,
  voicePromptsApi,
}: WordLevelTtsModalProps) {
  void partText
  const { engine, dispatch } = useEngine()
  const slide = engine.getSlide(slideId)
  const part = slide.prompter?.parts.find((p) => p.id === partId)

  const provider = useMemo(() => ttsProvider ?? new TtsApi(apiClient), [ttsProvider])
  const vpApi = voicePromptsApi ?? defaultVoicePromptsApi
  const ttsSettingsApi = useMemo(() => new TtsSettingsApi(apiClient), [])

  const [prompts, setPrompts] = useState<VoicePromptOut[]>([])
  const [promptsLoading, setPromptsLoading] = useState(true)
  const [promptsError, setPromptsError] = useState<string | null>(null)

  const [selectedPromptId, setSelectedPromptId] = useState<string>('')
  const [language, setLanguage] = useState('')
  const [voice, setVoice] = useState('')
  const [instruction, setInstruction] = useState('')

  const [ttsModel, setTtsModel] = useState('')
  const [ttsProviderId, setTtsProviderId] = useState('')
  const [models, setModels] = useState<string[]>([...SUPPORTED_MODELS])
  const [providers, setProviders] = useState<string[]>([...SUPPORTED_PROVIDERS])
  const [hasEditedModel, setHasEditedModel] = useState(false)
  const [hasEditedProvider, setHasEditedProvider] = useState(false)
  const [downloadedMap, setDownloadedMap] = useState<Record<string, boolean>>({})
  const [capabilitiesMap, setCapabilitiesMap] = useState<
    Record<string, { speakers: string[]; speakerHints?: Record<string, string>; speakerMeta?: Record<string, { description: string; nativeLanguage: string }> }>
  >({})
  const [ttsVoiceWarning, setTtsVoiceWarning] = useState<string | null>(null)
  const [formVoiceWarning, setFormVoiceWarning] = useState<string | null>(null)

  const [status, setStatus] = useState<'idle' | 'generating' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<VoicePromptOut | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formInstruction, setFormInstruction] = useState('')
  const [formLanguage, setFormLanguage] = useState('')
  const [formVoice, setFormVoice] = useState('')
  const [formParams, setFormParams] = useState('')
  const [formModelId, setFormModelId] = useState('')
  const [formProvider, setFormProvider] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [formSaving, setFormSaving] = useState(false)

  const fetchPrompts = useCallback(async () => {
    setPromptsLoading(true)
    setPromptsError(null)
    try {
      const list = await vpApi.list()
      setPrompts(list)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setPromptsError(msg)
    } finally {
      setPromptsLoading(false)
    }
  }, [vpApi])

  useEffect(() => {
    void fetchPrompts()
  }, [fetchPrompts])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const data = await ttsSettingsApi.getModels()
        if (cancelled) return
        const fetchedModels = Array.isArray(data.models) && data.models.length ? data.models : [...SUPPORTED_MODELS]
        const fetchedProviders = Array.isArray(data.providers) && data.providers.length ? data.providers : [...SUPPORTED_PROVIDERS]
        setModels(fetchedModels)
        setProviders(fetchedProviders)
        const defModel = (data.defaultModel || (data as unknown as { default_model_id?: string }).default_model_id || DEFAULT_MODEL_ID) as string
        const defProv = (data.defaultProvider || (data as unknown as { default_provider?: string }).default_provider || DEFAULT_PROVIDER) as string
        if (!hasEditedModel && !ttsModel && defModel) setTtsModel(defModel)
        else if (!ttsModel && defModel) setTtsModel(defModel)
        if (!hasEditedProvider && !ttsProviderId && defProv) setTtsProviderId(defProv)
        else if (!ttsProviderId && defProv) setTtsProviderId(defProv)
        const dl: Record<string, boolean> = {}
        if ((data as unknown as { downloaded?: Record<string, boolean> }).downloaded) {
          Object.assign(dl, (data as unknown as { downloaded: Record<string, boolean> }).downloaded)
        } else if ((data as unknown as { modelsStatus?: Array<{ id: string; downloaded: boolean }> }).modelsStatus) {
          for (const s of (data as unknown as { modelsStatus: Array<{ id: string; downloaded: boolean }> }).modelsStatus) dl[s.id] = s.downloaded
        } else if ((data as unknown as { capabilities?: Record<string, { downloaded?: boolean }> }).capabilities) {
          for (const [k, v] of Object.entries((data as unknown as { capabilities: Record<string, { downloaded?: boolean }> }).capabilities)) dl[k] = Boolean(v.downloaded)
        }
        setDownloadedMap(dl)
        const capsSource = ((data as unknown as { capabilities?: Record<string, { speakers?: string[]; speakerHints?: Record<string, string>; speakerMeta?: Record<string, { description: string; nativeLanguage: string }> }>; perModel?: Record<string, { speakers?: string[]; speakerHints?: Record<string, string>; speakerMeta?: Record<string, { description: string; nativeLanguage: string }> }> }).capabilities ??
          (data as unknown as { perModel?: Record<string, { speakers?: string[] }> }).perModel) as
          | Record<string, { speakers?: string[]; speakerHints?: Record<string, string>; speakerMeta?: Record<string, { description: string; nativeLanguage: string }> }>
          | undefined
        if (capsSource && typeof capsSource === 'object') {
          const caps: Record<string, { speakers: string[]; speakerHints?: Record<string, string>; speakerMeta?: Record<string, { description: string; nativeLanguage: string }> }> = {}
          for (const [k, v] of Object.entries(capsSource)) {
            if (v && Array.isArray((v as { speakers?: string[] }).speakers)) {
              caps[k] = {
                speakers: (v as { speakers: string[] }).speakers,
                speakerHints: (v as { speakerHints?: Record<string, string> }).speakerHints,
                speakerMeta: (v as { speakerMeta?: Record<string, { description: string; nativeLanguage: string }> }).speakerMeta,
              }
            }
          }
          if (Object.keys(caps).length) setCapabilitiesMap(caps)
        }
      } catch {
        if (cancelled) return
        setModels([...SUPPORTED_MODELS])
        setProviders([...SUPPORTED_PROVIDERS])
        if (!ttsModel) setTtsModel(DEFAULT_MODEL_ID)
        if (!ttsProviderId) setTtsProviderId(DEFAULT_PROVIDER)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttsSettingsApi])

  const ttsSpeakers = useMemo(() => {
    const effModel = ttsModel || DEFAULT_MODEL_ID
    const backend = capabilitiesMap[effModel]?.speakers
    if (Array.isArray(backend) && backend.length) return backend
    return getFallbackSpeakersForModel(effModel)
  }, [ttsModel, capabilitiesMap])

  const formSpeakers = useMemo(() => {
    const effModel = formModelId || ttsModel || DEFAULT_MODEL_ID
    const backend = capabilitiesMap[effModel]?.speakers
    if (Array.isArray(backend) && backend.length) return backend
    return getFallbackSpeakersForModel(effModel)
  }, [formModelId, ttsModel, capabilitiesMap])

  const { speakers: ttsSpeakersFiltered, isExact: ttsSpeakersIsExact } = useMemo(() => {
    const { filtered, isExact } = filterSpeakersByLanguage(ttsSpeakers, language)
    return { speakers: filtered, isExact }
  }, [ttsSpeakers, language])

  const { speakers: formSpeakersFiltered, isExact: formSpeakersIsExact } = useMemo(() => {
    const { filtered, isExact } = filterSpeakersByLanguage(formSpeakers, formLanguage)
    return { speakers: filtered, isExact }
  }, [formSpeakers, formLanguage])

  const getHintForSpeaker = useCallback(
    (speaker: string, modelId: string): string => {
      const caps = capabilitiesMap[modelId]
      if (caps?.speakerHints?.[speaker]) return caps.speakerHints[speaker]!
      if (caps?.speakerMeta?.[speaker]) {
        const m = caps.speakerMeta[speaker] as { description: string; nativeLanguage: string }
        return `${m.description}, ${m.nativeLanguage}`
      }
      return SPEAKER_HINTS[speaker] ?? speaker
    },
    [capabilitiesMap],
  )

  useEffect(() => {
    if (!selectedPromptId) return
    const selected = prompts.find((p) => p.id === selectedPromptId)
    if (selected) {
      if (!language) {
        const migrated = migrateStoredLanguage(selected.language)
        if (migrated.value) setLanguage(migrated.value)
      }
      if (!voice && selected.voice) {
        const promptModel = (selected as unknown as { modelId?: string }).modelId ?? ttsModel ?? DEFAULT_MODEL_ID
        const backendSpeakers = capabilitiesMap[promptModel]?.speakers ?? getFallbackSpeakersForModel(promptModel)
        const mig = migrateStoredVoice(selected.voice, promptModel, selected.language, backendSpeakers)
        setVoice(mig.value)
      }
      if (!instruction && selected.instruction) setInstruction(selected.instruction)
      const pm = (selected as unknown as { modelId?: string }).modelId
      const pp = (selected as unknown as { provider?: string }).provider
      if (pm) setTtsModel(pm)
      if (pp) setTtsProviderId(pp)
    }
  }, [selectedPromptId, prompts, language, voice, instruction, ttsModel, capabilitiesMap])

  const ttsPromptVoiceWarning = useMemo(() => {
    if (!selectedPromptId) return null
    if (voice) return null
    const sel = prompts.find((p) => p.id === selectedPromptId)
    if (!sel?.voice) return null
    const promptModel = (sel as unknown as { modelId?: string }).modelId ?? ttsModel ?? DEFAULT_MODEL_ID
    const backendSpeakers = capabilitiesMap[promptModel]?.speakers ?? getFallbackSpeakersForModel(promptModel)
    const mig = migrateStoredVoice(sel.voice, promptModel, sel.language, backendSpeakers)
    return mig.isUnknown ? mig.warning : null
  }, [selectedPromptId, prompts, voice, ttsModel, capabilitiesMap])

  const effectiveTtsVoiceWarning = ttsVoiceWarning ?? ttsPromptVoiceWarning

  useEffect(() => {
    if (!voice) return
    const key = voice.trim().toLowerCase()
    const lowerSet = new Set(ttsSpeakersFiltered.map((s) => s.toLowerCase()))
    if (lowerSet.has(key)) {
      setTtsVoiceWarning(null)
      return
    }
    const def = defaultSpeakerForModel(ttsModel || DEFAULT_MODEL_ID, language)
    const shortModel = (ttsModel || DEFAULT_MODEL_ID).split('/').pop() ?? ttsModel
    const langLabel = language ? ` for ${language}` : ''
    const knownGlobally = Object.keys(SPEAKER_HINTS).some((k) => k.toLowerCase() === key)
    const warning = knownGlobally
      ? `Voice '${voice}' not available for ${shortModel}${langLabel} — using default (${def})`
      : `Unknown voice '${voice}' — using default (${def})`
    setTtsVoiceWarning(warning)
    setVoice('')
  }, [ttsModel, ttsSpeakersFiltered, language]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleGenerate = useCallback(async () => {
    if (!part) return
    setStatus('generating')
    setError(null)
    try {
      const asset = await provider.generate({
        text: selectedText,
        promptId: selectedPromptId || undefined,
        language: language || undefined,
        voice: voice || undefined,
        instruction: instruction || undefined,
        modelId: ttsModel || undefined,
        provider: ttsProviderId || undefined,
      })
      // Use ReplacePrompterWordsCommand which will create asset and split with segments, preserving original
      const result = dispatch(
        new ReplacePrompterWordsCommand({
          slideId,
          partId,
          startWordIndex,
          endWordIndex,
          ttsData: {
            data: asset.data,
            mimeType: asset.mimeType,
            metadata: asset.metadata as Record<string, unknown> | undefined,
            name: `TTS ${selectedText.slice(0, 20)}`,
          },
        }),
      )
      if (!result.ok) {
        setError(result.error.message)
        setStatus('error')
        return
      }
      onClose()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const detail = (e as { detail?: string })?.detail ?? msg
      setError(detail)
      setStatus('error')
    }
  }, [
    part,
    selectedText,
    selectedPromptId,
    language,
    voice,
    instruction,
    ttsModel,
    ttsProviderId,
    provider,
    dispatch,
    slideId,
    partId,
    startWordIndex,
    endWordIndex,
    onClose,
  ])

  const openCreate = () => {
    setEditingPrompt(null)
    setFormTitle('')
    setFormInstruction('')
    setFormLanguage('')
    setFormVoice('')
    setFormVoiceWarning(null)
    setFormParams('')
    setFormModelId(ttsModel || DEFAULT_MODEL_ID)
    setFormProvider(ttsProviderId || DEFAULT_PROVIDER)
    setFormError(null)
    setShowCreate(true)
  }

  const openEdit = () => {
    if (!selectedPromptId) return
    const p = prompts.find((x) => x.id === selectedPromptId)
    if (!p) return
    setEditingPrompt(p)
    setFormTitle(p.title)
    setFormInstruction(p.instruction)
    setFormLanguage(migrateStoredLanguage(p.language).value)
    const pmRaw = (p as unknown as { modelId?: string }).modelId ?? ttsModel ?? DEFAULT_MODEL_ID
    const backendSpeakersForForm = capabilitiesMap[pmRaw]?.speakers ?? getFallbackSpeakersForModel(pmRaw)
    const mig = migrateStoredVoice(p.voice ?? null, pmRaw, p.language, backendSpeakersForForm)
    if (mig.isUnknown) {
      setFormVoice('')
      setFormVoiceWarning(mig.warning)
    } else {
      setFormVoice(mig.value)
      setFormVoiceWarning(null)
    }
    setFormParams(p.params ? JSON.stringify(p.params, null, 2) : '')
    const pm = (p as unknown as { modelId?: string }).modelId ?? ''
    const pp = (p as unknown as { provider?: string }).provider ?? ''
    setFormModelId(pm || ttsModel || DEFAULT_MODEL_ID)
    setFormProvider(pp || ttsProviderId || DEFAULT_PROVIDER)
    setFormError(null)
    setShowCreate(true)
  }

  useEffect(() => {
    if (!showCreate) return
    if (!formVoice) return
    const key = formVoice.trim().toLowerCase()
    const lowerSet = new Set(formSpeakersFiltered.map((s) => s.toLowerCase()))
    if (lowerSet.has(key)) {
      setFormVoiceWarning(null)
      return
    }
    const def = defaultSpeakerForModel(formModelId || ttsModel || DEFAULT_MODEL_ID, formLanguage)
    const shortModel = (formModelId || ttsModel || DEFAULT_MODEL_ID).split('/').pop() ?? formModelId
    const langLabel = formLanguage ? ` for ${formLanguage}` : ''
    const knownGlobally = Object.keys(SPEAKER_HINTS).some((k) => k.toLowerCase() === key)
    const warning = knownGlobally
      ? `Voice '${formVoice}' not available for ${shortModel}${langLabel} — using default (${def})`
      : `Unknown voice '${formVoice}' — using default (${def})`
    setFormVoiceWarning(warning)
    setFormVoice('')
  }, [formModelId, formSpeakersFiltered, formLanguage, showCreate]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeletePrompt = async () => {
    if (!selectedPromptId) return
    if (!window.confirm('Delete this Voice Prompt?')) return
    try {
      await vpApi.delete(selectedPromptId)
      setSelectedPromptId('')
      await fetchPrompts()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setStatus('error')
    }
  }

  const handleSavePrompt = async () => {
    const title = formTitle.trim()
    const instr = formInstruction.trim()
    if (!title) {
      setFormError('Title must be non-empty')
      return
    }
    if (!instr) {
      setFormError('Instruction must be non-empty')
      return
    }
    let params: Record<string, unknown> | undefined
    if (formParams.trim()) {
      try {
        const parsed = JSON.parse(formParams)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
          throw new Error('params must be a JSON object')
        params = parsed as Record<string, unknown>
      } catch (e) {
        setFormError(`Invalid params JSON: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
    }
    setFormSaving(true)
    setFormError(null)
    try {
      if (editingPrompt) {
        await vpApi.update(editingPrompt.id, {
          title,
          instruction: instr,
          language: formLanguage ? formLanguage.toLowerCase() : null,
          voice: formVoice || null,
          params: params ?? null,
          modelId: formModelId || null,
          provider: formProvider || null,
        })
      } else {
        const created = await vpApi.create({
          title,
          instruction: instr,
          language: formLanguage ? formLanguage.toLowerCase() : undefined,
          voice: formVoice || undefined,
          params,
          modelId: formModelId || undefined,
          provider: formProvider || undefined,
        })
        setSelectedPromptId(created.id)
        if (formModelId) {
          setTtsModel(formModelId)
          setHasEditedModel(true)
        }
        if (formProvider) {
          setTtsProviderId(formProvider)
          setHasEditedProvider(true)
        }
      }
      setShowCreate(false)
      await fetchPrompts()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const detail = (e as { detail?: string })?.detail ?? msg
      setFormError(detail)
    } finally {
      setFormSaving(false)
    }
  }

  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  if (showCreate) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Voice Prompt"
        data-testid="voice-prompt-form"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 101,
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setShowCreate(false)
        }}
      >
        <div
          style={{
            background: '#2a2a2a',
            border: '1px solid #444',
            borderRadius: 8,
            width: 460,
            padding: 16,
            color: '#e0e0e0',
          }}
        >
          <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>
            {editingPrompt ? 'Edit Voice Prompt' : 'New Voice Prompt'}
          </h3>
          {formError && (
            <div
              data-testid="voice-prompt-form-error"
              style={{
                marginBottom: 8,
                padding: 8,
                background: '#3a1a1a',
                border: '1px solid #5a2222',
                borderRadius: 4,
                fontSize: 11,
                color: '#ff6b6b',
              }}
            >
              {formError}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 11 }}>
              Title
              <input
                data-testid="voice-prompt-title"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  background: '#1e1e1e',
                  border: '1px solid #444',
                  borderRadius: 4,
                  color: '#e0e0e0',
                  marginTop: 4,
                }}
              />
            </label>
            <label style={{ fontSize: 11 }}>
              Instruction
              <textarea
                data-testid="voice-prompt-instruction"
                value={formInstruction}
                onChange={(e) => setFormInstruction(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: 60,
                  padding: '6px 8px',
                  background: '#1e1e1e',
                  border: '1px solid #444',
                  borderRadius: 4,
                  color: '#e0e0e0',
                  marginTop: 4,
                }}
              />
            </label>
            <label style={{ fontSize: 11 }}>
              Language
              <select
                data-testid="voice-prompt-language"
                value={formLanguage}
                onChange={(e) => setFormLanguage(e.target.value)}
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
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value || 'auto'} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
                Auto uses automatic language detection
              </div>
              {editingPrompt && migrateStoredLanguage(editingPrompt.language).isUnknown && (
                <div
                  data-testid="voice-prompt-language-warning"
                  style={{ fontSize: 10, color: '#ffb74d', marginTop: 4 }}
                >
                  {migrateStoredLanguage(editingPrompt.language).warning}
                </div>
              )}
            </label>
            <label style={{ fontSize: 11 }}>
              Voice (optional)
              <select
                data-testid="voice-prompt-voice"
                value={formVoice}
                onChange={(e) => {
                  setFormVoice(e.target.value)
                  setFormVoiceWarning(null)
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
                <option value="">— Default (auto) —</option>
                {formSpeakersFiltered.map((v) => {
                  const hint = getHintForSpeaker(v, formModelId || ttsModel || DEFAULT_MODEL_ID)
                  return (
                    <option key={v} value={v}>
                      {hint ? `${v} (${hint})` : v}
                    </option>
                  )
                })}
              </select>
              <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                Filtered by model + language ({formLanguage || 'Auto'}); list fetched from backend capabilities
              </div>
              {!formSpeakersIsExact && formLanguage && (
                <div style={{ fontSize: 10, color: '#8cf', marginTop: 2 }}>
                  No native {formLanguage} voices for this model — showing all {formSpeakers.length}
                </div>
              )}
              {formVoiceWarning && (
                <div
                  data-testid="voice-prompt-voice-warning"
                  style={{ fontSize: 10, color: '#ffb74d', marginTop: 4 }}
                >
                  {formVoiceWarning}
                </div>
              )}
              {editingPrompt && (() => {
                const mig = migrateStoredVoice(editingPrompt.voice ?? null, formModelId || ttsModel || DEFAULT_MODEL_ID, editingPrompt.language, formSpeakers)
                if (mig.isUnknown && !formVoiceWarning) {
                  return (
                    <div
                      data-testid="voice-prompt-voice-warning"
                      style={{ fontSize: 10, color: '#ffb74d', marginTop: 4 }}
                    >
                      {mig.warning}
                    </div>
                  )
                }
                return null
              })()}
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ fontSize: 11 }}>
                Model
                <select
                  data-testid="voice-prompt-model"
                  value={formModelId}
                  onChange={(e) => setFormModelId(e.target.value)}
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
                {formModelId && downloadedMap[formModelId] === false && (
                  <div style={{ fontSize: 10, color: '#ffb74d', marginTop: 2 }}>↓ Needs download</div>
                )}
                {formModelId && downloadedMap[formModelId] === true && (
                  <div style={{ fontSize: 10, color: '#6bff6b', marginTop: 2 }}>✓ Downloaded</div>
                )}
              </label>
              <label style={{ fontSize: 11 }}>
                Provider
                <select
                  data-testid="voice-prompt-provider"
                  value={formProvider}
                  onChange={(e) => setFormProvider(e.target.value)}
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
              </label>
            </div>
            <div style={{ fontSize: 10, color: '#888' }}>Stored model/provider recalled next time this Voice Prompt is selected. Per-generation dropdown overrides it.</div>
            <label style={{ fontSize: 11 }}>
              Params JSON (optional)
              <textarea
                data-testid="voice-prompt-params"
                value={formParams}
                onChange={(e) => setFormParams(e.target.value)}
                placeholder='{"speed":1.0}'
                style={{
                  width: '100%',
                  minHeight: 60,
                  padding: '6px 8px',
                  background: '#1e1e1e',
                  border: '1px solid #444',
                  borderRadius: 4,
                  color: '#e0e0e0',
                  marginTop: 4,
                  fontFamily: 'monospace',
                  fontSize: 11,
                }}
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button
              data-testid="voice-prompt-cancel"
              onClick={() => setShowCreate(false)}
              style={{
                padding: '6px 12px',
                borderRadius: 4,
                border: '1px solid #444',
                background: '#333',
                color: '#e0e0e0',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              data-testid="voice-prompt-save"
              onClick={() => void handleSavePrompt()}
              disabled={formSaving}
              style={{
                padding: '6px 12px',
                borderRadius: 4,
                border: '1px solid #7c5cff',
                background: '#7c5cff',
                color: '#fff',
                cursor: 'pointer',
                opacity: formSaving ? 0.6 : 1,
              }}
            >
              {formSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Word-level TTS"
      data-testid="word-level-tts-modal"
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
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>
          ◉ Word-level TTS — &quot;{selectedText}&quot;
        </h3>
        <p style={{ fontSize: 11, color: '#888', margin: '0 0 8px' }}>
          Replace selected word(s) inside PrompterPart with TTS. Original recording preserved
          non-destructively. Splits host part into up to three PrompterParts + AudioSegments
          [recorded][TTS][recorded] gap-free, stale cleared, one undo transaction.
        </p>
        <div
          style={{
            fontSize: 11,
            color: '#aaa',
            marginBottom: 8,
            padding: 8,
            background: '#1e1e1e',
            borderRadius: 4,
            border: '1px solid #333',
          }}
        >
          Selected: &quot;{selectedText}&quot; (words {startWordIndex}–{endWordIndex} of &quot;
          {partText}&quot;)
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Voice Prompt</label>
          {promptsLoading ? (
            <div data-testid="voice-prompts-loading" style={{ fontSize: 11, color: '#888' }}>
              Loading voice prompts…
            </div>
          ) : promptsError ? (
            <div data-testid="voice-prompts-error" style={{ fontSize: 11, color: '#ff6b6b' }}>
              {promptsError}{' '}
              <button
                data-testid="voice-prompts-retry"
                onClick={() => void fetchPrompts()}
                style={{ marginLeft: 8, padding: '2px 6px', fontSize: 10 }}
              >
                Retry
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                data-testid="tts-prompt-picker"
                value={selectedPromptId}
                onChange={(e) => setSelectedPromptId(e.target.value)}
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  background: '#1e1e1e',
                  border: '1px solid #444',
                  borderRadius: 4,
                  color: '#e0e0e0',
                  fontSize: 11,
                }}
              >
                <option value="">— None —</option>
                {prompts.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} — {p.instruction.slice(0, 40)}
                  </option>
                ))}
              </select>
              <button
                data-testid="voice-prompt-create-btn"
                onClick={openCreate}
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  borderRadius: 4,
                  border: '1px solid #444',
                  background: '#333',
                  color: '#e0e0e0',
                  cursor: 'pointer',
                }}
              >
                New
              </button>
              <button
                data-testid="voice-prompt-edit-btn"
                onClick={openEdit}
                disabled={!selectedPromptId}
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  borderRadius: 4,
                  border: '1px solid #444',
                  background: '#333',
                  color: selectedPromptId ? '#e0e0e0' : '#666',
                  cursor: selectedPromptId ? 'pointer' : 'not-allowed',
                }}
              >
                Edit
              </button>
              <button
                data-testid="voice-prompt-delete-btn"
                onClick={() => {
                  void handleDeletePrompt()
                }}
                disabled={!selectedPromptId}
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  borderRadius: 4,
                  border: '1px solid #5a2222',
                  background: '#3a1a1a',
                  color: selectedPromptId ? '#ff6b6b' : '#666',
                  cursor: selectedPromptId ? 'pointer' : 'not-allowed',
                }}
              >
                Delete
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <label style={{ fontSize: 11 }}>
            Model (per-generation)
            <select
              data-testid="tts-model"
              value={ttsModel}
              onChange={(e) => {
                setTtsModel(e.target.value)
                setHasEditedModel(true)
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
              {models.map((m) => (
                <option key={m} value={m}>
                  {modelDownloadLabel(m, downloadedMap[m])}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>Per-generation override; stored prompt model is fallback</div>
            {ttsModel && downloadedMap[ttsModel] === false && (
              <div data-testid="tts-model-download-warning" style={{ fontSize: 10, color: '#ffb74d', marginTop: 2 }}>
                ↓ Not yet downloaded — will be fetched on first generation (1–4 GB, may take a few minutes)
              </div>
            )}
            {ttsModel && downloadedMap[ttsModel] === true && (
              <div data-testid="tts-model-download-ok" style={{ fontSize: 10, color: '#6bff6b', marginTop: 2 }}>
                ✓ Cached locally — ready to use
              </div>
            )}
          </label>
          <label style={{ fontSize: 11 }}>
            Provider
            <select
              data-testid="tts-provider"
              value={ttsProviderId}
              onChange={(e) => {
                setTtsProviderId(e.target.value)
                setHasEditedProvider(true)
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
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <label style={{ fontSize: 11 }}>
            Language override
            <select
              data-testid="tts-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
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
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value || 'auto'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
              Auto uses automatic language detection
            </div>
          </label>
          <label style={{ fontSize: 11 }}>
            Voice override
            <select
              data-testid="tts-voice"
              value={voice}
              onChange={(e) => {
                setVoice(e.target.value)
                setTtsVoiceWarning(null)
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
              <option value="">— Default (auto) —</option>
              {ttsSpeakersFiltered.map((v) => {
                const hint = getHintForSpeaker(v, ttsModel || DEFAULT_MODEL_ID)
                return (
                  <option key={v} value={v}>
                    {hint ? `${v} (${hint})` : v}
                  </option>
                )
              })}
            </select>
            <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
              Filtered by model + language ({language || 'Auto'}); fetched from backend
            </div>
            {!ttsSpeakersIsExact && language && (
              <div style={{ fontSize: 10, color: '#8cf', marginTop: 2 }}>
                No native {language} voices for this model — showing all {ttsSpeakers.length}
              </div>
            )}
            {effectiveTtsVoiceWarning && (
              <div
                data-testid="tts-voice-warning"
                style={{ fontSize: 10, color: '#ffb74d', marginTop: 4 }}
              >
                {effectiveTtsVoiceWarning}
              </div>
            )}
          </label>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11 }}>
            Instruction override (optional)
            <textarea
              data-testid="tts-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Override prompt instruction for this generation"
              style={{
                width: '100%',
                minHeight: 50,
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
        </div>

        {status === 'generating' && (
          <div
            data-testid="tts-progress"
            style={{
              marginBottom: 8,
              padding: 8,
              background: '#1e1e1e',
              border: '1px solid #333',
              borderRadius: 4,
              fontSize: 11,
              color: '#7c5cff',
            }}
          >
            Generating… (backend TTS queue serialised, please wait)
            <div
              style={{
                marginTop: 6,
                height: 4,
                background: '#333',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  background: '#7c5cff',
                  animation: 'tts-progress 1s linear infinite',
                }}
              />
            </div>
          </div>
        )}

        {status === 'error' && error && (
          <div
            data-testid="tts-error"
            style={{
              marginBottom: 8,
              padding: 8,
              background: '#3a1a1a',
              border: '1px solid #5a2222',
              borderRadius: 4,
              fontSize: 11,
            }}
          >
            <div style={{ color: '#ff6b6b', fontWeight: 600 }}>Generation failed: {error}</div>
            <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
              <button
                data-testid="tts-retry"
                onClick={() => void handleGenerate()}
                style={{
                  padding: '4px 8px',
                  background: '#7c5cff',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
              <span style={{ fontSize: 10, color: '#aaa', alignSelf: 'center' }}>
                Server errors are surfaced with retry — concurrent generation is queued server-side
              </span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button
            data-testid="tts-cancel"
            onClick={onClose}
            disabled={status === 'generating'}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid #444',
              background: '#333',
              color: status === 'generating' ? '#666' : '#e0e0e0',
              cursor: status === 'generating' ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            data-testid="word-tts-generate"
            onClick={() => void handleGenerate()}
            disabled={status === 'generating'}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid #7c5cff',
              background: status === 'generating' ? '#444' : '#7c5cff',
              color: '#fff',
              cursor: status === 'generating' ? 'not-allowed' : 'pointer',
            }}
          >
            {status === 'generating' ? 'Generating…' : 'Generate & Replace'}
          </button>
        </div>
      </div>
    </div>
  )
}
