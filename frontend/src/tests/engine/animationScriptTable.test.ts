import { describe, expect, it } from 'vitest'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateTableCommand,
  SetSlideAnimationScriptCommand,
  SetTableCellComponentCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { Command, DispatchCommand } from '../../engine/commands'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { runAnimationScript } from '../../engine/animationScriptRun'
import type { TableAnimationProperty } from '../../engine/animationProperties'
import { defaultTableCellComponent } from '../../engine/defaultTable'

type System = ReturnType<typeof createCommandSystem>

function setup() {
  const system = createCommandSystem(() => {})
  dispatchOk(system, new CreateProjectCommand({ name: 'Lesson' }))
  dispatchOk(system, new CreateSlideCommand({ name: 'Slide 1' }))
  const slide = system.engine.getActiveSlide()
  if (!slide) throw new Error('expected an active slide')
  return { system, slideId: slide.id }
}

function dispatchOk<T>(system: System, command: Command<T>): T {
  const result = system.dispatcher.dispatch(command)
  if (!result.ok) throw new Error(`command failed: ${result.error.message}`)
  return result.inverse as T
}

function boundDispatch(system: System): DispatchCommand {
  return (command) => system.dispatcher.dispatch(command)
}

function addNode(system: System, slideId: string, name: string, semanticName?: string): string {
  const slide = system.engine.getSlide(slideId)
  return dispatchOk(
    system,
    new CreateNodeCommand({
      sceneId: slide.scene.id,
      parentId: slide.scene.root.id,
      name,
      ...(semanticName !== undefined && { semanticName }),
    }),
  ).nodeId
}

function addTableCellNode(system: System, slideId: string, name: string, semanticName?: string) {
  const slide = system.engine.getSlide(slideId)
  return dispatchOk(
    system,
    new CreateNodeCommand({
      sceneId: slide.scene.id,
      parentId: slide.scene.root.id,
      name,
      ...(semanticName !== undefined && { semanticName }),
      components: { tableCell: defaultTableCellComponent() },
    }),
  ).nodeId
}

function addTable(system: System, slideId: string) {
  const slide = system.engine.getSlide(slideId)
  const { tableNodeId } = dispatchOk(
    system,
    new CreateTableCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id }),
  )
  const table = system.engine.getNode(tableNodeId)
  const rows = [...table.children]
  const cells = rows.flatMap((row) =>
    [...row.children].filter((child) => child.components.tableCell),
  )
  return { tableId: tableNodeId, rows, cells }
}

function setCellSpan(system: System, cellId: string, colSpan: number, rowSpan: number): void {
  dispatchOk(
    system,
    new SetTableCellComponentCommand({
      nodeId: cellId,
      tableCell: { kind: 'tableCell', colSpan, rowSpan },
    }),
  )
}

function runOk(system: System, slideId: string, source: string) {
  const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
  expect(result.error).toBeNull()
  expect(result.ran).toBe(true)
  return result
}

function tableTrack(system: System, nodeId: string, property: TableAnimationProperty) {
  return system.engine.getTableKeyframes(nodeId, property).map((keyframe) => ({
    time: keyframe.time,
    value: keyframe.value,
    interpolation: keyframe.interpolation,
  }))
}

function propertyTrack(
  system: System,
  nodeId: string,
  property: 'positionX' | 'positionY' | 'opacity',
) {
  return system.engine.getKeyframes(nodeId, property).map((keyframe) => ({
    time: keyframe.time,
    value: keyframe.value,
    interpolation: keyframe.interpolation,
  }))
}

describe('Animation Script tables — structural addressing', () => {
  it('resolves table.cell(r, c) to the cell node at that Grid Slot and tweens its table styles', () => {
    const { system, slideId } = setup()
    const { cells } = addTable(system, slideId)
    const source = [
      'script "Style" from 0.5',
      'bind conj = table("Table")',
      'conj.cell(1, 0).tween({ borderRadius: 12, padding: 4 }, 0.5)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runOk(system, slideId, source)

    expect(result.diagnostics).toEqual([])
    expect(result.summary.tracks.map((track) => `${track.nodeName}.${track.property}`)).toEqual([
      'Cell 2,1.borderRadius',
      'Cell 2,1.padding',
    ])
    expect(tableTrack(system, cells[2].id, 'borderRadius')).toEqual([
      { time: 0.5, value: 0, interpolation: 'bezier' },
      { time: 1, value: 12, interpolation: 'bezier' },
    ])
    expect(tableTrack(system, cells[2].id, 'padding')).toEqual([
      { time: 0.5, value: 0, interpolation: 'bezier' },
      { time: 1, value: 4, interpolation: 'bezier' },
    ])
    expect(system.engine.evaluateTable(cells[2].id, 0.5)?.borderRadius).toBe(0)
    expect(system.engine.evaluateTable(cells[2].id, 1)?.borderRadius).toBe(12)
    expect(system.engine.evaluateTable(cells[2].id, 1)?.padding).toBe(4)
  })

  it('writes a table binding to the table node itself, pinning at from on a later statement', () => {
    const { system, slideId } = setup()
    const { tableId } = addTable(system, slideId)
    const source = [
      'script "Style" from 0',
      'bind conj = table("Table")',
      'wait(0.5)',
      'conj.set({ borderRadius: 4 })',
      'conj.tween({ padding: 6 }, 0.5)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runOk(system, slideId, source)

    expect(result.diagnostics).toEqual([])
    expect(result.summary.tracks.map((track) => `${track.nodeName}.${track.property}`)).toEqual([
      'Table.borderRadius',
      'Table.padding',
    ])
    expect(tableTrack(system, tableId, 'borderRadius')).toEqual([
      { time: 0, value: 0, interpolation: 'hold' },
      { time: 0.5, value: 4, interpolation: 'hold' },
    ])
    expect(tableTrack(system, tableId, 'padding')).toEqual([
      { time: 0, value: 0, interpolation: 'hold' },
      { time: 0.5, value: 0, interpolation: 'bezier' },
      { time: 1, value: 6, interpolation: 'bezier' },
    ])
    expect(system.engine.evaluateTable(tableId, 1)?.borderRadius).toBe(4)
    expect(system.engine.evaluateTable(tableId, 1)?.padding).toBe(6)
  })

  it('holds on set and lerps on tween according to kind', () => {
    const { system, slideId } = setup()
    const { tableId, cells } = addTable(system, slideId)
    const source = [
      'script "Style" from 0',
      'bind conj = table("Table")',
      'conj.set({ borderRadius: 4 })',
      'conj.cell(0, 0).tween({ padding: 5 }, 0.4)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    runOk(system, slideId, source)

    expect(tableTrack(system, tableId, 'borderRadius')).toEqual([
      { time: 0, value: 4, interpolation: 'hold' },
    ])
    expect(tableTrack(system, cells[0].id, 'padding')).toEqual([
      { time: 0, value: 0, interpolation: 'bezier' },
      { time: 0.4, value: 5, interpolation: 'bezier' },
    ])
  })

  it('resolves every Grid Slot a spanning cell covers to that one cell node', () => {
    const { system, slideId } = setup()
    const { cells } = addTable(system, slideId)
    setCellSpan(system, cells[0].id, 2, 1)
    const source = [
      'script "Span" from 0',
      'bind conj = table("Table")',
      'conj.cell(0, 1).set({ borderRadius: 3 })',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runOk(system, slideId, source)

    expect(result.diagnostics).toEqual([])
    expect(result.summary.tracks.map((track) => track.nodeName)).toEqual(['Cell 1,1'])
    expect(tableTrack(system, cells[0].id, 'borderRadius')).toEqual([
      { time: 0, value: 3, interpolation: 'hold' },
    ])
    expect(system.engine.evaluateTable(cells[0].id, 0)?.borderRadius).toBe(3)
  })

  it('writes a row-spanning cell exactly once, in its origin row group only', () => {
    const { system, slideId } = setup()
    const { cells } = addTable(system, slideId)
    setCellSpan(system, cells[0].id, 1, 2)
    const source = [
      'script "Span" from 0',
      'bind conj = table("Table")',
      'conj.row(0).set({ padding: 2 })',
      'conj.row(1).set({ padding: 5 })',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runOk(system, slideId, source)

    expect(result.diagnostics).toEqual([])
    expect(result.summary.tracks.map((track) => `${track.nodeName}.${track.property}`)).toEqual([
      'Cell 1,1.padding',
      'Cell 1,2.padding',
      'Cell 2,1.padding',
    ])
    expect(tableTrack(system, cells[0].id, 'padding')).toEqual([
      { time: 0, value: 2, interpolation: 'hold' },
    ])
    expect(tableTrack(system, cells[1].id, 'padding')).toEqual([
      { time: 0, value: 2, interpolation: 'hold' },
    ])
    expect(tableTrack(system, cells[2].id, 'padding')).toEqual([
      { time: 0, value: 5, interpolation: 'hold' },
    ])
    expect(tableTrack(system, cells[3].id, 'padding')).toEqual([])
  })

  it('resolves a cell spanning both axes once, outside the rows and columns it covers', () => {
    const { system, slideId } = setup()
    const { cells } = addTable(system, slideId)
    setCellSpan(system, cells[0].id, 2, 2)
    const source = [
      'script "Span" from 0',
      'bind conj = table("Table")',
      'conj.cell(1, 1).set({ borderRadius: 6 })',
      'conj.row(0).set({ padding: 1 })',
      'conj.col(1).set({ padding: 2 })',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runOk(system, slideId, source)

    expect(result.diagnostics).toEqual([])
    expect(result.summary.tracks.map((track) => `${track.nodeName}.${track.property}`)).toEqual([
      'Cell 1,1.borderRadius',
      'Cell 1,1.padding',
      'Cell 2,1.padding',
    ])
    expect(tableTrack(system, cells[0].id, 'borderRadius')).toEqual([
      { time: 0, value: 6, interpolation: 'hold' },
    ])
    expect(tableTrack(system, cells[0].id, 'padding')).toEqual([
      { time: 0, value: 1, interpolation: 'hold' },
    ])
    expect(tableTrack(system, cells[2].id, 'padding')).toEqual([
      { time: 0, value: 2, interpolation: 'hold' },
    ])
    expect(tableTrack(system, cells[1].id, 'padding')).toEqual([])
    expect(tableTrack(system, cells[3].id, 'padding')).toEqual([])
  })

  it('broadcasts col members deterministically in engine layout order', () => {
    const { system, slideId } = setup()
    const { cells } = addTable(system, slideId)
    setCellSpan(system, cells[0].id, 2, 1)
    const source = [
      'script "Span" from 0',
      'bind conj = table("Table")',
      'conj.col(0).set({ padding: 1 })',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runOk(system, slideId, source)

    expect(result.diagnostics).toEqual([])
    expect(result.summary.tracks.map((track) => track.nodeName)).toEqual([
      'Cell 1,1',
      'Cell 1,2',
      'Cell 2,2',
    ])
    expect(tableTrack(system, cells[0].id, 'padding')).toEqual([
      { time: 0, value: 1, interpolation: 'hold' },
    ])
    expect(tableTrack(system, cells[1].id, 'padding')).toEqual([
      { time: 0, value: 1, interpolation: 'hold' },
    ])
    expect(tableTrack(system, cells[2].id, 'padding')).toEqual([])
    expect(tableTrack(system, cells[3].id, 'padding')).toEqual([
      { time: 0, value: 1, interpolation: 'hold' },
    ])
  })

  it('places and broadcasts a table selector inside at() and parallel', () => {
    const { system, slideId } = setup()
    const { cells } = addTable(system, slideId)
    const source = [
      'script "Compose" from 0',
      'bind conj = table("Table")',
      'parallel {',
      '  at(0.25) conj.cell(0, 0).set({ borderRadius: 2 })',
      '  conj.row(0).set({ padding: 7 })',
      '}',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runOk(system, slideId, source)

    expect(result.diagnostics).toEqual([])
    expect(tableTrack(system, cells[0].id, 'borderRadius')).toEqual([
      { time: 0, value: 0, interpolation: 'hold' },
      { time: 0.25, value: 2, interpolation: 'hold' },
    ])
    expect(tableTrack(system, cells[0].id, 'padding')).toEqual([
      { time: 0, value: 7, interpolation: 'hold' },
    ])
  })

  it('replaces its own table output on a re-run without duplicating it', () => {
    const { system, slideId } = setup()
    const { cells } = addTable(system, slideId)
    const source = [
      'script "Style" from 0.5',
      'bind conj = table("Table")',
      'conj.cell(0, 0).tween({ borderRadius: 9, padding: 3 }, 0.5)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    runOk(system, slideId, source)
    const first = {
      borderRadius: tableTrack(system, cells[0].id, 'borderRadius'),
      padding: tableTrack(system, cells[0].id, 'padding'),
    }

    runOk(system, slideId, source)

    expect(tableTrack(system, cells[0].id, 'borderRadius')).toEqual(first.borderRadius)
    expect(tableTrack(system, cells[0].id, 'padding')).toEqual(first.padding)
    expect(tableTrack(system, cells[0].id, 'borderRadius')).toHaveLength(2)
    expect(tableTrack(system, cells[0].id, 'padding')).toHaveLength(2)
  })

  it('animates cell and table transforms like any other node target', () => {
    const { system, slideId } = setup()
    const { tableId, cells } = addTable(system, slideId)
    const source = [
      'script "Move" from 0',
      'bind conj = table("Table")',
      'conj.cell(0, 0).tween({ x: 3, opacity: 0.5 }, 0.4)',
      'conj.tween({ y: 2 }, 0.4)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runOk(system, slideId, source)

    expect(result.diagnostics).toEqual([])
    expect(propertyTrack(system, cells[0].id, 'positionX')).toEqual([
      { time: 0, value: 0, interpolation: 'bezier' },
      { time: 0.4, value: 3, interpolation: 'bezier' },
    ])
    expect(propertyTrack(system, cells[0].id, 'opacity')).toEqual([
      { time: 0, value: 1, interpolation: 'bezier' },
      { time: 0.4, value: 0.5, interpolation: 'bezier' },
    ])
    expect(propertyTrack(system, tableId, 'positionY')).toEqual([
      { time: 0, value: 0, interpolation: 'hold' },
      { time: 0.4, value: 0, interpolation: 'bezier' },
      { time: 0.8, value: 2, interpolation: 'bezier' },
    ])
  })

  it('treats a table row node bound by name as an ordinary node', () => {
    const { system, slideId } = setup()
    const { rows } = addTable(system, slideId)
    const source = [
      'script "Rows" from 0',
      'bind head = node("Row 1")',
      'head.tween({ x: 5 }, 0.2)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const result = runOk(system, slideId, source)

    expect(result.diagnostics).toEqual([])
    expect(propertyTrack(system, rows[0].id, 'positionX')).toEqual([
      { time: 0, value: 0, interpolation: 'bezier' },
      { time: 0.2, value: 5, interpolation: 'bezier' },
    ])
  })
})

describe('Animation Script tables — diagnostics', () => {
  function errorOf(result: ReturnType<typeof checkAnimationScript>) {
    expect(result.runnable).toBe(false)
    return result.diagnostics.find((diagnostic) => diagnostic.severity === 'error')
  }

  it('errors when table() names a missing node or a node without a table component', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const missing = checkAnimationScript(
      system.engine,
      slideId,
      ['script "T" from 0', 'bind ghost = table("Ghost")', 'ghost.set({ x: 1 })'].join('\n'),
    )
    expect(errorOf(missing)?.message).toMatch(/No node named "Ghost"/)

    const notATable = checkAnimationScript(
      system.engine,
      slideId,
      ['script "T" from 0', 'bind hero = table("Hero")', 'hero.set({ x: 1 })'].join('\n'),
    )
    expect(errorOf(notATable)?.message).toMatch(/is not a table/)
  })

  it('errors on an out-of-range Grid Slot or one that holds no cell', () => {
    const { system, slideId } = setup()
    const { cells } = addTable(system, slideId)
    setCellSpan(system, cells[0].id, 2, 1)

    const outOfRange = checkAnimationScript(
      system.engine,
      slideId,
      [
        'script "T" from 0',
        'bind conj = table("Table")',
        'conj.cell(3, 0).set({ borderRadius: 1 })',
      ].join('\n'),
    )
    const outOfRangeError = errorOf(outOfRange)
    expect(outOfRangeError?.message).toMatch(/out of range/)
    expect(outOfRangeError?.message).toContain('(3, 0)')

    const empty = checkAnimationScript(
      system.engine,
      slideId,
      [
        'script "T" from 0',
        'bind conj = table("Table")',
        'conj.cell(2, 1).set({ borderRadius: 1 })',
      ].join('\n'),
    )
    expect(errorOf(empty)?.message).toMatch(/holds no cell/)
  })

  it('errors on row and col indices outside the layout or with no cells', () => {
    const { system, slideId } = setup()
    const { cells } = addTable(system, slideId)

    const row = checkAnimationScript(
      system.engine,
      slideId,
      ['script "T" from 0', 'bind conj = table("Table")', 'conj.row(7).set({ padding: 1 })'].join(
        '\n',
      ),
    )
    expect(errorOf(row)?.message).toMatch(/Row 7 is out of range/)

    const col = checkAnimationScript(
      system.engine,
      slideId,
      ['script "T" from 0', 'bind conj = table("Table")', 'conj.col(7).set({ padding: 1 })'].join(
        '\n',
      ),
    )
    expect(errorOf(col)?.message).toMatch(/Column 7 is out of range/)

    setCellSpan(system, cells[0].id, 2, 2)
    const coveredRow = checkAnimationScript(
      system.engine,
      slideId,
      ['script "T" from 0', 'bind conj = table("Table")', 'conj.row(1).set({ padding: 1 })'].join(
        '\n',
      ),
    )
    expect(errorOf(coveredRow)?.message).toMatch(/Row 1 of table "Table" has no cells/)

    for (const cell of cells.slice(1)) setCellSpan(system, cell.id, 2, 1)
    const coveredColumn = checkAnimationScript(
      system.engine,
      slideId,
      ['script "T" from 0', 'bind conj = table("Table")', 'conj.col(1).set({ padding: 1 })'].join(
        '\n',
      ),
    )
    expect(errorOf(coveredColumn)?.message).toMatch(/Column 1 of table "Table" has no cells/)
  })

  it('errors on a selector used on a non-table binding and on an unknown selector', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    addTable(system, slideId)

    const nodeSelector = checkAnimationScript(
      system.engine,
      slideId,
      ['script "T" from 0', 'bind hero = node("Hero")', 'hero.cell(0, 0).set({ x: 1 })'].join('\n'),
    )
    expect(errorOf(nodeSelector)?.message).toMatch(/need a table\("\.\.\."\) binding/)

    const unknown = checkAnimationScript(
      system.engine,
      slideId,
      ['script "T" from 0', 'bind conj = table("Table")', 'conj.diagonal(0).set({ x: 1 })'].join(
        '\n',
      ),
    )
    expect(errorOf(unknown)?.message).toMatch(/Unknown table selector "diagonal"/)
  })

  it('errors on wrong selector arity and non-whole indices', () => {
    const { system, slideId } = setup()
    addTable(system, slideId)

    const arity = checkAnimationScript(
      system.engine,
      slideId,
      ['script "T" from 0', 'bind conj = table("Table")', 'conj.cell(0).set({ x: 1 })'].join('\n'),
    )
    expect(errorOf(arity)?.message).toMatch(/cell needs a row and a column/)

    const fraction = checkAnimationScript(
      system.engine,
      slideId,
      ['script "T" from 0', 'bind conj = table("Table")', 'conj.row(0.5).set({ x: 1 })'].join('\n'),
    )
    expect(errorOf(fraction)?.message).toMatch(/whole number/)
  })

  it('errors on table style writes to a node or group member without a table component', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const onNode = checkAnimationScript(
      system.engine,
      slideId,
      ['script "T" from 0', 'bind hero = node("Hero")', 'hero.set({ borderRadius: 2 })'].join('\n'),
    )
    expect(errorOf(onNode)?.message).toMatch(/Only table and table cell nodes/)

    const cell = addTableCellNode(system, slideId, 'Limb Cell', 'limb')
    addNode(system, slideId, 'Spine', 'limb')
    const onGroup = checkAnimationScript(
      system.engine,
      slideId,
      ['script "T" from 0', 'bind limbs = group("limb")', 'limbs.set({ padding: 2 })'].join('\n'),
    )
    expect(onGroup.runnable).toBe(false)
    expect(errorOf(onGroup)?.message).toMatch(/Member "Spine"/)
    expect(system.engine.getTableKeyframes(cell, 'padding')).toHaveLength(0)

    const negative = checkAnimationScript(
      system.engine,
      slideId,
      ['script "T" from 0', 'bind hero = node("Hero")', 'hero.set({ borderRadius: -1 })'].join(
        '\n',
      ),
    )
    expect(errorOf(negative)?.message).toMatch(/non-negative/)
  })
})
