import { describe, it, expect, vi } from 'vitest'
import { DEFAULT_SHADOW_EFFECT } from '../engine/shadowEffect'
import { isGroupNode, SceneNode, walkPreOrder } from '../engine/sceneNode'
import { deserialize, serialize } from '../engine/lessonSerializer'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { SetShadowEffectCommand } from '../engine/commands'

function createSystem() {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const publicEngine = toReadOnly(engine)
  return { engine, publicEngine, dispatcher, undoStack }
}

describe('ShadowEffect tracer bullet #298', () => {
  it('SceneNode gains optional shadowEffect beside visible/opacity/material, checked via isGroupNode && shadowEffect', () => {
    const { engine } = createSystem()
    engine.createProject({ name: 'Test' })
    const slide = engine.createSlide('S1')
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group')
    engine.createNode(slide.scene.id, group.id, 'Circle1', {
      components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } },
    })
    engine.createNode(slide.scene.id, group.id, 'Mesh1', {
      components: { mesh: { kind: 'mesh', mesh: { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], faces: [{ v0: 0, v1: 1, v2: 2 }], uvs: [] } } },
    })
    expect(isGroupNode(group)).toBe(true)
    expect((group as SceneNode).shadowEffect).toBeUndefined()
    expect(isGroupNode(group) && !!(group as SceneNode).shadowEffect).toBe(false)
    // Enable via dispatcher
    const sys = createSystem()
    sys.engine.createProject({ name: 'Demo' })
    const s = sys.engine.createSlide('Slide')
    const g = sys.engine.createNode(s.scene.id, s.scene.root.id, 'G2')
    sys.engine.createNode(s.scene.id, g.id, 'C1', { components: { circle: { kind: 'circle', radius: 5, startAngle: 0, endAngle: 360 } } })
    sys.engine.createNode(s.scene.id, g.id, 'C2', { components: { mesh: { kind: 'mesh', mesh: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], faces: [{ v0: 0, v1: 1, v2: 2 }], uvs: [] } } } })
    sys.engine.createNode(s.scene.id, g.id, 'C3', { components: { circle: { kind: 'circle', radius: 8, startAngle: 0, endAngle: 180 } } })
    expect(isGroupNode(g)).toBe(true)
    const result = sys.dispatcher.dispatch(new SetShadowEffectCommand({ nodeId: g.id, shadowEffect: DEFAULT_SHADOW_EFFECT }))
    expect(result.ok).toBe(true)
    expect(sys.engine.getNode(g.id).shadowEffect).toEqual(DEFAULT_SHADOW_EFFECT)
    expect(isGroupNode(g) && !!sys.engine.getNode(g.id).shadowEffect).toBe(true)
    expect(sys.engine.evaluateShadow(g.id, 0)).toEqual(DEFAULT_SHADOW_EFFECT)
    expect(sys.publicEngine.evaluateShadow(g.id, 0)).toEqual(DEFAULT_SHADOW_EFFECT)
  })

  it('NodeJSON carries shadowEffect full ten-field struct when present; tolerant load clamps', () => {
    const { engine } = createSystem()
    engine.createProject({ name: 'Proj' })
    const slide = engine.createSlide('Slide1')
    const group = engine.createNode(slide.scene.id, slide.scene.root.id, 'Group')
    engine.createNode(slide.scene.id, group.id, 'A', { components: { circle: { kind: 'circle', radius: 5, startAngle: 0, endAngle: 360 } } })
    engine.createNode(slide.scene.id, group.id, 'B', { components: { mesh: { kind: 'mesh', mesh: { vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], faces: [{ v0: 0, v1: 1, v2: 2 }], uvs: [] } } } })
    const sys = createSystem()
    sys.engine.createProject({ name: 'P' })
    const s = sys.engine.createSlide('S')
    const g = sys.engine.createNode(s.scene.id, s.scene.root.id, 'Grp')
    sys.engine.createNode(s.scene.id, g.id, 'C1', { components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } } })
    sys.engine.createNode(s.scene.id, g.id, 'C2', { components: { mesh: { kind: 'mesh', mesh: { vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }], faces: [{ v0: 0, v1: 1, v2: 2 }], uvs: [] } } } })
    sys.dispatcher.dispatch(new SetShadowEffectCommand({ nodeId: g.id, shadowEffect: DEFAULT_SHADOW_EFFECT }))
    const json = g.toJSON()
    expect(json.shadowEffect).toBeDefined()
    expect(json.shadowEffect).toEqual(DEFAULT_SHADOW_EFFECT)
    // Round-trip
    const recovered = SceneNode.fromJSON(json)
    expect(recovered.shadowEffect).toEqual(DEFAULT_SHADOW_EFFECT)
    // Tolerant load: bad values warn + clamp
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const badJson = { ...json, shadowEffect: { offsetX: NaN, offsetY: Infinity, scaleX: NaN, scaleY: Infinity, skewX: NaN, skewY: NaN, rotation: NaN, blur: 100, opacity: 5, color: 'bad' } }
    const badNode = SceneNode.fromJSON(badJson as any)
    expect(badNode.shadowEffect?.blur).toBe(32) // clamped to 32? our clamp does 32 for >32
    // For our implementation blur 100 -> 32, opacity 5 -> 1, color bad -> #000000, offset NaN ->0, scale NaN ->1
    expect(badNode.shadowEffect?.opacity).toBe(1)
    expect(badNode.shadowEffect?.color).toBe('#000000')
    expect(badNode.shadowEffect?.offsetX).toBe(0)
    expect(badNode.shadowEffect?.scaleX).toBe(1)
    warn.mockRestore()
    // Legacy file without shadow opens without error (missing = no shadow)
    const legacyJson = { ...json }
    delete (legacyJson as any).shadowEffect
    const legacyNode = SceneNode.fromJSON(legacyJson as any)
    expect(legacyNode.shadowEffect).toBeUndefined()
  })

  it('SetShadowEffect command enable/disable with one HistoryEntry + undo/redo', () => {
    const sys = createSystem()
    sys.engine.createProject({ name: 'X' })
    const slide = sys.engine.createSlide('Slide')
    const group = sys.engine.createNode(slide.scene.id, slide.scene.root.id, 'Group')
    sys.engine.createNode(slide.scene.id, group.id, 'C1', { components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 360 } } })
    sys.engine.createNode(slide.scene.id, group.id, 'C2', { components: { circle: { kind: 'circle', radius: 12, startAngle: 0, endAngle: 180 } } })
    sys.engine.createNode(slide.scene.id, group.id, 'C3', { components: { mesh: { kind: 'mesh', mesh: { vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], faces: [{ v0: 0, v1: 1, v2: 2 }, { v0: 0, v1: 2, v2: 3 }], uvs: [] } } } })
    const before = sys.undoStack.entries.length
    const result = sys.dispatcher.dispatch(new SetShadowEffectCommand({ nodeId: group.id, shadowEffect: DEFAULT_SHADOW_EFFECT }))
    expect(result.ok).toBe(true)
    expect(sys.undoStack.entries.length).toBe(before + 1)
    expect(sys.undoStack.entries[0].type).toBe('SetShadowEffect')
    expect(sys.engine.getNode(group.id).shadowEffect).toEqual(DEFAULT_SHADOW_EFFECT)
    // JSON round-trip
    const json = sys.engine.getNode(group.id).toJSON()
    expect(json.shadowEffect).toEqual(DEFAULT_SHADOW_EFFECT)
    // Undo
    const undone = sys.dispatcher.undo()
    expect(undone).toBe(true)
    expect(sys.engine.getNode(group.id).shadowEffect).toBeUndefined()
    expect(sys.engine.evaluateShadow(group.id, 0)).toBeNull()
    // Redo
    const redone = sys.dispatcher.redo()
    expect(redone).toBe(true)
    expect(sys.engine.getNode(group.id).shadowEffect).toEqual(DEFAULT_SHADOW_EFFECT)
    // Disable
    const result2 = sys.dispatcher.dispatch(new SetShadowEffectCommand({ nodeId: group.id, shadowEffect: null }))
    expect(result2.ok).toBe(true)
    expect(sys.engine.getNode(group.id).shadowEffect).toBeUndefined()
    // Undo disable -> re-enable
    sys.dispatcher.undo()
    expect(sys.engine.getNode(group.id).shadowEffect).toEqual(DEFAULT_SHADOW_EFFECT)
  })

  it('legacy file without shadow deserializes and serializes correctly', () => {
    const sys = createSystem()
    sys.engine.createProject({ name: 'Legacy' })
    const slide = sys.engine.createSlide('S')
    const group = sys.engine.createNode(slide.scene.id, slide.scene.root.id, 'Group')
    sys.engine.createNode(slide.scene.id, group.id, 'C1', { components: { circle: { kind: 'circle', radius: 5, startAngle: 0, endAngle: 360 } } })
    // Serialize without shadow
    const text = serialize(sys.engine.project!)
    const parsed = JSON.parse(text)
    // Ensure no shadowEffect in JSON
    const groupJson = parsed.slides[0].scene.nodes.find((n: any) => n.name === 'Group')
    expect(groupJson.shadowEffect).toBeUndefined()
    // Deserialize legacy (no shadow)
    const project = deserialize(text)
    // Find group via walk
    let found: any = null
    for (const n of walkPreOrder(project.slides[0].scene.root)) {
      if (n.name === 'Group') found = n
    }
    expect(found).toBeDefined()
    expect(found.shadowEffect).toBeUndefined()
  })
})
