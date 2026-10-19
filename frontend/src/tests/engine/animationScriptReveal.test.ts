import { describe, expect, it } from 'vitest'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DuplicateSlideCommand,
  SetSlideAnimationScriptCommand,
  SetSlideSceneEffectsCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { CreateNodeParameters } from '../../engine/commands/createNodeCommand'
import { runAnimationScript } from '../../engine/animationScriptRun'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { markLifecycle, revealCoverage } from '../../engine/sceneEffect'
import { walkPreOrder } from '../../engine/sceneNode'
import { deserialize, serialize, validate } from '../../engine/lessonSerializer'

function setup() {
  const system = createCommandSystem(() => {})
  system.dispatcher.dispatch(new CreateProjectCommand({ name: 'Reveal' }))
  system.dispatcher.dispatch(new CreateSlideCommand({ name: 'Slide' }))
  const slide = system.engine.getActiveSlide()!
  const makeNode = (
    parentId: string,
    name: string,
    options: Omit<CreateNodeParameters, 'sceneId' | 'parentId' | 'name'> = {},
  ) => {
    const outcome = system.dispatcher.dispatch(
      new CreateNodeCommand({ sceneId: slide.scene.id, parentId, name, ...options }),
    )
    if (!outcome.ok) throw outcome.error
    return system.engine.getNode((outcome.inverse as { nodeId: string }).nodeId)
  }
  const group = makeNode(slide.scene.root.id, 'Group', { semanticName: 'content' })
  const first = makeNode(group.id, 'First', {
    semanticName: 'content',
    components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
  })
  const second = makeNode(group.id, 'Second', {
    transform: { x: 40, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
  })
  const hidden = makeNode(group.id, 'Hidden', {
    visible: false,
    transform: { x: 500, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
  })
  const transparent = makeNode(group.id, 'Transparent', {
    opacity: 0,
    transform: { x: 700, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
  })
  const performer = makeNode(slide.scene.root.id, 'Performer', {
    components: { assetInstance: { kind: 'assetInstance', assetDefinitionId: 'performer-art' } },
  })
  const measurable = new Set([first.id, second.id, hidden.id, transparent.id])
  const measure = (nodeId: string) => (measurable.has(nodeId) ? { width: 20, height: 20 } : null)
  return { system, slide, group, first, second, hidden, transparent, performer, measure }
}

describe('Animation Script reveal', () => {
  it('compiles a temporary red mark with proportional draw, hold, and fade phases', () => {
    const { system, slide, first, measure } = setup()
    const source =
      'script "Mark" from 0\nbind target = node("First")\nmark(target, at: 1, over: 2, visual: none)'
    const result = checkAnimationScript(system.engine, slide.id, source, { measure })
    expect(result.runnable).toBe(true)
    expect(result.effects).toHaveLength(1)
    expect(result.effects[0]).toMatchObject({
      kind: 'mark',
      start: 1,
      duration: 2,
      scopeNodeIds: [first.id],
      nodeIds: [first.id],
      visual: { kind: 'none' },
    })
    const mark = result.effects[0] as Extract<(typeof result.effects)[number], { kind: 'mark' }>
    const phases = [1, 1.5, 2.2, 2.8, 3].map((time) => markLifecycle(mark, time))
    expect(phases.map(({ drawProgress }) => drawProgress)).toEqual([0, 0.5, 1, 1, 1])
    expect(phases.map(({ opacity }) => opacity)).toEqual([1, 1, 1, expect.closeTo(1 / 3), 0])
    system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId: slide.id, source }))
    expect(
      runAnimationScript(
        system.engine,
        (command) => system.dispatcher.dispatch(command),
        slide.id,
        source,
        { measure },
      ).ran,
    ).toBe(true)
    const saved = JSON.parse(serialize(system.engine.project!))
    expect(validate(saved)).toEqual([])
    expect(deserialize(JSON.stringify(saved)).slides[0].effects[0]).toMatchObject({ kind: 'mark' })
    const priorEffect = system.engine.getSlide(slide.id).effects[0]
    const rerunSource = source.replace('over: 2', 'over: 1.5')
    system.dispatcher.dispatch(
      new SetSlideAnimationScriptCommand({ slideId: slide.id, source: rerunSource }),
    )
    expect(
      runAnimationScript(
        system.engine,
        (command) => system.dispatcher.dispatch(command),
        slide.id,
        rerunSource,
        { measure },
      ).ran,
    ).toBe(true)
    expect(system.engine.getSlide(slide.id).effects).toHaveLength(1)
    expect(system.engine.getSlide(slide.id).effects[0].duration).toBe(1.5)
    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getSlide(slide.id).effects).toEqual([priorEffect])
    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getSlide(slide.id).effects).toEqual([priorEffect])
    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getSlide(slide.id).effects).toEqual([])
  })

  it('accepts an asset created earlier in the same script as a mark visual', () => {
    const { system, slide, first, measure } = setup()
    system.assetLibrarySync.apply([{ id: 'asset-paw', name: 'Paw' }])
    const source = [
      'script "Mark" from 0',
      'create asset "Paw" as paw',
      'bind target = node("First")',
      'mark(target, visual: paw)',
    ].join('\n')

    const result = checkAnimationScript(system.engine, slide.id, source, { measure })

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.effects).toHaveLength(1)
    expect(result.effects[0]).toMatchObject({ kind: 'mark', scopeNodeIds: [first.id] })
  })

  it('keeps old rendered target measurements when an inserted create shifts script IDs', () => {
    const { system, slide } = setup()
    system.assetLibrarySync.apply([{ id: 'asset-paw', name: 'Paw' }])
    const original = [
      'script "Builder" from 0',
      'create text "Demo title" as title at (100, 100) { content: "Title", fontSize: 30 }',
    ].join('\n')
    system.dispatcher.dispatch(
      new SetSlideAnimationScriptCommand({ slideId: slide.id, source: original }),
    )
    expect(
      runAnimationScript(
        system.engine,
        (command) => system.dispatcher.dispatch(command),
        slide.id,
        original,
      ).ran,
    ).toBe(true)
    const previousTitle = [...walkPreOrder(system.engine.getSlide(slide.id).scene.root)].find(
      (node) => node.name === 'Demo title',
    )!
    const inserted = [
      'script "Builder" from 0',
      'create asset "Paw" as paw',
      'create text "Demo title" as title at (100, 100) { content: "Title", fontSize: 30 }',
      'mark(title, visual: paw)',
    ].join('\n')

    const result = checkAnimationScript(system.engine, slide.id, inserted, {
      measure: (nodeId) => (nodeId === previousTitle.id ? { width: 100, height: 30 } : null),
    })

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.effects).toHaveLength(1)
  })

  it('checks a newly created text target before the first render measurement exists', () => {
    const { system, slide } = setup()
    system.assetLibrarySync.apply([{ id: 'asset-paw', name: 'Paw' }])
    const source = [
      'script "Builder" from 0',
      'create text "Demo title" as title at (100, 100) { content: "Title", fontSize: 30 }',
      'create asset "Paw" as paw',
      'mark(title, visual: paw)',
    ].join('\n')

    const result = checkAnimationScript(system.engine, slide.id, source)

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.effects).toHaveLength(1)
  })

  it('pads planned reveal bounds when no renderer measurement exists yet', () => {
    const { system, slide } = setup()
    // All-caps "FEMENINO" at 26px: the raw 0.6em/char estimate (124.8 wide)
    // undershoots real caps, which used to leave the trailing O half-masked.
    // With no measure available the fallback must err wide instead.
    const source = [
      'script "Builder" from 0',
      'create text "Caps" as caps at (340, 500) { content: "FEMENINO", fontSize: 26 }',
      'reveal(caps, over: 0.8, visual: none)',
    ].join('\n')

    const result = checkAnimationScript(system.engine, slide.id, source)

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.effects).toHaveLength(1)
    const effect = result.effects[0]
    expect(effect.kind).toBe('reveal')
    if (effect.kind !== 'reveal') throw new Error('expected a reveal effect')
    const bounds = effect.bounds
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(8 * 26 * 0.6)
    expect(bounds.maxX - bounds.minX).toBeCloseTo(8 * 26 * 0.6 * 1.2 + 4, 0)
    expect((bounds.minX + bounds.maxX) / 2).toBeCloseTo(340, 5)
  })

  it('unions live measurements with planned bounds when a rerun moved the node', () => {
    const { system, slide } = setup()
    // The previous run left "Moved label" at (340, 480); this source recreates
    // it at (340, 500). The live measurement lags one move behind but still
    // overlaps the planned box, so the effect must cover both the old spot
    // and the new home — never just the stale box, or the text renders
    // half-masked after the move.
    const previous = system.engine.getSlide(slide.id).scene.root
    const made = system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: previous.id,
        name: 'Moved label',
        transform: { x: 340, y: 480, rotation: 0, scaleX: 1, scaleY: 1 },
      }),
    )
    if (!made.ok) throw made.error
    const previousId = (made.inverse as { nodeId: string }).nodeId
    const measure = (nodeId: string) => (nodeId === previousId ? { width: 10, height: 10 } : null)
    const source = [
      'script "Builder" from 0',
      'create text "Moved label" as moved at (340, 500) { content: "FEMENINO", fontSize: 26 }',
      'reveal(moved, over: 0.8, visual: none)',
    ].join('\n')

    const result = checkAnimationScript(system.engine, slide.id, source, { measure })

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.effects).toHaveLength(1)
    const effect = result.effects[0]
    expect(effect.kind).toBe('reveal')
    if (effect.kind !== 'reveal') throw new Error('expected a reveal effect')
    // Old spot (around y 480) and new home (around y 500) both covered.
    expect(effect.bounds.minY).toBeLessThan(480)
    expect(effect.bounds.maxY).toBeGreaterThan(510)
    expect(effect.bounds.maxX).toBeGreaterThan(400)
  })

  it('does not smear nested created text with origin-local planned bounds', () => {
    const { system, slide } = setup()
    // Planned bounds are parent-local: text created at (5, 5) inside an
    // offset parent plans its box near the origin, while the live previous
    // node measures in world space far away. Unioning those would stretch
    // the effect across the canvas (the table-border sweep sailed off the
    // table this way), so disjoint boxes must keep the live measurement.
    const previous = system.engine.getSlide(slide.id).scene.root
    const made = system.dispatcher.dispatch(
      new CreateNodeCommand({
        sceneId: slide.scene.id,
        parentId: previous.id,
        name: 'Cell',
        transform: { x: 300, y: 400, rotation: 0, scaleX: 1, scaleY: 1 },
      }),
    )
    if (!made.ok) throw made.error
    const previousId = (made.inverse as { nodeId: string }).nodeId
    const measure = (nodeId: string) => (nodeId === previousId ? { width: 20, height: 20 } : null)
    const source = [
      'script "Builder" from 0',
      'create text "Cell" as cell at (5, 5) { content: "Hi", fontSize: 30 }',
      'reveal(cell, over: 0.5, visual: none)',
    ].join('\n')

    const result = checkAnimationScript(system.engine, slide.id, source, { measure })

    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.effects).toHaveLength(1)
    const effect = result.effects[0]
    expect(effect.kind).toBe('reveal')
    if (effect.kind !== 'reveal') throw new Error('expected a reveal effect')
    expect(effect.bounds).toEqual({ minX: 290, minY: 390, maxX: 310, maxY: 410 })
  })

  it('compiles wipe calls with deterministic timing and a cloth performer', () => {
    const { system, slide, group, first, second, measure } = setup()
    const result = checkAnimationScript(
      system.engine,
      slide.id,
      'script "Wipe" from 0\nbind target = group("content")\nwipe(target, at: 2, over: 0.5)',
      { measure },
    )
    expect(result.runnable).toBe(true)
    expect(result.summary.to).toBe(0.5)
    expect(result.effects[0]).toMatchObject({
      kind: 'wipe',
      start: 2,
      duration: 0.5,
      scopeNodeIds: [group.id, first.id],
      nodeIds: [first.id, second.id],
      visual: { kind: 'cloth' },
    })
    const silent = checkAnimationScript(
      system.engine,
      slide.id,
      'script "Wipe" from 0\nbind target = node("First")\nwipe(target, visual: none)',
      { measure },
    )
    expect(silent.effects[0].visual).toEqual({ kind: 'none' })
    const source =
      'script "Wipe" from 0\nbind target = node("First")\nwipe(target, over: 0.5, visual: none)'
    system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId: slide.id, source }))
    expect(
      runAnimationScript(
        system.engine,
        (command) => system.dispatcher.dispatch(command),
        slide.id,
        source,
        { measure },
      ).ran,
    ).toBe(true)
    expect(system.engine.getSlide(slide.id).effects[0]).toMatchObject({
      kind: 'wipe',
      duration: 0.5,
      visual: { kind: 'none' },
    })
    system.dispatcher.undo()
    expect(system.engine.getSlide(slide.id).effects).toEqual([])
  })

  it('checks a subtree target, captures a deduplicated composite, and advances by duration', () => {
    const { system, slide, group, first, second, measure } = setup()
    const result = checkAnimationScript(
      system.engine,
      slide.id,
      `script "Demo" from 0\nbind target = group("content")\nreveal(target, at: 2, over: 0.5, visual: none)`,
      { measure },
    )
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(result.summary.to).toBe(0.5)
    expect(result.effects).toHaveLength(1)
    expect(result.effects[0]).toMatchObject({
      start: 2,
      duration: 0.5,
      scopeNodeIds: [group.id, first.id],
      nodeIds: [first.id, second.id],
      bounds: { minX: -10, minY: -10, maxX: 50, maxY: 10 },
      visual: { kind: 'none' },
    })
    expect(group.id).toBeTruthy()
  })

  it('advances the cursor by duration even when an explicit at: is behind it', () => {
    const { system, slide, measure } = setup()
    const result = checkAnimationScript(
      system.engine,
      slide.id,
      'script "Cursor" from 0\nbind target = node("First")\nwait(2)\nreveal(target, at: 0.5, over: 0.25, visual: none)',
      { measure },
    )
    expect(result.runnable).toBe(true)
    expect(result.effects[0].start).toBe(0.5)
    expect(result.summary.to).toBe(2.25)
  })

  it('rejects empty or unmeasurable targets in Check', () => {
    const { system, slide } = setup()
    const result = checkAnimationScript(
      system.engine,
      slide.id,
      'script "Demo" from 0\nbind target = group("content")\nreveal(target)',
      { measure: () => null },
    )
    expect(result.runnable).toBe(false)
    expect(result.diagnostics.some((item) => item.message.includes('no visible, measurable'))).toBe(
      true,
    )
  })

  it('uses the deterministic paw by default and rejects invalid durations or performers', () => {
    const { system, slide, performer, measure } = setup()
    const source = (call: string) =>
      checkAnimationScript(
        system.engine,
        slide.id,
        `script "Demo" from 0\nbind target = node("First")\nbind performer = node("Performer")\n${call}`,
        { measure },
      )
    expect(source('reveal(target)').effects[0].visual).toEqual({ kind: 'paw' })
    expect(source('reveal(target, visual: performer)').effects[0].visual).toEqual({
      kind: 'asset',
      nodeId: performer.id,
    })
    expect(
      source('reveal(target, over: 0)').diagnostics.some((item) => /duration/i.test(item.message)),
    ).toBe(true)
    const invalidVisual = source('reveal(target, visual: target)')
    expect(invalidVisual.runnable).toBe(false)
    expect(invalidVisual.diagnostics.some((item) => item.message.includes('Asset Instance'))).toBe(
      true,
    )
    expect(invalidVisual.effects).toEqual([])
  })

  it('treats a node binding as node-only and excludes hidden members from semantic groups', () => {
    const { system, slide, group, first, second, hidden, transparent, measure } = setup()
    const nodeTarget = checkAnimationScript(
      system.engine,
      slide.id,
      'script "Node" from 0\nbind target = node("First")\nreveal(target, visual: none)',
      { measure },
    )
    expect(nodeTarget.effects[0].nodeIds).toEqual([first.id])
    expect(nodeTarget.effects[0].scopeNodeIds).toEqual([first.id])
    const groupTarget = checkAnimationScript(
      system.engine,
      slide.id,
      'script "Group" from 0\nbind target = group("content")\nreveal(target, visual: none)',
      { measure },
    )
    expect(groupTarget.effects[0].scopeNodeIds).toEqual([group.id, first.id])
    expect(groupTarget.effects[0].nodeIds).toEqual([first.id, second.id])
    expect(groupTarget.effects[0].nodeIds).not.toContain(hidden.id)
    expect(groupTarget.effects[0].nodeIds).not.toContain(transparent.id)
  })

  it('supports an explicit subtree target', () => {
    const { system, slide, group, first, second, measure } = setup()
    const result = checkAnimationScript(
      system.engine,
      slide.id,
      'script "Subtree" from 0\nbind target = node("Group")\nreveal(subtree(target), visual: none)',
      { measure },
    )
    expect(result.runnable).toBe(true)
    expect(result.effects[0].scopeNodeIds).toEqual([group.id])
    expect(result.effects[0].nodeIds).toEqual([first.id, second.id])
  })

  it('includes text inside populated Table Cells and excludes empty cell layout nodes', () => {
    const { system, slide, group, first } = setup()
    const add = (
      name: string,
      components: CreateNodeParameters['components'],
      parentId = group.id,
    ) => {
      const outcome = system.dispatcher.dispatch(
        new CreateNodeCommand({ sceneId: slide.scene.id, parentId, name, components }),
      )
      if (!outcome.ok) throw outcome.error
      return system.engine.getNode((outcome.inverse as { nodeId: string }).nodeId)
    }
    const populatedCell = add('Populated Cell', {
      tableCell: { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
    })
    const cellText = add(
      'Cell Text',
      { text: { kind: 'text', content: 'hello', fontSize: 16, alignment: 'left' } },
      populatedCell.id,
    )
    const emptyCell = add('Empty Cell', {
      tableCell: { kind: 'tableCell', colSpan: 1, rowSpan: 1 },
    })
    const measured = new Set([populatedCell.id, cellText.id, emptyCell.id])
    const result = checkAnimationScript(
      system.engine,
      slide.id,
      'script "Table" from 0\nbind target = group("content")\nreveal(target, visual: none)',
      { measure: (nodeId) => (measured.has(nodeId) ? { width: 20, height: 10 } : null) },
    )
    expect(result.effects[0].nodeIds).toContain(cellText.id)
    expect(result.effects[0].scopeNodeIds).toEqual([group.id, first.id])
    expect(result.effects[0].nodeIds).not.toContain(populatedCell.id)
    expect(result.effects[0].nodeIds).not.toContain(emptyCell.id)
  })

  it('persists one reveal footprint in a Transaction and removes it on undo', () => {
    const { system, slide, measure } = setup()
    const source =
      'script "Demo" from 0\nbind target = group("content")\nreveal(target, over: 0.5, visual: none)'
    system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId: slide.id, source }))
    const result = runAnimationScript(
      system.engine,
      (command) => system.dispatcher.dispatch(command),
      slide.id,
      source,
      { measure },
    )
    expect(result.ran).toBe(true)
    expect(system.engine.getSlide(slide.id).effects).toHaveLength(1)
    expect(system.engine.getSlide(slide.id).animationScript?.lastCompiled?.effectIds).toHaveLength(
      1,
    )
    system.dispatcher.undo()
    expect(system.engine.getSlide(slide.id).effects).toHaveLength(0)
  })

  it('rerun replaces its own effect, keeps unrelated effects, and undo restores the prior output', () => {
    const { system, slide, first: firstNode, measure } = setup()
    const manual = {
      kind: 'reveal' as const,
      id: 'manual-effect',
      start: 0,
      duration: 2,
      scopeNodeIds: [firstNode.id],
      nodeIds: [firstNode.id],
      bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      visual: { kind: 'none' as const },
    }
    system.dispatcher.dispatch(
      new SetSlideSceneEffectsCommand({ slideId: slide.id, effects: [manual] }),
    )
    const dispatch = (source: string) => {
      system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId: slide.id, source }))
      return runAnimationScript(
        system.engine,
        (command) => system.dispatcher.dispatch(command),
        slide.id,
        source,
        { measure },
      )
    }
    const first = dispatch(
      'script "Demo" from 0\nbind target = group("content")\nbind single = node("First")\nsingle.set({ x: 5 })\nreveal(target, over: 0.5, visual: none)',
    )
    expect(first.ran).toBe(true)
    expect(system.engine.evaluateNode(firstNode.id, 0).transform.x).toBe(5)
    const firstOutput = system.engine.getSlide(slide.id).effects
    const second = dispatch(
      'script "Demo" from 0\nbind target = group("content")\nbind single = node("First")\nsingle.set({ x: 7 })\nreveal(target, over: 0.8, visual: none)',
    )
    expect(second.ran).toBe(true)
    expect(system.engine.evaluateNode(firstNode.id, 0).transform.x).toBe(7)
    expect(system.engine.getSlide(slide.id).effects).toHaveLength(2)
    expect(system.engine.getSlide(slide.id).effects[0]).toEqual(manual)
    expect(system.engine.getSlide(slide.id).effects[1].duration).toBe(0.8)
    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getSlide(slide.id).effects).toEqual(firstOutput)
    expect(system.engine.evaluateNode(firstNode.id, 0).transform.x).toBe(5)
  })

  it('computes deterministic coverage independent of evaluation order', () => {
    const effect = {
      kind: 'reveal' as const,
      id: 'e',
      start: 1,
      duration: 2,
      scopeNodeIds: [],
      nodeIds: [],
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      visual: { kind: 'none' as const },
    }
    expect([2, 1, 3, 2].map((time) => revealCoverage(effect, time))).toEqual([0.5, 0, 1, 0.5])
  })

  it('round-trips effect data and reads older lessons without an effects field', () => {
    const { system, slide, first } = setup()
    const effect = {
      kind: 'reveal' as const,
      id: 'script-effect:test:0',
      start: 0,
      duration: 1,
      scopeNodeIds: [first.id],
      nodeIds: [first.id],
      bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
      visual: { kind: 'paw' as const },
    }
    system.dispatcher.dispatch(
      new SetSlideSceneEffectsCommand({ slideId: slide.id, effects: [effect] }),
    )
    const json = JSON.parse(serialize(system.engine.project!)) as {
      slides: Array<Record<string, unknown>>
    }
    expect(validate(json as never)).toEqual([])
    const restored = deserialize(JSON.stringify(json))
    expect(restored.slides[0].effects).toEqual([effect])
    delete json.slides[0].effects
    expect(deserialize(JSON.stringify(json)).slides[0].effects).toEqual([])
  })

  it('duplicates reveal targets and their compiled effect footprint with remapped ids', () => {
    const { system, slide, first, measure } = setup()
    const source =
      'script "Demo" from 0\nbind target = group("content")\nreveal(target, visual: none)'
    system.dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId: slide.id, source }))
    const result = runAnimationScript(
      system.engine,
      (command) => system.dispatcher.dispatch(command),
      slide.id,
      source,
      { measure },
    )
    expect(result.ran).toBe(true)
    system.dispatcher.dispatch(new DuplicateSlideCommand({ slideId: slide.id }))
    const duplicate = system.engine.getActiveSlide()!
    expect(duplicate.effects).toHaveLength(1)
    expect(duplicate.effects[0].id).not.toBe(slide.effects[0].id)
    expect(duplicate.effects[0].nodeIds).not.toContain(first.id)
    expect(duplicate.effects[0].nodeIds.every((id) => duplicate.scene.getNode(id))).toBe(true)
    expect(duplicate.animationScript?.lastCompiled?.effectIds).toEqual([duplicate.effects[0].id])
  })
})
