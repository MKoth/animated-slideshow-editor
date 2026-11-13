import { useEffect, useRef, useState } from 'react'
import { pruneKeyframeSelection } from '../../app/keyframeSelectionActions'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { useTimelineViewStore } from '../../stores/timelineViewStore'
import { useCurveEditorViewStore } from '../../stores/curveEditorViewStore'
import { useTimelineSelectionStore } from '../../stores/timelineSelectionStore'
import { useClipLibraryStore } from '../../stores/clipLibraryStore'
import { sceneHasObjects, timelineRows } from './timelineTracks'
import { TimelineBody } from './TimelineBody'
import { TimelineToolbar } from './TimelineToolbar'
import { CurveEditorPanel } from './CurveEditorPanel'
import { ClipEditBody } from './ClipEditBody'
import { AudioTimelineBody } from './AudioTimelineBody'
import { useSyncedAudio } from '../../audio/useSyncedAudio'
import { useViewportWidth } from './useViewportWidth'
import { PopularAudioModal } from '../audio/PopularAudioModal'
import { CombinedTtsModal } from '../audio/CombinedTtsModal'
import { usePopularAudioStore } from '../../stores/popularAudioStore'
import {
  CreateAudioClipCommand,
  DeleteAudioClipCommand,
  MovePrompterPartCommand,
  SetPrompterPartAudioCommand,
  TransactionCommand,
} from '../../engine/commands'
import { newId } from '../../engine/ids'
import { usePlaybackController } from '../../stores/playbackStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { useAiStore } from '../../stores/aiStore'
import { buildContextSnapshot } from '../../ai/contextSnapshot'
import { runScenarioTtsBatch } from '../../ai/scenarioTtsBatch'
import { TtsApi } from '../../engine/ttsProvider'
import { apiClient } from '../../api'
import { TtsSettingsApi } from '../../api/ttsSettingsApi'
import { useAudioResizePreferenceStore } from '../../stores/audioResizePreferenceStore'
import { useTtsForeignVoiceStore } from '../../stores/ttsForeignVoiceStore'
import { hasPrompterPartAudio } from '../../engine/prompter'
import { useAudioClipSelectionStore } from '../../stores/audioClipSelectionStore'

export function TimelinePanel({ height }: { height: number }) {
  const { engine, dispatch, undoStack } = useEngine()
  const [, setTick] = useState(0)
  useEngineEvent((event) => {
    setTick((tick) => tick + 1)
    if (event.type === 'KeyframeRemoved' || event.type === 'NodeRemoved') {
      pruneKeyframeSelection(engine)
    }
  })
  const scrollerRef = useRef<HTMLDivElement>(null)
  const tracksRef = useRef<HTMLDivElement>(null)
  const timeAreaRef = useRef<HTMLDivElement>(null)
  const lastPointerTimeRef = useRef<number | null>(null)

  const viewMode = useCurveEditorViewStore((state) => state.viewMode)
  const prevViewModeRef = useRef(viewMode)
  useEffect(() => {
    if (viewMode === 'curveEditor' && prevViewModeRef.current !== 'curveEditor') {
      const timelineState = useTimelineViewStore.getState()
      useCurveEditorViewStore
        .getState()
        .syncFromTimeline(timelineState.zoomLevel, timelineState.scrollTime)
    }
    prevViewModeRef.current = viewMode
  }, [viewMode])

  const editingContext = useTimelineSelectionStore((state) => state.editingContext)
  const clipEditId = useClipLibraryStore((state) => state.selectedId)
  const clipEditDefinition =
    editingContext === 'clip-edit' && clipEditId
      ? (engine.clips.find((c) => c.id === clipEditId) ?? null)
      : null

  const project = engine.project
  const slide = engine.getActiveSlide()
  const scene = slide?.scene ?? null
  const hasObjects = scene ? sceneHasObjects(scene) : false
  const expandedNodeIds = useTimelineViewStore((state) => state.expandedNodeIds)
  const authoringModeByHost = useTimelineViewStore((state) => state.authoringModeByHost)
  const [activeTab, setActiveTab] = useState<'animation' | 'audio'>('animation')
  const [showPopularAudio, setShowPopularAudio] = useState(false)
  const [showCombinedTts, setShowCombinedTts] = useState(false)
  const [confirmTtsReplace, setConfirmTtsReplace] = useState(false)
  const [ttsBatchProgress, setTtsBatchProgress] = useState<{ done: number; total: number } | null>(
    null,
  )
  const [ttsBatchError, setTtsBatchError] = useState<string | null>(null)
  const currentTime = usePlaybackController((state) => state.currentTimes[slide?.id ?? ''] ?? 0)
  const viewportWidth = useViewportWidth(scrollerRef, [
    slide?.id ?? null,
    hasObjects,
    editingContext,
    clipEditId,
    activeTab,
  ])
  // Synced Web Audio playback — single truth playbackStore, AudioContext leader
  useSyncedAudio()

  const materialDefinitions = engine.materialDefinitions
  const rows = scene
    ? timelineRows(
        scene,
        expandedNodeIds,
        materialDefinitions,
        authoringModeByHost,
        (clipId) => engine.clips.find((clip) => clip.id === clipId) ?? null,
        (hostId, controlKey) =>
          slide?.animation.node(hostId)?.hasEnabledControlKeyframes(controlKey) ?? false,
      )
    : []

  const isClipEdit = editingContext === 'clip-edit' && clipEditDefinition !== null

  let body: React.ReactNode
  if (isClipEdit && clipEditDefinition) {
    if (viewMode === 'curveEditor' && scene) {
      body = (
        <CurveEditorPanel
          slideId={slide?.id ?? ''}
          duration={clipEditDefinition.duration}
          scene={scene}
          viewportWidth={viewportWidth}
          clip={clipEditDefinition}
        />
      )
    } else {
      body = (
        <ClipEditBody
          clip={clipEditDefinition}
          scrollerRef={scrollerRef}
          tracksRef={tracksRef}
          timeAreaRef={timeAreaRef}
          viewportWidth={viewportWidth}
          lastPointerTimeRef={lastPointerTimeRef}
        />
      )
    }
  } else if (!project) {
    body = (
      <div className="panel-empty-state">
        <p>No project. Create one to get started.</p>
      </div>
    )
  } else if (!slide) {
    body = (
      <div className="panel-empty-state">
        <p>No slides created.</p>
      </div>
    )
  } else if (activeTab === 'audio') {
    body = (
      <AudioTimelineBody
        slide={slide}
        duration={slide.duration}
        scrollerRef={scrollerRef}
        tracksRef={tracksRef}
        timeAreaRef={timeAreaRef}
        viewportWidth={viewportWidth}
        lastPointerTimeRef={lastPointerTimeRef}
      />
    )
  } else if (!hasObjects || !scene) {
    body = (
      <div className="panel-empty-state">
        <p>No objects in the scene. Drag assets into the scene to begin animating.</p>
      </div>
    )
  } else if (viewMode === 'curveEditor') {
    body = (
      <CurveEditorPanel
        slideId={slide.id}
        duration={slide.duration}
        scene={scene}
        viewportWidth={viewportWidth}
      />
    )
  } else {
    body = (
      <TimelineBody
        slideId={slide.id}
        duration={slide.duration}
        scene={scene}
        rows={rows}
        scrollerRef={scrollerRef}
        tracksRef={tracksRef}
        timeAreaRef={timeAreaRef}
        viewportWidth={viewportWidth}
        lastPointerTimeRef={lastPointerTimeRef}
      />
    )
  }

  const toolbarDuration =
    isClipEdit && clipEditDefinition ? clipEditDefinition.duration : (slide?.duration ?? 0)
  const toolbarSlideId = slide?.id ?? ''
  const prompterParts = slide?.prompter?.parts ?? []
  const generatedAudioCount = prompterParts.filter(
    (part) =>
      hasPrompterPartAudio(part) ||
      (part.segments?.some((segment) => Boolean(segment.audioClipId || segment.audioAssetId)) ??
        false),
  ).length

  const openPrompterAssistant = () => {
    if (!project || !slide) return
    const ai = useAiStore.getState()
    ai.setAssistantMode('audio')
    ai.setDraft(project.id, '', 'audio', slide.id)
    ai.setPanelOpen(true)
  }

  const improvePrompterBlocks = async () => {
    if (!project || !slide) return
    const ai = useAiStore.getState()
    ai.setAssistantMode('audio')
    ai.setPanelOpen(true)
    let conversationId = ai.activeIdFor(project.id, 'audio', slide.id)
    if (!conversationId) {
      const created = await ai.createConversation(project.id, 'audio', slide.id)
      conversationId = created?.id ?? null
    }
    if (!conversationId) return
    void ai.sendMessage(
      project.id,
      conversationId,
      'Improve the current slide\'s prompter blocks for natural educational TTS. Consider the whole slide and neighboring blocks. Preserve every spoken word and its order; only adjust punctuation and block boundaries. Keep separate completed ideas in separate blocks: do not merge distinct sentences just because they are adjacent. Split a block when it contains more than one complete sentence or idea; merge only fragments that form one sentence or one continuous idea, with two exceptions that must ALWAYS stay split out as their own blocks and never be merged back into a sentence: (a) sub-word pieces and word fragments such as verb endings or syllables (e.g. "ar", "er", "ir") — every incomplete word part gets its own block; (b) single-word language isolates — one Spanish word inside an English sentence, or one English word inside a Spanish sentence (e.g. "Use ser for identity" becomes "Use" / "ser" / "for identity"). A mixed English/Spanish block may remain a single block only when the foreign part is a multi-word phrase of two or more complete words together (e.g. "arbol de roble") or a full sentence; a lone foreign word always splits out even when it is a complete word — only a long complete foreign word the TTS already pronounces reliably in context may stay inline, and when in doubt split it out. Choose punctuation by spoken syntax and meaning, not mechanically by block boundary: use a comma for a natural list separator or a clause that continues directly; use a period when that spoken thought is complete, even if the topic continues in another block; use ... only for a genuinely suspended unfinished thought used for emphasis or suspense. Do NOT add ... just because another block follows, between items in a list/conjugation/sequence, or after every fragment. Use commas for simple linked list items and semicolons between complex items or clauses that already contain commas; end the sequence with a period when the thought is complete. Do not force punctuation where it sounds unnatural. Do not translate. In mixed English/Spanish text, keep the English teaching sentence and original Spanish wording, wrapping each Spanish word, phrase, or sentence in double quotes (not parentheses). Every block MUST include an explicit language field: use "es" whenever the block contains Spanish, including a Spanish-only block, any Spanish word or fragment, and mixed English/Spanish blocks; use "en" only for entirely English blocks. Never omit language, including for short/common Spanish words or word fragments. Return a compact ```prompter-edit JSON fence with {"slideId":"...","blocks":[{"text":"...","language":"en|es"}]}. Do NOT include sourcePartIds or repeat long IDs. The editor maps blocks automatically, but the returned text must include every original spoken word in order; do not omit trailing input blocks. Outside the JSON, briefly recommend Cartesia emotion, speed, and volume. Do not claim changes were applied.',
      buildContextSnapshot(engine, { includePrompterContext: true }),
      'audio',
    )
  }

  const generateSlideTts = async () => {
    if (!slide || !undoStack || prompterParts.length === 0) return
    setTtsBatchError(null)
    setTtsBatchProgress({ done: 0, total: prompterParts.length })
    setConfirmTtsReplace(false)
    try {
      let modelId: string | undefined
      let provider: string | undefined
      let voice: string | undefined
      try {
        const models = await new TtsSettingsApi(apiClient).getModels()
        modelId =
          (models.defaultModel as string) || (models.default_model_id as string) || undefined
        provider =
          (models.defaultProvider as string) || (models.default_provider as string) || undefined
        const rawVoice =
          (models as unknown as { voice?: string | null; tts_voice?: string | null }).voice ??
          (models as unknown as { tts_voice?: string | null }).tts_voice ??
          (models as unknown as { defaults?: { voice?: string | null } }).defaults?.voice
        if (typeof rawVoice === 'string' && rawVoice.trim()) voice = rawVoice.trim()
      } catch {
        // The TTS API falls back to configured defaults when settings are unavailable.
      }
      const preference = useAudioResizePreferenceStore.getState().getPreference('voice')
      const foreignVoice = useTtsForeignVoiceStore.getState()
      const result = await runScenarioTtsBatch(
        { dispatcher: { dispatch }, undoStack },
        {
          slides: [
            {
              id: slide.id,
              prompter: {
                parts: prompterParts.map((part) => ({
                  id: part.id,
                  text: part.text,
                  duration: part.duration,
                  startTime: part.startTime,
                  ...(part.ttsLanguage ? { ttsLanguage: part.ttsLanguage } : {}),
                })),
              },
            },
          ],
          settings: project?.settings,
        },
        new TtsApi(apiClient),
        {
          ...(modelId ? { modelId } : {}),
          ...(provider ? { provider } : {}),
          ...(voice ? { voice } : {}),
          mode: preference === 'trim' ? 'trim' : 'stretch',
          ...(foreignVoice.referenceAssetId
            ? {
                foreignReferenceAssetId: foreignVoice.referenceAssetId,
                ...(foreignVoice.referenceTranscript.trim()
                  ? { foreignRefText: foreignVoice.referenceTranscript.trim() }
                  : {}),
              }
            : {}),
          onProgress: (done, total) => setTtsBatchProgress({ done, total }),
        },
      )
      if (!result.ok) setTtsBatchError(result.error)
    } catch (error) {
      setTtsBatchError(error instanceof Error ? error.message : String(error))
    } finally {
      setTtsBatchProgress(null)
    }
  }

  const requestSlideTts = () => {
    setTtsBatchError(null)
    if (generatedAudioCount > 0) setConfirmTtsReplace(true)
    else void generateSlideTts()
  }

  const deleteSlidePrompterAudio = () => {
    if (!slide) return
    const existingClipIds = new Set(slide.audio.clips.map((clip) => clip.id))
    const clipIds = [
      ...new Set(
        prompterParts.flatMap((part) => [
          ...(part.audioClipId ? [part.audioClipId] : []),
          ...(part.segments?.map((segment) => segment.audioClipId) ?? []),
        ]),
      ),
    ].filter((clipId) => existingClipIds.has(clipId))
    if (clipIds.length === 0) return
    if (
      !window.confirm(
        `Delete audio from all prompter blocks on this slide (${clipIds.length} clip${clipIds.length === 1 ? '' : 's'})? Prompter text stays; unlinked audio will be kept.`,
      )
    ) {
      return
    }
    const result = dispatch(
      new TransactionCommand(
        clipIds.map((clipId) => new DeleteAudioClipCommand({ slideId: slide.id, clipId })),
      ),
    )
    if (!result.ok) {
      useNotificationStore.getState().notify(result.error.message)
      return
    }
    useAudioClipSelectionStore.getState().clear()
  }

  const unoverlapSlidePrompterBlocks = () => {
    if (!slide || prompterParts.length < 2) return
    const sorted = [...prompterParts].sort((a, b) => a.startTime - b.startTime)
    const targets = new Map<string, number>()
    let cursor = sorted[0].startTime
    for (const part of sorted) {
      const target = Math.max(part.startTime, cursor)
      targets.set(part.id, target)
      cursor = target + part.duration
    }
    const moves = sorted.filter(
      (part) => (targets.get(part.id) ?? part.startTime) > part.startTime + 1e-6,
    )
    if (moves.length === 0) {
      useNotificationStore.getState().notify('No overlapping prompter blocks.')
      return
    }
    const result = dispatch(
      new TransactionCommand(
        moves.map(
          (part) =>
            new MovePrompterPartCommand({
              slideId: slide.id,
              partId: part.id,
              newStartTime: targets.get(part.id) ?? part.startTime,
            }),
        ),
      ),
    )
    if (!result.ok) {
      useNotificationStore.getState().notify(result.error.message)
      return
    }
    useNotificationStore
      .getState()
      .notify(
        `Unoverlapped ${moves.length} block${moves.length === 1 ? '' : 's'} — audio moved with its block.`,
      )
  }

  return (
    <div
      className={`timeline-panel${isClipEdit ? ' timeline-panel--clip-edit' : ''}`}
      style={{ height }}
    >
      {(slide || isClipEdit) && !isClipEdit && (
        <div
          className="timeline-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 8px',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-bg-panel)',
          }}
        >
          <div
            className="timeline-tabs"
            role="tablist"
            style={{
              display: 'flex',
              gap: 4,
              background: 'var(--color-bg)',
              borderRadius: 6,
              padding: 2,
            }}
          >
            <button
              role="tab"
              aria-selected={activeTab === 'animation'}
              className={`timeline-tab${activeTab === 'animation' ? ' timeline-tab--active' : ''}`}
              style={{
                padding: '4px 14px',
                borderRadius: 4,
                fontSize: 11,
                cursor: 'pointer',
                border: 'none',
                background: activeTab === 'animation' ? 'var(--color-accent)' : 'transparent',
                color:
                  activeTab === 'animation'
                    ? 'var(--color-accent-text)'
                    : 'var(--color-text-muted)',
              }}
              onClick={() => setActiveTab('animation')}
              data-testid="timeline-tab-animation"
            >
              Animation
            </button>
            <button
              role="tab"
              aria-selected={activeTab === 'audio'}
              className={`timeline-tab${activeTab === 'audio' ? ' timeline-tab--active' : ''}`}
              style={{
                padding: '4px 14px',
                borderRadius: 4,
                fontSize: 11,
                cursor: 'pointer',
                border: 'none',
                background: activeTab === 'audio' ? 'var(--color-accent)' : 'transparent',
                color:
                  activeTab === 'audio' ? 'var(--color-accent-text)' : 'var(--color-text-muted)',
              }}
              onClick={() => setActiveTab('audio')}
              data-testid="timeline-tab-audio"
            >
              Audio
            </button>
          </div>
          {activeTab === 'audio' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span data-testid="prompter-audio-count" aria-live="polite">
                Blocks: {prompterParts.length} · Audio: {generatedAudioCount}/{prompterParts.length}
              </span>
              <button
                type="button"
                data-testid="prompter-generate-all-tts"
                disabled={prompterParts.length === 0 || ttsBatchProgress !== null}
                title="Generate TTS sequentially for every prompter block on this slide"
                onClick={requestSlideTts}
              >
                {ttsBatchProgress
                  ? `Generating TTS ${ttsBatchProgress.done}/${ttsBatchProgress.total}…`
                  : 'Generate TTS for all blocks'}
              </button>
              <button
                type="button"
                data-testid="prompter-generate-combined-tts"
                disabled={prompterParts.length === 0 || ttsBatchProgress !== null}
                title="Pick blocks to glue into one Cartesia request with timestamps"
                onClick={() => setShowCombinedTts(true)}
              >
                Generate combined TTS
              </button>
              <button
                type="button"
                data-testid="delete-prompter-audio-btn"
                disabled={generatedAudioCount === 0 || ttsBatchProgress !== null}
                title="Delete audio attached to all prompter blocks on this slide; keep unlinked audio"
                onClick={deleteSlidePrompterAudio}
              >
                Delete audio from all blocks
              </button>
              <button
                type="button"
                data-testid="prompter-unoverlap-blocks"
                disabled={prompterParts.length < 2 || ttsBatchProgress !== null}
                title="Shift overlapping prompter blocks right so none overlap; linked audio moves with its block"
                onClick={unoverlapSlidePrompterBlocks}
              >
                Unoverlap all blocks
              </button>
              <button
                className="popular-audio-open-button"
                data-testid="prompter-ai-improve"
                title="Send a preset TTS improvement request for the current slide's prompter blocks"
                onClick={() => void improvePrompterBlocks()}
              >
                Improve blocks
              </button>
              <button
                data-testid="prompter-ai-open"
                title="Open a chat to ask about this slide’s prompter text"
                onClick={openPrompterAssistant}
                style={{
                  padding: '5px 12px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Prompter AI
              </button>
              <button
                className="popular-audio-open-button"
                data-testid="open-popular-audio"
                onClick={() => setShowPopularAudio(true)}
              >
                Popular recordings
              </button>
            </div>
          )}
        </div>
      )}
      {(slide || isClipEdit) && (
        <TimelineToolbar
          slideId={toolbarSlideId}
          duration={toolbarDuration}
          viewportWidth={viewportWidth}
          zoomAnchor={() => lastPointerTimeRef.current}
          clipEdit={
            isClipEdit
              ? { clipId: clipEditDefinition!.id, clipName: clipEditDefinition!.name }
              : undefined
          }
        />
      )}
      {body}
      {showPopularAudio && slide && (
        <PopularAudioModal
          slideId={slide.id}
          onClose={() => setShowPopularAudio(false)}
          onAdd={(id) => {
            const recording = usePopularAudioStore
              .getState()
              .recordings.find((item) => item.id === id)
            if (!recording) return
            const assetId = `popular-asset-${recording.id}`
            if (!engine.getEmbeddedAsset(assetId))
              engine.embedAsset({
                id: assetId,
                name: recording.name,
                data: recording.data,
                mimeType: recording.mimeType,
                metadata: { duration: recording.duration, waveformPeaks: recording.waveformPeaks },
              })
            const timelineStart = Math.max(0, currentTime)
            const playbackRate = recording.playbackRate ?? 1
            const sourceStart = recording.sourceStart ?? 0
            const sourceEnd = recording.sourceEnd
            const playbackDuration =
              playbackRate > 0 && sourceEnd > sourceStart
                ? (sourceEnd - sourceStart) / playbackRate
                : (recording.duration ?? 0)
            const timelineEnd = timelineStart + playbackDuration
            let bestPartId: string | null = null
            let bestOverlap = 0
            for (const part of prompterParts) {
              const overlap = Math.max(
                0,
                Math.min(part.endTime, timelineEnd) - Math.max(part.startTime, timelineStart),
              )
              if (overlap > bestOverlap + 1e-6) {
                bestOverlap = overlap
                bestPartId = part.id
              }
            }
            const bestPart =
              bestPartId !== null
                ? (prompterParts.find((part) => part.id === bestPartId) ?? null)
                : null
            if (bestPart && !hasPrompterPartAudio(bestPart)) {
              const index = prompterParts.findIndex((part) => part.id === bestPart.id)
              const snippet =
                bestPart.text.length > 40 ? `${bestPart.text.slice(0, 40)}…` : bestPart.text
              if (
                !window.confirm(
                  `Attach to block ${index + 1} ("${snippet}", ${bestPart.startTime.toFixed(1)}s–${bestPart.endTime.toFixed(1)}s)? OK attaches the audio to that block; Cancel adds it unlinked at the playhead.`,
                )
              ) {
                const unlinked = dispatch(
                  new CreateAudioClipCommand({
                    slideId: slide.id,
                    assetId,
                    trackId: 'voice',
                    timelineStart,
                    sourceStart: recording.sourceStart,
                    sourceEnd: recording.sourceEnd,
                    volume: recording.volume,
                    playbackRate: recording.playbackRate,
                    pitchSemitones: recording.pitchSemitones,
                    noiseReduction: recording.noiseReduction,
                  }),
                )
                if (!unlinked.ok) useNotificationStore.getState().notify(unlinked.error.message)
                else setShowPopularAudio(false)
                return
              }
              const clipId = newId('audio-clip')
              const result = dispatch(
                new TransactionCommand([
                  new CreateAudioClipCommand({
                    id: clipId,
                    slideId: slide.id,
                    assetId,
                    trackId: 'voice',
                    timelineStart: bestPart.startTime,
                    sourceStart: recording.sourceStart,
                    sourceEnd: recording.sourceEnd,
                    volume: recording.volume,
                    playbackRate: recording.playbackRate,
                    pitchSemitones: recording.pitchSemitones,
                    noiseReduction: recording.noiseReduction,
                  }),
                  new SetPrompterPartAudioCommand({
                    slideId: slide.id,
                    partId: bestPart.id,
                    audioClipId: clipId,
                    audioAssetId: assetId,
                  }),
                ]),
              )
              if (!result.ok) {
                useNotificationStore.getState().notify(result.error.message)
              } else {
                const index = prompterParts.findIndex((part) => part.id === bestPart.id)
                useNotificationStore.getState().notify(`Attached to prompter block ${index + 1}.`)
                setShowPopularAudio(false)
              }
              return
            }
            const result = dispatch(
              new CreateAudioClipCommand({
                slideId: slide.id,
                assetId,
                trackId: 'voice',
                timelineStart,
                sourceStart: recording.sourceStart,
                sourceEnd: recording.sourceEnd,
                volume: recording.volume,
                playbackRate: recording.playbackRate,
                pitchSemitones: recording.pitchSemitones,
                noiseReduction: recording.noiseReduction,
              }),
            )
            if (!result.ok) {
              useNotificationStore.getState().notify(result.error.message)
            } else {
              if (bestPart) {
                const index = prompterParts.findIndex((part) => part.id === bestPart.id)
                useNotificationStore
                  .getState()
                  .notify(
                    `Cannot attach: block ${index + 1} already has audio — added as unlinked clip.`,
                  )
              } else if (prompterParts.length > 0) {
                useNotificationStore
                  .getState()
                  .notify(
                    `Cannot attach: no prompter block overlaps the playhead time (${timelineStart.toFixed(1)}s) — added as unlinked clip.`,
                  )
              }
              setShowPopularAudio(false)
            }
          }}
        />
      )}
      {showCombinedTts && slide && (
        <CombinedTtsModal
          slideId={slide.id}
          blocks={prompterParts.map((part) => ({
            id: part.id,
            text: part.text,
            startTime: part.startTime,
            duration: part.duration,
            ...(part.ttsLanguage ? { ttsLanguage: part.ttsLanguage } : {}),
          }))}
          onClose={() => setShowCombinedTts(false)}
        />
      )}
      {confirmTtsReplace && slide && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="prompter-tts-replace-title"
          data-testid="prompter-tts-replace-dialog"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'grid',
            placeItems: 'center',
            background: 'rgba(0, 0, 0, 0.45)',
          }}
        >
          <section style={{ padding: 20, background: 'var(--color-bg-panel)', borderRadius: 8 }}>
            <h2 id="prompter-tts-replace-title">Replace existing block audio?</h2>
            <p>
              {generatedAudioCount} of {prompterParts.length} blocks already have audio. Generating
              TTS for all blocks will delete and replace their existing audio.
            </p>
            <button type="button" onClick={() => setConfirmTtsReplace(false)}>
              Cancel
            </button>
            <button
              type="button"
              data-testid="prompter-tts-replace-confirm"
              onClick={() => void generateSlideTts()}
            >
              Delete previous audio and generate all
            </button>
          </section>
        </div>
      )}
      {ttsBatchError && (
        <div role="alert" data-testid="prompter-tts-batch-error">
          {ttsBatchError}
        </div>
      )}
    </div>
  )
}
