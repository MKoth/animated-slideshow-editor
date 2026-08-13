import { memo } from 'react'
import type { AnimationProperty } from '../../engine'
import { useSelectionStore } from '../../stores/selectionStore'
import { useTimelineViewStore } from '../../stores/timelineViewStore'
import { tickLabel } from '../../stores/timelineViewStore'
import { iconOf } from './nodeIconKinds'
import { LockIcon, NodeIcon, VisibilityIcon } from './nodeIcons'
import { PROPERTY_LABELS } from './timelineTracks'
import type { TrackRowEntry } from './timelineTracks'

export interface TimelineMenuState {
  readonly x: number
  readonly y: number
  readonly nodeId: string
  readonly property?: AnimationProperty
  readonly keyframeId?: string
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={`timeline-track__chevron-icon${expanded ? ' timeline-track__chevron-icon--expanded' : ''}`}
    >
      <path d="M3 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export const TrackRow = memo(
  function TrackRow({
    node,
    depth,
    name,
    visible,
    expanded,
  }: TrackRowEntry & { expanded: boolean }) {
    const selected = useSelectionStore((state) => state.selectedIds.includes(node.id))
    return (
      <li data-node-id={node.id}>
        <div className="timeline-track-row">
          <button
            className="timeline-track__chevron"
            aria-label={`Toggle subtracks of ${name}`}
            aria-expanded={expanded}
            title={expanded ? 'Collapse subtracks' : 'Expand subtracks'}
            onClick={() => useTimelineViewStore.getState().toggleExpanded(node.id)}
          >
            <ChevronIcon expanded={expanded} />
          </button>
          <button
            role="track"
            aria-label={name}
            aria-selected={selected}
            data-depth={depth}
            className={`timeline-track${selected ? ' timeline-track--selected' : ''}`}
            style={{ paddingLeft: 12 + depth * 16 }}
            onClick={(event) => {
              if (event.ctrlKey || event.metaKey) {
                useSelectionStore.getState().toggle(node.id)
              } else if (event.shiftKey) {
                useSelectionStore.getState().extend(node.id)
              } else {
                useSelectionStore.getState().select(node.id)
              }
            }}
          >
            <span className="timeline-track__icon" data-icon={iconOf(node)}>
              <NodeIcon node={node} />
            </span>
            <span className="timeline-track__name">{name}</span>
            <span className="timeline-track__indicators">
              <span className="timeline-track__indicator" title={visible ? 'Visible' : 'Hidden'}>
                <VisibilityIcon visible={visible} />
              </span>
              <span className="timeline-track__indicator" title="Locked">
                <LockIcon />
              </span>
            </span>
          </button>
        </div>
      </li>
    )
  },
  (prev, next) =>
    prev.node.id === next.node.id &&
    prev.depth === next.depth &&
    prev.name === next.name &&
    prev.visible === next.visible &&
    prev.expanded === next.expanded,
)

export function KeyframeMarker({
  keyframeId,
  shownTime,
  property,
  selected,
  pps,
  step,
  onPointerDown,
  onContextMenu,
}: {
  keyframeId: string
  shownTime: number
  property: AnimationProperty
  selected: boolean
  pps: number
  step: number
  onPointerDown: (event: React.PointerEvent) => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  return (
    <div
      className={`timeline-keyframe${selected ? ' timeline-keyframe--selected' : ''}`}
      data-testid="keyframe-marker"
      data-keyframe-id={keyframeId}
      data-property={property}
      data-time={String(shownTime)}
      role="button"
      aria-label={`Keyframe at ${tickLabel(shownTime, step)} on ${PROPERTY_LABELS[property]}`}
      style={{ left: shownTime * pps }}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
    />
  )
}

export function TimelineContextMenu({
  menu,
  onAdd,
  onDelete,
  onClose,
}: {
  menu: TimelineMenuState
  onAdd: () => void
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <>
      <div
        className="timeline-context-menu__backdrop"
        data-testid="timeline-context-menu-backdrop"
        onClick={onClose}
      />
      <div
        className="timeline-context-menu"
        data-testid="timeline-context-menu"
        style={{ left: menu.x, top: menu.y }}
      >
        {menu.keyframeId ? (
          <button className="timeline-context-menu__item" onClick={onDelete}>
            Delete Keyframe
          </button>
        ) : (
          <button className="timeline-context-menu__item" onClick={onAdd}>
            Add Keyframe
          </button>
        )}
      </div>
    </>
  )
}
