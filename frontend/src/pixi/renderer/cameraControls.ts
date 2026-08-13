import type { EngineReadOnly } from '../../engine'
import type { SceneNode } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { MoveNodeCommand } from '../../engine/commands'
import { ScaleNodeCommand } from '../../engine/commands'
import type { TimedKeyframeEdit } from '../../engine/keyframeEdit'
import { autoKeyCommands, dispatchKeyframeCommands } from '../../engine/keyframeEdit'
import type { ViewportTransform } from './worldGeometry'

export interface CameraControlsContext {
  readonly canvas: HTMLCanvasElement
  readonly engine?: EngineReadOnly
  readonly getCamera: () => SceneNode | null
  readonly getCameraTransform: () => ViewportTransform | null
  readonly setCameraPreview: (transform: ViewportTransform | null) => void
  readonly getCameraAnimationMode?: () => boolean
  readonly getTime: () => number
  readonly dispatch: DispatchCommand
}

const ZOOM_SPEED = 0.001
const MIN_ZOOM = 0.01
const MAX_ZOOM = 100
const ZOOM_GESTURE_IDLE_MS = 200

export class CameraControls {
  readonly #canvas: HTMLCanvasElement
  readonly #engine?: EngineReadOnly
  readonly #getCamera: () => SceneNode | null
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #setCameraPreview: (transform: ViewportTransform | null) => void
  readonly #getCameraAnimationMode?: () => boolean
  readonly #getTime: () => number
  readonly #dispatch: DispatchCommand
  #attached = false
  #panning = false
  #panGesture: {
    lastClientX: number
    lastClientY: number
    current: ViewportTransform | null
  } | null = null
  #zoomGesture: { time: number; camera: ViewportTransform } | null = null
  #zoomGestureTimer: ReturnType<typeof setTimeout> | null = null

  constructor(context: CameraControlsContext) {
    this.#canvas = context.canvas
    this.#engine = context.engine
    this.#getCamera = context.getCamera
    this.#getCameraTransform = context.getCameraTransform
    this.#setCameraPreview = context.setCameraPreview
    this.#getCameraAnimationMode = context.getCameraAnimationMode
    this.#getTime = context.getTime
    this.#dispatch = context.dispatch
  }

  attach(): void {
    if (this.#attached) {
      return
    }
    this.#attached = true
    this.#canvas.addEventListener('wheel', this.#onWheel)
    this.#canvas.addEventListener('mousedown', this.#onMouseDown)
    this.#canvas.addEventListener('dblclick', this.#onDoubleClick)
  }

  detach(): void {
    if (!this.#attached) {
      return
    }
    this.#attached = false
    this.#stopPan()
    this.#cancelZoomGesture()
    this.#canvas.removeEventListener('wheel', this.#onWheel)
    this.#canvas.removeEventListener('mousedown', this.#onMouseDown)
    this.#canvas.removeEventListener('dblclick', this.#onDoubleClick)
  }

  reset(): void {
    this.#stopPan()
    this.#cancelZoomGesture()
  }

  readonly #onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const camera = this.#camera()
    if (!camera) {
      return
    }
    if (this.#cameraAnimationMode()) {
      this.#zoomAnimated(event, camera.nodeId)
    } else {
      this.#zoomStored(event, camera.nodeId)
    }
  }

  readonly #zoomStored = (event: WheelEvent, nodeId: string): void => {
    const next = this.#zoomedFrom(event)
    if (!next) {
      return
    }
    const transform = this.#getCameraTransform()
    if (!transform) {
      return
    }
    if (next.scaleX === transform.scaleX && next.scaleY === transform.scaleY) {
      return
    }
    this.#dispatch(new MoveNodeCommand({ nodeId, x: next.x, y: next.y }))
    this.#dispatch(new ScaleNodeCommand({ nodeId, scaleX: next.scaleX, scaleY: next.scaleY }))
  }

  readonly #zoomAnimated = (event: WheelEvent, nodeId: string): void => {
    const next = this.#zoomedFrom(event)
    if (!next) {
      return
    }
    const gesture: { time: number; camera: ViewportTransform } = {
      time: this.#getTime(),
      camera: next,
    }
    this.#zoomGesture = gesture
    this.#setCameraPreview(gesture.camera)
    if (this.#zoomGestureTimer !== null) {
      clearTimeout(this.#zoomGestureTimer)
    }
    this.#zoomGestureTimer = setTimeout(() => {
      this.#zoomGestureTimer = null
      this.#commitZoomGesture(nodeId)
    }, ZOOM_GESTURE_IDLE_MS)
  }

  #commitZoomGesture(nodeId: string): void {
    const engine = this.#engine
    const dispatch = this.#dispatch
    const gesture = this.#zoomGesture
    if (!engine || !dispatch || !gesture) {
      return
    }
    this.#zoomGesture = null
    this.#setCameraPreview(null)
    dispatchKeyframeCommands(
      dispatch,
      autoKeyCommands(engine, cameraEdits(nodeId, gesture.time, gesture.camera)),
    )
  }

  readonly #onMouseDown = (event: MouseEvent): void => {
    const startsPan = event.button === 1 || (event.button === 0 && event.altKey)
    if (!startsPan) {
      return
    }
    event.preventDefault()
    this.#cancelZoomGesture()
    this.#panning = true
    this.#panGesture = { lastClientX: event.clientX, lastClientY: event.clientY, current: null }
    window.addEventListener('mousemove', this.#onMouseMove)
    window.addEventListener('mouseup', this.#onMouseUp)
  }

  readonly #onMouseMove = (event: MouseEvent): void => {
    if (!this.#panning || !this.#panGesture) {
      return
    }
    const camera = this.#camera()
    if (!camera) {
      return
    }
    const { x, y, scaleX, scaleY } = camera.transform
    const dx = event.clientX - this.#panGesture.lastClientX
    const dy = event.clientY - this.#panGesture.lastClientY
    this.#panGesture.lastClientX = event.clientX
    this.#panGesture.lastClientY = event.clientY
    const next: ViewportTransform = { x: x - dx / scaleX, y: y - dy / scaleY, scaleX, scaleY }
    this.#panGesture.current = next
    if (!this.#cameraAnimationMode()) {
      this.#dispatch(new MoveNodeCommand({ nodeId: camera.nodeId, x: next.x, y: next.y }))
      return
    }
    this.#setCameraPreview(next)
  }

  readonly #onMouseUp = (): void => {
    const gesture = this.#panGesture
    this.#stopPan()
    this.#setCameraPreview(null)
    if (!gesture?.current) {
      return
    }
    if (!this.#cameraAnimationMode()) {
      return
    }
    const engine = this.#engine
    const dispatch = this.#dispatch
    const nodeId = this.#getCamera()?.id
    if (!engine || !dispatch || !nodeId) {
      return
    }
    dispatchKeyframeCommands(
      dispatch,
      autoKeyCommands(engine, panEdits(nodeId, this.#getTime(), gesture.current)),
    )
  }

  readonly #onDoubleClick = (): void => {
    const camera = this.#getCamera()
    if (!camera) {
      return
    }
    if (!this.#cameraAnimationMode()) {
      this.#dispatch(new MoveNodeCommand({ nodeId: camera.id, x: 0, y: 0 }))
      this.#dispatch(new ScaleNodeCommand({ nodeId: camera.id, scaleX: 1, scaleY: 1 }))
      return
    }
    const engine = this.#engine
    const dispatch = this.#dispatch
    if (!engine || !dispatch) {
      return
    }
    const reset: ViewportTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1 }
    dispatchKeyframeCommands(
      dispatch,
      autoKeyCommands(engine, cameraEdits(camera.id, this.#getTime(), reset)),
    )
  }

  #cameraAnimationMode(): boolean {
    return Boolean(this.#engine) && (this.#getCameraAnimationMode?.() ?? false)
  }

  #camera(): { nodeId: string; transform: ViewportTransform } | null {
    const camera = this.#getCamera()
    if (!camera) {
      return null
    }
    const transform = this.#getCameraTransform()
    if (!transform) {
      return null
    }
    return { nodeId: camera.id, transform }
  }

  #zoomedFrom(event: WheelEvent): ViewportTransform | null {
    const transform = this.#getCameraTransform()
    if (!transform) {
      return null
    }
    const delta = deltaPixels(event)
    const newScaleX = clampZoom(transform.scaleX * Math.exp(-delta * ZOOM_SPEED))
    const newScaleY = clampZoom(transform.scaleY * Math.exp(-delta * ZOOM_SPEED))
    const cursor = this.#cursor(event)
    return {
      x: transform.x + cursor.x / transform.scaleX - cursor.x / newScaleX,
      y: transform.y + cursor.y / transform.scaleY - cursor.y / newScaleY,
      scaleX: newScaleX,
      scaleY: newScaleY,
    }
  }

  #stopPan(): void {
    this.#panning = false
    this.#panGesture = null
    window.removeEventListener('mousemove', this.#onMouseMove)
    window.removeEventListener('mouseup', this.#onMouseUp)
  }

  #cancelZoomGesture(): void {
    if (this.#zoomGestureTimer !== null) {
      clearTimeout(this.#zoomGestureTimer)
    }
    this.#zoomGestureTimer = null
    this.#zoomGesture = null
    this.#setCameraPreview(null)
  }

  #cursor(event: MouseEvent): { x: number; y: number } {
    const rect = this.#canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
}

function deltaPixels(event: WheelEvent): number {
  switch (event.deltaMode) {
    case 1:
      return event.deltaY * 16
    case 2:
      return event.deltaY * 100
    default:
      return event.deltaY
  }
}

function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale))
}

function panEdits(nodeId: string, time: number, camera: ViewportTransform): TimedKeyframeEdit[] {
  return [
    { nodeId, property: 'positionX', value: camera.x, time },
    { nodeId, property: 'positionY', value: camera.y, time },
  ]
}

function cameraEdits(nodeId: string, time: number, camera: ViewportTransform): TimedKeyframeEdit[] {
  return [
    { nodeId, property: 'positionX', value: camera.x, time },
    { nodeId, property: 'positionY', value: camera.y, time },
    { nodeId, property: 'scaleX', value: camera.scaleX, time },
    { nodeId, property: 'scaleY', value: camera.scaleY, time },
  ]
}
