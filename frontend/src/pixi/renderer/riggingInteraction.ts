import type { EnginePublic, Scene } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { CreateNodeCommand } from '../../engine/commands'
import { useEditingModeStore } from '../../stores/editingModeStore'
import { cursorToWorld } from './screenToWorld'
import type { ViewportTransform, WorldPoint } from './worldGeometry'
import { uniqueNodeName, namesInTree } from '../../engine/naming'

export interface RiggingInteractionContext {
  readonly canvas: HTMLCanvasElement
  readonly engine: EnginePublic
  readonly getScene: () => Scene | null
  readonly getCameraTransform: () => ViewportTransform | null
  readonly dispatch: DispatchCommand
}

export class RiggingInteraction {
  readonly #canvas: HTMLCanvasElement
  readonly #getScene: () => Scene | null
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #dispatch: DispatchCommand
  #attached = false
  #pendingStart: WorldPoint | null = null
  #unsubscribeMode: (() => void) | null = null

  constructor(context: RiggingInteractionContext) {
    this.#canvas = context.canvas
    this.#getScene = context.getScene
    this.#getCameraTransform = context.getCameraTransform
    this.#dispatch = context.dispatch
  }

  attach(): void {
    if (this.#attached) {
      return
    }
    this.#attached = true
    this.#canvas.addEventListener('click', this.#onClick)
    window.addEventListener('keydown', this.#onKeyDown)
    this.#unsubscribeMode = useEditingModeStore.subscribe(({ mode }) => {
      if (mode !== 'boneCreation') {
        this.#pendingStart = null
      }
    })
  }

  detach(): void {
    if (!this.#attached) {
      return
    }
    this.#attached = false
    this.#pendingStart = null
    this.#unsubscribeMode?.()
    this.#unsubscribeMode = null
    this.#canvas.removeEventListener('click', this.#onClick)
    window.removeEventListener('keydown', this.#onKeyDown)
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.#pendingStart = null
    }
  }

  readonly #onClick = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return
    }

    const { mode } = useEditingModeStore.getState()
    if (mode !== 'boneCreation') {
      return
    }

    const scene = this.#getScene()
    if (!scene) {
      return
    }

    const camera = this.#getCameraTransform()
    if (!camera) {
      return
    }

    const point = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!point) {
      return
    }

    if (!this.#pendingStart) {
      this.#pendingStart = point
      return
    }

    const start = this.#pendingStart
    this.#pendingStart = null
    const dx = point.x - start.x
    const dy = point.y - start.y
    const length = Math.hypot(dx, dy)
    if (length === 0) {
      return
    }

    const taken = namesInTree(scene.root)
    const name = uniqueNodeName(taken, 'New Bone')
    this.#dispatch(
      new CreateNodeCommand({
        sceneId: scene.id,
        parentId: scene.root.id,
        name,
        components: { bone: { kind: 'bone', length } },
        transform: { x: start.x, y: start.y, rotation: Math.atan2(dy, dx), scaleX: 1, scaleY: 1 },
      }),
    )
  }
}
