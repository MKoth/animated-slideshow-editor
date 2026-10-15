import { useState } from 'react'
import {
  emptyAskDraft,
  formatAskAnswers,
  isAskDraftEmpty,
  type AskAnswerDraft,
  type AskBlock,
} from '../../ai/askBlock'

interface AiAskGroupProps {
  readonly blocks: readonly AskBlock[]
  readonly messageId: string
  readonly disabled?: boolean
  readonly onAnswer: (text: string) => void
}

/**
 * Grouped answering for every ```ask block under one assistant message.
 * Single → radios, multi → checkboxes, text → textarea; allowCustom adds a
 * custom option plus text input. One shared Answer button appends a single
 * user message (one `Q (<id>): ...` line per question, in block order) via
 * the normal send path — history stays append-only. The button stays
 * disabled until every question has an answer.
 */
export function AiAskGroup({ blocks, messageId, disabled, onAnswer }: AiAskGroupProps) {
  const [drafts, setDrafts] = useState<AskAnswerDraft[]>(() => blocks.map(emptyAskDraft))

  const patch = (index: number, next: Partial<AskAnswerDraft>) => {
    setDrafts((prev) => prev.map((draft, i) => (i === index ? { ...draft, ...next } : draft)))
  }

  const toggleMulti = (index: number, id: string) => {
    const current = drafts[index]?.selected ?? []
    patch(index, {
      selected: current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    })
  }

  const allAnswered = blocks.every((block, index) => !isAskDraftEmpty(block, drafts[index]!))
  const submitDisabled = disabled || !allAnswered

  const handleAnswer = () => {
    if (!allAnswered) return
    const text = formatAskAnswers(blocks, drafts)
    if (!text.trim()) return
    onAnswer(text)
  }

  const answerLabel = blocks.length > 1 ? `Answer all (${blocks.length})` : 'Answer'

  return (
    <div className="ai-ask-group" data-testid={`ai-ask-${messageId}-group`}>
      {blocks.map((block, index) => {
        const draft = drafts[index]!
        const base = `ai-ask-${messageId}-${block.id}`
        const kindLabel =
          block.kind === 'single' ? 'Single choice' : block.kind === 'multi' ? 'Multiple' : 'Text'
        return (
          <div key={`${block.id}-${index}`} className="ai-ask" data-testid={base}>
            <div className="ai-ask__header">
              <div className="ai-ask__question">{block.question}</div>
              <span className="ai-ask__kind">{kindLabel}</span>
            </div>
            {block.kind === 'single' && (
              <div className="ai-ask__options" role="radiogroup" aria-label={block.question}>
                {block.options.map((option) => {
                  const checked = !draft.customSelected && draft.selected[0] === option.id
                  return (
                    <label
                      key={option.id}
                      className={`ai-ask__option${checked ? ' is-selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name={base}
                        className="ai-ask__check"
                        data-testid={`${base}-option-${option.id}`}
                        checked={checked}
                        disabled={disabled}
                        onChange={() =>
                          patch(index, { customSelected: false, selected: [option.id] })
                        }
                      />
                      <span className="ai-ask__option-body">
                        <span className="ai-ask__label">{option.label}</span>
                        {option.detail && <span className="ai-ask__detail">{option.detail}</span>}
                      </span>
                    </label>
                  )
                })}
                {block.allowCustom && (
                  <label
                    className={`ai-ask__option ai-ask__option--custom${draft.customSelected ? ' is-selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name={base}
                      className="ai-ask__check"
                      data-testid={`${base}-option-custom`}
                      checked={draft.customSelected}
                      disabled={disabled}
                      onChange={() => patch(index, { customSelected: true, selected: [] })}
                    />
                    <span className="ai-ask__option-body">
                      <span className="ai-ask__label">Custom</span>
                      <input
                        type="text"
                        className="ai-ask__custom-input"
                        data-testid={`${base}-custom`}
                        value={draft.customText}
                        disabled={disabled}
                        placeholder="Type your own answer"
                        onChange={(e) =>
                          patch(index, {
                            customText: e.target.value,
                            customSelected: true,
                            selected: [],
                          })
                        }
                      />
                    </span>
                  </label>
                )}
              </div>
            )}
            {block.kind === 'multi' && (
              <div className="ai-ask__options">
                {block.options.map((option) => {
                  const checked = draft.selected.includes(option.id)
                  return (
                    <label
                      key={option.id}
                      className={`ai-ask__option${checked ? ' is-selected' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="ai-ask__check"
                        data-testid={`${base}-option-${option.id}`}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleMulti(index, option.id)}
                      />
                      <span className="ai-ask__option-body">
                        <span className="ai-ask__label">{option.label}</span>
                        {option.detail && <span className="ai-ask__detail">{option.detail}</span>}
                      </span>
                    </label>
                  )
                })}
                {block.allowCustom && (
                  <label
                    className={`ai-ask__option ai-ask__option--custom${draft.customSelected ? ' is-selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="ai-ask__check"
                      data-testid={`${base}-option-custom`}
                      checked={draft.customSelected}
                      disabled={disabled}
                      onChange={(e) => patch(index, { customSelected: e.target.checked })}
                    />
                    <span className="ai-ask__option-body">
                      <span className="ai-ask__label">Custom</span>
                      <input
                        type="text"
                        className="ai-ask__custom-input"
                        data-testid={`${base}-custom`}
                        value={draft.customText}
                        disabled={disabled}
                        placeholder="Type your own answer"
                        onChange={(e) =>
                          patch(index, {
                            customText: e.target.value,
                            ...(e.target.value.trim() ? { customSelected: true } : {}),
                          })
                        }
                      />
                    </span>
                  </label>
                )}
              </div>
            )}
            {block.kind === 'text' && (
              <textarea
                className="ai-ask__text"
                data-testid={`${base}-text`}
                value={draft.freeText}
                disabled={disabled}
                placeholder="Type your answer"
                onChange={(e) => patch(index, { freeText: e.target.value })}
              />
            )}
          </div>
        )
      })}
      <div className="ai-ask-group__footer">
        <button
          className="ai-ask__answer"
          data-testid={`ai-ask-${messageId}-answer`}
          disabled={submitDisabled}
          onClick={handleAnswer}
        >
          {answerLabel}
        </button>
      </div>
    </div>
  )
}
