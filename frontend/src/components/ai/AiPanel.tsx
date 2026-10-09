import { useEffect, useMemo, useState } from 'react'
import { buildContextSnapshot, filterConversations } from '../../ai/contextSnapshot'
import { AiMarkdown } from '../../ai/markdown'
import { useEngine } from '../../app/useEngine'
import { useAiStore } from '../../stores/aiStore'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useBackendStore } from '../../stores/backendStore'
import { AiPlanView } from './AiPlanView'
import { AiProposalView } from './AiProposalView'
import { AiNarrationView } from './AiNarrationView'
import { AiReconciliationView } from './AiReconciliationView'
import { AiScenarioView } from './AiScenarioView'

export function AiPanel() {
  const { engine } = useEngine()
  const projectId = engine.project?.id ?? ''
  const projectName = engine.project?.name ?? 'No project'

  const conversations = useAiStore((s) => s.conversations)
  const messagesById = useAiStore((s) => s.messagesById)
  const activeByProject = useAiStore((s) => s.activeByProject)
  const drafts = useAiStore((s) => s.drafts)
  const search = useAiStore((s) => s.search)
  const status = useAiStore((s) => s.status)
  const streamingConversationId = useAiStore((s) => s.streamingConversationId)
  const streamingContent = useAiStore((s) => s.streamingContent)
  const lastError = useAiStore((s) => s.lastError)
  const panelOpen = useAiStore((s) => s.panelOpen)

  const activeId = projectId ? (activeByProject[projectId] ?? null) : null
  const draft = projectId ? (drafts[projectId] ?? '') : ''
  const backendStatus = useBackendStore((s) => s.status)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')

  const store = useAiStore.getState()

  useEffect(() => {
    if (projectId) void store.loadConversations(projectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

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
  const selectionKey = selection.join(',')
  const assetKey = assetNames.join(',')
  const audioKey = audioNames.join(',')

  const context = useMemo(
    () => buildContextSnapshot(engine, { selection, assetNames, audioNames }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, projectId, selectionKey, assetKey, audioKey],
  )

  const visibleConversations = useMemo(
    () => filterConversations(conversations, messagesById, search),
    [conversations, messagesById, search],
  )

  const messages = activeId ? (messagesById[activeId] ?? []) : []
  const isStreaming = status === 'streaming' && streamingConversationId === activeId
  const unavailable = status === 'unavailable' || backendStatus === 'unavailable'

  const handleSend = () => {
    if (!projectId || !activeId || !draft.trim() || isStreaming || unavailable) return
    void store.sendMessage(projectId, activeId, draft, context)
  }

  const handleRegenerate = () => {
    if (!projectId || !activeId || isStreaming || unavailable) return
    void store.regenerate(projectId, activeId, context)
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

      {unavailable ? (
        <>
          <div data-testid="ai-unavailable">
            AI unavailable — the backend is unreachable. The editor still works.
          </div>
          <AiPlanView projectId={projectId} conversationId={activeId} context={context} disabled />
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
          <AiProposalView projectId={projectId} conversationId={activeId} disabled />
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
                if (projectId) void store.createConversation(projectId)
              }}
            >
              New conversation
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
                      onClick={() => projectId && store.setActive(projectId, conv.id)}
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
              placeholder="Ask about your lesson…"
              value={draft}
              onChange={(e) => projectId && store.setDraft(projectId, e.target.value)}
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

          <AiProposalView projectId={projectId} conversationId={activeId} disabled={unavailable} />
        </>
      )}
    </div>
  )
}
