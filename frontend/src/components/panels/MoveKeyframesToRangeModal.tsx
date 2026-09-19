import { useMemo, useState } from 'react'
import { useEngine } from '../../app/useEngine'
import { countPlannedMoves, planRangeMove } from '../../app/moveKeyframesInRange'
import type { RangeMovePlanEntry } from '../../app/moveKeyframesInRange'
import { rangeTrackCheckKey, snapshotRangeNodes } from '../../app/rangeKeyframes'
import type { RangeNodeSnapshot, RangeTrackSnapshot } from '../../app/rangeKeyframes'
import { buildRangeNodeTree, subtreeKeys, subtreeHasVisible } from '../../app/rangeKeyframeTree'
import type { RangeNodeTree } from '../../app/rangeKeyframeTree'
import { formatSec, parseSec, validateSegmentRange } from '../../engine/timeSegmentExtraction'
import { RangeKeyframeTree } from './RangeKeyframeTree'

export interface RangeMoveSelection {
  readonly from: number
  readonly to: number
  readonly targetFrom: number
  readonly targetTo: number
  readonly plan: readonly RangeMovePlanEntry[]
}

interface Props {
  readonly nodeId: string
  readonly slideId: string
  readonly slideDuration: number
  readonly onClose: () => void
  readonly onConfirm: (selection: RangeMoveSelection) => void
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

function moveRangeTrackTestId(nodeId: string, track: RangeTrackSnapshot): string {
  if (track.target.kind === 'node' && 'property' in track.target) {
    return `move-range-prop-${nodeId}-${track.target.property}`
  }
  return `move-range-track-${nodeId}-${track.trackKey}`
}

interface RangeRowProps {
  readonly legend: string
  readonly fromTestId: string
  readonly toTestId: string
  readonly fullSlideTestId: string
  readonly fromStr: string
  readonly toStr: string
  readonly onFromChange: (value: string) => void
  readonly onToChange: (value: string) => void
  readonly onFullSlide: () => void
}

function RangeRow({
  legend,
  fromTestId,
  toTestId,
  fullSlideTestId,
  fromStr,
  toStr,
  onFromChange,
  onToChange,
  onFullSlide,
}: RangeRowProps) {
  return (
    <fieldset
      style={{
        border: '1px solid var(--color-border, #ddd)',
        borderRadius: 4,
        padding: '6px 8px 8px',
        margin: 0,
      }}
    >
      <legend style={{ fontSize: 11, padding: '0 4px' }}>{legend}</legend>
      <div style={{ display: 'flex', gap: 8 }}>
        <label style={{ flex: 1, fontSize: 12 }}>
          From (s)
          <input
            data-testid={fromTestId}
            value={fromStr}
            onChange={(event) => onFromChange(event.target.value)}
            style={inputStyle}
          />
        </label>
        <label style={{ flex: 1, fontSize: 12 }}>
          To (s)
          <input
            data-testid={toTestId}
            value={toStr}
            onChange={(event) => onToChange(event.target.value)}
            style={inputStyle}
          />
        </label>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button
            data-testid={fullSlideTestId}
            onClick={onFullSlide}
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
    </fieldset>
  )
}

export function MoveKeyframesToRangeModal({
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
  const [targetFromStr, setTargetFromStr] = useState(() => formatSec(0))
  const [targetToStr, setTargetToStr] = useState(() => formatSec(slideDuration))
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
  const sourceError =
    from === null || to === null
      ? 'Enter numeric From and To times.'
      : validateSegmentRange(from, to, slideDuration)
  const sourceValid = sourceError === null && from !== null && to !== null
  const safeFrom = sourceValid ? (from as number) : 0
  const safeTo = sourceValid ? (to as number) : 0

  const targetFrom = parseSec(targetFromStr)
  const targetTo = parseSec(targetToStr)
  const targetError =
    targetFrom === null || targetTo === null
      ? 'Enter numeric From and To times.'
      : validateSegmentRange(targetFrom, targetTo, slideDuration)
  const targetValid = targetError === null && targetFrom !== null && targetTo !== null
  const safeTargetFrom = targetValid ? (targetFrom as number) : 0
  const safeTargetTo = targetValid ? (targetTo as number) : 0

  const plan =
    snapshots && sourceValid && targetValid
      ? planRangeMove(
          snapshots,
          safeFrom,
          safeTo,
          safeTargetFrom,
          safeTargetTo,
          slideDuration,
          (id, track) => checked.has(rangeTrackCheckKey(id, track.trackKey)),
        )
      : []
  const total = countPlannedMoves(plan)
  const hasVisible = tree !== null && sourceValid && subtreeHasVisible(tree, safeFrom, safeTo)

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
    if (!sourceValid || !targetValid || plan.length === 0) {
      return
    }
    onConfirm({
      from: from as number,
      to: to as number,
      targetFrom: targetFrom as number,
      targetTo: targetTo as number,
      plan,
    })
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Move keyframes to another timeline section"
      data-testid="move-range-modal"
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
        <h3 style={{ margin: '0 0 8px', fontSize: 14 }} data-testid="move-range-title">
          Move keyframes to another timeline section
        </h3>
        {!tree ? (
          <>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted, #666)' }}>
              Object not found. It may have been deleted.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                onClick={onClose}
                data-testid="move-range-cancel"
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <RangeRow
                  legend="Move from"
                  fromTestId="move-range-from-input"
                  toTestId="move-range-to-input"
                  fullSlideTestId="move-range-source-full-slide"
                  fromStr={fromStr}
                  toStr={toStr}
                  onFromChange={setFromStr}
                  onToChange={setToStr}
                  onFullSlide={() => {
                    setFromStr(formatSec(0))
                    setToStr(formatSec(slideDuration))
                  }}
                />
                {sourceError && (
                  <p
                    data-testid="move-range-source-error"
                    style={{ fontSize: 12, color: '#c00', margin: '4px 0 0' }}
                  >
                    {sourceError}
                  </p>
                )}
              </div>
              <div>
                <RangeRow
                  legend="Move to"
                  fromTestId="move-range-target-from-input"
                  toTestId="move-range-target-to-input"
                  fullSlideTestId="move-range-target-full-slide"
                  fromStr={targetFromStr}
                  toStr={targetToStr}
                  onFromChange={setTargetFromStr}
                  onToChange={setTargetToStr}
                  onFullSlide={() => {
                    setTargetFromStr(formatSec(0))
                    setTargetToStr(formatSec(slideDuration))
                  }}
                />
                {targetError && (
                  <p
                    data-testid="move-range-target-error"
                    style={{ fontSize: 12, color: '#c00', margin: '4px 0 0' }}
                  >
                    {targetError}
                  </p>
                )}
              </div>
            </div>
            <div
              data-testid="move-range-list"
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
                  rangeValid={sourceValid}
                  checked={checked}
                  collapsed={collapsed}
                  testIdPrefix="move-range"
                  trackTestId={moveRangeTrackTestId}
                  onToggleCollapsed={toggleCollapsed}
                  onToggleKey={toggleKey}
                  onToggleSubtree={toggleSubtree}
                />
              ) : (
                <p
                  data-testid="move-range-empty"
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
              data-testid="move-range-total"
              style={{ fontSize: 12, color: 'var(--color-text-muted, #666)', margin: '8px 0 0' }}
            >
              {total} keyframe{total === 1 ? '' : 's'} selected. This is undoable.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button
                onClick={onClose}
                data-testid="move-range-cancel"
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
                disabled={!sourceValid || !targetValid || total === 0}
                data-testid="move-range-confirm"
                style={{
                  padding: '6px 12px',
                  borderRadius: 4,
                  border: '1px solid transparent',
                  background: !sourceValid || !targetValid || total === 0 ? '#a0b0e0' : '#2c5fbf',
                  color: '#fff',
                  cursor: !sourceValid || !targetValid || total === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                Move {total} keyframe{total === 1 ? '' : 's'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
