/* eslint-disable react-hooks/set-state-in-effect -- sync picker state when modal opens */
import { useEffect, useState } from 'react'
import type { EnginePublic } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { SetKeyframeValueCommand } from '../../engine/commands'
import type { SymmetryKeyframeValue, SymmetryAxis } from '../../engine/symmetry'

interface SymmetryPickerModalProps {
  open: boolean
  nodeId: string
  keyframeId: string
  value: SymmetryKeyframeValue
  engine: EnginePublic
  dispatch: DispatchCommand
  notify: (msg: string) => void
  onClose: () => void
}

export function SymmetryPickerModal({
  open,
  nodeId,
  keyframeId,
  value,
  dispatch,
  notify,
  onClose,
}: SymmetryPickerModalProps) {
  const [axis, setAxis] = useState<SymmetryAxis>(value.axis)
  const [factor, setFactor] = useState<number>(value.factor)

  useEffect(() => {
    if (open) {
      setAxis(value.axis)
      setFactor(value.factor)
    }
  }, [open, value])

  const handleSave = () => {
    const newValue: SymmetryKeyframeValue = { axis, factor: Math.max(0, Math.min(1, factor)) }
    const result = dispatch(
      new SetKeyframeValueCommand({
        target: { kind: 'symmetry', nodeId },
        keyframeId,
        newValue: newValue as unknown as import('../../engine/keyframe').KeyframeValue,
      }),
    )
    if (!result.ok) notify(result.error.message)
    else onClose()
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Edit Symmetry"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          borderRadius: 8,
          width: 420,
          maxWidth: '90vw',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: '1px solid var(--color-border)',
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14 }}>Edit Symmetry</h3>
          <button onClick={onClose} style={{ fontSize: 12, padding: '4px 8px' }}>
            ✕
          </button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            Axis
            <select
              value={axis}
              onChange={(e) => setAxis(e.target.value as SymmetryAxis)}
              style={{
                padding: '6px 8px',
                borderRadius: 4,
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
              }}
            >
              <option value="x">X (mirror left↔right)</option>
              <option value="y">Y (mirror top↔bottom)</option>
            </select>
          </label>
          <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            Factor (0 … 1)
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={factor}
              onChange={(e) => setFactor(parseFloat(e.target.value))}
            />
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={factor}
              onChange={(e) => setFactor(parseFloat(e.target.value) || 0)}
              style={{
                padding: '6px 8px',
                borderRadius: 4,
                border: '1px solid var(--color-border)',
                width: 120,
              }}
            />
          </label>
          <div style={{ fontSize: 11, opacity: 0.6 }}>
            Axis: {axis} @ {factor.toFixed(2)}
          </div>
        </div>
        <div
          style={{
            padding: 12,
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button onClick={onClose} style={{ fontSize: 12, padding: '6px 12px' }}>
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              fontSize: 12,
              padding: '6px 12px',
              background: '#1a73e8',
              color: '#fff',
              border: '1px solid #1a73e8',
              borderRadius: 4,
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
