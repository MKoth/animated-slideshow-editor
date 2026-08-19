import type { SceneNode } from '../../engine'
import type { EvaluatedNodeState } from '../../engine/animationEvaluator'
import type { PixiContainer, RendererPixi } from './pixi'
import { applyPlaceholderName, applyTint, createPlaceholder } from './placeholder'
import type { TextureCache } from './textureCache'

const placeholderByContainer = new WeakMap<PixiContainer, PixiContainer>()

export function placeholderOf(container: PixiContainer): PixiContainer | undefined {
  return placeholderByContainer.get(container)
}

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
    const textureKey = node.components.assetInstance?.assetDefinitionId ?? node.id
    const placeholder = createPlaceholder(pixi, node, cache, textureKey)
    placeholderByContainer.set(container, placeholder)
    container.addChild(placeholder)
  }
  return container
}

export function applyTransform(container: PixiContainer, node: SceneNode): void {
  applyPivot(container, node.transform.localPivot)
  container.position.set(node.transform.x, node.transform.y)
  container.rotation = node.transform.rotation
  container.scale.set(node.transform.scaleX, node.transform.scaleY)
}

export function applyEvaluatedState(
  container: PixiContainer,
  state: EvaluatedNodeState,
  opacityMultiplier: number,
): void {
  applyPivot(container, state.transform.localPivot)
  container.position.set(state.transform.x, state.transform.y)
  container.rotation = state.transform.rotation
  container.scale.set(state.transform.scaleX, state.transform.scaleY)
  container.alpha = state.opacity * opacityMultiplier
}

function applyPivot(
  container: PixiContainer,
  pivot?: { readonly x: number; readonly y: number },
): void {
  if (pivot) {
    container.pivot.set(pivot.x, pivot.y)
  } else {
    container.pivot.set(0, 0)
  }
}

export function applyMaterialTint(container: PixiContainer, tint: string): void {
  const placeholder = placeholderByContainer.get(container)
  if (placeholder) {
    applyTint(placeholder, tint)
  }
}

export function applyName(container: PixiContainer, node: SceneNode): void {
  container.label = node.name
  const placeholder = container.children[0]
  if (placeholder && placeholder.label.startsWith('placeholder:')) {
    applyPlaceholderName(placeholder, node.name)
  }
}
