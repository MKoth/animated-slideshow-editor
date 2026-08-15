import { useRef } from 'react'
import type { ReactNode } from 'react'
import { formatDecimal, roundToStep } from '../../app/inspectorActions'
import type { PropertyState } from '../../app/keyframeActions'
import { DRAG_THRESHOLD_PX, MIXED_MARKER, useEditBuffer } from './useEditBuffer'

interface NumericFieldProps {
  label: string
  value: number | null
  step: number
  disabled?: boolean
  state?: PropertyState | null
  after?: ReactNode
  onCommit: (raw: string) => void
  onAdjust: (value: number) => void
}

export function NumericField({
  label,
  value,
  step,
  disabled = false,
  state = null,
  after,
  onCommit,
  onAdjust,
}: NumericFieldProps) {
  const display = value === null ? MIXED_MARKER : formatDecimal(value)
  const buffer = useEditBuffer(display)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ startX: number; startValue: number; dragging: boolean } | null>(null)

  const commit = () => {
    onCommit(buffer.commit())
  }

  const handlePointerMove = (event: PointerEvent) => {
    const drag = dragRef.current
    if (!drag) {
      return
    }
    const delta = event.clientX - drag.startX
    if (!drag.dragging && Math.abs(delta) < DRAG_THRESHOLD_PX) {
      return
    }
    drag.dragging = true
    event.preventDefault()
    const next = roundToStep(drag.startValue + delta * step, step)
    buffer.setText(formatDecimal(next))
    onAdjust(next)
  }

  const handlePointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    if (!drag || drag.dragging) {
      return
    }
    const input = inputRef.current
    if (input) {
      input.focus()
      input.select()
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLInputElement>) => {
    if (value === null || disabled) {
      return
    }
    dragRef.current = { startX: event.clientX, startValue: value, dragging: false }
    event.preventDefault()
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  return (
    <div className="inspector-field">
      <label className="inspector-field__label" htmlFor={label}>
        {label}
      </label>
      {state && state !== 'static' && (
        <span
          className="inspector-field__indicator"
          data-state={state}
          title={state === 'animated' ? 'Animated' : 'Playhead on keyframe'}
        >
          {state === 'animated' ? '●' : '◆'}
        </span>
      )}
      <input
        id={label}
        ref={inputRef}
        className="inspector-field__input"
        type={buffer.editing || value !== null ? 'number' : 'text'}
        aria-label={label}
        disabled={disabled}
        value={buffer.text}
        onChange={(event) => {
          buffer.begin()
          buffer.setText(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
          } else if (event.key === 'Escape') {
            buffer.cancel()
          }
        }}
        onBlur={() => {
          if (buffer.editing) {
            commit()
          }
        }}
        onPointerDown={handlePointerDown}
      />
      {after}
    </div>
  )
}

export function NameField({
  value,
  onCommit,
  disabled = false,
  label = 'Name',
}: {
  value: string | null
  onCommit: (raw: string) => void
  disabled?: boolean
  label?: string
}) {
  const display = value === null ? MIXED_MARKER : value
  const buffer = useEditBuffer(display)

  const commit = () => {
    onCommit(buffer.commit())
  }

  return (
    <div className="inspector-field">
      <label className="inspector-field__label" htmlFor={label}>
        {label}
      </label>
      <input
        id={label}
        className="inspector-field__input"
        type="text"
        aria-label={label}
        disabled={disabled}
        value={buffer.text}
        onChange={(event) => {
          buffer.begin()
          buffer.setText(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit()
          } else if (event.key === 'Escape') {
            buffer.cancel()
          }
        }}
        onBlur={() => {
          if (buffer.editing) {
            commit()
          }
        }}
      />
    </div>
  )
}
