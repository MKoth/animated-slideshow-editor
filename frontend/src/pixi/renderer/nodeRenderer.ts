import type { SceneNode } from '../../engine'
import type { MeshData, MeshVertex } from '../../engine/mesh'
import type { EvaluatedNodeState } from '../../engine/animationEvaluator'
import type { PixiContainer, PixiMeshSimple, PixiMeshSimpleOptions, RendererPixi } from './pixi'
import {
  applyPlaceholderName,
  applyTint,
  createPlaceholder,
  setBoneSize,
  setMeshPlaceholderSize,
  registerMeshDisplay,
} from './placeholder'
import type { TextureCache } from './textureCache'

const placeholderByContainer = new WeakMap<PixiContainer, PixiContainer>()
const meshByGroup = new WeakMap<PixiContainer, PixiMeshSimple>()

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
    const textureKey = node.components.assetInstance?.assetDefinitionId ?? node.id
    const meshPlaceholder = createMeshPlaceholder(pixi, node, cache.get(textureKey))
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

export function createMeshPlaceholder(
  pixi: RendererPixi,
  node: SceneNode,
  texture: PixiMeshSimpleOptions['texture'],
): PixiContainer {
  const mesh = node.components.mesh?.mesh
  const group = new pixi.Container()
  group.label = `placeholder:${node.name}`

  if (mesh && mesh.vertices.length > 0) {
    const displayMesh = createDisplayMesh(pixi, mesh, texture)
    meshByGroup.set(group, displayMesh)
    registerMeshDisplay(group, displayMesh)
    group.addChild(displayMesh)
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

export function applyMeshVertices(container: PixiContainer, vertices: readonly MeshVertex[]): void {
  const group = placeholderByContainer.get(container)
  const displayMesh = group ? meshByGroup.get(group) : undefined
  if (!displayMesh) return
  displayMesh.vertices = flattenVertices(vertices)
}

export function applyMeshData(pixi: RendererPixi, container: PixiContainer, mesh: MeshData): void {
  const group = placeholderByContainer.get(container)
  const current = group ? meshByGroup.get(group) : undefined
  if (!group || !current) return
  const replacement = createDisplayMesh(pixi, mesh, current.texture)
  const index = group.children.indexOf(current)
  current.destroy()
  meshByGroup.set(group, replacement)
  registerMeshDisplay(group, replacement)
  group.addChildAt(replacement, index < 0 ? group.children.length : index)
}

function createDisplayMesh(
  pixi: RendererPixi,
  mesh: MeshData,
  texture: PixiMeshSimpleOptions['texture'],
): PixiMeshSimple {
  const displayMesh = new pixi.MeshSimple({
    texture,
    vertices: flattenVertices(mesh.vertices),
    uvs: flattenUvs(mesh.uvs),
    indices: new Uint32Array(mesh.faces.flatMap((face) => [face.v0, face.v1, face.v2])),
    topology: 'triangle-list',
  })
  displayMesh.label = 'mesh-display'
  return displayMesh
}

function flattenVertices(vertices: readonly MeshVertex[]): Float32Array {
  return new Float32Array(vertices.flatMap((vertex) => [vertex.x, vertex.y]))
}

function flattenUvs(uvs: readonly { readonly u: number; readonly v: number }[]): Float32Array {
  return new Float32Array(uvs.flatMap((uv) => [uv.u, uv.v]))
}
