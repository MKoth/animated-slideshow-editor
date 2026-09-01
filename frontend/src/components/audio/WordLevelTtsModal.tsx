/* eslint-disable react-hooks/set-state-in-effect */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEngine } from '../../app/useEngine'
import { TtsApi, type TTSProvider } from '../../engine/ttsProvider'
import { apiClient, voicePromptsApi as defaultVoicePromptsApi } from '../../api'
import type { VoicePromptOut } from '../../api/voicePromptsApi'
import { VoicePromptsApi } from '../../api/voicePromptsApi'
import { ReplacePrompterWordsCommand } from '../../engine/commands'

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

  const [prompts, setPrompts] = useState<VoicePromptOut[]>([])
  const [promptsLoading, setPromptsLoading] = useState(true)
  const [promptsError, setPromptsError] = useState<string | null>(null)

  const [selectedPromptId, setSelectedPromptId] = useState<string>('')
  const [language, setLanguage] = useState('')
  const [voice, setVoice] = useState('')
  const [instruction, setInstruction] = useState('')

  const [status, setStatus] = useState<'idle' | 'generating' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const [showCreate, setShowCreate] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<VoicePromptOut | null>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formInstruction, setFormInstruction] = useState('')
  const [formLanguage, setFormLanguage] = useState('')
  const [formVoice, setFormVoice] = useState('')
  const [formParams, setFormParams] = useState('')
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
    if (!selectedPromptId) return
    const selected = prompts.find((p) => p.id === selectedPromptId)
    if (selected) {
      if (!language && selected.language) setLanguage(selected.language)
      if (!voice && selected.voice) setVoice(selected.voice)
      if (!instruction && selected.instruction) setInstruction(selected.instruction)
    }
  }, [selectedPromptId, prompts]) // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [part, selectedText, selectedPromptId, language, voice, instruction, provider, dispatch, slideId, partId, startWordIndex, endWordIndex, onClose])

  const openCreate = () => {
    setEditingPrompt(null)
    setFormTitle('')
    setFormInstruction('')
    setFormLanguage('')
    setFormVoice('')
    setFormParams('')
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
    setFormLanguage(p.language ?? '')
    setFormVoice(p.voice ?? '')
    setFormParams(p.params ? JSON.stringify(p.params, null, 2) : '')
    setFormError(null)
    setShowCreate(true)
  }

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
    if (!title) { setFormError('Title must be non-empty'); return }
    if (!instr) { setFormError('Instruction must be non-empty'); return }
    let params: Record<string, unknown> | undefined
    if (formParams.trim()) {
      try {
        const parsed = JSON.parse(formParams)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('params must be a JSON object')
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
          language: formLanguage || null,
          voice: formVoice || null,
          params: params ?? null,
        })
      } else {
        const created = await vpApi.create({
          title,
          instruction: instr,
          language: formLanguage || undefined,
          voice: formVoice || undefined,
          params,
        })
        setSelectedPromptId(created.id)
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
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  if (showCreate) {
    return (
      <div role="dialog" aria-modal="true" aria-label="Voice Prompt" data-testid="voice-prompt-form" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 101 }} onClick={(e) => { if (e.target === e.currentTarget) setShowCreate(false) }}>
        <div style={{ background: '#2a2a2a', border: '1px solid #444', borderRadius: 8, width: 460, padding: 16, color: '#e0e0e0' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>{editingPrompt ? 'Edit Voice Prompt' : 'New Voice Prompt'}</h3>
          {formError && <div data-testid="voice-prompt-form-error" style={{ marginBottom: 8, padding: 8, background: '#3a1a1a', border: '1px solid #5a2222', borderRadius: 4, fontSize: 11, color: '#ff6b6b' }}>{formError}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 11 }}>Title<input data-testid="voice-prompt-title" value={formTitle} onChange={(e) => setFormTitle(e.target.value)} style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', borderRadius: 4, color: '#e0e0e0', marginTop: 4 }} /></label>
            <label style={{ fontSize: 11 }}>Instruction<textarea data-testid="voice-prompt-instruction" value={formInstruction} onChange={(e) => setFormInstruction(e.target.value)} style={{ width: '100%', minHeight: 60, padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', borderRadius: 4, color: '#e0e0e0', marginTop: 4 }} /></label>
            <label style={{ fontSize: 11 }}>Language (optional)<input data-testid="voice-prompt-language" value={formLanguage} onChange={(e) => setFormLanguage(e.target.value)} placeholder="e.g. en" style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', borderRadius: 4, color: '#e0e0e0', marginTop: 4 }} /></label>
            <label style={{ fontSize: 11 }}>Voice (optional)<input data-testid="voice-prompt-voice" value={formVoice} onChange={(e) => setFormVoice(e.target.value)} placeholder="e.g. nova" style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', borderRadius: 4, color: '#e0e0e0', marginTop: 4 }} /></label>
            <label style={{ fontSize: 11 }}>Params JSON (optional)<textarea data-testid="voice-prompt-params" value={formParams} onChange={(e) => setFormParams(e.target.value)} placeholder='{"speed":1.0}' style={{ width: '100%', minHeight: 60, padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', borderRadius: 4, color: '#e0e0e0', marginTop: 4, fontFamily: 'monospace', fontSize: 11 }} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button data-testid="voice-prompt-cancel" onClick={() => setShowCreate(false)} style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid #444', background: '#333', color: '#e0e0e0', cursor: 'pointer' }}>Cancel</button>
            <button data-testid="voice-prompt-save" onClick={() => void handleSavePrompt()} disabled={formSaving} style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid #7c5cff', background: '#7c5cff', color: '#fff', cursor: 'pointer', opacity: formSaving ? 0.6 : 1 }}>{formSaving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Word-level TTS" data-testid="word-level-tts-modal" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{ background: '#2a2a2a', border: '1px solid #444', borderRadius: 8, width: 520, padding: 16, color: '#e0e0e0', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>◉ Word-level TTS — &quot;{selectedText}&quot;</h3>
        <p style={{ fontSize: 11, color: '#888', margin: '0 0 8px' }}>Replace selected word(s) inside PrompterPart with TTS. Original recording preserved non-destructively. Splits host part into up to three PrompterParts + AudioSegments [recorded][TTS][recorded] gap-free, stale cleared, one undo transaction.</p>
        <div style={{ fontSize: 11, color: '#aaa', marginBottom: 8, padding: 8, background: '#1e1e1e', borderRadius: 4, border: '1px solid #333' }}>Selected: &quot;{selectedText}&quot; (words {startWordIndex}–{endWordIndex} of &quot;{partText}&quot;)</div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>Voice Prompt</label>
          {promptsLoading ? (
            <div data-testid="voice-prompts-loading" style={{ fontSize: 11, color: '#888' }}>Loading voice prompts…</div>
          ) : promptsError ? (
            <div data-testid="voice-prompts-error" style={{ fontSize: 11, color: '#ff6b6b' }}>{promptsError} <button data-testid="voice-prompts-retry" onClick={() => void fetchPrompts()} style={{ marginLeft: 8, padding: '2px 6px', fontSize: 10 }}>Retry</button></div>
          ) : (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select data-testid="tts-prompt-picker" value={selectedPromptId} onChange={(e) => setSelectedPromptId(e.target.value)} style={{ flex: 1, padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', borderRadius: 4, color: '#e0e0e0', fontSize: 11 }}>
                <option value="">— None —</option>
                {prompts.map((p) => (
                  <option key={p.id} value={p.id}>{p.title} — {p.instruction.slice(0, 40)}</option>
                ))}
              </select>
              <button data-testid="voice-prompt-create-btn" onClick={openCreate} style={{ padding: '4px 8px', fontSize: 11, borderRadius: 4, border: '1px solid #444', background: '#333', color: '#e0e0e0', cursor: 'pointer' }}>New</button>
              <button data-testid="voice-prompt-edit-btn" onClick={openEdit} disabled={!selectedPromptId} style={{ padding: '4px 8px', fontSize: 11, borderRadius: 4, border: '1px solid #444', background: '#333', color: selectedPromptId ? '#e0e0e0' : '#666', cursor: selectedPromptId ? 'pointer' : 'not-allowed' }}>Edit</button>
              <button data-testid="voice-prompt-delete-btn" onClick={() => { void handleDeletePrompt() }} disabled={!selectedPromptId} style={{ padding: '4px 8px', fontSize: 11, borderRadius: 4, border: '1px solid #5a2222', background: '#3a1a1a', color: selectedPromptId ? '#ff6b6b' : '#666', cursor: selectedPromptId ? 'pointer' : 'not-allowed' }}>Delete</button>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <label style={{ fontSize: 11 }}>Language override<input data-testid="tts-language" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. en, es" style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', borderRadius: 4, color: '#e0e0e0', marginTop: 4 }} /></label>
          <label style={{ fontSize: 11 }}>Voice override<input data-testid="tts-voice" value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="e.g. nova" style={{ width: '100%', padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', borderRadius: 4, color: '#e0e0e0', marginTop: 4 }} /></label>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11 }}>Instruction override (optional)<textarea data-testid="tts-instruction" value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Override prompt instruction for this generation" style={{ width: '100%', minHeight: 50, padding: '6px 8px', background: '#1e1e1e', border: '1px solid #444', borderRadius: 4, color: '#e0e0e0', marginTop: 4, fontSize: 11 }} /></label>
        </div>

        {status === 'generating' && (
          <div data-testid="tts-progress" style={{ marginBottom: 8, padding: 8, background: '#1e1e1e', border: '1px solid #333', borderRadius: 4, fontSize: 11, color: '#7c5cff' }}>
            Generating… (backend TTS queue serialised, please wait)
            <div style={{ marginTop: 6, height: 4, background: '#333', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: '100%', height: '100%', background: '#7c5cff', animation: 'tts-progress 1s linear infinite' }} />
            </div>
          </div>
        )}

        {status === 'error' && error && (
          <div data-testid="tts-error" style={{ marginBottom: 8, padding: 8, background: '#3a1a1a', border: '1px solid #5a2222', borderRadius: 4, fontSize: 11 }}>
            <div style={{ color: '#ff6b6b', fontWeight: 600 }}>Generation failed: {error}</div>
            <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
              <button data-testid="tts-retry" onClick={() => void handleGenerate()} style={{ padding: '4px 8px', background: '#7c5cff', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Retry</button>
              <span style={{ fontSize: 10, color: '#aaa', alignSelf: 'center' }}>Server errors are surfaced with retry — concurrent generation is queued server-side</span>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button data-testid="tts-cancel" onClick={onClose} disabled={status === 'generating'} style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid #444', background: '#333', color: status === 'generating' ? '#666' : '#e0e0e0', cursor: status === 'generating' ? 'not-allowed' : 'pointer' }}>Cancel</button>
          <button data-testid="word-tts-generate" onClick={() => void handleGenerate()} disabled={status === 'generating'} style={{ padding: '6px 12px', borderRadius: 4, border: '1px solid #7c5cff', background: status === 'generating' ? '#444' : '#7c5cff', color: '#fff', cursor: status === 'generating' ? 'not-allowed' : 'pointer' }}>{status === 'generating' ? 'Generating…' : 'Generate & Replace'}</button>
        </div>
      </div>
    </div>
  )
}
