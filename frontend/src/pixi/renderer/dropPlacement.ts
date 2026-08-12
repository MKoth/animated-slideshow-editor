import type { EngineReadOnly } from '../../engine'
import type { Scene } from '../../engine'
import type { SceneNode } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { CreateAssetInstanceCommand } from '../../engine/commands'

export const ASSET_DEFINITION_MIME = 'application/x-asset-definition'

export interface DropPlacementContext {
  readonly canvas: HTMLCanvasElement
  readonly engine: EngineReadOnly
  readonly getScene: () => Scene | null
  readonly getCamera: () => SceneNode | null
  readonly dispatch: DispatchCommand
}

export class DropPlacement {
  readonly #canvas: HTMLCanvasElement
  readonly #engine: EngineReadOnly
  readonly #getScene: () => Scene | null
  readonly #getCamera: () => SceneNode | null
  readonly #dispatch: DispatchCommand
  #attached = false

  constructor(context: DropPlacementContext) {
    this.#canvas = context.canvas
    this.#engine = context.engine
    this.#getScene = context.getScene
    this.#getCamera = context.getCamera
    this.#dispatch = context.dispatch
  }

  attach(): void {
    if (this.#attached) {
      return
    }
    this.#attached = true
    this.#canvas.addEventListener('dragover', this.#onDragOver)
    this.#canvas.addEventListener('drop', this.#onDrop)
  }

  detach(): void {
    if (!this.#attached) {
      return
    }
    this.#attached = false
    this.#canvas.removeEventListener('dragover', this.#onDragOver)
    this.#canvas.removeEventListener('drop', this.#onDrop)
  }

  readonly #onDragOver = (event: DragEvent): void => {
    if (!isAssetDrag(event.dataTransfer)) {
      return
    }
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
  }

  readonly #onDrop = (event: DragEvent): void => {
    const definitionId = event.dataTransfer?.getData(ASSET_DEFINITION_MIME)
    if (!definitionId) {
      return
    }
    const definition = this.#definition(definitionId)
    if (!definition) {
      return
    }
    const scene = this.#getScene()
    if (!scene) {
      return
    }
    const position = this.#cursorToWorld(event, this.#getCamera())
    if (!position) {
      return
    }
    event.preventDefault()
    this.#dispatch(
      new CreateAssetInstanceCommand({
        sceneId: scene.id,
        parentId: scene.root.id,
        definitionId,
        name: definition.name,
        position,
      }),
    )
  }

  #definition(definitionId: string): { name: string } | null {
    try {
      return this.#engine.getAssetDefinition(definitionId)
    } catch {
      return null
    }
  }

  #cursorToWorld(event: DragEvent, camera: SceneNode | null): { x: number; y: number } | null {
    if (!camera) {
      return null
    }
    const { x, y, scaleX, scaleY } = camera.transform
    if (scaleX <= 0 || scaleY <= 0) {
      return null
    }
    const rect = this.#canvas.getBoundingClientRect()
    return {
      x: x + (event.clientX - rect.left) / scaleX,
      y: y + (event.clientY - rect.top) / scaleY,
    }
  }
}

function isAssetDrag(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer?.types.includes(ASSET_DEFINITION_MIME) ?? false
}
