import type { EnginePublic, Unsubscribe } from '../../engine'
import type { Scene } from '../../engine'
import type { SceneNode } from '../../engine'
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
import type { PixiContainer, PixiFilter, RendererPixi } from './pixi'
import type { WorldSize } from './worldGeometry'
import {
  applyEvaluatedState,
  applyMaterialTint,
  applyName,
  createNodeContainer,
  placeholderOf,
} from './nodeRenderer'
import { applyAssetTexture, applyMissingPlaceholder, placeholderSize } from './placeholder'
import { createNodeShaderFilter, applyFilterUniforms } from './nodeShader'
import { bindFilterSamplers } from './samplerBinding'
import type { ShaderProgramCache } from './programCache'
import type { ResolveAssetUrl, TextureCache } from './textureCache'

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
    this.#scene = scene
    this.#slideId = slideId
    if (!scene) {
      return
    }
    for (const node of walkPreOrder(scene.root)) {
      this.#addNode(node)
    }
  }

  handleNodeCreated(nodeId: string): void {
    if (!this.#scene || !this.#scene.getNode(nodeId)) {
      return
    }
    if (this.#containers.has(nodeId)) {
      return
    }
    this.#addNode(this.#engine.getNode(nodeId))
  }

  handleNodeRemoved(nodeId: string): void {
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    for (const descendant of walkContainers(container)) {
      const descendantId = this.#nodeIds.get(descendant)
      if (descendantId) {
        this.#containers.delete(descendantId)
        this.#sizes.delete(descendantId)
        this.#lastEvaluated.delete(descendantId)
        this.#lastMaterials.delete(descendantId)
        this.#nodeShaders.delete(descendantId)
        this.#missingNodes.delete(descendantId)
      }
      this.#nodeIds.delete(descendant)
    }
    container.destroy({ children: true })
  }

  handleTransformChanged(nodeId: string): void {
    this.#evaluateAndApply(nodeId)
  }

  handleKeyframeChanged(nodeId: string): void {
    this.#evaluateAndApply(nodeId)
  }

  handleTimeChanged(): void {
    const scene = this.#scene
    if (!scene) {
      return
    }
    for (const node of walkPreOrder(scene.root)) {
      this.#evaluateAndApply(node.id)
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

  handleMaterialChanged(nodeId: string): void {
    this.#evaluateAndApply(nodeId)
  }

  previewTransform(nodeId: string, x: number, y: number): void {
    const container = this.#containers.get(nodeId)
    if (!container) {
      return
    }
    container.position.set(x, y)
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
    this.#evaluateAndApply(node.id)
    const instance = node.components.assetInstance
    if (instance) {
      this.#loadAssetTexture(instance.assetDefinitionId, node.id, container)
    }
  }

  #evaluateAndApply(nodeId: string): void {
    const scene = this.#scene
    const slideId = this.#slideId
    const container = this.#containers.get(nodeId)
    if (!scene || !slideId || !scene.getNode(nodeId) || !container) {
      return
    }
    const time = this.#currentTime.getTime(slideId)
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
    const placeholder = placeholderOf(container)
    const size = placeholder ? placeholderSize(placeholder) : null
    if (size) {
      this.#sizes.set(node.id, size)
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
    const parentContainer = node.parent ? this.#containers.get(node.parent.id) : undefined
    ;(parentContainer ?? this.#world).addChild(container)
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
