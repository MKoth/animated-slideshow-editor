import { useEffect, useMemo, useState } from 'react'
import { buildContextSnapshot, filterConversations } from '../../ai/contextSnapshot'
import { AiMarkdown } from '../../ai/markdown'
import { formatTokenCount, sumConversationUsage } from '../../ai/tokens'
import { useEngine } from '../../app/useEngine'
import { conversationModeOf, normalizeAiMode, useAiStore } from '../../stores/aiStore'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useBackendStore } from '../../stores/backendStore'
import { AiPlanView } from './AiPlanView'
import { AiProposalModal, type ProposalModalState } from './AiProposalModal'
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
    if (mode === 'lesson' && s.drafts[projectId] !== undefined) {
      return s.drafts[projectId] ?? ''
    }
    return ''
  })
  const backendStatus = useBackendStore((s) => s.status)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [proposalModal, setProposalModal] = useState<ProposalModalState | null>(null)
  const [othersOpen, setOthersOpen] = useState(false)
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
    if (!projectId || activeId) return
    const mode = normalizeAiMode(assistantMode)
    const fallback = conversations.find(
      (conv) => conv.projectId === projectId && conversationModeOf(conv) === mode,
    )
    if (fallback) void store.setActive(projectId, fallback.id, mode)
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

  const context = useMemo(
    () => buildContextSnapshot(engine, { selection, assetNames, audioNames }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, projectId, selectionKey, assetKey, audioKey],
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
  const isAnimationMode = assistantMode === 'animation'

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

  const handleDraft = (messageId: string) => {
    if (!projectId || !activeId || proposalBusy || unavailable) return
    setDraftErrorByMessage((prev) => {
      if (!(messageId in prev)) return prev
      const next = { ...prev }
      delete next[messageId]
      return next
    })
    void store
      .draftProposal({ projectId, conversationId: activeId, messageId, context })
      .then((created) => {
        if (created) {
          setProposalModal({ mode: 'review', proposalId: created.id })
        } else {
          const err = useAiStore.getState().proposalError
          setDraftErrorByMessage((prev) => ({
            ...prev,
            [messageId]: err?.message ?? 'Drafting failed.',
          }))
        }
      })
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
          data-testid="ai-mode-lesson"
          disabled={assistantMode === 'lesson'}
          onClick={() => store.setAssistantMode('lesson')}
        >
          Lesson
        </button>
        <button
          data-testid="ai-mode-animation"
          disabled={isAnimationMode}
          onClick={() => store.setAssistantMode('animation')}
        >
          Animation
        </button>
      </div>

      {unavailable ? (
        <>
          <div data-testid="ai-unavailable">
            AI unavailable — the backend is unreachable. The editor still works.
          </div>
          {isAnimationMode ? (
            <AiAnimationView
              projectId={projectId}
              conversationId={activeId}
              context={context}
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
              <AiBoardView
                projectId={projectId}
                narrationId={activeNarrationId}
                conversationId={activeId}
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
              New {isAnimationMode ? 'animation' : 'lesson'} conversation
            </button>
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
            {messages.map((message) => (
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
                    </div>
                  ))}
                {message.role === 'assistant' && !message.errorCode && (
                  <>
                    <button
                      data-testid={`ai-message-draft-${message.id}`}
                      disabled={proposalBusy || unavailable}
                      onClick={() => handleDraft(message.id)}
                    >
                      Draft for me
                    </button>
                    <button
                      data-testid={`ai-message-propose-${message.id}`}
                      onClick={() => setProposalModal({ mode: 'create', messageId: message.id })}
                    >
                      Propose edit
                    </button>
                    {draftErrorByMessage[message.id] && (
                      <div data-testid={`ai-message-draft-error-${message.id}`}>
                        {draftErrorByMessage[message.id]}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
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
              placeholder={isAnimationMode ? 'Describe the performance…' : 'Ask about your lesson…'}
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

          {isAnimationMode ? (
            <AiAnimationView
              projectId={projectId}
              conversationId={activeId}
              context={context}
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

              <AiBoardView
                projectId={projectId}
                narrationId={activeNarrationId}
                conversationId={activeId}
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
