import { useMemo, useState } from 'react'
import { useEngine } from '../../app/useEngine'
import {
  countTrackInRange,
  planRangeDelete,
  rangeTrackCheckKey,
  rangeTrackTestId,
  snapshotRangeNodes,
} from '../../app/deleteKeyframesInRange'
import type {
  RangeDeletePlanEntry,
  RangeNodeSnapshot,
  RangeTrackSnapshot,
} from '../../app/deleteKeyframesInRange'
import { formatSec, parseSec, validateSegmentRange } from '../../engine/timeSegmentExtraction'

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

interface NodeTree {
  readonly snap: RangeNodeSnapshot
  readonly children: readonly NodeTree[]
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

function buildTree(snapshots: readonly RangeNodeSnapshot[]): NodeTree | null {
  if (snapshots.length === 0) {
    return null
  }
  interface MutableNode {
    readonly snap: RangeNodeSnapshot
    readonly children: NodeTree[]
  }
  const root: MutableNode = { snap: snapshots[0]!, children: [] }
  const stack: { node: MutableNode; depth: number }[] = [{ node: root, depth: snapshots[0]!.depth }]
  for (const snap of snapshots.slice(1)) {
    while (stack.length > 0 && stack[stack.length - 1]!.depth >= snap.depth) {
      stack.pop()
    }
    const parent = stack[stack.length - 1]
    if (!parent) {
      break
    }
    const child: MutableNode = { snap, children: [] }
    parent.node.children.push(child)
    stack.push({ node: child, depth: snap.depth })
  }
  return root
}

/** All check keys in the subtree (used by the node-level checkbox). */
function subtreeKeys(tree: NodeTree): string[] {
  const keys: string[] = []
  const visit = (node: NodeTree): void => {
    for (const track of node.snap.tracks) {
      keys.push(rangeTrackCheckKey(node.snap.nodeId, track.trackKey))
    }
    for (const child of node.children) {
      visit(child)
    }
  }
  visit(tree)
  return keys
}

/** Visible (in-range, non-zero) check keys in the subtree. Zero-count rows are hidden. */
function visibleSubtreeKeys(tree: NodeTree, from: number, to: number): string[] {
  const keys: string[] = []
  const visit = (node: NodeTree): void => {
    for (const track of node.snap.tracks) {
      if (countTrackInRange(track, from, to) > 0) {
        keys.push(rangeTrackCheckKey(node.snap.nodeId, track.trackKey))
      }
    }
    for (const child of node.children) {
      visit(child)
    }
  }
  visit(tree)
  return keys
}

/** Total in-range keyframes under checked tracks in the subtree. */
function subtreeTotal(
  tree: NodeTree,
  from: number,
  to: number,
  checked: ReadonlySet<string>,
): number {
  let total = 0
  const visit = (node: NodeTree): void => {
    for (const track of node.snap.tracks) {
      if (checked.has(rangeTrackCheckKey(node.snap.nodeId, track.trackKey))) {
        total += countTrackInRange(track, from, to)
      }
    }
    for (const child of node.children) {
      visit(child)
    }
  }
  visit(tree)
  return total
}

/** Whether the subtree has any keyframe in range (drives hide-zero-count). */
function subtreeHasVisible(tree: NodeTree, from: number, to: number): boolean {
  return visibleSubtreeKeys(tree, from, to).length > 0
}

interface NodeSectionViewProps {
  readonly subtree: NodeTree
  readonly depth: number
  readonly from: number
  readonly to: number
  readonly rangeValid: boolean
  readonly checked: ReadonlySet<string>
  readonly collapsed: ReadonlySet<string>
  readonly onToggleCollapsed: (nodeId: string) => void
  readonly onToggleKey: (key: string) => void
  readonly onToggleSubtree: (subtree: NodeTree, value: boolean) => void
}

function NodeSectionView({
  subtree,
  depth,
  from,
  to,
  rangeValid,
  checked,
  collapsed,
  onToggleCollapsed,
  onToggleKey,
  onToggleSubtree,
}: NodeSectionViewProps) {
  const snap = subtree.snap
  const isCollapsed = collapsed.has(snap.nodeId)
  const visibleKeys = rangeValid ? visibleSubtreeKeys(subtree, from, to) : []
  const checkedVisible = visibleKeys.filter((key) => checked.has(key)).length
  const allChecked = visibleKeys.length > 0 && checkedVisible === visibleKeys.length
  const someChecked = checkedVisible > 0 && !allChecked
  const sectionTotal = rangeValid ? subtreeTotal(subtree, from, to, checked) : 0

  return (
    <div data-testid={`delete-range-node-${snap.nodeId}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
        <button
          type="button"
          aria-label={isCollapsed ? `Expand ${snap.nodeName}` : `Collapse ${snap.nodeName}`}
          aria-expanded={!isCollapsed}
          data-testid={`delete-range-collapse-${snap.nodeId}`}
          onClick={() => onToggleCollapsed(snap.nodeId)}
          style={{
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            padding: '2px 4px',
            fontSize: 10,
            lineHeight: 1,
          }}
        >
          {isCollapsed ? '▶' : '▼'}
        </button>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontWeight: depth === 0 ? 600 : 500,
          }}
        >
          <input
            type="checkbox"
            data-testid={`delete-range-toggle-${snap.nodeId}`}
            checked={allChecked}
            ref={(el) => {
              if (el) {
                el.indeterminate = someChecked
              }
            }}
            onChange={(event) => onToggleSubtree(subtree, event.target.checked)}
          />
          <span>{snap.nodeName}</span>
          <span style={{ color: 'var(--color-text-muted, #666)', fontWeight: 400 }}>
            {sectionTotal} in range
          </span>
        </label>
      </div>
      {!isCollapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
          {snap.tracks.map((track: RangeTrackSnapshot) => {
            const count = rangeValid ? countTrackInRange(track, from, to) : 0
            // Hide zero-count tracks.
            if (!rangeValid || count === 0) {
              return null
            }
            const key = rangeTrackCheckKey(snap.nodeId, track.trackKey)
            return (
              <label
                key={key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  paddingLeft: 24,
                }}
              >
                <input
                  type="checkbox"
                  data-testid={rangeTrackTestId(snap.nodeId, track)}
                  checked={checked.has(key)}
                  onChange={() => onToggleKey(key)}
                />
                <span>{track.label}</span>
                <span style={{ color: 'var(--color-text-muted, #666)' }}>×{count}</span>
              </label>
            )
          })}
          {subtree.children.map((child) => {
            // Hide zero-count child nodes.
            if (!rangeValid || !subtreeHasVisible(child, from, to)) {
              return null
            }
            return (
              <div key={child.snap.nodeId} style={{ marginLeft: 16 }}>
                <NodeSectionView
                  subtree={child}
                  depth={depth + 1}
                  from={from}
                  to={to}
                  rangeValid={rangeValid}
                  checked={checked}
                  collapsed={collapsed}
                  onToggleCollapsed={onToggleCollapsed}
                  onToggleKey={onToggleKey}
                  onToggleSubtree={onToggleSubtree}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
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

  const tree = useMemo(() => (snapshots ? buildTree(snapshots) : null), [snapshots])

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

  const toggleSubtree = (subtree: NodeTree, value: boolean): void => {
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

  const toggleCollapsed = (nodeId: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(nodeId)) {
        next.delete(nodeId)
      } else {
        next.add(nodeId)
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
                <NodeSectionView
                  subtree={tree}
                  depth={0}
                  from={safeFrom}
                  to={safeTo}
                  rangeValid={rangeValid}
                  checked={checked}
                  collapsed={collapsed}
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
