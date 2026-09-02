import type { EnginePublic, Unsubscribe } from '../../engine'
import type { Scene } from '../../engine'
import type { SceneNode } from '../../engine'
import type { ChartComponent } from '../../engine/components'
import { walkPreOrder } from '../../engine/sceneNode'
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
import { relativeTransform } from '../../engine/worldTransform'
import {
  applyConstraints,
  type ConstraintEvaluationContext,
} from '../../engine/constraintEvaluator'
import type { PixiContainer, PixiFilter, PixiSprite, RendererPixi } from './pixi'
import type { WorldSize } from './worldGeometry'
import {
  applyCircleData,
  applyEvaluatedState,
  applyMaterialTint,
  applyMeshData,
  applyMeshVertices,
  applyName,
  applyPivotWithSize,
  applyTableNodeOrdering,
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

export interface CurrentTimeSource {
  getTime(slideId: string): number
  subscribe(listener: () => void): Unsubscribe
}

export const ALWAYS_ZERO_TIME: CurrentTimeSource = {
  getTime: () => 0,
  subscribe: () => () => undefined,
}

const UNKNOWN_DEFINITION_PARAMETERS: readonly MaterialParameterDefault[] = []

interface NodeShaderState {
  filter: PixiFilter | null
  scratch: EffectiveShaderScratch
}

export type ResolveShaderSource = (shaderId: string) => string | null

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
  readonly #resolveDataSource: ResolveDataSource
  readonly #scratch: EvaluatedNodeScratch = evaluatedNodeScratch()
  readonly #materialScratch: EffectiveMaterialScratch = effectiveMaterialScratch()
  readonly #shaderScratch: EffectiveShaderScratch = effectiveShaderScratch()
  readonly #materialOverridesScratch: EvaluatedMaterialOverridesScratch =
    evaluatedMaterialOverridesScratch()
  readonly #onNodeSizeChanged: (nodeId: string) => void
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
    this.#scene = scene
    this.#slideId = slideId
    if (!scene) {
      return
    }
    for (const node of walkPreOrder(scene.root)) {
      this.#addNode(node)
    }
    this.refreshDeformedMeshSizes()
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
  }

  handleNodeRemoved(nodeId: string): void {
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    const tableId = this.#tableAncestorId(container)
    for (const descendant of walkContainers(container)) {
      const descendantId = this.#nodeIds.get(descendant)
      if (descendantId) {
        this.#containers.delete(descendantId)
        this.#sizes.delete(descendantId)
        this.#lastEvaluated.delete(descendantId)
        this.#lastMaterials.delete(descendantId)
        this.#nodeShaders.delete(descendantId)
        this.#missingNodes.delete(descendantId)
        this.#circleHashes.delete(descendantId)
      }
      this.#nodeIds.delete(descendant)
    }
    container.destroy({ children: true })
    if (tableId) {
      this.handleTableChanged(tableId)
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
  }

  handleKeyframeChanged(nodeId: string): void {
    this.#evaluateAndApply(nodeId)
    this.refreshDeformedMeshSizes()
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
      const mesh = node.components.mesh?.mesh
      if (mesh) {
        const meshTransform = this.#engineWorldTransform(node.id, time)
        if (!meshTransform) continue
        const vertices = evaluateMeshDeformation(mesh, bones, meshTransform).deformedVertices
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
      const evaluatedMesh = state
        ? generateCircleMeshData(circle, state.startAngle, state.endAngle)
        : generateCircleMeshData(circle)
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
      applyMeshData(this.#pixi, container, mesh)
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
    applyCircleData(this.#pixi, container, circle, start, end)
    const w = circle.radius * 2
    const h = circle.radius * 2
    this.#sizes.set(nodeId, { width: w, height: h, offsetX: 0, offsetY: 0 })
    this.refreshDeformedMeshSizes()
    this.#onNodeSizeChanged(nodeId)
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
    if (!tableNode) return
    if (!node.components.table) {
      this.#refreshTableChildren(tableNode)
      return
    }
    const table = tableNode
    const container = this.#containers.get(table.id)
    if (!container) {
      return
    }
    const placeholder = placeholderOf(container)
    if (!placeholder) {
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
  }

  handleChartChanged(nodeId: string): void {
    const chartAndSprite = this.#getChartAndSprite(nodeId)
    if (!chartAndSprite) {
      return
    }
    const { chart, sprite } = chartAndSprite
    const data = this.#resolveDataSource(chart.dataSourceId) ?? []
    const width = CHART_DEFAULT_WIDTH
    const height = CHART_DEFAULT_HEIGHT
    void rebuildChartTexture(this.#pixi, sprite, chart, data, width, height).then(() => {
      this.#sizes.set(nodeId, { width, height })
      this.#onNodeSizeChanged(nodeId)
    })
  }

  handleTextChanged(nodeId: string): void {
    const scene = this.#scene
    if (!scene) {
      return
    }
    const node = scene.getNode(nodeId)
    if (!node || !node.components.text) {
      return
    }
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    const placeholder = placeholderOf(container)
    if (!placeholder) {
      return
    }
    rebuildText(this.#pixi, placeholder, node.components.text)
    const size = textSizeOf(placeholder)
    if (size) {
      this.#sizes.set(nodeId, this.#tableTextSize(node, size))
      this.#onNodeSizeChanged(nodeId)
    }
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
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    container.visible = this.#engine.getNode(nodeId).visible
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
  }

  setBonesVisible(visible: boolean): void {
    for (const [nodeId, container] of this.#containers) {
      const node = this.#scene?.getNode(nodeId)
      if (!node || !node.components.bone) continue
      // Respect node.visible when showing; hide when flag false
      container.visible = visible ? node.visible : false
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
    const instance = node.components.assetInstance
    if (instance) {
      this.#loadAssetTexture(instance.assetDefinitionId, node.id, container)
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
      const circle = node.components.circle
      const circleState = this.#engine.evaluateCircle(nodeId, time)
      if (circleState) {
        const circleHash = `${circleState.startAngle}:${circleState.endAngle}:${circleState.radius}:${circleState.segments}`
        const prevHash = this.#circleHashes.get(nodeId)
        if (prevHash !== circleHash) {
          this.#circleHashes.set(nodeId, circleHash)
          applyCircleData(
            this.#pixi,
            container,
            circle,
            circleState.startAngle,
            circleState.endAngle,
          )
          const w = circleState.radius * 2
          const h = circleState.radius * 2
          this.#sizes.set(nodeId, { width: w, height: h, offsetX: 0, offsetY: 0 })
          this.#onNodeSizeChanged(nodeId)
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
    if (!stateChanged && !materialChanged && !shaderChanged) {
      return
    }
    applyEvaluatedState(container, state, material.opacityMultiplier)
    // Update size-scaled pivot (needs current size, which may have changed)
    const currentSize = this.#sizes.get(nodeId)
    if (currentSize) {
      applyPivotWithSize(container, state.transform.localPivot, currentSize)
    }
    this.#positionTableText(node, container)
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

    let x = 0
    let y = 0
    let rotation = 0
    let scaleX = 1
    let scaleY = 1
    for (const link of chain) {
      const local = this.#engine.evaluateNode(link.id, time, this.#scratch).transform
      const ikRot = this.#ikOverrides.get(link.id)
      const r = ikRot !== undefined ? ikRot : local.rotation
      const cosR = Math.cos(rotation)
      const sinR = Math.sin(rotation)
      x += local.x * cosR - local.y * sinR
      y += local.x * sinR + local.y * cosR
      rotation += r
      scaleX *= local.scaleX
      scaleY *= local.scaleY
    }
    return { x, y, rotation, scaleX, scaleY }
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
    if (node.components.tableRow || node.components.tableCell) {
      const size = tableChildSizeOf(container)
      if (size) this.#sizes.set(node.id, size)
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
      if (!result.real || container.destroyed) {
        return
      }
      applyAssetTexture(placeholder, result.texture)
      const node = this.#scene?.getNode(nodeId)
      const material = this.#resolveMaterial(
        nodeId,
        node?.material.overrides ?? {},
        this.#materialScratch,
      )
      applyMaterialTint(container, material.tint)
      const size = placeholderSize(placeholder)
      if (size) {
        this.#sizes.set(nodeId, size)
        const n = this.#scene?.getNode(nodeId)
        if (n) applyPivotWithSize(container, n.transform.localPivot, size)
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
      const instance = node.components.assetInstance
      if (!instance) {
        continue
      }
      const container = this.#containers.get(node.id)
      if (!container) {
        continue
      }
      this.#loadAssetTexture(instance.assetDefinitionId, node.id, container)
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

  #positionTableText(node: SceneNode, container: PixiContainer): void {
    if (!node.components.text || !node.parent?.components.tableCell) return
    const textGroup = placeholderOf(container)
    const size = textGroup ? textSizeOf(textGroup) : undefined
    if (!size) return
    const padding = node.parent.components.tableCell.padding ?? 8
    container.position.set(padding + size.width / 2, padding + size.height / 2)
  }

  #tableTextSize(node: SceneNode, size: WorldSize): WorldSize {
    if (!node.parent?.components.tableCell) return size
    const padding = node.parent.components.tableCell.padding ?? 8
    return {
      ...size,
      offsetX: padding + size.width / 2,
      offsetY: padding + size.height / 2,
    }
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
