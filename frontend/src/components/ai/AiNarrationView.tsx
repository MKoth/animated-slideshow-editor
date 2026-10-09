import { useEffect, useState } from 'react'
import { voicePromptsApi } from '../../api'
import type { VoicePromptOut } from '../../api/voicePromptsApi'
import { useEngine } from '../../app/useEngine'
import {
  buildCommitCommands,
  buildFillCommands,
  matchPartsByVerbatimText,
  narrationAcceptBlockers,
  type NarrationPart,
} from '../../ai/narration'
import { computeProjectFingerprint } from '../../ai/proposals'
import { CreateAudioAssetCommand } from '../../engine/commands/createAudioAssetCommand'
import { newId } from '../../engine/ids'
import { useAiStore } from '../../stores/aiStore'

interface AiNarrationViewProps {
  projectId: string
  reconciliationId: string | null
  conversationId: string | null
  disabled?: boolean
}

export function AiNarrationView({
  projectId,
  reconciliationId,
  conversationId,
  disabled,
}: AiNarrationViewProps) {
  const { engine, dispatch } = useEngine()
  const narrations = useAiStore((s) => s.narrations)
  const narrationById = useAiStore((s) => s.narrationById)
  const activeNarrationId = useAiStore((s) => s.activeNarrationId)
  const narrationBusy = useAiStore((s) => s.narrationBusy)
  const narrationError = useAiStore((s) => s.narrationError)
  const store = useAiStore.getState()

  const active = activeNarrationId ? (narrationById[activeNarrationId] ?? null) : null

  const [prompts, setPrompts] = useState<VoicePromptOut[]>([])
  const [targetSlideId, setTargetSlideId] = useState<string>('')
  const [proposalNote, setProposalNote] = useState<string | null>(null)

  useEffect(() => {
    if (projectId) void store.loadNarrations(projectId, reconciliationId ?? undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, reconciliationId])

  useEffect(() => {
    if (activeNarrationId) void store.loadNarration(activeNarrationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNarrationId])

  useEffect(() => {
    let cancelled = false
    void voicePromptsApi
      .list()
      .then((list) => {
        if (!cancelled) setPrompts(list)
      })
      .catch(() => {
        if (!cancelled) setPrompts([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const slides = engine.project?.slides ?? []
  // Default to the first slide without a cascading effect render.
  const effectiveTargetSlideId = targetSlideId || slides[0]?.id || ''

  if (disabled) {
    return (
      <div className="ai-narration" data-testid="ai-narration-section">
        <div data-testid="ai-narration-disabled">Narration unavailable — backend unreachable.</div>
      </div>
    )
  }

  const canRun = Boolean(projectId && reconciliationId && conversationId && !narrationBusy)

  const handleRun = () => {
    if (!projectId || !reconciliationId || !conversationId || narrationBusy) return
    setProposalNote(null)
    void store.createNarration(projectId, reconciliationId, conversationId)
  }

  const handleGenerate = async () => {
    if (!active || narrationBusy) return
    setProposalNote(null)
    const results = await store.generateNarration(active.id)
    if (!results) return
    // Embed-first through the command pipeline (Everything is a Command):
    // WAVs land as project-embedded assets before any proposal references
    // them. The embeds are their own History Entries outside the later
    // commit proposal — which stays one Transaction, one History Entry —
    // and bytes stay even if that proposal rolls back (retain-legacy rule,
    // same as the TTS modal replace flow).
    for (const result of results) {
      if (!result.ok || !result.wavData || !result.audioDuration) continue
      const part = active.parts.find((p) => p.stepId === result.stepId)
      const assetId = newId('audio-asset')
      const embedded = dispatch(
        new CreateAudioAssetCommand({
          id: assetId,
          name: `Narration ${part?.spokenLine.slice(0, 24) ?? result.stepId}`,
          data: result.wavData,
          mimeType: result.mimeType ?? 'audio/wav',
          metadata: { duration: result.audioDuration },
        }),
      )
      if (!embedded.ok) {
        await store.markNarrationPartFailed(active.id, result.stepId, embedded.error.message)
        continue
      }
      await store.markNarrationPartReady(active.id, result.stepId, assetId, result.audioDuration)
    }
    await store.loadNarration(active.id)
  }

  const handleProposeFill = () => {
    if (!active || !conversationId) return
    if (!effectiveTargetSlideId) {
      setProposalNote('Create a middle slide first, then propose the fill onto it.')
      return
    }
    try {
      const commands = buildFillCommands(toHelperParts(active.parts), effectiveTargetSlideId)
      const fingerprint = computeProjectFingerprint(engine)
      void store
        .createProposal({
          projectId,
          conversationId,
          title: `Stage C fill: ${active.title}`,
          commands,
          projectFingerprint: fingerprint,
        })
        .then((proposal) => {
          setProposalNote(
            proposal
              ? `Fill proposal ${proposal.id} created — dry-run, approve, and execute it in the proposal section.`
              : 'Fill proposal failed — see the proposal section.',
          )
        })
    } catch (error) {
      setProposalNote(error instanceof Error ? error.message : 'Fill proposal failed.')
    }
  }

  const handleProposeCommit = () => {
    if (!active || !conversationId) return
    if (!effectiveTargetSlideId) {
      setProposalNote('Create a middle slide first, then propose the voice commit onto it.')
      return
    }
    try {
      const slide = engine.getSlide(effectiveTargetSlideId)
      const slideParts = (slide.prompter?.parts ?? []).map((p) => ({ id: p.id, text: p.text }))
      const { matched, unmatchedStepIds } = matchPartsByVerbatimText(
        slideParts,
        toHelperParts(active.parts),
      )
      if (unmatchedStepIds.length > 0) {
        setProposalNote(
          `No verbatim PrompterPart for steps ${unmatchedStepIds.join(', ')} on this slide — run the fill proposal first.`,
        )
        return
      }
      const commands = buildCommitCommands(
        toHelperParts(active.parts),
        effectiveTargetSlideId,
        matched,
      )
      const fingerprint = computeProjectFingerprint(engine)
      void store
        .createProposal({
          projectId,
          conversationId,
          title: `Stage C voice commit: ${active.title}`,
          commands,
          projectFingerprint: fingerprint,
        })
        .then((proposal) => {
          setProposalNote(
            proposal
              ? `Voice proposal ${proposal.id} created — dry-run, approve, and execute it in the proposal section.`
              : 'Voice proposal failed — see the proposal section.',
          )
        })
    } catch (error) {
      setProposalNote(error instanceof Error ? error.message : 'Voice proposal failed.')
    }
  }

  return (
    <div className="ai-narration" data-testid="ai-narration-section">
      <div className="ai-narration__request">
        <button
          data-testid="ai-narration-run"
          disabled={!canRun}
          onClick={handleRun}
          title={
            !reconciliationId
              ? 'Accept a reconciliation first — Stage C reads only the accepted version'
              : undefined
          }
        >
          Fill prompter verbatim
        </button>
        {narrationBusy && <span data-testid="ai-narration-generating">Working…</span>}
        {narrationError && <span data-testid="ai-narration-error">{narrationError.message}</span>}
      </div>

      {narrations.length > 0 && (
        <select
          data-testid="ai-narration-select"
          value={activeNarrationId ?? ''}
          onChange={(e) => store.setActiveNarration(e.target.value || null)}
        >
          {narrations.map((narration) => (
            <option key={narration.id} value={narration.id}>
              {narration.title} ({narration.status})
            </option>
          ))}
        </select>
      )}

      {active ? (
        <AiNarrationDetail
          narrationId={active.id}
          defaultVoicePromptId={active.defaultVoicePromptId}
          status={active.status}
          parts={active.parts}
          slideDuration={active.slideDuration}
          prompts={prompts}
          slides={slides.map((s) => ({ id: s.id, name: s.name }))}
          targetSlideId={effectiveTargetSlideId}
          onTargetSlideChange={setTargetSlideId}
          onGenerate={handleGenerate}
          onProposeFill={handleProposeFill}
          onProposeCommit={handleProposeCommit}
          proposalNote={proposalNote}
          busy={narrationBusy}
        />
      ) : (
        <div data-testid="ai-narration-empty">
          No narration yet — accept a reconciliation, then fill its middle steps verbatim.
        </div>
      )}
    </div>
  )
}

function toHelperParts(
  parts: {
    stepId: string
    spokenLine: string
    estimatedDuration: number
    audioDuration: number | null
    assetId: string | null
    status: string
    stale: boolean
    voicePromptId: string | null
    error: string | null
    timelineStart: number
    timelineEnd: number
    order: number
  }[],
): NarrationPart[] {
  return parts.map((p) => ({
    stepId: p.stepId,
    order: p.order,
    spokenLine: p.spokenLine,
    estimatedDuration: p.estimatedDuration,
    audioDuration: p.audioDuration,
    assetId: p.assetId,
    status: (p.status === 'ready' || p.status === 'failed'
      ? p.status
      : 'pending') as NarrationPart['status'],
    stale: p.stale,
    voicePromptId: p.voicePromptId,
    error: p.error,
    timelineStart: p.timelineStart,
    timelineEnd: p.timelineEnd,
  }))
}

interface AiNarrationDetailProps {
  narrationId: string
  defaultVoicePromptId: string | null
  status: string
  parts: {
    stepId: string
    order: number
    spokenLine: string
    estimatedDuration: number
    audioDuration: number | null
    assetId: string | null
    status: string
    stale: boolean
    voicePromptId: string | null
    error: string | null
    timelineStart: number
    timelineEnd: number
  }[]
  slideDuration: number
  prompts: VoicePromptOut[]
  slides: { id: string; name: string }[]
  targetSlideId: string
  onTargetSlideChange: (id: string) => void
  onGenerate: () => void
  onProposeFill: () => void
  onProposeCommit: () => void
  proposalNote: string | null
  busy: boolean
}

function AiNarrationDetail({
  narrationId,
  defaultVoicePromptId,
  status,
  parts,
  slideDuration,
  prompts,
  slides,
  targetSlideId,
  onTargetSlideChange,
  onGenerate,
  onProposeFill,
  onProposeCommit,
  proposalNote,
  busy,
}: AiNarrationDetailProps) {
  const store = useAiStore.getState()
  const blockers = narrationAcceptBlockers(toHelperParts(parts))

  return (
    <div data-testid="ai-narration-detail">
      <div data-testid="ai-narration-status">
        {status} — {parts.length} parts, slide duration {slideDuration.toFixed(2)}s (sum of parts)
      </div>

      <label>
        Default voice (one reusable prompt for the batch)
        <select
          data-testid="ai-narration-voice-default"
          value={defaultVoicePromptId ?? ''}
          onChange={(e) =>
            void store.updateNarrationVoices(narrationId, {
              defaultVoicePromptId: e.target.value || null,
            })
          }
        >
          <option value="">— Server default voice —</option>
          {prompts.map((prompt) => (
            <option key={prompt.id} value={prompt.id}>
              {prompt.title}
            </option>
          ))}
        </select>
      </label>

      <ul data-testid="ai-narration-parts">
        {parts.map((part) => (
          <li key={part.stepId} data-testid={`ai-narration-part-${part.stepId}`}>
            <div data-testid={`ai-narration-text-${part.stepId}`}>{part.spokenLine}</div>
            <div data-testid={`ai-narration-timing-${part.stepId}`}>
              estimate {part.estimatedDuration.toFixed(2)}s
              {part.audioDuration ? ` → audio ${part.audioDuration.toFixed(2)}s` : ''} @{' '}
              {part.timelineStart.toFixed(2)}s
            </div>
            <div data-testid={`ai-narration-part-status-${part.stepId}`}>
              {part.status}
              {part.stale ? ' (stale)' : ''}
              {part.error ? ` — ${part.error}` : ''}
            </div>
            <label>
              Voice override
              <select
                data-testid={`ai-narration-voice-${part.stepId}`}
                value={part.voicePromptId ?? ''}
                onChange={(e) =>
                  void store.updateNarrationVoices(narrationId, {
                    partVoices: { [part.stepId]: e.target.value || null },
                  })
                }
              >
                <option value="">— Batch default —</option>
                {prompts.map((prompt) => (
                  <option key={prompt.id} value={prompt.id}>
                    {prompt.title}
                  </option>
                ))}
              </select>
            </label>
            {part.status === 'failed' && (
              <button
                data-testid={`ai-narration-retry-${part.stepId}`}
                onClick={() => void store.retryNarrationPart(narrationId, part.stepId)}
              >
                Retry this part
              </button>
            )}
          </li>
        ))}
      </ul>

      <div>
        <button data-testid="ai-narration-generate" disabled={busy} onClick={onGenerate}>
          Run queued voice batch
        </button>
        <span data-testid="ai-narration-progress-hint">
          Serialized server-side, one reusable voice by default — progress lands in the
          conversation.
        </span>
      </div>

      <div>
        <label>
          Target slide for proposals
          <select
            data-testid="ai-narration-target-slide"
            value={targetSlideId}
            onChange={(e) => onTargetSlideChange(e.target.value)}
          >
            {slides.map((slide) => (
              <option key={slide.id} value={slide.id}>
                {slide.name}
              </option>
            ))}
          </select>
        </label>
        <button data-testid="ai-narration-propose-fill" onClick={onProposeFill}>
          Propose fill
        </button>
        <button data-testid="ai-narration-propose-commit" onClick={onProposeCommit}>
          Propose voice commit
        </button>
        {proposalNote && <div data-testid="ai-narration-proposal-note">{proposalNote}</div>}
      </div>

      {blockers.length > 0 && (
        <ul data-testid="ai-narration-blockers">
          {blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
      <div>
        <button
          data-testid="ai-narration-accept"
          disabled={status !== 'draft' || blockers.length > 0}
          onClick={() => void store.acceptNarration(narrationId)}
          title={
            blockers.length > 0
              ? 'Stale or unvoiced parts block the gate — retry each part first'
              : undefined
          }
        >
          Accept narration
        </button>
        <button
          data-testid="ai-narration-reject"
          onClick={() => void store.rejectNarration(narrationId)}
        >
          Reject
        </button>
      </div>

      <div data-testid="ai-narration-rerecord-note">
        Rerecord stays manual — use the existing TTS, record, word-level, and Waveform Editor
        modals. No new rerecord UI.
      </div>
    </div>
  )
}
