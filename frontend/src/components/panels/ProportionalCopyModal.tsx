import { useMemo, useState } from 'react'
import type { AnimationProperty } from '../../engine/animationProperties'
import type {
  ProportionalCopyDestRow,
  ProportionalCopySourceRow,
} from '../../app/clipProportionalCopyAction'
import type {
  ProportionalCopyBinding,
  ProportionalCopyMode,
  ProportionalCopyPreview,
} from '../../engine/proportionalCopy'

export interface ProportionalCopyDialogSelection {
  readonly fromNorm: number
  readonly toNorm: number
  readonly bindings: readonly ProportionalCopyBinding[]
  readonly destProjectIds: readonly string[]
  /** Shared-library entry ids, imported by the owner on confirm. */
  readonly destLibraryIds: readonly string[]
  readonly mode: ProportionalCopyMode
  /** Time-reverse the copied span: last becomes first. Composes with the mode. */
  readonly reverse: boolean
}

interface Props {
  readonly sourceCollectionName: string
  /** Longest member-clip duration in seconds; the range inputs are expressed against it. */
  readonly sourceLongestDuration: number
  readonly sourceRows: readonly ProportionalCopySourceRow[]
  readonly destRows: readonly ProportionalCopyDestRow[]
  readonly getPreview: (selection: ProportionalCopyDialogSelection) => ProportionalCopyPreview
  readonly onClose: () => void
  /**
   * Execute the copy (dispatched by the owner). Returns an error message to
   * display, or null on success (owner closes the modal itself). May be async
   * when the owner imports shared-library destinations first.
   */
  readonly onConfirm: (
    selection: ProportionalCopyDialogSelection,
  ) => string | null | Promise<string | null>
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

function channelKey(semanticName: string, property: AnimationProperty): string {
  return `${semanticName}::${property}`
}

function destCategoryLabel(category: string): string {
  return category.trim() === '' ? 'Uncategorized' : category.trim()
}

interface DestGroup {
  readonly label: string
  readonly rows: ProportionalCopyDestRow[]
}

export function ProportionalCopyModal({
  sourceCollectionName,
  sourceLongestDuration,
  sourceRows,
  destRows,
  getPreview,
  onClose,
  onConfirm,
}: Props) {
  const longest = sourceLongestDuration > 0 ? sourceLongestDuration : 0
  const [fromSec, setFromSec] = useState('0')
  const [toSec, setToSec] = useState(longest > 0 ? String(round3(longest)) : '1')
  const [filter, setFilter] = useState('')
  const [checkedSem, setCheckedSem] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sourceRows.map((row) => [row.semanticName, true])),
  )
  const [checkedChannels, setCheckedChannels] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const row of sourceRows) {
      for (const property of row.channels) init[channelKey(row.semanticName, property)] = true
    }
    return init
  })
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sourceRows.map((row) => [row.semanticName, true])),
  )
  const [checkedDests, setCheckedDests] = useState<Record<string, boolean>>(() => ({}))
  const [destFilter, setDestFilter] = useState('')
  const [expandedDestGroups, setExpandedDestGroups] = useState<Record<string, boolean>>(() => ({}))
  const [mode, setMode] = useState<ProportionalCopyMode>('exact')
  const [reverse, setReverse] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedRange = useMemo((): { fromNorm: number; toNorm: number; invalid: boolean } => {
    const from = Number(fromSec)
    const to = Number(toSec)
    if (
      fromSec.trim() === '' ||
      toSec.trim() === '' ||
      !Number.isFinite(from) ||
      !Number.isFinite(to)
    ) {
      return { fromNorm: 0, toNorm: 1, invalid: true }
    }
    if (longest > 0) {
      if (from < 0 || to > longest + 1e-9 || from >= to) {
        return { fromNorm: from / longest, toNorm: to / longest, invalid: true }
      }
      return {
        fromNorm: Math.min(1, Math.max(0, from / longest)),
        toNorm: Math.min(1, Math.max(0, to / longest)),
        invalid: false,
      }
    }
    if (from !== 0) return { fromNorm: 0, toNorm: 1, invalid: true }
    return { fromNorm: 0, toNorm: 1, invalid: false }
  }, [fromSec, toSec, longest])

  const filteredSource = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return sourceRows
    return sourceRows.filter((row) => row.semanticName.toLowerCase().includes(needle))
  }, [sourceRows, filter])

  const destGroups = useMemo((): DestGroup[] => {
    const needle = destFilter.trim().toLowerCase()
    const filtered = needle
      ? destRows.filter((row) => row.collectionName.toLowerCase().includes(needle))
      : destRows
    const order: string[] = []
    const byLabel = new Map<string, ProportionalCopyDestRow[]>()
    for (const row of filtered) {
      const label = destCategoryLabel(row.category)
      let group = byLabel.get(label)
      if (!group) {
        group = []
        byLabel.set(label, group)
        order.push(label)
      }
      group.push(row)
    }
    order.sort((a, b) => {
      if (a === 'Uncategorized') return 1
      if (b === 'Uncategorized') return -1
      return a.localeCompare(b)
    })
    return order.map((label) => ({ label, rows: byLabel.get(label)! }))
  }, [destRows, destFilter])

  const selection = useMemo((): ProportionalCopyDialogSelection => {
    const bindings: ProportionalCopyBinding[] = []
    for (const row of sourceRows) {
      if (!checkedSem[row.semanticName]) continue
      const channels = row.channels.filter(
        (property) => checkedChannels[channelKey(row.semanticName, property)],
      )
      if (channels.length === 0) continue
      bindings.push({ semanticName: row.semanticName, channels })
    }
    const destProjectIds: string[] = []
    const destLibraryIds: string[] = []
    for (const row of destRows) {
      if (!checkedDests[row.key]) continue
      if (row.origin === 'library') destLibraryIds.push(row.refId)
      else destProjectIds.push(row.refId)
    }
    return {
      fromNorm: parsedRange.fromNorm,
      toNorm: parsedRange.toNorm,
      bindings,
      destProjectIds,
      destLibraryIds,
      mode,
      reverse,
    }
  }, [sourceRows, checkedSem, checkedChannels, destRows, checkedDests, parsedRange, mode, reverse])

  const preview = useMemo(() => getPreview(selection), [getPreview, selection])

  const sharedUses = useMemo(() => {
    let max = 0
    for (const row of sourceRows) {
      if (checkedSem[row.semanticName]) max = Math.max(max, row.uses)
    }
    return max
  }, [sourceRows, checkedSem])

  const setAllFilteredSem = (value: boolean): void => {
    setCheckedSem((prev) => {
      const next = { ...prev }
      for (const row of filteredSource) next[row.semanticName] = value
      return next
    })
  }

  const setAllDests = (value: boolean): void => {
    setCheckedDests(Object.fromEntries(destRows.map((row) => [row.key, value])))
  }

  const setDestGroup = (rows: readonly ProportionalCopyDestRow[], value: boolean): void => {
    setCheckedDests((prev) => {
      const next = { ...prev }
      for (const row of rows) next[row.key] = value
      return next
    })
  }

  const handleConfirm = async (): Promise<void> => {
    if (busy) return
    if (parsedRange.invalid) {
      setError(
        longest > 0
          ? `Invalid range — enter seconds with 0 ≤ from < to ≤ ${round3(longest)}`
          : 'Invalid range — enter 0 as the start',
      )
      return
    }
    if (selection.bindings.length === 0) {
      setError('Nothing selected — check at least one object with at least one property')
      return
    }
    if (selection.destProjectIds.length + selection.destLibraryIds.length === 0) {
      setError('No destination collections selected — check at least one collection to copy to')
      return
    }
    setBusy(true)
    try {
      const message = await onConfirm(selection)
      if (message) setError(message)
    } finally {
      setBusy(false)
    }
  }

  const selectedSemCount = selection.bindings.length
  const selectedDestCount = selection.destProjectIds.length + selection.destLibraryIds.length

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Copy properties proportionally"
      data-testid="proportional-copy-modal"
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
          minWidth: 560,
          maxWidth: 720,
          maxHeight: '85vh',
          overflowY: 'auto',
          border: '1px solid var(--color-border, #ddd)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ margin: 0, fontSize: 14 }}>
          Copy properties proportionally — {sourceCollectionName}
        </h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: 0 }}>
          Copy the checked properties of the checked objects onto the same objects in the
          destination collections — project collections and shared-library collections grouped by
          category below (library ones are imported on confirm). Times map proportionally (same
          relative moments), so clips of different lengths stay in sync. Destination keyframes
          inside the copied span are replaced. One undo step. Param-linked properties are skipped.
        </p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <label style={{ flex: 1, fontSize: 12 }}>
            Copy from (sec)
            <input
              data-testid="proportional-copy-from"
              value={fromSec}
              onChange={(e) => setFromSec(e.target.value)}
              placeholder="0"
              inputMode="decimal"
              style={inputStyle}
            />
          </label>
          <label style={{ flex: 1, fontSize: 12 }}>
            Copy to (sec)
            <input
              data-testid="proportional-copy-to"
              value={toSec}
              onChange={(e) => setToSec(e.target.value)}
              placeholder={longest > 0 ? String(round3(longest)) : '1'}
              inputMode="decimal"
              style={inputStyle}
            />
          </label>
          <span
            data-testid="proportional-copy-range-hint"
            style={{ fontSize: 11, color: 'var(--color-text-muted, #666)', paddingBottom: 6 }}
          >
            {longest > 0
              ? `${Math.round(parsedRange.fromNorm * 100)}%–${Math.round(parsedRange.toNorm * 100)}% of each clip`
              : 'full clip'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ flex: 1, fontSize: 12 }}>
            Filter objects by semantic name
            <input
              data-testid="proportional-copy-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="e.g. head"
              style={inputStyle}
            />
          </label>
          <button
            data-testid="proportional-copy-select-all"
            onClick={() => setAllFilteredSem(true)}
            style={{ padding: '6px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
          >
            All
          </button>
          <button
            data-testid="proportional-copy-select-none"
            onClick={() => setAllFilteredSem(false)}
            style={{ padding: '6px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
          >
            None
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filteredSource.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted, #666)' }}>
              No objects match the filter.
            </div>
          )}
          {filteredSource.map((row) => (
            <div
              key={row.semanticName}
              data-testid={`proportional-copy-semantic-${row.semanticName}`}
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
                      [row.semanticName]: !prev[row.semanticName],
                    }))
                  }
                  aria-label={expanded[row.semanticName] ? 'Collapse' : 'Expand'}
                  style={{ cursor: 'pointer', fontSize: 12, padding: '2px 6px' }}
                >
                  {expanded[row.semanticName] ? '▾' : '▸'}
                </button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={checkedSem[row.semanticName] ?? false}
                    onChange={(e) =>
                      setCheckedSem((prev) => ({ ...prev, [row.semanticName]: e.target.checked }))
                    }
                  />
                  <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                    {row.semanticName}
                  </span>
                </label>
                <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                  → {row.clipName} ({row.duration}s)
                </span>
                {row.uses > 1 && (
                  <span style={{ color: 'var(--color-text-muted, #666)', fontSize: 11 }}>
                    ×{row.uses}
                  </span>
                )}
              </div>
              {expanded[row.semanticName] && (
                <div
                  style={{
                    marginTop: 6,
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 4,
                  }}
                >
                  {row.channels.length === 0 && row.linkedChannels.length === 0 && (
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                      No animatable properties on this clip.
                    </span>
                  )}
                  {row.channels.map((property) => (
                    <label
                      key={property}
                      data-testid={`proportional-copy-channel-${row.semanticName}-${property}`}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                    >
                      <input
                        type="checkbox"
                        checked={checkedChannels[channelKey(row.semanticName, property)] ?? false}
                        onChange={(e) =>
                          setCheckedChannels((prev) => ({
                            ...prev,
                            [channelKey(row.semanticName, property)]: e.target.checked,
                          }))
                        }
                      />
                      {CHANNEL_LABELS[property]}
                    </label>
                  ))}
                  {row.linkedChannels.map((property) => (
                    <span
                      key={`linked-${property}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11,
                        color: 'var(--color-text-muted, #666)',
                      }}
                    >
                      {CHANNEL_LABELS[property]} (param-linked, skipped)
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              Copy to ({selectedDestCount} selected)
            </span>
            <span style={{ flex: 1 }} />
            <button
              data-testid="proportional-copy-dests-all"
              onClick={() => setAllDests(true)}
              style={{ padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
            >
              All
            </button>
            <button
              data-testid="proportional-copy-dests-none"
              onClick={() => setAllDests(false)}
              style={{ padding: '4px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
            >
              None
            </button>
          </div>
          <label style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
            Filter collections
            <input
              data-testid="proportional-copy-dest-filter"
              value={destFilter}
              onChange={(e) => setDestFilter(e.target.value)}
              placeholder="e.g. turn"
              style={inputStyle}
            />
          </label>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxHeight: 220,
              overflowY: 'auto',
            }}
          >
            {destGroups.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted, #666)' }}>
                {destRows.length === 0
                  ? 'No other collections to copy to.'
                  : 'No collections match the filter.'}
              </div>
            )}
            {destGroups.map((group) => {
              const groupSelected = group.rows.filter((row) => checkedDests[row.key]).length
              const groupExpanded = expandedDestGroups[group.label] ?? true
              return (
                <div
                  key={group.label}
                  data-testid={`proportional-copy-dest-group-${group.label}`}
                  style={{
                    border: '1px solid var(--color-border, #ddd)',
                    borderRadius: 4,
                    padding: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() =>
                        setExpandedDestGroups((prev) => ({
                          ...prev,
                          [group.label]: !(prev[group.label] ?? true),
                        }))
                      }
                      aria-label={groupExpanded ? 'Collapse' : 'Expand'}
                      style={{ cursor: 'pointer', fontSize: 12, padding: '2px 6px' }}
                    >
                      {groupExpanded ? '▾' : '▸'}
                    </button>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={groupSelected === group.rows.length && group.rows.length > 0}
                        onChange={(e) => setDestGroup(group.rows, e.target.checked)}
                      />
                      <span style={{ fontWeight: 600 }}>{group.label}</span>
                    </label>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted, #666)' }}>
                      {groupSelected}/{group.rows.length} checked
                    </span>
                  </div>
                  {groupExpanded && (
                    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {group.rows.map((row) => (
                        <label
                          key={row.key}
                          data-testid={`proportional-copy-dest-${row.key}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            fontSize: 12,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checkedDests[row.key] ?? false}
                            onChange={(e) =>
                              setCheckedDests((prev) => ({ ...prev, [row.key]: e.target.checked }))
                            }
                          />
                          <span style={{ fontWeight: 600 }}>{row.collectionName}</span>
                          {row.origin === 'library' && (
                            <span
                              style={{
                                fontSize: 10,
                                color: 'var(--color-accent, #7c5cff)',
                                border: '1px solid var(--color-accent, #7c5cff)',
                                borderRadius: 3,
                                padding: '0 4px',
                              }}
                            >
                              library · imported on confirm
                            </span>
                          )}
                          <span style={{ color: 'var(--color-text-muted, #666)', fontSize: 11 }}>
                            {row.bindingCount} binding(s)
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <fieldset style={{ margin: 0, padding: '8px 10px', fontSize: 12 }}>
          <legend style={{ fontSize: 12 }}>Copy mode</legend>
          <label style={{ display: 'block', marginBottom: 4 }}>
            <input
              type="radio"
              name="proportional-copy-mode"
              checked={mode === 'exact'}
              data-testid="proportional-copy-mode-exact"
              onChange={() => setMode('exact')}
            />{' '}
            Exact — copy values as they are
          </label>
          <label style={{ display: 'block', marginBottom: 4 }}>
            <input
              type="radio"
              name="proportional-copy-mode"
              checked={mode === 'mirrorX'}
              data-testid="proportional-copy-mode-x"
              onChange={() => setMode('mirrorX')}
            />{' '}
            Symmetric X — left-right (negates Position X + Rotation)
          </label>
          <label style={{ display: 'block' }}>
            <input
              type="radio"
              name="proportional-copy-mode"
              checked={mode === 'mirrorY'}
              data-testid="proportional-copy-mode-y"
              onChange={() => setMode('mirrorY')}
            />{' '}
            Symmetric Y — top-bottom (negates Position Y + Rotation)
          </label>
        </fieldset>

        <label
          data-testid="proportional-copy-reverse"
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
        >
          <input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />
          <span>
            Reverse time — last becomes first
            <span style={{ color: 'var(--color-text-muted, #666)' }}>
              {' '}
              (what was at the end of the span lands on its start and vice versa; composes with the
              mode above)
            </span>
          </span>
        </label>

        <div data-testid="proportional-copy-preview" style={{ fontSize: 12 }}>
          {preview.keyframeCount} keyframe(s) → {preview.destClipCount} clip(s)
          {selection.reverse && ' · reversed'}
          {selection.destLibraryIds.length > 0 &&
            ` · +${selection.destLibraryIds.length} from library (imported on confirm)`}
          {preview.replacedCount > 0 && ` · ${preview.replacedCount} replaced`}
          {preview.skippedLinked > 0 && ` · ${preview.skippedLinked} param-linked skipped`}
          {preview.skippedMissingSemantic > 0 &&
            ` · ${preview.skippedMissingSemantic} missing binding(s) skipped`}
          {preview.skippedMissingClip > 0 && ` · ${preview.skippedMissingClip} missing skipped`}
          {selectedSemCount === 0 && ' · no objects selected'}
          {sharedUses > 1 && ` · shared clips edited in place (up to ×${sharedUses})`}
        </div>
        {error && (
          <div
            data-testid="proportional-copy-error"
            role="alert"
            style={{ fontSize: 12, color: 'var(--color-danger, #c00)' }}
          >
            {error}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            data-testid="proportional-copy-cancel"
            onClick={onClose}
            style={{ padding: '6px 12px', borderRadius: 4, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            data-testid="proportional-copy-confirm"
            onClick={handleConfirm}
            disabled={busy}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid transparent',
              background: 'var(--color-accent, #7c5cff)',
              color: 'var(--color-accent-text, #fff)',
              cursor: busy ? 'wait' : 'pointer',
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? 'Copying…' : 'Copy proportionally'}
          </button>
        </div>
      </div>
    </div>
  )
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}
