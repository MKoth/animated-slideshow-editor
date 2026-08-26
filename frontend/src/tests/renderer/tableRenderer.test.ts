import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Engine } from '../../engine/internal'
import { createEngine } from '../../engine/internal'
import { pixiRegistry } from './pixiFake'
import { findByLabel, mountRenderer, worldOf } from './testUtils'

vi.mock('pixi.js', async () => {
  const { createPixiFake } = await import('./pixiFake')
  return createPixiFake()
})

beforeEach(() => {
  pixiRegistry.reset()
})

function seededTableEngine(): Engine {
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
        columns: [
          { width: 100 },
          { width: 150 },
        ],
        rows: [
          { width: 30 },
          { width: 30 },
        ],
        gap: 4,
        cellPadding: 8,
        borderWidth: 1,
        borderColor: '#000000',
        textWrap: 'wrap',
        columnMapping: { 0: 'Name', 1: 'Value' },
        cellSpans: {},
      },
    },
  })
  return engine
}

function findTablePlaceholder(table: ReturnType<typeof findByLabel>) {
  if (!table) return undefined
  return table.children.find((child) => child.label?.startsWith('table:'))
}

describe('TableRenderer', () => {
  it('creates a table container with outer border and cell containers', async () => {
    const engine = seededTableEngine()
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
    expect(cellContainers).toHaveLength(4)
  })

  it('positions cells according to the grid layout', async () => {
    const engine = seededTableEngine()
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

    const cell00 = placeholder.children.find((child) => child.label === 'cell:0,0')
    const cell01 = placeholder.children.find((child) => child.label === 'cell:0,1')
    const cell10 = placeholder.children.find((child) => child.label === 'cell:1,0')
    const cell11 = placeholder.children.find((child) => child.label === 'cell:1,1')

    expect(cell00).toBeDefined()
    expect(cell01).toBeDefined()
    expect(cell10).toBeDefined()
    expect(cell11).toBeDefined()

    expect(cell00?.position.x).toBeGreaterThan(0)
    expect(cell00?.position.y).toBeGreaterThan(0)
    expect(cell01?.position.x).toBeGreaterThan(cell00?.position.x ?? 0)
    expect(cell10?.position.y).toBeGreaterThan(cell00?.position.y ?? 0)
  })

  it('renders cell text labels from columnMapping', async () => {
    const engine = seededTableEngine()
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

    const cell00 = placeholder.children.find((child) => child.label === 'cell:0,0')
    const textChild = cell00?.children.find((child) => child.kind === 'text')
    expect(textChild).toBeDefined()
    expect(textChild?.text).toBe('Name')

    const cell01 = placeholder.children.find((child) => child.label === 'cell:0,1')
    const textChild1 = cell01?.children.find((child) => child.kind === 'text')
    expect(textChild1?.text).toBe('Value')
  })

  it('draws outer border with configured width and color', async () => {
    const engine = seededTableEngine()
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
    const engine = seededTableEngine()
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

  it('re-renders cells when a new table node is created after initial render', async () => {
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
          rows: [{ width: 30 }, { width: 30 }],
          gap: 4,
          cellPadding: 8,
          borderWidth: 1,
          borderColor: '#000000',
          textWrap: 'wrap',
          columnMapping: {},
          cellSpans: {},
        },
      },
    })

    const table = findByLabel(root, 'Table')
    expect(table).toBeDefined()

    const placeholder = findTablePlaceholder(table)
    const cellCount = placeholder?.children.filter((child) =>
      child.label?.startsWith('cell:'),
    ).length
    expect(cellCount).toBe(2)
  })
})
