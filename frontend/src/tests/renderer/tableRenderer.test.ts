import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngine } from '../../engine/internal'
import { CreateProjectCommand, CreateSlideCommand, createCommandSystem } from '../../engine/commands'
import { CreateTableCommand } from '../../engine/commands/tableCommands'
import { pixiRegistry } from './pixiFake'
import { findByLabel, mountRenderer, worldOf } from './testUtils'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
})

function findTablePlaceholder(table: ReturnType<typeof findByLabel>) {
  if (!table) return undefined
  return table.children.find((child) => child.label?.startsWith('table:'))
}

describe('TableRenderer', () => {
  it('rebuilds the table after its rows are created', async () => {
    const system = createCommandSystem()
    system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Demo' }))
    system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide 1' }))
    const slide = system.engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    const { app } = await mountRenderer(system.engine)
    system.dispatcher.dispatch(
      new CreateTableCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id }),
    )

    const root = findByLabel(worldOf(app), 'Root')
    const table = findByLabel(root ?? { children: [] }, 'Table')
    const placeholder = findTablePlaceholder(table)
    const border = placeholder?.children.find((child) => child.kind === 'graphics')

    expect(border?.calls?.find((call) => call.method === 'rect')?.args).toEqual([0, 0, 200, 60])
  })

  it('creates a table container with outer border', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }

    engine.createNode(slide.scene.id, slide.scene.root.id, 'Table', {
      components: {
        table: {
          kind: 'table',
          columns: [{ width: 100 }, { width: 150 }],
          gap: 4,
          borderWidth: 1,
          borderColor: '#000000',
        },
      },
    })

    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    if (!root) {
      throw new Error('Root container not found')
    }

    const table = findByLabel(root, 'Table')
    expect(table).toBeDefined()
    expect(table?.kind).toBe('container')

    const placeholder = findTablePlaceholder(table)
    expect(placeholder).toBeDefined()

    const borderGraphics = placeholder?.children.find((child) => child.kind === 'graphics')
    expect(borderGraphics).toBeDefined()

    const cellContainers = placeholder?.children.filter(
      (child) => child.kind === 'container' && child.label?.startsWith('cell:'),
    )
    expect(cellContainers).toHaveLength(0)
  })

  it('draws outer border with configured width and color', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }

    engine.createNode(slide.scene.id, slide.scene.root.id, 'Table', {
      components: {
        table: {
          kind: 'table',
          columns: [{ width: 100 }],
          gap: 0,
          borderWidth: 2,
          borderColor: '#ff0000',
        },
      },
    })

    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    const table = findByLabel(root ?? { children: [] }, 'Table')
    if (!table) {
      throw new Error('Table container not found')
    }

    const placeholder = findTablePlaceholder(table)
    if (!placeholder) {
      throw new Error('Table placeholder not found')
    }

    const borderGraphics = placeholder.children.find((child) => child.kind === 'graphics')
    expect(borderGraphics).toBeDefined()
    expect(borderGraphics?.ops?.some((op) => op === 'rect')).toBe(true)
    expect(borderGraphics?.ops?.some((op) => op === 'stroke')).toBe(true)
  })

  it('integrates with camera zoom/pan by inheriting parent transforms', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }

    engine.createNode(slide.scene.id, slide.scene.root.id, 'Table', {
      components: {
        table: {
          kind: 'table',
          columns: [{ width: 100 }],
          gap: 0,
          borderWidth: 1,
          borderColor: '#000000',
        },
      },
    })

    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    const table = findByLabel(root ?? { children: [] }, 'Table')
    if (!table) {
      throw new Error('Table container not found')
    }

    expect(table?.position).toBeDefined()
    expect(table?.scale).toBeDefined()
    expect(table?.rotation).toBe(0)
  })

  it('re-renders border when a new table node is created after initial render', async () => {
    const engine = createEngine()
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
    const { app } = await mountRenderer(engine)
    const root = findByLabel(worldOf(app), 'Root')
    if (!root) {
      throw new Error('Root container not found')
    }

    expect(findByLabel(root, 'Table')).toBeUndefined()

    const slide = engine.project?.slides[0]
    if (!slide) {
      throw new Error('Slide was not created')
    }
    engine.createNode(slide.scene.id, slide.scene.root.id, 'Table', {
      components: {
        table: {
          kind: 'table',
          columns: [{ width: 100 }],
          gap: 0,
          borderWidth: 1,
          borderColor: '#000000',
        },
      },
    })

    const table = findByLabel(root, 'Table')
    expect(table).toBeDefined()

    const placeholder = findTablePlaceholder(table)
    const borderGraphics = placeholder?.children.find((child) => child.kind === 'graphics')
    expect(borderGraphics).toBeDefined()
  })
})
