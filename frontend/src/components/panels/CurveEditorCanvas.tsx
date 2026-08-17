import { useCallback, useEffect, useRef, useState } from 'react'
import type { Keyframe } from '../../engine'
import type { KeyframeTangent } from '../../engine/keyframe'
import type { CurveData, CurveViewport } from '../../engine/curveGeometry'
import {
  worldToScreen,
  screenToWorld,
  computeCurvePoints,
  computeTangentHandlePositions,
  hitTestKeyframe,
  hitTestTangentHandle,
  CURVE_LINE_WIDTH,
  TANGENT_HANDLE_SIZE,
} from '../../engine/curveGeometry'
import { rulerTickStep, tickLabel } from '../../stores/timelineViewStore'

export interface CurveEditorCanvasProps {
  readonly curves: readonly CurveData[]
  readonly viewport: CurveViewport
  readonly selectedKeyframeIds: ReadonlySet<string>
  readonly tangentPreview: ReadonlyMap<
    string,
    { tangentIn: KeyframeTangent; tangentOut: KeyframeTangent }
  >
  readonly currentTime: number
  readonly duration: number
  readonly onKeyframeSelect: (
    keyframeId: string,
    nodeId: string,
    property: string,
    meta?: boolean,
  ) => void
  readonly onKeyframeDrag: (
    keyframeId: string,
    nodeId: string,
    property: string,
    newTime: number,
    newValue: number,
  ) => void
  readonly onKeyframeDragStart: () => void
  readonly onKeyframeDragEnd: () => void
  readonly onTangentDrag: (
    keyframeId: string,
    nodeId: string,
    property: string,
    side: 'in' | 'out',
    newTangent: KeyframeTangent,
    broken: boolean,
  ) => void
  readonly onTangentDragStart: () => void
  readonly onTangentDragEnd: (
    keyframeId: string,
    nodeId: string,
    property: string,
    side: 'in' | 'out',
    newTangent: KeyframeTangent,
    broken: boolean,
  ) => void
  readonly onDoubleClickKeyframe: (keyframeId: string, nodeId: string, property: string) => void
  readonly onMarqueeSelect: (keyframeIds: readonly string[]) => void
  readonly onPan: (dx: number, dy: number) => void
  readonly onZoom: (centerX: number, centerY: number, factorX: number, factorY: number) => void
}

const KEYFRAME_RADIUS = 5
const TANGENT_LINE_COLOR = '#888888'
const PLAYHEAD_COLOR = '#e53935'
const BG_COLOR = '#1e1e1e'
const MARQUEE_COLOR = 'rgba(59, 130, 246, 0.15)'
const MARQUEE_BORDER = 'rgba(59, 130, 246, 0.8)'

interface DragState {
  readonly kind: 'keyframe' | 'tangent' | 'pan' | 'marquee'
  readonly keyframeId?: string
  readonly nodeId?: string
  readonly property?: string
  readonly tangentSide?: 'in' | 'out'
  readonly startX: number
  readonly startY: number
  readonly startTime?: number
  readonly startValue?: number
  readonly startScrollX?: number
  readonly startScrollY?: number
  readonly broken?: boolean
}

export function CurveEditorCanvas({
  curves,
  viewport,
  selectedKeyframeIds,
  tangentPreview,
  currentTime,
  duration,
  onKeyframeSelect,
  onKeyframeDrag,
  onKeyframeDragStart,
  onKeyframeDragEnd,
  onTangentDrag,
  onTangentDragStart,
  onTangentDragEnd,
  onDoubleClickKeyframe,
  onMarqueeSelect,
  onPan,
  onZoom,
}: CurveEditorCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const spaceHeldRef = useRef(false)
  const animFrameRef = useRef<number>(0)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    if (
      canvas.width !== Math.round(rect.width * dpr) ||
      canvas.height !== Math.round(rect.height * dpr)
    ) {
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      ctx.scale(dpr, dpr)
    }

    const w = rect.width
    const h = rect.height
    const vp: CurveViewport = { ...viewport, canvasWidth: w, canvasHeight: h }

    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = BG_COLOR
    ctx.fillRect(0, 0, w, h)

    drawGrid(ctx, vp, w, h)
    drawCurves(ctx, curves, vp, selectedKeyframeIds)
    drawKeyframes(ctx, curves, vp, selectedKeyframeIds)
    drawTangentHandles(ctx, curves, vp, selectedKeyframeIds, tangentPreview)
    drawPlayhead(ctx, vp, currentTime, h)

    if (marqueeRect) {
      drawMarquee(ctx, marqueeRect)
    }
  }, [curves, viewport, selectedKeyframeIds, tangentPreview, currentTime, marqueeRect])

  const drawRef = useRef(draw)
  useEffect(() => {
    drawRef.current = draw
  })

  useEffect(() => {
    animFrameRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [draw])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        spaceHeldRef.current = true
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceHeldRef.current = false
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  const getCanvasPoint = useCallback(
    (e: React.PointerEvent | PointerEvent): { x: number; y: number } => {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    },
    [],
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 1 || spaceHeldRef.current) {
        e.preventDefault()
        const point = getCanvasPoint(e)
        const state: DragState = {
          kind: 'pan',
          startX: point.x,
          startY: point.y,
          startScrollX: viewport.scrollX,
          startScrollY: viewport.scrollY,
        }
        setDragState(state)
        return
      }

      if (e.button !== 0) return

      const point = getCanvasPoint(e)
      const w = canvasRef.current?.getBoundingClientRect().width ?? viewport.canvasWidth
      const h = canvasRef.current?.getBoundingClientRect().height ?? viewport.canvasHeight
      const vp: CurveViewport = { ...viewport, canvasWidth: w, canvasHeight: h }

      for (const curve of curves) {
        for (const kf of curve.keyframes) {
          const tangentHit = hitTestTangentHandle(point.x, point.y, kf, vp)
          if (tangentHit) {
            e.preventDefault()
            onTangentDragStart()
            setDragState({
              kind: 'tangent',
              keyframeId: kf.id,
              nodeId: curve.nodeId,
              property: curve.property,
              tangentSide: tangentHit,
              startX: point.x,
              startY: point.y,
              broken: e.altKey,
            })
            return
          }
        }
      }

      for (const curve of curves) {
        const hitId = hitTestKeyframe(point.x, point.y, curve.keyframes, vp)
        if (hitId) {
          e.preventDefault()
          const isMeta = e.metaKey || e.ctrlKey
          if (e.shiftKey) {
            onKeyframeSelect(hitId, curve.nodeId, curve.property, true)
          } else if (!selectedKeyframeIds.has(hitId) && !isMeta) {
            onKeyframeSelect(hitId, curve.nodeId, curve.property)
          }
          const kf = curve.keyframes.find((k) => k.id === hitId)
          onKeyframeDragStart()
          setDragState({
            kind: 'keyframe',
            keyframeId: hitId,
            nodeId: curve.nodeId,
            property: curve.property,
            startX: point.x,
            startY: point.y,
            startTime: kf?.time ?? 0,
            startValue: (kf?.value as number) ?? 0,
          })
          return
        }
      }

      onMarqueeSelect([])
      setDragState({
        kind: 'marquee',
        startX: point.x,
        startY: point.y,
        startScrollX: viewport.scrollX,
        startScrollY: viewport.scrollY,
      })
      setMarqueeRect(null)
    },
    [
      curves,
      viewport,
      selectedKeyframeIds,
      getCanvasPoint,
      onKeyframeSelect,
      onKeyframeDragStart,
      onTangentDragStart,
      onMarqueeSelect,
    ],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState) return

      const point = getCanvasPoint(e)
      const w = canvasRef.current?.getBoundingClientRect().width ?? viewport.canvasWidth
      const h = canvasRef.current?.getBoundingClientRect().height ?? viewport.canvasHeight
      const vp: CurveViewport = { ...viewport, canvasWidth: w, canvasHeight: h }

      if (dragState.kind === 'pan') {
        const dx = -(point.x - dragState.startX) / viewport.zoomX
        const dy = (point.y - dragState.startY) / viewport.zoomY
        onPan(
          (dragState.startScrollX ?? viewport.scrollX) + dx - viewport.scrollX,
          (dragState.startScrollY ?? viewport.scrollY) + dy - viewport.scrollY,
        )
        return
      }

      if (dragState.kind === 'marquee') {
        const left = Math.min(dragState.startX, point.x)
        const top = Math.min(dragState.startY, point.y)
        const width = Math.abs(point.x - dragState.startX)
        const height = Math.abs(point.y - dragState.startY)
        setMarqueeRect({ x: left, y: top, width, height })
        return
      }

      if (
        dragState.kind === 'keyframe' &&
        dragState.keyframeId &&
        dragState.nodeId &&
        dragState.property
      ) {
        const dx = (point.x - dragState.startX) / viewport.zoomX
        const dy = -(point.y - dragState.startY) / viewport.zoomY
        onKeyframeDrag(
          dragState.keyframeId,
          dragState.nodeId,
          dragState.property,
          Math.max(0, Math.min(duration, (dragState.startTime ?? 0) + dx)),
          (dragState.startValue ?? 0) + dy,
        )
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = requestAnimationFrame(drawRef.current)
        return
      }

      if (
        dragState.kind === 'tangent' &&
        dragState.keyframeId &&
        dragState.nodeId &&
        dragState.property
      ) {
        const curve = curves.find(
          (c) => c.nodeId === dragState.nodeId && c.property === dragState.property,
        )
        if (curve) {
          const kf = curve.keyframes.find((k) => k.id === dragState.keyframeId)
          if (kf) {
            const kfScreen = worldToScreen(kf.time, kf.value as number, vp)
            const dx = (point.x - kfScreen.x) / viewport.zoomX
            const dy = -(point.y - kfScreen.y) / viewport.zoomY

            onTangentDrag(
              dragState.keyframeId,
              dragState.nodeId,
              dragState.property,
              dragState.tangentSide!,
              { time: dx, value: dy },
              dragState.broken ?? e.altKey,
            )
          }
        }
        cancelAnimationFrame(animFrameRef.current)
        animFrameRef.current = requestAnimationFrame(drawRef.current)
        return
      }
    },
    [dragState, curves, viewport, getCanvasPoint, onPan, onKeyframeDrag, onTangentDrag, duration],
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState) return

      if (dragState.kind === 'marquee' && marqueeRect) {
        const w = canvasRef.current?.getBoundingClientRect().width ?? viewport.canvasWidth
        const h = canvasRef.current?.getBoundingClientRect().height ?? viewport.canvasHeight
        const vp: CurveViewport = { ...viewport, canvasWidth: w, canvasHeight: h }
        const intersecting: string[] = []
        for (const curve of curves) {
          for (const kf of curve.keyframes) {
            const screen = worldToScreen(kf.time, kf.value as number, vp)
            if (
              screen.x >= marqueeRect.x &&
              screen.x <= marqueeRect.x + marqueeRect.width &&
              screen.y >= marqueeRect.y &&
              screen.y <= marqueeRect.y + marqueeRect.height
            ) {
              intersecting.push(kf.id)
            }
          }
        }
        onMarqueeSelect(intersecting)
      }

      if (
        dragState.kind === 'tangent' &&
        dragState.keyframeId &&
        dragState.nodeId &&
        dragState.property
      ) {
        const curve = curves.find(
          (c) => c.nodeId === dragState.nodeId && c.property === dragState.property,
        )
        if (curve) {
          const kf = curve.keyframes.find((k) => k.id === dragState.keyframeId)
          if (kf) {
            const w = canvasRef.current?.getBoundingClientRect().width ?? viewport.canvasWidth
            const h = canvasRef.current?.getBoundingClientRect().height ?? viewport.canvasHeight
            const vp: CurveViewport = { ...viewport, canvasWidth: w, canvasHeight: h }
            const kfScreen = worldToScreen(kf.time, kf.value as number, vp)
            const point = getCanvasPoint(e)
            const dx = (point.x - kfScreen.x) / viewport.zoomX
            const dy = -(point.y - kfScreen.y) / viewport.zoomY

            onTangentDragEnd(
              dragState.keyframeId,
              dragState.nodeId,
              dragState.property,
              dragState.tangentSide!,
              { time: dx, value: dy },
              dragState.broken ?? e.altKey,
            )
          }
        }
      }

      if (dragState.kind === 'keyframe') {
        onKeyframeDragEnd()
      }

      setDragState(null)
      setMarqueeRect(null)
    },
    [
      dragState,
      curves,
      viewport,
      marqueeRect,
      getCanvasPoint,
      onKeyframeDragEnd,
      onTangentDragEnd,
      onMarqueeSelect,
    ],
  )

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      const point = { x: rect ? e.clientX - rect.left : 0, y: rect ? e.clientY - rect.top : 0 }
      const w = rect?.width ?? viewport.canvasWidth
      const h = rect?.height ?? viewport.canvasHeight
      const vp: CurveViewport = { ...viewport, canvasWidth: w, canvasHeight: h }

      for (const curve of curves) {
        const hitId = hitTestKeyframe(point.x, point.y, curve.keyframes, vp)
        if (hitId) {
          onDoubleClickKeyframe(hitId, curve.nodeId, curve.property)
          return
        }
      }
    },
    [curves, viewport, onDoubleClickKeyframe],
  )

  const onZoomRef = useRef(onZoom)
  useEffect(() => {
    onZoomRef.current = onZoom
  })

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const centerX = e.clientX - rect.left
        const centerY = e.clientY - rect.top
        const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2
        onZoomRef.current(centerX, centerY, factor, factor)
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  return (
    <div
      ref={containerRef}
      className="curve-editor-canvas-container"
      style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
    >
      <canvas
        ref={canvasRef}
        className="curve-editor-canvas"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: dragState?.kind === 'pan' ? 'grabbing' : 'crosshair',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  )
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  viewport: CurveViewport,
  w: number,
  h: number,
): void {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  const minorColor = isDark ? '#2a2d34' : '#e8e8e8'
  const majorColor = isDark ? '#3a3e47' : '#d0d0d0'
  const axisColor = isDark ? '#555' : '#999'

  const worldTop = screenToWorld(0, 0, viewport).value
  const worldBottom = screenToWorld(0, h, viewport).value

  let gridStep = 1
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]
  for (const s of steps) {
    if (s * viewport.zoomY >= 40) {
      gridStep = s
      break
    }
  }

  const firstValue = Math.ceil(worldTop / gridStep) * gridStep
  for (let v = firstValue; v <= worldBottom; v += gridStep) {
    const screen = worldToScreen(0, v, viewport)
    const y = screen.y
    if (y < 0 || y > h) continue
    ctx.strokeStyle = Math.abs(v) < 1e-9 ? axisColor : minorColor
    ctx.lineWidth = Math.abs(v) < 1e-9 ? 1.5 : 0.5
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }

  const timeLeft = screenToWorld(0, 0, viewport).time
  const timeRight = screenToWorld(w, 0, viewport).time

  const timeStep = rulerTickStep(viewport.zoomX)

  const firstTime = Math.ceil(timeLeft / timeStep) * timeStep
  ctx.font = '10px monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (let t = firstTime; t <= timeRight; t += timeStep) {
    const screen = worldToScreen(t, 0, viewport)
    const x = screen.x
    if (x < 0 || x > w) continue
    const isMajor = Math.abs(t % (timeStep * 5)) < 1e-9 || Math.abs(t) < 1e-9
    ctx.strokeStyle = isMajor ? majorColor : minorColor
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
    ctx.fillStyle = isMajor ? majorColor : minorColor
    ctx.fillText(tickLabel(t, timeStep), x, 4)
  }
}

function drawCurves(
  ctx: CanvasRenderingContext2D,
  curves: readonly CurveData[],
  viewport: CurveViewport,
  selectedKeyframeIds: ReadonlySet<string>,
): void {
  for (const curve of curves) {
    const points = computeCurvePoints(curve, viewport)
    if (points.length < 2) continue

    const hasSelection = curve.keyframes.some((kf) => selectedKeyframeIds.has(kf.id))
    const alpha = hasSelection ? 1.0 : 0.7

    ctx.strokeStyle = curve.color
    ctx.globalAlpha = alpha
    ctx.lineWidth = CURVE_LINE_WIDTH
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(points[0].x, points[0].y)
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y)
    }
    ctx.stroke()
    ctx.globalAlpha = 1.0
  }
}

function drawKeyframes(
  ctx: CanvasRenderingContext2D,
  curves: readonly CurveData[],
  viewport: CurveViewport,
  selectedKeyframeIds: ReadonlySet<string>,
): void {
  ctx.font = '10px monospace'
  for (const curve of curves) {
    for (const kf of curve.keyframes) {
      const screen = worldToScreen(kf.time, kf.value as number, viewport)
      const selected = selectedKeyframeIds.has(kf.id)

      ctx.beginPath()
      ctx.arc(screen.x, screen.y, KEYFRAME_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = selected ? '#ffffff' : curve.color
      ctx.fill()
      ctx.strokeStyle = selected ? curve.color : '#000000'
      ctx.lineWidth = selected ? 2 : 1
      ctx.stroke()

      const val = typeof kf.value === 'number' ? kf.value.toFixed(1) : String(kf.value)
      const label = `${val}`
      ctx.fillStyle = '#ffffff'
      ctx.fillText(label, screen.x + 8, screen.y - 8)
    }
  }
}

function drawTangentHandles(
  ctx: CanvasRenderingContext2D,
  curves: readonly CurveData[],
  viewport: CurveViewport,
  selectedKeyframeIds: ReadonlySet<string>,
  tangentPreview: ReadonlyMap<string, { tangentIn: KeyframeTangent; tangentOut: KeyframeTangent }>,
): void {
  for (const curve of curves) {
    for (const kf of curve.keyframes) {
      if (!selectedKeyframeIds.has(kf.id)) continue
      if (kf.interpolation !== 'bezier') continue

      const preview = tangentPreview.get(kf.id)
      const kfForHandles = (
        preview ? { ...kf, tangentIn: preview.tangentIn, tangentOut: preview.tangentOut } : kf
      ) as Keyframe
      const handles = computeTangentHandlePositions(kfForHandles, viewport)
      if (!handles) continue

      const kfScreen = worldToScreen(kf.time, kf.value as number, viewport)

      ctx.strokeStyle = TANGENT_LINE_COLOR
      ctx.lineWidth = 1

      if (handles.in) {
        ctx.beginPath()
        ctx.moveTo(kfScreen.x, kfScreen.y)
        ctx.lineTo(handles.in.x, handles.in.y)
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(handles.in.x, handles.in.y, TANGENT_HANDLE_SIZE / 2, 0, Math.PI * 2)
        ctx.fillStyle = '#aaaaaa'
        ctx.fill()
        ctx.strokeStyle = '#666666'
        ctx.lineWidth = 1
        ctx.stroke()
      }

      if (handles.out) {
        ctx.beginPath()
        ctx.moveTo(kfScreen.x, kfScreen.y)
        ctx.lineTo(handles.out.x, handles.out.y)
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(handles.out.x, handles.out.y, TANGENT_HANDLE_SIZE / 2, 0, Math.PI * 2)
        ctx.fillStyle = '#aaaaaa'
        ctx.fill()
        ctx.strokeStyle = '#666666'
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }
  }
}

function drawPlayhead(
  ctx: CanvasRenderingContext2D,
  viewport: CurveViewport,
  time: number,
  h: number,
): void {
  const screen = worldToScreen(time, 0, viewport)
  const x = screen.x

  ctx.strokeStyle = PLAYHEAD_COLOR
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x, 0)
  ctx.lineTo(x, h)
  ctx.stroke()

  ctx.fillStyle = PLAYHEAD_COLOR
  ctx.beginPath()
  ctx.moveTo(x - 5, 0)
  ctx.lineTo(x + 5, 0)
  ctx.lineTo(x, 6)
  ctx.closePath()
  ctx.fill()
}

function drawMarquee(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
): void {
  ctx.fillStyle = MARQUEE_COLOR
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.strokeStyle = MARQUEE_BORDER
  ctx.lineWidth = 1
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
}
