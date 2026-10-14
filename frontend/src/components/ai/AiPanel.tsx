import { useEffect, useMemo, useState } from 'react'
import { buildContextSnapshot, filterConversations } from '../../ai/contextSnapshot'
import { animationAssetsFromConversationProposals } from '../../ai/animationAssetOperations'
import { AiMarkdown } from '../../ai/markdown'
import { extractLegacyScriptBlock, transpileLegacyScript } from '../../ai/legacyScript'
import { extractScriptBlock, resolveScriptSlideId } from '../../ai/scriptBlock'
import { buildShapeStepOperation, extractShapeStepBlock } from '../../ai/shapeStep'
import { buildClipBatchOperations, extractClipBatchBlock } from '../../ai/clipBatch'
import { useFingerprint } from '../../ai/proposalFingerprint'
import { formatTokenCount, sumConversationUsage } from '../../ai/tokens'
import { useEngine } from '../../app/useEngine'
import { conversationModeOf, normalizeAiMode, useAiStore } from '../../stores/aiStore'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useBackendStore } from '../../stores/backendStore'
import { AiPlanView } from './AiPlanView'
import { AiProposalModal, type ProposalModalState } from './AiProposalModal'
import { AiProposalDetail } from './AiProposalView'
import { AiAnimationView } from './AiAnimationView'
import { AiBoardView } from './AiBoardView'
import { AiCalibrationView } from './AiCalibrationView'
import { AiNarrationView } from './AiNarrationView'
import { AiReconciliationView } from './AiReconciliationView'
import { AiScenarioView } from './AiScenarioView'

export function AiPanel() {
  const { engine } = useEngine()
  const projectId = engine.project?.id ?? ''
  const projectName = engine.project?.name ?? 'No project'

  const conversations = useAiStore((s) => s.conversations)
  const messagesById = useAiStore((s) => s.messagesById)
  const search = useAiStore((s) => s.search)
  const status = useAiStore((s) => s.status)
  const streamingConversationId = useAiStore((s) => s.streamingConversationId)
  const streamingContent = useAiStore((s) => s.streamingContent)
  const lastError = useAiStore((s) => s.lastError)
  const panelOpen = useAiStore((s) => s.panelOpen)
  const assistantMode = useAiStore((s) => s.assistantMode)

  const activeId = useAiStore((s) =>
    projectId ? (s.activeIdFor(projectId, s.assistantMode) ?? null) : null,
  )
  const draft = useAiStore((s) => {
    if (!projectId) return ''
    const mode = normalizeAiMode(s.assistantMode)
    const key = `${projectId}:${mode}`
    if (s.drafts[key] !== undefined) return s.drafts[key] ?? ''
    if (mode === 'scenario' && s.drafts[projectId] !== undefined) {
      return s.drafts[projectId] ?? ''
    }
    return ''
  })
  const backendStatus = useBackendStore((s) => s.status)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [proposalModal, setProposalModal] = useState<ProposalModalState | null>(null)
  const [othersOpen, setOthersOpen] = useState(false)
  const [copyConversationState, setCopyConversationState] = useState<{
    id: string
    status: 'copied' | 'failed'
  } | null>(null)
  const proposals = useAiStore((s) => s.proposals)

  const store = useAiStore.getState()

  useEffect(() => {
    if (projectId) {
      void store.loadConversations(projectId)
      void store.loadProposals(projectId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    const m = normalizeAiMode(assistantMode)
    if (!activeId) {
      const fallback = conversations.find(
        (conv) => conv.projectId === projectId && conversationModeOf(conv) === m,
      )
      if (fallback) void store.setActive(projectId, fallback.id, m)
      return
    }
    // A stale cross-mode mapping (e.g. animation key pointing at a collection
    // conversation) must never render — revalidate on every tab switch. An id
    // missing from the list is left alone: the loader owns that case.
    const current = conversations.find((conv) => conv.id === activeId)
    if (current === undefined || conversationModeOf(current) === m) return
    const fallback = conversations.find(
      (conv) => conv.projectId === projectId && conversationModeOf(conv) === m,
    )
    if (fallback) void store.setActive(projectId, fallback.id, m)
    else void store.clearActive(projectId, m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, assistantMode, conversations, activeId])

  useEffect(() => {
    if (activeId) void store.loadMessages(activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const selection = useSelectionStore((s) => s.selectedIds)
  const definitions = useAssetLibraryStore((s) => s.definitions)
  const assetNames = useMemo(() => definitions.map((d) => d.name), [definitions])
  const audioNames = useMemo(
    () => definitions.filter((d) => d.category === 'audio').map((d) => d.name),
    [definitions],
  )
  const activeScenarioId = useAiStore((s) => s.activeScenarioId)
  const activeReconciliationId = useAiStore((s) => s.activeReconciliationId)
  const activeNarrationId = useAiStore((s) => s.activeNarrationId)
  const selectionKey = selection.join(',')
  const assetKey = assetNames.join(',')
  const audioKey = audioNames.join(',')
  const conversationAssets = useMemo(
    () => animationAssetsFromConversationProposals(proposals, activeId),
    [proposals, activeId],
  )

  const context = useMemo(
    () =>
      buildContextSnapshot(engine, {
        selection,
        assetNames,
        audioNames,
        animationAssets: conversationAssets,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, projectId, selectionKey, assetKey, audioKey, conversationAssets],
  )

  const visibleConversations = useMemo(() => {
    const inMode = conversations.filter(
      (conv) => conversationModeOf(conv) === normalizeAiMode(assistantMode),
    )
    return filterConversations(inMode, messagesById, search)
  }, [conversations, messagesById, search, assistantMode])

  const messages = useMemo(
    () => (activeId ? (messagesById[activeId] ?? []) : []),
    [messagesById, activeId],
  )
  const messageIds = useMemo(() => new Set(messages.map((m) => m.id)), [messages])
  // Stage flows (narration/calibration/board) create proposals without a
  // message link — they surface here, collapsed, instead of a bottom section.
  const unattachedProposals = useMemo(
    () =>
      proposals.filter((p) => p.conversationId === activeId && !messageIds.has(p.messageId ?? '')),
    [proposals, activeId, messageIds],
  )
  const usage = useMemo(() => sumConversationUsage(messages), [messages])
  const usageText = useMemo(() => {
    if (messages.length === 0) return 'No messages yet — usage will appear here.'
    if (usage.trackedMessages === 0) {
      return `Token usage not yet reported for this conversation (${messages.length} message(s), provider did not report usage).`
    }
    const base =
      `Tokens in this conversation: ${formatTokenCount(usage.totalTokens)} total ` +
      `(prompt ${formatTokenCount(usage.promptTokens)} · completion ${formatTokenCount(usage.completionTokens)})`
    return usage.untrackedMessages > 0
      ? `${base} · ${usage.untrackedMessages} older message(s) untracked`
      : base
  }, [messages, usage])
  const isStreaming = status === 'streaming' && streamingConversationId === activeId
  const unavailable = status === 'unavailable' || backendStatus === 'unavailable'
  const mode = normalizeAiMode(assistantMode)
  // Lesson was split into scenario/audio/blackboard: those render the
  // plan/scenario/reconciliation/narration/calibration/board stages while
  // animation/shapes/collections share the asset chat + proposals chrome.
  const isStageMode = mode === 'scenario' || mode === 'audio' || mode === 'blackboard'
  const usesAssetChrome = !isStageMode

  const handleSend = () => {
    if (!projectId || !activeId || !draft.trim() || isStreaming || unavailable) return
    void store.sendMessage(projectId, activeId, draft, context, normalizeAiMode(assistantMode))
  }

  const handleRegenerate = () => {
    if (!projectId || !activeId || isStreaming || unavailable) return
    void store.regenerate(projectId, activeId, context, normalizeAiMode(assistantMode))
  }

  const [draftErrorByMessage, setDraftErrorByMessage] = useState<Record<string, string>>({})
  const proposalBusy = useAiStore((s) => s.proposalBusy)
  const fingerprint = useFingerprint(engine)

  const clearDraftError = (messageId: string) => {
    setDraftErrorByMessage((prev) => {
      if (!(messageId in prev)) return prev
      const next = { ...prev }
      delete next[messageId]
      return next
    })
  }

  const failDraft = (messageId: string, fallback: string) => {
    const err = useAiStore.getState().proposalError
    setDraftErrorByMessage((prev) => ({
      ...prev,
      [messageId]: err?.message ?? fallback,
    }))
  }

  const handleCopyConversation = async (conversationId: string, title: string) => {
    try {
      const conversationMessages = await store.api.listMessages(conversationId)
      const text = [
        `Conversation: ${title}`,
        ...conversationMessages.map(
          (message) => `${message.role === 'user' ? 'User' : 'Assistant'}:\n${message.content}`,
        ),
      ].join('\n\n')
      await navigator.clipboard.writeText(text)
      setCopyConversationState({ id: conversationId, status: 'copied' })
      window.setTimeout(() => setCopyConversationState(null), 1800)
    } catch {
      setCopyConversationState({ id: conversationId, status: 'failed' })
      window.setTimeout(() => setCopyConversationState(null), 2500)
    }
  }

  // LLM path: converts a prose-only message into commands. Used only when the
  // message has no appliable script block — hence the wait for the model.
  // Stage modes (Scenario/Audio/Blackboard) review in the modal; asset-chrome
  // modes (Animation/Shapes/Collections) render the new proposal inline under
  // its message, so the modal closes.
  const handleDraft = (messageId: string) => {
    if (!projectId || !activeId || proposalBusy || unavailable) return
    clearDraftError(messageId)
    setProposalModal({ mode: 'drafting', messageId })
    void store
      .draftProposal({ projectId, conversationId: activeId, messageId, context })
      .then((created) => {
        if (created) {
          if (isStageMode) setProposalModal({ mode: 'review', proposalId: created.id })
          else setProposalModal(null)
        } else {
          setProposalModal(null)
          failDraft(messageId, 'Drafting failed.')
        }
      })
  }

  // Instant path: the message already carries an appliable script block, so
  // the proposal is built locally — no second AI call, only a fast POST.
  // Stage modes review in the modal; asset-chrome modes review inline, so the modal closes.
  const handleDraftScript = (messageId: string) => {
    if (!projectId || !activeId || proposalBusy || unavailable) return
    const message = messages.find((m) => m.id === messageId)
    const block = message ? extractScriptBlock(message.content) : null
    const legacy = !block && message ? extractLegacyScriptBlock(message.content) : null
    if (!block && !legacy) return
    const slideHint = block?.slideHint ?? legacy?.slideHint ?? null
    const slideId = resolveScriptSlideId(
      context.slides,
      slideHint,
      context.animation.timeline.slideId,
    )
    if (!slideId) {
      setDraftErrorByMessage((prev) => ({
        ...prev,
        [messageId]: 'Could not resolve the script slide — answer with the slide name.',
      }))
      return
    }
    const source = block?.source ?? (legacy ? transpileLegacyScript(legacy, engine, slideId) : null)
    if (!source) {
      setDraftErrorByMessage((prev) => ({
        ...prev,
        [messageId]:
          'This legacy script uses animation data that cannot be safely converted — ask for a current Animation Script.',
      }))
      return
    }
    clearDraftError(messageId)
    setProposalModal({ mode: 'drafting', messageId })
    void store
      .createProposal({
        projectId,
        conversationId: activeId,
        messageId,
        title: `Animation script for ${slideHint ?? 'slide'}`,
        commands: [
          {
            // Blackboard authors board scripts directly; other modes run with
            // replace-by-footprint semantics.
            type: mode === 'blackboard' ? 'SetSlideAnimationScript' : 'AiRunAnimationScript',
            slideId,
            source,
          },
        ],
        projectFingerprint: fingerprint,
      })
      .then((created) => {
        if (created) {
          if (isStageMode) setProposalModal({ mode: 'review', proposalId: created.id })
          else setProposalModal(null)
        } else {
          setProposalModal(null)
          failDraft(messageId, 'Drafting failed.')
        }
      })
  }

  // Instant shape path: the message already carries an appliable shape-step
  // block, so the proposal is built locally from live mesh geometry — no
  // second AI call, only a fast POST. Vertices duplicate the live source
  // Shape verbatim, so the mesh vertex count holds by construction.
  const handleDraftShape = (messageId: string) => {
    if (!projectId || !activeId || proposalBusy || unavailable) return
    const message = messages.find((m) => m.id === messageId)
    const step = message ? extractShapeStepBlock(message.content) : null
    if (!step) return
    const node =
      context.animation.nodes.find((entry) => entry.id === step.node) ??
      context.animation.nodes.find((entry) => entry.name.toLowerCase() === step.node.toLowerCase())
    if (!node) {
      setDraftErrorByMessage((prev) => ({
        ...prev,
        [messageId]: 'Could not resolve the target node — answer with the node name.',
      }))
      return
    }
    let liveShapes: { id: string; name: string; vertices: { x: number; y: number }[] }[]
    try {
      liveShapes = engine.getShapes(node.id).map((shape) => ({
        id: shape.id,
        name: shape.name,
        vertices: shape.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
      }))
    } catch {
      setDraftErrorByMessage((prev) => ({
        ...prev,
        [messageId]: `Node “${node.name}” has no mesh Shapes — pick a mesh node.`,
      }))
      return
    }
    const built = buildShapeStepOperation({ step, nodeId: node.id, liveShapes })
    if ('error' in built) {
      setDraftErrorByMessage((prev) => ({ ...prev, [messageId]: built.error }))
      return
    }
    clearDraftError(messageId)
    setProposalModal({ mode: 'drafting', messageId })
    const label = step.name ?? step.target ?? step.shape ?? 'shape'
    const title =
      'summary' in built && built.summary
        ? `Shape ${step.action} “${label}” on ${node.name} (${built.summary})`
        : `Shape ${step.action} “${label}” on ${node.name}`
    void store
      .createProposal({
        projectId,
        conversationId: activeId,
        messageId,
        title,
        commands: [{ type: 'AiAnimationAssetBatch', operations: [built.operation] }],
        projectFingerprint: fingerprint,
      })
      .then((created) => {
        if (created) {
          if (isStageMode) setProposalModal({ mode: 'review', proposalId: created.id })
          else setProposalModal(null)
        } else {
          setProposalModal(null)
          failDraft(messageId, 'Drafting failed.')
        }
      })
  }

  // Instant clip-batch path: the message already carries an appliable
  // clip-batch block, so every Clip is extracted locally from live timeline
  // orphans — real keyframes, normalized to duration 1, canonical ClipJSON.
  // No second AI call (which cannot see orphan data and invents channels),
  // only a fast POST with one single-operation command per step.
  const handleDraftCollection = (messageId: string) => {
    if (!projectId || !activeId || proposalBusy || unavailable) return
    const message = messages.find((m) => m.id === messageId)
    const plan = message ? extractClipBatchBlock(message.content) : null
    if (!plan) return
    const built = buildClipBatchOperations({ engine, nodes: context.animation.nodes, plan })
    if (!built.ok) {
      setDraftErrorByMessage((prev) => ({ ...prev, [messageId]: built.error }))
      return
    }
    clearDraftError(messageId)
    setProposalModal({ mode: 'drafting', messageId })
    const title =
      `Clip batch — ${built.build.steps.length} clips ` +
      `from timeline ${built.build.from}–${built.build.to}s: ${built.build.summary}`
    void store
      .createProposal({
        projectId,
        conversationId: activeId,
        messageId,
        title,
        commands: built.build.operations.map((operation) => ({
          type: 'AiAnimationAssetBatch',
          operations: [operation],
        })),
        projectFingerprint: fingerprint,
      })
      .then((created) => {
        if (created) {
          if (isStageMode) setProposalModal({ mode: 'review', proposalId: created.id })
          else setProposalModal(null)
        } else {
          setProposalModal(null)
          failDraft(messageId, 'Drafting failed.')
        }
      })
  }

  // Fix-and-resubmit: a clip-batch block failed local drafting (unknown node,
  // unknown shape, bad track...). Sends the failure back to the assistant so it
  // replies with a corrected block — the fix arrives as a new message that
  // supersedes the broken one (history stays append-only: proposals link to
  // their messages, so the old message is never deleted).
  const handleFixBatch = (messageId: string) => {
    if (!projectId || !activeId || isStreaming || unavailable) return
    const err = draftErrorByMessage[messageId] ?? 'unknown drafting error'
    clearDraftError(messageId)
    void store.sendMessage(
      projectId,
      activeId,
      `The clip batch in your previous message failed to draft: ${err}\n\n` +
        `Fix the \`\`\`clip-batch block and reply with a corrected block (same steps, corrected). ` +
        `Valid tracks are positionX, positionY, rotation, scaleX, scaleY, opacity, morph, ` +
        `visible, zIndex, circle.<prop> — rotation is plain rotation, never rotationX/Y/Z. ` +
        `Every batch must close with one collection: <name> | source: <rig root node> line binding every step's Semantic Name — never omit it. ` +
        `Do not claim anything was created.`,
      context,
      normalizeAiMode(assistantMode),
    )
  }

  if (!panelOpen) return null

  return (
    <div className="ai-panel" data-testid="ai-panel">
      <div className="ai-panel__header">
        <span>AI Assistant — {projectName}</span>
        <button data-testid="ai-panel-close" onClick={() => store.setPanelOpen(false)}>
          Close
        </button>
      </div>
      <div className="ai-panel__modes" data-testid="ai-assistant-mode">
        <button
          data-testid="ai-mode-scenario"
          disabled={mode === 'scenario'}
          onClick={() => store.setAssistantMode('scenario')}
        >
          Scenario
        </button>
        <button
          data-testid="ai-mode-audio"
          disabled={mode === 'audio'}
          onClick={() => store.setAssistantMode('audio')}
        >
          Audio
        </button>
        <button
          data-testid="ai-mode-blackboard"
          disabled={mode === 'blackboard'}
          onClick={() => store.setAssistantMode('blackboard')}
        >
          Blackboard
        </button>
        <button
          data-testid="ai-mode-animation"
          disabled={mode === 'animation'}
          onClick={() => store.setAssistantMode('animation')}
        >
          Animation
        </button>
        <button
          data-testid="ai-mode-shape"
          disabled={mode === 'shape'}
          onClick={() => store.setAssistantMode('shape')}
        >
          Shapes
        </button>
        <button
          data-testid="ai-mode-collection"
          disabled={mode === 'collection'}
          onClick={() => store.setAssistantMode('collection')}
        >
          Collections
        </button>
      </div>

      {unavailable ? (
        <>
          <div data-testid="ai-unavailable">
            AI unavailable — the backend is unreachable. The editor still works.
          </div>
          {usesAssetChrome ? (
            <AiAnimationView
              projectId={projectId}
              conversationId={activeId}
              context={context}
              disabled
              assistantMode={mode === 'shape' || mode === 'collection' ? mode : 'animation'}
            />
          ) : mode === 'audio' ? (
            <>
              <AiNarrationView
                projectId={projectId}
                reconciliationId={activeReconciliationId}
                conversationId={activeId}
                disabled
              />
              <AiCalibrationView
                projectId={projectId}
                narrationId={activeNarrationId}
                conversationId={activeId}
                disabled
              />
            </>
          ) : mode === 'blackboard' ? (
            <AiBoardView
              projectId={projectId}
              narrationId={activeNarrationId}
              conversationId={activeId}
              disabled
            />
          ) : (
            <>
              <AiPlanView
                projectId={projectId}
                conversationId={activeId}
                context={context}
                disabled
              />
              <AiScenarioView
                projectId={projectId}
                conversationId={activeId}
                context={context}
                disabled
              />
              <AiReconciliationView
                projectId={projectId}
                scenarioId={activeScenarioId}
                conversationId={activeId}
                context={context}
                disabled
              />
            </>
          )}
        </>
      ) : (
        <>
          <div className="ai-panel__conversations">
            <input
              data-testid="ai-search"
              placeholder="Search conversations"
              value={search}
              onChange={(e) => store.setSearch(e.target.value)}
            />
            <button
              data-testid="ai-new-conversation"
              disabled={!projectId}
              onClick={() => {
                if (projectId)
                  void store.createConversation(projectId, normalizeAiMode(assistantMode))
              }}
            >
              New {normalizeAiMode(assistantMode)} conversation
            </button>
            {visibleConversations.length === 0 && !activeId && (
              <div data-testid="ai-no-conversation-in-mode">
                No {normalizeAiMode(assistantMode)} conversation yet — create one above. Other
                modes&apos; conversations stay in their own tabs.
              </div>
            )}
            <ul data-testid="ai-conversation-list">
              {visibleConversations.map((conv) => (
                <li key={conv.id} data-testid={`ai-conversation-${conv.id}`}>
                  {renamingId === conv.id ? (
                    <input
                      data-testid="ai-rename-input"
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onBlur={() => {
                        void store.renameConversation(conv.id, renameText)
                        setRenamingId(null)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          void store.renameConversation(conv.id, renameText)
                          setRenamingId(null)
                        }
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      autoFocus
                    />
                  ) : (
                    <button
                      data-testid={`ai-switch-${conv.id}`}
                      onClick={() =>
                        projectId &&
                        store.setActive(projectId, conv.id, normalizeAiMode(assistantMode))
                      }
                      style={{ fontWeight: conv.id === activeId ? 'bold' : 'normal' }}
                    >
                      {conv.title}
                    </button>
                  )}
                  <button
                    type="button"
                    className="ai-panel__conversation-copy"
                    data-testid={`ai-copy-conversation-${conv.id}`}
                    aria-label={
                      copyConversationState?.id === conv.id
                        ? copyConversationState.status === 'copied'
                          ? 'Conversation copied'
                          : 'Copy conversation failed'
                        : `Copy conversation ${conv.title}`
                    }
                    title={
                      copyConversationState?.id === conv.id
                        ? copyConversationState.status === 'copied'
                          ? 'Copied'
                          : 'Copy failed'
                        : 'Copy conversation'
                    }
                    onClick={() => void handleCopyConversation(conv.id, conv.title)}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="8" y="8" width="13" height="13" rx="2" />
                      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
                    </svg>
                  </button>
                  <button
                    data-testid={`ai-rename-${conv.id}`}
                    onClick={() => {
                      setRenamingId(conv.id)
                      setRenameText(conv.title)
                    }}
                  >
                    Rename
                  </button>
                  <button
                    data-testid={`ai-delete-${conv.id}`}
                    onClick={() => projectId && void store.deleteConversation(projectId, conv.id)}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="ai-panel__messages" data-testid="ai-messages">
            <div data-testid="ai-token-usage">{usageText}</div>
            {unattachedProposals.length > 0 && (
              <div>
                <button
                  data-testid="ai-proposals-others-toggle"
                  aria-expanded={othersOpen}
                  onClick={() => setOthersOpen((open) => !open)}
                >
                  {othersOpen ? 'Hide' : 'Show'} {unattachedProposals.length} other proposal(s) in
                  this conversation
                </button>
                <div data-testid="ai-proposals-others" hidden={!othersOpen}>
                  {unattachedProposals.map((proposal) => (
                    <div key={proposal.id} data-testid={`ai-other-proposal-${proposal.id}`}>
                      <span>
                        Proposing: {proposal.title} ({proposal.commands.length} change(s),{' '}
                        {proposal.status})
                      </span>{' '}
                      <button
                        data-testid={`ai-other-proposal-view-${proposal.id}`}
                        onClick={() =>
                          setProposalModal({ mode: 'review', proposalId: proposal.id })
                        }
                      >
                        View
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message) => {
              const scriptBlock =
                message.role === 'assistant'
                  ? (extractScriptBlock(message.content) ??
                    extractLegacyScriptBlock(message.content))
                  : null
              const shapeStep =
                message.role === 'assistant' && !scriptBlock
                  ? extractShapeStepBlock(message.content)
                  : null
              const clipBatch =
                message.role === 'assistant' && !scriptBlock && !shapeStep
                  ? extractClipBatchBlock(message.content)
                  : null
              return (
                <div
                  key={message.id}
                  data-testid={`ai-message-${message.id}`}
                  data-role={message.role}
                >
                  <div className="ai-message__role">{message.role}</div>
                  {message.role === 'assistant' ? (
                    <AiMarkdown content={message.content} />
                  ) : (
                    <div>{message.content}</div>
                  )}
                  {message.stopped && (
                    <div data-testid={`ai-stopped-${message.id}`}>
                      (stopped — partial response kept)
                    </div>
                  )}
                  {message.errorCode && (
                    <div data-testid={`ai-error-${message.id}`}>
                      {message.content}
                      <button data-testid={`ai-retry-${message.id}`} onClick={handleRegenerate}>
                        Retry
                      </button>
                    </div>
                  )}
                  {proposals
                    .filter((p) => p.conversationId === activeId && p.messageId === message.id)
                    .map((proposal) => (
                      <div
                        key={proposal.id}
                        data-testid={`ai-message-proposal-${proposal.id}`}
                        className="ai-message__proposal"
                      >
                        {usesAssetChrome ? (
                          <AiProposalDetail
                            proposal={proposal}
                            fingerprint={fingerprint}
                            onDenyFeedback={(feedback) => {
                              if (!projectId || !activeId) return
                              void store.sendMessage(
                                projectId,
                                activeId,
                                `I denied proposal ${proposal.id}. Please revise it using this feedback: ${feedback}`,
                                context,
                                normalizeAiMode(assistantMode),
                              )
                            }}
                          />
                        ) : (
                          <>
                            <span>
                              Proposing: {proposal.title} ({proposal.commands.length} change(s),{' '}
                              {proposal.status})
                            </span>{' '}
                            <button
                              data-testid={`ai-message-proposal-view-${proposal.id}`}
                              onClick={() =>
                                setProposalModal({ mode: 'review', proposalId: proposal.id })
                              }
                            >
                              View
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  {message.role === 'assistant' && !message.errorCode && (
                    <>
                      {shapeStep ? (
                        <button
                          data-testid={`ai-message-draft-shape-${message.id}`}
                          disabled={proposalBusy || unavailable}
                          onClick={() => handleDraftShape(message.id)}
                        >
                          Draft this shape
                        </button>
                      ) : clipBatch ? (
                        <button
                          data-testid={`ai-message-draft-clip-batch-${message.id}`}
                          disabled={proposalBusy || unavailable}
                          onClick={() => handleDraftCollection(message.id)}
                        >
                          Draft clip batch ({clipBatch.steps.length} clips from timeline)
                        </button>
                      ) : scriptBlock ? (
                        <button
                          data-testid={`ai-message-draft-script-${message.id}`}
                          disabled={proposalBusy || unavailable}
                          onClick={() => handleDraftScript(message.id)}
                        >
                          Draft this script
                        </button>
                      ) : (
                        <button
                          data-testid={`ai-message-draft-${message.id}`}
                          disabled={proposalBusy || unavailable}
                          onClick={() => handleDraft(message.id)}
                        >
                          {mode === 'shape'
                            ? 'Draft shape proposal'
                            : mode === 'collection'
                              ? 'Draft collection proposal'
                              : 'Draft for me'}
                        </button>
                      )}
                      {isStageMode && (
                        <button
                          data-testid={`ai-message-propose-${message.id}`}
                          onClick={() =>
                            setProposalModal({ mode: 'create', messageId: message.id })
                          }
                        >
                          Propose edit
                        </button>
                      )}
                      {draftErrorByMessage[message.id] && (
                        <div data-testid={`ai-message-draft-error-${message.id}`}>
                          {draftErrorByMessage[message.id]}
                          {clipBatch && (
                            <button
                              data-testid={`ai-message-fix-batch-${message.id}`}
                              disabled={isStreaming || unavailable}
                              onClick={() => handleFixBatch(message.id)}
                            >
                              Send fix to assistant
                            </button>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })}
            {isStreaming && (
              <div data-testid="ai-streaming">
                <AiMarkdown content={streamingContent || '…'} />
                <button data-testid="ai-stop" onClick={() => store.stopStreaming()}>
                  Stop
                </button>
              </div>
            )}
            {lastError && !isStreaming && (
              <div data-testid="ai-last-error">
                {lastError.message}
                <button data-testid="ai-retry-last" onClick={handleRegenerate}>
                  Retry
                </button>
              </div>
            )}
          </div>

          <div className="ai-panel__input">
            <textarea
              data-testid="ai-input"
              placeholder={
                mode === 'animation'
                  ? 'Describe the performance…'
                  : mode === 'shape'
                    ? 'Describe the shape…'
                    : mode === 'collection'
                      ? 'Describe the collection…'
                      : mode === 'audio'
                        ? 'Describe the speech…'
                        : mode === 'blackboard'
                          ? 'Describe the blackboard…'
                          : 'Describe the lesson plan…'
              }
              value={draft}
              onChange={(e) =>
                projectId &&
                store.setDraft(projectId, e.target.value, normalizeAiMode(assistantMode))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
            />
            <button
              data-testid="ai-send"
              onClick={handleSend}
              disabled={isStreaming || !draft.trim()}
            >
              Send
            </button>
            <button
              data-testid="ai-regenerate"
              onClick={handleRegenerate}
              disabled={isStreaming || messages.length === 0}
            >
              Regenerate
            </button>
            <button data-testid="ai-settings-open" onClick={() => store.setSettingsOpen(true)}>
              AI Settings
            </button>
          </div>

          {usesAssetChrome ? (
            <AiAnimationView
              projectId={projectId}
              conversationId={activeId}
              context={context}
              disabled={unavailable}
              assistantMode={mode === 'shape' || mode === 'collection' ? mode : 'animation'}
            />
          ) : mode === 'audio' ? (
            <>
              <AiNarrationView
                projectId={projectId}
                reconciliationId={activeReconciliationId}
                conversationId={activeId}
                disabled={unavailable}
              />

              <AiCalibrationView
                projectId={projectId}
                narrationId={activeNarrationId}
                conversationId={activeId}
                disabled={unavailable}
              />
            </>
          ) : mode === 'blackboard' ? (
            <AiBoardView
              projectId={projectId}
              narrationId={activeNarrationId}
              conversationId={activeId}
              disabled={unavailable}
            />
          ) : (
            <>
              <AiPlanView
                projectId={projectId}
                conversationId={activeId}
                context={context}
                disabled={unavailable}
              />

              <AiScenarioView
                projectId={projectId}
                conversationId={activeId}
                context={context}
                disabled={unavailable}
              />

              <AiReconciliationView
                projectId={projectId}
                scenarioId={activeScenarioId}
                conversationId={activeId}
                context={context}
                disabled={unavailable}
              />
            </>
          )}

          {proposalModal && (
            <AiProposalModal
              projectId={projectId}
              conversationId={activeId}
              modal={proposalModal}
              onClose={() => setProposalModal(null)}
              onCreated={(proposalId) => setProposalModal({ mode: 'review', proposalId })}
            />
          )}
        </>
      )}
    </div>
  )
}
