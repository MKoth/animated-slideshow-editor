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
  getFallbackSpeakersForModel,
  getModelMode,
  migrateStoredVoice,
  SPEAKER_HINTS,
} from '../../engine/ttsVoices'
import {
  TTS_PARAM_RANGES,
  TTS_PRESETS,
  TTS_PRESET_NAMES,
  extractTtsParams,
  mergeTtsParams,
  paramsMatchPreset,
} from '../../engine/ttsParams'
import { TtsSettingsApi } from '../../api/ttsSettingsApi'
import {
  DEFAULT_MODEL_ID,
  DEFAULT_PROVIDER,
  SUPPORTED_MODELS,
  SUPPORTED_PROVIDERS,
  getFallbackCapabilities,
  modelDownloadLabel,
} from '../../engine/ttsRegistry'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'

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
  const [voiceReference, setVoiceReference] = useState('')
  const [instruction, setInstruction] = useState('')

  const [ttsModel, setTtsModel] = useState('')
  const [ttsProviderId, setTtsProviderId] = useState('')
  const [models, setModels] = useState<string[]>([...SUPPORTED_MODELS])
  const [providers, setProviders] = useState<string[]>([...SUPPORTED_PROVIDERS])
  const [hasEditedModel, setHasEditedModel] = useState(false)
  const [hasEditedProvider, setHasEditedProvider] = useState(false)
  const [downloadedMap, setDownloadedMap] = useState<Record<string, boolean>>({})
  const [capabilitiesMap, setCapabilitiesMap] = useState<
    Record<string, { speakers: string[]; speakerHints?: Record<string, string>; speakerMeta?: Record<string, { description: string; nativeLanguage: string }>; mode?: string }>
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
  const [formVoiceReference, setFormVoiceReference] = useState('')
  const [formParams, setFormParams] = useState('')
  const [formPreset, setFormPreset] = useState<string>('Balanced')
  const [formTemperature, setFormTemperature] = useState<number>(TTS_PARAM_RANGES.temperature.default)
  const [formTopK, setFormTopK] = useState<number>(TTS_PARAM_RANGES.top_k.default)
  const [formTopP, setFormTopP] = useState<number>(TTS_PARAM_RANGES.top_p.default)
  const [formRepetition, setFormRepetition] = useState<number>(TTS_PARAM_RANGES.repetition_penalty.default)
  const [formMaxTokens, setFormMaxTokens] = useState<number>(TTS_PARAM_RANGES.max_tokens.default)
  const [formShowAdvanced, setFormShowAdvanced] = useState(false)
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
        const capsSource = ((data as unknown as { capabilities?: Record<string, { speakers?: string[]; speakerHints?: Record<string, string>; speakerMeta?: Record<string, { description: string; nativeLanguage: string }>; mode?: string }>; perModel?: Record<string, { speakers?: string[]; speakerHints?: Record<string, string>; speakerMeta?: Record<string, { description: string; nativeLanguage: string }>; mode?: string }> }).capabilities ??
          (data as unknown as { perModel?: Record<string, { speakers?: string[] }> }).perModel) as
          | Record<string, { speakers?: string[]; speakerHints?: Record<string, string>; speakerMeta?: Record<string, { description: string; nativeLanguage: string }>; mode?: string }>
          | undefined
        if (capsSource && typeof capsSource === 'object') {
          const caps: Record<string, { speakers: string[]; speakerHints?: Record<string, string>; speakerMeta?: Record<string, { description: string; nativeLanguage: string }>; mode?: string }> = {}
          for (const [k, v] of Object.entries(capsSource)) {
            if (v && Array.isArray((v as { speakers?: string[] }).speakers)) {
              caps[k] = {
                speakers: (v as { speakers: string[] }).speakers,
                speakerHints: (v as { speakerHints?: Record<string, string> }).speakerHints,
                speakerMeta: (v as { speakerMeta?: Record<string, { description: string; nativeLanguage: string }> }).speakerMeta,
                mode: (v as { mode?: string }).mode,
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
    if (Array.isArray(backend)) return backend
    return getFallbackSpeakersForModel(effModel)
  }, [ttsModel, capabilitiesMap])

  const formSpeakers = useMemo(() => {
    const effModel = formModelId || ttsModel || DEFAULT_MODEL_ID
    const backend = capabilitiesMap[effModel]?.speakers
    if (Array.isArray(backend)) return backend
    return getFallbackSpeakersForModel(effModel)
  }, [formModelId, ttsModel, capabilitiesMap])

  const ttsMode = useMemo(() => {
    const eff = ttsModel || DEFAULT_MODEL_ID
    return capabilitiesMap[eff]?.mode ?? getModelMode(eff)
  }, [ttsModel, capabilitiesMap])

  const formMode = useMemo(() => {
    const eff = formModelId || ttsModel || DEFAULT_MODEL_ID
    return capabilitiesMap[eff]?.mode ?? getModelMode(eff)
  }, [formModelId, ttsModel, capabilitiesMap])

  const isTtsVoiceEnabled = ttsMode === 'custom_voice'
  const isTtsReferenceEnabled = ttsMode === 'voice_clone'
  const isFormVoiceEnabled = formMode === 'custom_voice'
  const isFormReferenceEnabled = formMode === 'voice_clone'

  const ttsInstructionSupported = useMemo(() => {
    const eff = ttsModel || DEFAULT_MODEL_ID
    const caps = capabilitiesMap[eff]
    if (caps && typeof (caps as { instructionSupported?: boolean }).instructionSupported === 'boolean')
      return (caps as { instructionSupported?: boolean }).instructionSupported!
    return getFallbackCapabilities(eff).instructionSupported
  }, [ttsModel, capabilitiesMap])

  const formInstructionSupported = useMemo(() => {
    const eff = formModelId || ttsModel || DEFAULT_MODEL_ID
    const caps = capabilitiesMap[eff]
    if (caps && typeof (caps as { instructionSupported?: boolean }).instructionSupported === 'boolean')
      return (caps as { instructionSupported?: boolean }).instructionSupported!
    return getFallbackCapabilities(eff).instructionSupported
  }, [formModelId, ttsModel, capabilitiesMap])

  const globalAudioDefs = useAssetLibraryStore((s) => s.definitions)
  const embeddedAudioAssets = useMemo(() => engine.embeddedAssets.filter((a) => a.mimeType.startsWith('audio/')), [engine])
  const referenceOptions = useMemo(() => {
    const byId = new Map<string, { id: string; label: string }>()
    for (const d of globalAudioDefs) {
      const isAudio = (d.category === 'audio' || d.mimeType?.startsWith('audio/') || /\.(wav|mp3|mpeg|ogg|webm)$/i.test(d.original_filename))
      if (!isAudio) continue
      byId.set(d.id, { id: d.id, label: `${d.name} — ${d.id.slice(0, 8)}` })
    }
    for (const a of embeddedAudioAssets) {
      if (!byId.has(a.id)) byId.set(a.id, { id: a.id, label: `${a.name} — ${a.id.slice(0, 8)} (embedded)` })
    }
    return [...byId.values()]
  }, [globalAudioDefs, embeddedAudioAssets])

  useEffect(() => {
    if (isTtsReferenceEnabled || isFormReferenceEnabled) {
      const store = useAssetLibraryStore.getState()
      if (!store.loaded && !store.loading) void store.loadLibrary()
    }
  }, [isTtsReferenceEnabled, isFormReferenceEnabled])

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
      if (!voiceReference) {
        const ref = (selected.params as unknown as { referenceAssetId?: string } | null)?.referenceAssetId
        if (typeof ref === 'string' && ref) setVoiceReference(ref)
      }
      const pm = (selected as unknown as { modelId?: string }).modelId
      const pp = (selected as unknown as { provider?: string }).provider
      if (pm) setTtsModel(pm)
      if (pp) setTtsProviderId(pp)
    }
  }, [selectedPromptId, prompts, language, voice, instruction, voiceReference, ttsModel, capabilitiesMap])

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
    if (!isTtsVoiceEnabled) {
      setVoice('')
      setTtsVoiceWarning(null)
      return
    }
    const key = voice.trim().toLowerCase()
    const lowerSet = new Set(ttsSpeakers.map((s) => s.toLowerCase()))
    if (lowerSet.has(key)) {
      setTtsVoiceWarning(null)
      return
    }
    const def = defaultSpeakerForModel(ttsModel || DEFAULT_MODEL_ID, language)
    const shortModel = (ttsModel || DEFAULT_MODEL_ID).split('/').pop() ?? ttsModel
    const knownGlobally = Object.keys(SPEAKER_HINTS).some((k) => k.toLowerCase() === key)
    const warning = knownGlobally
      ? `Voice '${voice}' not available for ${shortModel} — using default (${def})`
      : `Unknown voice '${voice}' — using default (${def})`
    setTtsVoiceWarning(warning)
    setVoice('')
  }, [ttsModel, ttsSpeakers, isTtsVoiceEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isTtsReferenceEnabled && voiceReference) setVoiceReference('')
  }, [ttsModel, isTtsReferenceEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isFormReferenceEnabled && formVoiceReference) setFormVoiceReference('')
  }, [formModelId, isFormReferenceEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

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
    setFormVoiceReference('')
    setFormVoiceWarning(null)
    const def = TTS_PRESETS.Balanced
    setFormPreset('Balanced')
    setFormTemperature(def.temperature)
    setFormTopK(def.top_k)
    setFormTopP(def.top_p)
    setFormRepetition(def.repetition_penalty)
    setFormMaxTokens(def.max_tokens)
    setFormShowAdvanced(false)
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
    const refFromParams = (p.params as unknown as { referenceAssetId?: string } | null)?.referenceAssetId
    setFormVoiceReference(typeof refFromParams === 'string' ? refFromParams : '')
    const extracted = extractTtsParams(p.params as Record<string, unknown> | null)
    setFormTemperature(extracted.temperature)
    setFormTopK(extracted.top_k)
    setFormTopP(extracted.top_p)
    setFormRepetition(extracted.repetition_penalty)
    setFormMaxTokens(extracted.max_tokens)
    const matched = paramsMatchPreset(p.params as Record<string, unknown> | null)
    setFormPreset(matched ?? 'Balanced')
    setFormShowAdvanced(false)
    setFormParams(p.params ? JSON.stringify(p.params, null, 2) : '')
    const pm = (p as unknown as { modelId?: string }).modelId ?? ''
    const pp = (p as unknown as { provider?: string }).provider ?? ''
    setFormModelId(pm || ttsModel || DEFAULT_MODEL_ID)
    setFormProvider(pp || ttsProviderId || DEFAULT_PROVIDER)
    setFormError(null)
    setShowCreate(true)
  }

  const handlePresetChange = (preset: string) => {
    if (!(preset in TTS_PRESETS)) {
      setFormPreset(preset)
      return
    }
    const p = TTS_PRESETS[preset as keyof typeof TTS_PRESETS]
    setFormPreset(preset)
    setFormTemperature(p.temperature)
    setFormTopK(p.top_k)
    setFormTopP(p.top_p)
    setFormRepetition(p.repetition_penalty)
    setFormMaxTokens(p.max_tokens)
  }

  const handleTtsSliderChange = (key: keyof typeof TTS_PARAM_RANGES, value: number) => {
    if (key === 'temperature') setFormTemperature(value)
    else if (key === 'top_k') setFormTopK(value)
    else if (key === 'top_p') setFormTopP(value)
    else if (key === 'repetition_penalty') setFormRepetition(value)
    else if (key === 'max_tokens') setFormMaxTokens(value)
    const next = {
      temperature: key === 'temperature' ? value : formTemperature,
      top_k: key === 'top_k' ? value : formTopK,
      top_p: key === 'top_p' ? value : formTopP,
      repetition_penalty: key === 'repetition_penalty' ? value : formRepetition,
      max_tokens: key === 'max_tokens' ? value : formMaxTokens,
    }
    const matched = paramsMatchPreset(next as unknown as Record<string, unknown>)
    setFormPreset(matched ?? 'Custom')
  }

  const handleAdvancedJsonChange = (val: string) => {
    setFormParams(val)
    if (!val.trim()) return
    try {
      const parsed = JSON.parse(val)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const extracted = extractTtsParams(parsed as Record<string, unknown>)
        setFormTemperature(extracted.temperature)
        setFormTopK(extracted.top_k)
        setFormTopP(extracted.top_p)
        setFormRepetition(extracted.repetition_penalty)
        setFormMaxTokens(extracted.max_tokens)
        const matched = paramsMatchPreset(parsed as Record<string, unknown>)
        setFormPreset(matched ?? 'Custom')
      }
    } catch {}
  }

  useEffect(() => {
    if (!showCreate) return
    if (!formVoice) return
    if (!isFormVoiceEnabled) {
      setFormVoice('')
      setFormVoiceWarning(null)
      return
    }
    const key = formVoice.trim().toLowerCase()
    const lowerSet = new Set(formSpeakers.map((s) => s.toLowerCase()))
    if (lowerSet.has(key)) {
      setFormVoiceWarning(null)
      return
    }
    const def = defaultSpeakerForModel(formModelId || ttsModel || DEFAULT_MODEL_ID, formLanguage)
    const shortModel = (formModelId || ttsModel || DEFAULT_MODEL_ID).split('/').pop() ?? formModelId
    const knownGlobally = Object.keys(SPEAKER_HINTS).some((k) => k.toLowerCase() === key)
    const warning = knownGlobally
      ? `Voice '${formVoice}' not available for ${shortModel} — using default (${def})`
      : `Unknown voice '${formVoice}' — using default (${def})`
    setFormVoiceWarning(warning)
    setFormVoice('')
  }, [formModelId, formSpeakers, isFormVoiceEnabled, showCreate]) // eslint-disable-line react-hooks/exhaustive-deps

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
    // Merge slider TTS params (sliders override advanced JSON)
    let mergedParams: Record<string, unknown> | undefined = params ? { ...params } : undefined
    const sliderTts: Record<string, number> = {
      temperature: formTemperature,
      top_k: formTopK,
      top_p: formTopP,
      repetition_penalty: formRepetition,
      max_tokens: formMaxTokens,
    }
    mergedParams = mergeTtsParams(mergedParams, sliderTts as Partial<Record<keyof typeof TTS_PARAM_RANGES, number>>)
    if (isFormReferenceEnabled) {
      if (formVoiceReference) {
        mergedParams = { ...(mergedParams ?? {}), referenceAssetId: formVoiceReference }
      } else if (mergedParams && 'referenceAssetId' in mergedParams) {
        const { referenceAssetId: _omit, ...rest } = mergedParams as Record<string, unknown>
        mergedParams = Object.keys(rest).length ? rest : undefined
      }
    } else if (mergedParams && 'referenceAssetId' in mergedParams) {
      const { referenceAssetId: _omit, ...rest } = mergedParams as Record<string, unknown>
      mergedParams = Object.keys(rest).length ? rest : undefined
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
          params: mergedParams ?? null,
          modelId: formModelId || null,
          provider: formProvider || null,
        })
      } else {
        const created = await vpApi.create({
          title,
          instruction: instr,
          language: formLanguage ? formLanguage.toLowerCase() : undefined,
          voice: formVoice || undefined,
          params: mergedParams,
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
            <label style={{ fontSize: 11, opacity: formInstructionSupported ? 1 : 0.5 }}>
              Instruction {formInstructionSupported ? '' : '(disabled for 0.6B)'}
              <textarea
                data-testid="voice-prompt-instruction"
                value={formInstruction}
                disabled={!formInstructionSupported}
                onChange={(e) => setFormInstruction(e.target.value)}
                placeholder={formInstructionSupported ? '' : 'Instructions require 1.7B CustomVoice/VoiceDesign'}
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
              {!formInstructionSupported && formInstruction.trim() !== '' && (
                <div data-testid="voice-prompt-instruction-warning" style={{ fontSize: 10, color: '#ffb74d', marginTop: 4 }}>
                  Instructions require 1.7B CustomVoice/VoiceDesign — will be ignored for { (formModelId || ttsModel || DEFAULT_MODEL_ID).split('/').pop() }
                </div>
              )}
              {!formInstructionSupported && (
                <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                  Instructions require 1.7B CustomVoice/VoiceDesign
                </div>
              )}
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
            <label style={{ fontSize: 11, opacity: isFormVoiceEnabled ? 1 : 0.5 }}>
              Voice (optional) {formMode === 'voice_clone' ? '(disabled for Base)' : formMode === 'voice_design' ? '(disabled for VoiceDesign)' : ''}
              <select
                data-testid="voice-prompt-voice"
                value={formVoice}
                disabled={!isFormVoiceEnabled}
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
                {formSpeakers.map((v) => {
                  const hint = getHintForSpeaker(v, formModelId || ttsModel || DEFAULT_MODEL_ID)
                  return (
                    <option key={v} value={v}>
                      {hint ? `${v} (${hint})` : v}
                    </option>
                  )
                })}
              </select>
              <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                {isFormVoiceEnabled ? '9 canonical voices — any language' : 'Voice not applicable for this model'}
              </div>
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
            <label style={{ fontSize: 11, opacity: isFormReferenceEnabled ? 1 : 0.5 }}>
              Voice reference (Base only)
              <select
                data-testid="voice-prompt-voice-reference"
                value={formVoiceReference}
                disabled={!isFormReferenceEnabled}
                onChange={(e) => setFormVoiceReference(e.target.value)}
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
                <option value="">— None —</option>
                {referenceOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
                {isFormReferenceEnabled ? 'Reference audio for voice_clone' : 'Only for Base models'}
              </div>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8, background: '#1e1e1e', border: '1px solid #333', borderRadius: 4 }}>
              <label style={{ fontSize: 11 }}>
                Params preset
                <select
                  data-testid="voice-prompt-preset"
                  value={formPreset}
                  onChange={(e) => handlePresetChange(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    background: '#252525',
                    border: '1px solid #444',
                    borderRadius: 4,
                    color: '#e0e0e0',
                    marginTop: 4,
                  }}
                >
                  {TTS_PRESET_NAMES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  {formPreset === 'Custom' && <option value="Custom">Custom</option>}
                </select>
              </label>
              <div style={{ display: 'grid', gap: 6 }}>
                <label style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>temperature {formTemperature.toFixed(2)} <span style={{ color: '#888' }}>({TTS_PARAM_RANGES.temperature.min}–{TTS_PARAM_RANGES.temperature.max})</span></span>
                  <input
                    data-testid="voice-prompt-temperature"
                    type="range"
                    min={TTS_PARAM_RANGES.temperature.min}
                    max={TTS_PARAM_RANGES.temperature.max}
                    step={TTS_PARAM_RANGES.temperature.step}
                    value={formTemperature}
                    onChange={(e) => handleTtsSliderChange('temperature', parseFloat(e.target.value))}
                  />
                </label>
                <label style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>top_k {formTopK} <span style={{ color: '#888' }}>({TTS_PARAM_RANGES.top_k.min}–{TTS_PARAM_RANGES.top_k.max})</span></span>
                  <input
                    data-testid="voice-prompt-top-k"
                    type="range"
                    min={TTS_PARAM_RANGES.top_k.min}
                    max={TTS_PARAM_RANGES.top_k.max}
                    step={TTS_PARAM_RANGES.top_k.step}
                    value={formTopK}
                    onChange={(e) => handleTtsSliderChange('top_k', parseInt(e.target.value, 10))}
                  />
                </label>
                <label style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>top_p {formTopP.toFixed(2)} <span style={{ color: '#888' }}>({TTS_PARAM_RANGES.top_p.min}–{TTS_PARAM_RANGES.top_p.max})</span></span>
                  <input
                    data-testid="voice-prompt-top-p"
                    type="range"
                    min={TTS_PARAM_RANGES.top_p.min}
                    max={TTS_PARAM_RANGES.top_p.max}
                    step={TTS_PARAM_RANGES.top_p.step}
                    value={formTopP}
                    onChange={(e) => handleTtsSliderChange('top_p', parseFloat(e.target.value))}
                  />
                </label>
                <label style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>repetition_penalty {formRepetition.toFixed(2)} <span style={{ color: '#888' }}>({TTS_PARAM_RANGES.repetition_penalty.min}–{TTS_PARAM_RANGES.repetition_penalty.max})</span></span>
                  <input
                    data-testid="voice-prompt-repetition-penalty"
                    type="range"
                    min={TTS_PARAM_RANGES.repetition_penalty.min}
                    max={TTS_PARAM_RANGES.repetition_penalty.max}
                    step={TTS_PARAM_RANGES.repetition_penalty.step}
                    value={formRepetition}
                    onChange={(e) => handleTtsSliderChange('repetition_penalty', parseFloat(e.target.value))}
                  />
                </label>
                <label style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span>max_tokens {formMaxTokens} <span style={{ color: '#888' }}>({TTS_PARAM_RANGES.max_tokens.min}–{TTS_PARAM_RANGES.max_tokens.max})</span></span>
                  <input
                    data-testid="voice-prompt-max-tokens"
                    type="range"
                    min={TTS_PARAM_RANGES.max_tokens.min}
                    max={TTS_PARAM_RANGES.max_tokens.max}
                    step={TTS_PARAM_RANGES.max_tokens.step}
                    value={formMaxTokens}
                    onChange={(e) => handleTtsSliderChange('max_tokens', parseInt(e.target.value, 10))}
                  />
                </label>
              </div>
              <button
                data-testid="voice-prompt-advanced-toggle"
                type="button"
                onClick={() => setFormShowAdvanced((v) => !v)}
                style={{
                  padding: '4px 8px',
                  fontSize: 11,
                  background: '#333',
                  border: '1px solid #444',
                  borderRadius: 4,
                  color: '#e0e0e0',
                  cursor: 'pointer',
                  alignSelf: 'flex-start',
                }}
              >
                {formShowAdvanced ? 'Hide advanced JSON' : 'Show advanced JSON'}
              </button>
              {formShowAdvanced && (
                <label style={{ fontSize: 11 }}>
                  Advanced params JSON (optional)
                  <textarea
                    data-testid="voice-prompt-params"
                    value={formParams}
                    onChange={(e) => handleAdvancedJsonChange(e.target.value)}
                    placeholder='{"temperature":0.9, "custom":1}'
                    style={{
                      width: '100%',
                      minHeight: 60,
                      padding: '6px 8px',
                      background: '#252525',
                      border: '1px solid #444',
                      borderRadius: 4,
                      color: '#e0e0e0',
                      marginTop: 4,
                      fontFamily: 'monospace',
                      fontSize: 11,
                    }}
                  />
                  <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>Arbitrary keys allowed, validated as JSON object. Sliders override TTS keys on save.</div>
                </label>
              )}
              {!formShowAdvanced && (
                <textarea
                  data-testid="voice-prompt-params"
                  value={formParams}
                  onChange={(e) => handleAdvancedJsonChange(e.target.value)}
                  placeholder='{"temperature":0.9}'
                  style={{ display: 'none' }}
                  aria-hidden="true"
                  tabIndex={-1}
                />
              )}
            </div>
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
          <label style={{ fontSize: 11, opacity: isTtsVoiceEnabled ? 1 : 0.5 }}>
            Voice override {ttsMode === 'voice_clone' ? '(disabled for Base)' : ttsMode === 'voice_design' ? '(disabled for VoiceDesign)' : ''}
            <select
              data-testid="tts-voice"
              value={voice}
              disabled={!isTtsVoiceEnabled}
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
              {ttsSpeakers.map((v) => {
                const hint = getHintForSpeaker(v, ttsModel || DEFAULT_MODEL_ID)
                return (
                  <option key={v} value={v}>
                    {hint ? `${v} (${hint})` : v}
                  </option>
                )
              })}
            </select>
            <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
              {isTtsVoiceEnabled ? '9 canonical voices — any language' : 'Voice not applicable for this model'}
            </div>
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
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, opacity: isTtsReferenceEnabled ? 1 : 0.5 }}>
            Voice reference (Base only)
            <select
              data-testid="tts-voice-reference"
              value={voiceReference}
              disabled={!isTtsReferenceEnabled}
              onChange={(e) => setVoiceReference(e.target.value)}
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
              <option value="">— None (default) —</option>
              {referenceOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
              {isTtsReferenceEnabled ? 'Reference audio from assets (Base clones this voice)' : 'Reference only for Base voice_clone'}
            </div>
          </label>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, opacity: ttsInstructionSupported ? 1 : 0.5 }}>
            Instruction override (optional) {!ttsInstructionSupported && '(disabled for 0.6B)'}
            <textarea
              data-testid="tts-instruction"
              value={instruction}
              disabled={!ttsInstructionSupported}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={ttsInstructionSupported ? 'Override prompt instruction for this generation' : 'Instructions require 1.7B CustomVoice/VoiceDesign'}
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
            {!ttsInstructionSupported && (
              <div style={{ fontSize: 10, color: '#ffb74d', marginTop: 4 }}>
                Instructions require 1.7B CustomVoice/VoiceDesign — will be ignored for { (ttsModel || DEFAULT_MODEL_ID).split('/').pop() }
              </div>
            )}
            {ttsInstructionSupported === false && selectedPromptId && (() => {
              const sel = prompts.find((p) => p.id === selectedPromptId)
              const hasInstr = sel?.instruction && sel.instruction.trim() !== ''
              const overriding = instruction.trim() !== ''
              if (hasInstr && !overriding) {
                return (
                  <div data-testid="tts-instruction-warning" style={{ fontSize: 10, color: '#ffb74d', marginTop: 4 }}>
                    Stored prompt “{sel?.title}” has instruction but will be ignored for 0.6B — switch to 1.7B or override
                  </div>
                )
              }
              return null
            })()}
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
