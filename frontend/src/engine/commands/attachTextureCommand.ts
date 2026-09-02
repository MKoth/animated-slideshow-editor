import type { Engine } from '../internal'
import type { Command } from './command'
import { requireString } from '../guards'
import {
  cloneUVTransform,
  DEFAULT_FIT_MODE,
  DEFAULT_UV_OFFSET,
  DEFAULT_UV_SCALE,
  requireFitMode,
  requireUVOffset,
  requireUVScale,
  type FitMode,
  type UVTransform,
} from '../uvTransform'

export interface AttachTextureParameters {
  readonly nodeId: string
  readonly textureId: string
  readonly uvScale?: { readonly u: number; readonly v: number }
  readonly uvOffset?: { readonly u: number; readonly v: number }
  readonly fitMode?: FitMode
}

export interface AttachTextureInverse {
  readonly nodeId: string
  readonly previousTextureId?: string
  readonly previousUVTransform?: UVTransform
}

export class AttachTextureToMeshCommand implements Command<AttachTextureInverse> {
  readonly type = 'AttachTextureToMesh'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #textureId: string
  readonly #uvTransform: UVTransform

  constructor(input: AttachTextureParameters) {
    this.#nodeId = input.nodeId
    this.#textureId = input.textureId
    const uvScale = input.uvScale
      ? requireUVScale(input.uvScale, 'uvScale')
      : { ...DEFAULT_UV_SCALE }
    const uvOffset = input.uvOffset
      ? requireUVOffset(input.uvOffset, 'uvOffset')
      : { ...DEFAULT_UV_OFFSET }
    const fitMode = input.fitMode ? requireFitMode(input.fitMode, 'fitMode') : DEFAULT_FIT_MODE
    this.#uvTransform = { uvScale, uvOffset, fitMode }
    this.parameters = {
      nodeId: input.nodeId,
      textureId: input.textureId,
      uvScale: { ...uvScale },
      uvOffset: { ...uvOffset },
      fitMode,
    }
  }

  validate(engine: Engine): void {
    requireString(this.#nodeId, 'Node id')
    requireString(this.#textureId, 'Texture assetDefinitionId')
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh && !node.components.circle) {
      throw new Error(
        `Node "${this.#nodeId}" must have a mesh or circle component to attach a texture`,
      )
    }
    // verify texture asset exists (either in library or embedded)
    try {
      engine.getAssetDefinition(this.#textureId)
    } catch {
      throw new Error(`Asset definition not found: ${this.#textureId}`)
    }
  }

  execute(engine: Engine): AttachTextureInverse {
    const node = engine.getNode(this.#nodeId)
    const previousTextureId = node.material.textureId
    const previousUVTransform = node.material.uvTransform
      ? cloneUVTransform(node.material.uvTransform)
      : undefined

    // Clone uvTransform for storage
    const uvTransform = cloneUVTransform(this.#uvTransform)

    // Apply to node material
    const newMaterial = {
      materialDefinitionId: node.material.materialDefinitionId,
      overrides: { ...node.material.overrides },
      textureId: this.#textureId,
      uvTransform,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(node as any).material = newMaterial

    engine.emitMaterialChanged(this.#nodeId)

    return {
      nodeId: this.#nodeId,
      previousTextureId,
      previousUVTransform,
    }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}

export interface DetachTextureParameters {
  readonly nodeId: string
}

export interface DetachTextureInverse {
  readonly nodeId: string
  readonly previousTextureId?: string
  readonly previousUVTransform?: UVTransform
}

export class DetachTextureCommand implements Command<DetachTextureInverse> {
  readonly type = 'DetachTexture'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string

  constructor(input: DetachTextureParameters) {
    this.#nodeId = input.nodeId
    this.parameters = { nodeId: input.nodeId }
  }

  validate(engine: Engine): void {
    requireString(this.#nodeId, 'Node id')
    const node = engine.getNode(this.#nodeId)
    if (!node.components.mesh && !node.components.circle) {
      throw new Error(`Node "${this.#nodeId}" must have a mesh or circle component`)
    }
  }

  execute(engine: Engine): DetachTextureInverse {
    const node = engine.getNode(this.#nodeId)
    const previousTextureId = node.material.textureId
    const previousUVTransform = node.material.uvTransform
      ? cloneUVTransform(node.material.uvTransform)
      : undefined
    const newMaterial: Record<string, unknown> = {
      materialDefinitionId: node.material.materialDefinitionId,
      overrides: { ...node.material.overrides },
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(node as any).material = newMaterial
    engine.emitMaterialChanged(this.#nodeId)
    return { nodeId: this.#nodeId, previousTextureId, previousUVTransform }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}

export interface SetUVTransformParameters {
  readonly nodeId: string
  readonly uvScale?: { readonly u: number; readonly v: number }
  readonly uvOffset?: { readonly u: number; readonly v: number }
  readonly fitMode?: FitMode
}

export interface SetUVTransformInverse {
  readonly nodeId: string
  readonly previousUVTransform?: UVTransform
}

export class SetUVTransformCommand implements Command<SetUVTransformInverse> {
  readonly type = 'SetUVTransform'
  readonly parameters: Readonly<Record<string, unknown>>
  readonly #nodeId: string
  readonly #uvScale?: { readonly u: number; readonly v: number }
  readonly #uvOffset?: { readonly u: number; readonly v: number }
  readonly #fitMode?: FitMode

  constructor(input: SetUVTransformParameters) {
    this.#nodeId = input.nodeId
    if (input.uvScale !== undefined) {
      this.#uvScale = requireUVScale(input.uvScale, 'uvScale')
    }
    if (input.uvOffset !== undefined) {
      this.#uvOffset = requireUVOffset(input.uvOffset, 'uvOffset')
    }
    if (input.fitMode !== undefined) {
      this.#fitMode = requireFitMode(input.fitMode, 'fitMode')
    }
    const params: Record<string, unknown> = { nodeId: input.nodeId }
    if (this.#uvScale) params.uvScale = { ...this.#uvScale }
    if (this.#uvOffset) params.uvOffset = { ...this.#uvOffset }
    if (this.#fitMode) params.fitMode = this.#fitMode
    this.parameters = params
  }

  validate(engine: Engine): void {
    requireString(this.#nodeId, 'Node id')
    const node = engine.getNode(this.#nodeId)
    if (!node.material.textureId) {
      throw new Error(`Node "${this.#nodeId}" has no texture attached; attach a texture first`)
    }
    if (!node.components.mesh && !node.components.circle) {
      throw new Error(`Node "${this.#nodeId}" must have a mesh or circle component`)
    }
    if (
      this.#uvScale === undefined &&
      this.#uvOffset === undefined &&
      this.#fitMode === undefined
    ) {
      throw new Error('SetUVTransform requires at least one of uvScale, uvOffset, fitMode')
    }
  }

  execute(engine: Engine): SetUVTransformInverse {
    const node = engine.getNode(this.#nodeId)
    const previousUVTransform = node.material.uvTransform
      ? cloneUVTransform(node.material.uvTransform)
      : undefined
    const current = node.material.uvTransform ?? {
      uvScale: { ...DEFAULT_UV_SCALE },
      uvOffset: { ...DEFAULT_UV_OFFSET },
      fitMode: DEFAULT_FIT_MODE,
    }
    const next: UVTransform = {
      uvScale: this.#uvScale ? { ...this.#uvScale } : { ...current.uvScale },
      uvOffset: this.#uvOffset ? { ...this.#uvOffset } : { ...current.uvOffset },
      fitMode: this.#fitMode ?? current.fitMode,
    }
    const newMaterial = {
      materialDefinitionId: node.material.materialDefinitionId,
      overrides: { ...node.material.overrides },
      textureId: node.material.textureId,
      uvTransform: next,
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(node as any).material = newMaterial
    engine.emitMaterialChanged(this.#nodeId)
    return { nodeId: this.#nodeId, previousUVTransform }
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return { type: this.type, ...this.parameters }
  }
}
