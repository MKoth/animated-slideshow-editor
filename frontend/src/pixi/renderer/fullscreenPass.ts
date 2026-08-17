import type { EnginePublic } from '../../engine'
import type {
  EffectiveShaderScratch,
  MaterialParameterDefault,
} from '../../engine/materialResolution'
import {
  copyShaderUniforms,
  effectiveShaderScratch,
  resolveShaderUniforms,
  shaderUniformsEqual,
} from '../../engine/materialResolution'
import type { PixiContainer, PixiFilter, PixiRenderTexture, PixiSprite, RendererPixi } from './pixi'
import type { ShaderProgramCache } from './programCache'
import { applyFilterUniforms, createNodeShaderFilter } from './nodeShader'
import { bindFilterSamplers } from './samplerBinding'
import type { ResolveAssetUrl, TextureCache } from './textureCache'

export type ResolveFullscreenShaderSource = (shaderId: string) => string | null

export type RenderSceneToTexture = (options: {
  container: PixiContainer
  target: PixiRenderTexture
}) => void

const FULLSCREEN_QUAD_LABEL = 'fullscreen-shader-quad'
const UNKNOWN_SHADER_PARAMETERS: readonly MaterialParameterDefault[] = []

/**
 * Renders a slide's scene through one fullscreen shader: the scene renders to
 * an offscreen render texture each frame, then a fullscreen quad sampling it as
 * `uTexture` composites to the canvas. A slide without a shader renders exactly
 * as before — the pass is inactive and the scene draws directly.
 */
export class FullscreenPass {
  readonly #pixi: RendererPixi
  readonly #programCache: ShaderProgramCache
  readonly #stage: PixiContainer
  readonly #scene: PixiContainer
  readonly #renderScene: RenderSceneToTexture
  readonly #resolveAssetUrl: ResolveAssetUrl
  readonly #textures: TextureCache
  readonly #scratch: EffectiveShaderScratch = effectiveShaderScratch()
  #renderOptions: { container: PixiContainer; target: PixiRenderTexture } | null = null
  #texture: PixiRenderTexture | null = null
  #quad: PixiSprite | null = null
  #filter: PixiFilter | null = null
  #lastSource: string | null = null
  #active = false

  constructor(
    pixi: RendererPixi,
    programCache: ShaderProgramCache,
    stage: PixiContainer,
    scene: PixiContainer,
    renderScene: RenderSceneToTexture,
    resolveAssetUrl: ResolveAssetUrl,
    textures: TextureCache,
  ) {
    this.#pixi = pixi
    this.#programCache = programCache
    this.#stage = stage
    this.#scene = scene
    this.#renderScene = renderScene
    this.#resolveAssetUrl = resolveAssetUrl
    this.#textures = textures
  }

  get active(): boolean {
    return this.#active
  }

  /**
   * Apply a resolved fullscreen shader state; a null source deactivates the
   * pass and restores direct rendering. No work happens when nothing changed.
   */
  update(source: string | null, scratch: EffectiveShaderScratch): void {
    const sourceChanged = this.#lastSource !== source
    if (!sourceChanged && shaderUniformsEqual(this.#scratch, scratch)) {
      return
    }
    this.#lastSource = source
    copyShaderUniforms(this.#scratch, scratch)
    if (source === null) {
      this.#deactivate()
      return
    }
    if (!this.#active) {
      this.#activate()
    }
    if (sourceChanged) {
      this.#filter?.destroy()
      this.#filter = createNodeShaderFilter(
        this.#pixi,
        this.#programCache,
        source,
        this.#scratch,
        this.#textures,
      )
      if (this.#quad) {
        this.#quad.filters = [this.#filter]
      }
    }
    if (this.#filter) {
      applyFilterUniforms(this.#filter, this.#scratch)
      bindFilterSamplers(
        this.#filter,
        this.#scratch.samplers,
        this.#resolveAssetUrl,
        this.#textures,
      )
    }
  }

  /** Render the scene into the offscreen texture; a no-op while inactive. */
  renderFrame(): void {
    const options = this.#renderOptions
    if (!options) {
      return
    }
    this.#scene.visible = true
    this.#renderScene(options)
    this.#scene.visible = false
  }

  /** Keep the texture and quad sized to the canvas. */
  resize(width: number, height: number): void {
    const texture = this.#texture
    if (!texture || width <= 0 || height <= 0) {
      return
    }
    if (texture.width !== width || texture.height !== height) {
      texture.resize(width, height)
    }
    if (this.#quad) {
      this.#quad.width = width
      this.#quad.height = height
    }
  }

  destroy(): void {
    this.#deactivate()
    this.#texture?.destroy()
    this.#texture = null
    this.#quad = null
    this.#filter = null
  }

  #activate(): void {
    if (this.#active) {
      return
    }
    this.#active = true
    this.#texture = this.#pixi.RenderTexture.create({
      width: 1,
      height: 1,
      dynamic: true,
    })
    this.#renderOptions = { container: this.#scene, target: this.#texture }
    const quad = new this.#pixi.Sprite(this.#texture)
    quad.label = FULLSCREEN_QUAD_LABEL
    this.#quad = quad
    this.#stage.addChild(quad)
    this.#scene.visible = false
  }

  #deactivate(): void {
    if (!this.#active) {
      return
    }
    this.#active = false
    this.#renderOptions = null
    this.#scene.visible = true
    this.#quad?.filters.forEach((filter) => filter.destroy())
    this.#quad?.destroy()
    this.#quad = null
    this.#filter = null
    this.#texture?.destroy()
    this.#texture = null
  }
}

/**
 * Resolve the active slide's fullscreen shader into a reusable scratch:
 * definition default uniforms resolved with slide overrides, source resolved
 * through the store-backed resolver. An unknown definition or an uncompiled
 * source resolve to no source — the effect drops while the reference stays.
 */
export function resolveFullscreenShaderState(
  engine: EnginePublic,
  resolveShaderSource: ResolveFullscreenShaderSource,
  target: EffectiveShaderScratch,
  uTimeValue?: number,
): EffectiveShaderScratch {
  resolveShaderUniforms(UNKNOWN_SHADER_PARAMETERS, {}, target, uTimeValue)
  target.source = null
  const slide = engine.getActiveSlide()
  const reference = slide?.fullscreenShader ?? null
  if (!reference) {
    return target
  }
  let parameters = UNKNOWN_SHADER_PARAMETERS
  try {
    parameters = engine.getShaderDefinition(reference.shaderDefinitionId).parameters
  } catch {
    parameters = UNKNOWN_SHADER_PARAMETERS
  }
  resolveShaderUniforms(parameters, reference.overrides, target, uTimeValue)
  target.source = resolveShaderSource(reference.shaderDefinitionId)
  return target
}
