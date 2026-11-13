import { useMemo, useState } from 'react'
import { useEngine } from '../../app/useEngine'
import { apiClient } from '../../api'
import { ApiError } from '../../api/apiClient'
import { TtsSettingsApi } from '../../api/ttsSettingsApi'
import { newId } from '../../engine/ids'
import {
  buildScenarioTtsCommands,
  type ScenarioTtsBatchTarget,
  type ScenarioTtsCommitPlan,
} from '../../ai/scenarioTtsBatch'
import { TransactionCommand } from '../../engine/commands/transactionCommand'
import { useNotificationStore } from '../../stores/notificationStore'

export interface CombinedTtsBlock {
  readonly id: string
  readonly text: string
  readonly startTime: number
  readonly duration: number
  readonly ttsLanguage?: 'en' | 'es'
}

interface CombinedTtsSegmentResponse {
  readonly id: string
  readonly start: number
  readonly end: number
  readonly duration: number
  readonly audio: string
  readonly words?: readonly string[]
}

interface CombinedTtsResponse {
  readonly sampleRate: number
  readonly channels: number
  readonly duration: number
  readonly fullAudio: string
  readonly segments: readonly CombinedTtsSegmentResponse[]
}

export function CombinedTtsModal({
  blocks,
  slideId,
  onClose,
}: {
  blocks: readonly CombinedTtsBlock[]
  slideId: string
  onClose: () => void
}) {
  const { dispatch } = useEngine()
  const [selectedIds, setSelectedIds] = useState<string[]>(() => blocks.map((b) => b.id))
  const [language, setLanguage] = useState<'en' | 'es'>('es')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<{ count: number; duration: number } | null>(null)

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedBlocks = useMemo(
    () => blocks.filter((b) => selectedSet.has(b.id)),
    [blocks, selectedSet],
  )
  const combined = useMemo(() => {
    let text = ''
    const segments: { id: string; text: string; start: number; end: number }[] = []
    for (const b of selectedBlocks) {
      const clean = b.text.trim()
      if (!clean) continue
      if (text.length > 0) text += ' '
      const start = text.length
      text += clean
      segments.push({ id: b.id, text: clean, start, end: start + clean.length })
    }
    return { text, segments }
  }, [selectedBlocks])
  const combinedText = combined.text

  const selectAll = () => {
    if (!isGenerating) setSelectedIds(blocks.map((b) => b.id))
  }
  const clearAll = () => {
    if (!isGenerating) setSelectedIds([])
  }

  const toggle = (id: string) => {
    if (isGenerating) return
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const allSelected = blocks.length > 0 && selectedIds.length === blocks.length

  const handleGenerate = async () => {
    if (isGenerating || selectedBlocks.length === 0) return
    if (combined.segments.length === 0 || combined.text.trim() === '') {
      setError('Nothing to synthesize — selected blocks are empty.')
      return
    }
    setIsGenerating(true)
    setError(null)
    setApplied(null)
    try {
      let voice: string | undefined
      try {
        const models = await new TtsSettingsApi(apiClient).getModels()
        const rawVoice =
          (models as unknown as { voice?: string | null; tts_voice?: string | null }).voice ??
          (models as unknown as { tts_voice?: string | null }).tts_voice ??
          (models as unknown as { defaults?: { voice?: string | null } }).defaults?.voice
        if (typeof rawVoice === 'string' && rawVoice.trim()) voice = rawVoice.trim()
      } catch {
        // Backend falls back to configured defaults.
      }
      const payload = {
        text: combined.text,
        includeTimestamps: true,
        segments: combined.segments,
        provider: 'cartesia',
        modelId: 'sonic-3.6',
        language,
        ...(voice ? { voice } : {}),
      }
      console.info('[combined-tts] POST /api/tts/generate', {
        chars: combined.text.length,
        blocks: combined.segments.length,
        language,
      })
      const res = await apiClient.post<CombinedTtsResponse>(
        '/api/tts/generate',
        JSON.stringify(payload),
      )
      if (!res.segments || res.segments.length === 0) {
        throw new Error('Backend returned no segments.')
      }
      const byId = new Map(res.segments.map((s) => [s.id, s]))
      const ordered = combined.segments
        .map((s) => byId.get(s.id))
        .filter((s): s is CombinedTtsSegmentResponse => !!s)
      if (ordered.length !== combined.segments.length) {
        throw new Error('Backend response is missing blocks.')
      }
      const nonEmpty = selectedBlocks.filter((b) => b.text.trim() !== '')
      const targets: ScenarioTtsBatchTarget[] = nonEmpty.map((b) => ({
        slideId,
        position: 1,
        partId: b.id,
        text: b.text,
        plannedDuration: b.duration,
        startTime: b.startTime,
        ...(b.ttsLanguage ? { ttsLanguage: b.ttsLanguage } : {}),
      }))
      // Keep target order aligned with response order via index lookup.
      const assets = ordered.map((s, i) => ({
        id: newId('audio-asset'),
        name: `TTS ${nonEmpty[i]!.text.slice(0, 20)}`,
        data: s.audio,
        mimeType: 'audio/wav',
        metadata: {
          duration: s.duration,
          sampleRate: res.sampleRate,
          channels: res.channels,
        } as Record<string, unknown>,
      }))
      const recorded = ordered.map((s) => s.duration)
      // Combined TTS must leave blocks exactly matching their audio: always
      // adopt the recorded duration and shift downstream (trim semantics),
      // even for small diffs — no stretch threshold here.
      let shift = 0
      const plans: ScenarioTtsCommitPlan[] = targets.map((target, index) => {
        const recordedDuration = recorded[index]!
        const timelineStart = target.startTime + shift
        shift += recordedDuration - target.plannedDuration
        return {
          target,
          asset: assets[index]!,
          recordedDuration,
          playbackRate: 1,
          fitTextToClip: { duration: recordedDuration, shiftDownstream: true },
          timelineStart,
        }
      })
      const commands = buildScenarioTtsCommands(plans)
      const result = dispatch(new TransactionCommand(commands))
      if (!result.ok) throw new Error(result.error.message)
      setApplied({ count: ordered.length, duration: res.duration })
      useNotificationStore
        .getState()
        .notify(`Combined TTS applied to ${ordered.length} block(s) — one undo step.`)
    } catch (e) {
      const message =
        e instanceof ApiError
          ? `Request failed (${e.status}): ${e.detail ?? e.message} — see browser console + backend terminal (uvicorn) for details.`
          : `Request failed: ${e instanceof Error ? e.message : String(e)} — see browser console + backend terminal (uvicorn) for details.`
      console.error('[combined-tts] generate failed:', e)
      setError(message)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div
      data-testid="combined-tts-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isGenerating) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0, 0, 0, 0.45)',
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Generate combined TTS"
        data-testid="combined-tts-modal"
        style={{
          width: 'min(640px, 92vw)',
          maxHeight: '82vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg-panel)',
          borderRadius: 8,
          padding: 20,
        }}
      >
        <h2 style={{ margin: '0 0 4px' }}>Generate combined TTS</h2>
        <p style={{ margin: '0 0 12px', fontSize: 12, opacity: 0.8 }}>
          Pick blocks to glue into one Cartesia request (better intonation). Sends one request with{' '}
          <code>add_timestamps=True</code>, splits the audio back into blocks, and applies each clip
          to its block.
        </p>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            data-testid="combined-tts-select-all"
            onClick={selectAll}
            disabled={isGenerating}
          >
            Select all
          </button>
          <button
            type="button"
            data-testid="combined-tts-clear"
            onClick={clearAll}
            disabled={isGenerating}
          >
            Unselect all
          </button>
          <span
            data-testid="combined-tts-count"
            aria-live="polite"
            style={{ marginLeft: 'auto', fontSize: 12 }}
          >
            {selectedBlocks.length}/{blocks.length} selected
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 8, fontSize: 11, opacity: 0.8 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => (allSelected ? clearAll() : selectAll())}
              data-testid="combined-tts-toggle-all"
              disabled={isGenerating}
            />
            Toggle all
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
            Language
            <select
              data-testid="combined-tts-language"
              aria-label="Language for combined TTS request"
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'en' | 'es')}
              disabled={isGenerating}
              style={{ fontSize: 11, padding: 2, borderRadius: 4 }}
            >
              <option value="es">Spanish (es)</option>
              <option value="en">English (en)</option>
            </select>
          </label>
        </div>

        {blocks.length === 0 ? (
          <p data-testid="combined-tts-empty">No prompter blocks on this slide.</p>
        ) : (
          <ul
            data-testid="combined-tts-list"
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              overflowY: 'auto',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              maxHeight: 260,
            }}
          >
            {blocks.map((block, index) => {
              const checked = selectedSet.has(block.id)
              return (
                <li
                  key={block.id}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-start',
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--color-border)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(block.id)}
                    data-testid={`combined-tts-checkbox-${index}`}
                    aria-label={`Select block ${index + 1}`}
                    style={{ marginTop: 3 }}
                    disabled={isGenerating}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, opacity: 0.7 }}>
                      Block {index + 1} · {block.duration.toFixed(1)}s
                      {block.ttsLanguage ? ` · ${block.ttsLanguage}` : ''}
                    </div>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{block.text}</div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <div style={{ marginTop: 12 }}>
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'baseline',
              marginBottom: 4,
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600 }}>Combined resulting sentence</div>
            <div
              data-testid="combined-tts-stats"
              style={{ fontSize: 11, opacity: 0.7, marginLeft: 'auto' }}
            >
              {selectedBlocks.length} blocks · {combinedText.length} chars ·{' '}
              {combinedText.trim() === '' ? 0 : combinedText.trim().split(/\s+/).length} words
            </div>
          </div>
          <div
            data-testid="combined-tts-preview"
            style={{
              fontSize: 13,
              padding: 10,
              borderRadius: 6,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              maxHeight: 120,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {combinedText || '— nothing selected —'}
          </div>
          <div
            data-testid="combined-tts-chars"
            style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}
          >
            {combinedText.length} characters
          </div>
        </div>

        {error && (
          <div
            role="alert"
            data-testid="combined-tts-error"
            style={{ marginTop: 12, fontSize: 12, color: 'var(--color-error, #ff6b6b)' }}
          >
            {error}
          </div>
        )}
        {applied && (
          <div
            data-testid="combined-tts-result"
            aria-live="polite"
            style={{ marginTop: 12, fontSize: 12 }}
          >
            Applied {applied.count} clip(s), total {applied.duration.toFixed(1)}s — modal stays open
            so you can review. Close when done.
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button
            type="button"
            data-testid="combined-tts-cancel"
            onClick={onClose}
            disabled={isGenerating}
          >
            {applied ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            data-testid="combined-tts-generate"
            disabled={selectedBlocks.length === 0 || isGenerating}
            aria-busy={isGenerating}
            title="Send one Cartesia request with timestamps"
            onClick={() => void handleGenerate()}
          >
            {isGenerating ? 'Generating…' : `Generate combined (${selectedBlocks.length})`}
          </button>
        </div>
      </section>
    </div>
  )
}
