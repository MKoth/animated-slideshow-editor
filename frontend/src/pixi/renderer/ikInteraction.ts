import type { EnginePublic } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import {
  SetIKTargetCommand,
  SetIKPoleTargetCommand,
  MoveNodeCommand,
  TransactionCommand,
} from '../../engine/commands'
import { useEditingModeStore } from '../../stores/editingModeStore'
import { useIKSelectionStore } from '../../stores/ikSelectionStore'
import { useNotificationStore } from '../../stores/notificationStore'
import { useUiStore } from '../../stores/uiStore'
import { usePlaybackController } from '../../stores/playbackStore'
import { autoKeyCommands } from '../../engine/keyframeEdit'
import type { TimedKeyframeEdit } from '../../engine/keyframeEdit'
import { BLOCKED_ANIMATED_MOVE_MESSAGE } from './animatedMove'
import { cursorToWorld } from './screenToWorld'
import type { ViewportTransform } from './worldGeometry'
import type { IkOverlay } from './ikOverlay'
import {
  evaluatedWorldTransformOf,
  worldTransformOf,
  relativeTransform,
} from '../../engine/worldTransform'
import type { BoneIKTarget, PoleTarget } from '../../engine/ikChain'

export interface IkPreview {
  setPosition(nodeId: string, x: number, y: number): void
  clearPosition(nodeId: string): void
}

export interface IkInteractionContext {
  readonly canvas: HTMLCanvasElement
  readonly engine: EnginePublic
  readonly getCameraTransform: () => ViewportTransform | null
  readonly dispatch: DispatchCommand
  readonly ikOverlay: IkOverlay
  readonly onIKChanged: () => void
  readonly preview?: IkPreview
}

export class IkInteraction {
  readonly #canvas: HTMLCanvasElement
  readonly #engine: EnginePublic
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #dispatch: DispatchCommand
  readonly #ikOverlay: IkOverlay
  readonly #onIKChanged: () => void
  readonly #preview?: IkPreview
  #attached = false
  #pressed = false
  #dragging: { chainId: string; kind: 'target' | 'pole' } | null = null
  #startWorldX = 0
  #startWorldY = 0
  #moveActive = false
  #blockedNotified = false
  #dragTime: number | null = null
  #ghostIdForDrag: string | null = null
  #poleGhostIdForDrag: string | null = null
  #initialGhostLocal: { x: number; y: number } | null = null
  #initialPoleLocal: { x: number; y: number } | null = null
  #initialTarget: BoneIKTarget | null = null
  #initialPoleTarget: PoleTarget | null | undefined = undefined
  #lastWorld: { x: number; y: number } | null = null
  #lastLocal: { x: number; y: number } | null = null

  constructor(context: IkInteractionContext) {
    this.#canvas = context.canvas
    this.#engine = context.engine
    this.#getCameraTransform = context.getCameraTransform
    this.#dispatch = context.dispatch
    this.#ikOverlay = context.ikOverlay
    this.#onIKChanged = context.onIKChanged
    this.#preview = context.preview
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
    this.#clearPreview()
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
      this.#lastWorld = null
      this.#lastLocal = null
      this.#dragTime = null
      this.#ghostIdForDrag = null
      this.#poleGhostIdForDrag = null
      this.#initialGhostLocal = null
      this.#initialPoleLocal = null
      this.#initialTarget = null
      this.#initialPoleTarget = undefined
      // Capture initial state for preview fallback restore and commit
      try {
        const chain = this.#engine.getIKManager().getChain(hit.chainId)
        this.#initialTarget = { ...chain.target }
        this.#initialPoleTarget = chain.poleTarget ? { ...chain.poleTarget } : null
        const slide = this.#engine.getActiveSlide()
        if (slide) {
          this.#dragTime = usePlaybackController.getState().getTime(slide.id)
        }
        if (hit.kind === 'target' && chain.ghostNodeId) {
          this.#ghostIdForDrag = chain.ghostNodeId
          try {
            const g = this.#engine.getNode(chain.ghostNodeId)
            this.#initialGhostLocal = { x: g.transform.x, y: g.transform.y }
          } catch {
            this.#initialGhostLocal = null
          }
        } else if (hit.kind === 'pole') {
          const poleGhostId = chain.poleGhostNodeId ?? chain.poleTarget?.nodeId ?? null
          this.#poleGhostIdForDrag = poleGhostId
          if (poleGhostId) {
            try {
              const p = this.#engine.getNode(poleGhostId)
              this.#initialPoleLocal = { x: p.transform.x, y: p.transform.y }
            } catch {
              this.#initialPoleLocal = null
            }
          }
        }
      } catch {
        // ignore capture failures
      }
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
    this.#previewPosition(this.#dragging.chainId, this.#dragging.kind, point.x, point.y)
  }

  readonly #onMouseUp = (): void => {
    const wasDragging = this.#dragging
    const wasMoveActive = this.#moveActive
    const lastWorld = this.#lastWorld
    const lastLocal = this.#lastLocal
    const dragTime = this.#dragTime
    const ghostId = this.#ghostIdForDrag
    const poleGhostId = this.#poleGhostIdForDrag
    const initialGhostLocal = this.#initialGhostLocal
    const initialPoleLocal = this.#initialPoleLocal
    const initialTarget = this.#initialTarget
    const initialPoleTarget = this.#initialPoleTarget

    // Always clear pressed state first
    this.#pressed = false
    const dragging = this.#dragging
    this.#dragging = null
    this.#moveActive = false
    this.#blockedNotified = false

    if (!wasDragging || !wasMoveActive || !lastWorld || !lastLocal || dragTime === null) {
      // No commit needed, but clear any preview that was applied
      if (ghostId) this.#clearPreviewFor(ghostId, initialGhostLocal)
      if (poleGhostId) this.#clearPreviewFor(poleGhostId, initialPoleLocal)
      // Also restore IK target if fallback mutated it
      if (initialTarget && wasDragging?.kind === 'target') {
        this.#restoreIKTarget(wasDragging.chainId, initialTarget)
      }
      if (wasDragging?.kind === 'pole' && initialPoleTarget !== undefined) {
        this.#restoreIKPoleTarget(wasDragging.chainId, initialPoleTarget as PoleTarget | null)
      }
      this.#resetDragState()
      return
    }

    // Clear preview before committing so the committed command is the single source of truth
    if (dragging?.kind === 'target' && ghostId) {
      this.#clearPreviewFor(ghostId, initialGhostLocal)
      this.#restoreIKTarget(dragging.chainId, initialTarget!)
    } else if (dragging?.kind === 'pole' && poleGhostId) {
      this.#clearPreviewFor(poleGhostId, initialPoleLocal)
      this.#restoreIKPoleTarget(dragging.chainId, initialPoleTarget as PoleTarget | null)
    } else if (dragging?.kind === 'pole' && !poleGhostId) {
      this.#restoreIKPoleTarget(dragging.chainId, initialPoleTarget as PoleTarget | null)
    }

    this.#commitPosition(wasDragging.chainId, wasDragging.kind, lastWorld, lastLocal, dragTime)

    this.#resetDragState()
  }

  #resetDragState(): void {
    this.#dragTime = null
    this.#ghostIdForDrag = null
    this.#poleGhostIdForDrag = null
    this.#initialGhostLocal = null
    this.#initialPoleLocal = null
    this.#initialTarget = null
    this.#initialPoleTarget = undefined
    this.#lastWorld = null
    this.#lastLocal = null
  }

  #clearPreviewFor(nodeId: string, initialLocal: { x: number; y: number } | null): void {
    if (this.#preview) {
      this.#preview.clearPosition(nodeId)
      this.#onIKChanged()
      return
    }
    if (initialLocal) {
      // Fallback: restore engine transform that was mutated for preview
      try {
        const engineAny = this.#engine as unknown as {
          setTransform?: (id: string, t: unknown) => void
          getNode?: (id: string) => {
            transform: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }
          }
        }
        if (engineAny.setTransform && engineAny.getNode) {
          const cur = engineAny.getNode(nodeId)
          if (cur.transform.x !== initialLocal.x || cur.transform.y !== initialLocal.y) {
            engineAny.setTransform(nodeId, {
              ...cur.transform,
              x: initialLocal.x,
              y: initialLocal.y,
            } as never)
            this.#onIKChanged()
          }
        }
      } catch {
        // ignore
      }
    }
  }

  #restoreIKTarget(chainId: string, initial: BoneIKTarget | null): void {
    if (!initial) return
    if (this.#preview) {
      // Preview path doesn't mutate IK target, so nothing to restore
      return
    }
    try {
      const engineAny = this.#engine as unknown as {
        setIKTarget?: (id: string, t: BoneIKTarget) => void
        getIKManager?: () => { getChain: (id: string) => { target: BoneIKTarget } }
      }
      if (engineAny.setIKTarget && engineAny.getIKManager) {
        const cur = engineAny.getIKManager().getChain(chainId).target
        if (
          cur.position.x !== initial.position.x ||
          cur.position.y !== initial.position.y ||
          cur.nodeId !== initial.nodeId
        ) {
          engineAny.setIKTarget(chainId, initial)
          this.#onIKChanged()
        }
      }
    } catch {
      // ignore
    }
  }

  #restoreIKPoleTarget(chainId: string, initial: PoleTarget | null): void {
    if (this.#preview) return
    try {
      const engineAny = this.#engine as unknown as {
        setIKPoleTarget?: (id: string, t: PoleTarget | null) => void
        getIKManager?: () => { getChain: (id: string) => { poleTarget: PoleTarget | null } }
      }
      if (engineAny.setIKPoleTarget && engineAny.getIKManager) {
        const cur = engineAny.getIKManager().getChain(chainId).poleTarget
        const curPos = cur?.position
        const initPos = initial?.position
        const changed =
          !curPos ||
          !initPos ||
          curPos.x !== initPos.x ||
          curPos.y !== initPos.y ||
          cur?.nodeId !== initial?.nodeId
        if (changed || (!cur && initial) || (cur && !initial)) {
          engineAny.setIKPoleTarget(chainId, initial)
          this.#onIKChanged()
        }
      }
    } catch {
      // ignore
    }
  }

  #clearPreview(): void {
    if (this.#ghostIdForDrag) this.#clearPreviewFor(this.#ghostIdForDrag, this.#initialGhostLocal)
    if (this.#poleGhostIdForDrag)
      this.#clearPreviewFor(this.#poleGhostIdForDrag, this.#initialPoleLocal)
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

    const time = usePlaybackController.getState().getTime(slide.id)
    // For placement we commit directly as a single Transaction (collapsed)
    this.#commitPosition(
      targetChainId,
      mode === 'ikTarget' ? 'target' : 'pole',
      { x, y },
      null,
      time,
      true,
    )
  }

  #previewPosition(chainId: string, kind: 'target' | 'pole', x: number, y: number): void {
    const chain = this.#engine.getIKManager().getChain(chainId)
    const slide = this.#engine.getActiveSlide()
    const time = this.#dragTime ?? (slide ? usePlaybackController.getState().getTime(slide.id) : 0)

    if (kind === 'target') {
      const ghostId = this.#ghostIdForDrag ?? chain.ghostNodeId
      if (!ghostId) return
      const local = this.#worldToLocal(ghostId, x, y, time)
      this.#lastWorld = { x, y }
      this.#lastLocal = local
      if (this.#preview) {
        this.#preview.setPosition(ghostId, local.x, local.y)
      } else {
        // Fallback: mutate engine directly for live preview (base mode)
        try {
          const engineAny = this.#engine as unknown as {
            setTransform?: (id: string, t: unknown) => void
            getNode?: (id: string) => { transform: unknown }
            setIKTarget?: (id: string, t: BoneIKTarget) => void
          }
          if (engineAny.setTransform && engineAny.getNode) {
            const cur = engineAny.getNode(ghostId) as {
              transform: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }
            }
            engineAny.setTransform(ghostId, { ...cur.transform, x: local.x, y: local.y } as never)
          }
          // Also update IK target position for live solver when not using preview map (e.g., tests)
          if (engineAny.setIKTarget) {
            const targetNodeId = chain.target.nodeId ?? ghostId
            engineAny.setIKTarget(chainId, {
              position: { x, y },
              ...(targetNodeId ? { nodeId: targetNodeId } : {}),
            })
          }
        } catch {
          // ignore
        }
      }
    } else {
      const poleGhostId =
        this.#poleGhostIdForDrag ?? chain.poleGhostNodeId ?? chain.poleTarget?.nodeId ?? null
      if (!poleGhostId) {
        // No ghost yet — still store lastWorld for commit (will create pole at position)
        this.#lastWorld = { x, y }
        // Compute local relative to slide origin as fallback
        this.#lastLocal = { x, y }
        // For live preview without ghost, we can at least update pole target directly if no preview
        if (!this.#preview) {
          try {
            const engineAny = this.#engine as unknown as {
              setIKPoleTarget?: (id: string, t: PoleTarget | null) => void
            }
            engineAny.setIKPoleTarget?.(chainId, { position: { x, y } })
          } catch {
            // ignore
          }
        }
        this.#onIKChanged()
        return
      }
      const local = this.#worldToLocal(poleGhostId, x, y, time)
      this.#lastWorld = { x, y }
      this.#lastLocal = local
      if (this.#preview) {
        this.#preview.setPosition(poleGhostId, local.x, local.y)
      } else {
        try {
          const engineAny = this.#engine as unknown as {
            setTransform?: (id: string, t: unknown) => void
            getNode?: (id: string) => { transform: unknown }
            setIKPoleTarget?: (id: string, t: PoleTarget | null) => void
          }
          if (engineAny.setTransform && engineAny.getNode) {
            const cur = engineAny.getNode(poleGhostId) as {
              transform: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }
            }
            engineAny.setTransform(poleGhostId, {
              ...cur.transform,
              x: local.x,
              y: local.y,
            } as never)
          }
          if (engineAny.setIKPoleTarget) {
            engineAny.setIKPoleTarget(chainId, { position: { x, y } })
          }
        } catch {
          // ignore
        }
      }
    }
    this.#onIKChanged()
  }

  #commitPosition(
    chainId: string,
    kind: 'target' | 'pole',
    world: { x: number; y: number },
    localOrNull: { x: number; y: number } | null,
    time: number,
    isPlace = false,
  ): void {
    const chain = this.#engine.getIKManager().getChain(chainId)
    const animationMode = useUiStore.getState().animationMode
    const x = world.x
    const y = world.y

    if (kind === 'target') {
      const ghostId = chain.ghostNodeId
      if (!ghostId) {
        // No ghost — just set target
        const targetNodeId = chain.target.nodeId ?? undefined
        const cmd = new SetIKTargetCommand({
          chainId,
          target: { position: { x, y }, ...(targetNodeId ? { nodeId: targetNodeId } : {}) },
        })
        const result = this.#dispatch(cmd as unknown as never)
        if (!result.ok && result.error) useNotificationStore.getState().notify(result.error.message)
        if (!isPlace) this.#onIKChanged()
        else this.#onIKChanged()
        return
      }
      const local = localOrNull ?? this.#worldToLocal(ghostId, x, y, time)
      const targetNodeId = chain.target.nodeId ?? ghostId

      const commands: unknown[] = []
      commands.push(
        new SetIKTargetCommand({
          chainId,
          target: { position: { x, y }, ...(targetNodeId ? { nodeId: targetNodeId } : {}) },
        }),
      )
      if (animationMode) {
        const edits: TimedKeyframeEdit[] = [
          {
            target: { kind: 'node', nodeId: ghostId, property: 'positionX' },
            time,
            value: local.x,
          },
          {
            target: { kind: 'node', nodeId: ghostId, property: 'positionY' },
            time,
            value: local.y,
          },
        ]
        const keyCommands = autoKeyCommands(this.#engine, edits)
        commands.push(...keyCommands)
      } else {
        commands.push(new MoveNodeCommand({ nodeId: ghostId, x: local.x, y: local.y }))
      }
      // Collapse to single history entry
      let result
      if (commands.length === 1) {
        result = this.#dispatch(commands[0] as never)
      } else if (commands.length > 1) {
        // Filter out no-op keyframe commands already handled by autoKeyCommands (it returns [] if no change)
        // If only SetIKTarget remains, dispatch it alone; otherwise Transaction
        if (commands.length === 1) result = this.#dispatch(commands[0] as never)
        else result = this.#dispatch(new TransactionCommand(commands as never) as never)
      }
      if (result && !result.ok && result.error) {
        useNotificationStore.getState().notify(result.error.message)
      }
    } else {
      const poleGhostId = chain.poleGhostNodeId ?? chain.poleTarget?.nodeId ?? null
      if (!poleGhostId) {
        const cmd = new SetIKPoleTargetCommand({ chainId, poleTarget: { position: { x, y } } })
        const result = this.#dispatch(cmd as unknown as never)
        if (!result.ok && result.error) useNotificationStore.getState().notify(result.error.message)
        this.#onIKChanged()
        return
      }
      const local = localOrNull ?? this.#worldToLocal(poleGhostId, x, y, time)
      const commands: unknown[] = []
      commands.push(new SetIKPoleTargetCommand({ chainId, poleTarget: { position: { x, y } } }))
      if (animationMode) {
        const edits: TimedKeyframeEdit[] = [
          {
            target: { kind: 'node', nodeId: poleGhostId, property: 'positionX' },
            time,
            value: local.x,
          },
          {
            target: { kind: 'node', nodeId: poleGhostId, property: 'positionY' },
            time,
            value: local.y,
          },
        ]
        const keyCommands = autoKeyCommands(this.#engine, edits)
        commands.push(...keyCommands)
      } else {
        commands.push(new MoveNodeCommand({ nodeId: poleGhostId, x: local.x, y: local.y }))
      }
      let result
      if (commands.length === 1) result = this.#dispatch(commands[0] as never)
      else result = this.#dispatch(new TransactionCommand(commands as never) as never)
      if (result && !result.ok && result.error)
        useNotificationStore.getState().notify(result.error.message)
    }
    this.#onIKChanged()
  }

  #worldToLocal(
    ghostId: string,
    worldX: number,
    worldY: number,
    time: number,
  ): { x: number; y: number } {
    try {
      const ghost = this.#engine.getNode(ghostId)
      const parent = ghost.parent
      if (!parent) {
        return { x: worldX, y: worldY }
      }
      const slide = this.#engine.getActiveSlide()
      if (!slide) {
        return { x: worldX, y: worldY }
      }
      // Use evaluated world for parent if it has animation, otherwise static world
      const parentWorld =
        evaluatedWorldTransformOf(this.#engine, parent.id, time) ??
        worldTransformOf(slide.scene, parent.id)
      if (!parentWorld) {
        return { x: worldX, y: worldY }
      }
      const world = {
        x: worldX,
        y: worldY,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
      } as import('../../engine/worldTransform').WorldTransform
      const local = relativeTransform(world, parentWorld)
      if (local) {
        return { x: local.x, y: local.y }
      }
    } catch {
      // fall through
    }
    return { x: worldX, y: worldY }
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
