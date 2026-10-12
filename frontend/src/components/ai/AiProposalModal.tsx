import { useState } from 'react'
import type { AiCommandJson } from '../../ai/proposals'
import { useEngine } from '../../app/useEngine'
import { useAiStore } from '../../stores/aiStore'
import { useFingerprint } from '../../ai/proposalFingerprint'
import { AiProposalDetail } from './AiProposalView'

export type ProposalModalState =
  { mode: 'review'; proposalId: string } | { mode: 'create'; messageId: string }

interface AiProposalModalProps {
  projectId: string
  conversationId: string | null
  modal: ProposalModalState
  onClose: () => void
  onCreated?: (proposalId: string) => void
}

/**
 * In-conversation proposal review: opens from a chat message card instead of
 * the bottom section. Review reuses AiProposalDetail (commands + dry-run
 * validation + approve/execute); create attaches the new proposal to the
 * originating message so it renders inline under it.
 */
export function AiProposalModal({
  projectId,
  conversationId,
  modal,
  onClose,
  onCreated,
}: AiProposalModalProps) {
  const { engine } = useEngine()
  const fingerprint = useFingerprint(engine)
  const proposalById = useAiStore((s) => s.proposalById)
  const proposal = modal.mode === 'review' ? (proposalById[modal.proposalId] ?? null) : null

  return (
    <div
      className="modal-overlay"
      data-testid="ai-proposal-modal"
      role="dialog"
      aria-modal="true"
      aria-label={modal.mode === 'review' ? 'Review proposal' : 'Propose edit'}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="ai-proposal-modal__body"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
        }}
        style={{
          background: 'var(--panel-bg, #fff)',
          maxWidth: 640,
          width: 'calc(100% - 48px)',
          maxHeight: 'calc(100% - 48px)',
          overflow: 'auto',
          padding: 16,
        }}
      >
        <button data-testid="ai-proposal-modal-close" onClick={onClose}>
          Close
        </button>
        {modal.mode === 'review' ? (
          proposal ? (
            <AiProposalDetail
              key={`${proposal.id}-${proposal.modified}`}
              proposal={proposal}
              fingerprint={fingerprint}
            />
          ) : (
            <div data-testid="ai-proposal-modal-missing">
              Proposal no longer available — it may have been deleted.
            </div>
          )
        ) : (
          <AiProposalCreateForm
            projectId={projectId}
            conversationId={conversationId}
            messageId={modal.messageId}
            fingerprint={fingerprint}
            onCreated={onCreated}
          />
        )}
      </div>
    </div>
  )
}

function AiProposalCreateForm({
  projectId,
  conversationId,
  messageId,
  fingerprint,
  onCreated,
}: {
  projectId: string
  conversationId: string | null
  messageId: string
  fingerprint: string
  onCreated?: (proposalId: string) => void
}) {
  const proposalBusy = useAiStore((s) => s.proposalBusy)
  const proposalError = useAiStore((s) => s.proposalError)
  const store = useAiStore.getState()
  const [titleDraft, setTitleDraft] = useState('')
  const [commandsDraft, setCommandsDraft] = useState('[]')
  const [createError, setCreateError] = useState<string | null>(null)

  const handleCreate = () => {
    setCreateError(null)
    if (!conversationId) {
      setCreateError('Select a conversation first.')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(commandsDraft)
    } catch {
      setCreateError('Commands must be a JSON array.')
      return
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      setCreateError('Commands must be a non-empty JSON array.')
      return
    }
    void store
      .createProposal({
        projectId,
        conversationId,
        messageId,
        title: titleDraft.trim() || 'Untitled proposal',
        commands: parsed as AiCommandJson[],
        projectFingerprint: fingerprint,
      })
      .then((created) => {
        if (created) onCreated?.(created.id)
        else if (!useAiStore.getState().proposalError) setCreateError('Proposal creation failed.')
      })
  }

  return (
    <div data-testid="ai-proposal-modal-create">
      <h4>Propose edit</h4>
      <input
        data-testid="ai-proposal-modal-create-title"
        placeholder="Proposal title"
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
      />
      <textarea
        data-testid="ai-proposal-modal-create-commands"
        aria-label="Proposal commands JSON"
        placeholder='[{"type":"CreateSlide","name":"Middle 1"}]'
        value={commandsDraft}
        onChange={(e) => setCommandsDraft(e.target.value)}
      />
      <button
        data-testid="ai-proposal-modal-create-submit"
        disabled={!conversationId || proposalBusy}
        onClick={handleCreate}
      >
        Propose edit
      </button>
      {createError && <span data-testid="ai-proposal-modal-error">{createError}</span>}
      {proposalError && (
        <div data-testid="ai-proposal-modal-error-server">{proposalError.message}</div>
      )}
    </div>
  )
}
