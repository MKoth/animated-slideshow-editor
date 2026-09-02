import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnimationProperty, Scene, CircleAnimationProperty } from '../../engine'
import type { KeyframeTangent } from '../../engine/keyframe'
import { ZERO_TANGENT } from '../../engine/keyframe'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { animatablePropertiesOf } from '../../app/keyframeActions'
import { CIRCLE_ANIMATABLE_PROPERTIES } from '../../engine/animationProperties'
import {
  SetKeyframeTangentsCommand,
  MoveKeyframesCommand,
  SetKeyframeValueCommand,
  TransactionCommand,
  MoveClipKeyframesCommand,
  SetClipKeyframeValueCommand,
  SetClipKeyframeTangentsCommand,
  AddClipChannelCommand,
} from '../../engine/commands'
import type { Command } from '../../engine/commands'
import type { ClipDefinition } from '../../engine/clipDefinition'
import type { CurveData, CurveViewport } from '../../engine/curveGeometry'
import { computeCurveBounds } from '../../engine/curveGeometry'
import { snapKeyframeTime } from '../../engine/timelineSnapping'
import { useCurveEditorViewStore } from '../../stores/curveEditorViewStore'
import { useTimelineViewStore } from '../../stores/timelineViewStore'
import {
  useTimelineSelectionStore,
  selectedKeyframeIdsOf,
} from '../../stores/timelineSelectionStore'
import { usePlaybackController } from '../../stores/playbackStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { CurveEditorCanvas } from './CurveEditorCanvas'
import { ParameterPicker } from './ParameterPicker'

const PROPERTY_COLORS: Record<string, string> = {
  positionX: '#4fc3f7',
  positionY: '#81c784',
  rotation: '#ffb74d',
  scaleX: '#e57373',
  scaleY: '#ba68c8',
  opacity: '#fff176',
  radius: '#ff8a65',
  startAngle: '#4db6ac',
  endAngle: '#9575cd',
  segments: '#aed581',
}

const PROPERTY_LABELS: Record<string, string> = {
  positionX: 'Position X',
  positionY: 'Position Y',
  rotation: 'Rotation',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  opacity: 'Opacity',
  radius: 'Radius',
  startAngle: 'Start Angle',
  endAngle: 'End Angle',
  segments: 'Segments',
}

function matchesFilter(property: string, filter: string): boolean {
  if (filter === 'all') return true
  if (filter === 'animatedOnly') return true
  if (filter === 'position') return property === 'positionX' || property === 'positionY'
  if (filter === 'rotation') return property === 'rotation'
  if (filter === 'scale') return property === 'scaleX' || property === 'scaleY'
  if (filter === 'opacity') return property === 'opacity'
  return true
}

function buildCurves(
  engine: ReturnType<typeof useEngine>['engine'],
  scene: Scene,
  filter: string,
): CurveData[] {
  const curves: CurveData[] = []

  const walk = (nodeId: string) => {
    let node
    try {
      node = engine.getNode(nodeId)
    } catch {
      return
    }
    for (const prop of animatablePropertiesOf(node)) {
      if (!matchesFilter(prop, filter)) continue
      const keyframes = engine.getKeyframes(nodeId, prop as AnimationProperty)
      if (keyframes.length > 0) {
        curves.push({
          nodeId,
          property: prop,
          label: PROPERTY_LABELS[prop] ?? prop,
          keyframes,
          color: PROPERTY_COLORS[prop] ?? '#ffffff',
        })
      }
    }
    if (node.components.circle) {
      for (const prop of CIRCLE_ANIMATABLE_PROPERTIES) {
        // show circle curves under 'all' or dedicated 'circle' filter; hide under position/rotation etc
        if (filter !== 'all' && filter !== 'animatedOnly' && filter !== 'circle' && !matchesFilter(prop, filter))
          continue
        const keyframes = engine.getCircleKeyframes(nodeId, prop as CircleAnimationProperty)
        if (keyframes.length > 0) {
          curves.push({
            nodeId,
            property: prop,
            label: PROPERTY_LABELS[prop] ?? prop,
            keyframes,
            color: PROPERTY_COLORS[prop] ?? '#ffffff',
          })
        }
      }
    }
    for (const child of node.children) {
      if (!child.components.camera) {
        walk(child.id)
      }
    }
  }

  walk(scene.root.id)

  if (scene.camera) {
    for (const prop of animatablePropertiesOf(scene.camera)) {
      if (!matchesFilter(prop, filter)) continue
      const keyframes = engine.getKeyframes(scene.camera.id, prop as AnimationProperty)
      if (keyframes.length > 0) {
        curves.push({
          nodeId: scene.camera.id,
          property: prop,
          label: PROPERTY_LABELS[prop] ?? prop,
          keyframes,
          color: PROPERTY_COLORS[prop] ?? '#ffffff',
        })
      }
    }
  }

  return curves
}

function buildClipCurves(
  engine: ReturnType<typeof useEngine>['engine'],
  clip: ClipDefinition,
  filter: string,
): CurveData[] {
  const curves: CurveData[] = []

  for (const channelDef of clip.channels) {
    const prop = channelDef.property
    if (!matchesFilter(prop, filter)) continue
    const keyframes = engine.getClipChannelKeyframes(clip.id, prop)
    if (keyframes.length > 0) {
      curves.push({
        nodeId: clip.id,
        property: prop,
        label: PROPERTY_LABELS[prop] ?? prop,
        keyframes,
        color: PROPERTY_COLORS[prop] ?? '#ffffff',
      })
    }
  }

  return curves
}

const CLIP_TIME_MAX = 1

function effectiveDuration(clip: ClipDefinition | undefined, duration: number): number {
  return clip ? CLIP_TIME_MAX : duration
}

function isCircleProperty(prop: string): boolean {
  return (CIRCLE_ANIMATABLE_PROPERTIES as readonly string[]).includes(prop)
}

function resolveKeyframes(
  engine: ReturnType<typeof useEngine>['engine'],
  clip: ClipDefinition | undefined,
  nodeId: string,
  property: string,
) {
  if (isCircleProperty(property) && !clip) {
    return engine.getCircleKeyframes(nodeId, property as CircleAnimationProperty)
  }
  return clip
    ? engine.getClipChannelKeyframes(clip.id, property as AnimationProperty)
    : engine.getKeyframes(nodeId, property as AnimationProperty)
}

function buildTarget(
  clip: ClipDefinition | undefined,
  nodeId: string,
  property: string,
):
  | { kind: 'clip'; clipId: string; channel: AnimationProperty }
  | { kind: 'node'; nodeId: string; property: AnimationProperty }
  | { kind: 'circle'; nodeId: string; property: CircleAnimationProperty } {
  if (isCircleProperty(property) && !clip) {
    return { kind: 'circle' as const, nodeId, property: property as CircleAnimationProperty }
  }
  return clip
    ? { kind: 'clip' as const, clipId: clip.id, channel: property as AnimationProperty }
    : { kind: 'node' as const, nodeId, property: property as AnimationProperty }
}

function dispatchMoveAndValue(
  dispatch: ReturnType<typeof useEngine>['dispatch'],
  target: ReturnType<typeof buildTarget>,
  keyframeId: string,
  newTime: number,
  newValue: number,
  dt: number,
  dv: number,
) {
  const commands: Command<unknown>[] = []
  if (Math.abs(dt) > 1e-9) {
    const MoveCmd = target.kind === 'clip' ? MoveClipKeyframesCommand : MoveKeyframesCommand
    commands.push(
      new MoveCmd({
        target,
        moves: [{ keyframeId, newTime }],
      } as never),
    )
  }
  if (Math.abs(dv) > 1e-9) {
    const ValueCmd = target.kind === 'clip' ? SetClipKeyframeValueCommand : SetKeyframeValueCommand
    commands.push(
      new ValueCmd({
        target,
        keyframeId,
        newValue,
      } as never),
    )
  }
  if (commands.length === 1) {
    dispatch(commands[0])
  } else if (commands.length > 1) {
    dispatch(new TransactionCommand(commands))
  }
}

function dispatchTangents(
  dispatch: ReturnType<typeof useEngine>['dispatch'],
  target: ReturnType<typeof buildTarget>,
  keyframeId: string,
  tangentIn: KeyframeTangent,
  tangentOut: KeyframeTangent,
) {
  if (target.kind === 'clip') {
    dispatch(
      new SetClipKeyframeTangentsCommand({
        target,
        keyframeId,
        tangentIn,
        tangentOut,
      }),
    )
  } else {
    dispatch(
      new SetKeyframeTangentsCommand({
        target,
        keyframeId,
        tangentIn,
        tangentOut,
      }),
    )
  }
}

export function CurveEditorPanel({
  slideId,
  duration,
  scene,
  viewportWidth,
  clip,
}: {
  slideId: string
  duration: number
  scene: Scene
  viewportWidth: number
  clip?: ClipDefinition
}) {
  const { engine, dispatch } = useEngine()
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((t) => t + 1))

  const zoomX = useCurveEditorViewStore((s) => s.zoomX)
  const zoomY = useCurveEditorViewStore((s) => s.zoomY)
  const scrollX = useCurveEditorViewStore((s) => s.scrollX)
  const scrollY = useCurveEditorViewStore((s) => s.scrollY)
  const filter = useCurveEditorViewStore((s) => s.filter)
  const viewMode = useCurveEditorViewStore((s) => s.viewMode)
  const fitPending = useCurveEditorViewStore((s) => s.fitPending)
  const clearFitPending = useCurveEditorViewStore((s) => s.clearFitPending)
  const frameSelectedPending = useCurveEditorViewStore((s) => s.frameSelectedPending)
  const clearFrameSelectedPending = useCurveEditorViewStore((s) => s.clearFrameSelectedPending)
  const setZoom = useCurveEditorViewStore((s) => s.setZoom)
  const setScroll = useCurveEditorViewStore((s) => s.setScroll)
  const pan = useCurveEditorViewStore((s) => s.pan)

  const timelineSelection = useTimelineSelectionStore()
  const selectedKeyframeIds = useMemo(
    () => new Set(selectedKeyframeIdsOf(timelineSelection)),
    [timelineSelection],
  )

  const curves = useMemo(
    () => (clip ? buildClipCurves(engine, clip, filter) : buildCurves(engine, scene, filter)),
    [engine, scene, clip, filter],
  )

  const [tangentPreview, setTangentPreview] = useState<
    Map<string, { tangentIn: KeyframeTangent; tangentOut: KeyframeTangent }>
  >(new Map())

  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const [canvasSize, setCanvasSize] = useState({
    width: Math.max(200, viewportWidth - 240),
    height: 400,
  })

  const viewport: CurveViewport = useMemo(
    () => ({
      scrollX,
      scrollY,
      zoomX,
      zoomY,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
    }),
    [scrollX, scrollY, zoomX, zoomY, canvasSize],
  )

  const currentTime = usePlaybackController((state) => state.currentTimes[slideId] ?? 0)

  const hasKeyframes = curves.some((c) => c.keyframes.length > 0)
  const prevHasKeyframesRef = useRef(false)
  const prevCanvasSizeRef = useRef(canvasSize)
  const hasRealSizeRef = useRef(false)
  const suppressAutoFitRef = useRef(false)
  const prevViewModeRef = useRef(viewMode)

  useEffect(() => {
    if (viewMode === 'curveEditor' && prevViewModeRef.current !== 'curveEditor') {
      suppressAutoFitRef.current = true
    }
    prevViewModeRef.current = viewMode
  }, [viewMode])

  useEffect(() => {
    const el = canvasContainerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setCanvasSize({ width, height })
          if (!hasRealSizeRef.current) {
            hasRealSizeRef.current = true
          }
        }
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (suppressAutoFitRef.current) {
      suppressAutoFitRef.current = false
      prevHasKeyframesRef.current = hasKeyframes
      prevCanvasSizeRef.current = canvasSize
      return
    }
    if (!hasRealSizeRef.current) return
    const curvesAppeared = hasKeyframes && !prevHasKeyframesRef.current
    const sizeChanged =
      canvasSize.width !== prevCanvasSizeRef.current.width ||
      canvasSize.height !== prevCanvasSizeRef.current.height
    prevHasKeyframesRef.current = hasKeyframes
    prevCanvasSizeRef.current = canvasSize

    if (curvesAppeared || (sizeChanged && hasKeyframes)) {
      useCurveEditorViewStore.getState().fitCurves()
    }
  }, [hasKeyframes, canvasSize])

  const handleFitCurves = useCallback(() => {
    const el = canvasContainerRef.current
    const rect = el?.getBoundingClientRect()
    const cw = rect && rect.width > 0 ? rect.width : canvasSize.width
    const ch = rect && rect.height > 0 ? rect.height : canvasSize.height
    const bounds = computeCurveBounds(curves)
    if (!bounds) {
      clearFitPending()
      return
    }

    const timeRange = bounds.maxTime - bounds.minTime
    const valueRange = bounds.maxValue - bounds.minValue
    const padding = 0.1

    const newZoomX = cw / Math.max(timeRange * (1 + padding * 2), 1)
    const newZoomY = ch / Math.max(valueRange * (1 + padding * 2), 1)
    const centerX = (bounds.minTime + bounds.maxTime) / 2
    const centerY = (bounds.minValue + bounds.maxValue) / 2

    useCurveEditorViewStore.getState().setZoom(newZoomX, newZoomY)
    setScroll(centerX - cw / 2 / newZoomX, centerY)
    clearFitPending()
  }, [curves, canvasSize, setScroll, clearFitPending])

  const handleFrameSelected = useCallback(() => {
    if (selectedKeyframeIds.size === 0) {
      handleFitCurves()
      return
    }

    let minTime = Number.POSITIVE_INFINITY
    let maxTime = Number.NEGATIVE_INFINITY
    let minValue = Number.POSITIVE_INFINITY
    let maxValue = Number.NEGATIVE_INFINITY

    for (const curve of curves) {
      for (const kf of curve.keyframes) {
        if (selectedKeyframeIds.has(kf.id)) {
          const val = kf.value as number
          if (kf.time < minTime) minTime = kf.time
          if (kf.time > maxTime) maxTime = kf.time
          if (val < minValue) minValue = val
          if (val > maxValue) maxValue = val
        }
      }
    }

    if (!Number.isFinite(minTime)) {
      handleFitCurves()
      return
    }

    const el = canvasContainerRef.current
    const rect = el?.getBoundingClientRect()
    const cw = rect && rect.width > 0 ? rect.width : canvasSize.width
    const ch = rect && rect.height > 0 ? rect.height : canvasSize.height

    const timeRange = maxTime - minTime
    const valueRange = maxValue - minValue
    const padding = 0.2

    const newZoomX = cw / Math.max(timeRange * (1 + padding * 2), 0.1)
    const newZoomY = ch / Math.max(valueRange * (1 + padding * 2), 0.1)
    const centerX = (minTime + maxTime) / 2
    const centerY = (minValue + maxValue) / 2

    useCurveEditorViewStore.getState().setZoom(newZoomX, newZoomY)
    setScroll(centerX - cw / 2 / newZoomX, centerY)
    clearFrameSelectedPending()
  }, [
    curves,
    selectedKeyframeIds,
    canvasSize,
    handleFitCurves,
    setScroll,
    clearFrameSelectedPending,
  ])

  useEffect(() => {
    if (fitPending) {
      handleFitCurves()
    }
  }, [fitPending, handleFitCurves])

  useEffect(() => {
    if (frameSelectedPending) {
      handleFrameSelected()
    }
  }, [frameSelectedPending, handleFrameSelected])

  const handleKeyframeSelect = useCallback(
    (keyframeId: string, _nodeId: string, _property: string, meta?: boolean) => {
      const store = useTimelineSelectionStore.getState()
      if (meta) {
        store.toggleKeyframe(keyframeId, { time: 0, rowIndex: 0 })
      } else {
        store.selectKeyframe(keyframeId, { time: 0, rowIndex: 0 })
      }
    },
    [],
  )

  const handleKeyframeDragStart = useCallback(() => {}, [])
  const handleKeyframeDragEnd = useCallback(() => {}, [])

  const handleKeyframeDrag = useCallback(
    (keyframeId: string, nodeId: string, property: string, newTime: number, newValue: number) => {
      const candidateTimes: number[] = []
      for (const curve of curves) {
        for (const kf of curve.keyframes) {
          if (kf.id !== keyframeId) {
            candidateTimes.push(kf.time)
          }
        }
      }

      const viewState = useTimelineViewStore.getState()
      const pps = zoomX
      const snappedTime = snapKeyframeTime(newTime, {
        gridEnabled: viewState.gridSnapEnabled,
        keyframesEnabled: viewState.snapToKeyframesEnabled,
        candidateTimes,
        pps,
      })

      const maxTime = effectiveDuration(clip, duration)
      const clampedTime = Math.max(0, Math.min(maxTime, snappedTime))

      const keyframes = resolveKeyframes(engine, clip, nodeId, property)
      const kf = keyframes.find((k) => k.id === keyframeId)
      if (!kf) return

      const dt = clampedTime - kf.time
      const dv = newValue - (kf.value as number)

      if (Math.abs(dt) < 1e-9 && Math.abs(dv) < 1e-9) return

      dispatchMoveAndValue(
        dispatch,
        buildTarget(clip, nodeId, property),
        keyframeId,
        clampedTime,
        newValue,
        dt,
        dv,
      )
    },
    [engine, dispatch, duration, curves, zoomX, clip],
  )

  const handleTangentDragStart = useCallback(() => {}, [])

  const handleTangentDrag = useCallback(
    (
      keyframeId: string,
      nodeId: string,
      property: string,
      side: 'in' | 'out',
      newTangent: KeyframeTangent,
      broken: boolean,
    ) => {
      const keyframes = resolveKeyframes(engine, clip, nodeId, property)
      const kf = keyframes.find((k) => k.id === keyframeId)
      if (!kf) return

      let tangentIn = kf.tangentIn
      let tangentOut = kf.tangentOut

      if (side === 'in') {
        tangentIn = newTangent
        if (!broken) {
          tangentOut = { time: -newTangent.time, value: -newTangent.value }
        }
      } else {
        tangentOut = newTangent
        if (!broken) {
          tangentIn = { time: -newTangent.time, value: -newTangent.value }
        }
      }

      setTangentPreview((prev) => {
        const next = new Map(prev)
        next.set(keyframeId, { tangentIn, tangentOut })
        return next
      })
    },
    [engine, clip],
  )

  const handleTangentDragEnd = useCallback(
    (
      keyframeId: string,
      nodeId: string,
      property: string,
      side: 'in' | 'out',
      newTangent: KeyframeTangent,
      broken: boolean,
    ) => {
      setTangentPreview(new Map())

      const keyframes = resolveKeyframes(engine, clip, nodeId, property)
      const kf = keyframes.find((k) => k.id === keyframeId)
      if (!kf) return

      let tangentIn = kf.tangentIn
      let tangentOut = kf.tangentOut

      if (side === 'in') {
        tangentIn = newTangent
        if (!broken) {
          tangentOut = { time: -newTangent.time, value: -newTangent.value }
        }
      } else {
        tangentOut = newTangent
        if (!broken) {
          tangentIn = { time: -newTangent.time, value: -newTangent.value }
        }
      }

      const sameIn =
        Math.abs(tangentIn.time - kf.tangentIn.time) < 1e-9 &&
        Math.abs(tangentIn.value - kf.tangentIn.value) < 1e-9
      const sameOut =
        Math.abs(tangentOut.time - kf.tangentOut.time) < 1e-9 &&
        Math.abs(tangentOut.value - kf.tangentOut.value) < 1e-9

      if (sameIn && sameOut) return

      dispatchTangents(
        dispatch,
        buildTarget(clip, nodeId, property),
        keyframeId,
        tangentIn,
        tangentOut,
      )
    },
    [engine, dispatch, clip],
  )

  const handleDoubleClickKeyframe = useCallback(
    (keyframeId: string, nodeId: string, property: string) => {
      dispatchTangents(
        dispatch,
        buildTarget(clip, nodeId, property),
        keyframeId,
        ZERO_TANGENT,
        ZERO_TANGENT,
      )
    },
    [dispatch, clip],
  )

  const handleMarqueeSelect = useCallback((keyframeIds: readonly string[]) => {
    const store = useTimelineSelectionStore.getState()
    if (keyframeIds.length === 0) {
      store.clearSelection()
    } else {
      store.marqueeEnd(keyframeIds, [])
    }
  }, [])

  const handlePan = useCallback(
    (dx: number, dy: number) => {
      pan(dx, dy)
    },
    [pan],
  )

  const handleZoom = useCallback(
    (centerX: number, centerY: number, factorX: number, factorY: number) => {
      const newZoomX = zoomX * factorX
      const newZoomY = zoomY * factorY
      const newScrollX = scrollX + (centerX / zoomX) * (1 - 1 / factorX)
      const newScrollY = scrollY - ((centerY - canvasSize.height / 2) / zoomY) * (1 - 1 / factorY)
      setZoom(newZoomX, newZoomY)
      setScroll(newScrollX, newScrollY)
    },
    [zoomX, zoomY, scrollX, scrollY, canvasSize.height, setZoom, setScroll],
  )

  return (
    <div className="curve-editor-panel" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <CurveEditorTrackList
        curves={curves}
        selectedKeyframeIds={selectedKeyframeIds}
        clip={clip}
        dispatch={dispatch}
      />
      <div
        ref={canvasContainerRef}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <CurveEditorCanvas
          curves={curves}
          viewport={viewport}
          selectedKeyframeIds={selectedKeyframeIds}
          tangentPreview={tangentPreview}
          currentTime={currentTime}
          duration={effectiveDuration(clip, duration)}
          onKeyframeSelect={handleKeyframeSelect}
          onKeyframeDrag={handleKeyframeDrag}
          onKeyframeDragStart={handleKeyframeDragStart}
          onKeyframeDragEnd={handleKeyframeDragEnd}
          onTangentDrag={handleTangentDrag}
          onTangentDragStart={handleTangentDragStart}
          onTangentDragEnd={handleTangentDragEnd}
          onDoubleClickKeyframe={handleDoubleClickKeyframe}
          onMarqueeSelect={handleMarqueeSelect}
          onPan={handlePan}
          onZoom={handleZoom}
        />
      </div>
    </div>
  )
}

function CurveEditorTrackList({
  curves,
  selectedKeyframeIds,
  clip,
  dispatch,
}: {
  curves: readonly CurveData[]
  selectedKeyframeIds: ReadonlySet<string>
  clip?: ClipDefinition
  dispatch: ReturnType<typeof useEngine>['dispatch']
}) {
  const notify = useNotificationStore((state) => state.notify)
  const [pickerOpen, setPickerOpen] = useState(false)
  const selectedNodeId = useSelectionStore((state) => state.selectedIds[0])
  const engine = useEngine().engine

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
      if (!clip) return
      setPickerOpen(false)
      const result = dispatch(
        new AddClipChannelCommand({
          clipId: clip.id,
          channel: { property },
        }),
      )
      if (!result.ok) {
        notify(result.error.message)
      }
    },
    [clip, dispatch, notify],
  )

  return (
    <div
      className="curve-editor-track-list"
      style={{
        width: 200,
        flexShrink: 0,
        borderRight: '1px solid var(--color-border)',
        background: 'var(--color-bg-panel)',
        overflowY: 'auto',
      }}
    >
      {curves.map((curve) => {
        const hasSelection = curve.keyframes.some((kf) => selectedKeyframeIds.has(kf.id))
        return (
          <div
            key={`${curve.nodeId}-${curve.property}`}
            className="curve-editor-track-item"
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '4px 8px',
              gap: 6,
              borderBottom: '1px solid var(--color-border)',
              background: hasSelection ? 'var(--color-bg-elevated)' : undefined,
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: curve.color,
                flexShrink: 0,
              }}
            />
            <span
              style={{
                fontSize: 12,
                color: 'var(--color-text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {curve.label}
            </span>
          </div>
        )
      })}
      {clip && (
        <div style={{ position: 'relative', borderBottom: '1px solid var(--color-border)' }}>
          <button
            className="curve-editor-track-item"
            data-testid="curve-editor-add-channel"
            onClick={() => setPickerOpen(!pickerOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '4px 8px',
              gap: 6,
              width: '100%',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 12,
              color: 'var(--color-text-muted)',
              textAlign: 'left',
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
        </div>
      )}
    </div>
  )
}
