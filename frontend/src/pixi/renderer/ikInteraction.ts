import type { EnginePublic } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { SetIKTargetCommand, SetIKPoleTargetCommand } from '../../engine/commands'
import { useEditingModeStore } from '../../stores/editingModeStore'
import { useIKSelectionStore } from '../../stores/ikSelectionStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { cursorToWorld } from './screenToWorld'
import type { ViewportTransform } from './worldGeometry'
import type { IkOverlay } from './ikOverlay'

export interface IkInteractionContext {
  readonly canvas: HTMLCanvasElement
  readonly engine: EnginePublic
  readonly getCameraTransform: () => ViewportTransform | null
  readonly dispatch: DispatchCommand
  readonly ikOverlay: IkOverlay
  readonly onIKChanged: () => void
}

export class IkInteraction {
  readonly #canvas: HTMLCanvasElement
  readonly #engine: EnginePublic
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #dispatch: DispatchCommand
  readonly #ikOverlay: IkOverlay
  readonly #onIKChanged: () => void
  #attached = false
  #pressed = false
  #dragging: { chainId: string; kind: 'target' | 'pole' } | null = null
  #startWorldX = 0
  #startWorldY = 0
  #moveActive = false

  constructor(context: IkInteractionContext) {
    this.#canvas = context.canvas
    this.#engine = context.engine
    this.#getCameraTransform = context.getCameraTransform
    this.#dispatch = context.dispatch
    this.#ikOverlay = context.ikOverlay
    this.#onIKChanged = context.onIKChanged
  }

  attach(): void {
    if (this.#attached) {
      return
    }
    this.#attached = true
    this.#canvas.addEventListener('mousedown', this.#onMouseDown)
    window.addEventListener('mousemove', this.#onMouseMove)
    window.addEventListener('mouseup', this.#onMouseUp)
  }

  detach(): void {
    if (!this.#attached) {
      return
    }
    this.#attached = false
    this.#canvas.removeEventListener('mousedown', this.#onMouseDown)
    window.removeEventListener('mousemove', this.#onMouseMove)
    window.removeEventListener('mouseup', this.#onMouseUp)
  }

  readonly #onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) {
      return
    }
    const { mode } = useEditingModeStore.getState()
    const camera = this.#getCameraTransform()
    if (!camera) {
      return
    }
    const point = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!point) {
      return
    }

    if (mode === 'ikTarget' || mode === 'poleVector') {
      const hit = this.#ikOverlay.hitTestTarget(point.x, point.y)
      if (hit) {
        event.stopPropagation()
        this.#pressed = true
        this.#dragging = hit
        this.#startWorldX = point.x
        this.#startWorldY = point.y
        this.#moveActive = false
        return
      }
      this.#placeTarget(point.x, point.y, mode)
      return
    }

    const hit = this.#ikOverlay.hitTestTarget(point.x, point.y)
    if (hit) {
      event.stopPropagation()
      this.#pressed = true
      this.#dragging = hit
      this.#startWorldX = point.x
      this.#startWorldY = point.y
      this.#moveActive = false
    }
  }

  readonly #onMouseMove = (event: MouseEvent): void => {
    if (!this.#pressed || !this.#dragging) {
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
    const dx = point.x - this.#startWorldX
    const dy = point.y - this.#startWorldY
    if (!this.#moveActive && Math.hypot(dx, dy) < 3) {
      return
    }
    this.#moveActive = true
    this.#dispatchPosition(this.#dragging.chainId, this.#dragging.kind, point.x, point.y)
  }

  readonly #onMouseUp = (): void => {
    this.#pressed = false
    this.#dragging = null
    this.#moveActive = false
  }

  #placeTarget(x: number, y: number, mode: 'ikTarget' | 'poleVector'): void {
    const slide = this.#engine.getActiveSlide()
    if (!slide) {
      return
    }
    const selectedChainId = useIKSelectionStore.getState().selectedChainId
    const ikManager = this.#engine.getIKManager()
    const chains = ikManager.getChainsForSlide(slide.id)

    let targetChainId: string | null = selectedChainId
    if (!targetChainId || !chains.some((c) => c.id === targetChainId)) {
      if (chains.length === 0) {
        useNotificationStore
          .getState()
          .notify('No IK chains. Create one first from the Rigging panel.')
        return
      }
      targetChainId = chains[0].id
    }

    this.#dispatchPosition(targetChainId, mode === 'ikTarget' ? 'target' : 'pole', x, y)
  }

  #dispatchPosition(chainId: string, kind: 'target' | 'pole', x: number, y: number): void {
    const result =
      kind === 'target'
        ? this.#dispatch(
            new SetIKTargetCommand({
              chainId,
              target: { position: { x, y } },
            }),
          )
        : this.#dispatch(
            new SetIKPoleTargetCommand({
              chainId,
              poleTarget: { position: { x, y } },
            }),
          )
    if (!result.ok && result.error) {
      useNotificationStore.getState().notify(result.error.message)
    }
    this.#onIKChanged()
  }
}
