import { useMemo, useState } from 'react'
import { useEngine } from '../../app/useEngine'
import { planRangeDelete, rangeTrackTestId } from '../../app/deleteKeyframesInRange'
import type { RangeDeletePlanEntry } from '../../app/deleteKeyframesInRange'
import { rangeTrackCheckKey, snapshotRangeNodes } from '../../app/rangeKeyframes'
import type { RangeNodeSnapshot } from '../../app/rangeKeyframes'
import {
  buildRangeNodeTree,
  subtreeKeys,
  subtreeTotal,
  subtreeHasVisible,
} from '../../app/rangeKeyframeTree'
import type { RangeNodeTree } from '../../app/rangeKeyframeTree'
import { formatSec, parseSec, validateSegmentRange } from '../../engine/timeSegmentExtraction'
import { RangeKeyframeTree } from './RangeKeyframeTree'

export interface RangeDeleteSelection {
  readonly from: number
  readonly to: number
  readonly plan: readonly RangeDeletePlanEntry[]
}

interface Props {
  readonly nodeId: string
  readonly slideId: string
  readonly slideDuration: number
  readonly onClose: () => void
  readonly onConfirm: (selection: RangeDeleteSelection) => void
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

export function DeleteKeyframesInRangeModal({
  nodeId,
  slideId,
  slideDuration,
  onClose,
  onConfirm,
}: Props) {
  const { engine } = useEngine()

  const snapshots = useMemo<readonly RangeNodeSnapshot[] | null>(() => {
    try {
      const slide = engine.getSlide(slideId)
      const root = slide.scene.getNode(nodeId)
      if (!root) {
        return null
      }
      return snapshotRangeNodes(root, slide, engine.materialDefinitions)
    } catch {
      return null
    }
  }, [engine, slideId, nodeId])

  const tree = useMemo(() => (snapshots ? buildRangeNodeTree(snapshots) : null), [snapshots])

  const [fromStr, setFromStr] = useState(() => formatSec(0))
  const [toStr, setToStr] = useState(() => formatSec(slideDuration))
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => {
    if (!tree) {
      return new Set()
    }
    // Parent + all descendants pre-checked.
    return new Set(subtreeKeys(tree))
  })
  // Collapsed node sections (all expanded by default).
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())

  const from = parseSec(fromStr)
  const to = parseSec(toStr)
  const rangeError =
    from === null || to === null
      ? 'Enter numeric From and To times.'
      : validateSegmentRange(from, to, slideDuration)
  const rangeValid = rangeError === null && from !== null && to !== null
  const safeFrom = rangeValid ? (from as number) : 0
  const safeTo = rangeValid ? (to as number) : 0

  const total = tree && rangeValid ? subtreeTotal(tree, safeFrom, safeTo, checked) : 0
  const hasVisible = tree !== null && rangeValid && subtreeHasVisible(tree, safeFrom, safeTo)

  const toggleKey = (key: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const toggleSubtree = (subtree: RangeNodeTree, value: boolean): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      for (const key of subtreeKeys(subtree)) {
        if (value) {
          next.add(key)
        } else {
          next.delete(key)
        }
      }
      return next
    })
  }

  const toggleCollapsed = (collapsedNodeId: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(collapsedNodeId)) {
        next.delete(collapsedNodeId)
      } else {
        next.add(collapsedNodeId)
      }
      return next
    })
  }

  const handleConfirm = (): void => {
    if (!snapshots || !rangeValid || from === null || to === null) {
      return
    }
    const plan = planRangeDelete(snapshots, from, to, (id, track) =>
      checked.has(rangeTrackCheckKey(id, track.trackKey)),
    )
    if (plan.length === 0) {
      return
    }
    onConfirm({ from, to, plan })
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Delete keyframes from timeline section"
      data-testid="delete-range-modal"
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
        className="modal"
        style={{
          background: 'var(--color-bg, #fff)',
          borderRadius: 8,
          padding: 16,
          minWidth: 380,
          maxWidth: 520,
          width: '100%',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid var(--color-border, #ddd)',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }} data-testid="delete-range-title">
          Delete keyframes from timeline section
        </h3>
        {!tree ? (
          <>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted, #666)' }}>
              Object not found. It may have been deleted.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                onClick={onClose}
                data-testid="delete-range-cancel"
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border, #ddd)',
                  background: 'var(--color-bg, #fff)',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ flex: 1, fontSize: 12 }}>
                From (s)
                <input
                  data-testid="delete-range-from-input"
                  value={fromStr}
                  onChange={(event) => setFromStr(event.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={{ flex: 1, fontSize: 12 }}>
                To (s)
                <input
                  data-testid="delete-range-to-input"
                  value={toStr}
                  onChange={(event) => setToStr(event.target.value)}
                  style={inputStyle}
                />
              </label>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button
                  data-testid="delete-range-full-slide"
                  onClick={() => {
                    setFromStr(formatSec(0))
                    setToStr(formatSec(slideDuration))
                  }}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: '1px solid var(--color-border, #ddd)',
                    background: 'var(--color-bg, #fff)',
                    cursor: 'pointer',
                    fontSize: 12,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Full slide
                </button>
              </div>
            </div>
            {rangeError && (
              <p
                data-testid="delete-range-error"
                style={{ fontSize: 12, color: '#c00', margin: '6px 0 0' }}
              >
                {rangeError}
              </p>
            )}
            <div
              data-testid="delete-range-list"
              style={{
                marginTop: 10,
                overflowY: 'auto',
                border: '1px solid var(--color-border, #ddd)',
                borderRadius: 4,
                padding: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {hasVisible ? (
                <RangeKeyframeTree
                  tree={tree}
                  from={safeFrom}
                  to={safeTo}
                  rangeValid={rangeValid}
                  checked={checked}
                  collapsed={collapsed}
                  testIdPrefix="delete-range"
                  trackTestId={rangeTrackTestId}
                  onToggleCollapsed={toggleCollapsed}
                  onToggleKey={toggleKey}
                  onToggleSubtree={toggleSubtree}
                />
              ) : (
                <p
                  data-testid="delete-range-empty"
                  style={{
                    fontSize: 12,
                    color: 'var(--color-text-muted, #666)',
                    margin: 0,
                  }}
                >
                  No keyframes in this range.
                </p>
              )}
            </div>
            <p
              data-testid="delete-range-total"
              style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: '8px 0 0' }}
            >
              {total} keyframe{total === 1 ? '' : 's'} selected. This is undoable.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button
                onClick={onClose}
                data-testid="delete-range-cancel"
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: '1px solid var(--color-border, #ddd)',
                  background: 'var(--color-bg, #fff)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={!rangeValid || total === 0}
                data-testid="delete-range-confirm"
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: '1px solid transparent',
                  background: !rangeValid || total === 0 ? '#e0a0a0' : '#c00',
                  color: '#fff',
                  cursor: !rangeValid || total === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                Delete {total} keyframe{total === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
