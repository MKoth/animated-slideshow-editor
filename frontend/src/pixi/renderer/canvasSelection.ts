import type { EnginePublic, Scene } from '../../engine'
import { isGroupNode, walkPreOrder } from '../../engine/sceneNode'
import { worldTransformOf as storedWorldTransformOf } from '../../engine/worldTransform'
import { isPivotKeyPressed } from './pivotInteraction'
import { registerShortcut } from '../../shortcuts/shortcutRegistry'
import type { DispatchCommand } from '../../engine/commands'
import { MoveNodeCommand, TransactionCommand } from '../../engine/commands'
import type { SelectionActions } from '../../stores/selectionStore'
import { useSelectionStore } from '../../stores/selectionStore'
import { useEditingModeStore } from '../../stores/editingModeStore'
import { useBoneEditStore } from '../../stores/boneEditStore'
import { findAlignment } from './alignment'
import { DEFAULT_GRID_STEP, snapDelta } from './gridSnap'
import type { NodeFilter, NodeSizeSource, WorldTransformSource, ZIndexSource } from './hitTest'
import { aabbOf, nodesAtSorted, nodesIntersectingRect, worldAabbOf } from './hitTest'
import { cursorToWorld } from './screenToWorld'
import { expandRect, mergeRect, rectIntersects, rectOf } from './worldGeometry'
import type { ViewportTransform, WorldPoint, WorldRect } from './worldGeometry'
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

export interface MarqueeController {
  show(rect: WorldRect): void
  clear(): void
}

export interface CanvasSelectionContext {
  readonly canvas: HTMLCanvasElement
  readonly engine?: EnginePublic
  readonly getScene: () => Scene | null
  readonly getCameraTransform: () => ViewportTransform | null
  readonly getNodeSize: NodeSizeSource
  readonly store: SelectionActions
  readonly dispatch?: DispatchCommand
  readonly preview?: PreviewController
  readonly guides?: GuideController
  readonly onMove?: () => void
  readonly getMoveOptions?: () => MoveOptions
  readonly getAnimationMode?: () => boolean
  readonly getWorldTransform?: WorldTransformSource
  readonly getNodeFilter?: () => NodeFilter | null
  readonly getZIndex?: ZIndexSource
  readonly marquee?: MarqueeController
  readonly isIKHandleAt?: (worldX: number, worldY: number) => boolean
}

const MARQUEE_START_DISTANCE = 4
const MOVE_START_DISTANCE = 2
const ALIGN_THRESHOLD_PX = 8
const NEARBY_MARGIN_PX = 150
const CYCLE_CLICK_DISTANCE_PX = 5

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

function sameIdList(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false
    }
  }
  return true
}

export class CanvasSelection {
  readonly #canvas: HTMLCanvasElement
  readonly #getScene: () => Scene | null
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #getNodeSize: NodeSizeSource
  readonly #store: SelectionActions
  readonly #dispatch?: DispatchCommand
  readonly #preview?: PreviewController
  readonly #guides?: GuideController
  readonly #onMove?: () => void
  readonly #getMoveOptions?: () => MoveOptions
  readonly #getWorldTransform?: WorldTransformSource
  readonly #getNodeFilter?: () => NodeFilter | null
  readonly #getZIndex?: ZIndexSource
  readonly #marquee?: MarqueeController
  readonly #isIKHandleAt?: (worldX: number, worldY: number) => boolean
  #disposeEscape: (() => void) | null = null
  #attached = false
  #pressed = false
  #pressedOnNode = false
  #marqueeActive = false
  #startClientX = 0
  #startClientY = 0
  #startWorld: WorldPoint | null = null
  #sceneAtDown: Scene | null = null
  #cycleIds: string[] = []
  #cycleIndex = -1
  #lastClickClientX: number | null = null
  #lastClickClientY: number | null = null
  #pressStacked: string[] = []
  #pressPending = false
  #pressIsMoveOfSelection = false
  #pressCtrl = false
  #pressShift = false
  #pressContinuesCycle = false
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
    this.#getCameraTransform = context.getCameraTransform
    this.#getNodeSize = context.getNodeSize
    this.#store = context.store
    this.#dispatch = context.dispatch
    this.#preview = context.preview
    this.#guides = context.guides
    this.#onMove = context.onMove
    this.#getMoveOptions = context.getMoveOptions
    this.#getWorldTransform = context.getWorldTransform
    this.#getNodeFilter = context.getNodeFilter
    this.#getZIndex = context.getZIndex
    this.#marquee = context.marquee
    this.#isIKHandleAt = context.isIKHandleAt
    this.#animatedMove = new AnimatedMoveGesture(context)
  }

  readonly #transformOf: WorldTransformSource = (nodeId) => {
    const transform = this.#getWorldTransform
    if (transform) {
      return transform(nodeId)
    }
    const scene = this.#getScene()
    return scene ? storedWorldTransformOf(scene, nodeId) : null
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
    this.#disposeEscape = registerShortcut('escape', this.#onEscape)
  }

  detach(): void {
    if (!this.#attached) {
      return
    }
    this.#attached = false
    this.#resetGesture()
    this.#resetCycle()
    this.#canvas.removeEventListener('mousedown', this.#onMouseDown)
    this.#canvas.removeEventListener('contextmenu', this.#onContextMenu)
    window.removeEventListener('mousemove', this.#onMouseMove)
    window.removeEventListener('mouseup', this.#onMouseUp)
    this.#disposeEscape?.()
    this.#disposeEscape = null
  }

  /** Figma-style drill-out: Esc climbs from the selected node to its nearest parent group. */
  readonly #onEscape = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) {
      return
    }
    const scene = this.#getScene()
    if (!scene) {
      return
    }
    const selected = useSelectionStore.getState().selectedIds
    if (selected.length !== 1) {
      return
    }
    const node = scene.getNode(selected[0] ?? '')
    if (!node) {
      return
    }
    for (let cursor = node.parent; cursor !== null; cursor = cursor.parent) {
      if (cursor.id !== scene.root.id && isGroupNode(cursor)) {
        this.#store.select(cursor.id)
        this.#resetCycle()
        return
      }
    }
  }

  #resetCycle(): void {
    this.#cycleIds = []
    this.#cycleIndex = -1
    this.#lastClickClientX = null
    this.#lastClickClientY = null
  }

  #recordClick(clientX: number, clientY: number): void {
    this.#lastClickClientX = clientX
    this.#lastClickClientY = clientY
  }

  /**
   * Same-spot repeat click, regardless of pace. There is deliberately no
   * time limit — deliberate cycling clicks are seconds apart. Staleness is
   * guarded structurally instead: the cached stack must still match, and
   * the current selection must be the last cycled pick (any outside
   * selection change, drag, or marquee resets the chain).
   */
  #isSameSpotClick(clientX: number, clientY: number): boolean {
    if (this.#lastClickClientX === null || this.#lastClickClientY === null) {
      return false
    }
    const moved = Math.hypot(clientX - this.#lastClickClientX, clientY - this.#lastClickClientY)
    return moved <= CYCLE_CLICK_DISTANCE_PX
  }

  readonly #onContextMenu = (event: MouseEvent): void => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
    }
  }

  readonly #onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || event.altKey || isPivotKeyPressed()) {
      return
    }
    const { mode } = useEditingModeStore.getState()
    const { isEditing: boneEditing } = useBoneEditStore.getState()
    if (
      mode === 'boneCreation' ||
      mode === 'ikTarget' ||
      mode === 'poleVector' ||
      mode === 'meshEdit' ||
      mode === 'weightPaint' ||
      boneEditing
    ) {
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
    if (this.#isIKHandleAt?.(point.x, point.y)) {
      return
    }
    this.#resetMove()
    this.#pressed = true
    this.#sceneAtDown = scene
    this.#startClientX = event.clientX
    this.#startClientY = event.clientY
    this.#startWorld = point
    const filter = this.#getNodeFilter?.() ?? null
    const ctrl = event.ctrlKey || event.metaKey
    const shift = event.shiftKey
    const modifiers = ctrl || shift
    const stacked = nodesAtSorted(
      scene,
      point,
      this.#getNodeSize,
      this.#transformOf,
      filter,
      this.#getZIndex ?? null,
    )
    const selected = useSelectionStore.getState().selectedIds
    this.#pressStacked = [...stacked]
    this.#pressPending = false
    this.#pressIsMoveOfSelection = false
    this.#pressCtrl = ctrl
    this.#pressShift = shift
    this.#pressContinuesCycle = this.#isSameSpotClick(event.clientX, event.clientY)
    this.#recordClick(event.clientX, event.clientY)
    const top = stacked[0] ?? null
    let moveAnchor: string | null = null
    if (top !== null && !modifiers && selected.some((id) => stacked.includes(id))) {
      // Pressed on top of the current selection: the gesture manipulates
      // the selection (press-and-hold drags it). The click-select/cycle
      // decision is deferred to mouse-up, so pressing down to drag a
      // cycled-to object never re-picks or advances past it.
      this.#pressIsMoveOfSelection = true
      moveAnchor = top
    } else if (top !== null) {
      // Pressed on an unselected node: defer selection — a quick
      // press-and-release applies the click (select/toggle/extend/cycle)
      // on mouse-up, while a plain press-and-drag grabs the topmost node.
      this.#pressPending = true
    } else if (!modifiers) {
      // Clicking the empty interior of an already-selected group keeps the
      // group so it can be dragged (clicking a child still drills into it).
      moveAnchor = this.#selectedGroupAt(scene, selected, point)
      if (moveAnchor !== null) {
        this.#pressIsMoveOfSelection = true
      }
    }
    this.#pressedOnNode = top !== null || this.#pressIsMoveOfSelection
    this.#canMove = this.#pressIsMoveOfSelection && this.#moveEnabled()
    if (moveAnchor !== null && this.#canMove) {
      this.#beginMove(moveAnchor)
    }
  }

  /**
   * Applies the deferred click selection on mouse-up (quick press without
   * a drag): plain clicks select the topmost node or advance the
   * same-spot cycle, ctrl/cmd toggles, shift extends.
   */
  #applyClickSelection(): void {
    const stacked = this.#pressStacked
    if (stacked.length === 0) {
      // Pressed the empty interior of the selected group: keep it.
      return
    }
    const top = stacked[0] ?? null
    if (!top) {
      return
    }
    if (this.#pressCtrl) {
      this.#store.toggle(top)
      this.#resetCycle()
      return
    }
    if (this.#pressShift) {
      this.#store.extend(top)
      this.#resetCycle()
      return
    }
    const selected = useSelectionStore.getState().selectedIds
    if (
      this.#pressContinuesCycle &&
      this.#cycleIds.length > 0 &&
      sameIdList(this.#cycleIds, stacked) &&
      selected.length === 1 &&
      selected[0] === this.#cycleIds[this.#cycleIndex]
    ) {
      this.#cycleIndex = (this.#cycleIndex + 1) % stacked.length
      const next = stacked[this.#cycleIndex] ?? null
      if (next) {
        this.#store.select(next)
      }
      return
    }
    this.#cycleIds = [...stacked]
    this.#cycleIndex = 0
    if (!selected.includes(top)) {
      this.#store.select(top)
    }
  }

  #selectedGroupAt(scene: Scene, selected: readonly string[], point: WorldPoint): string | null {
    if (selected.length !== 1) {
      return null
    }
    const selectedId = selected[0]
    if (selectedId === undefined) {
      return null
    }
    const bounds = worldAabbOf(scene, selectedId, this.#getNodeSize, this.#transformOf)
    if (
      bounds &&
      point.x >= bounds.minX &&
      point.x <= bounds.maxX &&
      point.y >= bounds.minY &&
      point.y <= bounds.maxY
    ) {
      return selectedId
    }
    return null
  }

  readonly #onMouseMove = (event: MouseEvent): void => {
    if (!this.#pressed) {
      return
    }
    if (this.#pressedOnNode) {
      if (this.#pressPending) {
        // A pending press becomes a drag only for a plain press when
        // moving is possible; otherwise wait for mouse-up (quick click or
        // modifier toggle/extend).
        if (this.#pressCtrl || this.#pressShift || !this.#moveEnabled()) {
          return
        }
        const dx = event.clientX - this.#startClientX
        const dy = event.clientY - this.#startClientY
        if (Math.hypot(dx, dy) < MARQUEE_START_DISTANCE) {
          return
        }
        // Plain press-and-drag grabs the topmost node and moves it.
        const dragTop = this.#pressStacked[0] ?? null
        if (!dragTop) {
          return
        }
        this.#store.select(dragTop)
        this.#pressPending = false
        this.#pressIsMoveOfSelection = true
        this.#canMove = true
        this.#beginMove(dragTop)
      }
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
    const camera = this.#getCameraTransform()
    if (!scene || !camera || !this.#startWorld) {
      return
    }
    const current = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!current) {
      return
    }
    this.#marqueeActive = true
    this.#resetCycle()
    const filter = this.#getNodeFilter?.() ?? null
    this.#store.selectMany(
      nodesIntersectingRect(
        scene,
        rectOf(this.#startWorld, current),
        this.#getNodeSize,
        this.#transformOf,
        filter,
      ),
    )
    this.#marquee?.show(rectOf(this.#startWorld, current))
  }

  readonly #onMouseUp = (): void => {
    if (!this.#pressed) {
      return
    }
    if (this.#moveActive) {
      this.#commitMove()
    } else if (this.#pressPending || this.#pressIsMoveOfSelection) {
      // Quick press-and-release: apply the deferred click selection.
      if (this.#getScene() === this.#sceneAtDown) {
        this.#applyClickSelection()
      }
    } else if (
      !this.#marqueeActive &&
      !this.#pressedOnNode &&
      this.#getScene() === this.#sceneAtDown
    ) {
      this.#store.clear()
    }
    this.#marquee?.clear()
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
    const camera = this.#getCameraTransform()
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
    // A drag changed object positions — the cached click stack is stale.
    this.#resetCycle()
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
    const camera = this.#getCameraTransform()
    const zoom = camera ? Math.abs(camera.scaleX) || 1 : 1
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
      const aabb = worldAabbOf(scene, node.id, this.#getNodeSize, this.#transformOf)
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
      const transform = this.#transformOf(id)
      if (!transform) {
        continue
      }
      const aabb = aabbOf(size, transform)
      if (!aabb) {
        continue
      }
      union = union ? mergeRect(union, aabb) : aabb
    }
    return union
  }

  #viewportWorld(): WorldRect | null {
    const camera = this.#getCameraTransform()
    if (!camera) {
      return null
    }
    const { x, y, scaleX, scaleY } = camera
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
    this.#pressStacked = []
    this.#pressPending = false
    this.#pressIsMoveOfSelection = false
    this.#pressCtrl = false
    this.#pressShift = false
    this.#pressContinuesCycle = false
    this.#marquee?.clear()
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
