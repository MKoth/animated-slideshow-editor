import type { SceneNode } from '../../engine'
import type { PixiContainer, RendererPixi } from './pixi'
import { applyPlaceholderName, createPlaceholder } from './placeholder'
import type { TextureCache } from './textureCache'

export function createNodeContainer(
  pixi: RendererPixi,
  node: SceneNode,
  cache: TextureCache,
): PixiContainer {
  const container = new pixi.Container()
  container.label = node.name
  applyTransform(container, node)
  container.visible = node.visible
  container.alpha = node.opacity
  if (node.components.assetInstance || node.components.text) {
    container.addChild(createPlaceholder(pixi, node, cache))
  }
  return container
}

export function applyTransform(container: PixiContainer, node: SceneNode): void {
  container.position.set(node.transform.x, node.transform.y)
  container.rotation = node.transform.rotation
  container.scale.set(node.transform.scaleX, node.transform.scaleY)
}

export function applyName(container: PixiContainer, node: SceneNode): void {
  container.label = node.name
  const placeholder = container.children[0]
  if (placeholder && placeholder.label.startsWith('placeholder:')) {
    applyPlaceholderName(placeholder, node.name)
  }
}
