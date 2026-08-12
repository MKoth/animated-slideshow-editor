import type { Scene } from '../../engine'
import type { SceneNode } from '../../engine'
import type { SelectionActions } from '../../stores/selectionStore'
import { nodesIntersectingRect, topmostNodeAt } from './hitTest'
import type { NodeSizeSource } from './hitTest'
import { cursorToWorld } from './screenToWorld'
import type { WorldPoint, WorldRect } from './worldGeometry'

export interface CanvasSelectionContext {
  readonly canvas: HTMLCanvasElement
  readonly getScene: () => Scene | null
  readonly getCamera: () => SceneNode | null
  readonly getNodeSize: NodeSizeSource
  readonly store: SelectionActions
}

const MARQUEE_START_DISTANCE = 4

export class CanvasSelection {
  readonly #canvas: HTMLCanvasElement
  readonly #getScene: () => Scene | null
  readonly #getCamera: () => SceneNode | null
  readonly #getNodeSize: NodeSizeSource
  readonly #store: SelectionActions
  #attached = false
  #pressed = false
  #pressedOnNode = false
  #marqueeActive = false
  #startClientX = 0
  #startClientY = 0
  #startWorld: WorldPoint | null = null
  #sceneAtDown: Scene | null = null

  constructor(context: CanvasSelectionContext) {
    this.#canvas = context.canvas
    this.#getScene = context.getScene
    this.#getCamera = context.getCamera
    this.#getNodeSize = context.getNodeSize
    this.#store = context.store
  }

  attach(): void {
    if (this.#attached) {
      return
    }
    this.#attached = true
    this.#canvas.addEventListener('mousedown', this.#onMouseDown)
    this.#canvas.addEventListener('contextmenu', this.#onContextMenu)
    window.addEventListener('mousemove', this.#onMouseMove)
    window.addEventListener('mouseup', this.#onMouseUp)
  }

  detach(): void {
    if (!this.#attached) {
      return
    }
    this.#attached = false
    this.#resetGesture()
    this.#canvas.removeEventListener('mousedown', this.#onMouseDown)
    this.#canvas.removeEventListener('contextmenu', this.#onContextMenu)
    window.removeEventListener('mousemove', this.#onMouseMove)
    window.removeEventListener('mouseup', this.#onMouseUp)
  }

  readonly #onContextMenu = (event: MouseEvent): void => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
    }
  }

  readonly #onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || event.altKey) {
      return
    }
    const scene = this.#getScene()
    if (!scene) {
      return
    }
    const camera = this.#getCamera()
    if (!camera) {
      return
    }
    const point = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!point) {
      return
    }
    this.#pressed = true
    this.#sceneAtDown = scene
    this.#startClientX = event.clientX
    this.#startClientY = event.clientY
    this.#startWorld = point
    const hit = topmostNodeAt(scene, point, this.#getNodeSize)
    this.#pressedOnNode = hit !== null
    if (hit) {
      if (event.ctrlKey || event.metaKey) {
        this.#store.toggle(hit)
      } else if (event.shiftKey) {
        this.#store.extend(hit)
      } else {
        this.#store.select(hit)
      }
    }
  }

  readonly #onMouseMove = (event: MouseEvent): void => {
    if (!this.#pressed || this.#pressedOnNode) {
      return
    }
    const dx = event.clientX - this.#startClientX
    const dy = event.clientY - this.#startClientY
    if (!this.#marqueeActive && Math.hypot(dx, dy) < MARQUEE_START_DISTANCE) {
      return
    }
    const scene = this.#getScene()
    const camera = this.#getCamera()
    if (!scene || !camera || !this.#startWorld) {
      return
    }
    const current = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!current) {
      return
    }
    this.#marqueeActive = true
    this.#store.selectMany(
      nodesIntersectingRect(scene, rectOf(this.#startWorld, current), this.#getNodeSize),
    )
  }

  readonly #onMouseUp = (): void => {
    if (!this.#pressed) {
      return
    }
    if (!this.#marqueeActive && !this.#pressedOnNode && this.#getScene() === this.#sceneAtDown) {
      this.#store.clear()
    }
    this.#resetGesture()
  }

  #resetGesture(): void {
    this.#pressed = false
    this.#pressedOnNode = false
    this.#marqueeActive = false
    this.#startWorld = null
    this.#sceneAtDown = null
  }
}

function rectOf(a: WorldPoint, b: WorldPoint): WorldRect {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  }
}
