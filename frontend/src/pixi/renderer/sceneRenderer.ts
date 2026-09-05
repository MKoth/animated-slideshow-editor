import type { EnginePublic, Unsubscribe } from '../../engine'
import type { Scene } from '../../engine'
import type { SceneNode } from '../../engine'
import type { ChartComponent } from '../../engine/components'
import { isGroupNode, walkPreOrder } from '../../engine/sceneNode'
import { useOverlayVisibilityStore } from '../../stores/overlayVisibilityStore'
import {
  clampShadowEffect,
  collectShadowCasters as collectShadowCastersPure,
  hexStringToTint,
} from '../../engine/shadowEffect'
import type { EvaluatedNodeScratch } from '../../engine/animationEvaluator'
import {
  copyEvaluatedState,
  evaluatedNodeScratch,
  evaluatedStatesEqual,
  evaluatedMaterialOverridesScratch,
  type EvaluatedMaterialOverridesScratch,
} from '../../engine/animationEvaluator'
import {
  effectiveMaterialScratch,
  effectiveShaderScratch,
  copyShaderUniforms,
  resolveMaterial,
  resolveShaderUniforms,
  shaderUniformsEqual,
  type EffectiveMaterialScratch,
  type EffectiveShaderScratch,
  type MaterialParameterDefault,
} from '../../engine/materialResolution'
import type { MaterialOverrides } from '../../engine/materialInstance'
import type { WorldTransform } from '../../engine/worldTransform'
import { composeChain, relativeTransform } from '../../engine/worldTransform'
import {
  applyConstraints,
  type ConstraintEvaluationContext,
} from '../../engine/constraintEvaluator'
import type { PixiContainer, PixiFilter, PixiRenderTexture, PixiSprite, RendererPixi } from './pixi'
import type { WorldSize } from './worldGeometry'
import { expandRect, mergeRect } from './worldGeometry'
import { worldAabbOf } from './hitTest'
import {
  applyCircleDataWithUV,
  applyEvaluatedState,
  applyMaterialTint,
  applyMeshDataWithUV,
  applyMeshVertices,
  applyName,
  applyPivotWithSize,
  applyTableNodeOrdering,
  applyUVTransformToContainer,
  createNodeContainer,
  placeholderOf,
  refreshTableChildContainer,
} from './nodeRenderer'
import {
  applyAssetTexture,
  applyMissingPlaceholder,
  placeholderSize,
  setBoneSize,
} from './placeholder'
import {
  rebuildTable,
  rebuildTableWithEvaluated,
  rebuildTableChildWithEvaluated,
  tableChildSizeOf,
  tableLayoutOf,
  tableSizeOf,
  DEFAULT_TABLE_WIDTH,
} from './tableRenderer'
import { chartSpriteOf, rebuildChartTexture, type ResolveDataSource } from './chartRenderer'
import { CHART_DEFAULT_WIDTH, CHART_DEFAULT_HEIGHT } from './chartRenderer'
import { rebuildText, textSizeOf } from './textRenderer'
import { createNodeShaderFilter, applyFilterUniforms } from './nodeShader'
import { bindFilterSamplers } from './samplerBinding'
import type { ShaderProgramCache } from './programCache'
import type { ResolveAssetUrl, TextureCache } from './textureCache'
import { evaluateMeshDeformation } from '../../engine/meshDeformationEvaluator'
import { generateCircleMeshData } from '../../engine/circleComponent'
import { useShapePreviewStore } from '../../stores/shapePreviewStore'

export interface CurrentTimeSource {
  getTime(slideId: string): number
  subscribe(listener: () => void): Unsubscribe
}

export const ALWAYS_ZERO_TIME: CurrentTimeSource = {
  getTime: () => 0,
  subscribe: () => () => undefined,
}

const UNKNOWN_DEFINITION_PARAMETERS: readonly MaterialParameterDefault[] = []

// ── Shadow Effect helpers (spec #298 — tracer bullet minimal) ──────────────
const WHITE_ALPHA_FRAGMENT = `
in vec2 vUv;
uniform sampler2D uTexture;
void main() {
  vec4 c = texture(uTexture, vUv);
  gl_FragColor = vec4(c.a, c.a, c.a, c.a);
}
`

type WorldAabb = { minX: number; minY: number; maxX: number; maxY: number }

function rtSizeForAabb(
  aabb: WorldAabb | null,
  blur: number,
): { width: number; height: number; pad: number } {
  const pad = Math.ceil(blur * 2 + 4)
  if (!aabb) return { width: 4, height: 4, pad }
  const expanded = expandRect(
    aabb as unknown as import('./worldGeometry').WorldRect,
    pad,
  ) as unknown as WorldAabb
  void expanded
  const w = Math.ceil(aabb.maxX - aabb.minX + pad * 2)
  const h = Math.ceil(aabb.maxY - aabb.minY + pad * 2)
  const cap = 2048
  let rw = Math.max(4, Math.min(cap, w))
  let rh = Math.max(4, Math.min(cap, h))
  if (w > cap || h > cap) {
    const s = cap / Math.max(w, h)
    rw = Math.max(4, Math.ceil(w * s))
    rh = Math.max(4, Math.ceil(h * s))
    console.warn(`[shadow] RT clamped to ${rw}×${rh} (was ${w}×${h})`)
  }
  return { width: rw, height: rh, pad }
}

function collectShadowCasters(host: SceneNode): SceneNode[] {
  return collectShadowCastersPure(
    host as unknown as { children: readonly unknown[] },
  ) as SceneNode[]
}

function worldAabbOfNode(
  size: WorldSize,
  transform: { x: number; y: number; rotation: number; scaleX: number; scaleY: number },
): WorldAabb {
  const hw = (size.width * transform.scaleX) / 2
  const hh = (size.height * transform.scaleY) / 2
  const ox = (size.offsetX ?? 0) * transform.scaleX
  const oy = (size.offsetY ?? 0) * transform.scaleY
  const cos = Math.cos(transform.rotation)
  const sin = Math.sin(transform.rotation)
  const cx = transform.x + ox * cos - oy * sin
  const cy = transform.y + ox * sin + oy * cos
  const corners = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  }))
  return {
    minX: Math.min(...corners.map((c) => c.x)),
    minY: Math.min(...corners.map((c) => c.y)),
    maxX: Math.max(...corners.map((c) => c.x)),
    maxY: Math.max(...corners.map((c) => c.y)),
  }
}

interface NodeShaderState {
  filter: PixiFilter | null
  scratch: EffectiveShaderScratch
}

export type ResolveShaderSource = (shaderId: string) => string | null

function effectiveMeshForPreview(
  mesh: import('../../engine/mesh').MeshData,
  nodeId: string,
  engine: EnginePublic,
): import('../../engine/mesh').MeshData {
  const preview = useShapePreviewStore.getState()
  if (preview.previewNodeId !== nodeId || !preview.previewShapeId) return mesh
  try {
    const node = engine.getNode(nodeId)
    const shapes = node.components.mesh?.shapes
    const shape = shapes?.find((s) => s.id === preview.previewShapeId)
    if (shape) {
      return {
        ...mesh,
        vertices: shape.vertices as unknown as import('../../engine/mesh').MeshData['vertices'],
      }
    }
  } catch (_e) {
    void _e
  }
  return mesh
}

export class SceneRenderer {
  readonly #engine: EnginePublic
  readonly #pixi: RendererPixi
  readonly #textureCache: TextureCache
  readonly #resolveAssetUrl: ResolveAssetUrl
  readonly #isAssetMissing: (definitionId: string) => boolean
  readonly #resolveShaderSource: ResolveShaderSource
  readonly #programCache: ShaderProgramCache
  readonly #world: PixiContainer
  readonly #currentTime: CurrentTimeSource
  readonly #containers = new Map<string, PixiContainer>()
  readonly #nodeIds = new WeakMap<PixiContainer, string>()
  readonly #sizes = new Map<string, WorldSize>()
  readonly #lastEvaluated = new Map<string, EvaluatedNodeScratch>()
  readonly #lastMaterials = new Map<string, EffectiveMaterialScratch>()
  readonly #nodeShaders = new Map<string, NodeShaderState>()
  readonly #missingNodes = new Set<string>()
  readonly #ikOverrides = new Map<string, number>()
  readonly #tableComponentHashes = new Map<string, string>()
  readonly #chartComponentHashes = new Map<string, string>()
  readonly #textComponentHashes = new Map<string, string>()
  readonly #circleHashes = new Map<string, string>()
  readonly #tableHashes = new Map<string, string>()
  readonly #resolveDataSource: ResolveDataSource
  readonly #scratch: EvaluatedNodeScratch = evaluatedNodeScratch()
  readonly #materialScratch: EffectiveMaterialScratch = effectiveMaterialScratch()
  readonly #shaderScratch: EffectiveShaderScratch = effectiveShaderScratch()
  readonly #materialOverridesScratch: EvaluatedMaterialOverridesScratch =
    evaluatedMaterialOverridesScratch()
  readonly #onNodeSizeChanged: (nodeId: string) => void
  // ── Shadow Effect state (per-group) ──────────────────────────────────────
  readonly #shadowContainers = new Map<string, PixiContainer>()
  readonly #shadowSprites = new Map<string, PixiSprite>()
  readonly #shadowTextures = new Map<string, PixiRenderTexture>()
  readonly #shadowBlurFilters = new Map<string, PixiFilter | null>()
  #shadowWhiteFilter: PixiFilter | null = null
  readonly #shadowDirty: Set<string> = new Set()
  readonly #shadowLastCasterHash = new Map<string, string>()
  readonly #shadowLastParamHash = new Map<string, string>()
  readonly #renderToTexture: (options: {
    container: PixiContainer
    target: PixiRenderTexture
    clearColor?: number
    clear?: boolean
  }) => void
  #scene: Scene | null = null
  #slideId: string | null = null

  constructor(
    engine: EnginePublic,
    world: PixiContainer,
    pixi: RendererPixi,
    textureCache: TextureCache,
    resolveAssetUrl: ResolveAssetUrl,
    programCache: ShaderProgramCache,
    onNodeSizeChanged: (nodeId: string) => void = () => undefined,
    currentTime: CurrentTimeSource = ALWAYS_ZERO_TIME,
    isAssetMissing: (definitionId: string) => boolean = () => false,
    resolveShaderSource: ResolveShaderSource = () => null,
    resolveDataSource: ResolveDataSource = () => null,
    renderToTexture: (options: {
      container: PixiContainer
      target: PixiRenderTexture
      clearColor?: number
      clear?: boolean
    }) => void = () => undefined,
  ) {
    this.#engine = engine
    this.#world = world
    this.#pixi = pixi
    this.#textureCache = textureCache
    this.#resolveAssetUrl = resolveAssetUrl
    this.#programCache = programCache
    this.#onNodeSizeChanged = onNodeSizeChanged
    this.#currentTime = currentTime
    this.#isAssetMissing = isAssetMissing
    this.#resolveShaderSource = resolveShaderSource
    this.#resolveDataSource = resolveDataSource
    this.#renderToTexture = renderToTexture
    void useShapePreviewStore.subscribe(() => {
      this.refreshDeformedMeshSizes()
      if (this.#scene) {
        for (const node of walkPreOrder(this.#scene.root)) {
          if (node.components.mesh) this.#evaluateAndApply(node.id)
        }
      }
    })
  }

  nodeSize(nodeId: string): WorldSize | null {
    return this.#sizes.get(nodeId) ?? null
  }

  get boundSceneId(): string | null {
    return this.#scene?.id ?? null
  }

  get boundSlideId(): string | null {
    return this.#slideId
  }

  get boundScene(): Scene | null {
    return this.#scene
  }

  get boundCamera(): SceneNode | null {
    return this.#scene?.camera ?? null
  }

  get renderedNodeCount(): number {
    let count = 0
    for (const container of this.#containers.values()) {
      if (container.visible) {
        count += 1
      }
    }
    return count
  }

  bind(scene: Scene | null, slideId: string | null = null): void {
    // Destroy existing shadows (RT lifecycle: bind(null) destroys)
    this.#destroyAllShadows()
    for (const container of this.#containers.values()) {
      container.destroy({ children: true })
    }
    this.#containers.clear()
    this.#sizes.clear()
    this.#lastEvaluated.clear()
    this.#lastMaterials.clear()
    this.#nodeShaders.clear()
    this.#missingNodes.clear()
    this.#tableComponentHashes.clear()
    this.#chartComponentHashes.clear()
    this.#textComponentHashes.clear()
    this.#circleHashes.clear()
    this.#tableHashes.clear()
    this.#scene = scene
    this.#slideId = slideId
    if (!scene) {
      return
    }
    for (const node of walkPreOrder(scene.root)) {
      this.#addNode(node)
    }
    this.refreshDeformedMeshSizes()
    // Create shadows for existing group nodes with effect
    for (const node of walkPreOrder(scene.root)) {
      if (node.shadowEffect && isGroupNode(node)) {
        this.#ensureShadowForGroup(node)
      }
    }
  }

  handleNodeCreated(nodeId: string): void {
    if (!this.#scene || !this.#scene.getNode(nodeId)) {
      return
    }
    if (this.#containers.has(nodeId)) {
      return
    }
    const node = this.#engine.getNode(nodeId)
    this.#addNode(node)
    this.#refreshOwningTable(node)
    this.#syncShadowLifecycleForNode(nodeId)
    // If parent is group with shadow, its silhouette changed (new caster) — mark dirty via climbing
    this.#markShadowDirtyForNode(nodeId)
    this.#flushShadowDirty()
    // If new node itself is group with shadow, its parent's shadow may need update? Already handled
  }

  handleNodeRemoved(nodeId: string): void {
    const container = this.#containers.get(nodeId)
    if (!container) {
      // Still need to destroy shadow if group removed but container missing (e.g., root)
      this.#destroyShadowForGroup(nodeId)
      return
    }
    // Capture parent before destroy for shadow update
    const node = this.#scene?.getNode(nodeId)
    const parentId = node?.parent?.id ?? null
    const tableId = this.#tableAncestorId(container)
    // Collect descendant ids before deletion to destroy their shadows
    const descendantShadowIds: string[] = []
    for (const descendant of walkContainers(container)) {
      const descendantId = this.#nodeIds.get(descendant)
      if (descendantId) {
        if (this.#shadowContainers.has(descendantId)) descendantShadowIds.push(descendantId)
        this.#containers.delete(descendantId)
        this.#sizes.delete(descendantId)
        this.#lastEvaluated.delete(descendantId)
        this.#lastMaterials.delete(descendantId)
        this.#nodeShaders.delete(descendantId)
        this.#missingNodes.delete(descendantId)
        this.#circleHashes.delete(descendantId)
        this.#tableHashes.delete(descendantId)
      }
      this.#nodeIds.delete(descendant)
    }
    for (const sid of descendantShadowIds) this.#destroyShadowForGroup(sid)
    this.#destroyShadowForGroup(nodeId)
    container.destroy({ children: true })
    if (tableId) {
      this.handleTableChanged(tableId)
    }
    if (parentId && this.#shadowContainers.has(parentId)) {
      this.#markShadowDirtyForNode(parentId)
      this.#flushShadowDirty()
    } else if (parentId) {
      // still mark dirty for ancestor shadow hosts (climb)
      this.#markShadowDirtyForNode(nodeId)
      this.#flushShadowDirty()
    }
  }

  handleTransformChanged(nodeId: string): void {
    this.#evaluateAndApply(nodeId)
    this.refreshDeformedMeshSizes()
    // Update bone placeholder size when bone length changed
    const node = this.#scene?.getNode(nodeId)
    if (node?.components.bone) {
      const container = this.#containers.get(nodeId)
      if (container) {
        const placeholder = placeholderOf(container)
        if (placeholder) {
          const len = node.components.bone.length
          setBoneSize(placeholder, len, 10, len / 2, 0)
          this.#sizes.set(nodeId, { width: len, height: 10, offsetX: len / 2, offsetY: 0 })
          this.#onNodeSizeChanged(nodeId)
        }
      }
    }
    // Shadow: if this node is group, check lifecycle; also update any ancestor shadow via dirty
    this.#syncShadowLifecycleForNode(nodeId)
    this.#markShadowDirtyForNode(nodeId)
    this.#flushShadowDirty()
  }

  handleKeyframeChanged(nodeId: string): void {
    this.#evaluateAndApply(nodeId)
    this.refreshDeformedMeshSizes()
    this.#markShadowDirtyForNode(nodeId)
    this.#flushShadowDirty()
  }

  handleTimeChanged(): void {
    const scene = this.#scene
    if (!scene) {
      return
    }
    for (const node of walkPreOrder(scene.root)) {
      this.#evaluateAndApply(node.id)
    }
    this.refreshDeformedMeshSizes()
    const time = this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0
    for (const gid of [...this.#shadowContainers.keys()]) {
      this.#updateShadowIfNeeded(gid, time)
    }
  }

  refreshDeformedMeshSizes(): void {
    const scene = this.#scene
    const slideId = this.#slideId
    if (!scene || !slideId) {
      return
    }
    const time = this.#currentTime.getTime(slideId)
    const bones = new Map<string, WorldTransform>()
    for (const node of walkPreOrder(scene.root)) {
      if (node.components.bone) {
        const transform = this.#engineWorldTransform(node.id, time)
        if (transform) bones.set(node.id, transform)
      }
    }
    for (const node of walkPreOrder(scene.root)) {
      const rawMesh = node.components.mesh?.mesh
      if (rawMesh) {
        // If shape preview is active (Inspector highlight), reuse preview mesh directly
        const preview = useShapePreviewStore.getState()
        const hasShapePreview = preview.previewNodeId === node.id && preview.previewShapeId
        const meshTransform = this.#engineWorldTransform(node.id, time)
        if (!meshTransform) continue
        let vertices: readonly import('../../engine/mesh').MeshVertex[]
        if (hasShapePreview) {
          const mesh = effectiveMeshForPreview(rawMesh, node.id, this.#engine)
          vertices = evaluateMeshDeformation(mesh, bones, meshTransform).deformedVertices
        } else {
          const deformed = this.#engine.evaluateMeshDeformation(node.id, time, bones, meshTransform)
          vertices = deformed ? deformed.deformedVertices : []
        }
        const container = this.#containers.get(node.id)
        if (container) applyMeshVertices(container, vertices)
        if (vertices.length === 0) continue
        const xs = vertices.map((vertex) => vertex.x)
        const ys = vertices.map((vertex) => vertex.y)
        const minX = Math.min(...xs)
        const maxX = Math.max(...xs)
        const minY = Math.min(...ys)
        const maxY = Math.max(...ys)
        this.#sizes.set(node.id, {
          width: maxX - minX,
          height: maxY - minY,
          offsetX: (minX + maxX) / 2,
          offsetY: (minY + maxY) / 2,
        })
        continue
      }
      const circle = node.components.circle
      if (!circle) continue
      const state = this.#engine.evaluateCircle(node.id, time)
      const evaluatedCircle: import('../../engine/circleComponent').CircleComponent = state
        ? {
            kind: 'circle',
            radius: state.radius,
            startAngle: state.startAngle,
            endAngle: state.endAngle,
            segments: state.segments,
          }
        : circle
      const evaluatedMesh = generateCircleMeshData(evaluatedCircle)
      const meshTransform = this.#engineWorldTransform(node.id, time)
      if (!meshTransform) continue
      const vertices = evaluateMeshDeformation(evaluatedMesh, bones, meshTransform).deformedVertices
      const container = this.#containers.get(node.id)
      if (container) applyMeshVertices(container, vertices)
      if (vertices.length === 0) continue
      const xs = vertices.map((vertex) => vertex.x)
      const ys = vertices.map((vertex) => vertex.y)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      this.#sizes.set(node.id, {
        width: maxX - minX,
        height: maxY - minY,
        offsetX: (minX + maxX) / 2,
        offsetY: (minY + maxY) / 2,
      })
    }
  }

  applyIKOverrides(rotations: ReadonlyMap<string, number>): void {
    this.#ikOverrides.clear()
    for (const [nodeId, rotation] of rotations) {
      this.#ikOverrides.set(nodeId, rotation)
      const container = this.#containers.get(nodeId)
      if (container) {
        container.rotation = rotation
      }
    }
  }

  applyConstraintOverrides(): void {
    const scene = this.#scene
    if (!scene) {
      return
    }
    const constraintManager = this.#engine.getConstraintManager()
    for (const node of walkPreOrder(scene.root)) {
      const constraints = constraintManager.getConstraintsForNode(node.id)
      if (constraints.length === 0) {
        continue
      }
      const container = this.#containers.get(node.id)
      if (!container) {
        continue
      }
      this.#applyConstraints(node.id, container)
    }
  }

  handleMaterialChanged(nodeId: string): void {
    this.#evaluateAndApply(nodeId)
    // For mesh/circle nodes, material change may be texture/UV attachment — reapply UV and texture
    const node = this.#scene?.getNode(nodeId)
    const container = this.#containers.get(nodeId)
    if (node && container) {
      if (node.components.mesh || node.components.circle) {
        applyUVTransformToContainer(this.#pixi, container, node)
        // Also refresh texture if textureId changed
        const texId = node.material.textureId
        if (texId) {
          this.#loadAssetTexture(texId, nodeId, container)
        } else {
          // Detached: revert to original assetInstance texture or placeholder hash
          this.#missingNodes.delete(nodeId)
          const placeholder = placeholderOf(container)
          if (placeholder) {
            const fallbackId = node.components.assetInstance?.assetDefinitionId
            if (fallbackId) {
              this.#loadAssetTexture(fallbackId, nodeId, container)
            } else {
              const fallbackKey = node.id
              const tex = this.#textureCache.get(fallbackKey)
              applyAssetTexture(placeholder, tex)
            }
          }
        }
      }
    }
    // Shadow: if node was group with shadow that now has material, destroy; if caster, update — material is pre-shader so no silhouette regen needed, but mark for safety
    this.#syncShadowLifecycleForNode(nodeId)
    this.#markShadowDirtyForNode(nodeId)
    for (const gid of [...this.#shadowContainers.keys()])
      this.#updateShadowIfNeeded(gid, this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0)
    this.#flushShadowDirty()
  }

  handleMeshChanged(nodeId: string): void {
    const scene = this.#scene
    if (!scene) {
      return
    }
    const node = scene.getNode(nodeId)
    if (!node || !node.components.mesh) {
      return
    }
    const mesh = node.components.mesh.mesh
    const container = this.#containers.get(nodeId)
    if (container && !placeholderOf(container)?.children[0]?.label?.startsWith('mesh')) {
      const parent = container.parent
      const index = parent ? parent.children.indexOf(container) : -1
      container.destroy({ children: true })
      const replacement = createNodeContainer(this.#pixi, node, this.#textureCache)
      this.#containers.set(nodeId, replacement)
      this.#nodeIds.set(replacement, nodeId)
      if (parent) {
        parent.addChildAt(replacement, Math.max(0, index))
      }
      this.#recordSize(node, replacement)
      this.#evaluateAndApply(nodeId)
      const instance = node.components.assetInstance
      if (instance) {
        this.#loadAssetTexture(instance.assetDefinitionId, nodeId, replacement)
      }
    } else if (container) {
      applyMeshDataWithUV(this.#pixi, container, node, mesh)
      applyUVTransformToContainer(this.#pixi, container, node)
    }
    if (mesh.vertices.length === 0) {
      return
    }
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
    this.#sizes.set(nodeId, { width: w, height: h, offsetX: cx, offsetY: cy })
    this.refreshDeformedMeshSizes()
    this.#onNodeSizeChanged(nodeId)
    this.#syncShadowLifecycleForNode(nodeId)
    this.#markShadowDirtyForNode(nodeId)
    this.#flushShadowDirty()
  }

  handleCircleChanged(nodeId: string): void {
    const scene = this.#scene
    if (!scene) {
      return
    }
    const node = scene.getNode(nodeId)
    if (!node || !node.components.circle) {
      return
    }
    const circle = node.components.circle
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    // If container does not already host a circle mesh, rebuild whole container
    const placeholder = placeholderOf(container)
    const needsRebuild = !placeholder || !placeholder.children[0]?.label?.startsWith('mesh')
    if (needsRebuild) {
      const parent = container.parent
      const index = parent ? parent.children.indexOf(container) : -1
      container.destroy({ children: true })
      const replacement = createNodeContainer(this.#pixi, node, this.#textureCache)
      this.#containers.set(nodeId, replacement)
      this.#nodeIds.set(replacement, nodeId)
      if (parent) {
        parent.addChildAt(replacement, Math.max(0, index))
      }
      this.#recordSize(node, replacement)
      this.#evaluateAndApply(nodeId)
      const instance = node.components.assetInstance
      if (instance) {
        this.#loadAssetTexture(instance.assetDefinitionId, nodeId, replacement)
      }
      return
    }
    // Otherwise update mesh data for current time (deterministic per frame)
    const slideId = this.#slideId
    const time = slideId ? this.#currentTime.getTime(slideId) : 0
    const state = this.#engine.evaluateCircle(nodeId, time)
    const start = state?.startAngle ?? circle.startAngle
    const end = state?.endAngle ?? circle.endAngle
    const radius = state?.radius ?? circle.radius
    const segments = state?.segments ?? circle.segments
    applyCircleDataWithUV(this.#pixi, container, node, start, end, radius, segments)
    applyUVTransformToContainer(this.#pixi, container, node)
    const w = radius * 2
    const h = radius * 2
    this.#sizes.set(nodeId, { width: w, height: h, offsetX: 0, offsetY: 0 })
    this.refreshDeformedMeshSizes()
    this.#onNodeSizeChanged(nodeId)
    this.#syncShadowLifecycleForNode(nodeId)
    this.#markShadowDirtyForNode(nodeId)
    this.#flushShadowDirty()
  }

  handleTableChanged(nodeId: string): void {
    const scene = this.#scene
    if (!scene) {
      return
    }
    const node = scene.getNode(nodeId)
    if (!node) {
      return
    }
    const nodeContainer = this.#containers.get(node.id)
    if (nodeContainer) {
      applyTableNodeOrdering(nodeContainer, node)
    }
    const tableNode = node.components.table ? node : this.#owningTable(node)
    if (!tableNode) {
      this.#syncShadowLifecycleForNode(nodeId)
      this.#markShadowDirtyForNode(nodeId)
      for (const gid of [...this.#shadowContainers.keys()])
        this.#updateShadowIfNeeded(
          gid,
          this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0,
        )
      this.#flushShadowDirty()
      return
    }
    if (!node.components.table) {
      this.#refreshTableChildren(tableNode)
      this.#syncShadowLifecycleForNode(nodeId)
      this.#markShadowDirtyForNode(nodeId)
      for (const gid of [...this.#shadowContainers.keys()])
        this.#updateShadowIfNeeded(
          gid,
          this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0,
        )
      this.#flushShadowDirty()
      return
    }
    const table = tableNode
    const container = this.#containers.get(table.id)
    if (!container) {
      return
    }
    const placeholder = placeholderOf(container)
    if (!placeholder) {
      this.#syncShadowLifecycleForNode(nodeId)
      for (const gid of [...this.#shadowContainers.keys()])
        this.#updateShadowIfNeeded(
          gid,
          this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0,
        )
      return
    }
    const previousLayout = tableLayoutOf(placeholder)
    const availableWidth = this.#sizes.get(table.id)?.width ?? DEFAULT_TABLE_WIDTH
    rebuildTable(this.#pixi, placeholder, table, availableWidth)
    const newLayout = tableLayoutOf(placeholder)
    if (
      previousLayout &&
      newLayout &&
      (previousLayout.totalWidth !== newLayout.totalWidth ||
        previousLayout.totalHeight !== newLayout.totalHeight)
    ) {
      this.#sizes.set(table.id, {
        width: newLayout.totalWidth,
        height: newLayout.totalHeight,
        offsetX: newLayout.totalWidth / 2,
        offsetY: newLayout.totalHeight / 2,
      })
      this.#onNodeSizeChanged(table.id)
    }
    this.#refreshTableChildren(table)
    this.#syncShadowLifecycleForNode(nodeId)
    this.#markShadowDirtyForNode(nodeId)
    for (const gid of [...this.#shadowContainers.keys()])
      this.#updateShadowIfNeeded(gid, this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0)
    this.#flushShadowDirty()
  }

  handleChartChanged(nodeId: string): void {
    const chartAndSprite = this.#getChartAndSprite(nodeId)
    if (!chartAndSprite) {
      this.#syncShadowLifecycleForNode(nodeId)
      this.#markShadowDirtyForNode(nodeId)
      for (const gid of [...this.#shadowContainers.keys()])
        this.#updateShadowIfNeeded(
          gid,
          this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0,
        )
      this.#flushShadowDirty()
      return
    }
    const { chart, sprite } = chartAndSprite
    const data = this.#resolveDataSource(chart.dataSourceId) ?? []
    const width = CHART_DEFAULT_WIDTH
    const height = CHART_DEFAULT_HEIGHT
    void rebuildChartTexture(this.#pixi, sprite, chart, data, width, height).then(() => {
      this.#sizes.set(nodeId, { width, height })
      this.#onNodeSizeChanged(nodeId)
      this.#syncShadowLifecycleForNode(nodeId)
      this.#markShadowDirtyForNode(nodeId)
      for (const gid of [...this.#shadowContainers.keys()])
        this.#updateShadowIfNeeded(
          gid,
          this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0,
        )
      this.#flushShadowDirty()
    })
    // sync now (before async texture)
    this.#syncShadowLifecycleForNode(nodeId)
    this.#markShadowDirtyForNode(nodeId)
    for (const gid of [...this.#shadowContainers.keys()])
      this.#updateShadowIfNeeded(gid, this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0)
    this.#flushShadowDirty()
  }

  handleTextChanged(nodeId: string): void {
    const scene = this.#scene
    if (!scene) {
      return
    }
    const node = scene.getNode(nodeId)
    if (!node || !node.components.text) {
      this.#syncShadowLifecycleForNode(nodeId)
      this.#markShadowDirtyForNode(nodeId)
      for (const gid of [...this.#shadowContainers.keys()])
        this.#updateShadowIfNeeded(
          gid,
          this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0,
        )
      this.#flushShadowDirty()
      return
    }
    const container = this.#containers.get(nodeId)
    if (!container) {
      this.#syncShadowLifecycleForNode(nodeId)
      this.#markShadowDirtyForNode(nodeId)
      for (const gid of [...this.#shadowContainers.keys()])
        this.#updateShadowIfNeeded(
          gid,
          this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0,
        )
      this.#flushShadowDirty()
      return
    }
    const placeholder = placeholderOf(container)
    if (!placeholder) {
      this.#syncShadowLifecycleForNode(nodeId)
      this.#markShadowDirtyForNode(nodeId)
      for (const gid of [...this.#shadowContainers.keys()])
        this.#updateShadowIfNeeded(
          gid,
          this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0,
        )
      this.#flushShadowDirty()
      return
    }
    rebuildText(this.#pixi, placeholder, node.components.text)
    const size = textSizeOf(placeholder)
    if (size) {
      this.#sizes.set(nodeId, this.#tableTextSize(node, size))
      this.#onNodeSizeChanged(nodeId)
    }
    this.#syncShadowLifecycleForNode(nodeId)
    this.#markShadowDirtyForNode(nodeId)
    for (const gid of [...this.#shadowContainers.keys()])
      this.#updateShadowIfNeeded(gid, this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0)
    this.#flushShadowDirty()
  }

  handleDataTransition(nodeId: string): void {
    const chartAndSprite = this.#getChartAndSprite(nodeId)
    if (!chartAndSprite) {
      return
    }
    const { chart, sprite } = chartAndSprite
    const slideId = this.#slideId
    if (!slideId) {
      return
    }
    const time = this.#currentTime.getTime(slideId)
    const node = this.#scene?.getNode(nodeId)
    if (!node) {
      return
    }

    const evaluatedDataLabels = this.#engine.evaluateDataLabels(nodeId, time)

    const dataSourceData = this.#resolveDataSource(chart.dataSourceId) ?? []
    const data = dataSourceData.map((dp) => ({
      ...dp,
      value: evaluatedDataLabels.get(dp.label) ?? dp.value,
    }))

    const width = CHART_DEFAULT_WIDTH
    const height = CHART_DEFAULT_HEIGHT
    void rebuildChartTexture(this.#pixi, sprite, chart, data, width, height).then(() => {
      this.#sizes.set(nodeId, { width, height })
      this.#onNodeSizeChanged(nodeId)
    })
  }

  #getChartAndSprite(nodeId: string): { chart: ChartComponent; sprite: PixiSprite } | undefined {
    const scene = this.#scene
    if (!scene) {
      return undefined
    }
    const node = scene.getNode(nodeId)
    if (!node || !node.components.chart) {
      return undefined
    }
    const container = this.#containers.get(nodeId)
    if (!container) {
      return undefined
    }
    const placeholder = placeholderOf(container)
    if (!placeholder) {
      return undefined
    }
    const sprite = chartSpriteOf(placeholder)
    if (!sprite) {
      return undefined
    }
    return { chart: node.components.chart, sprite }
  }

  previewTransform(nodeId: string, x: number, y: number): void {
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    const node = this.#scene?.getNode(nodeId)
    if (node?.components.text && node.parent?.components.tableCell) {
      const textGroup = placeholderOf(container)
      const size = textGroup ? textSizeOf(textGroup) : undefined
      if (size) {
        const base = this.#tableTextBaseOffset(node, size)
        container.position.set(base.x + x, base.y + y)
        return
      }
    }
    container.position.set(x, y)
  }

  previewFullTransform(
    nodeId: string,
    transform: {
      x: number
      y: number
      rotation: number
      scaleX: number
      scaleY: number
      localPivot?: { x: number; y: number }
    },
  ): void {
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    const size = this.#sizes.get(nodeId)
    if (size) {
      applyPivotWithSize(container, transform.localPivot, size)
    } else if (transform.localPivot) {
      container.pivot.set(transform.localPivot.x, transform.localPivot.y)
    } else {
      container.pivot.set(0, 0)
    }
    const node = this.#scene?.getNode(nodeId)
    if (node?.components.text && node.parent?.components.tableCell) {
      const textGroup = placeholderOf(container)
      const tSize = textGroup ? textSizeOf(textGroup) : undefined
      if (tSize) {
        const base = this.#tableTextBaseOffset(node, tSize)
        container.position.set(base.x + transform.x, base.y + transform.y)
        container.rotation = transform.rotation
        container.scale.set(transform.scaleX, transform.scaleY)
        return
      }
    }
    container.position.set(transform.x, transform.y)
    container.rotation = transform.rotation
    container.scale.set(transform.scaleX, transform.scaleY)
  }

  clearPreview(nodeId: string): void {
    this.#evaluateAndApply(nodeId)
  }

  handleVisibilityChanged(nodeId: string): void {
    if (!this.#scene?.getNode(nodeId)) {
      return
    }
    this.#evaluateAndApply(nodeId)
    if (this.#shadowContainers.has(nodeId)) {
      const c = this.#shadowContainers.get(nodeId)!
      const gc = this.#containers.get(nodeId)
      if (gc) c.visible = gc.visible
    }
    // Caster visibility affects shadow silhouette — mark dirty
    this.#markShadowDirtyForNode(nodeId)
    for (const gid of [...this.#shadowContainers.keys()])
      this.#updateShadowIfNeeded(gid, this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0)
    this.#flushShadowDirty()
  }

  handleVisibleTrackChanged(nodeId: string): void {
    this.#evaluateAndApply(nodeId)
    this.#markShadowDirtyForNode(nodeId)
    for (const gid of [...this.#shadowContainers.keys()])
      this.#updateShadowIfNeeded(gid, this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0)
    this.#flushShadowDirty()
  }

  handleNodeRenamed(nodeId: string): void {
    if (!this.#scene?.getNode(nodeId)) {
      return
    }
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    applyName(container, this.#engine.getNode(nodeId))
  }

  handleOpacityChanged(nodeId: string): void {
    this.#evaluateAndApply(nodeId)
    if (this.#shadowContainers.has(nodeId)) {
      this.#updateShadowSpriteProps(nodeId)
    }
    // Any caster opacity change affects shadow silhouette & alpha — mark dirty
    this.#markShadowDirtyForNode(nodeId)
    for (const gid of [...this.#shadowContainers.keys()]) {
      this.#updateShadowSpriteProps(gid)
      this.#updateShadowIfNeeded(gid, this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0)
    }
    this.#shadowDirty.delete(nodeId)
    // Also ensure dirty flushed for ancestor hosts
    this.#flushShadowDirty()
  }

  setBonesVisible(visible: boolean): void {
    for (const [nodeId, container] of this.#containers) {
      const node = this.#scene?.getNode(nodeId)
      if (!node || !node.components.bone) continue
      // Respect node.visible when showing; hide when flag false
      container.visible = visible ? node.visible : false
    }
  }

  setIkHandlesVisible(visible: boolean): void {
    for (const [nodeId, container] of this.#containers) {
      const node = this.#scene?.getNode(nodeId)
      if (!node || !node.components.ghost) continue
      container.visible = visible ? node.visible : false
    }
  }

  setGhostsVisible(ikVisible: boolean, poleVisible: boolean): void {
    for (const [nodeId, container] of this.#containers) {
      const node = this.#scene?.getNode(nodeId)
      if (!node || !node.components.ghost) continue
      const isPole = node.name.toLowerCase().includes('pole')
      const shouldVisible = isPole ? poleVisible : ikVisible
      container.visible = shouldVisible ? node.visible : false
    }
  }

  handleNodeReparented(nodeId: string): void {
    if (!this.#scene?.getNode(nodeId)) {
      return
    }
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    this.#attachToParent(container, this.#engine.getNode(nodeId))
    // Shadow sibling-under must follow
    if (this.#shadowContainers.has(nodeId)) {
      const shadow = this.#shadowContainers.get(nodeId)!
      this.#attachShadowSiblingUnder(this.#engine.getNode(nodeId), shadow)
    }
    this.#syncShadowLifecycleForNode(nodeId)
    // If reparented node was caster, update old and new parent shadows — mark dirty for both
    const node = this.#engine.getNode(nodeId)
    this.#markShadowDirtyForNode(nodeId)
    if (node.parent && this.#shadowContainers.has(node.parent.id)) {
      const t = this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0
      this.#updateShadowIfNeeded(node.parent.id, t)
    }
    // Also need to consider previous parent — but we don't have it; brute update all via hash check
    for (const gid of [...this.#shadowContainers.keys()])
      this.#updateShadowIfNeeded(gid, this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0)
    this.#flushShadowDirty()
  }

  handleNodeOrderChanged(nodeId: string): void {
    if (!this.#scene?.getNode(nodeId)) {
      return
    }
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    const node = this.#engine.getNode(nodeId)
    const parent = node.parent
    const parentContainer = parent ? this.#containers.get(parent.id) : null
    if (!parent || !parentContainer) {
      return
    }
    const ordered: PixiContainer[] = []
    for (const sibling of parent.children) {
      const siblingContainer = this.#containers.get(sibling.id)
      if (siblingContainer) {
        ordered.push(siblingContainer)
      }
    }
    const start = parentContainer.children.indexOf(ordered[0])
    for (const siblingContainer of ordered) {
      if (parentContainer.children.includes(siblingContainer)) {
        parentContainer.removeChild(siblingContainer)
      }
    }
    const base = Math.max(0, start)
    ordered.forEach((siblingContainer, offset) => {
      parentContainer.addChildAt(
        siblingContainer,
        Math.min(base + offset, parentContainer.children.length),
      )
    })
    // Restore shadow-before-group for any shadow hosts among siblings
    for (const sibling of parent.children) {
      if (this.#shadowContainers.has(sibling.id)) {
        const shadow = this.#shadowContainers.get(sibling.id)!
        const groupContainer = this.#containers.get(sibling.id)!
        const idx = parentContainer.children.indexOf(groupContainer as unknown as PixiContainer)
        const curIdx = parentContainer.children.indexOf(shadow as unknown as PixiContainer)
        if (idx >= 0 && curIdx !== idx) {
          parentContainer.removeChild(shadow as unknown as PixiContainer)
          parentContainer.addChildAt(shadow as unknown as PixiContainer, idx)
        }
      }
    }
  }

  #addNode(node: SceneNode): void {
    const container = createNodeContainer(this.#pixi, node, this.#textureCache)
    this.#containers.set(node.id, container)
    this.#nodeIds.set(container, node.id)
    this.#attachToParent(container, node)
    this.#recordSize(node, container)
    // Apply size-scaled pivot after size is known (normalized [-0.5,0.5] → pixels)
    const size = this.#sizes.get(node.id)
    if (size) {
      applyPivotWithSize(container, node.transform.localPivot, size)
    }
    this.#evaluateAndApply(node.id)
    const texId = node.material.textureId
    const isMeshLike = Boolean(node.components.mesh || node.components.circle)
    if (texId && isMeshLike) {
      // Mesh/circle with attached texture — prioritize material texture over assetInstance
      this.#loadAssetTexture(texId, node.id, container)
    } else {
      const instance = node.components.assetInstance
      if (instance) {
        this.#loadAssetTexture(instance.assetDefinitionId, node.id, container)
      } else if (texId) {
        // Non-mesh node with material texture (future-proof)
        this.#loadAssetTexture(texId, node.id, container)
      }
    }
    // Apply UV transform after texture placeholder is set
    if (node.components.mesh || node.components.circle) {
      applyUVTransformToContainer(this.#pixi, container, node)
    }
    if (node.components.chart) {
      this.handleChartChanged(node.id)
    }
  }

  #evaluateAndApply(nodeId: string): void {
    const scene = this.#scene
    const slideId = this.#slideId
    const container = this.#containers.get(nodeId)
    if (!scene || !slideId || !scene.getNode(nodeId) || !container) {
      return
    }
    const node = scene.getNode(nodeId)
    if (!node) return
    applyTableNodeOrdering(container, node)
    if (node && node.components.table) {
      const tableHash = JSON.stringify(node.components.table)
      const previousHash = this.#tableComponentHashes.get(nodeId)
      if (previousHash !== tableHash) {
        this.#tableComponentHashes.set(nodeId, tableHash)
        this.handleTableChanged(nodeId)
      }
    }
    if (node && node.components.chart) {
      const chartHash = JSON.stringify(node.components.chart)
      const previousHash = this.#chartComponentHashes.get(nodeId)
      if (previousHash !== chartHash) {
        this.#chartComponentHashes.set(nodeId, chartHash)
        this.handleChartChanged(nodeId)
      } else if (node.components.chart._dirty) {
        node.components.chart._dirty = false
        this.handleChartChanged(nodeId)
      }
      this.handleDataTransition(nodeId)
    }
    if (node && node.components.text) {
      const textHash = JSON.stringify(node.components.text)
      const previousHash = this.#textComponentHashes.get(nodeId)
      if (previousHash !== textHash) {
        this.#textComponentHashes.set(nodeId, textHash)
        this.handleTextChanged(nodeId)
      }
    }
    const time = this.#currentTime.getTime(slideId)
    if (node.components.circle) {
      const circleState = this.#engine.evaluateCircle(nodeId, time)
      if (circleState) {
        const circleHash = `${circleState.startAngle}:${circleState.endAngle}:${circleState.radius}:${circleState.segments}`
        const prevHash = this.#circleHashes.get(nodeId)
        if (prevHash !== circleHash) {
          this.#circleHashes.set(nodeId, circleHash)
          applyCircleDataWithUV(
            this.#pixi,
            container,
            node,
            circleState.startAngle,
            circleState.endAngle,
            circleState.radius,
            circleState.segments,
          )
          applyUVTransformToContainer(this.#pixi, container, node)
          const w = circleState.radius * 2
          const h = circleState.radius * 2
          this.#sizes.set(nodeId, { width: w, height: h, offsetX: 0, offsetY: 0 })
          this.#onNodeSizeChanged(nodeId)
        } else if (node.material.textureId || node.material.uvTransform) {
          // Material UV may have changed without circle geometry change — ensure UVs are current
          applyUVTransformToContainer(this.#pixi, container, node)
        }
      }
    }
    let tableStyleChanged = false
    if (node.components.table || node.components.tableCell) {
      const tableState = this.#engine.evaluateTable(nodeId, time)
      if (tableState) {
        const hash = `${tableState.borderRadius}:${tableState.padding}`
        const prev = this.#tableHashes.get(nodeId)
        if (prev !== hash) {
          this.#tableHashes.set(nodeId, hash)
          tableStyleChanged = true
          if (node.components.table) {
            const placeholder = placeholderOf(container)
            if (placeholder) {
              const availableWidth = this.#sizes.get(nodeId)?.width ?? DEFAULT_TABLE_WIDTH
              rebuildTableWithEvaluated(this.#pixi, placeholder, node, availableWidth, tableState)
            }
          } else if (node.components.tableCell) {
            rebuildTableChildWithEvaluated(this.#pixi, container, node, tableState)
            const size = tableChildSizeOf(container)
            if (size) {
              this.#sizes.set(nodeId, {
                ...size,
                offsetX: size.width / 2,
                offsetY: size.height / 2,
              })
            }
          }
        }
      }
    }
    const state = this.#engine.evaluateNode(nodeId, time, this.#scratch)
    const evaluatedOverrides = this.#engine.evaluateMaterialOverrides(
      nodeId,
      time,
      this.#materialOverridesScratch,
    )
    const material = this.#resolveMaterial(nodeId, evaluatedOverrides, this.#materialScratch)
    this.#resolveShader(nodeId, evaluatedOverrides, time, this.#shaderScratch)
    const shaderChanged = this.#applyNodeShader(nodeId, container, this.#shaderScratch)
    const previous = this.#lastEvaluated.get(nodeId)
    const previousMaterial = this.#lastMaterials.get(nodeId)
    const stateChanged = !previous || !evaluatedStatesEqual(previous, state)
    const materialChanged =
      !previousMaterial ||
      previousMaterial.tint !== material.tint ||
      previousMaterial.opacityMultiplier !== material.opacityMultiplier
    if (!stateChanged && !materialChanged && !shaderChanged && !tableStyleChanged) {
      return
    }
    applyEvaluatedState(container, state, material.opacityMultiplier)
    // Respect ghost overlay visibility after evaluated state
    if (node.components.ghost) {
      const { ikHandlesVisible, poleHandlesVisible } = useOverlayVisibilityStore.getState()
      const isPole = node.name.toLowerCase().includes('pole')
      const shouldVisible = isPole ? poleHandlesVisible : ikHandlesVisible
      if (!shouldVisible) {
        container.visible = false
      }
    }
    // Update size-scaled pivot (needs current size, which may have changed)
    const currentSize = this.#sizes.get(nodeId)
    if (currentSize) {
      applyPivotWithSize(container, state.transform.localPivot, currentSize)
    }
    this.#positionTableText(node, container, state)
    const ikRotation = this.#ikOverrides.get(nodeId)
    if (ikRotation !== undefined) {
      container.rotation = ikRotation
    }
    if (materialChanged && !this.#missingNodes.has(nodeId)) {
      applyMaterialTint(container, material.tint)
    }
    const stored = previous ?? evaluatedNodeScratch()
    copyEvaluatedState(stored, state)
    this.#lastEvaluated.set(nodeId, stored)
    const storedMaterial = previousMaterial ?? effectiveMaterialScratch()
    storedMaterial.tint = material.tint
    storedMaterial.opacityMultiplier = material.opacityMultiplier
    this.#lastMaterials.set(nodeId, storedMaterial)
  }

  #applyConstraints(nodeId: string, container: PixiContainer): void {
    const constraintManager = this.#engine.getConstraintManager()
    const constraints = constraintManager.getConstraintsForNode(nodeId)
    if (constraints.length === 0) {
      return
    }

    const time = this.#currentTime.getTime(this.#slideId!)
    const world = this.#engineWorldTransform(nodeId, time)
    if (!world) {
      return
    }

    const context: ConstraintEvaluationContext = {
      nodeLookup: (id) => this.#engine.getNode(id),
      worldTransformLookup: (id) => this.#engineWorldTransform(id, time),
    }
    const constrained = applyConstraints(world, constraints, context)

    const node = this.#engine.getNode(nodeId)
    const parentWorld = node.parent ? this.#engineWorldTransform(node.parent.id, time) : null
    if (parentWorld) {
      const local = relativeTransform(constrained, parentWorld)
      if (local) {
        this.#applyLocalRotationLimit(nodeId, local)
        container.position.set(local.x, local.y)
        container.rotation = local.rotation
        container.scale.set(local.scaleX, local.scaleY)
        return
      }
    }
    this.#applyLocalRotationLimit(nodeId, constrained)
    container.position.set(constrained.x, constrained.y)
    container.rotation = constrained.rotation
    container.scale.set(constrained.scaleX, constrained.scaleY)
  }

  #engineWorldTransform(nodeId: string, time: number): WorldTransform | null {
    let node: SceneNode
    try {
      node = this.#engine.getNode(nodeId)
    } catch {
      return null
    }
    const chain: SceneNode[] = []
    for (let cursor: SceneNode | null = node; cursor !== null; cursor = cursor.parent) {
      chain.push(cursor)
    }
    chain.reverse()
    return composeChain(chain, (link) => {
      const local = this.#engine.evaluateNode(link.id, time, this.#scratch).transform
      const ikRotation = this.#ikOverrides.get(link.id)
      return ikRotation === undefined ? local : { ...local, rotation: ikRotation }
    })
  }

  #applyLocalRotationLimit(nodeId: string, transform: { rotation: number }): void {
    const constraintManager = this.#engine.getConstraintManager()
    const constraints = constraintManager.getConstraintsForNode(nodeId)
    for (const c of constraints) {
      if (c.type === 'rotationLimit') {
        const { minRotation, maxRotation } = c.params as {
          minRotation: number
          maxRotation: number
        }
        const minRad = (minRotation * Math.PI) / 180
        const maxRad = (maxRotation * Math.PI) / 180
        transform.rotation = Math.max(minRad, Math.min(maxRad, transform.rotation))
      }
    }
  }

  refreshNodeRendering(): void {
    const scene = this.#scene
    if (!scene) {
      return
    }
    for (const node of walkPreOrder(scene.root)) {
      this.#evaluateAndApply(node.id)
    }
  }

  #applyNodeShader(
    nodeId: string,
    container: PixiContainer,
    scratch: EffectiveShaderScratch,
  ): boolean {
    const placeholder = placeholderOf(container)
    if (!placeholder) {
      return false
    }
    let state = this.#nodeShaders.get(nodeId)
    if (!state) {
      state = { filter: null, scratch: effectiveShaderScratch() }
      this.#nodeShaders.set(nodeId, state)
    }
    if (shaderUniformsEqual(state.scratch, scratch)) {
      return false
    }
    if (state.filter && !scratch.source) {
      placeholder.filters = []
      state.filter.destroy()
      state.filter = null
    }
    const previousFilter = state.filter
    if (scratch.source) {
      const sameSource = previousFilter !== null && state.scratch.source === scratch.source
      const filter = sameSource
        ? previousFilter
        : createNodeShaderFilter(
            this.#pixi,
            this.#programCache,
            scratch.source,
            scratch,
            this.#textureCache,
          )
      if (!sameSource) {
        previousFilter?.destroy()
      }
      applyFilterUniforms(filter, scratch)
      bindFilterSamplers(filter, scratch.samplers, this.#resolveAssetUrl, this.#textureCache)
      placeholder.filters = [filter]
      state.filter = filter
    }
    copyShaderUniforms(state.scratch, scratch)
    return true
  }

  #resolveMaterial(
    nodeId: string,
    overrides: MaterialOverrides,
    target: EffectiveMaterialScratch,
  ): EffectiveMaterialScratch {
    const node = this.#scene?.getNode(nodeId)
    if (!node) {
      return target
    }
    let parameters = UNKNOWN_DEFINITION_PARAMETERS
    try {
      parameters = this.#engine.getMaterialDefinition(node.material.materialDefinitionId).parameters
    } catch {
      parameters = UNKNOWN_DEFINITION_PARAMETERS
    }
    return resolveMaterial(parameters, overrides, target)
  }

  #resolveShader(
    nodeId: string,
    overrides: MaterialOverrides,
    time: number,
    target: EffectiveShaderScratch,
  ): void {
    const node = this.#scene?.getNode(nodeId)
    if (!node) {
      target.source = null
      resolveShaderUniforms(UNKNOWN_DEFINITION_PARAMETERS, {}, target, time)
      return
    }
    let parameters = UNKNOWN_DEFINITION_PARAMETERS
    let shaderId: string | null = null
    try {
      const definition = this.#engine.getMaterialDefinition(node.material.materialDefinitionId)
      parameters = definition.parameters
      shaderId = definition.shaderId
    } catch {
      parameters = UNKNOWN_DEFINITION_PARAMETERS
    }
    resolveShaderUniforms(parameters, overrides, target, time)
    target.source = shaderId ? this.#resolveShaderSource(shaderId) : null
  }

  #recordSize(node: SceneNode, container: PixiContainer): void {
    if (node.components.table) {
      const tableSize = tableSizeOf(placeholderOf(container) ?? container)
      if (tableSize) {
        this.#sizes.set(node.id, {
          ...tableSize,
          offsetX: tableSize.width / 2,
          offsetY: tableSize.height / 2,
        })
      }
      return
    }
    if (node.components.tableCell) {
      const size = tableChildSizeOf(container)
      if (size) this.#sizes.set(node.id, size)
      return
    }
    if (node.components.tableRow) {
      return
    }
    if (node.components.chart) {
      this.#sizes.set(node.id, {
        width: CHART_DEFAULT_WIDTH,
        height: CHART_DEFAULT_HEIGHT,
      })
      return
    }
    if (node.components.text) {
      const placeholder = placeholderOf(container)
      const size = placeholder ? textSizeOf(placeholder) : null
      if (size) {
        this.#sizes.set(node.id, this.#tableTextSize(node, size))
      }
      return
    }
    if (node.components.circle) {
      const circle = node.components.circle
      this.#sizes.set(node.id, {
        width: circle.radius * 2,
        height: circle.radius * 2,
        offsetX: 0,
        offsetY: 0,
      })
      const size = { width: circle.radius * 2, height: circle.radius * 2, offsetX: 0, offsetY: 0 }
      applyPivotWithSize(container, node.transform.localPivot, size)
      return
    }
    const placeholder = placeholderOf(container)
    const size = placeholder ? placeholderSize(placeholder) : null
    if (size) {
      this.#sizes.set(node.id, size)
      applyPivotWithSize(container, node.transform.localPivot, size)
    }
  }

  #loadAssetTexture(definitionId: string, nodeId: string, container: PixiContainer): void {
    const placeholder = placeholderOf(container)
    if (!placeholder) {
      return
    }
    if (this.#isAssetMissing(definitionId)) {
      this.#missingNodes.add(nodeId)
      applyMissingPlaceholder(placeholder)
      return
    }
    this.#missingNodes.delete(nodeId)
    const url = this.#resolveAssetUrl(definitionId)
    if (!url) {
      return
    }
    const load = this.#textureCache.load(url, definitionId)
    void load.then((result) => {
      // A node may have changed or detached its texture while this request was pending.
      // Never let an old request overwrite the currently selected material.
      const currentNode = this.#scene?.getNode(nodeId)
      const currentTextureId =
        currentNode?.material.textureId ?? currentNode?.components.assetInstance?.assetDefinitionId
      if (
        !result.real ||
        container.destroyed ||
        !currentNode ||
        currentTextureId !== definitionId
      ) {
        return
      }
      applyAssetTexture(placeholder, result.texture)
      if (currentNode.components.mesh || currentNode.components.circle) {
        applyUVTransformToContainer(this.#pixi, container, currentNode)
      }
      const material = this.#resolveMaterial(
        nodeId,
        currentNode.material.overrides,
        this.#materialScratch,
      )
      applyMaterialTint(container, material.tint)
      const size = placeholderSize(placeholder)
      if (size) {
        this.#sizes.set(nodeId, size)
        applyPivotWithSize(container, currentNode.transform.localPivot, size)
        this.#onNodeSizeChanged(nodeId)
      }
    })
  }

  refreshAssetTextures(): void {
    const scene = this.#scene
    if (!scene) {
      return
    }
    for (const node of walkPreOrder(scene.root)) {
      const container = this.#containers.get(node.id)
      if (!container) {
        continue
      }
      const texId = node.material.textureId
      const isMeshLike = Boolean(node.components.mesh || node.components.circle)
      if (texId && isMeshLike) {
        this.#loadAssetTexture(texId, node.id, container)
        continue
      }
      const instance = node.components.assetInstance
      if (instance) {
        this.#loadAssetTexture(instance.assetDefinitionId, node.id, container)
        continue
      }
      if (texId) {
        this.#loadAssetTexture(texId, node.id, container)
      }
    }
  }

  #attachToParent(container: PixiContainer, node: SceneNode): void {
    const renderParent = node.components.tableCell ? this.#owningTable(node) : node.parent
    const parentContainer = renderParent ? this.#containers.get(renderParent.id) : undefined
    ;(parentContainer ?? this.#world).addChild(container)
  }

  #refreshOwningTable(node: SceneNode): void {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.components.table) {
        this.handleTableChanged(parent.id)
        return
      }
    }
  }

  #tableAncestorId(container: PixiContainer): string | undefined {
    for (let parent = container.parent; parent; parent = parent.parent) {
      const nodeId = this.#nodeIds.get(parent)
      if (nodeId && this.#scene?.getNode(nodeId)?.components.table) {
        return nodeId
      }
    }
    return undefined
  }

  #owningTable(node: SceneNode): SceneNode | undefined {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (parent.components.table) return parent
    }
    return undefined
  }

  #refreshTableChildren(table: SceneNode): void {
    for (const node of walkPreOrder(table)) {
      if (node === table || !node.components.tableCell) continue
      const container = this.#containers.get(node.id)
      if (!container) continue
      applyTableNodeOrdering(container, node)
      refreshTableChildContainer(this.#pixi, container, node)
      const size = tableChildSizeOf(container)
      if (size) {
        this.#sizes.set(node.id, {
          ...size,
          offsetX: size.width / 2,
          offsetY: size.height / 2,
        })
      }
    }
  }

  #tableTextBaseOffset(node: SceneNode, size: WorldSize): { x: number; y: number } {
    const cell = node.parent!
    const slideId = this.#slideId
    let evaluatedPadding: number | undefined
    if (slideId) {
      const time = this.#currentTime.getTime(slideId)
      const tableState = this.#engine.evaluateTable(cell.id, time)
      if (tableState) evaluatedPadding = tableState.padding
    }
    const table = this.#owningTable(node)?.components.table
    const padding = evaluatedPadding ?? cell.components.tableCell!.padding ?? table?.padding ?? 0
    return { x: padding + size.width / 2, y: padding + size.height / 2 }
  }

  #positionTableText(
    node: SceneNode,
    container: PixiContainer,
    state: { transform: { x: number; y: number } },
  ): void {
    if (!node.components.text || !node.parent?.components.tableCell) return
    const textGroup = placeholderOf(container)
    const size = textGroup ? textSizeOf(textGroup) : undefined
    if (!size) return
    const base = this.#tableTextBaseOffset(node, size)
    container.position.set(base.x + state.transform.x, base.y + state.transform.y)
  }

  #tableTextSize(node: SceneNode, size: WorldSize): WorldSize {
    if (!node.parent?.components.tableCell) return size
    const cell = node.parent!
    const slideId = this.#slideId
    let evaluatedPadding: number | undefined
    if (slideId) {
      const time = this.#currentTime.getTime(slideId)
      const state = this.#engine.evaluateTable(cell.id, time)
      if (state) evaluatedPadding = state.padding
    }
    const table = this.#owningTable(node)?.components.table
    const padding = evaluatedPadding ?? cell.components.tableCell!.padding ?? table?.padding ?? 0
    return {
      ...size,
      offsetX: padding + size.width / 2,
      offsetY: padding + size.height / 2,
    }
  }

  // ── Shadow Effect helpers — BBox & hashing (spec #304) ───────────────────
  #markShadowDirtyForNode(nodeId: string): void {
    let cur: SceneNode | null | undefined = this.#scene?.getNode(nodeId) ?? null
    // Climb to all ancestor shadow hosts (including node itself)
    while (cur) {
      if (cur.shadowEffect && isGroupNode(cur)) {
        this.#shadowDirty.add(cur.id)
      }
      cur = cur.parent
    }
    // Also walk parents of node's parent via scene lookup if node removed? Already covered
    // For safety, if node is caster under multiple groups, all ancestors already added
    void worldAabbOf // ensure import used per spec
  }

  #computeCasterHash(groupNode: SceneNode, time: number): string {
    const casters = collectShadowCasters(groupNode)
    const parts: string[] = []
    for (const caster of casters) {
      let world: { x: number; y: number; rotation: number; scaleX: number; scaleY: number } | null =
        null
      try {
        world = this.#engineWorldTransformForShadow(caster.id, time)
      } catch {
        world = null
      }
      const wt = world ?? {
        x: caster.transform.x,
        y: caster.transform.y,
        rotation: caster.transform.rotation,
        scaleX: caster.transform.scaleX,
        scaleY: caster.transform.scaleY,
      }
      let visible = caster.visible
      let worldAlpha = caster.opacity
      try {
        const st = this.#engine.evaluateNode(caster.id, time)
        visible = st.visible
        worldAlpha = this.#worldAlphaForNode(caster.id)
      } catch {
        visible = caster.visible
        worldAlpha = this.#worldAlphaForNode(caster.id) ?? caster.opacity
      }
      const size = this.#sizes.get(caster.id)
      const sizeKey = size
        ? `${size.width.toFixed(2)}x${size.height.toFixed(2)}:${(size.offsetX ?? 0).toFixed(1)},${(size.offsetY ?? 0).toFixed(1)}`
        : '0x0'
      let extra = ''
      // morph coefficient
      try {
        const coeff = this.#engine.evaluateMorph(caster.id, time)
        if (typeof coeff === 'number' && coeff !== 0) extra += `,morph:${coeff.toFixed(3)}`
      } catch (_e) {
        void _e
      }
      // deformed hash via size already, plus mesh vertices hash if available
      if (caster.components.mesh) {
        try {
          const slideId = this.#slideId
          const t = slideId ? this.#currentTime.getTime(slideId) : time
          const meshComp = caster.components.mesh as {
            mesh: import('../../engine/mesh').MeshData
            shapes?: readonly import('../../engine/shape').Shape[]
          }
          const base = meshComp.mesh
          const shapes = meshComp.shapes
          const bones = new Map<string, import('../../engine/worldTransform').WorldTransform>()
          if (this.#scene) {
            for (const n of walkPreOrder(this.#scene.root)) {
              if (n.components.bone) {
                const wtB = this.#engineWorldTransformForShadow(n.id, t)
                if (wtB)
                  bones.set(
                    n.id,
                    wtB as unknown as import('../../engine/worldTransform').WorldTransform,
                  )
              }
            }
          }
          const engineAny = this.#engine as unknown as {
            evaluateMorphVertices?: (
              id: string,
              tm: number,
              verts: readonly unknown[],
              shapes: unknown,
            ) => readonly { x: number; y: number }[] | null
          }
          const deformed = engineAny.evaluateMorphVertices
            ? engineAny.evaluateMorphVertices(caster.id, t, base.vertices, shapes)
            : null
          const verts = deformed ?? base.vertices
          // simple hash of first 4 vertices
          const h = verts
            .slice(0, 4)
            .map(
              (v) =>
                `${(v as { x: number; y: number }).x.toFixed(1)},${(v as { y: number }).y.toFixed(1)}`,
            )
            .join(';')
          if (h) extra += `,def:${h}`
        } catch (_e) {
          void _e
        }
      }
      parts.push(
        `${caster.id}:${wt.x.toFixed(2)},${wt.y.toFixed(2)},${wt.rotation.toFixed(3)},${wt.scaleX.toFixed(3)},${wt.scaleY.toFixed(3)},${visible ? 1 : 0},${worldAlpha.toFixed(3)},${sizeKey}${extra}`,
      )
    }
    let gWorld: { x: number; y: number } | null = null
    try {
      const gw = this.#engineWorldTransformForShadow(groupNode.id, time)
      if (gw) gWorld = gw
    } catch (_e) {
      void _e
    }
    if (gWorld) parts.push(`g:${gWorld.x.toFixed(2)},${gWorld.y.toFixed(2)}`)
    return parts.join('|')
  }

  #computeParamHash(evaluated: import('../../engine/shadowEffect').ShadowEffect): string {
    const e = clampShadowEffect(evaluated)
    return `${e.offsetX},${e.offsetY},${e.scaleX},${e.scaleY},${e.skewX},${e.skewY},${e.rotation},${e.blur},${e.opacity},${e.color}`
  }

  #updateShadowIfNeeded(groupId: string, time: number): boolean {
    const groupNode = this.#scene?.getNode(groupId)
    if (!groupNode || !groupNode.shadowEffect) return false
    if (!isGroupNode(groupNode)) {
      this.#destroyShadowForGroup(groupId)
      return false
    }
    let evaluated: import('../../engine/shadowEffect').ShadowEffect | null = null
    try {
      evaluated = this.#engine.evaluateShadow(groupId, time)
    } catch {
      evaluated = clampShadowEffect(groupNode.shadowEffect, groupId)
    }
    if (!evaluated) return false
    const casterHash = this.#computeCasterHash(groupNode, time)
    const paramHash = this.#computeParamHash(evaluated)
    const lastCaster = this.#shadowLastCasterHash.get(groupId)
    const lastParam = this.#shadowLastParamHash.get(groupId)
    if (casterHash === lastCaster && paramHash === lastParam && !this.#shadowDirty.has(groupId)) {
      // idle reuse — no RT work
      return false
    }
    this.#doUpdateShadowForGroup(groupId, evaluated, casterHash, paramHash)
    this.#shadowDirty.delete(groupId)
    return true
  }

  #flushShadowDirty(): void {
    const time = this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0
    for (const gid of [...this.#shadowDirty]) {
      this.#updateShadowIfNeeded(gid, time)
    }
  }

  // ── Shadow Effect lifecycle & rendering ────────────────────────────────
  #ensureShadowWhiteFilter(): PixiFilter {
    if (this.#shadowWhiteFilter) return this.#shadowWhiteFilter
    const program = this.#programCache.get(WHITE_ALPHA_FRAGMENT)
    this.#shadowWhiteFilter = new this.#pixi.Filter({ glProgram: program, resources: {} })
    return this.#shadowWhiteFilter
  }

  #destroyAllShadows(): void {
    for (const groupId of [...this.#shadowContainers.keys()]) {
      this.#destroyShadowForGroup(groupId)
    }
    this.#shadowWhiteFilter?.destroy()
    this.#shadowWhiteFilter = null
    this.#shadowDirty.clear()
    this.#shadowLastCasterHash.clear()
    this.#shadowLastParamHash.clear()
  }

  #destroyShadowForGroup(groupId: string): void {
    const container = this.#shadowContainers.get(groupId)
    const sprite = this.#shadowSprites.get(groupId)
    const rt = this.#shadowTextures.get(groupId)
    const blur = this.#shadowBlurFilters.get(groupId)
    // Clean sprite filters
    if (sprite) {
      ;(sprite as unknown as { filters: unknown }).filters = []
    }
    if (blur) {
      try {
        ;(blur as unknown as { destroy?: () => void }).destroy?.()
      } catch {
        void 0
      }
    }
    this.#shadowBlurFilters.delete(groupId)
    this.#shadowSprites.delete(groupId)
    this.#shadowTextures.delete(groupId)
    this.#shadowContainers.delete(groupId)
    this.#shadowLastCasterHash.delete(groupId)
    this.#shadowLastParamHash.delete(groupId)
    this.#shadowDirty.delete(groupId)
    if (container) {
      try {
        container.destroy({ children: true })
      } catch {
        void 0
      }
    }
    if (rt) {
      try {
        rt.destroy()
      } catch {
        void 0
      }
    }
  }

  #ensureShadowForGroup(groupNode: SceneNode): void {
    if (!groupNode.shadowEffect) return
    if (!isGroupNode(groupNode)) return
    const groupId = groupNode.id
    if (this.#shadowContainers.has(groupId)) {
      // already exists — update properties
      this.#updateShadowSpriteProps(groupId)
      return
    }
    const effect = clampShadowEffect(groupNode.shadowEffect, groupId)
    const pad = Math.ceil(effect.blur * 2 + 4)
    void pad
    // Create RT
    const rt = this.#pixi.RenderTexture.create({ width: 4, height: 4 })
    // Create sprite from RT
    const sprite = new this.#pixi.Sprite(rt as unknown as import('pixi.js').Texture)
    sprite.label = `shadow-sprite:${groupId}`
    sprite.anchor?.set?.(0, 0)
    // Container
    const container = new this.#pixi.Container()
    container.label = `shadow:${groupId}`
    container.addChild(sprite as unknown as PixiContainer)
    container.sortableChildren = false
    // Blur filter
    let blurFilter: PixiFilter | null = null
    if (effect.blur > 0) {
      try {
        blurFilter = new this.#pixi.BlurFilter({
          strength: effect.blur,
          quality: 2,
          kernelSize: 5,
        } as unknown as Record<string, unknown>) as unknown as PixiFilter
      } catch {
        blurFilter = null
      }
    }
    if (blurFilter) {
      sprite.filters = [blurFilter as unknown as PixiFilter]
    } else {
      ;(sprite as unknown as { filters: unknown }).filters = []
    }
    this.#shadowContainers.set(groupId, container)
    this.#shadowSprites.set(groupId, sprite as unknown as PixiSprite)
    this.#shadowTextures.set(groupId, rt)
    this.#shadowBlurFilters.set(groupId, blurFilter)

    // Insert sibling-under
    this.#attachShadowSiblingUnder(groupNode, container)

    // Initial props
    this.#updateShadowSpriteProps(groupId)
    // Initial size + render
    this.#updateShadowForGroup(groupId)
  }

  #attachShadowSiblingUnder(groupNode: SceneNode, shadowContainer: PixiContainer): void {
    const renderParent = groupNode.components.tableCell
      ? this.#owningTable(groupNode)
      : groupNode.parent
    const parentContainer = renderParent ? this.#containers.get(renderParent.id) : undefined
    const worldOrParent = (parentContainer ?? this.#world) as PixiContainer
    const groupContainer = this.#containers.get(groupNode.id)
    if (!groupContainer) {
      worldOrParent.addChild(shadowContainer)
      return
    }
    const idx = worldOrParent.children.indexOf(groupContainer as unknown as PixiContainer)
    const at = idx >= 0 ? idx : worldOrParent.children.length
    // Ensure sortableChildren for table parent
    if (worldOrParent)
      (worldOrParent as unknown as { sortableChildren: boolean }).sortableChildren = true
    worldOrParent.addChildAt(shadowContainer as unknown as PixiContainer, at)
  }

  #updateShadowSpriteProps(
    groupId: string,
    evaluatedOverride?: import('../../engine/shadowEffect').ShadowEffect,
  ): void {
    const groupNode = this.#scene?.getNode(groupId)
    if (!groupNode || !groupNode.shadowEffect) return
    let effect: import('../../engine/shadowEffect').ShadowEffect
    if (evaluatedOverride) {
      effect = clampShadowEffect(evaluatedOverride, groupId)
    } else {
      const slideId = this.#slideId
      const time = slideId ? this.#currentTime.getTime(slideId) : 0
      try {
        const ev = this.#engine.evaluateShadow(groupId, time)
        effect = ev
          ? clampShadowEffect(ev, groupId)
          : clampShadowEffect(groupNode.shadowEffect, groupId)
      } catch {
        effect = clampShadowEffect(groupNode.shadowEffect, groupId)
      }
    }
    const sprite = this.#shadowSprites.get(groupId)
    const container = this.#shadowContainers.get(groupId)
    if (!sprite || !container) return
    // Position / rotation / scale / skew pivot 0,0 — degrees → rad at write, pivot 0,0
    const s = sprite as unknown as {
      x: number
      y: number
      rotation: number
      scale: { x: number; y: number; set: (x: number, y: number) => void }
      skew: { x: number; y: number; set: (x: number, y: number) => void }
      alpha: number
      tint: number
      visible: boolean
      blendMode: string
    }
    s.x = effect.offsetX
    s.y = effect.offsetY
    s.rotation = (effect.rotation * Math.PI) / 180
    s.scale.set(effect.scaleX, effect.scaleY)
    s.skew.set((effect.skewX * Math.PI) / 180, (effect.skewY * Math.PI) / 180)
    // Alpha bakes groupChainOpacity * shadowOpacity — use worldAlpha chain
    // EvaluateShadow already baked own opacity; we recompute to include ancestors
    let sAlpha: number
    try {
      const t = this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0
      const ownOpacity = this.#engine.evaluateNode(groupId, t).opacity
      const worldAlpha = this.#worldAlphaForNode(groupId)
      // if effect came from raw base without bake, ownOpacity factor not present; detect by comparing raw base?
      // Fallback: if effect.opacity came from raw clamp without bake, ownOpacity division would be wrong
      // Heuristic: if evaluatedOverride provided, effect already baked ownOpacity, so divide
      // If no override (raw), effect is raw base -> just worldAlpha*effect.opacity
      if (evaluatedOverride) {
        sAlpha = ownOpacity !== 0 ? (worldAlpha * effect.opacity) / ownOpacity : effect.opacity
      } else {
        sAlpha = worldAlpha * effect.opacity
      }
      // Clamp
      sAlpha = Math.max(0, Math.min(1, sAlpha))
    } catch {
      const groupAlpha = this.#worldAlphaForNode(groupId)
      sAlpha = Math.max(0, Math.min(1, groupAlpha * effect.opacity))
    }
    s.alpha = sAlpha
    s.tint = hexStringToTint(effect.color)
    ;(sprite as unknown as { blendMode: string }).blendMode = 'normal'
    // Blur filter update
    const currentBlur = this.#shadowBlurFilters.get(groupId)
    if (effect.blur <= 0) {
      if (currentBlur) {
        ;(sprite as unknown as { filters: unknown }).filters = []
        try {
          ;(currentBlur as unknown as { destroy?: () => void }).destroy?.()
        } catch {
          void 0
        }
        this.#shadowBlurFilters.set(groupId, null)
      }
    } else {
      let blurFilter = currentBlur
      if (!blurFilter) {
        try {
          blurFilter = new this.#pixi.BlurFilter({
            strength: effect.blur,
            quality: 2,
            kernelSize: 5,
          } as unknown as Record<string, unknown>) as unknown as PixiFilter
        } catch {
          blurFilter = null
        }
        if (blurFilter) {
          sprite.filters = [blurFilter as unknown as PixiFilter]
          this.#shadowBlurFilters.set(groupId, blurFilter)
        }
      } else {
        // Update strength if api allows
        try {
          ;(blurFilter as unknown as { strength: number }).strength = effect.blur
        } catch {
          void 0
        }
      }
    }
    // Mirror visible
    const groupContainer = this.#containers.get(groupId)
    if (groupContainer) {
      container.visible = groupContainer.visible
    } else {
      container.visible = groupNode.visible
    }
  }

  #worldAlphaForNode(nodeId: string): number {
    let alpha = 1
    let cur: SceneNode | null | undefined = this.#scene?.getNode(nodeId)
    const slideId = this.#slideId
    const time = slideId ? this.#currentTime.getTime(slideId) : 0
    // Walk up and multiply evaluated opacity
    while (cur) {
      try {
        const state = this.#engine.evaluateNode(cur.id, time)
        alpha *= state.opacity
        // Also multiply material opacityMultiplier? Use evaluateMaterialOverrides
        const overrides = this.#engine.evaluateMaterialOverrides(cur.id, time)
        // Try to get tint opacity? For simplicity ignore
        void overrides
      } catch {
        alpha *= cur.opacity
      }
      cur = cur.parent
    }
    return alpha
  }

  #doUpdateShadowForGroup(
    groupId: string,
    evaluated: import('../../engine/shadowEffect').ShadowEffect,
    casterHash: string,
    paramHash: string,
  ): void {
    const groupNode = this.#scene?.getNode(groupId)
    if (!groupNode || !groupNode.shadowEffect) return
    if (!isGroupNode(groupNode)) {
      this.#destroyShadowForGroup(groupId)
      return
    }
    const effect = clampShadowEffect(evaluated, groupId)
    const casters = collectShadowCasters(groupNode)
    // Gate visible/opacity >0.01 at render time
    const slideId = this.#slideId
    const time = slideId ? this.#currentTime.getTime(slideId) : 0
    let union: WorldAabb | null = null
    for (const caster of casters) {
      let visible = true
      let worldAlpha = 1
      try {
        const st = this.#engine.evaluateNode(caster.id, time)
        visible = st.visible
        worldAlpha = st.opacity
      } catch {
        visible = caster.visible
        worldAlpha = caster.opacity
      }
      if (!visible || worldAlpha <= 0.01) continue
      const size = this.#sizes.get(caster.id)
      if (!size) continue
      let worldTr: {
        x: number
        y: number
        rotation: number
        scaleX: number
        scaleY: number
      } | null = null
      try {
        const ev = this.#engine.evaluateNode(caster.id, time)
        worldTr = {
          x: ev.transform.x,
          y: ev.transform.y,
          rotation: ev.transform.rotation,
          scaleX: ev.transform.scaleX,
          scaleY: ev.transform.scaleY,
        }
      } catch {
        const t = caster.transform
        worldTr = { x: t.x, y: t.y, rotation: t.rotation, scaleX: t.scaleX, scaleY: t.scaleY }
      }
      // Compute world transform chain — use worldAabbOf union + mergeRect per spec #304
      const world = this.#engineWorldTransformForShadow(caster.id, time)
      const trForAabb = world ?? worldTr
      if (!trForAabb) continue
      const aabbFromHitTest = this.#scene
        ? worldAabbOf(
            this.#scene,
            caster.id,
            (id) => this.#sizes.get(id) ?? null,
            (id) => this.#engineWorldTransformForShadow(id, time) as unknown as WorldTransform,
          )
        : null
      const aabbFallback = worldAabbOfNode(size, trForAabb)
      const aabb = aabbFromHitTest ?? aabbFallback
      union = union ? (mergeRect(union as never, aabb as never) as unknown as WorldAabb) : aabb
    }
    const { width, height, pad } = rtSizeForAabb(union, effect.blur)
    const rt = this.#shadowTextures.get(groupId)
    if (!rt) return
    if (rt.width !== width || rt.height !== height) {
      try {
        rt.resize(width, height)
      } catch {
        void 0
      }
    }
    // Silhouette generation: temp clone with white-alpha filter
    // For tracer bullet we render a dummy white container to prove RT usage
    const temp = new this.#pixi.Container()
    temp.label = `shadow-silhouette:${groupId}`
    // Build simple white graphics for each caster's bbox centered at pad
    // If union exists, place graphics relative to union.min
    if (union) {
      const minX = union.minX
      const minY = union.minY
      for (const caster of casters) {
        const size = this.#sizes.get(caster.id)
        if (!size) continue
        let visible = true
        let worldAlpha = 1
        try {
          const st = this.#engine.evaluateNode(caster.id, time)
          visible = st.visible
          worldAlpha = st.opacity
        } catch {
          visible = caster.visible
          worldAlpha = caster.opacity
        }
        if (!visible || worldAlpha <= 0.01) continue
        const world = this.#engineWorldTransformForShadow(caster.id, time)
        if (!world) continue
        const aabbHit = this.#scene
          ? worldAabbOf(
              this.#scene,
              caster.id,
              (id) => this.#sizes.get(id) ?? null,
              (id) => this.#engineWorldTransformForShadow(id, time) as unknown as WorldTransform,
            )
          : null
        const aabbFallback = worldAabbOfNode(size, world)
        const aabb = aabbHit ?? aabbFallback
        const rectX = aabb.minX - minX + pad
        const rectY = aabb.minY - minY + pad
        const rectW = aabb.maxX - aabb.minX
        const rectH = aabb.maxY - aabb.minY
        if (rectW <= 0 || rectH <= 0) continue
        const g = new this.#pixi.Graphics()
        // White opaque rect — alpha preserved via filter later, but for now use white
        g.rect(rectX, rectY, rectW, rectH).fill({ color: 0xffffff, alpha: worldAlpha })
        temp.addChild(g as unknown as PixiContainer)
      }
    } else {
      // No casters / hidden — keep temp empty, RT stays clear
    }
    // Apply white-alpha filter to preserve soft edges (placeholder: use white filter)
    try {
      const wf = this.#ensureShadowWhiteFilter()
      temp.filters = [wf as unknown as PixiFilter]
    } catch {
      void 0
    }
    // Render to RT with clear 0x00000000
    try {
      this.#renderToTexture({
        container: temp as unknown as PixiContainer,
        target: rt,
        clear: true,
        clearColor: 0x00000000 as unknown as number,
      })
    } catch {
      // Fallback without clearColor
      try {
        this.#renderToTexture({
          container: temp as unknown as PixiContainer,
          target: rt,
          clear: true,
        })
      } catch {
        void 0
      }
    }
    temp.destroy({ children: true })
    // Update sprite with evaluated projection (position→rotation→scale→skew) and bake alpha
    this.#updateShadowSpriteProps(groupId, evaluated)
    this.#shadowLastCasterHash.set(groupId, casterHash)
    this.#shadowLastParamHash.set(groupId, paramHash)
  }

  #updateShadowForGroup(groupId: string): void {
    const time = this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0
    this.#updateShadowIfNeeded(groupId, time)
  }

  #engineWorldTransformForShadow(
    nodeId: string,
    time: number,
  ): { x: number; y: number; rotation: number; scaleX: number; scaleY: number } | null {
    try {
      const node = this.#engine.getNode(nodeId)
      const chain: SceneNode[] = []
      for (let cursor: SceneNode | null = node; cursor !== null; cursor = cursor.parent)
        chain.push(cursor)
      chain.reverse()
      const composed = composeChain(chain, (link) => {
        try {
          return this.#engine.evaluateNode(link.id, time).transform
        } catch {
          return link.transform
        }
      })
      if (!composed) return null
      return {
        x: composed.x,
        y: composed.y,
        rotation: composed.rotation,
        scaleX: composed.scaleX,
        scaleY: composed.scaleY,
      }
    } catch {
      return null
    }
  }

  handleShadowEffectChanged(nodeId: string): void {
    const node = this.#scene?.getNode(nodeId)
    if (!node) return
    if (node.shadowEffect && isGroupNode(node)) {
      this.#ensureShadowForGroup(node)
      const t = this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0
      this.#updateShadowIfNeeded(nodeId, t)
      this.#updateShadowSpriteProps(nodeId)
    } else {
      this.#destroyShadowForGroup(nodeId)
      // Also check if node was group that lost status — ensure destroyed
      // Check parent groups that might have lost child
      if (node.parent && node.parent.shadowEffect) {
        const t = this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0
        this.#updateShadowIfNeeded(node.parent.id, t)
      }
    }
    this.#shadowDirty.delete(nodeId)
  }

  handleCastShadowChanged(nodeId: string): void {
    // Ancestor groups' silhouettes may have changed; mark dirty via climbing
    this.#markShadowDirtyForNode(nodeId)
    this.#flushShadowDirty()
  }

  #syncShadowLifecycleForNode(nodeId: string): void {
    const node = this.#scene?.getNode(nodeId)
    if (!node) return
    // If node itself is group with effect, ensure or destroy based on current state
    if (node.shadowEffect) {
      if (isGroupNode(node)) this.#ensureShadowForGroup(node)
      else this.#destroyShadowForGroup(nodeId)
    }
    // If node's parent is group with effect, that group's shadow may need update (child added/removed)
    if (node.parent && node.parent.shadowEffect && isGroupNode(node.parent)) {
      const t = this.#slideId ? this.#currentTime.getTime(this.#slideId) : 0
      this.#updateShadowIfNeeded(node.parent.id, t)
    }
    // If node had shadow but is being removed, already destroyed via #destroyShadowForGroup
  }
}

function* walkContainers(root: PixiContainer): IterableIterator<PixiContainer> {
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) {
      continue
    }
    stack.push(...current.children)
    yield current
  }
}
