import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EnginePublic } from '../../engine'
import type { DispatchCommand } from '../../engine/commands'
import {
  createCommandSystem,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
} from '../../engine/commands'
import { applyHierarchyMove } from '../../app/hierarchyMoveActions'
import { Renderer } from '../../pixi/renderer/renderer'
import { pixiRegistry, FakeContainer } from './pixiFake'
import { worldOf } from './testUtils'
import { walkPreOrder } from '../../engine/sceneNode'

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

async function mount() {
  const system = createCommandSystem()
  const host = document.createElement('div')
  const renderer = new Renderer(host, system.engine, (command) =>
    system.dispatcher.dispatch(command),
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
})
