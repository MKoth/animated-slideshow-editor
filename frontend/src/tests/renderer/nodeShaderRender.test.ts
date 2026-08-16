import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  AssignMaterialCommand,
  CommandDispatcher,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  OverrideMaterialParameterCommand,
  UndoStack,
} from '../../engine/commands'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import type { PixiFilter } from '../../pixi/renderer/pixi'
import { nodeFilterUniforms } from '../../pixi/renderer/nodeShader'
import { Renderer } from '../../pixi/renderer/renderer'
import { FakeTimeSource } from '../fakeTimeSource'
import {
  fakeGlPrograms,
  pixiRegistry,
  resetShaderRegistries,
  textureDeferreds,
  textureLoads,
} from './pixiFake'
import { FakeTexture, deferredTexture } from './pixiFake'
import type { FakeApplication, FakeContainer, FakeFilter } from './pixiFake'

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
}

async function mount(): Promise<Mounted> {
  const engine = createEngine()
  engine.registerShaderDefinition('shader-gray', 'Grayscale')
  engine.registerMaterialDefinition(
    'mat-gray',
    'Grayscale Mat',
    [
      { key: 'tint', kind: 'color', default: '#ffffff' },
      { key: 'opacityMultiplier', kind: 'number', default: 1 },
      { key: 'uIntensity', kind: 'float', default: 0.5 },
      { key: 'uColor', kind: 'vec3', default: [1, 0, 0] },
    ],
    'shader-gray',
  )
  const sources = new Map<string, string | null>([['shader-gray', GRAYSCALE_SOURCE]])
  const dispatcher = new CommandDispatcher(engine, new UndoStack())
  expectOk(dispatcher.dispatch(new CreateProjectCommand({ name: 'P' })))
  expectOk(dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' })))
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
  return { engine, dispatcher, renderer, app, sources }
}

function expectOk<T>(result: CommandResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected a successful command, got: ${result.error.message}`)
  }
  return result.inverse
}

function createNode(
  engine: Engine,
  dispatcher: CommandDispatcher,
  name: string,
  components: Record<string, unknown>,
): string {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('expected a slide')
  }
  const { nodeId } = expectOk(
    dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name,
        components: components as never,
      }),
    ),
  )
  return nodeId
}

function rootOf(app: FakeApplication): FakeContainer {
  const world = app.stage.children[0] as FakeContainer
  const root = world.children.find((child) => child.label === 'Root') as FakeContainer | undefined
  if (!root) {
    throw new Error('Root container not found')
  }
  return root
}

function nodeContainer(app: FakeApplication, name: string): FakeContainer {
  const container = rootOf(app).children.find((child) => child.label === name) as
    FakeContainer | undefined
  if (!container) {
    throw new Error(`Container for ${name} not found`)
  }
  return container
}

function nodeFilter(app: FakeApplication, name: string): FakeFilter | undefined {
  const placeholder = nodeContainer(app, name).children[0]
  return placeholder?.filters[0]
}

function filterUniforms(filter: FakeFilter | undefined): Record<string, unknown> {
  if (!filter) {
    throw new Error('expected a filter')
  }
  return nodeFilterUniforms(filter as unknown as PixiFilter)
}

beforeEach(() => {
  pixiRegistry.reset()
  resetShaderRegistries()
})

describe('per-node shader rendering', () => {
  it('renders a node with a shader-carrying material through the fragment shader', async () => {
    const { engine, dispatcher, app } = await mount()
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })

    expect(nodeFilter(app, 'A')).toBeUndefined()

    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-gray' })),
    )

    const filter = nodeFilter(app, 'A')
    expect(filter).toBeDefined()
    expect(filter?.glProgram.fragment).toBe(GRAYSCALE_SOURCE)
    expect(filterUniforms(filter).uIntensity).toBe(0.5)
    expect(filterUniforms(filter).uColor).toEqual([1, 0, 0])
  })

  it('compiles a shared shader source once across definitions and materials', async () => {
    const { engine, dispatcher, app, sources } = await mount()
    engine.registerShaderDefinition('shader-gray-2', 'Grayscale 2')
    sources.set('shader-gray-2', GRAYSCALE_SOURCE)
    engine.registerMaterialDefinition(
      'mat-gray-2',
      'Grayscale Mat 2',
      [
        { key: 'tint', kind: 'color', default: '#ffffff' },
        { key: 'opacityMultiplier', kind: 'number', default: 1 },
        { key: 'uIntensity', kind: 'float', default: 0.25 },
      ],
      'shader-gray-2',
    )
    const aId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })
    const bId = createNode(engine, dispatcher, 'B', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-b' },
    })
    expectOk(
      dispatcher.dispatch(
        new AssignMaterialCommand({ nodeId: aId, materialDefinitionId: 'mat-gray' }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new AssignMaterialCommand({ nodeId: bId, materialDefinitionId: 'mat-gray-2' }),
      ),
    )

    expect(nodeFilter(app, 'A')).toBeDefined()
    expect(nodeFilter(app, 'B')).toBeDefined()
    expect(fakeGlPrograms.calls.filter((call) => call.fragment === GRAYSCALE_SOURCE)).toHaveLength(
      1,
    )
  })

  it('updates uniform values without recompiling the program', async () => {
    const { engine, dispatcher, app } = await mount()
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })
    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-gray' })),
    )
    const filter = nodeFilter(app, 'A')
    const programsBefore = fakeGlPrograms.calls.length

    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'uIntensity', value: 0.9 }),
      ),
    )

    expect(fakeGlPrograms.calls.length).toBe(programsBefore)
    expect(filterUniforms(filter).uIntensity).toBe(0.9)
  })

  it('updates only the affected node when its uniform changes', async () => {
    const { engine, dispatcher, app, sources } = await mount()
    engine.registerShaderDefinition('shader-gray-2', 'Grayscale 2')
    sources.set('shader-gray-2', GRAYSCALE_SOURCE)
    engine.registerMaterialDefinition(
      'mat-gray-2',
      'Grayscale Mat 2',
      [
        { key: 'tint', kind: 'color', default: '#ffffff' },
        { key: 'opacityMultiplier', kind: 'number', default: 1 },
        { key: 'uIntensity', kind: 'float', default: 0.25 },
      ],
      'shader-gray-2',
    )
    const aId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })
    const bId = createNode(engine, dispatcher, 'B', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-b' },
    })
    expectOk(
      dispatcher.dispatch(
        new AssignMaterialCommand({ nodeId: aId, materialDefinitionId: 'mat-gray' }),
      ),
    )
    expectOk(
      dispatcher.dispatch(
        new AssignMaterialCommand({ nodeId: bId, materialDefinitionId: 'mat-gray-2' }),
      ),
    )
    const aFilter = nodeFilter(app, 'A')
    const bFilter = nodeFilter(app, 'B')

    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId: aId, parameter: 'uIntensity', value: 0.9 }),
      ),
    )

    expect(filterUniforms(aFilter).uIntensity).toBe(0.9)
    expect(filterUniforms(bFilter).uIntensity).toBe(0.25)
  })

  it('renders a text node through the shader when a shader is assigned, plain as today otherwise', async () => {
    const { engine, dispatcher, app } = await mount()
    const nodeId = createNode(engine, dispatcher, 'T', {
      text: { kind: 'text', content: 'Hi', fontSize: 24, alignment: 'center' },
    })

    expect(nodeFilter(app, 'T')).toBeUndefined()

    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-gray' })),
    )

    const filter = nodeFilter(app, 'T')
    expect(filter).toBeDefined()
    expect(filter?.glProgram.fragment).toBe(GRAYSCALE_SOURCE)
  })

  it('renders an untextured shader without sampling a texture', async () => {
    const { engine, dispatcher, app, sources } = await mount()
    const gradientSource = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
void main() {
  fragColor = vec4(mix(vec3(0.0, 0.25, 0.5), vec3(0.9, 0.9, 1.0), vUv.y), 1.0);
}
`
    engine.registerShaderDefinition('shader-gradient', 'Gradient')
    engine.registerMaterialDefinition(
      'mat-gradient',
      'Gradient Mat',
      [
        { key: 'tint', kind: 'color', default: '#ffffff' },
        { key: 'opacityMultiplier', kind: 'number', default: 1 },
      ],
      'shader-gradient',
    )
    sources.set('shader-gradient', gradientSource)
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })

    expectOk(
      dispatcher.dispatch(
        new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-gradient' }),
      ),
    )

    const filter = nodeFilter(app, 'A')
    expect(filter).toBeDefined()
    expect(filter?.glProgram.fragment).toBe(gradientSource)
    expect(filter?.glProgram.fragment).not.toContain('uTexture')
  })

  it('renders the plain path when the referenced shader failed to compile', async () => {
    const { engine, dispatcher, app, sources } = await mount()
    sources.set('shader-gray', null)
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })

    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-gray' })),
    )

    expect(nodeFilter(app, 'A')).toBeUndefined()
  })

  it('removes and destroys the shader layer when the material stops carrying a shader', async () => {
    const { engine, dispatcher, app } = await mount()
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })
    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-gray' })),
    )
    const filter = nodeFilter(app, 'A')
    expect(filter).toBeDefined()

    expectOk(
      dispatcher.dispatch(
        new AssignMaterialCommand({
          nodeId,
          materialDefinitionId: '0d3f4464-8300-5b6d-ae14-45246fefbeae',
        }),
      ),
    )

    expect(nodeFilter(app, 'A')).toBeUndefined()
    expect(filter?.destroyed).toBe(true)
  })

  it('skips repeated per-frame work for nodes rendering without a shader', async () => {
    const { engine, dispatcher, app, sources } = await mount()
    sources.set('shader-gray', null)
    createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })
    const container = nodeContainer(app, 'A')
    const positionSet = vi.spyOn(container.position, 'set')

    app.ticker.tick()

    expect(positionSet).not.toHaveBeenCalled()
  })

  it('replaces the filter with a fresh program when the shader source changes', async () => {
    const { engine, dispatcher, app, sources } = await mount()
    const sepiaSource = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  fragColor = vec4(color.r, color.g, color.b, color.a);
}
`
    engine.registerShaderDefinition('shader-sepia', 'Sepia')
    engine.registerMaterialDefinition(
      'mat-sepia',
      'Sepia Mat',
      [
        { key: 'tint', kind: 'color', default: '#ffffff' },
        { key: 'opacityMultiplier', kind: 'number', default: 1 },
      ],
      'shader-sepia',
    )
    sources.set('shader-sepia', sepiaSource)
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })
    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-gray' })),
    )
    const firstFilter = nodeFilter(app, 'A')

    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-sepia' })),
    )

    const replacement = nodeFilter(app, 'A')
    expect(replacement).not.toBe(firstFilter)
    expect(replacement?.glProgram.fragment).toBe(sepiaSource)
    expect(firstFilter?.destroyed).toBe(true)
  })
})

describe('per-node sampler2D uniform binding', () => {
  const MASK_SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform sampler2D uMask;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  vec4 mask = texture(uMask, vUv);
  fragColor = color * mask;
}
`

  async function mountWithSampler(): Promise<Mounted> {
    const engine = createEngine()
    engine.registerShaderDefinition('shader-mask', 'Masked')
    engine.registerMaterialDefinition(
      'mat-mask',
      'Masked Mat',
      [
        { key: 'tint', kind: 'color', default: '#ffffff' },
        { key: 'opacityMultiplier', kind: 'number', default: 1 },
        { key: 'uMask', kind: 'sampler2D', default: 'def-photo' },
      ],
      'shader-mask',
    )
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
    return { engine, dispatcher, renderer, app, sources }
  }

  beforeEach(() => {
    textureLoads.clear()
    textureDeferreds.clear()
  })

  it('binds the placeholder texture first and the loaded asset texture once it resolves', async () => {
    const realTexture = new FakeTexture('/assets/def-photo.png')
    textureLoads.set('/assets/def-photo.png', realTexture)
    const { engine, dispatcher, app } = await mountWithSampler()
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })

    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-mask' })),
    )

    const filter = nodeFilter(app, 'A')
    const placeholder = filterUniforms(filter).uMask as FakeTexture
    expect(placeholder).toBeDefined()
    expect(placeholder.url).toBeUndefined()

    await vi.waitFor(() =>
      expect((filterUniforms(filter).uMask as FakeTexture).url).toBe('/assets/def-photo.png'),
    )
    expect(filterUniforms(filter).uMask).toBe(realTexture)
  })

  it('rebinds the sampler when the node overrides the asset', async () => {
    textureLoads.set('/assets/def-photo.png', new FakeTexture('/assets/def-photo.png'))
    textureLoads.set('/assets/def-override.png', new FakeTexture('/assets/def-override.png'))
    const { engine, dispatcher, app } = await mountWithSampler()
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })
    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-mask' })),
    )
    const filter = nodeFilter(app, 'A')
    await vi.waitFor(() =>
      expect((filterUniforms(filter).uMask as FakeTexture).url).toBe('/assets/def-photo.png'),
    )

    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'uMask', value: 'def-override' }),
      ),
    )

    await vi.waitFor(() =>
      expect((filterUniforms(filter).uMask as FakeTexture).url).toBe('/assets/def-override.png'),
    )
  })

  it('leaves the sampler unbound for an asset without a resolvable url', async () => {
    const { engine, dispatcher, app } = await mountWithSampler()
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })
    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-mask' })),
    )
    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'uMask', value: 'def-ghost' }),
      ),
    )

    const filter = nodeFilter(app, 'A')
    expect(filter).toBeDefined()
    expect(filterUniforms(filter).uMask).toBeUndefined()
  })

  it('ignores a stale texture load when the sampler is rebound before it resolves', async () => {
    const stale = deferredTexture()
    textureDeferreds.set('/assets/def-photo.png', stale)
    const replacement = new FakeTexture('/assets/def-override.png')
    textureLoads.set('/assets/def-override.png', replacement)
    const { engine, dispatcher, app } = await mountWithSampler()
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })
    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-mask' })),
    )
    expectOk(
      dispatcher.dispatch(
        new OverrideMaterialParameterCommand({ nodeId, parameter: 'uMask', value: 'def-override' }),
      ),
    )
    const filter = nodeFilter(app, 'A')
    await vi.waitFor(() =>
      expect((filterUniforms(filter).uMask as FakeTexture).url).toBe('/assets/def-override.png'),
    )

    stale.resolve(new FakeTexture('/assets/def-photo.png'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect((filterUniforms(filter).uMask as FakeTexture).url).toBe('/assets/def-override.png')
  })
})
