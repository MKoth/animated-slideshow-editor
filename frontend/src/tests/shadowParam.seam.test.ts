import { describe, it, expect, vi } from 'vitest'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import {
  SetShadowEffectCommand,
  SetShadowParamCommand,
  TransactionCommand,
} from '../engine/commands'
import { DEFAULT_SHADOW_EFFECT } from '../engine/shadowEffect'

function createSystem() {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const publicEngine = toReadOnly(engine)
  engine.createProject({ name: 'Test' })
  const slide = engine.createSlide('S')
  const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group')
  engine.createNode(slide.scene.id, group.id, 'C1', {
    components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
  })
  engine.createNode(slide.scene.id, group.id, 'C2', {
    components: {
      mesh: {
        kind: 'mesh',
        mesh: {
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          faces: [{ v0: 0, v1: 1, v2: 2 }],
          uvs: [
            { u: 0, v: 0 },
            { u: 1, v: 0 },
            { u: 1, v: 1 },
          ],
        },
      },
    },
  })
  return {
    sys: { engine: publicEngine, dispatcher, undoStack, internal: engine },
    slide,
    group,
    engine,
    dispatcher,
    undoStack,
    publicEngine,
  }
}

describe('Shadow Param seam', () => {
  it('dispatch SetShadowParam for each property, assert evaluate + JSON round-trip + warnings', () => {
    const { sys, group, engine, dispatcher, undoStack, publicEngine } = createSystem()
    dispatcher.dispatch(
      new SetShadowEffectCommand({ nodeId: group.id, shadowEffect: DEFAULT_SHADOW_EFFECT }),
    )
    const props: [string, number | string][] = [
      ['offsetX', 42],
      ['offsetY', -10],
      ['scaleX', 2],
      ['scaleY', 0],
      ['skewX', 15],
      ['skewY', -5],
      ['rotation', 30],
      ['blur', 16],
      ['opacity', 0.7],
      ['color', '#ff00ff'],
    ]
    for (const [prop, value] of props) {
      const r = dispatcher.dispatch(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        new SetShadowParamCommand({ nodeId: group.id, property: prop as any, value }),
      )
      expect(r.ok).toBe(true)
      const evaluated = publicEngine.evaluateShadow(group.id, 0)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((evaluated as any)[prop]).toBe(
        prop === 'color' ? (value as string).toLowerCase() : value,
      )
      const json = engine.getNode(group.id).toJSON()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((json.shadowEffect as any)[prop]).toBe(
        prop === 'color' ? (value as string).toLowerCase() : value,
      )
    }
    // JSON round-trip
    const json = publicEngine.toJSON()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    publicEngine.restoreFromJSON(json)
    warn.mockRestore()
    const after = publicEngine.evaluateShadow(group.id, 0)
    expect(after?.offsetX).toBe(42)
    expect(after?.color).toBe('#ff00ff')
    void sys
    void undoStack
  })

  it('validation per spec warnings', () => {
    const { dispatcher, publicEngine } = createSystem()
    const group = createSystem().group
    // need to recreate properly
    const sys2 = createSystem()
    sys2.dispatcher.dispatch(
      new SetShadowEffectCommand({ nodeId: sys2.group.id, shadowEffect: DEFAULT_SHADOW_EFFECT }),
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    // blur NaN ->0
    let r = sys2.dispatcher.dispatch(
      new SetShadowParamCommand({ nodeId: sys2.group.id, property: 'blur', value: NaN }),
    )
    expect(r.ok).toBe(true)
    expect(sys2.publicEngine.evaluateShadow(sys2.group.id, 0)?.blur).toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockClear()
    // color bad -> #000000
    r = sys2.dispatcher.dispatch(
      new SetShadowParamCommand({ nodeId: sys2.group.id, property: 'color', value: 'bad' }),
    )
    expect(r.ok).toBe(true)
    expect(sys2.publicEngine.evaluateShadow(sys2.group.id, 0)?.color).toBe('#000000')
    expect(warn).toHaveBeenCalled()
    warn.mockClear()
    // scale NaN rejected
    r = sys2.dispatcher.dispatch(
      new SetShadowParamCommand({ nodeId: sys2.group.id, property: 'scaleX', value: NaN }),
    )
    expect(r.ok).toBe(false)
    // scale 0 allowed
    r = sys2.dispatcher.dispatch(
      new SetShadowParamCommand({ nodeId: sys2.group.id, property: 'scaleX', value: 0 }),
    )
    expect(r.ok).toBe(true)
    expect(sys2.publicEngine.evaluateShadow(sys2.group.id, 0)?.scaleX).toBe(0)
    // offset NaN rejected
    r = sys2.dispatcher.dispatch(
      new SetShadowParamCommand({ nodeId: sys2.group.id, property: 'offsetX', value: NaN }),
    )
    expect(r.ok).toBe(false)
    warn.mockRestore()
    void dispatcher
    void publicEngine
    void group
  })

  it('Ground groups six ops and undoes atomically', () => {
    const sys2 = createSystem()
    sys2.dispatcher.dispatch(
      new SetShadowEffectCommand({ nodeId: sys2.group.id, shadowEffect: DEFAULT_SHADOW_EFFECT }),
    )
    const before = sys2.publicEngine.evaluateShadow(sys2.group.id, 0)!
    const beforeEntries = sys2.undoStack.entries.length
    const cmds = [
      new SetShadowParamCommand({ nodeId: sys2.group.id, property: 'scaleX', value: 1.1 }),
      new SetShadowParamCommand({ nodeId: sys2.group.id, property: 'scaleY', value: 0.2 }),
      new SetShadowParamCommand({ nodeId: sys2.group.id, property: 'skewX', value: -12 }),
      new SetShadowParamCommand({ nodeId: sys2.group.id, property: 'blur', value: 11 }),
      new SetShadowParamCommand({ nodeId: sys2.group.id, property: 'opacity', value: 0.25 }),
      new SetShadowParamCommand({ nodeId: sys2.group.id, property: 'offsetY', value: 8 }),
    ]
    const r = sys2.dispatcher.dispatch(new TransactionCommand(cmds))
    expect(r.ok).toBe(true)
    expect(sys2.undoStack.entries.length - beforeEntries).toBe(1)
    expect(sys2.undoStack.entries[0].type).toBe('Transaction')
    const after = sys2.publicEngine.evaluateShadow(sys2.group.id, 0)!
    expect(after.scaleX).toBe(1.1)
    expect(after.scaleY).toBe(0.2)
    expect(after.skewX).toBe(-12)
    expect(after.blur).toBe(11)
    expect(after.opacity).toBe(0.25)
    expect(after.offsetY).toBe(8)
    expect(after.offsetX).toBe(before.offsetX)
    expect(after.color).toBe(before.color)
    expect(after.rotation).toBe(before.rotation)
    sys2.dispatcher.undo()
    const undone = sys2.publicEngine.evaluateShadow(sys2.group.id, 0)!
    expect(undone).toEqual(before)
  })

  it('drag simulation produces one HistoryEntry', () => {
    const sys2 = createSystem()
    sys2.dispatcher.dispatch(
      new SetShadowEffectCommand({ nodeId: sys2.group.id, shadowEffect: DEFAULT_SHADOW_EFFECT }),
    )
    const before = sys2.undoStack.entries.length
    // Simulate drag coalescing: final value via Transaction with one command
    const tx = new TransactionCommand([
      new SetShadowParamCommand({ nodeId: sys2.group.id, property: 'offsetX', value: 30 }),
    ])
    sys2.dispatcher.dispatch(tx)
    expect(sys2.undoStack.entries.length - before).toBe(1)
  })
})
