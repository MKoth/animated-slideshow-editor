import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resizeObserverFor } from '../setup'
import { realPixi } from '../../pixi/renderer/pixi'
import {
  SHADER_PREVIEW_TEXTURE_SIZE,
  ShaderPreviewStage,
  createSampleTextureData,
} from '../../pixi/renderer/shaderPreviewStage'
import type { FakeApplication, FakeContainer, FakeFilter, FakeSprite } from './pixiFake'
import {
  fakeGlPrograms,
  pixiRegistry,
  resetShaderRegistries,
  resetTextureRegistries,
  textureLoads,
} from './pixiFake'
import { FakeTexture } from './pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

const GRAYSCALE_SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform float uIntensity;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  fragColor = color * uIntensity;
}
`

const SEPIA_SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  fragColor = vec4(1.0, 0.8, 0.5, 1.0) * color;
}
`

const MASK_SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform sampler2D uMask;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  fragColor = color * texture(uMask, vUv);
}
`

const STAGE_LAYER_LABEL = 'shader-preview-layer'

interface Mounted {
  stage: ShaderPreviewStage
  host: HTMLElement
  app: FakeApplication
  layer: FakeContainer
}

async function mount(): Promise<Mounted> {
  const stage = new ShaderPreviewStage(realPixi)
  const host = document.createElement('div')
  document.body.appendChild(host)
  await stage.start(host)
  const app = pixiRegistry.applications.at(-1)
  if (!app) {
    throw new Error('expected the preview stage to create a pixi application')
  }
  const layer = app.stage.children.find((child) => child.label === STAGE_LAYER_LABEL)
  if (!layer) {
    throw new Error('expected the preview stage to create a preview layer')
  }
  return { stage, host, app, layer }
}

async function mountWithResolver(
  resolveAssetUrl: (definitionId: string) => string | null,
): Promise<Mounted> {
  const stage = new ShaderPreviewStage(realPixi, undefined, resolveAssetUrl)
  const host = document.createElement('div')
  document.body.appendChild(host)
  await stage.start(host)
  const app = pixiRegistry.applications.at(-1)
  if (!app) {
    throw new Error('expected the preview stage to create a pixi application')
  }
  const layer = app.stage.children.find((child) => child.label === STAGE_LAYER_LABEL)
  if (!layer) {
    throw new Error('expected the preview stage to create a preview layer')
  }
  return { stage, host, app, layer }
}

function previewSprite(layer: FakeContainer, id: string): FakeSprite | undefined {
  return layer.children.find((child) => child.label === `shader-preview:${id}`) as
    FakeSprite | undefined
}

function spriteFilter(sprite: FakeContainer | undefined): FakeFilter | undefined {
  return sprite?.filters[0] as FakeFilter | undefined
}

function stubRect(element: HTMLElement, rect: Partial<DOMRect>): void {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect as DOMRect)
}

beforeEach(() => {
  pixiRegistry.reset()
  resetShaderRegistries()
  resetTextureRegistries()
})

afterEach(() => {
  document.body.replaceChildren()
})

describe('createSampleTextureData', () => {
  it('produces an opaque RGBA gradient sized to the preview texture', () => {
    const data = createSampleTextureData()

    expect(data).toBeInstanceOf(Uint8Array)
    expect(data.length).toBe(SHADER_PREVIEW_TEXTURE_SIZE * SHADER_PREVIEW_TEXTURE_SIZE * 4)
    for (let index = 3; index < data.length; index += 4) {
      expect(data[index]).toBe(255)
    }
  })

  it('renders the first gradient stop at the top-left corner', () => {
    const data = createSampleTextureData()

    // BGRA bytes of the warm red stop.
    expect(data[0]).toBe(92)
    expect(data[1]).toBe(107)
    expect(data[2]).toBe(251)
  })

  it('renders the last gradient stop at the bottom-right corner', () => {
    const data = createSampleTextureData()
    const offset = (SHADER_PREVIEW_TEXTURE_SIZE * SHADER_PREVIEW_TEXTURE_SIZE - 1) * 4

    // BGRA bytes of the blue stop.
    expect(data[offset]).toBe(251)
    expect(data[offset + 1]).toBe(141)
    expect(data[offset + 2]).toBe(92)
  })
})

describe('ShaderPreviewStage', () => {
  it('starts an app over the host with a preview layer and transparent background', async () => {
    const { app, host, layer } = await mount()

    expect(app.canvas.parentElement).toBe(host)
    expect(app.initOptions.backgroundAlpha).toBe(0)
    expect(layer.label).toBe(STAGE_LAYER_LABEL)
    expect(layer.parent).toBe(app.stage)
  })

  it('creates a quad with the compiled program and definition defaults for a registered cell', async () => {
    const { stage, layer } = await mount()

    stage.setSlot('s1', document.createElement('div'))
    stage.setCell('s1', {
      source: GRAYSCALE_SOURCE,
      uniforms: [
        { key: 'uIntensity', type: 'float', value: 0.5 },
        { key: 'uTint', type: 'vec3', value: [1, 0, 0] },
      ],
    })

    const sprite = previewSprite(layer, 's1')
    expect(sprite).toBeDefined()
    const filter = spriteFilter(sprite)
    expect(filter?.glProgram.fragment).toBe(GRAYSCALE_SOURCE)
    const uniforms = (filter?.resources.uniforms as { uniforms: Record<string, unknown> }).uniforms
    expect(uniforms.uIntensity).toBe(0.5)
    expect(uniforms.uTint).toEqual([1, 0, 0])
  })

  it('positions the quad over its registered slot', async () => {
    const { stage, layer, host } = await mount()
    stubRect(host, { left: 0, top: 0 })
    const slot = document.createElement('div')
    stubRect(slot, { left: 12, top: 18, width: 120, height: 90 })
    document.body.appendChild(slot)

    stage.setSlot('s1', slot)
    stage.setCell('s1', { source: GRAYSCALE_SOURCE, uniforms: [] })

    const sprite = previewSprite(layer, 's1')
    expect(sprite?.position.x).toBe(12)
    expect(sprite?.position.y).toBe(18)
    expect(sprite?.width).toBe(120)
    expect(sprite?.height).toBe(90)
  })

  it('removes the quad when the cell source becomes null', async () => {
    const { stage, layer } = await mount()
    stage.setCell('s1', { source: GRAYSCALE_SOURCE, uniforms: [] })
    const sprite = previewSprite(layer, 's1')
    expect(sprite).toBeDefined()

    stage.setCell('s1', null)

    expect(previewSprite(layer, 's1')).toBeUndefined()
    expect(sprite?.destroyed).toBe(true)
    expect(spriteFilter(sprite)?.destroyed).toBe(true)
  })

  it('removes the quad when the cell is unregistered', async () => {
    const { stage, layer } = await mount()
    stage.setCell('s1', { source: GRAYSCALE_SOURCE, uniforms: [] })
    const sprite = previewSprite(layer, 's1')

    stage.setCell('s1', null)
    stage.setSlot('s1', null)

    expect(sprite?.destroyed).toBe(true)
  })

  it('compiles each source once through the shared program cache and reuses it', async () => {
    const { stage, layer } = await mount()
    stage.setCell('s1', { source: GRAYSCALE_SOURCE, uniforms: [] })
    const programsBefore = fakeGlPrograms.calls.length

    stage.setCell('s1', { source: GRAYSCALE_SOURCE, uniforms: [] })
    stage.setCell('s1', {
      source: GRAYSCALE_SOURCE,
      uniforms: [{ key: 'uIntensity', type: 'float', value: 0.9 }],
    })

    expect(fakeGlPrograms.calls.length).toBe(programsBefore)
    const filter = spriteFilter(previewSprite(layer, 's1'))
    expect(
      (filter?.resources.uniforms as { uniforms: Record<string, unknown> }).uniforms.uIntensity,
    ).toBe(0.9)
  })

  it('replaces the filter when the source changes', async () => {
    const { stage, layer } = await mount()
    stage.setCell('s1', { source: GRAYSCALE_SOURCE, uniforms: [] })
    const firstFilter = spriteFilter(previewSprite(layer, 's1'))

    stage.setCell('s1', { source: SEPIA_SOURCE, uniforms: [] })

    const sprite = previewSprite(layer, 's1')
    expect(sprite).toBeDefined()
    expect(spriteFilter(sprite)?.glProgram.fragment).toBe(SEPIA_SOURCE)
    expect(spriteFilter(sprite)).not.toBe(firstFilter)
    expect(firstFilter?.destroyed).toBe(true)
    expect(fakeGlPrograms.calls.at(-1)?.fragment).toBe(SEPIA_SOURCE)
  })

  it('repositions quads on demand', async () => {
    const { stage, layer, host } = await mount()
    stubRect(host, { left: 0, top: 0 })
    const slot = document.createElement('div')
    document.body.appendChild(slot)
    stubRect(slot, { left: 12, top: 18, width: 120, height: 90 })
    stage.setSlot('s1', slot)
    stage.setCell('s1', { source: GRAYSCALE_SOURCE, uniforms: [] })

    stubRect(slot, { left: 40, top: 50, width: 100, height: 80 })
    stage.sync()

    const sprite = previewSprite(layer, 's1')
    expect(sprite?.position.x).toBe(40)
    expect(sprite?.position.y).toBe(50)
    expect(sprite?.width).toBe(100)
    expect(sprite?.height).toBe(80)
  })

  it('resizes the renderer canvas with the host', async () => {
    const { host, app } = await mount()
    const resizeSpy = vi.spyOn(app.renderer, 'resize')
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 200 })
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 120 })

    const observer = resizeObserverFor(host)
    expect(observer).toBeDefined()
    observer?.trigger()

    expect(resizeSpy).toHaveBeenCalledWith(200, 120)
  })

  it('degrades gracefully when the app fails to initialize', async () => {
    pixiRegistry.failNextInit = true
    const stage = new ShaderPreviewStage(realPixi)
    const host = document.createElement('div')

    await expect(stage.start(host)).resolves.toBeUndefined()
    expect(stage.ready).toBe(false)

    expect(() => {
      stage.setCell('s1', { source: GRAYSCALE_SOURCE, uniforms: [] })
    }).not.toThrow()
  })

  it('disposes the app, cells and sample texture on destroy', async () => {
    const { stage, app, layer } = await mount()
    stage.setCell('s1', { source: GRAYSCALE_SOURCE, uniforms: [] })
    const sprite = previewSprite(layer, 's1')

    stage.destroy()

    expect(app.destroyed).toBe(true)
    expect(app.canvas.parentElement).toBeNull()
    expect(sprite?.destroyed).toBe(true)
    expect(sprite?.texture.destroyed).toBe(true)
    expect(stage.ready).toBe(false)
  })
})

describe('ShaderPreviewStage sampler uniforms', () => {
  function maskResource(filter: FakeFilter | undefined): unknown {
    return (filter?.resources as Record<string, unknown>).uMask
  }

  it('binds a sampler uniform as a texture resource, placeholder while unresolvable', async () => {
    const { stage, layer } = await mount()

    stage.setCell('s1', {
      source: MASK_SOURCE,
      uniforms: [{ key: 'uMask', type: 'sampler2D', value: '' }],
    })

    const resource = maskResource(spriteFilter(previewSprite(layer, 's1')))
    expect(resource).toBeDefined()
    expect(resource).toHaveProperty('url', undefined)
    expect(spriteFilter(previewSprite(layer, 's1'))?.resources.uMask).toBeDefined()
  })

  it('binds a sampler default pointing at an asset to its resolved texture once loaded', async () => {
    const realTexture = new FakeTexture('/assets/mask.png')
    textureLoads.set('/assets/mask.png', realTexture)
    const { stage, layer } = await mountWithResolver((definitionId) =>
      definitionId === 'asset-mask' ? '/assets/mask.png' : null,
    )

    stage.setCell('s1', {
      source: MASK_SOURCE,
      uniforms: [{ key: 'uMask', type: 'sampler2D', value: 'asset-mask' }],
    })

    const filter = spriteFilter(previewSprite(layer, 's1'))
    await vi.waitFor(() => expect(maskResource(filter)).toBe(realTexture))
  })

  it('keeps the per-key placeholder for a sampler with no resolvable asset', async () => {
    const { stage, layer } = await mountWithResolver(() => null)

    stage.setCell('s1', {
      source: MASK_SOURCE,
      uniforms: [{ key: 'uMask', type: 'sampler2D', value: 'asset-mask' }],
    })

    const filter = spriteFilter(previewSprite(layer, 's1'))
    const resource = maskResource(filter) as FakeTexture
    expect(resource).toBeDefined()
    expect(resource.url).toBeUndefined()
  })

  it('rebinds samplers on rebindSamplers when the asset url resolution changes', async () => {
    const realTexture = new FakeTexture('/assets/mask.png')
    textureLoads.set('/assets/mask.png', realTexture)
    let urlFor: (definitionId: string) => string | null = () => null
    const { stage, layer } = await mountWithResolver((definitionId) => urlFor(definitionId))

    stage.setCell('s1', {
      source: MASK_SOURCE,
      uniforms: [{ key: 'uMask', type: 'sampler2D', value: 'asset-mask' }],
    })

    const filter = spriteFilter(previewSprite(layer, 's1'))
    expect((maskResource(filter) as FakeTexture).url).toBeUndefined()

    urlFor = (definitionId) => (definitionId === 'asset-mask' ? '/assets/mask.png' : null)
    stage.rebindSamplers()

    await vi.waitFor(() => expect(maskResource(filter)).toBe(realTexture))
  })
})
