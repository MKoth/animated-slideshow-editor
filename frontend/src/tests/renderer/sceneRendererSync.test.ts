import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnginePublic } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import {
  createCommandSystem,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetSlideSceneEffectsCommand,
} from '../../engine/commands'
import { applyHierarchyMove } from '../../app/hierarchyMoveActions'
import { Renderer } from '../../pixi/renderer/renderer'
import { pixiRegistry, FakeContainer } from './pixiFake'
import { worldOf } from './testUtils'
import { walkPreOrder } from '../../engine/sceneNode'
import { deserialize, serialize } from '../../engine/lessonSerializer'
import type { CurrentTimeSource } from '../../pixi/renderer/sceneRenderer'
import type { FakeGraphics } from './pixiFake'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

const rawAddChildAt = FakeContainer.prototype.addChildAt
FakeContainer.prototype.addChildAt = function addChildAtChecked(
  child: FakeContainer,
  index: number,
) {
  if (index < 0 || index > this.children.length) {
    throw new Error(`The index ${index} supplied is out of bounds ${this.children.length}`)
  }
  return rawAddChildAt.call(this, child, index)
}

beforeEach(() => {
  pixiRegistry.reset()
})

async function mount(
  currentTime?: CurrentTimeSource,
  existingSystem?: ReturnType<typeof createCommandSystem>,
) {
  const system = existingSystem ?? createCommandSystem()
  const host = document.createElement('div')
  const renderer = new Renderer(
    host,
    system.engine,
    (command) => system.dispatcher.dispatch(command),
    undefined,
    undefined,
    currentTime,
  )
  await renderer.start()
  const app = pixiRegistry.applications.at(-1)
  if (!app) {
    throw new Error('No pixi application was created')
  }
  const dispatcher: DispatchCommand = (command) => system.dispatcher.dispatch(command)
  return { system, dispatcher, renderer, app }
}

function nodeNamed(engine: EnginePublic, name: string): string {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  const node = slide.scene.root.children.find((child) => child.name === name)
  if (!node) {
    throw new Error(`Node ${name} not found`)
  }
  return node.id
}

function assertDisplayTreeMatchesScene(engine: EnginePublic, root: FakeContainer): void {
  const slide = engine.project?.slides[0]
  if (!slide) {
    throw new Error('Slide was not created')
  }
  const scene = slide.scene
  const byId = new Map<string, FakeContainer>()
  const walk = (container: FakeContainer): void => {
    if (container.label !== 'Root') {
      byId.set(container.label, container)
    }
    for (const child of container.children) {
      walk(child)
    }
  }
  walk(root)
  for (const node of walkPreOrder(scene.root)) {
    if (!node.parent) {
      continue
    }
    const container = byId.get(node.name)
    expect(container, `container for ${node.name}`).toBeDefined()
    const expected = node.children.map((child) => {
      const childContainer = byId.get(child.name)
      expect(childContainer, `container for ${child.name}`).toBeDefined()
      return childContainer
    })
    expect(container?.children, `children of ${node.name}`).toEqual(expected)
  }
}

describe('scene renderer display tree sync', () => {
  it('keeps display order in sync through nesting, reorder and unparent drops', async () => {
    const { system, dispatcher, app } = await mount()
    system.dispatcher.dispatch(new CreateProjectCommand({ name: 'P' }))
    system.dispatcher.dispatch(new CreateSlideCommand({ name: 'S1' }))
    const engine = system.engine
    const scene = engine.project?.slides[0]?.scene
    if (!scene) {
      throw new Error('Slide was not created')
    }
    const rootId = scene.root.id
    for (const name of ['A', 'B', 'C']) {
      system.dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: scene.id, parentId: scene.root.id, name }),
      )
    }
    const aId = nodeNamed(engine, 'A')
    const bId = nodeNamed(engine, 'B')
    const cId = nodeNamed(engine, 'C')
    const world = worldOf(app)
    const root = world.children.find((child) => child.label === 'Root') as FakeContainer | undefined
    if (!root) {
      throw new Error('Root container not found')
    }

    // 1. make B a child of A (drop B into A)
    applyHierarchyMove(engine, dispatcher, { targets: [bId], parentId: aId, index: 0 })
    // 2. make C a child of B (drop C into B)
    applyHierarchyMove(engine, dispatcher, { targets: [cId], parentId: bId, index: 0 })
    // 3. drag C out of B and drop it before B under A (reorder inside A)
    applyHierarchyMove(engine, dispatcher, { targets: [cId], parentId: aId, index: 0 })

    expect(root.children.map((child) => child.label)).toEqual(['Camera', 'A'])
    assertDisplayTreeMatchesScene(engine, root)
    // A holds C then B after the reorder
    const aContainer = root.children.find((child) => child.label === 'A') as
      FakeContainer | undefined
    expect(aContainer?.children.map((child) => child.label)).toEqual(['C', 'B'])

    // 4. drag C back to the root (unparent)
    applyHierarchyMove(engine, dispatcher, { targets: [cId], parentId: rootId, index: 1 })
    assertDisplayTreeMatchesScene(engine, root)
    // 5. drag C back into A, then out of B again
    applyHierarchyMove(engine, dispatcher, { targets: [cId], parentId: aId, index: 0 })
    applyHierarchyMove(engine, dispatcher, { targets: [cId], parentId: rootId, index: 0 })
    assertDisplayTreeMatchesScene(engine, root)
  })

  it('masks reveal targets against the fixed composite field deterministically while seeking', async () => {
    let time = 0
    const listeners = new Set<() => void>()
    const currentTime: CurrentTimeSource = {
      getTime: () => time,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
    const setTime = (next: number) => {
      time = next
      for (const listener of listeners) listener()
    }
    const { system, renderer, app } = await mount(currentTime)
    system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Reveal' }))
    system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide' }))
    const slide = system.engine.getActiveSlide()!
    const created = system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Target',
        components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
      }),
    )
    if (!created.ok) throw created.error
    const nodeId = (created.inverse as { nodeId: string }).nodeId
    system.dispatcher.dispatch(
      new SetSlideSceneEffectsCommand({
        slideId: slide.id,
        effects: [
          {
            kind: 'reveal',
            id: 'test-reveal',
            start: 1,
            duration: 2,
            scopeNodeIds: [nodeId],
            nodeIds: [nodeId],
            bounds: { minX: 10, minY: 20, maxX: 110, maxY: 60 },
            visual: { kind: 'paw' },
          },
        ],
      }),
    )
    setTime(2)
    const world = worldOf(app)
    const target = world.children
      .flatMap((child) => child.children)
      .find((child) => child.label === 'Target')
    const mask = (target as unknown as { mask: FakeGraphics }).mask
    expect(mask.calls.find((call) => call.method === 'rect')?.args).toEqual([10, 20, 50, 40])
    const restoredSystem = createCommandSystem()
    restoredSystem.engine.openProject(deserialize(serialize(system.engine.project!)))
    const restoredRenderer = await mount(currentTime, restoredSystem)
    const restoredWorld = worldOf(restoredRenderer.app)
    const restoredTarget = restoredWorld.children
      .flatMap((child) => child.children)
      .find((child) => child.label === 'Target')
    const restoredMask = (restoredTarget as unknown as { mask: FakeGraphics }).mask
    expect(restoredMask.calls.find((call) => call.method === 'rect')?.args).toEqual(
      mask.calls.find((call) => call.method === 'rect')?.args,
    )
    restoredRenderer.renderer.dispose()
    setTime(1.5)
    expect(mask.calls.find((call) => call.method === 'rect')?.args).toEqual([10, 20, 25, 40])
    setTime(2)
    expect(mask.calls.find((call) => call.method === 'rect')?.args).toEqual([10, 20, 50, 40])
    setTime(3)
    expect(mask.calls.find((call) => call.method === 'rect')?.args).toEqual([10, 20, 100, 40])
    system.dispatcher.dispatch(
      new SetSlideSceneEffectsCommand({
        slideId: slide.id,
        effects: [
          {
            kind: 'wipe',
            id: 'test-wipe',
            start: 1,
            duration: 2,
            scopeNodeIds: [nodeId],
            nodeIds: [nodeId],
            bounds: { minX: 10, minY: 20, maxX: 110, maxY: 60 },
            visual: { kind: 'cloth' },
          },
        ],
      }),
    )
    setTime(2)
    expect(mask.calls.find((call) => call.method === 'rect')?.args).toEqual([60, 20, 50, 40])
    expect(
      (world.children as FakeContainer[]).some(
        (child) => child.kind === 'graphics' && child.zIndex === Number.MAX_SAFE_INTEGER,
      ),
    ).toBe(true)
    system.dispatcher.dispatch(
      new SetSlideSceneEffectsCommand({
        slideId: slide.id,
        effects: [
          {
            kind: 'reveal',
            id: 'paw-reveal',
            start: 1,
            duration: 2,
            scopeNodeIds: [nodeId],
            nodeIds: [nodeId],
            bounds: { minX: 10, minY: 20, maxX: 110, maxY: 60 },
            visual: { kind: 'paw' },
          },
          {
            kind: 'reveal',
            id: 'silent-reveal',
            start: 1.5,
            duration: 1,
            scopeNodeIds: [nodeId],
            nodeIds: [nodeId],
            bounds: { minX: 10, minY: 20, maxX: 110, maxY: 60 },
            visual: { kind: 'none' },
          },
        ],
      }),
    )
    setTime(1.25)
    expect(
      (world.children as FakeContainer[]).some(
        (child) => child.kind === 'graphics' && child.zIndex === Number.MAX_SAFE_INTEGER,
      ),
    ).toBe(true)
    setTime(1.75)
    expect(
      (world.children as FakeContainer[]).some(
        (child) => child.kind === 'graphics' && child.zIndex === Number.MAX_SAFE_INTEGER,
      ),
    ).toBe(false)
    renderer.dispose()
  })
})
