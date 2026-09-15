/* eslint-disable react-hooks/set-state-in-effect -- sync picker state when modal opens */
import { useEffect, useState } from 'react'
import type { EnginePublic } from '../../engine'
import type { Command, DispatchCommand } from '../../engine/commands'
import {
  SetKeyframeValueCommand,
  SetControlBlendCommand,
  TransactionCommand,
} from '../../engine/commands'

interface ControlValuePickerModalProps {
  open: boolean
  nodeId: string
  controlKey: string
  keyframeId: string
  value: number
  /** Per-gap blend factors (length N-1 for N timelines). Missing = 0s. */
  blend?: readonly number[]
  engine: EnginePublic
  dispatch: DispatchCommand
  notify: (msg: string) => void
  onClose: () => void
}

export function ControlValuePickerModal({
  open,
  nodeId,
  controlKey,
  keyframeId,
  value,
  blend = [],
  engine,
  dispatch,
  notify,
  onClose,
}: ControlValuePickerModalProps) {
  const control = (() => {
    try {
      const node = engine.getNode(nodeId)
      return node.controlSet?.controls.find((c) => c.key === controlKey) ?? null
    } catch {
      return null
    }
  })()

  const blendCount = Math.max(0, (control?.groups.length ?? 1) - 1)
  const groupNames: readonly string[] = control?.groups.map((g) => g.name) ?? []
  const normalizeBlend = (src: readonly number[]): number[] => {
    const out = new Array<number>(blendCount).fill(0)
    for (let i = 0; i < out.length && i < src.length; i++) {
      const v = Number(src[i])
      out[i] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0
    }
    return out
  }
  const initialBlend = normalizeBlend(blend)

  const [draft, setDraft] = useState<number>(value)
  const [blendDrafts, setBlendDrafts] = useState<number[]>(initialBlend)

  useEffect(() => {
    if (open) {
      setDraft(value)
      setBlendDrafts(normalizeBlend(blend))
    }
    // blend is a fresh array each render from TimelineBody — compare by content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value, controlKey, keyframeId, blendCount, JSON.stringify(blend)])

  const handleSave = () => {
    const clamped = Math.max(0, Math.min(1, Number(draft)))
    if (!Number.isFinite(clamped)) {
      notify('Value must be a number in [0, 1]')
      return
    }
    for (let i = 0; i < blendDrafts.length; i++) {
      const b = blendDrafts[i]!
      if (!Number.isFinite(b) || b < 0 || b > 1) {
        notify(`Blend ${i + 1} must be a number in [0, 1]`)
        return
      }
    }
    const commands: Command<unknown>[] = []
    if (Math.abs(clamped - value) > 1e-9) {
      commands.push(
        new SetKeyframeValueCommand({
          target: { kind: 'control', nodeId, controlKey },
          keyframeId,
          newValue: clamped,
        }),
      )
    }
    for (let i = 0; i < blendCount; i++) {
      const prev = initialBlend[i] ?? 0
      const next = blendDrafts[i] ?? 0
      if (Math.abs(next - prev) > 1e-9) {
        commands.push(
          new SetControlBlendCommand({
            hostNodeId: nodeId,
            controlKey,
            keyframeId,
            blendIndex: i,
            value: next,
          }),
        )
      }
    }
    if (commands.length === 0) {
      onClose()
      return
    }
    const result =
      commands.length === 1 ? dispatch(commands[0]!) : dispatch(new TransactionCommand(commands))
    if (!result.ok) notify(result.error.message)
    else onClose()
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${control?.label ?? controlKey} value`}
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
          background: 'var(--color-bg, #fff)',
          color: 'var(--color-text, #000)',
          borderRadius: 8,
          width: 420,
          maxWidth: '90vw',
          border: '1px solid var(--color-border, #ddd)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-border, #ddd)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h3 style={{ margin: 0, fontSize: 14 }}>
            Edit Control — {control?.label ?? controlKey} ({controlKey})
          </h3>
          <button onClick={onClose} style={{ fontSize: 12, padding: '4px 8px' }}>
            ✕
          </button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
            Value drives the bound clip at <code>t = value</code> in [0, 1]. Same slider as
            Animation Manager → Controls.
          </div>
          <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontWeight: 600 }}>
              {control?.label ?? controlKey} — {draft.toFixed(2)}
            </span>
            <input
              aria-label={`${control?.label ?? controlKey} value`}
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={draft}
              onChange={(e) => setDraft(Number(e.target.value))}
              style={{ width: '100%' }}
              data-testid="control-value-slider"
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={draft}
                onChange={(e) => setDraft(Number(e.target.value))}
                style={{
                  padding: '6px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border, #ddd)',
                  width: 100,
                }}
                data-testid="control-value-input"
              />
              <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                0 = closed, 1 = open
              </span>
            </div>
          </label>
          {blendCount > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                Blend mixes timelines at this keyframe: 0 = Timeline i only, 1 = Timeline i+1. Same
                values as Animation Manager → Timelines.
              </div>
              {Array.from({ length: blendCount }, (_, i) => {
                const fromName = groupNames[i] ?? `T${i + 1}`
                const toName = groupNames[i + 1] ?? `T${i + 2}`
                const draftBlend = blendDrafts[i] ?? 0
                return (
                  <label
                    key={i}
                    style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 8 }}
                  >
                    <span style={{ fontWeight: 600 }}>
                      Blend T{i + 1}→T{i + 2} ({fromName} → {toName}) —{' '}
                      {Number.isFinite(draftBlend) ? draftBlend.toFixed(2) : '—'}
                    </span>
                    <input
                      aria-label={`Blend T${i + 1} to T${i + 2}`}
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={Number.isFinite(draftBlend) ? draftBlend : 0}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        setBlendDrafts((prev) => {
                          const next = [...prev]
                          while (next.length < blendCount) next.push(0)
                          next[i] = v
                          return next
                        })
                      }}
                      style={{ width: '100%' }}
                      data-testid={`control-blend-slider-${i}`}
                    />
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.01}
                        value={Number.isFinite(draftBlend) ? draftBlend : 0}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          setBlendDrafts((prev) => {
                            const next = [...prev]
                            while (next.length < blendCount) next.push(0)
                            next[i] = v
                            return next
                          })
                        }}
                        style={{
                          padding: '6px 8px',
                          borderRadius: 4,
                          border: '1px solid var(--color-border, #ddd)',
                          width: 100,
                        }}
                        data-testid={`control-blend-input-${i}`}
                      />
                      <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                        0 = {fromName}, 1 = {toName}
                      </span>
                    </div>
                  </label>
                )
              })}
            </div>
          )}
        </div>
        <div
          style={{
            padding: 12,
            borderTop: '1px solid var(--color-border, #ddd)',
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
            data-testid="control-value-save"
            style={{
              fontSize: 12,
              padding: '6px 12px',
              background: '#7c5cff',
              color: '#fff',
              border: '1px solid #7c5cff',
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
