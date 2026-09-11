/* eslint-disable react-hooks/set-state-in-effect -- sync picker state when modal opens */
import { useEffect, useState } from 'react'
import { usePasteDeltaStore } from '../../stores/pasteDeltaStore'

export function PasteDeltaModal() {
  const pending = usePasteDeltaStore((s) => s.pending)
  const resolve = usePasteDeltaStore((s) => s.resolve)
  const cancel = usePasteDeltaStore((s) => s.cancel)

  const [choices, setChoices] = useState<boolean[]>([])

  useEffect(() => {
    if (pending) {
      // default: all unchecked (absolute) — relative opt-in per track
      setChoices(pending.items.map(() => false))
    } else {
      setChoices([])
    }
  }, [pending])

  if (!pending) return null

  const items = pending.items

  const allNumericCount = items.filter((it) => it.isNumeric).length

  const handleToggle = (idx: number, checked: boolean) => {
    setChoices((prev) => {
      const next = [...prev]
      next[idx] = checked
      return next
    })
  }

  const handleSelectAll = () => {
    setChoices(items.map((it) => it.isNumeric))
  }
  const handleSelectNone = () => {
    setChoices(items.map(() => false))
  }

  const handleConfirm = () => {
    resolve(choices)
  }

  const handleCancel = () => {
    cancel()
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleCancel()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Paste keyframes options"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 1100,
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          background: 'var(--color-bg)',
          color: 'var(--color-text)',
          borderRadius: 8,
          width: 560,
          maxWidth: '90vw',
          maxHeight: '80vh',
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
          <h3 style={{ margin: 0, fontSize: 14 }}>Paste Keyframes — Absolute vs Relative</h3>
          <button
            onClick={handleCancel}
            style={{ fontSize: 12, padding: '4px 8px' }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div style={{ padding: '12px 16px', fontSize: 12, opacity: 0.85, lineHeight: 1.5 }}>
          You are pasting numeric keyframes from one object onto another with different base values.
          <br />
          <strong>Absolute</strong> keeps the copied values as-is.{' '}
          <strong>Relative (include delta)</strong> preserves motion relative to the target&apos;s
          current value (additive; scale uses × ratio). Opacity is clamped 0…1, rotation normalized
          to −π…π.
        </div>

        <div
          style={{
            padding: '0 16px',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            fontSize: 12,
          }}
        >
          <button
            onClick={handleSelectAll}
            style={{ fontSize: 11, padding: '4px 8px' }}
            disabled={allNumericCount === 0}
          >
            Select all relative
          </button>
          <button onClick={handleSelectNone} style={{ fontSize: 11, padding: '4px 8px' }}>
            Select none (absolute)
          </button>
          <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.6 }}>
            {items.length} track{items.length !== 1 ? 's' : ''} — {allNumericCount} numeric
          </span>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minHeight: 120,
          }}
        >
          {items.map((it, idx) => {
            const isChecked = choices[idx] ?? false
            const isDisabled = !it.isNumeric
            const deltaText =
              it.isNumeric && it.delta !== null
                ? it.ratio !== null
                  ? `Δ ${it.delta >= 0 ? '+' : ''}${it.delta.toFixed(2)} · ×${it.ratio.toFixed(3)} (source ${it.sourceValue?.toFixed(2)} → target ${it.targetValue?.toFixed(2)})`
                  : `Δ ${it.delta >= 0 ? '+' : ''}${it.delta.toFixed(2)} (source ${it.sourceValue?.toFixed(2)} → target ${it.targetValue?.toFixed(2)})`
                : ''
            return (
              <label
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  padding: '8px 10px',
                  background: isChecked
                    ? 'color-mix(in srgb, #1a73e8 8%, var(--color-bg))'
                    : 'transparent',
                  opacity: isDisabled ? 0.6 : 1,
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={isDisabled}
                  onChange={(e) => handleToggle(idx, e.target.checked)}
                  style={{ marginTop: 2 }}
                  data-testid={`paste-delta-checkbox-${idx}`}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span>{it.trackLabel}</span>
                    <span style={{ fontWeight: 400, opacity: 0.6, fontSize: 11 }}>
                      {it.sourceNodeId.slice(0, 6)} → {it.targetNodeId.slice(0, 6)}
                    </span>
                    {!it.isNumeric && (
                      <span
                        style={{
                          fontSize: 10,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: 'var(--color-border)',
                        }}
                      >
                        Always absolute
                      </span>
                    )}
                  </div>
                  {it.isNumeric ? (
                    <div
                      style={{ fontSize: 11, opacity: 0.75, marginTop: 2, wordBreak: 'break-word' }}
                    >
                      {deltaText}
                      {it.trackLabel === 'opacity' && ' · clamped 0…1'}
                      {it.trackLabel === 'rotation' && ' · normalized −π…π'}
                      {it.ratio === null &&
                        (it.trackLabel === 'scaleX' || it.trackLabel === 'scaleY') &&
                        it.sourceValue === 0 &&
                        ' · source 0 → additive fallback'}
                    </div>
                  ) : (
                    <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                      {it.disabledReason}
                    </div>
                  )}
                  <div style={{ fontSize: 11, marginTop: 2 }}>
                    {isDisabled ? (
                      <span style={{ opacity: 0.6 }}>Absolute only</span>
                    ) : isChecked ? (
                      <span style={{ color: '#1a73e8' }}>Relative — will apply delta</span>
                    ) : (
                      <span style={{ opacity: 0.6 }}>
                        Absolute — will paste copied values as-is
                      </span>
                    )}
                  </div>
                </div>
              </label>
            )
          })}
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
          <button onClick={handleCancel} style={{ fontSize: 12, padding: '6px 12px' }}>
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            style={{
              fontSize: 12,
              padding: '6px 12px',
              background: '#1a73e8',
              color: '#fff',
              border: '1px solid #1a73e8',
              borderRadius: 4,
            }}
            data-testid="paste-delta-confirm"
          >
            Paste
          </button>
        </div>
      </div>
    </div>
  )
}
