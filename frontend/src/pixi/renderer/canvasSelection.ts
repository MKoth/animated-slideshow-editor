import type { EngineReadOnly, Scene } from '../../engine'
import type { SceneNode } from '../../engine'
import { walkPreOrder } from '../../engine/sceneNode'
import type { DispatchCommand } from '../../engine/commands'
import { MoveNodeCommand, TransactionCommand } from '../../engine/commands'
import type { SelectionActions } from '../../stores/selectionStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { findAlignment } from './alignment'
import { DEFAULT_GRID_STEP, snapDelta } from './gridSnap'
import type { NodeSizeSource } from './hitTest'
import {
  aabbOf,
  nodesIntersectingRect,
  topmostNodeAt,
  worldAabbOf,
  worldTransformOf,
} from './hitTest'
import { cursorToWorld } from './screenToWorld'
import { expandRect, mergeRect, rectIntersects, rectOf } from './worldGeometry'
import type { WorldPoint, WorldRect, WorldTransform } from './worldGeometry'
import { AnimatedMoveGesture } from './animatedMove'
import type { PositionCommit } from './animatedMove'

export interface MoveOptions {
  readonly gridSnap: boolean
  readonly gridStep: number
}

export interface PreviewController {
  setPosition(nodeId: string, x: number, y: number): void
  clear(): void
}

export interface GuideController {
  show(vertical: readonly number[], horizontal: readonly number[], span: WorldRect): void
  clear(): void
}

export interface CanvasSelectionContext {
  readonly canvas: HTMLCanvasElement
  readonly engine?: EngineReadOnly
  readonly getScene: () => Scene | null
  readonly getCamera: () => SceneNode | null
  readonly getNodeSize: NodeSizeSource
  readonly store: SelectionActions
  readonly dispatch?: DispatchCommand
  readonly preview?: PreviewController
  readonly guides?: GuideController
  readonly onMove?: () => void
  readonly getMoveOptions?: () => MoveOptions
  readonly getAnimationMode?: () => boolean
}

const MARQUEE_START_DISTANCE = 4
const MOVE_START_DISTANCE = 2
const ALIGN_THRESHOLD_PX = 8
const NEARBY_MARGIN_PX = 150

export class CanvasSelection {
  readonly #canvas: HTMLCanvasElement
  readonly #getScene: () => Scene | null
  readonly #getCamera: () => SceneNode | null
  readonly #getNodeSize: NodeSizeSource
  readonly #store: SelectionActions
  readonly #dispatch?: DispatchCommand
  readonly #preview?: PreviewController
  readonly #guides?: GuideController
  readonly #onMove?: () => void
  readonly #getMoveOptions?: () => MoveOptions
  #attached = false
  #pressed = false
  #pressedOnNode = false
  #marqueeActive = false
  #startClientX = 0
  #startClientY = 0
  #startWorld: WorldPoint | null = null
  #sceneAtDown: Scene | null = null
  #canMove = false
  #moveActive = false
  #moveAnchorId: string | null = null
  #moveCandidateIds: string[] = []
  readonly #animatedMove: AnimatedMoveGesture
  readonly #moveCurrent = new Map<string, { x: number; y: number }>()
  readonly #guideOthers: WorldRect[] = []
  readonly #guideMovingIds = new Set<string>()

  constructor(context: CanvasSelectionContext) {
    this.#canvas = context.canvas
    this.#getScene = context.getScene
    this.#getCamera = context.getCamera
    this.#getNodeSize = context.getNodeSize
    this.#store = context.store
    this.#dispatch = context.dispatch
    this.#preview = context.preview
    this.#guides = context.guides
    this.#onMove = context.onMove
    this.#getMoveOptions = context.getMoveOptions
    this.#animatedMove = new AnimatedMoveGesture(context)
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
    this.#resetMove()
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
        const selected = useSelectionStore.getState().selectedIds
        if (!selected.includes(hit)) {
          this.#store.select(hit)
        }
      }
    }
    const modifiers = event.ctrlKey || event.metaKey || event.shiftKey
    this.#canMove = hit !== null && !modifiers && this.#moveEnabled()
    if (hit !== null && this.#canMove) {
      this.#beginMove(hit)
    }
  }

  readonly #onMouseMove = (event: MouseEvent): void => {
    if (!this.#pressed) {
      return
    }
    if (this.#pressedOnNode) {
      if (this.#canMove) {
        this.#handleMove(event)
      } else if (this.#animatedMove.blocked) {
        this.#handleBlockedMove(event)
      }
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
    if (this.#moveActive) {
      this.#commitMove()
    } else if (
      !this.#marqueeActive &&
      !this.#pressedOnNode &&
      this.#getScene() === this.#sceneAtDown
    ) {
      this.#store.clear()
    }
    this.#resetGesture()
  }

  #beginMove(anchorId: string): void {
    const scene = this.#getScene()
    if (!scene) {
      return
    }
    const ids = useSelectionStore.getState().selectedIds.filter((id) => scene.getNode(id))
    if (ids.length === 0) {
      return
    }
    this.#animatedMove.begin(ids)
    if (this.#animatedMove.blocked) {
      this.#canMove = false
      return
    }
    this.#moveAnchorId = anchorId
    this.#moveCandidateIds = ids
  }

  #handleBlockedMove(event: MouseEvent): void {
    this.#animatedMove.handleBlockedMove(event.clientX, event.clientY, this.#startWorld)
  }

  #handleMove(event: MouseEvent): void {
    const scene = this.#getScene()
    const camera = this.#getCamera()
    const start = this.#startWorld
    if (!scene || !camera || !start) {
      return
    }
    const current = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!current) {
      return
    }
    const rawDx = current.x - start.x
    const rawDy = current.y - start.y
    if (!this.#moveActive && Math.hypot(rawDx, rawDy) < MOVE_START_DISTANCE) {
      return
    }
    const options = this.#moveOptions()
    let dx = rawDx
    let dy = rawDy
    if (options.gridSnap && this.#moveAnchorId) {
      const anchor = this.#animatedMove.snapAnchorOf(this.#moveAnchorId)
      if (anchor) {
        const snapped = snapDelta(dx, dy, anchor.x, anchor.y, options.gridStep)
        dx = snapped.x
        dy = snapped.y
      }
    }
    this.#moveActive = true
    for (const id of this.#moveCandidateIds) {
      const position = this.#animatedMove.positionOf(id, dx, dy)
      if (!position) {
        continue
      }
      const entry = this.#moveCurrent.get(id)
      if (entry) {
        entry.x = position.x
        entry.y = position.y
      } else {
        this.#moveCurrent.set(id, position)
      }
      this.#preview?.setPosition(id, position.x, position.y)
    }
    this.#updateGuides()
    this.#onMove?.()
  }

  #commitMove(): void {
    const dispatch = this.#dispatch
    if (!dispatch) {
      return
    }
    if (this.#animatedMove.enabled) {
      const positions: PositionCommit[] = []
      for (const id of this.#moveCandidateIds) {
        const current = this.#moveCurrent.get(id)
        if (!current) {
          continue
        }
        positions.push({ nodeId: id, x: current.x, y: current.y })
      }
      this.#animatedMove.commit(positions)
      return
    }
    const moves: MoveNodeCommand[] = []
    for (const id of this.#moveCandidateIds) {
      const current = this.#moveCurrent.get(id)
      if (!current) {
        continue
      }
      moves.push(new MoveNodeCommand({ nodeId: id, x: current.x, y: current.y }))
    }
    if (moves.length === 0) {
      return
    }
    dispatch(new TransactionCommand(moves))
  }

  #updateGuides(): void {
    const guides = this.#guides
    if (!guides) {
      return
    }
    const scene = this.#getScene()
    const viewport = this.#viewportWorld()
    const moving = this.#movingBounds()
    if (!scene || !viewport || !moving) {
      guides.clear()
      return
    }
    const camera = this.#getCamera()
    const zoom = camera ? Math.abs(camera.transform.scaleX) || 1 : 1
    const nearby = expandRect(moving, NEARBY_MARGIN_PX / zoom)
    this.#guideOthers.length = 0
    this.#guideMovingIds.clear()
    for (const id of this.#moveCandidateIds) {
      this.#guideMovingIds.add(id)
    }
    for (const node of walkPreOrder(scene.root)) {
      if (node.components.camera || this.#guideMovingIds.has(node.id)) {
        continue
      }
      const aabb = worldAabbOf(scene, node.id, this.#getNodeSize)
      if (aabb && rectIntersects(nearby, aabb)) {
        this.#guideOthers.push(aabb)
      }
    }
    const threshold = ALIGN_THRESHOLD_PX / zoom
    const result = findAlignment(
      moving,
      this.#guideOthers,
      { x: (viewport.minX + viewport.maxX) / 2, y: (viewport.minY + viewport.maxY) / 2 },
      threshold,
    )
    if (result.verticalLines.length > 0 || result.horizontalLines.length > 0) {
      guides.show(result.verticalLines, result.horizontalLines, viewport)
    } else {
      guides.clear()
    }
  }

  #movingBounds(): WorldRect | null {
    const scene = this.#getScene()
    if (!scene) {
      return null
    }
    let union: WorldRect | null = null
    for (const id of this.#moveCandidateIds) {
      const node = scene.getNode(id)
      const size = this.#getNodeSize(id)
      if (!node || !size) {
        continue
      }
      const transform = worldTransformOf(scene, id)
      if (!transform) {
        continue
      }
      const current = this.#moveCurrent.get(id)
      const origin = this.#animatedMove.originOf(id)
      const dx = current && origin ? current.x - origin.x : 0
      const dy = current && origin ? current.y - origin.y : 0
      const preview: WorldTransform = {
        ...transform,
        x: transform.x + dx,
        y: transform.y + dy,
      }
      const aabb = aabbOf(size, preview)
      if (!aabb) {
        continue
      }
      union = union ? mergeRect(union, aabb) : aabb
    }
    return union
  }

  #viewportWorld(): WorldRect | null {
    const camera = this.#getCamera()
    if (!camera) {
      return null
    }
    const { x, y, scaleX, scaleY } = camera.transform
    if (scaleX <= 0 || scaleY <= 0) {
      return null
    }
    const rect = this.#canvas.getBoundingClientRect()
    return {
      minX: x,
      minY: y,
      maxX: x + rect.width / scaleX,
      maxY: y + rect.height / scaleY,
    }
  }

  #moveOptions(): MoveOptions {
    return this.#getMoveOptions?.() ?? { gridSnap: false, gridStep: DEFAULT_GRID_STEP }
  }

  #moveEnabled(): boolean {
    return this.#dispatch !== undefined && this.#preview !== undefined
  }

  #resetGesture(): void {
    this.#pressed = false
    this.#pressedOnNode = false
    this.#marqueeActive = false
    this.#startWorld = null
    this.#sceneAtDown = null
    this.#resetMove()
  }

  #resetMove(): void {
    this.#guides?.clear()
    this.#preview?.clear()
    this.#canMove = false
    this.#moveActive = false
    this.#moveAnchorId = null
    this.#moveCandidateIds = []
    this.#animatedMove.reset()
    this.#moveCurrent.clear()
  }
}
