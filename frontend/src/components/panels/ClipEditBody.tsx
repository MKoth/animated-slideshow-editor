import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { AnimationProperty } from '../../engine'
import type { ClipDefinition } from '../../engine/clipDefinition'
import { useEngine } from '../../app/useEngine'
import {
  AddClipKeyframeCommand,
  DeleteClipKeyframesCommand,
  AddClipChannelCommand,
  RemoveClipChannelCommand,
} from '../../engine/commands'
import { useNotificationStore } from '../../stores/notificationStore'
import {
  useTimelineSelectionStore,
  selectedKeyframeIdsOf,
} from '../../stores/timelineSelectionStore'
import type { KeyframeSelectionItem } from '../../stores/timelineSelectionStore'
import { deleteSelectedClipKeyframes } from '../../app/clipKeyframeActions'
import {
  DEFAULT_TIMELINE_VIEWPORT_WIDTH,
  pixelsPerSecond,
  rulerTickStep,
  rulerTickTimes,
  snapTimeToGrid,
  tickLabel,
  TRAILING_SCROLL_PADDING_PX,
  useTimelineViewStore,
} from '../../stores/timelineViewStore'
import { useClipKeyframeDrag } from './clipKeyframeDrag'
import { useClipKeyframeScale, computeClipSelectionBounds } from './clipKeyframeScale'
import { ROW_HEIGHT, TRACK_HEADER_WIDTH, clipChannelRows } from './timelineTracks'
import type { ClipChannelRowEntry } from './timelineTracks'
import { KeyframeMarker, SelectionScaleBox } from './timelineComponents'
import { ParameterPicker } from './ParameterPicker'
import { useSelectionStore } from '../../stores/selectionStore'

const MARQUEE_START_DISTANCE = 4

interface ClipContextMenuState {
  readonly x: number
  readonly y: number
  readonly channel: AnimationProperty
  readonly keyframeId?: string
}

export function ClipEditBody({
  clip,
  scrollerRef,
  tracksRef,
  timeAreaRef,
  viewportWidth,
  lastPointerTimeRef,
}: {
  clip: ClipDefinition
  scrollerRef: RefObject<HTMLDivElement | null>
  tracksRef: RefObject<HTMLDivElement | null>
  timeAreaRef: RefObject<HTMLDivElement | null>
  viewportWidth: number
  lastPointerTimeRef: RefObject<number | null>
}) {
  const { engine, dispatch } = useEngine()
  const notify = useNotificationStore((state) => state.notify)
  const zoomLevel = useTimelineViewStore((state) => state.zoomLevel)
  const scrollTime = useTimelineViewStore((state) => state.scrollTime)
  const timelineSelection = useTimelineSelectionStore()
  const selectedKeyframeIds = selectedKeyframeIdsOf(timelineSelection)
  const [menu, setMenu] = useState<ClipContextMenuState | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [channelMenu, setChannelMenu] = useState<{
    readonly x: number
    readonly y: number
    readonly channel: AnimationProperty
  } | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<{
    readonly x: number
    readonly y: number
    readonly width: number
    readonly height: number
  } | null>(null)
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null)
  const marqueeActiveRef = useRef(false)
  const marqueeRectRef = useRef<{ width: number; height: number } | null>(null)
  const pps = pixelsPerSecond(zoomLevel)

  const duration = clip.duration
  const clipId = clip.id

  const rows = clipChannelRows(clip)

  const selectedNodeId = useSelectionStore((state) => state.selectedIds[0])
  const animatableParams = useMemo(() => {
    if (!selectedNodeId) return []
    try {
      return engine.getAnimatableParameters(selectedNodeId)
    } catch {
      return []
    }
  }, [engine, selectedNodeId])

  const handleAddChannel = useCallback(
    (property: AnimationProperty) => {
      setPickerOpen(false)
      const result = dispatch(
        new AddClipChannelCommand({
          clipId,
          channel: { property },
        }),
      )
      if (!result.ok) {
        notify(result.error.message)
      }
    },
    [dispatch, clipId, notify],
  )

  const handleRemoveChannel = useCallback(
    (channel: AnimationProperty) => {
      setChannelMenu(null)
      const result = dispatch(new RemoveClipChannelCommand({ clipId, channel }))
      if (!result.ok) {
        notify(result.error.message)
      }
    },
    [dispatch, clipId, notify, setChannelMenu],
  )

  const timeFromClientX = (clientX: number): number => {
    const rect = timeAreaRef.current?.getBoundingClientRect()
    const state = useTimelineViewStore.getState()
    const p = pixelsPerSecond(state.zoomLevel)
    return state.scrollTime + (clientX - (rect?.left ?? 0)) / p
  }

  // Build keyframe refs for drag/scale
  const keyframeRefsMap = useMemo(() => {
    const refs = new Map<string, { channel: AnimationProperty; time: number }>()
    for (const row of rows) {
      for (const kf of engine.getClipChannelKeyframes(clipId, row.channel)) {
        refs.set(kf.id, { channel: row.channel, time: kf.time })
      }
    }
    return refs
  }, [rows, engine, clipId])

  // Selection items for marquee
  const allSelectionItems: KeyframeSelectionItem[] = []
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]
    for (const keyframe of engine.getClipChannelKeyframes(clipId, row.channel)) {
      allSelectionItems.push({ keyframeId: keyframe.id, time: keyframe.time, rowIndex })
    }
  }
  const allSelectionItemsRef = useRef<KeyframeSelectionItem[]>([])
  useEffect(() => {
    allSelectionItemsRef.current = allSelectionItems
  })

  const { dragPreview, isDraggable, startDrag } = useClipKeyframeDrag({
    clipId,
    keyframeRefs: keyframeRefsMap,
    duration,
    pps,
    timeFromClientX,
    dispatch,
    notify,
  })

  const { scalePreview, startScale } = useClipKeyframeScale({
    clipId,
    keyframeRefs: keyframeRefsMap,
    duration,
    pps,
    timeFromClientX,
    dispatch,
    notify,
  })

  const selectionBounds = computeClipSelectionBounds(selectedKeyframeIds, keyframeRefsMap)

  // Sync scroll position
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) {
      return
    }
    const state = useTimelineViewStore.getState()
    const target = state.scrollTime * pps
    if (Math.abs(el.scrollLeft - target) > 0.5) {
      el.scrollLeft = target
    }
  }, [scrollTime, pps, scrollerRef])

  // Wheel zoom
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) {
      return
    }
    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return
      }
      event.preventDefault()
      const state = useTimelineViewStore.getState()
      const p = pixelsPerSecond(state.zoomLevel)
      const rect = timeAreaRef.current?.getBoundingClientRect()
      const anchor = state.scrollTime + (event.clientX - (rect?.left ?? 0)) / p
      const viewport = el.clientWidth > 0 ? el.clientWidth : DEFAULT_TIMELINE_VIEWPORT_WIDTH
      const factor = event.deltaY < 0 ? 2 : 0.5
      state.setZoom(state.zoomLevel * factor, anchor, viewport, duration)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [scrollerRef, timeAreaRef, duration])

  const handleScroll = () => {
    const el = scrollerRef.current
    if (!el) {
      return
    }
    const tracks = tracksRef.current
    if (tracks && tracks.scrollTop !== el.scrollTop) {
      tracks.scrollTop = el.scrollTop
    }
    const state = useTimelineViewStore.getState()
    const p = pixelsPerSecond(state.zoomLevel)
    const viewport = el.clientWidth > 0 ? el.clientWidth : DEFAULT_TIMELINE_VIEWPORT_WIDTH
    state.setScrollTime(el.scrollLeft / p, viewport, duration)
  }

  const handleTracksScroll = () => {
    const tracks = tracksRef.current
    const el = scrollerRef.current
    if (tracks && el && el.scrollTop !== tracks.scrollTop) {
      el.scrollTop = tracks.scrollTop
    }
  }

  const recordPointerTime = (event: React.PointerEvent) => {
    const rect = timeAreaRef.current?.getBoundingClientRect()
    const state = useTimelineViewStore.getState()
    const p = pixelsPerSecond(state.zoomLevel)
    lastPointerTimeRef.current = state.scrollTime + (event.clientX - (rect?.left ?? 0)) / p
  }

  // Playhead scrubbing
  const [scrubTime, setScrubTime] = useState(0)

  const dragPlayhead = (clientX: number) => {
    const raw = timeFromClientX(clientX)
    const snapped = snapTimeToGrid(raw, rulerTickStep(pps))
    const bounded = Math.min(Math.max(snapped, 0), duration)
    setScrubTime(bounded)
  }

  const startPlayheadDrag = (event: React.PointerEvent) => {
    event.preventDefault()
    dragPlayhead(event.clientX)
    const move = (ev: PointerEvent) => dragPlayhead(ev.clientX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const handleTimeAreaPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button !== 0) {
        return
      }
      const target = event.target as HTMLElement
      if (target.closest('[data-keyframe-id]') || target.closest('.timeline-ruler')) {
        return
      }
      const rect = timeAreaRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      marqueeStartRef.current = { x, y }
      marqueeActiveRef.current = false
      marqueeRectRef.current = null
      useTimelineSelectionStore.getState().marqueeStart(x, y)

      const onMove = (ev: PointerEvent) => {
        if (!marqueeStartRef.current) {
          return
        }
        const cx = ev.clientX - rect.left
        const cy = ev.clientY - rect.top
        const dx = cx - marqueeStartRef.current.x
        const dy = cy - marqueeStartRef.current.y
        if (!marqueeActiveRef.current) {
          if (Math.hypot(dx, dy) < MARQUEE_START_DISTANCE) {
            return
          }
          marqueeActiveRef.current = true
        }
        const width = Math.abs(dx)
        const height = Math.abs(dy)
        marqueeRectRef.current = { width, height }
        const left = Math.min(marqueeStartRef.current.x, cx)
        const top = Math.min(marqueeStartRef.current.y, cy)
        setMarqueeRect({ x: left, y: top, width, height })
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        if (marqueeActiveRef.current) {
          const markers = document.querySelectorAll<HTMLElement>('[data-keyframe-id]')
          const intersecting: string[] = []
          const anchor = useTimelineSelectionStore.getState().marqueeAnchor
          const mr = marqueeRectRef.current
          if (anchor && mr) {
            const mLeft = Math.min(anchor.x, anchor.x + mr.width)
            const mTop = Math.min(anchor.y, anchor.y + mr.height)
            const mRight = mLeft + mr.width
            const mBottom = mTop + mr.height
            for (const marker of markers) {
              const markerRect = marker.getBoundingClientRect()
              const areaRect = timeAreaRef.current?.getBoundingClientRect()
              if (!areaRect) {
                continue
              }
              const relLeft = markerRect.left - areaRect.left
              const relTop = markerRect.top - areaRect.top
              const relRight = relLeft + markerRect.width
              const relBottom = relTop + markerRect.height
              if (relLeft < mRight && relRight > mLeft && relTop < mBottom && relBottom > mTop) {
                intersecting.push(marker.dataset.keyframeId!)
              }
            }
          }
          useTimelineSelectionStore
            .getState()
            .marqueeEnd(intersecting, allSelectionItemsRef.current)
        } else {
          useTimelineSelectionStore.getState().marqueeEnd([], allSelectionItemsRef.current)
        }
        marqueeStartRef.current = null
        marqueeActiveRef.current = false
        marqueeRectRef.current = null
        setMarqueeRect(null)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    },
    [timeAreaRef],
  )

  const handleKeyframePointerDown = (
    event: React.PointerEvent,
    keyframe: { id: string },
    rowIndex: number,
  ) => {
    if (event.button !== 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const additive = event.ctrlKey || event.metaKey
    const range = event.shiftKey
    const store = useTimelineSelectionStore.getState()

    if (range) {
      const time = timeFromClientX(event.clientX)
      const meta: KeyframeSelectionItem = { keyframeId: keyframe.id, time, rowIndex }
      store.selectKeyframeRange(keyframe.id, meta, allSelectionItems)
    } else if (additive) {
      const time = timeFromClientX(event.clientX)
      store.toggleKeyframe(keyframe.id, { time, rowIndex })
    } else {
      const selectedIds = selectedKeyframeIdsOf(store)
      if (!selectedIds.includes(keyframe.id)) {
        const time = timeFromClientX(event.clientX)
        store.selectKeyframe(keyframe.id, { time, rowIndex })
      }
    }

    if (isDraggable()) {
      startDrag(event.clientX)
    }
  }

  const handleKeyframeContextMenu = (
    event: React.MouseEvent,
    row: ClipChannelRowEntry,
    keyframe: { id: string },
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setMenu({
      x: event.clientX,
      y: event.clientY,
      channel: row.channel,
      keyframeId: keyframe.id,
    })
  }

  const addKeyframeFromMenu = () => {
    const target = menu
    setMenu(null)
    if (!target) {
      return
    }
    try {
      const time = scrubTime
      const existing = engine.getClipChannelKeyframes(clipId, target.channel)
      const alreadyExists = existing.some((kf) => kf.time === time)
      if (!alreadyExists) {
        const result = dispatch(
          new AddClipKeyframeCommand({
            target: { kind: 'clip', clipId, channel: target.channel },
            time,
            value: 0,
          }),
        )
        if (!result.ok) {
          notify(result.error.message)
        }
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error))
    }
  }

  const deleteKeyframeFromMenu = () => {
    const target = menu
    setMenu(null)
    if (!target?.keyframeId) {
      return
    }
    const selectedIds = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
    if (selectedIds.includes(target.keyframeId)) {
      deleteSelectedClipKeyframes(engine, dispatch)
      return
    }
    const result = dispatch(
      new DeleteClipKeyframesCommand({
        target: { kind: 'clip', clipId, channel: target.channel },
        keyframeIds: [target.keyframeId],
      }),
    )
    if (!result.ok) {
      notify(result.error.message)
    }
    useTimelineSelectionStore.getState().clearSelection()
  }

  const step = rulerTickStep(pps)
  const visibleEnd = scrollTime + viewportWidth / pps
  const ticks = rulerTickTimes(scrollTime, visibleEnd, step)
  const contentWidth = Math.max(viewportWidth, duration * pps + TRAILING_SCROLL_PADDING_PX)

  const effectiveSelectionBounds = selectionBounds
    ? (() => {
        if (!scalePreview || scalePreview.size === 0) return selectionBounds
        let minTime = Infinity
        let maxTime = -Infinity
        for (const id of selectedKeyframeIds) {
          const previewTime = scalePreview.get(id)
          const ref = keyframeRefsMap.get(id)
          const time = previewTime ?? ref?.time ?? 0
          if (time < minTime) minTime = time
          if (time > maxTime) maxTime = time
        }
        return minTime === Infinity
          ? selectionBounds
          : {
              ...selectionBounds,
              minTime,
              maxTime,
            }
      })()
    : null

  return (
    <div className="timeline-body clip-edit-body" onPointerMove={recordPointerTime}>
      <div
        className="timeline-tracks"
        ref={tracksRef}
        style={{ width: TRACK_HEADER_WIDTH }}
        onScroll={handleTracksScroll}
      >
        <ul className="timeline-tracks__list">
          <li className="timeline-tracks__ruler-spacer" aria-hidden="true" />
          {rows.map((row) => (
            <li
              key={row.channel}
              className="timeline-subtrack clip-edit-channel"
              data-channel={row.channel}
              data-depth={0}
              style={{ paddingLeft: 12 }}
              onContextMenu={(e) => {
                e.preventDefault()
                setChannelMenu({ x: e.clientX, y: e.clientY, channel: row.channel })
              }}
            >
              <span className="timeline-subtrack__label">{row.label}</span>
              <button
                className="timeline-subtrack__add"
                aria-label={`Add Keyframe to ${row.label}`}
                title="Add keyframe at the playhead"
                onClick={() => {
                  try {
                    const existing = engine.getClipChannelKeyframes(clipId, row.channel)
                    const alreadyExists = existing.some((kf) => kf.time === scrubTime)
                    if (!alreadyExists) {
                      const result = dispatch(
                        new AddClipKeyframeCommand({
                          target: { kind: 'clip', clipId, channel: row.channel },
                          time: scrubTime,
                          value: 0,
                        }),
                      )
                      if (!result.ok) {
                        notify(result.error.message)
                      }
                    }
                  } catch (error) {
                    notify(error instanceof Error ? error.message : String(error))
                  }
                }}
              >
                +
              </button>
            </li>
          ))}
          <li className="timeline-subtrack" style={{ paddingLeft: 12, position: 'relative' }}>
            <button
              className="timeline-subtrack__add"
              aria-label="Add Channel"
              title="Add a new channel to this clip"
              onClick={() => setPickerOpen(!pickerOpen)}
              style={{
                width: '100%',
                justifyContent: 'flex-start',
                gap: 6,
                color: 'var(--color-text-muted)',
                fontSize: 12,
              }}
            >
              + Add Channel
            </button>
            {pickerOpen && (
              <ParameterPicker
                clip={clip}
                parameters={animatableParams}
                onSelect={handleAddChannel}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </li>
        </ul>
      </div>
      <div
        className="timeline-scroller"
        data-testid="timeline-scroller"
        ref={scrollerRef}
        onScroll={handleScroll}
      >
        <div className="timeline-content" style={{ width: contentWidth }}>
          <div
            className="timeline-time-area"
            ref={timeAreaRef}
            onPointerDown={handleTimeAreaPointerDown}
          >
            <div
              className="timeline-ruler"
              role="slider"
              aria-label="Clip Playhead"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={scrubTime}
              onPointerDown={startPlayheadDrag}
            >
              {ticks.map((time) => (
                <div className="timeline-tick" key={time} style={{ left: time * pps }}>
                  <span className="timeline-tick__label">{tickLabel(time, step)}</span>
                  <span className="timeline-tick__mark" />
                </div>
              ))}
              <div className="timeline-ruler__playhead-marker" style={{ left: scrubTime * pps }} />
            </div>
            <div
              className="timeline-lanes"
              style={{ height: rows.length * ROW_HEIGHT, width: contentWidth }}
            >
              {rows.map((row, index) => {
                const keyframes = engine.getClipChannelKeyframes(clipId, row.channel)

                return (
                  <div
                    key={row.channel}
                    className="timeline-lane-row"
                    data-channel={row.channel}
                    style={{ top: index * ROW_HEIGHT }}
                  >
                    {keyframes.map((keyframe) => {
                      const previewTime =
                        scalePreview?.get(keyframe.id) ?? dragPreview?.get(keyframe.id)
                      const shownTime = previewTime ?? keyframe.time
                      const selected = selectedKeyframeIds.includes(keyframe.id)
                      return (
                        <KeyframeMarker
                          key={keyframe.id}
                          keyframeId={keyframe.id}
                          shownTime={shownTime}
                          property={row.channel}
                          selected={selected}
                          pps={pps}
                          step={step}
                          onPointerDown={(event) =>
                            handleKeyframePointerDown(event, keyframe, index)
                          }
                          onContextMenu={(event) => handleKeyframeContextMenu(event, row, keyframe)}
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
            <div
              className="timeline-playhead"
              data-testid="clip-edit-playhead"
              style={{ left: scrubTime * pps }}
            />
            {marqueeRect && (
              <div
                className="timeline-marquee"
                data-testid="clip-edit-marquee"
                style={{
                  position: 'absolute',
                  left: marqueeRect.x,
                  top: marqueeRect.y,
                  width: marqueeRect.width,
                  height: marqueeRect.height,
                  border: '1px solid var(--color-accent)',
                  background: 'rgba(var(--color-accent-rgb, 59, 130, 246), 0.1)',
                  pointerEvents: 'none',
                  zIndex: 10,
                }}
              />
            )}
            {effectiveSelectionBounds && selectedKeyframeIds.length >= 2 && (
              <SelectionScaleBox
                bounds={{
                  minX: effectiveSelectionBounds.minTime * pps,
                  maxX: effectiveSelectionBounds.maxTime * pps,
                  minY: 0,
                  maxY: rows.length * ROW_HEIGHT,
                }}
                onScaleStart={(edge, clientX, isAlt) => {
                  startScale(edge, clientX, isAlt, scrubTime)
                }}
              />
            )}
          </div>
        </div>
      </div>
      {menu && (
        <ClipEditContextMenu
          menu={menu}
          onAdd={addKeyframeFromMenu}
          onDelete={deleteKeyframeFromMenu}
          onClose={() => setMenu(null)}
        />
      )}
      {channelMenu && (
        <ChannelContextMenu
          x={channelMenu.x}
          y={channelMenu.y}
          channel={channelMenu.channel}
          onRemove={handleRemoveChannel}
          onClose={() => setChannelMenu(null)}
        />
      )}
    </div>
  )
}

function ClipEditContextMenu({
  menu,
  onAdd,
  onDelete,
  onClose,
}: {
  menu: ClipContextMenuState
  onAdd: () => void
  onDelete: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const handle = () => onClose()
    window.addEventListener('click', handle)
    window.addEventListener('contextmenu', handle)
    return () => {
      window.removeEventListener('click', handle)
      window.removeEventListener('contextmenu', handle)
    }
  }, [onClose])

  return (
    <div
      className="timeline-context-menu"
      data-testid="clip-edit-context-menu"
      style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 100 }}
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={onAdd}>Add Keyframe</button>
      {menu.keyframeId && <button onClick={onDelete}>Delete Keyframe</button>}
    </div>
  )
}

function ChannelContextMenu({
  x,
  y,
  channel,
  onRemove,
  onClose,
}: {
  x: number
  y: number
  channel: AnimationProperty
  onRemove: (channel: AnimationProperty) => void
  onClose: () => void
}) {
  useEffect(() => {
    const handle = () => onClose()
    window.addEventListener('click', handle)
    window.addEventListener('contextmenu', handle)
    return () => {
      window.removeEventListener('click', handle)
      window.removeEventListener('contextmenu', handle)
    }
  }, [onClose])

  return (
    <div
      className="timeline-context-menu"
      data-testid="channel-context-menu"
      style={{ position: 'fixed', left: x, top: y, zIndex: 100 }}
      onClick={(e) => e.stopPropagation()}
    >
      <button onClick={() => onRemove(channel)}>Remove Channel</button>
    </div>
  )
}
