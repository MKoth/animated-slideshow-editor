import type { SceneNode } from '../../engine'
import type { Transform } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { MoveNodeCommand } from '../../engine/commands'
import { ScaleNodeCommand } from '../../engine/commands'

export interface CameraControlsContext {
  readonly canvas: HTMLCanvasElement
  readonly getCamera: () => SceneNode | null
  readonly dispatch: DispatchCommand
}

const ZOOM_SPEED = 0.001
const MIN_ZOOM = 0.01
const MAX_ZOOM = 100

export class CameraControls {
  readonly #canvas: HTMLCanvasElement
  readonly #getCamera: () => SceneNode | null
  readonly #dispatch: DispatchCommand
  #attached = false
  #panning = false
  #lastClientX = 0
  #lastClientY = 0

  constructor(context: CameraControlsContext) {
    this.#canvas = context.canvas
    this.#getCamera = context.getCamera
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
    this.#canvas.removeEventListener('wheel', this.#onWheel)
    this.#canvas.removeEventListener('mousedown', this.#onMouseDown)
    this.#canvas.removeEventListener('dblclick', this.#onDoubleClick)
  }

  readonly #onWheel = (event: WheelEvent): void => {
    event.preventDefault()
    const camera = this.#camera()
    if (!camera) {
      return
    }
    const { x, y, scaleX, scaleY } = camera.transform
    const delta = deltaPixels(event)
    const newScaleX = clampZoom(scaleX * Math.exp(-delta * ZOOM_SPEED))
    const newScaleY = clampZoom(scaleY * Math.exp(-delta * ZOOM_SPEED))
    if (newScaleX === scaleX && newScaleY === scaleY) {
      return
    }
    const cursor = this.#cursor(event)
    const newX = x + cursor.x / scaleX - cursor.x / newScaleX
    const newY = y + cursor.y / scaleY - cursor.y / newScaleY
    this.#dispatch(new MoveNodeCommand({ nodeId: camera.nodeId, x: newX, y: newY }))
    this.#dispatch(
      new ScaleNodeCommand({ nodeId: camera.nodeId, scaleX: newScaleX, scaleY: newScaleY }),
    )
  }

  readonly #onMouseDown = (event: MouseEvent): void => {
    const startsPan = event.button === 1 || (event.button === 0 && event.altKey)
    if (!startsPan) {
      return
    }
    event.preventDefault()
    this.#panning = true
    this.#lastClientX = event.clientX
    this.#lastClientY = event.clientY
    window.addEventListener('mousemove', this.#onMouseMove)
    window.addEventListener('mouseup', this.#onMouseUp)
  }

  readonly #onMouseMove = (event: MouseEvent): void => {
    if (!this.#panning) {
      return
    }
    const camera = this.#camera()
    if (!camera) {
      return
    }
    const { x, y, scaleX, scaleY } = camera.transform
    const dx = event.clientX - this.#lastClientX
    const dy = event.clientY - this.#lastClientY
    this.#lastClientX = event.clientX
    this.#lastClientY = event.clientY
    this.#dispatch(
      new MoveNodeCommand({ nodeId: camera.nodeId, x: x - dx / scaleX, y: y - dy / scaleY }),
    )
  }

  readonly #onMouseUp = (): void => {
    this.#stopPan()
  }

  readonly #onDoubleClick = (): void => {
    const camera = this.#getCamera()
    if (!camera) {
      return
    }
    this.#dispatch(new MoveNodeCommand({ nodeId: camera.id, x: 0, y: 0 }))
    this.#dispatch(new ScaleNodeCommand({ nodeId: camera.id, scaleX: 1, scaleY: 1 }))
  }

  #camera(): { nodeId: string; transform: Transform } | null {
    const camera = this.#getCamera()
    if (!camera) {
      return null
    }
    const { scaleX, scaleY } = camera.transform
    if (scaleX <= 0 || scaleY <= 0) {
      return null
    }
    return { nodeId: camera.id, transform: camera.transform }
  }

  #stopPan(): void {
    this.#panning = false
    window.removeEventListener('mousemove', this.#onMouseMove)
    window.removeEventListener('mouseup', this.#onMouseUp)
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
