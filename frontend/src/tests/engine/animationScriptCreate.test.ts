import { describe, expect, it } from 'vitest'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  SetSlideAnimationScriptCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { DispatchCommand } from '../../engine/commands'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { runAnimationScript, runAnimationScriptAsync } from '../../engine/animationScriptRun'
import { walkPreOrder } from '../../engine/sceneNode'
import type { SceneNode } from '../../engine/sceneNode'
import type { EmbeddedAsset } from '../../engine/embeddedAsset'

type System = ReturnType<typeof createCommandSystem>

function setup() {
  const system = createCommandSystem(() => {})
  dispatchOk(system, new CreateProjectCommand({ name: 'Lesson' }))
  dispatchOk(system, new CreateSlideCommand({ name: 'Slide 1' }))
  const slide = system.engine.getActiveSlide()
  if (!slide) throw new Error('expected an active slide')
  // A Run records its footprint on the slide, which needs a script to exist.
  dispatchOk(
    system,
    new SetSlideAnimationScriptCommand({ slideId: slide.id, source: 'script "Seed" from 0' }),
  )
  return { system, slideId: slide.id }
}

function dispatchOk(system: System, command: Parameters<System['dispatcher']['dispatch']>[0]) {
  const result = system.dispatcher.dispatch(command)
  if (!result.ok) throw new Error(`command failed: ${result.error.message}`)
  return result.inverse
}

function boundDispatch(system: System): DispatchCommand {
  return (command) => system.dispatcher.dispatch(command)
}

function addNode(system: System, slideId: string, name: string): string {
  const slide = system.engine.getSlide(slideId)
  const result = system.dispatcher.dispatch(
    new CreateNodeCommand({ sceneId: slide.scene.id, parentId: slide.scene.root.id, name }),
  )
  if (!result.ok) throw new Error(`create node failed: ${result.error.message}`)
  return (result.inverse as { nodeId: string }).nodeId
}

function runOk(system: System, slideId: string, source: string) {
  const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
  if (!result.ran) {
    throw new Error(
      `run blocked: ${result.error ?? ''} ${result.diagnostics.map((d) => `${d.line}:${d.column} ${d.message}`).join('; ')}`,
    )
  }
  return result
}

function nodesNamed(system: System, slideId: string, name: string): SceneNode[] {
  const slide = system.engine.getSlide(slideId)
  return [...walkPreOrder(slide.scene.root)].filter((node) => node.name === name)
}

function nodeNamed(system: System, slideId: string, name: string): SceneNode {
  const matches = nodesNamed(system, slideId, name)
  if (matches.length !== 1) throw new Error(`expected one "${name}", found ${matches.length}`)
  return matches[0]
}

function positionX(system: System, nodeId: string): number[] {
  return system.engine.getKeyframes(nodeId, 'positionX').map((keyframe) => keyframe.value as number)
}

function circleImageData(size = 64): ImageData {
  const data = new Uint8ClampedArray(size * size * 4)
  const center = size / 2
  const radius = size * 0.4
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = (x - center) ** 2 + (y - center) ** 2 <= radius ** 2
      const offset = (y * size + x) * 4
      data[offset] = 10
      data[offset + 1] = 20
      data[offset + 2] = 30
      data[offset + 3] = inside ? 255 : 0
    }
  }
  return { data, width: size, height: size } as ImageData
}

const TEXT_SCRIPT = [
  'script "Builder" from 0',
  'create text "Title" as title at (100, 50) { content: "Hello", fontSize: 30 }',
  'title.tween({ x: 200 }, 1)',
].join('\n')

describe('Animation Script create — text, table, asset, data, chart', () => {
  it('creates and text-animates a text node in one Transaction', () => {
    const { system, slideId } = setup()
    const result = runOk(system, slideId, TEXT_SCRIPT)

    expect(result.summary.createdNodeCount).toBe(1)
    const node = nodeNamed(system, slideId, 'Title')
    expect(node.components.text?.content).toBe('Hello')
    expect(node.components.text?.fontSize).toBe(30)
    expect(node.transform.x).toBe(100)
    expect(node.transform.y).toBe(50)
    expect(positionX(system, node.id)).toEqual([100, 200])
  })

  it('changes created text content via setText inside the same run', () => {
    const { system, slideId } = setup()
    const source = [
      'script "Builder" from 0',
      'create text "Title" as title { content: "Hello" }',
      'setText(title, "Changed")',
    ].join('\n')
    runOk(system, slideId, source)
    expect(nodeNamed(system, slideId, 'Title').components.text?.content).toBe('Changed')
  })

  it('reads the declared initial values of a created node', () => {
    const { system, slideId } = setup()
    const source = [
      'script "Builder" from 0',
      'create text "Title" as title at (10, 20) {}',
      'let x0 = title.x',
      'title.set({ x: x0 + 5 })',
    ].join('\n')
    runOk(system, slideId, source)
    expect(positionX(system, nodeNamed(system, slideId, 'Title').id)).toEqual([15])
  })

  it('reports worldAt/bounds on a created node as unavailable', () => {
    const { system, slideId } = setup()
    const source = [
      'script "Builder" from 0',
      'create text "Title" as title at (10, 20) {}',
      'let w = worldAt(title, 0)',
    ].join('\n')
    const checked = checkAnimationScript(system.engine, slideId, source)
    expect(checked.runnable).toBe(false)
    expect(
      checked.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('no pre-run scene state'),
      ),
    ).toBe(true)
  })

  it('replaces its own created text on re-run instead of duplicating it', () => {
    const { system, slideId } = setup()
    runOk(system, slideId, TEXT_SCRIPT)
    const sourceV2 = [
      'script "Builder" from 0',
      'create text "Title" as title at (100, 50) { content: "V2" }',
    ].join('\n')
    runOk(system, slideId, sourceV2)

    expect(nodesNamed(system, slideId, 'Title')).toHaveLength(1)
    expect(nodeNamed(system, slideId, 'Title').components.text?.content).toBe('V2')
    const footprint = system.engine.getSlide(slideId).animationScript?.lastCompiled
    expect(footprint?.createdNodes).toHaveLength(1)
  })

  it('replaces its own created table subtree on re-run instead of failing', () => {
    const { system, slideId } = setup()
    const source = [
      'script "Builder" from 0',
      'create table "Grid" as grid { columns: [100], rows: [["A"], ["B"]] }',
    ].join('\n')
    runOk(system, slideId, source)

    const second = runAnimationScript(system.engine, boundDispatch(system), slideId, source)

    expect(second.error).toBeNull()
    expect(second.ran).toBe(true)
    expect(nodesNamed(system, slideId, 'Grid')).toHaveLength(1)
    expect(nodesNamed(system, slideId, 'Cell 2,1')).toHaveLength(1)
  })

  it('chains a fadeOut after a fadeIn from the faded-in value on a created node', () => {
    const { system, slideId } = setup()
    const source = [
      'script "Builder" from 0',
      'create text "Title" as title { content: "Hello", opacity: 0 }',
      'at(0.8) title.fadeIn(1)',
      'at(4) title.fadeOut(1)',
    ].join('\n')
    runOk(system, slideId, source)
    const title = nodeNamed(system, slideId, 'Title')

    const opacityAt = (time: number) => system.engine.evaluateNode(title.id, time).opacity

    expect(opacityAt(0.8)).toBeCloseTo(0, 6)
    expect(opacityAt(1.8)).toBe(1)
    // The fade-in's end value holds until the fade-out starts, and the
    // fade-out then runs from 1 down to 0.
    expect(opacityAt(3)).toBe(1)
    expect(opacityAt(4)).toBe(1)
    expect(opacityAt(4.5)).toBeCloseTo(0.5, 5)
    expect(opacityAt(5)).toBe(0)
  })

  it('creates an empty group and places child creates inside it', () => {
    const { system, slideId } = setup()
    const source = [
      'script "Builder" from 0',
      'create group "Board" as board at (10, 20) { opacity: 0.5 }',
      'create text "Title" as title at (5, 5) inside board { content: "Hello" }',
      'create group "Inner" as inner inside board',
      'create text "Deep" as deep at (1, 1) inside inner { content: "Deep" }',
    ].join('\n')
    const result = runOk(system, slideId, source)

    expect(result.summary.createdNodeCount).toBe(4)
    const board = nodeNamed(system, slideId, 'Board')
    expect(board.components.text).toBeUndefined()
    expect(board.components.assetInstance).toBeUndefined()
    expect(board.transform.x).toBe(10)
    expect(board.transform.y).toBe(20)
    expect(board.opacity).toBe(0.5)
    const title = nodeNamed(system, slideId, 'Title')
    const inner = nodeNamed(system, slideId, 'Inner')
    const deep = nodeNamed(system, slideId, 'Deep')
    expect(title.parent?.id).toBe(board.id)
    expect(inner.parent?.id).toBe(board.id)
    expect(deep.parent?.id).toBe(inner.id)
  })

  it('replaces a group and its whole subtree on re-run', () => {
    const { system, slideId } = setup()
    const source = [
      'script "Builder" from 0',
      'create group "Board" as board',
      'create text "Title" as title inside board { content: "V1" }',
    ].join('\n')
    runOk(system, slideId, source)
    const v2 = source.replace('"V1"', '"V2"')

    runOk(system, slideId, v2)

    expect(nodesNamed(system, slideId, 'Board')).toHaveLength(1)
    expect(nodesNamed(system, slideId, 'Title')).toHaveLength(1)
    expect(nodeNamed(system, slideId, 'Title').components.text?.content).toBe('V2')
  })

  it('rejects unknown group properties with a near-miss diagnostic', () => {
    const { system, slideId } = setup()
    const checked = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Builder" from 0', 'create group "Board" { colour: "black" }'].join('\n'),
    )
    expect(checked.runnable).toBe(false)
    expect(
      checked.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('Unknown group property "colour"'),
      ),
    ).toBe(true)
  })

  const TABLE_WITH_CELL_TEXT = [
    'script "Builder" from 0',
    'create table "Grid" as grid { columns: [100, 100], rows: [["", ""], ["", ""]] }',
    'create text "Note a" as noteA inside grid.cell(0, 0) { content: "In cell" }',
    'create text "Note b" as noteB inside grid.cell(1, 1) { content: "In cell too" }',
  ].join('\n')

  it('replaces a created table holding created cell text on re-run', () => {
    const { system, slideId } = setup()
    runOk(system, slideId, TABLE_WITH_CELL_TEXT)

    const second = runAnimationScript(
      system.engine,
      boundDispatch(system),
      slideId,
      TABLE_WITH_CELL_TEXT,
    )

    expect(second.error).toBeNull()
    expect(second.ran).toBe(true)
    expect(nodesNamed(system, slideId, 'Grid')).toHaveLength(1)
    expect(nodesNamed(system, slideId, 'Note a')).toHaveLength(1)
    // The stale previous run's cells must not shift the grid: each note stays
    // in the cell its selector named.
    expect(nodeNamed(system, slideId, 'Note a').parent?.name).toBe('Cell 1,1')
    expect(nodeNamed(system, slideId, 'Note b').parent?.name).toBe('Cell 2,2')
  })

  it('replaces a created table holding created cell text after a save/reload round trip', () => {
    const { system, slideId } = setup()
    runOk(system, slideId, TABLE_WITH_CELL_TEXT)

    system.engine.restoreFromJSON(system.engine.toJSON())
    const second = runAnimationScript(
      system.engine,
      boundDispatch(system),
      slideId,
      TABLE_WITH_CELL_TEXT,
    )

    expect(second.error).toBeNull()
    expect(second.ran).toBe(true)
    expect(nodesNamed(system, slideId, 'Grid')).toHaveLength(1)
    expect(nodeNamed(system, slideId, 'Note a').parent?.name).toBe('Cell 1,1')
    expect(nodeNamed(system, slideId, 'Note b').parent?.name).toBe('Cell 2,2')
  })

  it('undo removes the created subtree in one step', () => {
    const { system, slideId } = setup()
    runOk(system, slideId, TEXT_SCRIPT)
    expect(nodesNamed(system, slideId, 'Title')).toHaveLength(1)

    expect(system.dispatcher.undo()).toBe(true)
    expect(nodesNamed(system, slideId, 'Title')).toHaveLength(0)
  })

  it('rejects unknown create properties with a near-miss diagnostic', () => {
    const { system, slideId } = setup()
    const source = ['script "Builder" from 0', 'create text "Title" { colour: "red" }'].join('\n')
    const checked = checkAnimationScript(system.engine, slideId, source)
    expect(checked.runnable).toBe(false)
    expect(
      checked.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('Unknown text property'),
      ),
    ).toBe(true)
  })

  it('creates a table with rows, cells and text, and addresses a cell', () => {
    const { system, slideId } = setup()
    const source = [
      'script "Builder" from 0',
      'create table "Grid" as grid at (0, 0) { columns: [100, "auto"], rows: [["A", "B"], ["C", "D"]] }',
      'grid.cell(1, 1).set({ opacity: 0.5 })',
    ].join('\n')
    const result = runOk(system, slideId, source)
    expect(result.summary.createdNodeCount).toBe(1 + 2 + 4 + 4)

    const table = nodeNamed(system, slideId, 'Grid')
    expect(table.components.table?.columns).toHaveLength(2)
    expect(table.children).toHaveLength(2)
    const cell = table.children[1].children[1]
    expect(cell.children[0].components.text?.content).toBe('D')
    expect(system.engine.getKeyframes(cell.id, 'opacity').map((k) => k.value)).toEqual([0.5])
  })

  it('places a created node inside a created table cell', () => {
    const { system, slideId } = setup()
    const source = [
      'script "Builder" from 0',
      'create table "Grid" as grid { columns: [100], rows: [[""]] }',
      'create text "Note" as note inside grid.cell(0, 0) { content: "In cell" }',
      'setText(note, "Still here")',
    ].join('\n')
    runOk(system, slideId, source)
    const table = nodeNamed(system, slideId, 'Grid')
    const cell = table.children[0].children[0]
    const note = cell.children.find((child) => child.components.text !== undefined)
    // The cell already carries its own text child; the extra node is appended.
    expect(cell.children.some((child) => child.components.text?.content === 'Still here')).toBe(
      true,
    )
    expect(note).toBeDefined()
  })

  it('creates an asset instance from the registered library and animates it', () => {
    const { system, slideId } = setup()
    system.assetLibrarySync.apply([{ id: 'asset-cat', name: 'Cat' }])
    const source = [
      'script "Builder" from 0',
      'create asset "Cat" as cat at (30, 40) { scaleX: 2, scaleY: 2 }',
      'cat.tween({ rotation: 1 }, 1)',
    ].join('\n')
    const result = runOk(system, slideId, source)
    expect(result.summary.createdNodeCount).toBe(1)
    const node = nodeNamed(system, slideId, 'Cat')
    expect(node.components.assetInstance?.assetDefinitionId).toBe('asset-cat')
    expect(node.transform.scaleX).toBe(2)
    expect(system.engine.getKeyframes(node.id, 'rotation').map((k) => k.value)).toEqual([0, 1])
  })

  it('unrolls creation inside a loop with fresh ids per iteration', () => {
    const { system, slideId } = setup()
    const source = [
      'script "Builder" from 0',
      'repeat(2) {',
      '  create text "Row" as row at (0, 0) { content: "x" }',
      '  row.set({ x: 10 })',
      '}',
    ].join('\n')
    const result = runOk(system, slideId, source)
    expect(result.summary.createdNodeCount).toBe(2)
    const rows = nodesNamed(system, slideId, 'Row')
    expect(rows).toHaveLength(1)
    const created = [...walkPreOrder(system.engine.getSlide(slideId).scene.root)].filter(
      (node) => node.components.text?.content === 'x',
    )
    expect(created).toHaveLength(2)
    for (const node of created) {
      expect(
        system.engine.getKeyframes(node.id, 'positionX').map((keyframe) => keyframe.value),
      ).toEqual([10])
    }
  })

  it('animates a created asset material parameter from its default', () => {
    const { system, slideId } = setup()
    system.assetLibrarySync.apply([{ id: 'asset-cat', name: 'Cat' }])
    const source = [
      'script "Builder" from 0',
      'create asset "Cat" as cat {}',
      'cat.tween({ tint: "#ff0000" }, 1)',
    ].join('\n')
    runOk(system, slideId, source)
    const node = nodeNamed(system, slideId, 'Cat')
    const tint = system.engine.getMaterialKeyframes(node.id, 'tint')
    expect(tint.map((keyframe) => keyframe.value)).toEqual(['#ffffff', '#ff0000'])
  })

  it('creates a data source and a chart that references it, replacing both on re-run', () => {
    const { system, slideId } = setup()
    const source = [
      'script "Builder" from 0',
      'create data "Sales" as sales { points: [{ label: "Q1", value: 10 }, { label: "Q2", value: 20 }] }',
      'create chart "Bars" as chart at (50, 60) { type: "bar", from: sales }',
      'chart.set({ opacity: 0.5 })',
    ].join('\n')
    const result = runOk(system, slideId, source)
    expect(result.summary.createdDataSourceCount).toBe(1)

    const stored = system.engine.embeddedDataSources.filter((entry) => entry.name === 'Sales')
    expect(stored).toHaveLength(1)
    expect(stored[0] && 'dataPoints' in stored[0] ? stored[0].dataPoints : []).toHaveLength(2)
    const chart = nodeNamed(system, slideId, 'Bars')
    expect(chart.components.chart?.chartType).toBe('bar')
    expect(chart.components.chart?.dataSourceId).toBe(stored[0]?.id)
    expect(system.engine.getKeyframes(chart.id, 'opacity')).toHaveLength(1)

    const chartId = chart.id
    runOk(system, slideId, source)
    expect(
      system.engine.embeddedDataSources.filter((entry) => entry.name === 'Sales'),
    ).toHaveLength(1)
    expect(nodesNamed(system, slideId, 'Bars')).toHaveLength(1)
    expect(nodeNamed(system, slideId, 'Bars').id).toBe(chartId)
  })

  it('deletes a previous run data source when the new source drops it', () => {
    const { system, slideId } = setup()
    runOk(
      system,
      slideId,
      [
        'script "Builder" from 0',
        'create data "Sales" as sales { points: [{ label: "Q1", value: 10 }] }',
        'create chart "Bars" { type: "bar", from: sales }',
      ].join('\n'),
    )
    runOk(system, slideId, 'script "Builder" from 0\nwait(0)')

    expect(
      system.engine.embeddedDataSources.filter((entry) => entry.name === 'Sales'),
    ).toHaveLength(0)
    expect(nodesNamed(system, slideId, 'Bars')).toHaveLength(0)
  })

  it('embeds a library asset through the capture seam before creating it', async () => {
    const { system, slideId } = setup()
    system.assetLibrarySync.apply([{ id: 'asset-dog', name: 'Dog' }])
    const source = ['script "Builder" from 0', 'create asset "Dog" as dog'].join('\n')

    const result = await runAnimationScriptAsync(
      system.engine,
      boundDispatch(system),
      slideId,
      source,
      {
        captureAsset: async (definitionId) => {
          system.engine.embedAsset({
            id: definitionId,
            name: 'Dog',
            data: 'QUJD',
            mimeType: 'image/png',
          } satisfies EmbeddedAsset)
          return true
        },
      },
    )
    expect(result.error).toBeNull()
    expect(result.ran).toBe(true)
    expect(nodeNamed(system, slideId, 'Dog').components.assetInstance?.assetDefinitionId).toBe(
      'asset-dog',
    )
  })

  it('generates a mesh from an embedded PNG at async run time', async () => {
    const { system, slideId } = setup()
    system.assetLibrarySync.apply([{ id: 'asset-blob', name: 'Blob' }])
    system.engine.embedAsset({
      id: 'asset-blob',
      name: 'Blob',
      data: 'QUJD',
      mimeType: 'image/png',
    })
    const source = [
      'script "Builder" from 0',
      'create asset "Blob" as blob at (0, 0) { mesh: { maxVertices: 60 } }',
    ].join('\n')

    const result = await runAnimationScriptAsync(
      system.engine,
      boundDispatch(system),
      slideId,
      source,
      {
        loadImageData: async () => circleImageData(),
      },
    )
    expect(result.error).toBeNull()
    expect(result.ran).toBe(true)
    const node = nodeNamed(system, slideId, 'Blob')
    expect(node.components.mesh).toBeDefined()
    expect(node.components.mesh?.mesh.vertices.length).toBeGreaterThan(0)
  })

  it('fails the async run cleanly when mesh generation has no embedded image', async () => {
    const { system, slideId } = setup()
    system.assetLibrarySync.apply([{ id: 'asset-blob', name: 'Blob' }])
    const source = ['script "Builder" from 0', 'create asset "Blob" as blob { mesh: {} }'].join(
      '\n',
    )
    const result = await runAnimationScriptAsync(
      system.engine,
      boundDispatch(system),
      slideId,
      source,
    )
    expect(result.ran).toBe(false)
    expect(result.error).toContain('not embedded')
    expect(nodesNamed(system, slideId, 'Blob')).toHaveLength(0)
  })

  it('keeps scripts without creations on the synchronous path unchanged', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: 'x' }))
    const source = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 5 }, 0.4)',
    ].join('\n')
    runOk(system, slideId, source)
    expect(positionX(system, heroId)).toEqual([0, 5])
  })
})
