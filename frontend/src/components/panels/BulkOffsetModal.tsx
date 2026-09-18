import { useMemo, useState } from 'react'
import type { AnimationProperty } from '../../engine/animationProperties'
import { ANIMATABLE_PROPERTIES } from '../../engine/animationProperties'
import type { BulkOffsetMap, BulkOffsetPreview } from '../../app/clipBulkOffsetAction'

export interface BulkOffsetBindingRow {
  readonly collectionId: string
  readonly collectionName: string
  readonly semanticName: string
  readonly clipId: string
  readonly clipName: string
  /** Project-wide usage count of the bound clip (in-place edits affect all users). */
  readonly uses: number
}

export interface BulkOffsetConfirmSelection {
  readonly clipIds: string[]
  readonly offsets: BulkOffsetMap
}

interface Props {
  readonly parentName: string
  readonly rows: readonly BulkOffsetBindingRow[]
  readonly initialFilter?: string
  readonly getPreview: (clipIds: string[], offsets: BulkOffsetMap) => BulkOffsetPreview
  readonly onClose: () => void
  /**
   * Execute the offset (dispatched by the owner). Returns an error message to
   * display, or null on success (owner closes the modal itself).
   */
  readonly onConfirm: (selection: BulkOffsetConfirmSelection) => string | null
}

const CHANNEL_LABELS: Record<AnimationProperty, string> = {
  positionX: 'Position X',
  positionY: 'Position Y',
  rotation: 'Rotation',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  opacity: 'Opacity',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 4,
  padding: '4px 6px',
  borderRadius: 4,
  border: '1px solid var(--color-border, #ddd)',
  background: 'var(--color-bg, #fff)',
  color: 'var(--color-text, #1c1e21)',
  fontSize: 12,
  boxSizing: 'border-box',
}

function rowKey(row: BulkOffsetBindingRow): string {
  return `${row.collectionId}::${row.semanticName}`
}

export function BulkOffsetModal({
  parentName,
  rows,
  initialFilter,
  getPreview,
  onClose,
  onConfirm,
}: Props) {
  const [filter, setFilter] = useState(initialFilter ?? '')
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(rows.map((row) => [rowKey(row), true])),
  )
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries([...new Set(rows.map((row) => row.collectionId))].map((id) => [id, true])),
  )
  const [channels, setChannels] = useState<
    Record<AnimationProperty, { on: boolean; delta: string }>
  >(
    () =>
      Object.fromEntries(
        ANIMATABLE_PROPERTIES.map((property) => [property, { on: false, delta: '' }]),
      ) as Record<AnimationProperty, { on: boolean; delta: string }>,
  )
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((row) => row.semanticName.toLowerCase().includes(needle))
  }, [rows, filter])

  const grouped = useMemo(() => {
    const order: string[] = []
    const byCollection = new Map<string, { name: string; rows: BulkOffsetBindingRow[] }>()
    for (const row of filtered) {
      let group = byCollection.get(row.collectionId)
      if (!group) {
        group = { name: row.collectionName, rows: [] }
        byCollection.set(row.collectionId, group)
        order.push(row.collectionId)
      }
      group.rows.push(row)
    }
    return order.map((collectionId) => {
      const group = byCollection.get(collectionId)!
      return { collectionId, name: group.name, rows: group.rows }
    })
  }, [filtered])

  const parsedOffsets = useMemo((): { offsets: BulkOffsetMap; invalid: boolean } => {
    const offsets: BulkOffsetMap = {}
    let invalid = false
    for (const property of ANIMATABLE_PROPERTIES) {
      const entry = channels[property]
      if (!entry.on) continue
      const value = Number(entry.delta)
      if (entry.delta.trim() === '' || !Number.isFinite(value)) {
        invalid = true
        continue
      }
      offsets[property] = value
    }
    return { offsets, invalid }
  }, [channels])

  // Checked state is keyed by binding and independent of the filter: rows hidden
  // by the filter stay selected (and stay in preview/confirm) until unchecked.
  const selectedClipIds = useMemo(() => {
    const ids: string[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      if (!checked[rowKey(row)]) continue
      if (seen.has(row.clipId)) continue
      seen.add(row.clipId)
      ids.push(row.clipId)
    }
    return ids
  }, [rows, checked])

  const preview = useMemo(
    () => getPreview(selectedClipIds, parsedOffsets.offsets),
    [getPreview, selectedClipIds, parsedOffsets],
  )

  const sharedUses = useMemo(() => {
    let max = 0
    for (const row of rows) {
      if (checked[rowKey(row)]) max = Math.max(max, row.uses)
    }
    return max
  }, [rows, checked])

  const setAllFiltered = (value: boolean): void => {
    setChecked((prev) => {
      const next = { ...prev }
      for (const row of filtered) next[rowKey(row)] = value
      return next
    })
  }

  const handleConfirm = (): void => {
    if (selectedClipIds.length === 0) {
      setError('No bindings selected — check at least one semantic binding')
      return
    }
    const active = Object.entries(parsedOffsets.offsets).filter(([, v]) => v !== 0)
    if (parsedOffsets.invalid || active.length === 0) {
      setError('Enter a non-zero finite delta for at least one checked channel')
      return
    }
    const message = onConfirm({ clipIds: selectedClipIds, offsets: parsedOffsets.offsets })
    if (message) setError(message)
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bulk offset clip values"
      data-testid="bulk-offset-modal"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-bg, #fff)',
          borderRadius: 8,
          padding: 16,
          minWidth: 520,
          maxWidth: 680,
          maxHeight: '85vh',
          overflowY: 'auto',
          border: '1px solid var(--color-border, #ddd)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: 0, fontSize: 14 }}>Bulk offset clip values — {parentName}</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: 0 }}>
          Add a delta to every keyframe on the checked bindings (e.g. retarget a replaced part by
          +100 Y). Shared clips are edited in place — all nodes and slides using them change. One
          undo step. Param-linked channels are skipped.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ flex: 1, fontSize: 12 }}>
            Filter by semantic name
            <input
              data-testid="bulk-offset-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="e.g. head"
              style={inputStyle}
            />
          </label>
          <button
            data-testid="bulk-offset-select-all"
            onClick={() => setAllFiltered(true)}
            style={{ padding: '6px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
          >
            All
          </button>
          <button
            data-testid="bulk-offset-select-none"
            onClick={() => setAllFiltered(false)}
            style={{ padding: '6px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
          >
            None
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {grouped.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted, #666)' }}>
              No bindings match the filter.
            </div>
          )}
          {grouped.map((group) => (
            <div
              key={group.collectionId}
              data-testid={`bulk-offset-collection-${group.collectionId}`}
              style={{
                border: '1px solid var(--color-border, #ddd)',
                borderRadius: 4,
                padding: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  onClick={() =>
                    setExpanded((prev) => ({
                      ...prev,
                      [group.collectionId]: !prev[group.collectionId],
                    }))
                  }
                  aria-label={expanded[group.collectionId] ? 'Collapse' : 'Expand'}
                  style={{ cursor: 'pointer', fontSize: 12, padding: '2px 6px' }}
                >
                  {expanded[group.collectionId] ? '▾' : '▸'}
                </button>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{group.name}</span>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                  {group.rows.filter((row) => checked[rowKey(row)]).length}/{group.rows.length}{' '}
                  checked
                </span>
              </div>
              {expanded[group.collectionId] && (
                <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {group.rows.map((row) => (
                    <label
                      key={rowKey(row)}
                      data-testid={`bulk-offset-row-${row.collectionId}-${row.semanticName}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
                    >
                      <input
                        type="checkbox"
                        checked={checked[rowKey(row)] ?? false}
                        onChange={(e) =>
                          setChecked((prev) => ({ ...prev, [rowKey(row)]: e.target.checked }))
                        }
                      />
                      <span style={{ fontFamily: 'monospace' }}>{row.semanticName}</span>
                      <span style={{ color: 'var(--color-text-muted, #666)' }}>→</span>
                      <span>{row.clipName}</span>
                      {row.uses > 1 && (
                        <span style={{ color: 'var(--color-text-muted, #666)', fontSize: 11 }}>
                          ×{row.uses}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {ANIMATABLE_PROPERTIES.map((property) => (
            <div
              key={property}
              style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}
            >
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 110 }}>
                <input
                  type="checkbox"
                  data-testid={`bulk-offset-channel-${property}`}
                  checked={channels[property].on}
                  onChange={(e) =>
                    setChannels((prev) => ({
                      ...prev,
                      [property]: { ...prev[property], on: e.target.checked },
                    }))
                  }
                />
                {CHANNEL_LABELS[property]}
              </label>
              <input
                data-testid={`bulk-offset-delta-${property}`}
                value={channels[property].delta}
                onChange={(e) =>
                  setChannels((prev) => ({
                    ...prev,
                    [property]: { ...prev[property], delta: e.target.value },
                  }))
                }
                placeholder="+100"
                inputMode="decimal"
                style={{ ...inputStyle, marginTop: 0 }}
              />
            </div>
          ))}
        </div>
        <div data-testid="bulk-offset-preview" style={{ fontSize: 12 }}>
          {preview.keyframeCount} keyframe(s) in {preview.clipCount} clip(s)
          {preview.skippedLinked > 0 && ` · ${preview.skippedLinked} param-linked skipped`}
          {preview.skippedMissing > 0 && ` · ${preview.skippedMissing} missing skipped`}
          {sharedUses > 1 && ` · shared clips edited in place (up to ×${sharedUses})`}
        </div>
        {error && (
          <div
            data-testid="bulk-offset-error"
            role="alert"
            style={{ fontSize: 12, color: 'var(--color-danger, #c00)' }}
          >
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            data-testid="bulk-offset-cancel"
            onClick={onClose}
            style={{ padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            data-testid="bulk-offset-confirm"
            onClick={handleConfirm}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid transparent',
              background: 'var(--color-accent, #7c5cff)',
              color: 'var(--color-accent-text, #fff)',
              cursor: 'pointer',
            }}
          >
            Apply offset
          </button>
        </div>
      </div>
    </div>
  )
}
