import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ChangeZOrderCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DeleteNodeCommand,
  MoveNodeCommand,
  ReparentNodeCommand,
  SetVisibilityCommand,
  createCommandSystem,
} from '../../engine/commands'
import { Renderer } from '../../pixi/renderer/renderer'
import { pixiRegistry } from './pixiFake'
import { findByLabel, worldOf } from './testUtils'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
})

async function setup() {
  const system = createCommandSystem()
  const host = document.createElement('div')
  const renderer = new Renderer(host, system.engine)
  await renderer.start()
  const app = pixiRegistry.applications[0]
  if (!app) {
    throw new Error('No pixi application was created')
  }
  system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Demo' }))
  system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide 1' }))
  return { system, host, renderer, app }
}

describe('engine to renderer integration', () => {
  it('displays a placeholder for a node created through a command, in the same turn', async () => {
    const { system, app } = await setup()
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }

    const result = system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Hero',
        transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
        components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'def-1' } },
      }),
    )

    expect(result.ok).toBe(true)
    const root = findByLabel(worldOf(app), 'Root')
    const hero = findByLabel(root ?? { children: [] }, 'Hero')
    expect(hero).toBeDefined()
    expect(hero?.position.x).toBe(10)
    expect(hero?.position.y).toBe(20)
    const placeholder = hero?.children[0]
    expect(placeholder?.children.some((child) => child.kind === 'sprite')).toBe(true)
    expect(
      placeholder?.children.some((child) => child.kind === 'text' && child.text === 'Hero'),
    ).toBe(true)
  })

  it('syncs transform and visibility changes immediately after dispatch, without polling', async () => {
    const { system, app } = await setup()
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const createResult = system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Hero',
      }),
    )
    if (!createResult.ok || !createResult.inverse) {
      throw new Error('Node was not created')
    }
    const nodeId = createResult.inverse.nodeId
    const root = findByLabel(worldOf(app), 'Root')
    const hero = findByLabel(root ?? { children: [] }, 'Hero')
    if (!hero) {
      throw new Error('Hero container not found')
    }

    system.dispatcher.dispatch(new MoveNodeCommand({ nodeId, x: 120, y: 80 }))
    expect(hero.position.x).toBe(120)
    expect(hero.position.y).toBe(80)

    system.dispatcher.dispatch(new SetVisibilityCommand({ nodeId, visible: false }))
    expect(hero.visible).toBe(false)
  })

  it('removes the display object when its node is deleted through a command', async () => {
    const { system, app } = await setup()
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const createResult = system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Hero',
      }),
    )
    if (!createResult.ok || !createResult.inverse) {
      throw new Error('Node was not created')
    }
    const root = findByLabel(worldOf(app), 'Root')
    const hero = findByLabel(root ?? { children: [] }, 'Hero')
    if (!hero) {
      throw new Error('Hero container not found')
    }

    const result = system.dispatcher.dispatch(
      new DeleteNodeCommand({ nodeId: createResult.inverse.nodeId }),
    )

    expect(result.ok).toBe(true)
    expect(hero.destroyed).toBe(true)
    expect(findByLabel(root ?? { children: [] }, 'Hero')).toBeUndefined()
  })

  it('reparents the display object and its subtree under the new parent display object, in the same turn', async () => {
    const { system, app } = await setup()
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const groupResult = system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Group',
      }),
    )
    const leafResult = system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: slide.scene.root.id,
        name: 'Leaf',
      }),
    )
    if (!groupResult.ok || !leafResult.ok || !groupResult.inverse || !leafResult.inverse) {
      throw new Error('Nodes were not created')
    }
    system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: leafResult.inverse.nodeId,
        name: 'Child',
      }),
    )
    const root = findByLabel(worldOf(app), 'Root')
    if (!root) {
      throw new Error('Root container not found')
    }
    const group = findByLabel(root, 'Group')
    const leaf = findByLabel(root, 'Leaf')
    if (!group || !leaf) {
      throw new Error('Containers not found')
    }
    expect(findByLabel(leaf, 'Child')).toBeDefined()

    const result = system.dispatcher.dispatch(
      new ReparentNodeCommand({
        nodeId: leafResult.inverse.nodeId,
        parentId: groupResult.inverse.nodeId,
      }),
    )

    expect(result.ok).toBe(true)
    expect(findByLabel(root, 'Leaf')).toBeUndefined()
    const rehomed = findByLabel(group, 'Leaf')
    expect(rehomed).toBeDefined()
    expect(findByLabel(rehomed ?? { children: [] }, 'Child')).toBeDefined()
  })

  it('reorders the display objects of siblings immediately after a ChangeZOrder command', async () => {
    const { system, app } = await setup()
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const ids: string[] = []
    for (const name of ['A', 'B', 'C']) {
      const result = system.dispatcher.dispatch(
        new CreateNodeCommand({
          sceneId: slide.scene.id,
          parentId: slide.scene.root.id,
          name,
        }),
      )
      if (!result.ok || !result.inverse) {
        throw new Error('Node was not created')
      }
      ids.push(result.inverse.nodeId)
    }
    const root = findByLabel(worldOf(app), 'Root')
    if (!root) {
      throw new Error('Root container not found')
    }
    expect(root.children.map((child) => child.label)).toEqual(['Camera', 'A', 'B', 'C'])

    const forward = system.dispatcher.dispatch(
      new ChangeZOrderCommand({ nodeId: ids[0], mode: 'bringForward' }),
    )
    expect(forward.ok).toBe(true)
    expect(root.children.map((child) => child.label)).toEqual(['Camera', 'B', 'A', 'C'])

    const front = system.dispatcher.dispatch(
      new ChangeZOrderCommand({ nodeId: ids[0], mode: 'bringToFront' }),
    )
    expect(front.ok).toBe(true)
    expect(root.children.map((child) => child.label)).toEqual(['Camera', 'B', 'C', 'A'])
  })
})
