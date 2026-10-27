import { useEffect, useMemo, useState } from 'react'
import { buildContextSnapshot } from '../../ai/contextSnapshot'
import { AiMarkdown } from '../../ai/markdown'
import { extractAskBlocks, stripAskBlocks } from '../../ai/askBlock'
import { extractScriptBlock } from '../../ai/scriptBlock'
import {
  buildScriptFocus,
  formatScriptErrorPrompt,
  IMPROVE_SCRIPT_PROMPT,
  type ScriptFocusDiagnostic,
} from '../../ai/scriptFocus'
import { checkScriptDraft, formatScriptDraftErrors } from '../../ai/scriptDraftCheck'
import { useFingerprint } from '../../ai/proposalFingerprint'
import { useEngine } from '../../app/useEngine'
import { useAiStore } from '../../stores/aiStore'
import { scriptSlideKey, useScriptAiStore } from '../../stores/scriptAiStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useAssetLibraryStore } from '../../stores/assetLibraryStore'
import { AiAskGroup } from './AiAskBlock'
import { AiProposalDetail } from './AiProposalView'

interface ScriptAiModalProps {
  projectId: string
  projectName: string
  slideId: string
  slideName: string
  /** Current editor draft — the assistant sees and rewrites this text. */
  draft: string
  /** Latest check diagnostics (errors drive the one-button fix resubmit). */
  diagnostics: readonly ScriptFocusDiagnostic[]
  onClose: () => void
}

/**
 * Slide-basis script assistant: one centered modal per slide script.
 * The thread scrolls; the textarea plus Send / Improve / Fix-errors buttons
 * stay fixed below it. Script fixes apply through the shared proposal gates
 * (draft → dry-run → approve → execute) as one undoable History entry.
 */
export function ScriptAiModal({
  projectId,
  projectName,
  slideId,
  slideName,
  draft,
  diagnostics,
  onClose,
}: ScriptAiModalProps) {
  const { engine } = useEngine()
  const store = useScriptAiStore.getState()
  const slideKey = scriptSlideKey(projectId, slideId)

  const messagesById = useScriptAiStore((s) => s.messagesById)
  const activeIdBySlide = useScriptAiStore((s) => s.activeIdBySlide)
  const drafts = useScriptAiStore((s) => s.drafts)
  const status = useScriptAiStore((s) => s.status)
  const streamingConversationId = useScriptAiStore((s) => s.streamingConversationId)
  const streamingContent = useScriptAiStore((s) => s.streamingContent)
  const lastError = useScriptAiStore((s) => s.lastError)
  const proposals = useAiStore((s) => s.proposals)
  const proposalBusy = useAiStore((s) => s.proposalBusy)
  const fingerprint = useFingerprint(engine)

  const [draftErrorByMessage, setDraftErrorByMessage] = useState<Record<string, string>>({})

  const activeId = activeIdBySlide[slideKey] ?? null
  const messages = activeId ? (messagesById[activeId] ?? []) : []
  const input = drafts[slideKey] ?? ''
  const isStreaming = status === 'streaming' && streamingConversationId === activeId
  const unavailable = status === 'unavailable'

  const selection = useSelectionStore((s) => s.selectedIds)
  const definitions = useAssetLibraryStore((s) => s.definitions)
  const assetNames = useMemo(() => definitions.map((d) => d.name), [definitions])
  const audioNames = useMemo(
    () => definitions.filter((d) => d.category === 'audio').map((d) => d.name),
    [definitions],
  )

  useEffect(() => {
    void store.loadConversations(projectId, slideId)
    void useAiStore.getState().loadProposals(projectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, slideId])

  const selectionKey = selection.join(',')
  const assetKey = assetNames.join(',')
  const audioKey = audioNames.join(',')

  const context = useMemo(
    () =>
      buildContextSnapshot(engine, {
        selection,
        assetNames,
        audioNames,
        scriptFocus: buildScriptFocus(engine, slideId, draft, diagnostics) ?? undefined,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, projectId, slideId, draft, diagnostics, selectionKey, assetKey, audioKey],
  )

  const errorDiagnostics = useMemo(
    () => diagnostics.filter((diagnostic) => diagnostic.severity === 'error'),
    [diagnostics],
  )

  const send = async (text: string) => {
    if (!projectId || !text.trim() || isStreaming || unavailable) return
    const id =
      activeId ?? (await store.ensureConversation(projectId, slideId, `Script — ${slideName}`))
    if (!id) return
    if (!useScriptAiStore.getState().messagesById[id]) {
      try {
        const loaded = await store.api.listMessages(id)
        useScriptAiStore.setState((state) => ({
          messagesById: { ...state.messagesById, [id]: loaded },
        }))
      } catch {
        // Empty thread renders fine without the fetch.
      }
    }
    void store.sendMessage(projectId, slideId, id, text, context)
  }

  const handleSend = () => void send(input)
  const handleImprove = () => void send(IMPROVE_SCRIPT_PROMPT)
  const handleFixErrors = () => {
    if (errorDiagnostics.length === 0) return
    void send(formatScriptErrorPrompt(errorDiagnostics))
  }

  const handleAnswerAsk = (text: string) => {
    if (!text.trim()) return
    void send(text)
  }

  const handleDraftScript = (messageId: string) => {
    if (!projectId || !activeId || proposalBusy || unavailable) return
    const message = messages.find((m) => m.id === messageId)
    const block = message ? extractScriptBlock(message.content) : null
    if (!block) return
    if (!block.source) {
      setDraftErrorByMessage((prev) => ({
        ...prev,
        [messageId]: 'No script source in this message — ask for a full revised script.',
      }))
      return
    }
    // Draft-time gate: a truncated or broken block never becomes a proposal.
    // The errors resubmit to the assistant with one click instead.
    const checked = checkScriptDraft(engine, slideId, block.source)
    if (!checked.runnable) {
      setDraftErrorByMessage((prev) => ({
        ...prev,
        [messageId]: formatScriptDraftErrors(checked.errors),
      }))
      return
    }
    setDraftErrorByMessage((prev) => {
      if (!(messageId in prev)) return prev
      const next = { ...prev }
      delete next[messageId]
      return next
    })
    void useAiStore
      .getState()
      .createProposal({
        projectId,
        conversationId: activeId,
        messageId,
        title: `Script fix for ${slideName}`,
        commands: [{ type: 'AiRunAnimationScript', slideId, source: block.source }],
        projectFingerprint: fingerprint,
      })
      .then((created) => {
        if (!created) {
          const err = useAiStore.getState().proposalError
          setDraftErrorByMessage((prev) => ({
            ...prev,
            [messageId]: err?.message ?? 'Drafting failed.',
          }))
        }
      })
  }

  return (
    <div
      className="script-ai-overlay"
      data-testid="script-ai-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="script-ai-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Script AI for ${slideName}`}
        data-testid="script-ai-modal"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <div className="script-ai-modal__header">
          <span>
            Script AI — {slideName} <span className="script-ai-modal__project">{projectName}</span>
          </span>
          <button type="button" data-testid="script-ai-close" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="script-ai-modal__messages" data-testid="script-ai-messages">
          {messages.length === 0 && !isStreaming ? (
            <div className="script-ai-modal__empty">
              <p>
                {unavailable
                  ? 'AI backend is unavailable.'
                  : 'Ask about this slide\u2019s script, or press Improve timing — the conversation starts with your first message.'}
              </p>
            </div>
          ) : (
            messages.map((message) => {
              const scriptBlock =
                message.role === 'assistant' ? extractScriptBlock(message.content) : null
              const askBlocks =
                message.role === 'assistant' ? extractAskBlocks(message.content) : []
              const shownContent =
                message.role === 'assistant' && askBlocks.length > 0
                  ? stripAskBlocks(message.content)
                  : message.content
              return (
                <div
                  key={message.id}
                  data-testid={`script-ai-message-${message.id}`}
                  data-role={message.role}
                  className="script-ai-modal__message"
                >
                  <div className="ai-message__role">{message.role}</div>
                  {message.role === 'assistant' ? (
                    shownContent ? (
                      <AiMarkdown content={shownContent} />
                    ) : null
                  ) : (
                    <div>{message.content}</div>
                  )}
                  {askBlocks.length > 0 && (
                    <AiAskGroup
                      blocks={askBlocks}
                      messageId={message.id}
                      disabled={isStreaming || unavailable}
                      onAnswer={handleAnswerAsk}
                    />
                  )}
                  {proposals
                    .filter((p) => p.conversationId === activeId && p.messageId === message.id)
                    .map((proposal) => (
                      <div
                        key={proposal.id}
                        data-testid={`script-ai-message-proposal-${proposal.id}`}
                        className="ai-message__proposal"
                      >
                        <AiProposalDetail
                          proposal={proposal}
                          fingerprint={fingerprint}
                          fixDisabled={isStreaming || unavailable}
                          onDryRunFix={(errorText) =>
                            void send(
                              `The drafted script failed validation:\n${errorText}\nReply with the corrected full script.`,
                            )
                          }
                          onDenyFeedback={(feedback) =>
                            void send(
                              `I denied proposal ${proposal.id}. Please revise it using this feedback: ${feedback}`,
                            )
                          }
                        />
                      </div>
                    ))}
                  {message.role === 'assistant' && !message.errorCode && scriptBlock && (
                    <button
                      type="button"
                      data-testid={`script-ai-message-draft-script-${message.id}`}
                      disabled={proposalBusy || unavailable}
                      onClick={() => handleDraftScript(message.id)}
                    >
                      Draft this script
                    </button>
                  )}
                  {draftErrorByMessage[message.id] && (
                    <div data-testid={`script-ai-message-draft-error-${message.id}`}>
                      {draftErrorByMessage[message.id]}
                      {draftErrorByMessage[message.id]?.startsWith(
                        'The drafted script failed validation',
                      ) && (
                        <button
                          type="button"
                          data-testid={`script-ai-message-fix-draft-${message.id}`}
                          disabled={isStreaming || unavailable}
                          onClick={() => void send(draftErrorByMessage[message.id] ?? '')}
                        >
                          Send fix to assistant
                        </button>
                      )}
                    </div>
                  )}
                  {message.errorCode && (
                    <div data-testid={`script-ai-error-${message.id}`}>{message.content}</div>
                  )}
                </div>
              )
            })
          )}
          {isStreaming && streamingContent && (
            <div className="script-ai-modal__message" data-testid="script-ai-streaming">
              <div className="ai-message__role">assistant</div>
              <AiMarkdown content={streamingContent} />
            </div>
          )}
          {lastError && streamingConversationId === activeId && (
            <div className="script-ai-modal__error" role="alert">
              {lastError.message}
            </div>
          )}
        </div>

        <div className="script-ai-modal__input">
          <textarea
            data-testid="script-ai-input"
            aria-label="Script AI request"
            placeholder="Ask about this slide's script…"
            value={input}
            autoFocus
            onChange={(event) => store.setDraft(slideKey, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleSend()
              }
            }}
            rows={3}
          />
          <div className="script-ai-modal__actions">
            <button
              type="button"
              data-testid="script-ai-send"
              onClick={handleSend}
              disabled={isStreaming || !input.trim()}
            >
              Send
            </button>
            <button
              type="button"
              data-testid="script-ai-improve"
              title="Ask the assistant to re-time visuals to the narration"
              onClick={handleImprove}
              disabled={isStreaming || unavailable}
            >
              Improve timing
            </button>
            {errorDiagnostics.length > 0 && (
              <button
                type="button"
                data-testid="script-ai-fix-errors"
                title="Resubmit the check errors and ask for a fix"
                onClick={handleFixErrors}
                disabled={isStreaming || unavailable}
              >
                Fix {errorDiagnostics.length} error{errorDiagnostics.length === 1 ? '' : 's'}
              </button>
            )}
            {isStreaming && (
              <button
                type="button"
                data-testid="script-ai-stop"
                onClick={() => store.stopStreaming()}
              >
                Stop
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
