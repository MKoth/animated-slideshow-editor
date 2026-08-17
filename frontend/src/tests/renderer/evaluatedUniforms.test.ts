import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandResult } from '../../engine/commands'
import {
  AddKeyframeCommand,
  AssignMaterialCommand,
  CommandDispatcher,
  CreateNodeCommand,
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
import { fakeGlPrograms, pixiRegistry, resetShaderRegistries } from './pixiFake'
import type { FakeApplication, FakeContainer, FakeFilter, FakeSprite } from './pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

const UTIME_SHADER_SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform float uTime;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  fragColor = vec4(color.rgb * (0.5 + 0.5 * sin(uTime)), color.a);
}
`

const NO_UTIME_SHADER_SOURCE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform float uIntensity;
out vec4 fragColor;
void main() {
  vec4 color = texture(uTexture, vUv);
  fragColor = vec4(color.rgb * uIntensity, color.a);
}
`

interface Mounted {
  engine: Engine
  dispatcher: CommandDispatcher
  renderer: Renderer
  app: FakeApplication
  sources: Map<string, string | null>
  timeSource: FakeTimeSource
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

function fullscreenQuad(app: FakeApplication): FakeSprite | undefined {
  return app.stage.children.find((child) => child.label === 'fullscreen-shader-quad') as
    FakeSprite | undefined
}

function quadFilter(quad: FakeContainer | undefined): FakeFilter | undefined {
  return quad?.filters[0] as FakeFilter | undefined
}

function activeSlideId(engine: Engine): string {
  const slide = engine.getActiveSlide()
  if (!slide) {
    throw new Error('expected an active slide')
  }
  return slide.id
}

async function mountWithUtimeShader(): Promise<Mounted> {
  const engine = createEngine()
  engine.registerShaderDefinition('shader-utime', 'UTime Shader')
  engine.registerMaterialDefinition(
    'mat-utime',
    'UTime Mat',
    [
      { key: 'tint', kind: 'color', default: '#ffffff' },
      { key: 'opacityMultiplier', kind: 'number', default: 1 },
      { key: 'uIntensity', kind: 'float', default: 0.5 },
    ],
    'shader-utime',
  )
  const sources = new Map<string, string | null>([['shader-utime', UTIME_SHADER_SOURCE]])
  const timeSource = new FakeTimeSource()
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
    timeSource,
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
  return { engine, dispatcher, renderer, app, sources, timeSource }
}

async function mountWithShaderNoUtime(): Promise<Mounted> {
  const engine = createEngine()
  engine.registerShaderDefinition('shader-noutime', 'No UTime Shader')
  engine.registerMaterialDefinition(
    'mat-noutime',
    'No UTime Mat',
    [
      { key: 'tint', kind: 'color', default: '#ffffff' },
      { key: 'opacityMultiplier', kind: 'number', default: 1 },
      { key: 'uIntensity', kind: 'float', default: 0.5 },
    ],
    'shader-noutime',
  )
  const sources = new Map<string, string | null>([['shader-noutime', NO_UTIME_SHADER_SOURCE]])
  const timeSource = new FakeTimeSource()
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
    timeSource,
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
  return { engine, dispatcher, renderer, app, sources, timeSource }
}

async function mountFullscreenWithUtime(): Promise<Mounted> {
  const engine = createEngine()
  engine.registerShaderDefinition('shader-utime-fs', 'UTime FS Shader', [
    { key: 'uIntensity', kind: 'float', default: 0.5 },
  ])
  const sources = new Map<string, string | null>([['shader-utime-fs', UTIME_SHADER_SOURCE]])
  const timeSource = new FakeTimeSource()
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
    timeSource,
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
  return { engine, dispatcher, renderer, app, sources, timeSource }
}

beforeEach(() => {
  pixiRegistry.reset()
  resetShaderRegistries()
})

describe('evaluated material overrides on time change', () => {
  it('re-applies keyframed uniforms when the playhead changes', async () => {
    const { engine, dispatcher, app, timeSource } = await mountWithUtimeShader()
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })
    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-utime' })),
    )

    const target = { kind: 'node' as const, nodeId, parameter: 'uIntensity', kindOf: () => 'float' }
    expectOk(dispatcher.dispatch(new AddKeyframeCommand({ target, time: 0, value: 0.1 })))
    expectOk(dispatcher.dispatch(new AddKeyframeCommand({ target, time: 10, value: 0.9 })))

    timeSource.set(0)
    const filterAt0 = nodeFilter(app, 'A')
    expect(filterUniforms(filterAt0).uIntensity).toBe(0.1)

    timeSource.set(5)
    app.ticker.tick()
    expect(filterUniforms(nodeFilter(app, 'A')).uIntensity).toBe(0.5)

    timeSource.set(10)
    app.ticker.tick()
    expect(filterUniforms(nodeFilter(app, 'A')).uIntensity).toBe(0.9)
  })

  it('re-applies static overrides plus keyframed uniforms (evaluated wins)', async () => {
    const { engine, dispatcher, app, timeSource } = await mountWithUtimeShader()
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })
    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-utime' })),
    )

    const target = { kind: 'node' as const, nodeId, parameter: 'uIntensity', kindOf: () => 'float' }
    expectOk(dispatcher.dispatch(new AddKeyframeCommand({ target, time: 0, value: 0.2 })))
    expectOk(dispatcher.dispatch(new AddKeyframeCommand({ target, time: 10, value: 0.8 })))

    timeSource.set(5)
    app.ticker.tick()
    expect(filterUniforms(nodeFilter(app, 'A')).uIntensity).toBe(0.5)
  })
})

describe('uTime uniform upload', () => {
  it('uploads uTime tracking the playhead on node shader passes', async () => {
    const { engine, dispatcher, app, timeSource } = await mountWithUtimeShader()
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })
    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-utime' })),
    )

    timeSource.set(0)
    expect(filterUniforms(nodeFilter(app, 'A')).uTime).toBe(0)

    timeSource.set(2.5)
    app.ticker.tick()
    expect(filterUniforms(nodeFilter(app, 'A')).uTime).toBe(2.5)

    timeSource.set(7)
    app.ticker.tick()
    expect(filterUniforms(nodeFilter(app, 'A')).uTime).toBe(7)
  })

  it('freezes uTime when the playhead is still', async () => {
    const { engine, dispatcher, app, timeSource } = await mountWithUtimeShader()
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })
    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-utime' })),
    )

    timeSource.set(3)
    app.ticker.tick()
    expect(filterUniforms(nodeFilter(app, 'A')).uTime).toBe(3)

    app.ticker.tick()
    app.ticker.tick()
    expect(filterUniforms(nodeFilter(app, 'A')).uTime).toBe(3)
  })

  it('uploads uTime on fullscreen shader passes', async () => {
    const { engine, dispatcher, app, timeSource } = await mountFullscreenWithUtime()
    const slideId = activeSlideId(engine)
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-utime-fs' }),
      ),
    )

    timeSource.set(0)
    app.ticker.tick()
    expect(filterUniforms(quadFilter(fullscreenQuad(app))).uTime).toBe(0)

    timeSource.set(4)
    app.ticker.tick()
    expect(filterUniforms(quadFilter(fullscreenQuad(app))).uTime).toBe(4)
  })

  it('does not declare uTime in shaders that do not use it — renders unchanged', async () => {
    const { engine, dispatcher, app } = await mountWithShaderNoUtime()
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })
    expectOk(
      dispatcher.dispatch(
        new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-noutime' }),
      ),
    )

    const filter = nodeFilter(app, 'A')
    expect(filter).toBeDefined()
    expect(filter?.glProgram.fragment).toBe(NO_UTIME_SHADER_SOURCE)
    expect(filterUniforms(filter).uIntensity).toBe(0.5)
    expect(filterUniforms(filter).uTime).toBeUndefined()
  })
})

describe('renderer event wiring for keyframe + material changes', () => {
  it('re-evaluates on KeyframeAdded and re-applies uniforms', async () => {
    const { engine, dispatcher, app, timeSource } = await mountWithUtimeShader()
    const nodeId = createNode(engine, dispatcher, 'A', {
      assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-a' },
    })
    expectOk(
      dispatcher.dispatch(new AssignMaterialCommand({ nodeId, materialDefinitionId: 'mat-utime' })),
    )

    const target = { kind: 'node' as const, nodeId, parameter: 'uIntensity', kindOf: () => 'float' }
    timeSource.set(5)
    expectOk(dispatcher.dispatch(new AddKeyframeCommand({ target, time: 5, value: 0.7 })))

    expect(filterUniforms(nodeFilter(app, 'A')).uIntensity).toBe(0.7)
  })

  it('updates fullscreen shader uniforms without recompiling', async () => {
    const { engine, dispatcher, app } = await mountFullscreenWithUtime()
    const slideId = activeSlideId(engine)
    expectOk(
      dispatcher.dispatch(
        new SetFullscreenShaderCommand({ slideId, shaderDefinitionId: 'shader-utime-fs' }),
      ),
    )
    const programsBefore = fakeGlPrograms.calls.length

    expectOk(
      dispatcher.dispatch(
        new OverrideFullscreenUniformCommand({ slideId, uniform: 'uIntensity', value: 0.9 }),
      ),
    )

    expect(fakeGlPrograms.calls.length).toBe(programsBefore)
    expect(filterUniforms(quadFilter(fullscreenQuad(app))).uIntensity).toBe(0.9)
  })
})
