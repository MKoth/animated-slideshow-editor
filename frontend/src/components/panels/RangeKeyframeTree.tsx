import type { RangeNodeTree } from '../../app/rangeKeyframeTree'
import { subtreeTotal, subtreeHasVisible, visibleSubtreeKeys } from '../../app/rangeKeyframeTree'
import { countTrackInRange, rangeTrackCheckKey } from '../../app/rangeKeyframes'
import type { RangeTrackSnapshot } from '../../app/rangeKeyframes'

interface NodeSectionViewProps {
  readonly subtree: RangeNodeTree
  readonly depth: number
  readonly from: number
  readonly to: number
  readonly rangeValid: boolean
  readonly checked: ReadonlySet<string>
  readonly collapsed: ReadonlySet<string>
  readonly testIdPrefix: string
  readonly trackTestId: (nodeId: string, track: RangeTrackSnapshot) => string
  readonly onToggleCollapsed: (nodeId: string) => void
  readonly onToggleKey: (key: string) => void
  readonly onToggleSubtree: (subtree: RangeNodeTree, value: boolean) => void
}

function NodeSectionView({
  subtree,
  depth,
  from,
  to,
  rangeValid,
  checked,
  collapsed,
  testIdPrefix,
  trackTestId,
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
    <div data-testid={`${testIdPrefix}-node-${snap.nodeId}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
        <button
          type="button"
          aria-label={isCollapsed ? `Expand ${snap.nodeName}` : `Collapse ${snap.nodeName}`}
          aria-expanded={!isCollapsed}
          data-testid={`${testIdPrefix}-collapse-${snap.nodeId}`}
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
            data-testid={`${testIdPrefix}-toggle-${snap.nodeId}`}
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
                  data-testid={trackTestId(snap.nodeId, track)}
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
                  testIdPrefix={testIdPrefix}
                  trackTestId={trackTestId}
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

interface RangeKeyframeTreeProps {
  readonly tree: RangeNodeTree
  readonly from: number
  readonly to: number
  readonly rangeValid: boolean
  readonly checked: ReadonlySet<string>
  readonly collapsed: ReadonlySet<string>
  readonly testIdPrefix: string
  readonly trackTestId: (nodeId: string, track: RangeTrackSnapshot) => string
  readonly onToggleCollapsed: (nodeId: string) => void
  readonly onToggleKey: (key: string) => void
  readonly onToggleSubtree: (subtree: RangeNodeTree, value: boolean) => void
}

/** Checkbox tree of nodes and keyframe tracks within a timeline section. */
export function RangeKeyframeTree({
  tree,
  from,
  to,
  rangeValid,
  checked,
  collapsed,
  testIdPrefix,
  trackTestId,
  onToggleCollapsed,
  onToggleKey,
  onToggleSubtree,
}: RangeKeyframeTreeProps) {
  return (
    <NodeSectionView
      subtree={tree}
      depth={0}
      from={from}
      to={to}
      rangeValid={rangeValid}
      checked={checked}
      collapsed={collapsed}
      testIdPrefix={testIdPrefix}
      trackTestId={trackTestId}
      onToggleCollapsed={onToggleCollapsed}
      onToggleKey={onToggleKey}
      onToggleSubtree={onToggleSubtree}
    />
  )
}
