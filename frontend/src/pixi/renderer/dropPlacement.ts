import type { EnginePublic } from '../../engine'
import type { Scene } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { CreateAssetInstanceCommand } from '../../engine/commands'
import { DEFAULT_GRID_STEP, snapPoint } from './gridSnap'
import { cursorToWorld } from './screenToWorld'
import type { ViewportTransform } from './worldGeometry'
import { useNotificationStore } from '../../stores/notificationStore'

export const ASSET_DEFINITION_MIME = 'application/x-asset-definition'
export const AUDIO_ASSET_MIME = 'application/x-audio-asset'

export interface DropPlacementContext {
  readonly canvas: HTMLCanvasElement
  readonly engine: EnginePublic
  readonly getScene: () => Scene | null
  readonly getCameraTransform: () => ViewportTransform | null
  readonly dispatch: DispatchCommand
  readonly getGridSnap?: () => boolean
  readonly onAssetPlaced?: (definitionId: string) => void
}

export class DropPlacement {
  readonly #canvas: HTMLCanvasElement
  readonly #engine: EnginePublic
  readonly #getScene: () => Scene | null
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #dispatch: DispatchCommand
  readonly #getGridSnap?: () => boolean
  readonly #onAssetPlaced?: (definitionId: string) => void
  #attached = false

  constructor(context: DropPlacementContext) {
    this.#canvas = context.canvas
    this.#engine = context.engine
    this.#getScene = context.getScene
    this.#getCameraTransform = context.getCameraTransform
    this.#dispatch = context.dispatch
    this.#getGridSnap = context.getGridSnap
    this.#onAssetPlaced = context.onAssetPlaced
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
    if (isAudioDrag(event.dataTransfer)) {
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'none'
      }
      return
    }
    if (!isAssetDrag(event.dataTransfer)) {
      return
    }
    event.preventDefault()
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy'
    }
  }

  readonly #onDrop = (event: DragEvent): void => {
    if (isAudioDrag(event.dataTransfer)) {
      event.preventDefault()
      useNotificationStore.getState().notify('Audio assets cannot be dropped on animation lanes')
      return
    }
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
    const camera = this.#getCameraTransform()
    if (!camera) {
      return
    }
    const position = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!position) {
      return
    }
    const snap = this.#getGridSnap?.() ?? false
    const target = snap ? snapPoint(position, DEFAULT_GRID_STEP) : position
    event.preventDefault()
    this.#dispatch(
      new CreateAssetInstanceCommand({
        sceneId: scene.id,
        parentId: scene.root.id,
        definitionId,
        name: definition.name,
        position: target,
      }),
    )
    this.#onAssetPlaced?.(definitionId)
  }

  #definition(definitionId: string): { name: string } | null {
    try {
      return this.#engine.getAssetDefinition(definitionId)
    } catch {
      return null
    }
  }
}

function isAssetDrag(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer?.types.includes(ASSET_DEFINITION_MIME) ?? false
}

function isAudioDrag(dataTransfer: DataTransfer | null): boolean {
  return dataTransfer?.types.includes(AUDIO_ASSET_MIME) ?? false
}

export function isAudioAssetDrag(dataTransfer: DataTransfer | null): boolean {
  return isAudioDrag(dataTransfer)
}
