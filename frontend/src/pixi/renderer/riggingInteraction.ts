import type { EnginePublic, Scene } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { CreateNodeCommand } from '../../engine/commands'
import { useEditingModeStore } from '../../stores/editingModeStore'
import { cursorToWorld } from './screenToWorld'
import type { ViewportTransform } from './worldGeometry'
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
  }

  detach(): void {
    if (!this.#attached) {
      return
    }
    this.#attached = false
    this.#canvas.removeEventListener('click', this.#onClick)
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

    const taken = namesInTree(scene.root)
    const name = uniqueNodeName(taken, 'New Bone')
    this.#dispatch(
      new CreateNodeCommand({
        sceneId: scene.id,
        parentId: scene.root.id,
        name,
        components: { bone: { kind: 'bone', length: 100 } },
        transform: { x: point.x, y: point.y, rotation: 0, scaleX: 1, scaleY: 1 },
      }),
    )
  }
}
