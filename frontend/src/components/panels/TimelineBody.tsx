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
import { useKeyframeScale, computeSelectionBounds } from './keyframeScale'
import { useUiStore } from '../../stores/uiStore'
import { morphAutoKey } from '../../app/keyframeActions'
import {
  ROW_HEIGHT,
  TRACK_HEADER_WIDTH,
  PROPERTY_LABELS,
  CIRCLE_LABELS,
  VISIBLE_LABEL,
  MORPH_LABEL,
  materialParameterLabel,
} from './timelineTracks'
import type { TimelineRow } from './timelineTracks'
import {
  KeyframeMarker,
  SelectionScaleBox,
  TimelineContextMenu,
  TrackRow,
} from './timelineComponents'
import type { TimelineMenuState } from './timelineComponents'
import { ClipExtractionModal } from './ClipExtractionModal'
import {
  collectSelectedExtractableKeyframes,
  collectExtractableForSingle,
} from '../../app/clipExtractionActions'
import type { ExtractableKeyframe } from '../../engine/clipExtraction'

const MARQUEE_START_DISTANCE = 4

function MorphSubtrackHeader({
  node,
  depth,
  slideId,
}: {
  node: import('../../engine').SceneNode
  depth: number
  slideId: string
}) {
  const { engine, dispatch } = useEngine()
  const notify = useNotificationStore((state) => state.notify)
  const animationMode = useUiStore((s) => s.animationMode)
  const currentTime = usePlaybackController((s) => s.currentTimes[slideId] ?? 0)
  let shapes: readonly import('../../engine/shape').Shape[] = []
  try {
    shapes = engine.getShapes(node.id)
  } catch {
    shapes = []
  }
  // Current evaluated morph value at playhead (per-keyframe pair+coeff)
  let evaluated: import('../../engine/shape').MorphKeyframeValue | null = null
  try {
    evaluated = engine.evaluateMorphValue(node.id, currentTime)
  } catch {
    evaluated = null
  }
  const fromId = evaluated?.fromShapeId ?? (shapes[0]?.id ?? '')
  const toId = evaluated?.toShapeId ?? (shapes[1]?.id ?? shapes[0]?.id ?? '')
  const currentCoeff = evaluated?.coefficient ?? 0

  const commitMorphValue = (next: import('../../engine/shape').MorphKeyframeValue) => {
    if (!animationMode) {
      notify('Enter animation mode to keyframe morph')
      return
    }
    const result = morphAutoKey(engine, dispatch, node.id, next)
    if (result && !result.ok) notify(result.error.message)
  }

  const handleFromChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newFrom = e.target.value || null
    commitMorphValue({ fromShapeId: newFrom, toShapeId: evaluated?.toShapeId ?? toId ?? null, coefficient: currentCoeff })
  }
  const handleToChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newTo = e.target.value || null
    commitMorphValue({ fromShapeId: evaluated?.fromShapeId ?? fromId ?? null, toShapeId: newTo, coefficient: currentCoeff })
  }
  const handleAdd = () => {
    const time = usePlaybackController.getState().getTime(slideId)
    const value: import('../../engine/shape').MorphKeyframeValue = {
      fromShapeId: evaluated?.fromShapeId ?? (shapes[0]?.id ?? null),
      toShapeId: evaluated?.toShapeId ?? (shapes[1]?.id ?? shapes[0]?.id ?? null),
      coefficient: currentCoeff,
    }
    const result = dispatch(
      new AddKeyframeCommand({ target: { kind: 'morph', nodeId: node.id }, time, value: value as unknown as import('../../engine/keyframe').KeyframeValue }),
    )
    if (result && !result.ok) notify(result.error.message)
  }
  const handleCoeffChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value)
    if (Number.isNaN(v)) return
    commitMorphValue({ fromShapeId: evaluated?.fromShapeId ?? fromId ?? null, toShapeId: evaluated?.toShapeId ?? toId ?? null, coefficient: v })
  }
  return (
    <li
      className="timeline-subtrack timeline-subtrack--morph"
      data-node-id={node.id}
      data-morph="true"
      data-depth={depth}
      style={{
        paddingLeft: 12 + depth * 16,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        flexWrap: 'wrap',
      }}
    >
      <span className="timeline-subtrack__label" style={{ minWidth: 44 }}>
        {MORPH_LABEL}
      </span>
      <select
        aria-label={`Morph From for ${node.name}`}
        data-testid={`morph-from-${node.id}`}
        value={fromId}
        onChange={handleFromChange}
        style={{ flex: 1, minWidth: 60, fontSize: 11, padding: '2px 4px' }}
      >
        <option value="">— None —</option>
        {shapes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <span style={{ fontSize: 11, opacity: 0.7 }}>→</span>
      <select
        aria-label={`Morph To for ${node.name}`}
        data-testid={`morph-to-${node.id}`}
        value={toId}
        onChange={handleToChange}
        style={{ flex: 1, minWidth: 60, fontSize: 11, padding: '2px 4px' }}
      >
        <option value="">— None —</option>
        {shapes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <input
        type="range"
        min={0}
        max={1.5}
        step={0.01}
        aria-label={`Morph coefficient for ${node.name}`}
        data-testid={`morph-coeff-${node.id}`}
        value={currentCoeff}
        onChange={handleCoeffChange}
        style={{ width: 60 }}
        title={
          currentCoeff > 1
            ? 'Preview 1.5 (stored clamps 0..1)'
            : `Coefficient ${currentCoeff.toFixed(2)}`
        }
      />
      <span style={{ fontSize: 10, minWidth: 28, textAlign: 'right' }}>
        {currentCoeff.toFixed(2)}
      </span>
      <button
        className="timeline-subtrack__add"
        aria-label={`Add Keyframe to ${MORPH_LABEL}`}
        title="Add morph keyframe at the playhead"
        onClick={handleAdd}
      >
        +
      </button>
    </li>
  )
}

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
  const [extraction, setExtraction] = useState<ExtractableKeyframe[] | null>(null)
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
  // morph refs for selection/drag scale
  const morphKeyframeRefs: { nodeId: string; keyframeId: string; time: number; morph: true }[] = []
  for (const trackRow of rows) {
    if (trackRow.kind === 'morphSubtrack') {
      for (const kf of engine.getMorphKeyframes(trackRow.node.id)) {
        morphKeyframeRefs.push({
          nodeId: trackRow.node.id,
          keyframeId: kf.id,
          time: kf.time,
          morph: true,
        })
      }
    }
  }
  const allKeyframeRefs = [...propertyKeyframeRefs, ...materialKeyframeRefs]
  const keyframeRefs = new Map(
    [...allKeyframeRefs, ...morphKeyframeRefs].map((ref) => [ref.keyframeId, ref] as const),
  )

  const allSelectionItems: KeyframeSelectionItem[] = []
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]
    if (row.kind === 'subtrack') {
      for (const keyframe of engine.getKeyframes(row.node.id, row.property)) {
        allSelectionItems.push({ keyframeId: keyframe.id, time: keyframe.time, rowIndex })
      }
    } else if (row.kind === 'visibleSubtrack') {
      for (const keyframe of engine.getVisibleKeyframes(row.node.id)) {
        allSelectionItems.push({ keyframeId: keyframe.id, time: keyframe.time, rowIndex })
      }
    } else if (row.kind === 'morphSubtrack') {
      for (const keyframe of engine.getMorphKeyframes(row.node.id)) {
        allSelectionItems.push({ keyframeId: keyframe.id, time: keyframe.time, rowIndex })
      }
    } else if (row.kind === 'materialSubtrack') {
      for (const keyframe of engine.getMaterialKeyframes(row.node.id, row.parameter.key)) {
        allSelectionItems.push({ keyframeId: keyframe.id, time: keyframe.time, rowIndex })
      }
    } else if (row.kind === 'dataLabelSubtrack') {
      for (const keyframe of engine.getDataLabelKeyframes(row.node.id, row.label)) {
        allSelectionItems.push({ keyframeId: keyframe.id, time: keyframe.time, rowIndex })
      }
    } else if (row.kind === 'circleSubtrack') {
      for (const keyframe of engine.getCircleKeyframes(row.node.id, row.property)) {
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

  const { scalePreview, startScale } = useKeyframeScale({
    keyframeRefs,
    duration,
    pps,
    timeFromClientX,
    dispatch,
    notify,
  })

  const selectionBounds = computeSelectionBounds(selectedKeyframeIds, keyframeRefs)

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
    row: Extract<
      TimelineRow,
      {
        kind:
          | 'subtrack'
          | 'visibleSubtrack'
          | 'materialSubtrack'
          | 'dataLabelSubtrack'
          | 'circleSubtrack'
          | 'morphSubtrack'
      }
    >,
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
    } else if (row.kind === 'visibleSubtrack') {
      setMenu({
        x: event.clientX,
        y: event.clientY,
        nodeId: row.node.id,
        property: 'visible' as unknown as AnimationProperty,
        keyframeId: keyframe.id,
      } as unknown as Extract<import('./timelineComponents').TimelineMenuState, { nodeId: string }>)
    } else if (row.kind === 'morphSubtrack') {
      setMenu({
        x: event.clientX,
        y: event.clientY,
        nodeId: row.node.id,
        morph: true,
        keyframeId: keyframe.id,
      })
    } else if (row.kind === 'dataLabelSubtrack') {
      setMenu({
        x: event.clientX,
        y: event.clientY,
        nodeId: row.node.id,
        label: row.label,
        keyframeId: keyframe.id,
      })
    } else if (row.kind === 'circleSubtrack') {
      setMenu({
        x: event.clientX,
        y: event.clientY,
        nodeId: row.node.id,
        circleProperty: row.property,
        keyframeId: keyframe.id,
      } as unknown as Extract<import('./timelineComponents').TimelineMenuState, { nodeId: string }>)
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
    const visibleSubtrack = target.closest<HTMLElement>('[data-visible]')
    if (visibleSubtrack) {
      const nodeId = visibleSubtrack.dataset.nodeId
      if (nodeId) {
        event.preventDefault()
        setMenu({
          x: event.clientX,
          y: event.clientY,
          nodeId,
          property: 'visible' as unknown as AnimationProperty,
        } as unknown as import('./timelineComponents').TimelineMenuState)
      }
      return
    }
    const subtrack = target.closest<HTMLElement>('[data-property]')
    if (subtrack && !subtrack.hasAttribute('data-circle-property')) {
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
    const circleSubtrack = target.closest<HTMLElement>('[data-circle-property]')
    if (circleSubtrack) {
      const nodeId = circleSubtrack.dataset.nodeId
      const circleProperty = circleSubtrack.dataset.circleProperty
      if (nodeId && circleProperty) {
        event.preventDefault()
        setMenu({
          x: event.clientX,
          y: event.clientY,
          nodeId,
          circleProperty:
            circleProperty as import('../../engine/animationProperties').CircleAnimationProperty,
        } as unknown as import('./timelineComponents').TimelineMenuState)
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
    const morphSubtrack = target.closest<HTMLElement>('[data-morph]')
    if (morphSubtrack) {
      const nodeId = morphSubtrack.dataset.nodeId
      if (nodeId) {
        event.preventDefault()
        setMenu({
          x: event.clientX,
          y: event.clientY,
          nodeId,
          morph: true,
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
    if (target.morph) {
      const time = usePlaybackController.getState().getTime(slideId)
      let value: import('../../engine/shape').MorphKeyframeValue | null = null
      try {
        value = engine.evaluateMorphValue(target.nodeId, time)
      } catch {
        value = null
      }
      if (!value) {
        try {
          const shapes = engine.getShapes(target.nodeId)
          value = { fromShapeId: shapes[0]?.id ?? null, toShapeId: shapes[1]?.id ?? shapes[0]?.id ?? null, coefficient: 0 }
        } catch {
          value = { fromShapeId: null, toShapeId: null, coefficient: 0 }
        }
      }
      result = dispatch(
        new AddKeyframeCommand({
          target: { kind: 'morph', nodeId: target.nodeId },
          time,
          value: value as unknown as import('../../engine/keyframe').KeyframeValue,
        }),
      )
    } else if ((target.property as unknown as string) === 'visible') {
      const time = usePlaybackController.getState().getTime(slideId)
      const visible = engine.evaluateVisible(target.nodeId, time)
      result = dispatch(
        new AddKeyframeCommand({
          target: { kind: 'visible', nodeId: target.nodeId },
          time,
          value: !visible,
        }),
      )
    } else if (target.property) {
      result = addKeyframeAtPlayhead(engine, dispatch, slideId, target.nodeId, target.property)
    } else if ((target as unknown as { circleProperty?: string }).circleProperty) {
      const circleProperty = (
        target as unknown as {
          circleProperty: import('../../engine/animationProperties').CircleAnimationProperty
        }
      ).circleProperty
      const time = usePlaybackController.getState().getTime(slideId)
      const circle = engine.getNode(target.nodeId).components.circle
      const fallback = circle
        ? ((circle as unknown as Record<string, number>)[circleProperty] ?? 0)
        : 0
      const evaluated = engine.evaluateCircle(target.nodeId, time)
      const value = evaluated
        ? ((evaluated as unknown as Record<string, number>)[circleProperty] ?? fallback)
        : fallback
      result = dispatch(
        new AddKeyframeCommand({
          target: { kind: 'circle', nodeId: target.nodeId, property: circleProperty },
          time,
          value,
        }),
      )
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
    if (target.morph) {
      deleteTarget = { kind: 'morph' as const, nodeId: target.nodeId }
    } else if ((target.property as unknown as string) === 'visible') {
      deleteTarget = { kind: 'visible' as const, nodeId: target.nodeId }
    } else if (target.property) {
      deleteTarget = { kind: 'node' as const, nodeId: target.nodeId, property: target.property }
    } else if ((target as unknown as { circleProperty?: string }).circleProperty) {
      const circleProperty = (
        target as unknown as {
          circleProperty: import('../../engine/animationProperties').CircleAnimationProperty
        }
      ).circleProperty
      deleteTarget = { kind: 'circle' as const, nodeId: target.nodeId, property: circleProperty }
    } else if (target.parameter) {
      deleteTarget = { kind: 'node' as const, nodeId: target.nodeId, parameter: target.parameter }
    } else if (target.label) {
      deleteTarget = { kind: 'dataLabel' as const, nodeId: target.nodeId, label: target.label }
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

  const addToClipFromMenu = () => {
    const target = menu
    setMenu(null)
    if (!target?.keyframeId) {
      return
    }
    const selectedIds = selectedKeyframeIdsOf(useTimelineSelectionStore.getState())
    let extractable: ExtractableKeyframe[] = []
    if (selectedIds.includes(target.keyframeId)) {
      extractable = collectSelectedExtractableKeyframes(engine)
    } else {
      let singleTarget: import('../../engine/keyframeTarget').KeyframeTarget | undefined
      if (target.morph) {
        singleTarget = { kind: 'morph', nodeId: target.nodeId }
      } else if ((target.property as unknown as string) === 'visible') {
        singleTarget = { kind: 'visible', nodeId: target.nodeId }
      } else if (target.property) {
        singleTarget = { kind: 'node', nodeId: target.nodeId, property: target.property }
      } else if ((target as unknown as { circleProperty?: string }).circleProperty) {
        const cp = (
          target as unknown as {
            circleProperty: import('../../engine/animationProperties').CircleAnimationProperty
          }
        ).circleProperty
        singleTarget = { kind: 'circle', nodeId: target.nodeId, property: cp }
      } else if (target.parameter) {
        singleTarget = { kind: 'node', nodeId: target.nodeId, parameter: target.parameter }
      } else if (target.label) {
        singleTarget = { kind: 'dataLabel', nodeId: target.nodeId, label: target.label }
      }
      if (singleTarget) {
        const single = collectExtractableForSingle(engine, singleTarget, target.keyframeId)
        if (single) extractable = [single]
      }
    }
    if (extractable.length === 0) {
      notify(
        'No extractable keyframes for Add to clip (only position/rotation/scale/opacity/visible/circle are supported)',
      )
      return
    }
    setExtraction(extractable)
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
          const ref = keyframeRefs.get(id)
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
    <div className="timeline-body" onPointerMove={recordPointerTime}>
      <div
        className="timeline-tracks"
        ref={tracksRef}
        style={{ width: TRACK_HEADER_WIDTH }}
        onScroll={handleTracksScroll}
      >
        <ul className="timeline-tracks__list" onContextMenu={handleTrackListContextMenu}>
          <li className="timeline-tracks__ruler-spacer" aria-hidden="true" />
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
            ) : row.kind === 'visibleSubtrack' ? (
              <li
                key={`${row.node.id}:visible`}
                className="timeline-subtrack timeline-subtrack--visible"
                data-node-id={row.node.id}
                data-visible="true"
                data-depth={row.depth}
                style={{ paddingLeft: 12 + row.depth * 16 }}
              >
                <span className="timeline-subtrack__label">{VISIBLE_LABEL}</span>
                <button
                  className="timeline-subtrack__add"
                  aria-label={`Add Keyframe to ${VISIBLE_LABEL}`}
                  title="Add hold keyframe at the playhead (toggles visibility)"
                  onClick={() => {
                    const time = usePlaybackController.getState().getTime(slideId)
                    const visible = engine.evaluateVisible(row.node.id, time)
                    const result = dispatch(
                      new AddKeyframeCommand({
                        target: { kind: 'visible', nodeId: row.node.id },
                        time,
                        value: !visible,
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
            ) : row.kind === 'dataLabelSubtrack' ? (
              <li
                key={`${row.node.id}:dataLabel:${row.label}`}
                className="timeline-subtrack"
                data-node-id={row.node.id}
                data-label={row.label}
                data-depth={row.depth}
                style={{ paddingLeft: 12 + row.depth * 16 }}
              >
                <span className="timeline-subtrack__label">{row.label}</span>
                <button
                  className="timeline-subtrack__add"
                  aria-label={`Add Keyframe to ${row.label}`}
                  title="Add keyframe at the playhead"
                  onClick={() => {
                    const time = usePlaybackController.getState().getTime(slideId)
                    const evaluated = engine.evaluateDataLabels(row.node.id, time)
                    const value = evaluated.get(row.label) ?? 0
                    const result = dispatch(
                      new AddKeyframeCommand({
                        target: {
                          kind: 'dataLabel',
                          nodeId: row.node.id,
                          label: row.label,
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
            ) : row.kind === 'morphSubtrack' ? (
              <MorphSubtrackHeader
                key={`${row.node.id}:morph`}
                node={row.node}
                depth={row.depth}
                slideId={slideId}
              />
            ) : row.kind === 'circleSubtrack' ? (
              <li
                key={`${row.node.id}:circle:${row.property}`}
                className="timeline-subtrack"
                data-node-id={row.node.id}
                data-circle-property={row.property}
                data-depth={row.depth}
                style={{ paddingLeft: 12 + row.depth * 16 }}
              >
                <span className="timeline-subtrack__label">{CIRCLE_LABELS[row.property]}</span>
                <button
                  className="timeline-subtrack__add"
                  aria-label={`Add Keyframe to ${CIRCLE_LABELS[row.property]}`}
                  title="Add keyframe at the playhead"
                  onClick={() => {
                    const time = usePlaybackController.getState().getTime(slideId)
                    const circle = engine.getNode(row.node.id).components.circle
                    const evaluated = engine.evaluateCircle(row.node.id, time)
                    const fallback = circle
                      ? ((circle as unknown as Record<string, number>)[row.property] ?? 0)
                      : 0
                    const value = evaluated
                      ? ((evaluated as unknown as Record<string, number>)[row.property] ?? fallback)
                      : fallback
                    const result = dispatch(
                      new AddKeyframeCommand({
                        target: {
                          kind: 'circle',
                          nodeId: row.node.id,
                          property: row.property,
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
                        const previewTime =
                          scalePreview?.get(keyframe.id) ?? dragPreview?.get(keyframe.id)
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
                if (row.kind === 'visibleSubtrack') {
                  const keyframes = engine.getVisibleKeyframes(row.node.id)
                  const sorted = [...keyframes].sort((a, b) => a.time - b.time)
                  return (
                    <div
                      key={`${row.node.id}:visible`}
                      className="timeline-lane-row timeline-lane-row--visible"
                      data-visible="true"
                      style={{ top: index * ROW_HEIGHT }}
                    >
                      {sorted.map((keyframe, idx) => {
                        const next = sorted[idx + 1]
                        const nextTime = next ? next.time : duration
                        const isVisible = keyframe.value as boolean
                        const segmentWidth = (nextTime - keyframe.time) * pps
                        const previewTime =
                          scalePreview?.get(keyframe.id) ?? dragPreview?.get(keyframe.id)
                        const shownTime = previewTime ?? keyframe.time
                        const selected = selectedKeyframeIds.includes(keyframe.id)
                        return (
                          <div
                            key={keyframe.id}
                            style={{
                              position: 'absolute',
                              left: 0,
                              top: 0,
                              right: 0,
                              bottom: 0,
                              pointerEvents: 'none',
                            }}
                          >
                            <div
                              className={`timeline-visible-segment${isVisible ? '' : ' timeline-visible-segment--hidden'}`}
                              data-testid="visible-segment"
                              style={{
                                position: 'absolute',
                                left: keyframe.time * pps,
                                top: 0,
                                width: Math.max(0, segmentWidth),
                                height: '100%',
                                background: isVisible
                                  ? 'rgba(76,175,80,0.18)'
                                  : 'rgba(239,83,80,0.18)',
                                borderTop: `2px solid ${isVisible ? '#4caf50' : '#ef5350'}`,
                                pointerEvents: 'none',
                              }}
                              title={isVisible ? 'Visible (hold)' : 'Hidden (hold)'}
                            />
                            <div
                              className={`timeline-keyframe timeline-keyframe--visible${selected ? ' timeline-keyframe--selected' : ''}`}
                              data-testid="keyframe-marker"
                              data-keyframe-id={keyframe.id}
                              data-visible="true"
                              data-time={String(shownTime)}
                              role="button"
                              aria-label={`Visible ${isVisible ? 'shown' : 'hidden'} at ${tickLabel(shownTime, step)}`}
                              style={{
                                left: shownTime * pps,
                                position: 'absolute',
                                pointerEvents: 'auto',
                              }}
                              onPointerDown={(event) =>
                                handleKeyframePointerDown(event, keyframe, index)
                              }
                              onContextMenu={(event) =>
                                handleKeyframeContextMenu(event, row, keyframe)
                              }
                            />
                          </div>
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
                        const previewTime =
                          scalePreview?.get(keyframe.id) ?? dragPreview?.get(keyframe.id)
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
                if (row.kind === 'dataLabelSubtrack') {
                  const keyframes = engine.getDataLabelKeyframes(row.node.id, row.label)

                  return (
                    <div
                      key={`${row.node.id}:dataLabel:${row.label}`}
                      className="timeline-lane-row"
                      data-label={row.label}
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
                            selected={selected}
                            pps={pps}
                            step={step}
                            parameterLabel={row.label}
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
                if (row.kind === 'circleSubtrack') {
                  const keyframes = engine.getCircleKeyframes(row.node.id, row.property)

                  return (
                    <div
                      key={`${row.node.id}:circle:${row.property}`}
                      className="timeline-lane-row"
                      data-circle-property={row.property}
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
                            selected={selected}
                            pps={pps}
                            step={step}
                            parameterLabel={CIRCLE_LABELS[row.property]}
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
                if (row.kind === 'morphSubtrack') {
                  const keyframes = engine.getMorphKeyframes(row.node.id)
                  return (
                    <div
                      key={`${row.node.id}:morph`}
                      className="timeline-lane-row"
                      data-morph="true"
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
                            selected={selected}
                            pps={pps}
                            step={step}
                            parameterLabel={MORPH_LABEL}
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
            {effectiveSelectionBounds && selectedKeyframeIds.length >= 2 && (
              <SelectionScaleBox
                bounds={{
                  minX: effectiveSelectionBounds.minTime * pps,
                  maxX: effectiveSelectionBounds.maxTime * pps,
                  minY: effectiveSelectionBounds.minRowIndex * ROW_HEIGHT,
                  maxY: (effectiveSelectionBounds.maxRowIndex + 1) * ROW_HEIGHT,
                }}
                onScaleStart={(edge, clientX, isAlt) => {
                  startScale(edge, clientX, isAlt, currentTime)
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
          onAddToClip={addToClipFromMenu}
          onClose={() => setMenu(null)}
        />
      )}
      {extraction && (
        <ClipExtractionModal keyframes={extraction} onClose={() => setExtraction(null)} />
      )}
    </div>
  )
}
