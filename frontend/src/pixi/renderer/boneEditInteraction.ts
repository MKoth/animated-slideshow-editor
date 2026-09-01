import type { Scene } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import { UpdateBoneCommand } from '../../engine/commands'
import { useBoneEditStore } from '../../stores/boneEditStore'
import type { BoneJoint } from '../../stores/boneEditStore'
import { cursorToWorld } from './screenToWorld'
import type { ViewportTransform, WorldPoint, WorldTransform } from './worldGeometry'
import { worldTransformOf } from '../../engine/worldTransform'
import type { WorldTransformSource } from './hitTest'
import { walkPreOrder } from '../../engine/sceneNode'
import type { RendererPixi, PixiContainer, PixiGraphics } from './pixi'
import type { BoneEditOverlay } from './boneEditOverlay'

export interface BoneEditContext {
  readonly canvas: HTMLCanvasElement
  readonly pixi: RendererPixi
  readonly world: PixiContainer
  readonly getScene: () => Scene | null
  readonly getCameraTransform: () => ViewportTransform | null
  readonly dispatch: DispatchCommand
  readonly getWorldTransform?: WorldTransformSource
  readonly overlay: BoneEditOverlay
}

function localToWorld(localX: number, localY: number, transform: WorldTransform): WorldPoint {
  const cos = Math.cos(transform.rotation)
  const sin = Math.sin(transform.rotation)
  const sx = localX * transform.scaleX
  const sy = localY * transform.scaleY
  return {
    x: sx * cos - sy * sin + transform.x,
    y: sx * sin + sy * cos + transform.y,
  }
}

function pointToSegmentDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return (px - ax) ** 2 + (py - ay) ** 2
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return (px - cx) ** 2 + (py - cy) ** 2
}

export class BoneEditInteraction {
  readonly #canvas: HTMLCanvasElement
  readonly #pixi: RendererPixi
  readonly #world: PixiContainer
  readonly #getScene: () => Scene | null
  readonly #getCameraTransform: () => ViewportTransform | null
  readonly #dispatch: DispatchCommand
  readonly #getWorldTransform?: WorldTransformSource
  readonly #overlay: BoneEditOverlay
  #attached = false
  #dragging = false
  #dragJoint: BoneJoint | null = null
  #dragBoneId: string | null = null
  #startHead: WorldPoint | null = null
  #startTail: WorldPoint | null = null
  #original: { x: number; y: number; rotation: number; length: number } | null = null
  #previewGraphics: PixiGraphics | null = null
  #lastMouse: WorldPoint | null = null

  constructor(context: BoneEditContext) {
    this.#canvas = context.canvas
    this.#pixi = context.pixi
    this.#world = context.world
    this.#getScene = context.getScene
    this.#getCameraTransform = context.getCameraTransform
    this.#dispatch = context.dispatch
    this.#getWorldTransform = context.getWorldTransform
    this.#overlay = context.overlay
  }

  attach(): void {
    if (this.#attached) return
    this.#attached = true
    const g = new this.#pixi.Graphics()
    g.label = 'bone-edit-preview'
    this.#previewGraphics = g
    this.#world.addChild(g)
    this.#canvas.addEventListener('mousedown', this.#onMouseDown)
    window.addEventListener('mousemove', this.#onMouseMove)
    window.addEventListener('mouseup', this.#onMouseUp)
    window.addEventListener('keydown', this.#onKeyDown)
  }

  detach(): void {
    if (!this.#attached) return
    this.#attached = false
    this.#resetDrag()
    this.#previewGraphics?.destroy()
    this.#previewGraphics = null
    this.#canvas.removeEventListener('mousedown', this.#onMouseDown)
    window.removeEventListener('mousemove', this.#onMouseMove)
    window.removeEventListener('mouseup', this.#onMouseUp)
    window.removeEventListener('keydown', this.#onKeyDown)
  }

  bringToFront(): void {
    if (this.#previewGraphics) this.#world.addChild(this.#previewGraphics)
    this.#overlay.bringToFront()
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      const { isEditing } = useBoneEditStore.getState()
      if (isEditing) {
        // If dragging, cancel drag first
        if (this.#dragging) {
          this.#resetDrag()
          return
        }
        useBoneEditStore.getState().exit()
        this.#overlay.redraw()
      }
    }
  }

  readonly #onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0) return
    const { isEditing, selectedBoneId } = useBoneEditStore.getState()
    if (!isEditing) return
    const scene = this.#getScene()
    const camera = this.#getCameraTransform()
    if (!scene || !camera) return
    const point = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!point) return

    if (!selectedBoneId) {
      const hit = this.#hitTestBone(point.x, point.y, scene)
      if (hit) {
        useBoneEditStore.getState().setSelectedBoneId(hit)
        this.#overlay.redraw()
        const joint = this.#hitTestJoint(point.x, point.y, scene, hit)
        if (joint) {
          useBoneEditStore.getState().setSelectedJoint(joint)
          this.#overlay.redraw()
          this.#startDrag(hit, joint, scene)
          this.#lastMouse = point
          this.#drawPreview(point)
        }
      }
      return
    }

    const joint = this.#hitTestJoint(point.x, point.y, scene, selectedBoneId)
    if (joint) {
      useBoneEditStore.getState().setSelectedJoint(joint)
      this.#overlay.redraw()
      this.#startDrag(selectedBoneId, joint, scene)
      this.#lastMouse = point
      this.#drawPreview(point)
      return
    }

    const boneHit = this.#hitTestBone(point.x, point.y, scene)
    if (boneHit) {
      if (boneHit !== selectedBoneId) {
        useBoneEditStore.getState().setSelectedBoneId(boneHit)
        useBoneEditStore.getState().setSelectedJoint(null)
        this.#overlay.redraw()
      }
      const j2 = this.#hitTestJoint(point.x, point.y, scene, boneHit)
      if (j2) {
        useBoneEditStore.getState().setSelectedJoint(j2)
        this.#overlay.redraw()
        this.#startDrag(boneHit, j2, scene)
        this.#lastMouse = point
        this.#drawPreview(point)
      }
      return
    }

    useBoneEditStore.getState().setSelectedJoint(null)
    this.#overlay.redraw()
  }

  #startDrag(boneId: string, joint: BoneJoint, scene: Scene): void {
    const wt = this.#resolveTransform(scene, boneId)
    const node = scene.getNode(boneId)
    if (!wt || !node || !node.components.bone) return
    const length = node.components.bone.length
    const head = { x: wt.x, y: wt.y }
    const tail = localToWorld(length, 0, wt)
    this.#dragging = true
    this.#dragJoint = joint
    this.#dragBoneId = boneId
    this.#startHead = head
    this.#startTail = tail
    this.#original = {
      x: node.transform.x,
      y: node.transform.y,
      rotation: node.transform.rotation,
      length,
    }
  }

  readonly #onMouseMove = (event: MouseEvent): void => {
    if (!this.#dragging || !this.#dragBoneId || !this.#dragJoint) return
    const camera = this.#getCameraTransform()
    if (!camera) return
    const point = cursorToWorld(this.#canvas, camera, event.clientX, event.clientY)
    if (!point) return
    this.#lastMouse = point
    this.#drawPreview(point)
  }

  #drawPreview(mouse: WorldPoint): void {
    const g = this.#previewGraphics
    if (!g || !this.#dragBoneId || !this.#dragJoint || !this.#startHead || !this.#startTail) return
    g.clear()
    if (this.#dragJoint === 'head') {
      const newHead = mouse
      const tail = this.#startTail
      // dashed preview line
      const dx = tail.x - newHead.x
      const dy = tail.y - newHead.y
      const len = Math.hypot(dx, dy)
      if (len > 0.01) {
        const nx = dx / len
        const ny = dy / len
        const dash = 10
        const gap = 6
        let pos = 0
        while (pos < len) {
          const sX = newHead.x + nx * pos
          const sY = newHead.y + ny * pos
          const ePos = Math.min(pos + dash, len)
          const eX = newHead.x + nx * ePos
          const eY = newHead.y + ny * ePos
          g.moveTo(sX, sY).lineTo(eX, eY).stroke({ width: 4, color: 0x1a73e8, alpha: 0.6 })
          pos += dash + gap
        }
      }
      g.circle(newHead.x, newHead.y, 8)
        .fill({ color: 0x1a73e8, alpha: 0.9 })
        .stroke({ width: 2, color: 0xffffff })
      g.circle(tail.x, tail.y, 7)
        .fill({ color: 0xff0000, alpha: 0.9 })
        .stroke({ width: 2, color: 0xffffff })
    } else {
      const head = this.#startHead
      const newTail = mouse
      const dx = newTail.x - head.x
      const dy = newTail.y - head.y
      const len = Math.hypot(dx, dy)
      if (len > 0.01) {
        const nx = dx / len
        const ny = dy / len
        const dash = 10
        const gap = 6
        let pos = 0
        while (pos < len) {
          const sX = head.x + nx * pos
          const sY = head.y + ny * pos
          const ePos = Math.min(pos + dash, len)
          const eX = head.x + nx * ePos
          const eY = head.y + ny * ePos
          g.moveTo(sX, sY).lineTo(eX, eY).stroke({ width: 4, color: 0x1a73e8, alpha: 0.6 })
          pos += dash + gap
        }
      }
      g.circle(head.x, head.y, 7)
        .fill({ color: 0xff0000, alpha: 0.9 })
        .stroke({ width: 2, color: 0xffffff })
      g.circle(newTail.x, newTail.y, 8)
        .fill({ color: 0x1a73e8, alpha: 0.9 })
        .stroke({ width: 2, color: 0xffffff })
    }
  }

  readonly #onMouseUp = (event: MouseEvent): void => {
    if (
      !this.#dragging ||
      !this.#dragBoneId ||
      !this.#dragJoint ||
      !this.#original ||
      !this.#startHead
    ) {
      this.#resetDrag()
      return
    }
    const scene = this.#getScene()
    const camera = this.#getCameraTransform()
    if (!scene || !camera) {
      this.#resetDrag()
      return
    }
    const point =
      cursorToWorld(this.#canvas, camera, event.clientX, event.clientY) ?? this.#lastMouse
    if (!point) {
      this.#resetDrag()
      return
    }
    const boneId = this.#dragBoneId
    const node = scene.getNode(boneId)
    if (!node) {
      this.#resetDrag()
      return
    }

    // Compute new values assuming parent is root (world == local). For general hierarchy we would need to convert.
    // For now support root children only; for deeper hierarchy we still compute world delta and apply inverse via parent world.
    const parent = node.parent
    const parentWorld = parent ? this.#resolveTransform(scene, parent.id) : null

    if (this.#dragJoint === 'head') {
      // Move head to mouse world point: convert world to parent local
      let newLocalX = point.x
      let newLocalY = point.y
      if (parentWorld) {
        // Inverse transform: world -> parent local
        const dx = point.x - parentWorld.x
        const dy = point.y - parentWorld.y
        const cos = Math.cos(-parentWorld.rotation)
        const sin = Math.sin(-parentWorld.rotation)
        const rx = dx * cos - dy * sin
        const ry = dx * sin + dy * cos
        newLocalX = rx / (parentWorld.scaleX || 1)
        newLocalY = ry / (parentWorld.scaleY || 1)
      }
      // Keep rotation/length same, only move head
      if (newLocalX !== this.#original.x || newLocalY !== this.#original.y) {
        this.#dispatch(new UpdateBoneCommand({ nodeId: boneId, x: newLocalX, y: newLocalY }))
      }
    } else {
      // Tail drag: keep head fixed, compute new length/rotation from head to mouse
      const head = this.#startHead
      const dx = point.x - head.x
      const dy = point.y - head.y
      const newLength = Math.hypot(dx, dy)
      if (newLength < 1) {
        this.#resetDrag()
        return
      }
      const worldRotation = Math.atan2(dy, dx)
      // Convert world rotation to local rotation: subtract parent world rotation
      let newLocalRotation = worldRotation
      if (parentWorld) {
        newLocalRotation = worldRotation - parentWorld.rotation
        // Normalize not needed, engine will normalize
      }
      // Also need to account for parent scale for length: world length = local length * parentScaleX? Actually world length = local length * worldScale? For root child worldScale = parentScale * localScale. Parent scale already in parentWorld.scaleX. But node's own scale also affects.
      // For simplicity assume scales are 1; compute local length as world length / parentScale
      let newLocalLength = newLength
      if (parentWorld) {
        const parentScale = Math.max(Math.abs(parentWorld.scaleX), 0.001)
        newLocalLength = newLength / parentScale
        // Also divide by node's own scale? Node's scale is 1 by default
      }
      // Only dispatch if changed
      const needsUpdate =
        Math.abs(newLocalLength - this.#original.length) > 0.01 ||
        Math.abs(newLocalRotation - this.#original.rotation) > 0.001
      if (needsUpdate) {
        this.#dispatch(
          new UpdateBoneCommand({
            nodeId: boneId,
            length: newLocalLength,
            rotation: newLocalRotation,
          }),
        )
      }
    }

    this.#resetDrag()
  }

  #resetDrag(): void {
    this.#dragging = false
    this.#dragJoint = null
    this.#dragBoneId = null
    this.#startHead = null
    this.#startTail = null
    this.#original = null
    this.#lastMouse = null
    this.#previewGraphics?.clear()
  }

  #hitTestJoint(worldX: number, worldY: number, scene: Scene, boneId: string): BoneJoint | null {
    const wt = this.#resolveTransform(scene, boneId)
    const node = scene.getNode(boneId)
    if (!wt || !node || !node.components.bone) return null
    const length = node.components.bone.length
    const head = { x: wt.x, y: wt.y }
    const tail = localToWorld(length, 0, wt)
    const scale = Math.max(Math.abs(wt.scaleX), Math.abs(wt.scaleY), 0.1)
    const threshold = 12 / scale
    if (Math.hypot(worldX - head.x, worldY - head.y) <= threshold) return 'head'
    if (Math.hypot(worldX - tail.x, worldY - tail.y) <= threshold) return 'tail'
    return null
  }

  #hitTestBone(worldX: number, worldY: number, scene: Scene): string | null {
    let bestId: string | null = null
    let bestDistSq = Infinity
    const threshold = 12
    const thresholdSq = threshold * threshold
    for (const node of walkPreOrder(scene.root)) {
      if (!node.components.bone) continue
      const wt = this.#resolveTransform(scene, node.id)
      if (!wt) continue
      const length = node.components.bone.length
      const head = { x: wt.x, y: wt.y }
      const tail = localToWorld(length, 0, wt)
      const distSq = pointToSegmentDistanceSq(worldX, worldY, head.x, head.y, tail.x, tail.y)
      if (distSq < bestDistSq && distSq <= thresholdSq) {
        bestDistSq = distSq
        bestId = node.id
      }
    }
    return bestId
  }

  #resolveTransform(scene: Scene, nodeId: string): WorldTransform | null {
    if (this.#getWorldTransform) return this.#getWorldTransform(nodeId)
    return worldTransformOf(scene, nodeId)
  }
}
