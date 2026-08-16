import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  CommandDispatcher,
  CreateProjectCommand,
  CreateSlideCommand,
  OverrideFullscreenUniformCommand,
  SetFullscreenShaderCommand,
  UndoStack,
} from '../../engine/commands'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import type { PixiFilter } from '../../pixi/renderer/pixi'
import { nodeFilterUniforms } from '../../pixi/renderer/nodeShader'
import { Renderer } from '../../pixi/renderer/renderer'
import { FakeTimeSource } from '../fakeTimeSource'
import { fakeGlPrograms, pixiRegistry, resetShaderRegistries, textureLoads } from './pixiFake'
import { FakeTexture } from './pixiFake'
import type { FakeApplication, FakeContainer, FakeFilter, FakeSprite } from './pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

const GRAYSCALE_SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  fragColor = vec4(vec3(luma), color.a);
}
`

interface Mounted {
  engine: Engine
  dispatcher: CommandDispatcher
  renderer: Renderer
  app: FakeApplication
  sources: Map<string, string | null>
  world: FakeContainer
}

async function mount(): Promise<Mounted> {
  const engine = createEngine()
  engine.registerShaderDefinition('shader-gray', 'Grayscale', [
    { key: 'uIntensity', kind: 'float', default: 0.5 },
    { key: 'uColor', kind: 'vec3', default: [1, 0, 0] },
    { key: 'uEnabled', kind: 'bool', default: true },
  ])
  const sources = new Map<string, string | null>([['shader-gray', GRAYSCALE_SOURCE]])
  const dispatcher = new CommandDispatcher(engine, new UndoStack())
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
  expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S2' })))
  const host = document.createElement('div')
  const renderer = new Renderer(
    host,
    engine,
    (command) => dispatcher.dispatch(command),
    undefined,
    undefined,
    new FakeTimeSource(),
    undefined,
    undefined,
    undefined,
    (shaderId) => sources.get(shaderId) ?? null,
  )
  await renderer.start()
  const app = pixiRegistry.applications.at(-1)
  if (!app) {
    throw new Error('No pixi application was created')
  }
  const world = app.stage.children[0] as FakeContainer
  return { engine, dispatcher, renderer, app, sources, world }
}

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function activeSlideId(engine: Engine): string {
  const slide = engine.getActiveSlide()
  if (!slide) {
    throw new Error('expected an active slide')
  }
  return slide.id
}

function slideIdOf(engine: Engine, index: number): string {
  const slide = engine.project?.slides[index]
  if (!slide) {
    throw new Error(`expected slide at index ${index}`)
  }
  return slide.id
}

function fullscreenQuad(app: FakeApplication): FakeSprite | undefined {
  return app.stage.children.find((child) => child.label === 'fullscreen-shader-quad') as
    FakeSprite | undefined
}

function quadFilter(quad: FakeContainer | undefined): FakeFilter | undefined {
  return quad?.filters[0] as FakeFilter | undefined
}

function filterUniforms(filter: FakeFilter | undefined): Record<string, unknown> {
  if (!filter) {
    throw new Error('expected a filter')
  }
  return nodeFilterUniforms(filter as unknown as PixiFilter)
}

function filterResources(filter: FakeFilter | undefined): Record<string, unknown> {
  if (!filter) {
    throw new Error('expected a filter')
  }
  return filter.resources
}

beforeEach(() => {
  pixiRegistry.reset()
  resetShaderRegistries()
})

describe('fullscreen shader pass', () => {
  it('renders the scene through an offscreen texture and fullscreen quad when a compiled shader is assigned', async () => {
    const { engine, dispatcher, app, world } = await mount()
    const slideId = activeSlideId(engine)
    const firstTickRenderCalls = app.renderer.renderCalls.length
    app.ticker.tick()

    expect(fullscreenQuad(app)).toBeUndefined()
    expect(world.visible).toBe(true)
    expect(app.renderer.renderCalls.length).toBe(firstTickRenderCalls)

    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-gray' }),
      ),
    )

    const quad = fullscreenQuad(app)
    expect(quad).toBeDefined()
    const filter = quadFilter(quad)
    expect(filter?.glProgram.fragment).toBe(GRAYSCALE_SOURCE)

    app.ticker.tick()

    const renderCall = app.renderer.renderCalls.at(-1)
    expect(renderCall?.container).toBe(world)
    expect(renderCall?.target).toBe(quad?.texture)
    expect(quad?.texture.width).toBe(800)
    expect(quad?.texture.height).toBe(600)
    expect(world.visible).toBe(false)
  })

  it('resolves uniform values as definition defaults with slide overrides, without recompiling', async () => {
    const { engine, dispatcher, app } = await mount()
    const slideId = activeSlideId(engine)
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-gray' }),
      ),
    )
    const filter = quadFilter(fullscreenQuad(app))
    expect(filterUniforms(filter).uIntensity).toBe(0.5)
    expect(filterUniforms(filter).uColor).toEqual([1, 0, 0])
    expect(filterUniforms(filter).uEnabled).toBe(true)
    const programsBefore = fakeGlPrograms.calls.length

    expectOk(
      dispatcher.dispatch(
        new OverrideFullscreenUniformCommand({ slideId, uniform: 'uIntensity', value: 0.9 }),
      ),
    )

    expect(fakeGlPrograms.calls.length).toBe(programsBefore)
    expect(filterUniforms(quadFilter(fullscreenQuad(app))).uIntensity).toBe(0.9)
    expect(filterUniforms(quadFilter(fullscreenQuad(app))).uColor).toEqual([1, 0, 0])
  })

  it('deactivates when the shader is cleared, restoring direct scene rendering', async () => {
    const { engine, dispatcher, app, world } = await mount()
    const slideId = activeSlideId(engine)
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-gray' }),
      ),
    )
    const quad = fullscreenQuad(app)
    expect(quad).toBeDefined()

    expectOk(
      dispatcher.dispatch(new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: null })),
    )

    expect(fullscreenQuad(app)).toBeUndefined()
    expect(quad?.destroyed).toBe(true)
    expect(world.visible).toBe(true)
  })

  it('renders without the effect in degraded mode — uncompiled source — while preserving the reference', async () => {
    const { engine, dispatcher, app, world, sources } = await mount()
    const slideId = activeSlideId(engine)
    sources.set('shader-gray', null)

    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-gray' }),
      ),
    )

    expect(fullscreenQuad(app)).toBeUndefined()
    expect(world.visible).toBe(true)
    expect(engine.getSlide(slideId).fullscreenShader).toEqual({
      shaderDefinitionId: 'shader-gray',
      overrides: {},
    })
  })

  it('renders without the effect when the shader definition is unknown to the engine', async () => {
    const { engine, app, world } = await mount()
    const slideId = activeSlideId(engine)
    engine.getSlide(slideId).fullscreenShader = {
      shaderDefinitionId: 'ghost',
      overrides: {},
    }

    app.ticker.tick()

    expect(fullscreenQuad(app)).toBeUndefined()
    expect(world.visible).toBe(true)
    expect(engine.getSlide(slideId).fullscreenShader).toEqual({
      shaderDefinitionId: 'ghost',
      overrides: {},
    })
  })

  it('activates lazily once the shader compiles', async () => {
    const { engine, dispatcher, app, sources, renderer } = await mount()
    const slideId = activeSlideId(engine)
    sources.set('shader-gray', null)
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-gray' }),
      ),
    )
    expect(fullscreenQuad(app)).toBeUndefined()

    sources.set('shader-gray', GRAYSCALE_SOURCE)
    renderer.refreshNodeRendering()

    const quad = fullscreenQuad(app)
    expect(quad).toBeDefined()
    expect(quadFilter(quad)?.glProgram.fragment).toBe(GRAYSCALE_SOURCE)
  })

  it('compiles the program once through the shared cache', async () => {
    const { engine, dispatcher } = await mount()
    const slideId = activeSlideId(engine)
    const programsBefore = fakeGlPrograms.calls.length

    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-gray' }),
      ),
    )

    expect(fakeGlPrograms.calls.length).toBe(programsBefore + 1)
    expect(fakeGlPrograms.calls.at(-1)?.fragment).toBe(GRAYSCALE_SOURCE)
  })

  it('only applies the pass to the active slide; switching slides toggles the effect', async () => {
    const { engine, dispatcher, app, world } = await mount()
    const firstId = slideIdOf(engine, 0)
    const secondId = slideIdOf(engine, 1)
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId: secondId, shaderDefinitionId: 'shader-gray' }),
      ),
    )
    expect(fullscreenQuad(app)).toBeDefined()

    engine.setActiveSlide(firstId)

    expect(fullscreenQuad(app)).toBeUndefined()
    expect(world.visible).toBe(true)

    engine.setActiveSlide(secondId)

    expect(fullscreenQuad(app)).toBeDefined()
  })

  it('leaves the active slide untouched when a uniform changes on another slide', async () => {
    const { engine, dispatcher, app } = await mount()
    const firstId = slideIdOf(engine, 0)
    const secondId = slideIdOf(engine, 1)
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId: secondId, shaderDefinitionId: 'shader-gray' }),
      ),
    )
    const programsBefore = fakeGlPrograms.calls.length

    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId: firstId, shaderDefinitionId: 'shader-gray' }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new OverrideFullscreenUniformCommand({
          slideId: firstId,
          uniform: 'uIntensity',
          value: 0.9,
        }),
      ),
    )

    expect(fakeGlPrograms.calls.length).toBe(programsBefore)
    expect(filterUniforms(quadFilter(fullscreenQuad(app))).uIntensity).toBe(0.5)
  })
})

describe('fullscreen shader sampler uniforms', () => {
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

  async function mountWithSampler(): Promise<Mounted> {
    const engine = createEngine()
    engine.registerShaderDefinition('shader-mask', 'Masked', [
      { key: 'uMask', kind: 'sampler2D', default: 'def-photo' },
    ])
    const sources = new Map<string, string | null>([['shader-mask', MASK_SOURCE]])
    const dispatcher = new CommandDispatcher(engine, new UndoStack())
    expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
    expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
    const host = document.createElement('div')
    const renderer = new Renderer(
      host,
      engine,
      (command) => dispatcher.dispatch(command),
      undefined,
      (definitionId) => (definitionId === 'def-ghost' ? null : `/assets/${definitionId}.png`),
      new FakeTimeSource(),
      undefined,
      undefined,
      undefined,
      (shaderId) => sources.get(shaderId) ?? null,
    )
    await renderer.start()
    const app = pixiRegistry.applications.at(-1)
    if (!app) {
      throw new Error('No pixi application was created')
    }
    const world = app.stage.children[0] as FakeContainer
    return { engine, dispatcher, renderer, app, sources, world }
  }

  beforeEach(() => {
    textureLoads.clear()
  })

  it('binds the sampler to the resolved asset texture', async () => {
    const realTexture = new FakeTexture('/assets/def-photo.png')
    textureLoads.set('/assets/def-photo.png', realTexture)
    const { engine, dispatcher, app } = await mountWithSampler()
    const slideId = activeSlideId(engine)

    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-mask' }),
      ),
    )

    const filter = quadFilter(fullscreenQuad(app))
    await vi.waitFor(() =>
      expect((filterResources(filter).uMask as FakeTexture).url).toBe('/assets/def-photo.png'),
    )
  })

  it('unbinds the sampler for an asset without a resolvable url, rendering without the effect', async () => {
    const { engine, dispatcher, app } = await mountWithSampler()
    const slideId = activeSlideId(engine)
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-mask' }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new OverrideFullscreenUniformCommand({ slideId, uniform: 'uMask', value: 'def-ghost' }),
      ),
    )

    const filter = quadFilter(fullscreenQuad(app))
    expect(filter).toBeDefined()
    const placeholder = filterResources(filter).uMask as FakeTexture
    expect(placeholder).toBeDefined()
    expect(placeholder.url).toBeUndefined()
    expect(filterUniforms(filter).uMask).toBeUndefined()
  })
})
