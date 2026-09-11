import { useEffect } from 'react'
import type { ExtractableKeyframe } from '../../engine/clipExtraction'

interface Props {
  readonly open: boolean
  readonly keyframes: readonly ExtractableKeyframe[]
  readonly clipName: string
  readonly onConfirmDelete: () => void
  readonly onKeep: () => void
}

function groupSummary(keyframes: readonly ExtractableKeyframe[]): string[] {
  const map = new Map<string, number>()
  for (const kf of keyframes) {
    let label: string
    const t = kf.target
    if (t.kind === 'node' && 'property' in t) label = t.property
    else if (t.kind === 'node' && 'parameter' in t) label = `material:${t.parameter}`
    else if (t.kind === 'visible') label = 'visible'
    else if (t.kind === 'morph') label = 'morph'
    else if (t.kind === 'circle') label = `circle:${t.property}`
    else if (t.kind === 'shadow') label = `shadow:${t.property}`
    else if (t.kind === 'dataLabel') label = `dataLabel:${t.label}`
    else if (t.kind === 'table') label = `table:${t.property}`
    else if (t.kind === 'symmetry') label = 'symmetry'
    else if (t.kind === 'zIndex') label = 'zIndex'
    else label = t.kind
    const key = `${(t as { nodeId?: string }).nodeId ?? (t as { clipId?: string }).clipId ?? 'unknown'}:${label}`
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()].map(([key, count]) => {
    const [nodeId, prop] = key.split(':')
    void nodeId
    return `${prop} ×${count}`
  })
}

export function DeleteOrphansConfirmModal({
  open,
  keyframes,
  clipName,
  onConfirmDelete,
  onKeep,
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onKeep()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onKeep])
  if (!open) return null
  const count = keyframes.length
  const summary = groupSummary(keyframes)
  const hasMultipleNodes = new Set(keyframes.map((k) => (k.target as { nodeId?: string }).nodeId)).size > 1
  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Delete source keyframes?"
      data-testid="delete-orphans-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
      }}
      onClick={onKeep}
    >
      <div
        className="modal"
        style={{
          background: 'var(--color-bg, #fff)',
          borderRadius: 8,
          padding: 16,
          minWidth: 380,
          maxWidth: 520,
          border: '1px solid var(--color-border, #ddd)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }} data-testid="delete-orphans-title">
          Delete source keyframes?
        </h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: '0 0 8px' }}>
          {count} keyframe(s) were copied to clip <strong>{clipName}</strong>.
          {hasMultipleNodes ? ' (multiple nodes) ' : ' '}
          Delete the source keyframes? They currently block Clip Collection creation and will remain
          as orphans if kept. This is undoable.
        </p>
        {summary.length > 0 && (
          <ul
            style={{
              fontSize: 11,
              color: 'var(--color-text-muted, #666)',
              margin: '0 0 12px 16px',
              listStyle: 'disc',
            }}
            data-testid="delete-orphans-summary"
          >
            {summary.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onKeep}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid var(--color-border, #ddd)',
              background: 'var(--color-bg, #fff)',
              cursor: 'pointer',
            }}
            data-testid="delete-orphans-keep"
            autoFocus={false}
          >
            Keep
          </button>
          <button
            onClick={onConfirmDelete}
            autoFocus
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid transparent',
              background: '#c00',
              color: '#fff',
              cursor: 'pointer',
            }}
            data-testid="delete-orphans-confirm"
          >
            Delete {count} source {count === 1 ? 'keyframe' : 'keyframes'}
          </button>
        </div>
      </div>
    </div>
  )
}
