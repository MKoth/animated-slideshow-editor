import { describe, expect, it } from 'vitest'
import {
  AddKeyframeCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  CreateTableCommand,
  MoveNodeCommand,
  SetControlSetCommand,
  SetSlideAnimationScriptCommand,
  SetTableCellComponentCommand,
  TransactionCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { Command, DispatchCommand } from '../../engine/commands'
import { createControl, createControlSet } from '../../engine/control'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import type { AnimationScriptCheckOptions } from '../../engine/animationScriptCheck'
import type { AnimationScriptMeasure } from '../../engine/animationScriptReads'
import { runAnimationScript } from '../../engine/animationScriptRun'
import type { AnimationScriptCompileResult } from '../../engine/animationScriptCompiler'

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

function addNode(
  system: System,
  slideId: string,
  name: string,
  options: {
    semanticName?: string
    transform?: { x: number; y: number; rotation: number; scaleX: number; scaleY: number }
    opacity?: number
    parentId?: string
  } = {},
): string {
  const slide = system.engine.getSlide(slideId)
  return dispatchOk(
    system,
    new CreateNodeCommand({
      sceneId: slide.scene.id,
      parentId: options.parentId ?? slide.scene.root.id,
      name,
      ...(options.semanticName !== undefined && { semanticName: options.semanticName }),
      ...(options.transform !== undefined && { transform: options.transform }),
      ...(options.opacity !== undefined && { opacity: options.opacity }),
    }),
  ).nodeId
}

function keyframe(
  system: System,
  nodeId: string,
  property: 'positionX' | 'positionY' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity',
  time: number,
  value: number,
): void {
  dispatchOk(
    system,
    new AddKeyframeCommand({
      target: { kind: 'node', nodeId, property },
      time,
      value,
      interpolation: 'linear',
    }),
  )
}

function check(
  system: System,
  slideId: string,
  lines: readonly string[],
  options: AnimationScriptCheckOptions = {},
) {
  return checkAnimationScript(system.engine, slideId, lines.join('\n'), options)
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
  return { tableId: tableNodeId, cells }
}

function apply(system: System, result: AnimationScriptCompileResult) {
  dispatchOk(system, new TransactionCommand([...result.commands]))
}

function errors(result: AnimationScriptCompileResult) {
  return result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
}

function messages(result: AnimationScriptCompileResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.message)
}

describe('Animation Script reads — evaluated node properties at the cursor', () => {
  it('reads x, y, rotation, scale and opacity into writes', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero', {
      transform: { x: 3, y: -2, rotation: 0.5, scaleX: 2, scaleY: 1 },
      opacity: 0.75,
    })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ x: hero.x + 1, y: hero.y * 2, rotation: hero.rotation, scaleX: hero.scaleX, scaleY: hero.scaleY, opacity: hero.opacity })',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(heroId, 0)
    expect(state.transform).toMatchObject({ x: 4, y: -4, rotation: 0.5, scaleX: 2, scaleY: 1 })
    expect(state.opacity).toBe(0.75)
  })

  it('reads at the cursor, so an advancing cursor sees hand-authored animation', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    keyframe(system, heroId, 'positionX', 0, 0)
    keyframe(system, heroId, 'positionX', 1, 10)

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'let atStart = hero.x',
      'wait(0.5)',
      'let halfway = hero.x',
      'hero.set({ y: atStart + halfway })',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    expect(system.engine.evaluateNode(heroId, 0.5).transform.y).toBe(5)
  })

  it('rejects reads on group bindings, which stay bounds-only', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Card 1', { semanticName: 'card' })
    addNode(system, slideId, 'Card 2', { semanticName: 'card' })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind cards = group("card")',
      'cards.set({ x: cards.x })',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /bounds/i.test(message))).toBe(true)
  })

  it('reports an unknown read with the readable property vocabulary', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ x: hero.posX })',
    ])

    expect(result.runnable).toBe(false)
    const error = errors(result)[0]
    expect(error.message).toMatch(/Unknown read "posX"/)
    expect(error.message).toContain('x')
    expect(error.line).toBe(3)
  })

  it('does not allow zIndex to be read', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ zIndex: hero.zIndex })',
    ])

    expect(result.runnable).toBe(false)
    expect(errors(result)[0].message).toMatch(/zIndex/)
  })
})

describe('Animation Script reads — worldAt', () => {
  it('returns the evaluator world transform and feeds record fields into writes', () => {
    const { system, slideId } = setup()
    const rigId = addNode(system, slideId, 'Rig', {
      transform: { x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const heroId = addNode(system, slideId, 'Hero', {
      parentId: rigId,
      transform: { x: 3, y: 4, rotation: 0.25, scaleX: 1, scaleY: 1 },
    })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'let here = worldAt(hero, 0.5)',
      'hero.set({ x: here.x, y: here.y, rotation: here.rotation })',
      'hero.set({ scaleX: worldAt(hero, 0).x + worldAt(hero, 0).y })',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(heroId, 0.5)
    // Local x/y take the read world values; the read itself is of the pre-run pose.
    expect(state.transform.x).toBe(4)
    expect(state.transform.y).toBe(6)
    expect(state.transform.rotation).toBeCloseTo(0.25)
    expect(state.transform.scaleX).toBe(10)
  })

  it('reads the world transform of a moving node at an explicit time and at the cursor', () => {
    const { system, slideId } = setup()
    const rigId = addNode(system, slideId, 'Rig', {
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const heroId = addNode(system, slideId, 'Hero', {
      parentId: rigId,
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    keyframe(system, heroId, 'positionX', 0, 0)
    keyframe(system, heroId, 'positionX', 2, 8)

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'wait(1)',
      'hero.set({ rotation: worldAt(hero, 0.5).x, scaleX: worldAt(hero, 2).x, scaleY: worldAt(hero).x })',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(heroId, 1)
    expect(state.transform.rotation).toBe(2)
    expect(state.transform.scaleX).toBe(8)
    expect(state.transform.scaleY).toBe(4)
  })

  it('reports an unknown field on a read record', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ x: worldAt(hero, 0).z })',
    ])

    expect(result.runnable).toBe(false)
    const error = errors(result)[0]
    expect(error.message).toMatch(/"z" is not a field/)
    expect(error.message).toContain('rotation')
    expect(error.line).toBe(3)
  })

  it('rejects arithmetic on a whole record', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ x: worldAt(hero, 0) + 1 })',
    ])

    expect(result.runnable).toBe(false)
    expect(errors(result)[0].message).toMatch(/record/i)
  })

  it('rejects a group as a single-node read target', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Card 1', { semanticName: 'card' })
    addNode(system, slideId, 'Card 2', { semanticName: 'card' })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind cards = group("card")',
      'cards.set({ opacity: worldAt(cards, 0).x })',
    ])

    expect(result.runnable).toBe(false)
    expect(errors(result)[0].message).toMatch(/single node/)
  })

  it('reports a wrong argument count with the call shape', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ x: worldAt(hero, 0, 1).x })',
    ])

    expect(result.runnable).toBe(false)
    expect(errors(result)[0].message).toMatch(/worldAt/)
  })
})

describe('Animation Script reads — controlValue', () => {
  function addHost(
    system: System,
    slideId: string,
    name: string,
    controls: readonly { key: string; default?: number; exposed?: boolean }[],
  ): string {
    const nodeId = addNode(system, slideId, name)
    dispatchOk(
      system,
      new SetControlSetCommand({
        nodeId,
        controlSet: createControlSet(
          nodeId,
          controls.map((control) =>
            createControl({
              key: control.key,
              default: control.default,
              exposed: control.exposed ?? true,
            }),
          ),
        ),
      }),
    )
    return nodeId
  }

  it('reads the exposed Control value at an explicit time and at the cursor', () => {
    const { system, slideId } = setup()
    const hostId = addHost(system, slideId, 'Rig', [
      { key: 'Mouth.Openness', default: 0.1 },
      { key: 'Brow.Raise', default: 0.4 },
    ])
    dispatchOk(
      system,
      new AddKeyframeCommand({
        target: { kind: 'control', nodeId: hostId, controlKey: 'Mouth.Openness' },
        time: 0,
        value: 0.2,
        interpolation: 'linear',
      }),
    )
    dispatchOk(
      system,
      new AddKeyframeCommand({
        target: { kind: 'control', nodeId: hostId, controlKey: 'Mouth.Openness' },
        time: 2,
        value: 0.8,
        interpolation: 'linear',
      }),
    )

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'wait(1)',
      'rig.set({ x: controlValue(rig, "Mouth.Openness") })',
      'rig.set({ y: controlValue(rig, "Mouth.Openness", 2) })',
      'rig.set({ rotation: controlValue(rig, "Mouth.Openness", 0) })',
      'rig.set({ scaleX: controlValue(rig, "Brow.Raise") })',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(hostId, 1)
    expect(state.transform.x).toBe(0.5)
    expect(state.transform.y).toBe(0.8)
    expect(state.transform.rotation).toBe(0.2)
    expect(state.transform.scaleX).toBe(0.4)
  })

  it('reports a hidden Control as not readable', () => {
    const { system, slideId } = setup()
    addHost(system, slideId, 'Rig', [{ key: 'Secret', exposed: false }])

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'rig.set({ x: controlValue(rig, "Secret") })',
    ])

    expect(result.runnable).toBe(false)
    expect(errors(result)[0].message).toMatch(/hidden/)
    expect(errors(result)[0].message).toMatch(/exposed/)
  })

  it('reports an unknown Control key with a near-miss candidate', () => {
    const { system, slideId } = setup()
    addHost(system, slideId, 'Rig', [{ key: 'Mouth.Openness' }])

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'rig.set({ x: controlValue(rig, "Mouth.Openess") })',
    ])

    expect(result.runnable).toBe(false)
    expect(errors(result)[0].message).toMatch(/No Control "Mouth.Openess"/)
    expect(errors(result)[0].message).toContain('"Mouth.Openness"')
  })

  it('reports a non-string Control key', () => {
    const { system, slideId } = setup()
    addHost(system, slideId, 'Rig', [{ key: 'Mouth.Openness' }])

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind rig = node("Rig")',
      'rig.set({ x: controlValue(rig, 1) })',
    ])

    expect(result.runnable).toBe(false)
    expect(errors(result)[0].message).toMatch(/Control key/)
    expect(errors(result)[0].message).toMatch(/number/)
  })
})

describe('Animation Script reads — cellRect', () => {
  it('returns the Grid Slot rectangle composed with the table world transform', () => {
    const { system, slideId } = setup()
    const { tableId } = addTable(system, slideId)
    dispatchOk(system, new MoveNodeCommand({ nodeId: tableId, x: 10, y: 20 }))
    keyframe(system, tableId, 'scaleX', 0, 2)
    keyframe(system, tableId, 'scaleY', 0, 2)
    const probeId = addNode(system, slideId, 'Probe')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind conj = table("Table")',
      'bind probe = node("Probe")',
      'let slot = cellRect(conj, 1, 0, 0)',
      'probe.set({ x: slot.x, y: slot.y, scaleX: slot.width, scaleY: slot.height })',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(probeId, 0)
    // Cell (1,0) is 100x30 at local (0, 30); the table sits at (10, 20) scaled x2.
    expect(state.transform.x).toBe(10)
    expect(state.transform.y).toBe(80)
    expect(state.transform.scaleX).toBe(200)
    expect(state.transform.scaleY).toBe(60)
  })

  it('resolves a slot covered by a spanning cell to the one owning cell', () => {
    const { system, slideId } = setup()
    const { cells } = addTable(system, slideId)
    dispatchOk(
      system,
      new SetTableCellComponentCommand({
        nodeId: cells[0].id,
        tableCell: { kind: 'tableCell', colSpan: 2, rowSpan: 1 },
      }),
    )
    const probeId = addNode(system, slideId, 'Probe')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind conj = table("Table")',
      'bind probe = node("Probe")',
      'let slot = cellRect(conj, 0, 1, 0)',
      'probe.set({ x: slot.x, scaleX: slot.width })',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(probeId, 0)
    expect(state.transform.x).toBe(0)
    expect(state.transform.scaleX).toBe(200)
  })

  it('reads the rectangle at an explicit time and at the cursor', () => {
    const { system, slideId } = setup()
    const { tableId } = addTable(system, slideId)
    keyframe(system, tableId, 'positionX', 0, 0)
    keyframe(system, tableId, 'positionX', 2, 100)
    const probeId = addNode(system, slideId, 'Probe')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind conj = table("Table")',
      'bind probe = node("Probe")',
      'wait(1)',
      'let here = cellRect(conj, 0, 0)',
      'probe.set({ x: here.x, y: cellRect(conj, 0, 0, 2).x })',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(probeId, 1)
    expect(state.transform.x).toBe(50)
    expect(state.transform.y).toBe(100)
  })

  it('reads properties through a cell selector and rejects a row selector', () => {
    const { system, slideId } = setup()
    addTable(system, slideId)
    const probeId = addNode(system, slideId, 'Probe')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind conj = table("Table")',
      'bind probe = node("Probe")',
      'probe.set({ x: conj.cell(0, 1).x, y: conj.cell(1, 0).y })',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(probeId, 0)
    // The table layout places cell (0,1) at local x 100 and cell (1,0) at local y 30.
    expect(state.transform.x).toBe(100)
    expect(state.transform.y).toBe(30)

    const rowRead = check(system, slideId, [
      'script "Demo" from 0',
      'bind conj = table("Table")',
      'bind probe = node("Probe")',
      'probe.set({ x: conj.row(0).x })',
    ])
    expect(rowRead.runnable).toBe(false)
    expect(errors(rowRead)[0].message).toMatch(/single node/)
  })

  it('keeps a rotated table exact', () => {
    const { system, slideId } = setup()
    const { tableId } = addTable(system, slideId)
    dispatchOk(system, new MoveNodeCommand({ nodeId: tableId, x: 10, y: 20 }))
    keyframe(system, tableId, 'rotation', 0, Math.PI / 2)
    const probeId = addNode(system, slideId, 'Probe')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind conj = table("Table")',
      'bind probe = node("Probe")',
      'let slot = cellRect(conj, 0, 1, 0)',
      'probe.set({ x: slot.x, y: slot.y, rotation: slot.rotation, scaleX: slot.width, scaleY: slot.height })',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(probeId, 0)
    // Cell (0,1) is 100 to the right; a 90° table rotation maps it to (10, 120).
    expect(state.transform.x).toBeCloseTo(10)
    expect(state.transform.y).toBeCloseTo(120)
    expect(state.transform.rotation).toBeCloseTo(Math.PI / 2)
    expect(state.transform.scaleX).toBe(100)
    expect(state.transform.scaleY).toBe(30)
  })

  it('reports a missing table, an out-of-range slot and a wrong arity', () => {
    const { system, slideId } = setup()
    addTable(system, slideId)
    addNode(system, slideId, 'Hero')

    const onNode = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ x: cellRect(hero, 0, 0).x })',
    ])
    expect(errors(onNode)[0].message).toMatch(/table/)

    const outOfRange = check(system, slideId, [
      'script "Demo" from 0',
      'bind conj = table("Table")',
      'conj.set({ padding: cellRect(conj, 9, 0).x })',
    ])
    expect(errors(outOfRange)[0].message).toMatch(/out of range/)

    const arity = check(system, slideId, [
      'script "Demo" from 0',
      'bind conj = table("Table")',
      'conj.set({ padding: cellRect(conj, 0).x })',
    ])
    expect(errors(arity)[0].message).toMatch(/cellRect/)
  })
})

describe('Animation Script reads — bounds', () => {
  const SIZE = { width: 100, height: 50 }

  function measureFor(
    sizes: Readonly<Record<string, { width: number; height: number }>>,
  ): AnimationScriptMeasure {
    return (nodeId) => sizes[nodeId] ?? null
  }

  it('returns the subtree-union world AABB, including the measured root', () => {
    const { system, slideId } = setup()
    const rigId = addNode(system, slideId, 'Rig')
    const heroId = addNode(system, slideId, 'Hero', {
      parentId: rigId,
      transform: { x: 100, y: 200, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const probeId = addNode(system, slideId, 'Probe')

    const result = check(
      system,
      slideId,
      [
        'script "Demo" from 0',
        'bind rig = node("Rig")',
        'bind probe = node("Probe")',
        'let box = bounds(rig, 0)',
        'probe.set({ x: box.minX, y: box.minY, scaleX: box.maxX, scaleY: box.maxY })',
      ],
      { measure: measureFor({ [rigId]: { width: 40, height: 40 }, [heroId]: SIZE }) },
    )

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(probeId, 0)
    expect(state.transform.x).toBe(-20)
    expect(state.transform.y).toBe(-20)
    expect(state.transform.scaleX).toBe(150)
    expect(state.transform.scaleY).toBe(225)
  })

  it('unions a group broadcast bounds', () => {
    const { system, slideId } = setup()
    const firstId = addNode(system, slideId, 'Card 1', { semanticName: 'card' })
    const secondId = addNode(system, slideId, 'Card 2', {
      semanticName: 'card',
      transform: { x: 200, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const probeId = addNode(system, slideId, 'Probe')

    const result = check(
      system,
      slideId,
      [
        'script "Demo" from 0',
        'bind cards = group("card")',
        'bind probe = node("Probe")',
        'let box = bounds(cards, 0)',
        'probe.set({ x: box.minX, y: box.minY, scaleX: box.maxX, scaleY: box.maxY })',
      ],
      { measure: measureFor({ [firstId]: SIZE, [secondId]: SIZE }) },
    )

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(probeId, 0)
    expect(state.transform.x).toBe(-50)
    expect(state.transform.y).toBe(-25)
    expect(state.transform.scaleX).toBe(250)
    expect(state.transform.scaleY).toBe(25)
  })

  it('ignores rotation and reads the time-dependent transform', () => {
    const { system, slideId } = setup()
    const rigId = addNode(system, slideId, 'Rig', {
      transform: { x: 0, y: 0, rotation: 1.5, scaleX: 1, scaleY: 1 },
    })
    keyframe(system, rigId, 'positionX', 0, 0)
    keyframe(system, rigId, 'positionX', 2, 100)
    const probeId = addNode(system, slideId, 'Probe')

    const result = check(
      system,
      slideId,
      [
        'script "Demo" from 0',
        'bind rig = node("Rig")',
        'bind probe = node("Probe")',
        'wait(1)',
        'let here = bounds(rig)',
        'probe.set({ x: here.minX, y: here.minY, scaleX: bounds(rig, 2).maxX, scaleY: here.maxY })',
      ],
      { measure: measureFor({ [rigId]: SIZE }) },
    )

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(probeId, 1)
    // The box is the unrotated box around the moving pivot: x = 50 at cursor 1s.
    expect(state.transform.x).toBe(0)
    expect(state.transform.y).toBe(-25)
    expect(state.transform.scaleX).toBe(150)
    expect(state.transform.scaleY).toBe(25)
  })

  it('reads a table row selector as a group bounds', () => {
    const { system, slideId } = setup()
    const { cells } = addTable(system, slideId)
    const probeId = addNode(system, slideId, 'Probe')
    const cellSize = { width: 100, height: 30 }
    const sizes: Record<string, { width: number; height: number }> = {}
    for (const cell of cells) sizes[cell.id] = cellSize

    const result = check(
      system,
      slideId,
      [
        'script "Demo" from 0',
        'bind conj = table("Table")',
        'bind probe = node("Probe")',
        'let row = bounds(conj.row(0), 0)',
        'probe.set({ x: row.minX, y: row.minY, scaleX: row.maxX, scaleY: row.maxY })',
      ],
      { measure: measureFor(sizes) },
    )

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(probeId, 0)
    expect(state.transform.x).toBe(-50)
    expect(state.transform.y).toBe(-15)
    expect(state.transform.scaleX).toBe(150)
    expect(state.transform.scaleY).toBe(15)
  })

  it('reports unmeasurable geometry with the renderer-measured caution', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    addNode(system, slideId, 'Card 1', { semanticName: 'card' })
    addNode(system, slideId, 'Card 2', { semanticName: 'card' })

    const unmeasurable = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ x: bounds(hero, 0).minX })',
    ])
    expect(unmeasurable.runnable).toBe(false)
    expect(errors(unmeasurable)[0].message).toMatch(/measured/)

    const group = check(system, slideId, [
      'script "Demo" from 0',
      'bind cards = group("card")',
      'cards.set({ opacity: bounds(cards, 0).minX })',
    ])
    expect(group.runnable).toBe(false)
    expect(errors(group)[0].message).toMatch(/measured/)
  })

  it('keeps group bounds and per-member alias reads side by side', () => {
    const { system, slideId } = setup()
    const firstId = addNode(system, slideId, 'Card 1', {
      semanticName: 'card',
      transform: { x: 5, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const secondId = addNode(system, slideId, 'Card 2', {
      semanticName: 'card',
      transform: { x: 200, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const probeId = addNode(system, slideId, 'Probe')

    const result = check(
      system,
      slideId,
      [
        'script "Demo" from 0',
        'bind cards = group("card")',
        'bind first = node("Card 1")',
        'bind probe = node("Probe")',
        'let box = bounds(cards, 0)',
        'probe.set({ x: first.x, y: box.maxY })',
      ],
      { measure: measureFor({ [firstId]: SIZE, [secondId]: SIZE }) },
    )

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(probeId, 0)
    expect(state.transform.x).toBe(5)
    expect(state.transform.y).toBe(25)
  })
})

describe('Animation Script reads — read times', () => {
  it('reads at the statement cursor inside at() and parallel', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const probeId = addNode(system, slideId, 'Probe')
    keyframe(system, heroId, 'positionX', 0, 0)
    keyframe(system, heroId, 'positionX', 2, 10)

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind probe = node("Probe")',
      'wait(1)',
      'at(0.5) probe.set({ x: hero.x })',
      'parallel {',
      '  at(1.5) probe.set({ y: hero.x })',
      '}',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const state = system.engine.evaluateNode(probeId, 1.5)
    // at(0.5): hero.x at 0.5s is 2.5; the parallel at(1.5) reads at 1.5s → 7.5.
    expect(state.transform.x).toBe(2.5)
    expect(state.transform.y).toBe(7.5)
  })

  it('errors a read time outside [0, slide.duration] and accepts the boundaries', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ x: worldAt(hero, -0.5).x })',
      'hero.set({ y: worldAt(hero, 10.5).x })',
      'hero.set({ rotation: worldAt(hero, 10).x })',
    ])

    expect(result.runnable).toBe(false)
    const found = errors(result)
    expect(found).toHaveLength(2)
    expect(found[0].message).toMatch(/outside the slide/)
    expect(found[0]).toMatchObject({ line: 3 })
    expect(found[1]).toMatchObject({ line: 4 })
    expect(found.map((error) => error.line)).not.toContain(5)
  })

  it('errors a cursor-omitted read pushed past the slide by a trailing wait', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'wait(11)',
      'hero.set({ x: hero.x })',
    ])

    expect(result.runnable).toBe(false)
    expect(messages(result).some((message) => /wait ends at 11s/.test(message))).toBe(true)
    expect(messages(result).some((message) => /Read time 11s is outside/.test(message))).toBe(true)
  })

  it('accepts duration suffixes in read times', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    keyframe(system, heroId, 'positionX', 0, 0)
    keyframe(system, heroId, 'positionX', 2, 8)

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ y: worldAt(hero, 1500ms).x })',
    ])

    expect(result.diagnostics).toEqual([])
    apply(system, result)
    expect(system.engine.evaluateNode(heroId, 0).transform.y).toBe(6)
  })

  it('reserves read function names', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, ['script "Demo" from 0', 'let bounds = 1'])

    expect(result.runnable).toBe(false)
    expect(errors(result)[0].message).toMatch(/reserved/)
  })

  it('reads unchanged source and state identically on Check, Run and a re-run', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    const probeId = addNode(system, slideId, 'Probe')
    keyframe(system, heroId, 'positionX', 0, 0)
    keyframe(system, heroId, 'positionX', 2, 10)
    const source = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind probe = node("Probe")',
      'wait(0.5)',
      'probe.set({ x: worldAt(hero).x, y: hero.x })',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const checked = checkAnimationScript(system.engine, slideId, source)
    expect(checked.diagnostics).toEqual([])

    const first = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
    expect(first.error).toBeNull()
    const firstTrack = system.engine
      .getKeyframes(probeId, 'positionX')
      .map((keyframe) => ({ time: keyframe.time, value: keyframe.value }))
    const firstY = system.engine
      .getKeyframes(probeId, 'positionY')
      .map((keyframe) => ({ time: keyframe.time, value: keyframe.value }))

    const second = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
    expect(second.error).toBeNull()
    expect(
      system.engine
        .getKeyframes(probeId, 'positionX')
        .map((keyframe) => ({ time: keyframe.time, value: keyframe.value })),
    ).toEqual(firstTrack)
    expect(
      system.engine
        .getKeyframes(probeId, 'positionY')
        .map((keyframe) => ({ time: keyframe.time, value: keyframe.value })),
    ).toEqual(firstY)

    expect(firstTrack).toContainEqual({ time: 0.5, value: 2.5 })
    expect(firstY).toContainEqual({ time: 0.5, value: 2.5 })
  })
})

describe('Animation Script reads — Check and Run read the same values', () => {
  it('produces identical output for Check and Run and dispatches nothing on Check', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero', {
      transform: { x: 2, y: 1, rotation: 0, scaleX: 1, scaleY: 1 },
    })
    const source = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: hero.x + 5 }, 0.4)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    const events: unknown[] = []
    system.engine.subscribe((event) => events.push(event))
    const before = system.undoStack.entries.length

    const checked = checkAnimationScript(system.engine, slideId, source)

    expect(checked.diagnostics).toEqual([])
    expect(system.undoStack.entries).toHaveLength(before)
    expect(system.engine.getKeyframes(heroId, 'positionX')).toHaveLength(0)
    expect(events).toEqual([])

    const ran = runAnimationScript(system.engine, boundDispatch(system), slideId, source)

    expect(ran.error).toBeNull()
    expect(ran.ran).toBe(true)
    expect(
      system.engine.getKeyframes(heroId, 'positionX').map((keyframe) => keyframe.value),
    ).toEqual([2, 7])
  })
})
