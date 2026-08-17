import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { AnimationProperty, Scene } from '../../engine'
import { addKeyframeAtPlayhead, addPoseKeyframesAtPlayhead } from '../../app/keyframeActions'
import {
  deleteSelectedKeyframes,
  keyframeRefsOfScene,
  materialKeyframeRefsOfScene,
} from '../../app/keyframeSelectionActions'
import { useEngine } from '../../app/useEngine'
import { AddKeyframeCommand, DeleteKeyframesCommand } from '../../engine/commands'
import { useNotificationStore } from '../../stores/notificationStore'
import { usePlaybackController } from '../../stores/playbackStore'
import { useSelectionStore } from '../../stores/selectionStore'
import {
  useTimelineSelectionStore,
  selectedKeyframeIdsOf,
} from '../../stores/timelineSelectionStore'
import type { KeyframeSelectionItem } from '../../stores/timelineSelectionStore'
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
import { useKeyframeDrag } from './keyframeDrag'
import {
  ROW_HEIGHT,
  TRACK_HEADER_WIDTH,
  PROPERTY_LABELS,
  materialParameterLabel,
} from './timelineTracks'
import type { TimelineRow } from './timelineTracks'
import { KeyframeMarker, TimelineContextMenu, TrackRow } from './timelineComponents'
import type { TimelineMenuState } from './timelineComponents'

const MARQUEE_START_DISTANCE = 4

export function TimelineBody({
  slideId,
  duration,
  scene,
  rows,
  scrollerRef,
  tracksRef,
  timeAreaRef,
  viewportWidth,
  lastPointerTimeRef,
}: {
  slideId: string
  duration: number
  scene: Scene
  rows: readonly TimelineRow[]
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
  const expandedNodeIds = useTimelineViewStore((state) => state.expandedNodeIds)
  const currentTime = usePlaybackController((state) => state.currentTimes[slideId] ?? 0)
  const playbackStatus = usePlaybackController((state) => state.status)
  const timelineSelection = useTimelineSelectionStore()
  const selectedKeyframeIds = selectedKeyframeIdsOf(timelineSelection)
  const [menu, setMenu] = useState<TimelineMenuState | null>(null)
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

  const timeFromClientX = (clientX: number): number => {
    const rect = timeAreaRef.current?.getBoundingClientRect()
    const state = useTimelineViewStore.getState()
    const p = pixelsPerSecond(state.zoomLevel)
    return state.scrollTime + (clientX - (rect?.left ?? 0)) / p
  }

  const propertyKeyframeRefs = keyframeRefsOfScene(engine, scene)
  const materialKeyframeRefs = materialKeyframeRefsOfScene(engine, scene)
  const allKeyframeRefs = [...propertyKeyframeRefs, ...materialKeyframeRefs]
  const keyframeRefs = new Map(allKeyframeRefs.map((ref) => [ref.keyframeId, ref] as const))

  const allSelectionItems: KeyframeSelectionItem[] = []
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]
    if (row.kind === 'subtrack') {
      for (const keyframe of engine.getKeyframes(row.node.id, row.property)) {
        allSelectionItems.push({ keyframeId: keyframe.id, time: keyframe.time, rowIndex })
      }
    } else if (row.kind === 'materialSubtrack') {
      for (const keyframe of engine.getMaterialKeyframes(row.node.id, row.parameter.key)) {
        allSelectionItems.push({ keyframeId: keyframe.id, time: keyframe.time, rowIndex })
      }
    }
  }
  const allSelectionItemsRef = useRef<KeyframeSelectionItem[]>([])
  useEffect(() => {
    allSelectionItemsRef.current = allSelectionItems
  })
  const { dragPreview, isDraggable, startDrag } = useKeyframeDrag({
    keyframeRefs,
    duration,
    pps,
    timeFromClientX,
    dispatch,
    notify,
  })

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el) {
      return
    }
    const target = scrollTime * pps
    if (Math.abs(el.scrollLeft - target) > 0.5) {
      el.scrollLeft = target
    }
  }, [scrollTime, pps, scrollerRef])

  useEffect(() => {
    const state = useTimelineViewStore.getState()
    const p = pixelsPerSecond(state.zoomLevel)
    const px = currentTime * p
    const viewLeft = state.scrollTime * p
    const viewRight = viewLeft + viewportWidth
    const margin = Math.min(80, viewportWidth / 6)
    if (playbackStatus === 'playing') {
      if (px < viewLeft + margin) {
        state.setScrollTime(currentTime - margin / p, viewportWidth, duration)
      } else if (px > viewRight - margin) {
        state.setScrollTime(currentTime + margin / p - viewportWidth / p, viewportWidth, duration)
      }
    } else if (playbackStatus === 'stopped' && currentTime === 0 && px < viewLeft) {
      state.setScrollTime(0, viewportWidth, duration)
    }
  }, [currentTime, playbackStatus, viewportWidth, duration])

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

  const dragPlayhead = (clientX: number) => {
    const raw = timeFromClientX(clientX)
    usePlaybackController
      .getState()
      .setCurrentTime(slideId, snapTimeToGrid(raw, rulerTickStep(pps)), duration)
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
        useSelectionStore.getState().clear()
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
    row: Extract<TimelineRow, { kind: 'subtrack' | 'materialSubtrack' }>,
    keyframe: { id: string },
  ) => {
    event.preventDefault()
    event.stopPropagation()
    if (row.kind === 'subtrack') {
      setMenu({
        x: event.clientX,
        y: event.clientY,
        nodeId: row.node.id,
        property: row.property,
        keyframeId: keyframe.id,
      })
    } else {
      setMenu({
        x: event.clientX,
        y: event.clientY,
        nodeId: row.node.id,
        parameter: row.parameter.key,
        keyframeId: keyframe.id,
      })
    }
  }

  const handleTrackListContextMenu = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement
    const subtrack = target.closest<HTMLElement>('[data-property]')
    if (subtrack) {
      const nodeId = subtrack.dataset.nodeId
      const property = subtrack.dataset.property
      if (nodeId && property) {
        event.preventDefault()
        setMenu({
          x: event.clientX,
          y: event.clientY,
          nodeId,
          property: property as AnimationProperty,
        })
      }
      return
    }
    const materialSubtrack = target.closest<HTMLElement>('[data-parameter]')
    if (materialSubtrack) {
      const nodeId = materialSubtrack.dataset.nodeId
      const parameter = materialSubtrack.dataset.parameter
      if (nodeId && parameter) {
        event.preventDefault()
        setMenu({
          x: event.clientX,
          y: event.clientY,
          nodeId,
          parameter,
        })
      }
      return
    }
    const row = target.closest<HTMLElement>('[data-node-id]')
    if (row) {
      const nodeId = row.dataset.nodeId
      if (nodeId) {
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY, nodeId })
      }
    }
  }

  const addKeyframeFromMenu = () => {
    const target = menu
    setMenu(null)
    if (!target) {
      return
    }
    let result
    if (target.property) {
      result = addKeyframeAtPlayhead(engine, dispatch, slideId, target.nodeId, target.property)
    } else if (target.parameter) {
      const time = usePlaybackController.getState().getTime(slideId)
      const node = engine.getNode(target.nodeId)
      const parameter = node.material.overrides[target.parameter]
      const definition = engine.getMaterialDefinition(node.material.materialDefinitionId)
      const paramDef = definition.parameters.find((p) => p.key === target.parameter)
      const value = parameter ?? paramDef?.default
      if (value !== undefined) {
        result = dispatch(
          new AddKeyframeCommand({
            target: { kind: 'node', nodeId: target.nodeId, parameter: target.parameter },
            time,
            value,
          }),
        )
      }
    } else {
      result = addPoseKeyframesAtPlayhead(engine, dispatch, slideId, target.nodeId)
    }
    if (result && !result.ok) {
      notify(result.error.message)
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
      deleteSelectedKeyframes(engine, dispatch)
      return
    }
    let deleteTarget
    if (target.property) {
      deleteTarget = { kind: 'node' as const, nodeId: target.nodeId, property: target.property }
    } else if (target.parameter) {
      deleteTarget = { kind: 'node' as const, nodeId: target.nodeId, parameter: target.parameter }
    } else {
      return
    }
    const result = dispatch(
      new DeleteKeyframesCommand({
        target: deleteTarget,
        keyframeIds: [target.keyframeId],
      }),
    )
    if (result && !result.ok) {
      notify(result.error.message)
    }
    useTimelineSelectionStore.getState().clearSelection()
  }

  const step = rulerTickStep(pps)
  const visibleEnd = scrollTime + viewportWidth / pps
  const ticks = rulerTickTimes(scrollTime, visibleEnd, step)
  const contentWidth = Math.max(viewportWidth, duration * pps + TRAILING_SCROLL_PADDING_PX)

  return (
    <div className="timeline-body" onPointerMove={recordPointerTime}>
      <div
        className="timeline-tracks"
        ref={tracksRef}
        style={{ width: TRACK_HEADER_WIDTH }}
        onScroll={handleTracksScroll}
      >
        <ul className="timeline-tracks__list" onContextMenu={handleTrackListContextMenu}>
          {rows.map((row) =>
            row.kind === 'subtrack' ? (
              <li
                key={`${row.node.id}:${row.property}`}
                className="timeline-subtrack"
                data-node-id={row.node.id}
                data-property={row.property}
                data-depth={row.depth}
                style={{ paddingLeft: 12 + row.depth * 16 }}
              >
                <span className="timeline-subtrack__label">{PROPERTY_LABELS[row.property]}</span>
                <button
                  className="timeline-subtrack__add"
                  aria-label={`Add Keyframe to ${PROPERTY_LABELS[row.property]}`}
                  title="Add keyframe at the playhead"
                  onClick={() => {
                    const result = addKeyframeAtPlayhead(
                      engine,
                      dispatch,
                      slideId,
                      row.node.id,
                      row.property,
                    )
                    if (result && !result.ok) {
                      notify(result.error.message)
                    }
                  }}
                >
                  +
                </button>
              </li>
            ) : row.kind === 'materialSubtrack' ? (
              <li
                key={`${row.node.id}:material:${row.parameter.key}`}
                className="timeline-subtrack"
                data-node-id={row.node.id}
                data-parameter={row.parameter.key}
                data-depth={row.depth}
                style={{ paddingLeft: 12 + row.depth * 16 }}
              >
                <span className="timeline-subtrack__label">
                  {materialParameterLabel(row.parameter)}
                </span>
                <button
                  className="timeline-subtrack__add"
                  aria-label={`Add Keyframe to ${materialParameterLabel(row.parameter)}`}
                  title="Add keyframe at the playhead"
                  onClick={() => {
                    const time = usePlaybackController.getState().getTime(slideId)
                    const node = engine.getNode(row.node.id)
                    const overrideValue = node.material.overrides[row.parameter.key]
                    const value = overrideValue ?? row.parameter.default
                    const result = dispatch(
                      new AddKeyframeCommand({
                        target: {
                          kind: 'node',
                          nodeId: row.node.id,
                          parameter: row.parameter.key,
                        },
                        time,
                        value,
                      }),
                    )
                    if (result && !result.ok) {
                      notify(result.error.message)
                    }
                  }}
                >
                  +
                </button>
              </li>
            ) : (
              <TrackRow
                key={row.node.id}
                {...row}
                expanded={expandedNodeIds[row.node.id] === true}
              />
            ),
          )}
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
              aria-label="Playhead"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={currentTime}
              onPointerDown={startPlayheadDrag}
            >
              {ticks.map((time) => (
                <div className="timeline-tick" key={time} style={{ left: time * pps }}>
                  <span className="timeline-tick__label">{tickLabel(time, step)}</span>
                  <span className="timeline-tick__mark" />
                </div>
              ))}
              <div
                className="timeline-ruler__playhead-marker"
                style={{ left: currentTime * pps }}
              />
            </div>
            <div
              className="timeline-lanes"
              style={{ height: rows.length * ROW_HEIGHT, width: contentWidth }}
            >
              {rows.map((row, index) => {
                if (row.kind === 'subtrack') {
                  const keyframes = engine.getKeyframes(row.node.id, row.property)
                  return (
                    <div
                      key={`${row.node.id}:${row.property}`}
                      className="timeline-lane-row"
                      data-property={row.property}
                      style={{ top: index * ROW_HEIGHT }}
                    >
                      {keyframes.map((keyframe) => {
                        const previewTime = dragPreview?.get(keyframe.id)
                        const shownTime = previewTime ?? keyframe.time
                        const selected = selectedKeyframeIds.includes(keyframe.id)
                        return (
                          <KeyframeMarker
                            key={keyframe.id}
                            keyframeId={keyframe.id}
                            shownTime={shownTime}
                            property={row.property}
                            selected={selected}
                            pps={pps}
                            step={step}
                            onPointerDown={(event) =>
                              handleKeyframePointerDown(event, keyframe, index)
                            }
                            onContextMenu={(event) =>
                              handleKeyframeContextMenu(event, row, keyframe)
                            }
                          />
                        )
                      })}
                    </div>
                  )
                }
                if (row.kind === 'materialSubtrack') {
                  const keyframes = engine.getMaterialKeyframes(row.node.id, row.parameter.key)
                  return (
                    <div
                      key={`${row.node.id}:material:${row.parameter.key}`}
                      className="timeline-lane-row"
                      data-parameter={row.parameter.key}
                      style={{ top: index * ROW_HEIGHT }}
                    >
                      {keyframes.map((keyframe) => {
                        const previewTime = dragPreview?.get(keyframe.id)
                        const shownTime = previewTime ?? keyframe.time
                        const selected = selectedKeyframeIds.includes(keyframe.id)
                        return (
                          <KeyframeMarker
                            key={keyframe.id}
                            keyframeId={keyframe.id}
                            shownTime={shownTime}
                            selected={selected}
                            pps={pps}
                            step={step}
                            parameterLabel={materialParameterLabel(row.parameter)}
                            onPointerDown={(event) =>
                              handleKeyframePointerDown(event, keyframe, index)
                            }
                            onContextMenu={(event) =>
                              handleKeyframeContextMenu(event, row, keyframe)
                            }
                          />
                        )
                      })}
                    </div>
                  )
                }
                return null
              })}
            </div>
            <div
              className="timeline-playhead"
              data-testid="timeline-playhead"
              style={{ left: currentTime * pps }}
            />
            {marqueeRect && (
              <div
                className="timeline-marquee"
                data-testid="timeline-marquee"
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
          </div>
        </div>
      </div>
      {menu && (
        <TimelineContextMenu
          menu={menu}
          onAdd={addKeyframeFromMenu}
          onDelete={deleteKeyframeFromMenu}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
