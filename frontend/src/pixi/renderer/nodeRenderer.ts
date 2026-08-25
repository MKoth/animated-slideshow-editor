import type { SceneNode } from '../../engine'
import type { MeshFace, MeshVertex } from '../../engine/mesh'
import type { EvaluatedNodeState } from '../../engine/animationEvaluator'
import type { PixiContainer, PixiGraphics, RendererPixi } from './pixi'
import {
  applyPlaceholderName,
  applyTint,
  createPlaceholder,
  setBoneSize,
  setMeshPlaceholderSize,
} from './placeholder'
import type { TextureCache } from './textureCache'

const placeholderByContainer = new WeakMap<PixiContainer, PixiContainer>()
const meshGraphicsByGroup = new WeakMap<PixiContainer, PixiGraphics>()

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
  if (node.components.mesh) {
    const meshPlaceholder = createMeshPlaceholder(pixi, node)
    placeholderByContainer.set(container, meshPlaceholder)
    container.addChild(meshPlaceholder)
  } else if (node.components.assetInstance || node.components.text) {
    const textureKey = node.components.assetInstance?.assetDefinitionId ?? node.id
    const placeholder = createPlaceholder(pixi, node, cache, textureKey)
    placeholderByContainer.set(container, placeholder)
    container.addChild(placeholder)
  } else if (node.components.bone) {
    const bonePlaceholder = createBonePlaceholder(pixi, node, node.components.bone.length)
    placeholderByContainer.set(container, bonePlaceholder)
    container.addChild(bonePlaceholder)
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

function createBonePlaceholder(pixi: RendererPixi, node: SceneNode, length: number): PixiContainer {
  const group = new pixi.Container()
  group.label = `placeholder:${node.name}`

  const graphics = new pixi.Graphics()
  graphics.moveTo(0, 0).lineTo(length, 0).stroke({ width: 4, color: 0xff0000 })
  graphics.circle(0, 0, 5).fill({ color: 0xff0000 })
  graphics.circle(length, 0, 5).fill({ color: 0xff0000 })
  group.addChild(graphics)

  const label = new pixi.Text({
    text: node.name,
    style: {
      fontSize: 13,
      fill: 0xffffff,
      fontWeight: '600',
      fontFamily: 'system-ui, sans-serif',
    },
  })
  label.anchor.set(0.5, 0.5)
  label.position.set(length / 2, -20)
  group.addChild(label)

  setBoneSize(group, length, 10, length / 2, 0)
  return group
}

export function createMeshPlaceholder(pixi: RendererPixi, node: SceneNode): PixiContainer {
  const mesh = node.components.mesh?.mesh
  const group = new pixi.Container()
  group.label = `placeholder:${node.name}`

  if (mesh && mesh.vertices.length > 0) {
    const graphics = new pixi.Graphics()
    meshGraphicsByGroup.set(group, graphics)
    group.addChild(graphics)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const v of mesh.vertices) {
      if (v.x < minX) minX = v.x
      if (v.y < minY) minY = v.y
      if (v.x > maxX) maxX = v.x
      if (v.y > maxY) maxY = v.y
    }
    const w = maxX - minX
    const h = maxY - minY
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    setMeshPlaceholderSize(group, w, h, cx, cy)
  } else {
    setMeshPlaceholderSize(group, 100, 100, 0, 0)
  }

  return group
}

export function applyMeshVertices(
  container: PixiContainer,
  vertices: readonly MeshVertex[],
  faces: readonly MeshFace[],
): void {
  const group = placeholderByContainer.get(container)
  const graphics = group ? meshGraphicsByGroup.get(group) : undefined
  if (!graphics) return
  graphics.clear()
  for (const face of faces) {
    const v0 = vertices[face.v0]
    const v1 = vertices[face.v1]
    const v2 = vertices[face.v2]
    if (!v0 || !v1 || !v2) continue
    graphics
      .moveTo(v0.x, v0.y)
      .lineTo(v1.x, v1.y)
      .lineTo(v2.x, v2.y)
      .closePath()
      .fill({ color: 0x8ab4f8, alpha: 0.55 })
      .stroke({ width: 1, color: 0x1a73e8, alpha: 0.9 })
  }
}
