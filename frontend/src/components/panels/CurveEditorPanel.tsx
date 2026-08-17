import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AnimationProperty, Scene } from '../../engine'
import type { KeyframeTangent } from '../../engine/keyframe'
import { ZERO_TANGENT } from '../../engine/keyframe'
import { useEngine, useEngineEvent } from '../../app/useEngine'
import { animatablePropertiesOf } from '../../app/keyframeActions'
import {
  SetKeyframeTangentsCommand,
  MoveKeyframesCommand,
  SetKeyframeValueCommand,
  TransactionCommand,
} from '../../engine/commands'
import type { Command } from '../../engine/commands'
import type { CurveData, CurveViewport } from '../../engine/curveGeometry'
import { computeCurveBounds } from '../../engine/curveGeometry'
import { useCurveEditorViewStore } from '../../stores/curveEditorViewStore'
import {
  useTimelineSelectionStore,
  selectedKeyframeIdsOf,
} from '../../stores/timelineSelectionStore'
import { usePlaybackController } from '../../stores/playbackStore'
import { CurveEditorCanvas } from './CurveEditorCanvas'

const PROPERTY_COLORS: Record<string, string> = {
  positionX: '#4fc3f7',
  positionY: '#81c784',
  rotation: '#ffb74d',
  scaleX: '#e57373',
  scaleY: '#ba68c8',
  opacity: '#fff176',
}

const PROPERTY_LABELS: Record<string, string> = {
  positionX: 'Position X',
  positionY: 'Position Y',
  rotation: 'Rotation',
  scaleX: 'Scale X',
  scaleY: 'Scale Y',
  opacity: 'Opacity',
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

export function CurveEditorPanel({
  slideId,
  duration,
  scene,
  viewportWidth,
}: {
  slideId: string
  duration: number
  scene: Scene
  viewportWidth: number
}) {
  const { engine, dispatch } = useEngine()
  const [, setTick] = useState(0)
  useEngineEvent(() => setTick((t) => t + 1))

  const zoomLevel = useCurveEditorViewStore((s) => s.zoomLevel)
  const scrollX = useCurveEditorViewStore((s) => s.scrollX)
  const scrollY = useCurveEditorViewStore((s) => s.scrollY)
  const filter = useCurveEditorViewStore((s) => s.filter)
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

  const curves = useMemo(() => buildCurves(engine, scene, filter), [engine, scene, filter])

  const canvasContainerRef = useRef<HTMLDivElement>(null)
  const [canvasSize] = useState({ width: viewportWidth - 240, height: 400 })

  const viewport: CurveViewport = useMemo(
    () => ({
      scrollX,
      scrollY,
      zoomLevel,
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      trackHeaderWidth: 0,
    }),
    [scrollX, scrollY, zoomLevel, canvasSize],
  )

  const currentTime = usePlaybackController((state) => state.currentTimes[slideId] ?? 0)

  const handleFitCurves = useCallback(() => {
    const bounds = computeCurveBounds(curves)
    if (!bounds) {
      clearFitPending()
      return
    }

    const timeRange = bounds.maxTime - bounds.minTime
    const valueRange = bounds.maxValue - bounds.minValue
    const padding = 0.1

    const newZoom = Math.min(
      viewportWidth / Math.max(timeRange * (1 + padding * 2), 1),
      canvasSize.height / Math.max(valueRange * (1 + padding * 2), 1),
    )

    const clampedZoom = Math.max(0.25, Math.min(8, newZoom))
    const centerX = (bounds.minTime + bounds.maxTime) / 2
    const centerY = (bounds.minValue + bounds.maxValue) / 2

    useCurveEditorViewStore.getState().setZoom(clampedZoom, viewportWidth / 2, viewportWidth)
    setScroll(centerX - viewportWidth / 2 / clampedZoom, centerY)
    clearFitPending()
  }, [curves, viewportWidth, canvasSize, setScroll, clearFitPending])

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

    const timeRange = maxTime - minTime
    const valueRange = maxValue - minValue
    const padding = 0.2

    const newZoom = Math.min(
      viewportWidth / Math.max(timeRange * (1 + padding * 2), 0.1),
      canvasSize.height / Math.max(valueRange * (1 + padding * 2), 0.1),
    )

    const clampedZoom = Math.max(0.25, Math.min(8, newZoom))
    const centerX = (minTime + maxTime) / 2
    const centerY = (minValue + maxValue) / 2

    useCurveEditorViewStore.getState().setZoom(clampedZoom, viewportWidth / 2, viewportWidth)
    setScroll(centerX - viewportWidth / 2 / clampedZoom, centerY)
    clearFrameSelectedPending()
  }, [
    curves,
    selectedKeyframeIds,
    viewportWidth,
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
      const keyframes = engine.getKeyframes(nodeId, property as AnimationProperty)
      const kf = keyframes.find((k) => k.id === keyframeId)
      if (!kf) return

      const dt = newTime - kf.time
      const dv = newValue - (kf.value as number)

      if (Math.abs(dt) < 1e-9 && Math.abs(dv) < 1e-9) return

      const commands: Command<unknown>[] = []
      if (Math.abs(dt) > 1e-9) {
        commands.push(
          new MoveKeyframesCommand({
            target: { kind: 'node', nodeId, property: property as AnimationProperty },
            moves: [{ keyframeId, newTime: Math.max(0, Math.min(duration, newTime)) }],
          }),
        )
      }
      if (Math.abs(dv) > 1e-9) {
        commands.push(
          new SetKeyframeValueCommand({
            target: { kind: 'node', nodeId, property: property as AnimationProperty },
            keyframeId,
            newValue,
          }),
        )
      }

      if (commands.length === 1) {
        dispatch(commands[0])
      } else if (commands.length > 1) {
        dispatch(new TransactionCommand(commands))
      }
    },
    [engine, dispatch, duration],
  )

  const handleTangentDragStart = useCallback(() => {}, [])

  const handleTangentDrag = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    (
      _keyframeId: string,
      _nodeId: string,
      _property: string,
      _side: 'in' | 'out',
      _newTangent: KeyframeTangent,
      _broken: boolean,
    ) => {
      // Preview handled in canvas
    },
    [],
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
      const keyframes = engine.getKeyframes(nodeId, property as AnimationProperty)
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

      dispatch(
        new SetKeyframeTangentsCommand({
          target: { kind: 'node', nodeId, property: property as AnimationProperty },
          keyframeId,
          tangentIn,
          tangentOut,
        }),
      )
    },
    [engine, dispatch],
  )

  const handleDoubleClickKeyframe = useCallback(
    (keyframeId: string, nodeId: string, property: string) => {
      const keyframes = engine.getKeyframes(nodeId, property as AnimationProperty)
      const kf = keyframes.find((k) => k.id === keyframeId)
      if (!kf) return

      dispatch(
        new SetKeyframeTangentsCommand({
          target: { kind: 'node', nodeId, property: property as AnimationProperty },
          keyframeId,
          tangentIn: ZERO_TANGENT,
          tangentOut: ZERO_TANGENT,
        }),
      )
    },
    [engine, dispatch],
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
    (centerX: number, factor: number) => {
      setZoom(zoomLevel * factor, centerX, viewportWidth)
    },
    [zoomLevel, setZoom, viewportWidth],
  )

  return (
    <div className="curve-editor-panel" style={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <CurveEditorTrackList curves={curves} selectedKeyframeIds={selectedKeyframeIds} />
      <div
        ref={canvasContainerRef}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
      >
        <CurveEditorCanvas
          curves={curves}
          viewport={viewport}
          selectedKeyframeIds={selectedKeyframeIds}
          currentTime={currentTime}
          duration={duration}
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
}: {
  curves: readonly CurveData[]
  selectedKeyframeIds: ReadonlySet<string>
}) {
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
    </div>
  )
}
