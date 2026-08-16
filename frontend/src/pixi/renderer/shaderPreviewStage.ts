import type { EffectiveShaderScratch } from '../../engine/materialResolution'
import type { MaterialParameterDefaultValue } from '../../engine/materialResolution'
import { effectiveShaderScratch } from '../../engine/materialResolution'
import type {
  PixiApplication,
  PixiContainer,
  PixiFilter,
  PixiSprite,
  PixiTexture,
  RendererPixi,
} from './pixi'
import { applyFilterUniforms, createNodeShaderFilter } from './nodeShader'
import { ShaderProgramCache } from './programCache'
import { bindFilterSamplers } from './samplerBinding'
import type { ResolveAssetUrl } from './textureCache'
import { TextureCache } from './textureCache'

export const SHADER_PREVIEW_TEXTURE_SIZE = 64
export const SHADER_PREVIEW_LAYER_LABEL = 'shader-preview-layer'
export const SHADER_PREVIEW_TEXTURE_FORMAT = 'bgra8unorm'

export interface ShaderPreviewUniform {
  key: string
  type: string
  value: unknown
}

export interface ShaderPreviewSource {
  source: string
  uniforms: readonly ShaderPreviewUniform[]
}

interface PreviewCell {
  readonly source: string
  readonly uniforms: readonly ShaderPreviewUniform[]
  readonly sprite: PixiSprite
  readonly filter: PixiFilter
}

/**
 * The shared live mini-render host for the Shaders section: one pixi app whose
 * transparent canvas overlays the shader grid, with one quad per definition —
 * each sampling the built-in sample texture through its compiled shader program
 * (cached by source) — positioned over its grid slot. The app's ticker drives
 * continuous re-rendering, so previews stay live. Resolved sampler uniforms
 * bind through the shared texture cache (placeholder → loaded asset); failed
 * or absent sources remove the quad; an app that fails to initialize degrades
 * to no previews.
 */
export class ShaderPreviewStage {
  readonly #pixi: RendererPixi
  readonly #programCache: ShaderProgramCache
  readonly #resolveAssetUrl: ResolveAssetUrl
  readonly #textures: TextureCache
  readonly #scratch: EffectiveShaderScratch = effectiveShaderScratch()
  readonly #cells = new Map<string, PreviewCell>()
  readonly #slots = new Map<string, HTMLElement>()
  #app: PixiApplication | null = null
  #layer: PixiContainer | null = null
  #sampleTexture: PixiTexture | null = null
  #host: HTMLElement | null = null
  #resizeObserver: ResizeObserver | null = null
  #started = false
  #disposed = false

  constructor(
    pixi: RendererPixi,
    programCache: ShaderProgramCache = new ShaderProgramCache(pixi),
    resolveAssetUrl: ResolveAssetUrl = () => null,
  ) {
    this.#pixi = pixi
    this.#programCache = programCache
    this.#resolveAssetUrl = resolveAssetUrl
    this.#textures = new TextureCache(pixi)
  }

  get ready(): boolean {
    return this.#app !== null
  }

  async start(host: HTMLElement): Promise<void> {
    if (this.#started) {
      return
    }
    this.#started = true
    this.#host = host
    let app: PixiApplication | null = null
    try {
      app = new this.#pixi.Application()
      await app.init({
        background: '#000000',
        backgroundAlpha: 0,
        resizeTo: host,
        antialias: true,
      })
      if (this.#disposed) {
        app.destroy()
        return
      }
      this.#app = app
      app.canvas.classList.add('shader-preview-stage__canvas')
      host.appendChild(app.canvas)
      const layer = new this.#pixi.Container()
      layer.label = SHADER_PREVIEW_LAYER_LABEL
      app.stage.addChild(layer)
      this.#layer = layer
      this.#sampleTexture = this.#pixi.Texture.from({
        resource: createSampleTextureData(),
        width: SHADER_PREVIEW_TEXTURE_SIZE,
        height: SHADER_PREVIEW_TEXTURE_SIZE,
        format: SHADER_PREVIEW_TEXTURE_FORMAT,
      })
      const observer = new ResizeObserver(() => {
        this.#resize()
        this.sync()
      })
      observer.observe(host)
      this.#resizeObserver = observer
      host.addEventListener('scroll', this.#handleScroll, true)
      this.sync()
    } catch (error) {
      app?.destroy()
      this.#app = null
      console.error('[shader-preview] failed to start the preview stage:', error)
    }
  }

  setSlot(id: string, element: HTMLElement | null): void {
    if (element === null) {
      this.#slots.delete(id)
      return
    }
    this.#slots.set(id, element)
    this.#syncCell(id)
  }

  setCell(id: string, preview: ShaderPreviewSource | null): void {
    const existing = this.#cells.get(id)
    if (!preview) {
      if (existing) {
        this.#disposeCell(existing)
        this.#cells.delete(id)
      }
      return
    }
    if (existing && existing.source === preview.source) {
      this.#applyUniforms(existing.filter, preview.uniforms)
      this.#bindSamplers(existing.filter, preview.uniforms)
      this.#syncCell(id)
      return
    }
    if (existing) {
      this.#disposeCell(existing)
      this.#cells.delete(id)
    }
    const app = this.#app
    const layer = this.#layer
    const sampleTexture = this.#sampleTexture
    if (!app || !layer || !sampleTexture) {
      return
    }
    this.#fillScratch(preview.uniforms)
    const filter = createNodeShaderFilter(
      this.#pixi,
      this.#programCache,
      preview.source,
      this.#scratch,
      this.#textures,
    )
    this.#bindSamplers(filter, preview.uniforms)
    applyFilterUniforms(filter, this.#scratch)
    const sprite = new this.#pixi.Sprite(sampleTexture)
    sprite.label = `shader-preview:${id}`
    sprite.filters = [filter]
    layer.addChild(sprite)
    this.#cells.set(id, { source: preview.source, uniforms: preview.uniforms, sprite, filter })
    this.#syncCell(id)
  }

  /**
   * Re-bind every cell's sampler uniforms against the current asset-url
   * resolution (a library load or import may have made assets resolvable that
   * were not at bind time). Cheap: existing textures are reused.
   */
  rebindSamplers(): void {
    for (const cell of this.#cells.values()) {
      this.#bindSamplers(cell.filter, cell.uniforms)
    }
  }

  /** Reposition every quad over its grid slot; call after layout changes. */
  sync(): void {
    const host = this.#host
    if (!host) {
      return
    }
    const hostRect = host.getBoundingClientRect()
    for (const id of this.#cells.keys()) {
      this.#syncCellRect(id, hostRect)
    }
  }

  destroy(): void {
    this.#disposed = true
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#host?.removeEventListener('scroll', this.#handleScroll, true)
    this.#host = null
    for (const cell of this.#cells.values()) {
      this.#disposeCell(cell)
    }
    this.#cells.clear()
    this.#slots.clear()
    this.#sampleTexture?.destroy()
    this.#sampleTexture = null
    this.#textures.dispose()
    this.#layer = null
    const app = this.#app
    this.#app = null
    if (app) {
      app.canvas.remove()
      app.destroy()
    }
  }

  /** Keep the renderer canvas sized to the host (parity with the main renderer). */
  #resize(): void {
    const app = this.#app
    const host = this.#host
    if (!app || !host) {
      return
    }
    app.renderer.resize(host.clientWidth, host.clientHeight)
  }

  readonly #handleScroll = (): void => {
    this.sync()
  }

  #disposeCell(cell: PreviewCell): void {
    cell.filter.destroy()
    cell.sprite.destroy()
  }

  #fillScratch(uniforms: readonly ShaderPreviewUniform[]): void {
    this.#scratch.keys.length = 0
    this.#scratch.kinds.length = 0
    this.#scratch.values.length = 0
    this.#scratch.samplers.length = 0
    for (const uniform of uniforms) {
      if (uniform.type === 'sampler2D') {
        this.#scratch.samplers.push({
          key: uniform.key,
          assetDefinitionId:
            typeof uniform.value === 'string' && uniform.value !== '' ? uniform.value : null,
        })
        continue
      }
      this.#scratch.keys.push(uniform.key)
      this.#scratch.kinds.push(uniform.type)
      this.#scratch.values.push(uniform.value as MaterialParameterDefaultValue)
    }
  }

  #bindSamplers(filter: PixiFilter, uniforms: readonly ShaderPreviewUniform[]): void {
    this.#fillScratch(uniforms)
    bindFilterSamplers(filter, this.#scratch.samplers, this.#resolveAssetUrl, this.#textures)
  }

  #applyUniforms(filter: PixiFilter, uniforms: readonly ShaderPreviewUniform[]): void {
    this.#fillScratch(uniforms)
    applyFilterUniforms(filter, this.#scratch)
  }

  #syncCell(id: string): void {
    const host = this.#host
    if (!host) {
      return
    }
    this.#syncCellRect(id, host.getBoundingClientRect())
  }

  #syncCellRect(id: string, hostRect: DOMRect): void {
    const cell = this.#cells.get(id)
    const slot = this.#slots.get(id)
    if (!cell || !slot) {
      return
    }
    const rect = slot.getBoundingClientRect()
    cell.sprite.position.set(rect.left - hostRect.left, rect.top - hostRect.top)
    cell.sprite.width = Math.max(rect.width, 0)
    cell.sprite.height = Math.max(rect.height, 0)
  }
}

/**
 * The built-in sample texture every mini-render samples as `uTexture`: a
 * three-stop diagonal gradient (warm red → yellow → blue), opaque, stored as
 * bgra8unorm bytes so it needs no external asset.
 */
export function createSampleTextureData(size = SHADER_PREVIEW_TEXTURE_SIZE): Uint8Array {
  const stops = [
    { at: 0, rgb: [251, 107, 92] },
    { at: 0.5, rgb: [251, 210, 92] },
    { at: 1, rgb: [92, 141, 251] },
  ] as const
  const data = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (2 * (size - 1))
      const stopIndex = t < stops[1].at ? 0 : 1
      const from = stops[stopIndex]
      const to = stops[stopIndex + 1]
      const local = (t - from.at) / (to.at - from.at)
      const [red, green, blue] = [
        Math.round(from.rgb[0] + (to.rgb[0] - from.rgb[0]) * local),
        Math.round(from.rgb[1] + (to.rgb[1] - from.rgb[1]) * local),
        Math.round(from.rgb[2] + (to.rgb[2] - from.rgb[2]) * local),
      ]
      const offset = (y * size + x) * 4
      data[offset] = blue
      data[offset + 1] = green
      data[offset + 2] = red
      data[offset + 3] = 255
    }
  }
  return data
}
