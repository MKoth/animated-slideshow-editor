import type { SceneNode } from '../../engine'
import type { PixiContainer, RendererPixi } from './pixi'
import { createPlaceholder } from './placeholder'

export function createNodeContainer(pixi: RendererPixi, node: SceneNode): PixiContainer {
  const container = new pixi.Container()
  container.label = node.name
  applyTransform(container, node)
  container.visible = node.visible
  if (node.components.assetInstance || node.components.text) {
    container.addChild(createPlaceholder(pixi, node))
  }
  return container
}

export function applyTransform(container: PixiContainer, node: SceneNode): void {
  container.position.set(node.transform.x, node.transform.y)
  container.rotation = node.transform.rotation
  container.scale.set(node.transform.scaleX, node.transform.scaleY)
}
