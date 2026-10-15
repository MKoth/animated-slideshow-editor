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

  return (
    <div className="ai-ask" data-testid={base}>
      <div className="ai-ask__question">{block.question}</div>
      {block.kind === 'single' && (
        <div role="radiogroup" aria-label={block.question}>
          {block.options.map((option) => (
            <label key={option.id}>
              <input
                type="radio"
                name={base}
                data-testid={`${base}-option-${option.id}`}
                checked={!customSelected && selected[0] === option.id}
                disabled={disabled}
                onChange={() => {
                  setCustomSelected(false)
                  setSelected([option.id])
                }}
              />
              {option.label}
              {option.detail && <span className="ai-ask__detail"> — {option.detail}</span>}
            </label>
          ))}
          {block.allowCustom && (
            <label>
              <input
                type="radio"
                name={base}
                data-testid={`${base}-option-custom`}
                checked={customSelected}
                disabled={disabled}
                onChange={() => {
                  setCustomSelected(true)
                  setSelected([])
                }}
              />
              Custom
              <input
                type="text"
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
            </label>
          )}
        </div>
      )}
      {block.kind === 'multi' && (
        <div>
          {block.options.map((option) => (
            <label key={option.id}>
              <input
                type="checkbox"
                data-testid={`${base}-option-${option.id}`}
                checked={selected.includes(option.id)}
                disabled={disabled}
                onChange={() => toggleMulti(option.id)}
              />
              {option.label}
              {option.detail && <span className="ai-ask__detail"> — {option.detail}</span>}
            </label>
          ))}
          {block.allowCustom && (
            <label>
              <input
                type="checkbox"
                data-testid={`${base}-option-custom`}
                checked={customSelected}
                disabled={disabled}
                onChange={(e) => setCustomSelected(e.target.checked)}
              />
              Custom
              <input
                type="text"
                data-testid={`${base}-custom`}
                value={customText}
                disabled={disabled}
                placeholder="Type your own answer"
                onChange={(e) => {
                  setCustomText(e.target.value)
                  if (e.target.value.trim()) setCustomSelected(true)
                }}
              />
            </label>
          )}
        </div>
      )}
      {block.kind === 'text' && (
        <textarea
          data-testid={`${base}-text`}
          value={freeText}
          disabled={disabled}
          placeholder="Type your answer"
          onChange={(e) => setFreeText(e.target.value)}
        />
      )}
      <button data-testid={`${base}-answer`} disabled={submitDisabled} onClick={handleAnswer}>
        Answer
      </button>
    </div>
  )
}
