import { useEffect, useState } from 'react'
import type { ParentingMode } from '../../engine/commands/reparentNodeCommand'

interface ParentingModeDialogProps {
  open: boolean
  initialMode: ParentingMode
  initialRemember: boolean
  onConfirm: (mode: ParentingMode, remember: boolean) => void
  onCancel: () => void
}

export function ParentingModeDialog({
  open,
  initialMode,
  initialRemember,
  onConfirm,
  onCancel,
}: ParentingModeDialogProps) {
  const [mode, setMode] = useState<ParentingMode>(initialMode)
  const [remember, setRemember] = useState(initialRemember)

  // Sync state when dialog opens with new initial values
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional sync of dialog state on open
      setMode(initialMode)

      setRemember(initialRemember)
    }
  }, [open, initialMode, initialRemember])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="parenting-mode-dialog__overlay"
      role="dialog"
      aria-label="Parenting mode"
      aria-modal="true"
      onClick={onCancel}
    >
      <div className="parenting-mode-dialog" onClick={(e) => e.stopPropagation()} role="document">
        <h2 className="parenting-mode-dialog__title">Choose parenting mode</h2>
        <p className="parenting-mode-dialog__description">
          How should the child be positioned under its new parent?
        </p>
        <fieldset className="parenting-mode-dialog__options">
          <legend className="sr-only">Parenting mode</legend>
          <label className="parenting-mode-dialog__option">
            <input
              type="radio"
              name="parentingMode"
              value="keepWorld"
              checked={mode === 'keepWorld'}
              onChange={() => setMode('keepWorld')}
            />
            <span>
              <strong>Keep World Transform</strong> — recompute local so world position stays
              (default)
            </span>
          </label>
          <label className="parenting-mode-dialog__option">
            <input
              type="radio"
              name="parentingMode"
              value="snapToTail"
              checked={mode === 'snapToTail'}
              onChange={() => setMode('snapToTail')}
            />
            <span>
              <strong>Snap to Parent Tail</strong> — reset child local to 0 at parent tail
            </span>
          </label>
        </fieldset>
        <label className="parenting-mode-dialog__remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          <span>Remember my choice</span>
        </label>
        <div className="parenting-mode-dialog__actions">
          <button className="parenting-mode-dialog__button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="parenting-mode-dialog__button parenting-mode-dialog__button--primary"
            onClick={() => onConfirm(mode, remember)}
            type="button"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
