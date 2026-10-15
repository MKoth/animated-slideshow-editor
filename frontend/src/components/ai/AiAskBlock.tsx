import { useState } from 'react'
import { formatAskAnswer, isAskAnswerEmpty, type AskBlock } from '../../ai/askBlock'

interface AiAskBlockProps {
  readonly block: AskBlock
  readonly messageId: string
  readonly disabled?: boolean
  readonly onAnswer: (text: string) => void
}

/**
 * Interactive rendering of one ```ask block under its assistant message.
 * Single → radios, multi → checkboxes, text → textarea; allowCustom adds a
 * custom option plus text input. One Answer button appends a single user
 * message via the normal send path — history stays append-only.
 */
export function AiAskBlock({ block, messageId, disabled, onAnswer }: AiAskBlockProps) {
  const [selected, setSelected] = useState<string[]>([])
  const [customSelected, setCustomSelected] = useState(false)
  const [customText, setCustomText] = useState('')
  const [freeText, setFreeText] = useState('')

  const base = `ai-ask-${messageId}-${block.id}`
  const customInput = customSelected ? customText : ''
  const empty =
    block.kind === 'text'
      ? !freeText.trim()
      : block.kind === 'single' && customSelected
        ? !customText.trim()
        : isAskAnswerEmpty(selected, customInput)
  const submitDisabled = disabled || empty

  const toggleMulti = (id: string) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id],
    )
  }

  const handleAnswer = () => {
    if (block.kind === 'text') {
      const text = freeText.trim()
      if (!text) return
      onAnswer(formatAskAnswer(block, [], text))
      return
    }
    // Single-choice is exclusive: a selected Custom radio carries only the
    // custom text, never a stale option alongside it.
    const effectiveSelected = block.kind === 'single' && customSelected ? [] : selected
    if (isAskAnswerEmpty(effectiveSelected, customInput)) return
    onAnswer(formatAskAnswer(block, effectiveSelected, customInput))
  }

  const kindLabel =
    block.kind === 'single' ? 'Single choice' : block.kind === 'multi' ? 'Multiple' : 'Text'

  return (
    <div className="ai-ask" data-testid={base}>
      <div className="ai-ask__header">
        <div className="ai-ask__question">{block.question}</div>
        <span className="ai-ask__kind">{kindLabel}</span>
      </div>
      {block.kind === 'single' && (
        <div className="ai-ask__options" role="radiogroup" aria-label={block.question}>
          {block.options.map((option) => {
            const checked = !customSelected && selected[0] === option.id
            return (
              <label key={option.id} className={`ai-ask__option${checked ? ' is-selected' : ''}`}>
                <input
                  type="radio"
                  name={base}
                  className="ai-ask__check"
                  data-testid={`${base}-option-${option.id}`}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => {
                    setCustomSelected(false)
                    setSelected([option.id])
                  }}
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
              className={`ai-ask__option ai-ask__option--custom${customSelected ? ' is-selected' : ''}`}
            >
              <input
                type="radio"
                name={base}
                className="ai-ask__check"
                data-testid={`${base}-option-custom`}
                checked={customSelected}
                disabled={disabled}
                onChange={() => {
                  setCustomSelected(true)
                  setSelected([])
                }}
              />
              <span className="ai-ask__option-body">
                <span className="ai-ask__label">Custom</span>
                <input
                  type="text"
                  className="ai-ask__custom-input"
                  data-testid={`${base}-custom`}
                  value={customText}
                  disabled={disabled}
                  placeholder="Type your own answer"
                  onChange={(e) => {
                    setCustomText(e.target.value)
                    setCustomSelected(true)
                    setSelected([])
                  }}
                />
              </span>
            </label>
          )}
        </div>
      )}
      {block.kind === 'multi' && (
        <div className="ai-ask__options">
          {block.options.map((option) => {
            const checked = selected.includes(option.id)
            return (
              <label key={option.id} className={`ai-ask__option${checked ? ' is-selected' : ''}`}>
                <input
                  type="checkbox"
                  className="ai-ask__check"
                  data-testid={`${base}-option-${option.id}`}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggleMulti(option.id)}
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
              className={`ai-ask__option ai-ask__option--custom${customSelected ? ' is-selected' : ''}`}
            >
              <input
                type="checkbox"
                className="ai-ask__check"
                data-testid={`${base}-option-custom`}
                checked={customSelected}
                disabled={disabled}
                onChange={(e) => setCustomSelected(e.target.checked)}
              />
              <span className="ai-ask__option-body">
                <span className="ai-ask__label">Custom</span>
                <input
                  type="text"
                  className="ai-ask__custom-input"
                  data-testid={`${base}-custom`}
                  value={customText}
                  disabled={disabled}
                  placeholder="Type your own answer"
                  onChange={(e) => {
                    setCustomText(e.target.value)
                    if (e.target.value.trim()) setCustomSelected(true)
                  }}
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
          value={freeText}
          disabled={disabled}
          placeholder="Type your answer"
          onChange={(e) => setFreeText(e.target.value)}
        />
      )}
      <div className="ai-ask__footer">
        <button
          className="ai-ask__answer"
          data-testid={`${base}-answer`}
          disabled={submitDisabled}
          onClick={handleAnswer}
        >
          Answer
        </button>
      </div>
    </div>
  )
}
