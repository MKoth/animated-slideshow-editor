import type { EnginePublic } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { SetIKTargetCommand, SetIKPoleTargetCommand, MoveNodeCommand } from '../../engine/commands'
import { useEditingModeStore } from '../../stores/editingModeStore'
import { useIKSelectionStore } from '../../stores/ikSelectionStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { useUiStore } from '../../stores/uiStore'
import { usePlaybackController } from '../../stores/playbackStore'
import { autoKeyCommands, dispatchKeyframeCommands } from '../../engine/keyframeEdit'
import type { TimedKeyframeEdit } from '../../engine/keyframeEdit'
import { BLOCKED_ANIMATED_MOVE_MESSAGE } from './animatedMove'
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
  #blockedNotified = false

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

    const hit = this.#ikOverlay.hitTestTarget(point.x, point.y)
    if (hit) {
      event.stopPropagation()
      this.#pressed = true
      this.#dragging = hit
      this.#startWorldX = point.x
      this.#startWorldY = point.y
      this.#moveActive = false
      this.#blockedNotified = false
      return
    }

    if (mode === 'ikTarget' || mode === 'poleVector') {
      this.#placeTarget(point.x, point.y, mode)
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
    if (this.#isBlockedAnimatedTargetMove()) {
      if (!this.#blockedNotified) {
        this.#blockedNotified = true
        useNotificationStore.getState().notify(BLOCKED_ANIMATED_MOVE_MESSAGE)
      }
      return
    }
    this.#moveActive = true
    this.#dispatchPosition(this.#dragging.chainId, this.#dragging.kind, point.x, point.y)
  }

  readonly #onMouseUp = (): void => {
    this.#pressed = false
    this.#dragging = null
    this.#moveActive = false
    this.#blockedNotified = false
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

    if (
      mode === 'ikTarget' &&
      !useUiStore.getState().animationMode &&
      this.#hasAnimatedTarget(targetChainId)
    ) {
      useNotificationStore.getState().notify(BLOCKED_ANIMATED_MOVE_MESSAGE)
      return
    }

    this.#dispatchPosition(targetChainId, mode === 'ikTarget' ? 'target' : 'pole', x, y)
  }

  #dispatchPosition(chainId: string, kind: 'target' | 'pole', x: number, y: number): void {
    const animationMode = useUiStore.getState().animationMode
    const ikManager = this.#engine.getIKManager()
    const chain = ikManager.getChain(chainId)

    // Keep the ghost node attached so its evaluated animation drives IK.
    const targetNodeId = chain.target.nodeId ?? chain.ghostNodeId ?? undefined
    const result =
      kind === 'target'
        ? this.#dispatch(
            new SetIKTargetCommand({
              chainId,
              target: {
                position: { x, y },
                ...(targetNodeId ? { nodeId: targetNodeId } : {}),
              },
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

    // If we have a ghost node, update its position and optionally create keyframes
    if (kind === 'target') {
      if (chain.ghostNodeId) {
        const slide = this.#engine.getActiveSlide()
        if (slide) {
          const time = usePlaybackController.getState().getTime(slide.id)

          if (animationMode) {
            // In Animation Mode, create keyframes for positionX and positionY
            const edits: TimedKeyframeEdit[] = [
              {
                target: { kind: 'node', nodeId: chain.ghostNodeId, property: 'positionX' },
                time,
                value: x,
              },
              {
                target: { kind: 'node', nodeId: chain.ghostNodeId, property: 'positionY' },
                time,
                value: y,
              },
            ]
            const commands = autoKeyCommands(this.#engine, edits)
            if (commands.length > 0) {
              const keyframeResult = dispatchKeyframeCommands(this.#dispatch, commands)
              if (keyframeResult && !keyframeResult.ok && keyframeResult.error) {
                useNotificationStore.getState().notify(keyframeResult.error.message)
              }
            }
          } else {
            // In non-Animation Mode, just move the ghost node
            this.#dispatch(new MoveNodeCommand({ nodeId: chain.ghostNodeId, x, y }))
          }
        }
      }
    } else if (kind === 'pole') {
      const poleGhostId = chain.poleGhostNodeId ?? chain.poleTarget?.nodeId ?? null
      if (poleGhostId) {
        const slide = this.#engine.getActiveSlide()
        if (slide) {
          const time = usePlaybackController.getState().getTime(slide.id)
          if (animationMode) {
            const edits: TimedKeyframeEdit[] = [
              {
                target: { kind: 'node', nodeId: poleGhostId, property: 'positionX' },
                time,
                value: x,
              },
              {
                target: { kind: 'node', nodeId: poleGhostId, property: 'positionY' },
                time,
                value: y,
              },
            ]
            const commands = autoKeyCommands(this.#engine, edits)
            if (commands.length > 0) {
              const keyframeResult = dispatchKeyframeCommands(this.#dispatch, commands)
              if (keyframeResult && !keyframeResult.ok && keyframeResult.error) {
                useNotificationStore.getState().notify(keyframeResult.error.message)
              }
            }
          } else {
            this.#dispatch(new MoveNodeCommand({ nodeId: poleGhostId, x, y }))
          }
        }
      }
    }

    this.#onIKChanged()
  }

  #isBlockedAnimatedTargetMove(): boolean {
    const dragging = this.#dragging
    if (!dragging || dragging.kind !== 'target' || useUiStore.getState().animationMode) {
      return false
    }
    return this.#hasAnimatedTarget(dragging.chainId)
  }

  #hasAnimatedTarget(chainId: string): boolean {
    const ghostNodeId = this.#engine.getIKManager().getChain(chainId).ghostNodeId
    return (
      ghostNodeId !== null &&
      (this.#engine.getKeyframes(ghostNodeId, 'positionX').length > 0 ||
        this.#engine.getKeyframes(ghostNodeId, 'positionY').length > 0)
    )
  }
}
