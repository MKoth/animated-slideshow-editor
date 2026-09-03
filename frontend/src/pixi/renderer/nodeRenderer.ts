import type { SceneNode } from '../../engine'
import type { MeshData, MeshVertex } from '../../engine/mesh'
import type { EvaluatedNodeState } from '../../engine/animationEvaluator'
import type { PixiContainer, PixiMeshSimple, PixiMeshSimpleOptions, RendererPixi } from './pixi'
import { generateCircleMeshData } from '../../engine/circleComponent'
import {
  applyPlaceholderName,
  applyTint,
  createPlaceholder,
  setBoneSize,
  setMeshPlaceholderSize,
  registerMeshDisplay,
} from './placeholder'
import { createTableContainer, rebuildTableChild, DEFAULT_TABLE_WIDTH } from './tableRenderer'
import { createChartContainer } from './chartRenderer'
import { createTextContainer, applyTextTint, textDisplayOf } from './textRenderer'
import type { TextureCache } from './textureCache'
import { applyUVTransformToUVs, type UVTransform } from '../../engine/uvTransform'
import { DEFAULT_FIT_MODE } from '../../engine/uvTransform'

const placeholderByContainer = new WeakMap<PixiContainer, PixiContainer>()
const meshByGroup = new WeakMap<PixiContainer, PixiMeshSimple>()
const uvsByMesh = new WeakMap<PixiMeshSimple, Float32Array>()

export function placeholderOf(container: PixiContainer): PixiContainer | undefined {
  return placeholderByContainer.get(container)
}

export function refreshTableChildContainer(
  pixi: RendererPixi,
  container: PixiContainer,
  node: SceneNode,
): void {
  rebuildTableChild(pixi, container, node)
}

export function applyTableNodeOrdering(container: PixiContainer, node: SceneNode): void {
  if (node.components.table) {
    container.sortableChildren = true
  }
  if (node.components.tableCell) {
    container.zIndex = node.components.tableCell.zIndex ?? 0
  }
}

export function createNodeContainer(
  pixi: RendererPixi,
  node: SceneNode,
  cache: TextureCache,
): PixiContainer {
  const container = new pixi.Container()
  container.label = node.name
  applyTableNodeOrdering(container, node)
  applyTransform(container, node)
  container.visible = node.visible
  container.alpha = node.opacity
  if (node.components.table) {
    const tablePlaceholder = createTableContainer(pixi, node, DEFAULT_TABLE_WIDTH)
    placeholderByContainer.set(container, tablePlaceholder)
    container.addChild(tablePlaceholder)
  } else if (node.components.chart) {
    const chartPlaceholder = createChartContainer(pixi, node)
    placeholderByContainer.set(container, chartPlaceholder)
    container.addChild(chartPlaceholder)
  } else if (node.components.circle) {
    const textureKey =
      node.material.textureId ?? node.components.assetInstance?.assetDefinitionId ?? node.id
    const circlePlaceholder = createCirclePlaceholder(pixi, node, cache.get(textureKey))
    placeholderByContainer.set(container, circlePlaceholder)
    container.addChild(circlePlaceholder)
  } else if (node.components.mesh) {
    const textureKey =
      node.material.textureId ?? node.components.assetInstance?.assetDefinitionId ?? node.id
    const meshPlaceholder = createMeshPlaceholder(pixi, node, cache.get(textureKey))
    placeholderByContainer.set(container, meshPlaceholder)
    container.addChild(meshPlaceholder)
  } else if (node.components.assetInstance) {
    const textureKey = node.components.assetInstance?.assetDefinitionId ?? node.id
    const placeholder = createPlaceholder(pixi, node, cache, textureKey)
    placeholderByContainer.set(container, placeholder)
    container.addChild(placeholder)
  } else if (node.components.text) {
    const textContainer = createTextContainer(pixi, node)
    placeholderByContainer.set(container, textContainer)
    container.addChild(textContainer)
  } else if (node.components.bone) {
    const bonePlaceholder = createBonePlaceholder(pixi, node, node.components.bone.length)
    placeholderByContainer.set(container, bonePlaceholder)
    container.addChild(bonePlaceholder)
  } else if (node.components.tableCell) {
    rebuildTableChild(pixi, container, node)
  }
  return container
}

export function applyTransform(container: PixiContainer, node: SceneNode): void {
  // Pivot is normalized [-0.5,0.5]; Pixi pivot is in pixels. Size-dependent part is
  // handled by SceneRenderer after size is known (see applyPivotWithSize). Here we
  // set a fallback unit pivot so engine-level pivot is respected even before size.
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
  container.visible = state.visible
}

function applyPivot(
  container: PixiContainer,
  pivot?: { readonly x: number; readonly y: number },
): void {
  if (pivot) {
    // Fallback: treat normalized pivot as pixel offset scaled by 1 (unit). Size-scaled
    // pivot is applied by SceneRenderer when size is known.
    container.pivot.set(pivot.x, pivot.y)
  } else {
    container.pivot.set(0, 0)
  }
}

export function applyPivotWithSize(
  container: PixiContainer,
  pivot: { readonly x: number; readonly y: number } | undefined,
  size: { readonly width: number; readonly height: number } | null,
): void {
  if (!pivot) {
    container.pivot.set(0, 0)
    return
  }
  if (!size) {
    container.pivot.set(pivot.x, pivot.y)
    return
  }
  container.pivot.set(pivot.x * size.width, pivot.y * size.height)
}

export function applyMaterialTint(container: PixiContainer, tint: string): void {
  const placeholder = placeholderByContainer.get(container)
  if (!placeholder) {
    return
  }
  const textDisplay = textDisplayOf(placeholder)
  if (textDisplay) {
    applyTextTint(placeholder, tint)
    return
  }
  applyTint(placeholder, tint)
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
    const transformed = transformedMeshForNode(node, mesh, texture)
    const displayMesh = createDisplayMesh(pixi, transformed, texture)
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

export function createCirclePlaceholder(
  pixi: RendererPixi,
  node: SceneNode,
  texture: PixiMeshSimpleOptions['texture'],
): PixiContainer {
  const circle = node.components.circle
  const group = new pixi.Container()
  group.label = `placeholder:${node.name}`
  if (circle) {
    const mesh = generateCircleMeshData(circle)
    const transformed = transformedMeshForNode(node, mesh, texture)
    const displayMesh = createDisplayMesh(pixi, transformed, texture)
    meshByGroup.set(group, displayMesh)
    registerMeshDisplay(group, displayMesh)
    group.addChild(displayMesh)
    const w = circle.radius * 2
    const h = circle.radius * 2
    setMeshPlaceholderSize(group, w, h, 0, 0)
  } else {
    setMeshPlaceholderSize(group, 100, 100, 0, 0)
  }
  return group
}

export function applyCircleData(
  pixi: RendererPixi,
  container: PixiContainer,
  circle: import('../../engine/circleComponent').CircleComponent,
  startAngle?: number,
  endAngle?: number,
  radius?: number,
  segments?: number,
): void {
  const group = placeholderByContainer.get(container)
  const current = group ? meshByGroup.get(group) : undefined
  if (!group || !current) return
  const effectiveCircle: import('../../engine/circleComponent').CircleComponent = {
    kind: 'circle',
    radius: radius ?? circle.radius,
    startAngle: startAngle ?? circle.startAngle,
    endAngle: endAngle ?? circle.endAngle,
    ...(segments !== undefined || circle.segments !== undefined
      ? { segments: segments ?? circle.segments }
      : {}),
  }
  const finalMesh = generateCircleMeshData(effectiveCircle)
  // Try to find owning scene node for UV transform. Fallback to raw mesh if not found.
  const transformedMesh = finalMesh
  try {
    // placeholderOf container maps to group, we need node reference. We'll rely on caller to apply UV via separate call if needed.
    // For now, attempt to use material if we can find node via container label? Fallback: use finalMesh as is.
    // The actual UV transform will be applied by sceneRenderer after this call via applyUVTransform.
  } catch {
    // ignore
  }
  const replacement = createDisplayMesh(pixi, transformedMesh, current.texture)
  const index = group.children.indexOf(current)
  current.destroy()
  meshByGroup.set(group, replacement)
  registerMeshDisplay(group, replacement)
  group.addChildAt(replacement, index < 0 ? group.children.length : index)
  const w = (radius ?? circle.radius) * 2
  const h = (radius ?? circle.radius) * 2
  setMeshPlaceholderSize(group, w, h, 0, 0)
}

export function applyCircleDataWithUV(
  pixi: RendererPixi,
  container: PixiContainer,
  node: SceneNode,
  startAngle?: number,
  endAngle?: number,
  radius?: number,
  segments?: number,
): void {
  const group = placeholderByContainer.get(container)
  const current = group ? meshByGroup.get(group) : undefined
  if (!group || !current) return
  const circle = node.components.circle
  if (!circle) return
  const effectiveCircle: import('../../engine/circleComponent').CircleComponent = {
    kind: 'circle',
    radius: radius ?? circle.radius,
    startAngle: startAngle ?? circle.startAngle,
    endAngle: endAngle ?? circle.endAngle,
    ...(segments !== undefined || circle.segments !== undefined
      ? { segments: segments ?? circle.segments }
      : {}),
  }
  const baseMesh = generateCircleMeshData(effectiveCircle)
  const transformed = transformedMeshForNode(node, baseMesh, current.texture)
  const replacement = createDisplayMesh(pixi, transformed, current.texture)
  const index = group.children.indexOf(current)
  current.destroy()
  meshByGroup.set(group, replacement)
  registerMeshDisplay(group, replacement)
  group.addChildAt(replacement, index < 0 ? group.children.length : index)
  const w = (radius ?? circle.radius) * 2
  const h = (radius ?? circle.radius) * 2
  setMeshPlaceholderSize(group, w, h, 0, 0)
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

export function applyMeshDataWithUV(
  pixi: RendererPixi,
  container: PixiContainer,
  node: SceneNode,
  mesh: MeshData,
): void {
  const group = placeholderByContainer.get(container)
  const current = group ? meshByGroup.get(group) : undefined
  if (!group || !current) return
  const transformed = transformedMeshForNode(node, mesh, current.texture)
  const replacement = createDisplayMesh(pixi, transformed, current.texture)
  const index = group.children.indexOf(current)
  current.destroy()
  meshByGroup.set(group, replacement)
  registerMeshDisplay(group, replacement)
  group.addChildAt(replacement, index < 0 ? group.children.length : index)
}

export function applyUVTransformToContainer(
  pixi: RendererPixi,
  container: PixiContainer,
  node: SceneNode,
): void {
  const group = placeholderByContainer.get(container)
  const current = group ? meshByGroup.get(group) : undefined
  if (!group || !current) return
  const isMesh = Boolean(node.components.mesh)
  const isCircle = Boolean(node.components.circle)
  if (!isMesh && !isCircle) return
  let baseMesh: MeshData | null = null
  if (isMesh) {
    const mesh = node.components.mesh?.mesh
    if (!mesh) return
    baseMesh = mesh
  } else if (isCircle) {
    const circle = node.components.circle
    if (!circle) return
    baseMesh = generateCircleMeshData(circle)
  }
  if (!baseMesh) return
  const transformed = transformedMeshForNode(node, baseMesh, current.texture)
  // If transformed UVs equal to current's uvs, no need to recreate
  const newUVs = flattenUvs(transformed.uvs)
  const currentUVs = uvsByMesh.get(current)
  if (!currentUVs) {
    return
  }
  let identical = currentUVs.length === newUVs.length
  if (identical) {
    for (let i = 0; i < newUVs.length; i++) {
      if (Math.abs((currentUVs as unknown as number[])[i] - newUVs[i]) > 1e-6) {
        identical = false
        break
      }
    }
  }
  if (identical) {
    return
  }
  // Recreate mesh with same vertices but new UVs, preserving texture
  const meshWithNewUVs: MeshData = {
    vertices: baseMesh.vertices,
    faces: baseMesh.faces,
    uvs: transformed.uvs,
    boneWeights: baseMesh.boneWeights,
    bindPose: baseMesh.bindPose,
  }
  const replacement = createDisplayMesh(pixi, meshWithNewUVs, current.texture)
  // Preserve vertices deformation if any: copy vertices from current
  try {
    ;(replacement as unknown as { vertices: Float32Array }).vertices =
      current.vertices as unknown as Float32Array
  } catch {
    // ignore
  }
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
  uvsByMesh.set(displayMesh, mesh.uvs.length === 0 ? new Float32Array() : flattenUvs(mesh.uvs))
  return displayMesh
}

function flattenVertices(vertices: readonly MeshVertex[]): Float32Array {
  return new Float32Array(vertices.flatMap((vertex) => [vertex.x, vertex.y]))
}

function flattenUvs(uvs: readonly { readonly u: number; readonly v: number }[]): Float32Array {
  return new Float32Array(uvs.flatMap((uv) => [uv.u, uv.v]))
}

function transformedMeshForNode(
  node: SceneNode,
  mesh: MeshData,
  texture: PixiMeshSimpleOptions['texture'],
): MeshData {
  const textureId = node.material.textureId
  const uvTransform = node.material.uvTransform
  // If no texture attached, no transform needed — return original
  if (!textureId && !uvTransform) {
    return mesh
  }
  const transform: UVTransform = uvTransform ?? {
    uvScale: { u: 1, v: 1 },
    uvOffset: { u: 0, v: 0 },
    fitMode: DEFAULT_FIT_MODE,
  }
  // If transform is default identity and fitMode stretch, no-op
  const isDefault =
    transform.uvScale.u === 1 &&
    transform.uvScale.v === 1 &&
    transform.uvOffset.u === 0 &&
    transform.uvOffset.v === 0 &&
    transform.fitMode === 'stretch'
  if (isDefault && !textureId) {
    return mesh
  }
  // For cover/contain with no texture yet, we still apply if fitMode non-stretch but transform is non-default
  // Compute geometry size
  let geometrySize: { width: number; height: number } | undefined
  if (node.components.mesh) {
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
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      geometrySize = { width: w, height: h }
    }
  } else if (node.components.circle) {
    const circle = node.components.circle
    if (circle) {
      geometrySize = { width: circle.radius * 2, height: circle.radius * 2 }
    }
  }
  // Texture size: try to read from provided texture if it's a real texture (not 1x1 placeholder)
  let textureSize: { width: number; height: number } | undefined
  if (texture) {
    const anyTex = texture as unknown as { width?: number; height?: number }
    if (
      typeof anyTex.width === 'number' &&
      typeof anyTex.height === 'number' &&
      anyTex.width > 1 &&
      anyTex.height > 1
    ) {
      textureSize = { width: anyTex.width, height: anyTex.height }
    } else if (typeof anyTex.width === 'number' && typeof anyTex.height === 'number') {
      // Even placeholder 1x1 still considered, but we treat as fallback 1x1
      textureSize = { width: anyTex.width, height: anyTex.height }
    }
  }
  const transformedUvs = applyUVTransformToUVs(mesh.uvs, transform, geometrySize, textureSize)
  return { ...mesh, uvs: transformedUvs }
}
