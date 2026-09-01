import type { RendererPixi, PixiContainer, PixiGraphics } from './pixi'
import type { Scene } from '../../engine'
import type { WorldTransform } from './worldGeometry'
import type { WorldTransformSource } from './hitTest'
import { worldTransformOf } from '../../engine/worldTransform'
import { useBoneEditStore } from '../../stores/boneEditStore'
import { useOverlayVisibilityStore } from '../../stores/overlayVisibilityStore'

export interface BoneEditOverlayContext {
  readonly pixi: RendererPixi
  readonly world: PixiContainer
  readonly getScene: () => Scene | null
  readonly getWorldTransform?: WorldTransformSource
}

function localToWorld(
  localX: number,
  localY: number,
  transform: WorldTransform,
): { x: number; y: number } {
  const cos = Math.cos(transform.rotation)
  const sin = Math.sin(transform.rotation)
  const scaledX = localX * transform.scaleX
  const scaledY = localY * transform.scaleY
  return {
    x: scaledX * cos - scaledY * sin + transform.x,
    y: scaledX * sin + scaledY * cos + transform.y,
  }
}

export class BoneEditOverlay {
  readonly #pixi: RendererPixi
  readonly #world: PixiContainer
  readonly #getScene: () => Scene | null
  readonly #getWorldTransform?: WorldTransformSource
  #graphics: PixiGraphics | null = null
  #attached = false
  #unsubscribeBone: (() => void) | null = null
  #unsubscribeVisibility: (() => void) | null = null

  constructor(context: BoneEditOverlayContext) {
    this.#pixi = context.pixi
    this.#world = context.world
    this.#getScene = context.getScene
    this.#getWorldTransform = context.getWorldTransform
  }

  attach(): void {
    if (this.#attached) return
    this.#attached = true
    const graphics = new this.#pixi.Graphics()
    graphics.label = 'bone-edit-overlay'
    this.#graphics = graphics
    this.#world.addChild(graphics)
    this.#unsubscribeBone = useBoneEditStore.subscribe(() => this.redraw())
    this.#unsubscribeVisibility = useOverlayVisibilityStore.subscribe(() => this.redraw())
    this.redraw()
  }

  detach(): void {
    if (!this.#attached) return
    this.#attached = false
    this.#unsubscribeBone?.()
    this.#unsubscribeBone = null
    this.#unsubscribeVisibility?.()
    this.#unsubscribeVisibility = null
    this.#graphics?.destroy()
    this.#graphics = null
  }

  bringToFront(): void {
    if (this.#graphics) this.#world.addChild(this.#graphics)
  }

  redraw(): void {
    const g = this.#graphics
    if (!g) return
    g.clear()
    if (!useOverlayVisibilityStore.getState().bonesVisible) return
    const { isEditing, selectedBoneId, selectedJoint } = useBoneEditStore.getState()
    if (!isEditing || !selectedBoneId) return
    const scene = this.#getScene()
    if (!scene) return
    const node = scene.getNode(selectedBoneId)
    if (!node || !node.components.bone) return
    const transform = this.#resolveTransform(scene, selectedBoneId)
    if (!transform) return
    const length = node.components.bone.length
    const head = { x: transform.x, y: transform.y }
    const tail = localToWorld(length, 0, transform)

    // highlight bone line
    g.moveTo(head.x, head.y)
      .lineTo(tail.x, tail.y)
      .stroke({ width: 6, color: 0x1a73e8, alpha: 0.25 })

    // head handle
    const headColor = selectedJoint === 'head' ? 0x1a73e8 : 0xffffff
    const headFill = selectedJoint === 'head' ? 0x1a73e8 : 0xff0000
    g.circle(head.x, head.y, 7)
      .fill({ color: headFill, alpha: 0.9 })
      .stroke({ width: 2, color: headColor })
    // tail handle
    const tailColor = selectedJoint === 'tail' ? 0x1a73e8 : 0xffffff
    const tailFill = selectedJoint === 'tail' ? 0x1a73e8 : 0xff0000
    g.circle(tail.x, tail.y, 7)
      .fill({ color: tailFill, alpha: 0.9 })
      .stroke({ width: 2, color: tailColor })
  }

  #resolveTransform(scene: Scene, nodeId: string): WorldTransform | null {
    if (this.#getWorldTransform) return this.#getWorldTransform(nodeId)
    return worldTransformOf(scene, nodeId)
  }
}
