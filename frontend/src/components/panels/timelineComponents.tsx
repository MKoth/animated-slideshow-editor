import { memo } from 'react'
import type { AnimationProperty } from '../../engine'
import { useEngine } from '../../app/useEngine'
import { useSelectionStore } from '../../stores/selectionStore'
import { useTimelineViewStore } from '../../stores/timelineViewStore'
import { tickLabel } from '../../stores/timelineViewStore'
import { usePlaybackController } from '../../stores/playbackStore'
import { useUiStore } from '../../stores/uiStore'
import {
  AddKeyframeCommand,
  SetKeyframeValueCommand,
  SetVisibilityCommand,
} from '../../engine/commands'
import { iconOf } from './nodeIconKinds'
import { LockIcon, NodeIcon, VisibilityIcon } from './nodeIcons'
import { PROPERTY_LABELS } from './timelineTracks'
import type { TrackRowEntry, BoneTrackEntry } from './timelineTracks'

export interface TimelineMenuState {
  readonly x: number
  readonly y: number
  readonly nodeId: string
  readonly property?: AnimationProperty
  readonly parameter?: string
  readonly label?: string
  readonly circleProperty?: import('../../engine/animationProperties').CircleAnimationProperty
  readonly shadowProperty?: import('../../engine/shadowEffect').ShadowProperty
  readonly morph?: boolean
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
  }: (TrackRowEntry | BoneTrackEntry) & { expanded: boolean }) {
    const selected = useSelectionStore((state) => state.selectedIds.includes(node.id))
    const { engine, dispatch } = useEngine()
    const handleEyeClick = (event: React.MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
      const activeSlide = engine.getActiveSlide()
      if (!activeSlide) return
      const animationMode = useUiStore.getState().animationMode
      if (animationMode) {
        const time = usePlaybackController.getState().getTime(activeSlide.id)
        const evaluatedVisible = (() => {
          try {
            return engine.evaluateVisible(node.id, time)
          } catch {
            return node.visible
          }
        })()
        const visibleKeyframes = engine.getVisibleKeyframes(node.id)
        const existing = visibleKeyframes.find((kf) => kf.time === time)
        if (existing) {
          dispatch(
            new SetKeyframeValueCommand({
              target: { kind: 'visible', nodeId: node.id },
              keyframeId: existing.id,
              newValue: !evaluatedVisible,
            }),
          )
        } else {
          dispatch(
            new AddKeyframeCommand({
              target: { kind: 'visible', nodeId: node.id },
              time,
              value: !evaluatedVisible,
            }),
          )
        }
      } else {
        dispatch(new SetVisibilityCommand({ nodeId: node.id, visible: !node.visible }))
      }
    }
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
              <button
                className="timeline-track__indicator timeline-track__indicator--eye"
                title={visible ? 'Visible' : 'Hidden'}
                aria-label={visible ? 'Hide node' : 'Show node'}
                onClick={handleEyeClick}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <VisibilityIcon visible={visible} />
              </button>
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
    prev.expanded === next.expanded &&
    prev.kind === next.kind,
)

export function KeyframeMarker({
  keyframeId,
  shownTime,
  property,
  selected,
  pps,
  step,
  parameterLabel,
  onPointerDown,
  onContextMenu,
}: {
  keyframeId: string
  shownTime: number
  property?: AnimationProperty
  selected: boolean
  pps: number
  step: number
  parameterLabel?: string
  onPointerDown: (event: React.PointerEvent) => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  const label = parameterLabel ?? (property ? PROPERTY_LABELS[property] : 'Unknown')
  return (
    <div
      className={`timeline-keyframe${selected ? ' timeline-keyframe--selected' : ''}`}
      data-testid="keyframe-marker"
      data-keyframe-id={keyframeId}
      data-property={property}
      data-parameter={parameterLabel}
      data-time={String(shownTime)}
      role="button"
      aria-label={`Keyframe at ${tickLabel(shownTime, step)} on ${label}`}
      style={{ left: shownTime * pps }}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
    />
  )
}

export interface SelectionScaleBoxProps {
  readonly bounds: {
    readonly minX: number
    readonly maxX: number
    readonly minY: number
    readonly maxY: number
  }
  readonly onScaleStart: (edge: 'left' | 'right', clientX: number, isAlt: boolean) => void
}

const HANDLE_WIDTH = 6

export const SelectionScaleBox = memo(function SelectionScaleBox({
  bounds,
  onScaleStart,
}: SelectionScaleBoxProps) {
  const { minX, maxX, minY, maxY } = bounds
  const width = maxX - minX
  const height = maxY - minY

  const handlePointerDown = (edge: 'left' | 'right') => (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onScaleStart(edge, event.clientX, event.altKey)
  }

  return (
    <div
      className="timeline-selection-box"
      data-testid="timeline-selection-box"
      style={{
        position: 'absolute',
        left: minX,
        top: minY,
        width,
        height,
        border: '1px solid var(--color-accent)',
        background: 'rgba(var(--color-accent-rgb, 59, 130, 246), 0.08)',
        pointerEvents: 'none',
        zIndex: 9,
      }}
    >
      <div
        className="timeline-selection-box__handle timeline-selection-box__handle--left"
        data-testid="selection-scale-handle-left"
        data-edge="left"
        style={{
          position: 'absolute',
          left: -HANDLE_WIDTH / 2,
          top: -2,
          width: HANDLE_WIDTH,
          height: height + 4,
          cursor: 'ew-resize',
          pointerEvents: 'auto',
          background: 'var(--color-accent)',
          borderRadius: 2,
          opacity: 0.7,
        }}
        onPointerDown={handlePointerDown('left')}
      />
      <div
        className="timeline-selection-box__handle timeline-selection-box__handle--right"
        data-testid="selection-scale-handle-right"
        data-edge="right"
        style={{
          position: 'absolute',
          right: -HANDLE_WIDTH / 2,
          top: -2,
          width: HANDLE_WIDTH,
          height: height + 4,
          cursor: 'ew-resize',
          pointerEvents: 'auto',
          background: 'var(--color-accent)',
          borderRadius: 2,
          opacity: 0.7,
        }}
        onPointerDown={handlePointerDown('right')}
      />
    </div>
  )
})

export function TimelineContextMenu({
  menu,
  onAdd,
  onDelete,
  onAddToClip,
  onClose,
}: {
  menu: TimelineMenuState
  onAdd: () => void
  onDelete: () => void
  onAddToClip?: () => void
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
          <>
            <button className="timeline-context-menu__item" onClick={onDelete}>
              Delete Keyframe
            </button>
            {onAddToClip && (
              <button
                className="timeline-context-menu__item"
                data-testid="add-to-clip-button"
                onClick={onAddToClip}
              >
                Add to clip
              </button>
            )}
          </>
        ) : (
          <button className="timeline-context-menu__item" onClick={onAdd}>
            Add Keyframe
          </button>
        )}
      </div>
    </>
  )
}
