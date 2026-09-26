import { describe, expect, it } from 'vitest'
import {
  AssignMaterialCommand,
  CreateNodeCommand,
  CreateProjectCommand,
  CreateShapeCommand,
  CreateSlideCommand,
  SetMorphBindingCommand,
  SetShadowEffectCommand,
  SetSlideAnimationScriptCommand,
  TransactionCommand,
  createCommandSystem,
} from '../../engine/commands'
import type { Command, DispatchCommand } from '../../engine/commands'
import { createChartComponent } from '../../engine/chartComponent'
import { createDefaultRectangleMesh } from '../../engine/mesh'
import { DEFAULT_SHADOW_EFFECT } from '../../engine/shadowEffect'
import type { NodeComponents } from '../../engine/components'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import type { AnimationScriptCompileResult } from '../../engine/animationScriptCompiler'
import { runAnimationScript } from '../../engine/animationScriptRun'

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
  options: { components?: NodeComponents; parentId?: string } = {},
): string {
  const slide = system.engine.getSlide(slideId)
  return dispatchOk(
    system,
    new CreateNodeCommand({
      sceneId: slide.scene.id,
      parentId: options.parentId ?? slide.scene.root.id,
      name,
      ...(options.components !== undefined && { components: options.components }),
    }),
  ).nodeId
}

/** A group host: no components, at least one child. */
function addGroup(
  system: System,
  slideId: string,
  name: string,
): { groupId: string; childId: string } {
  const groupId = addNode(system, slideId, name)
  const childId = addNode(system, slideId, `${name} child`, { parentId: groupId })
  dispatchOk(
    system,
    new SetShadowEffectCommand({ nodeId: groupId, shadowEffect: DEFAULT_SHADOW_EFFECT }),
  )
  return { groupId, childId }
}

function addMesh(system: System, slideId: string, name: string): string {
  return addNode(system, slideId, name, {
    components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(10, 10) } },
  })
}

function check(
  system: System,
  slideId: string,
  lines: readonly string[],
): AnimationScriptCompileResult {
  return checkAnimationScript(system.engine, slideId, lines.join('\n'))
}

function apply(system: System, result: AnimationScriptCompileResult): void {
  dispatchOk(system, new TransactionCommand([...result.commands]))
}

function errors(result: AnimationScriptCompileResult) {
  return result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
}

function errorMessages(result: AnimationScriptCompileResult): string {
  return errors(result)
    .map((diagnostic) => diagnostic.message)
    .join('\n')
}

function runOk(system: System, slideId: string, source: string) {
  const result = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
  expect(result.error).toBeNull()
  expect(result.ran).toBe(true)
  return result
}

describe('Animation Script write surface — material parameters', () => {
  it('tweens a continuous material parameter and holds a discrete one by kind', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    system.engine.embedMaterial({
      id: 'mat-mix',
      name: 'Mix',
      description: '',
      tags: [],
      createdAt: '',
      updatedAt: '',
      parameters: [
        { key: 'uGlow', kind: 'number', default: 0 },
        { key: 'uSteps', kind: 'int', default: 1 },
      ],
      shaderId: null,
    })
    dispatchOk(
      system,
      new AssignMaterialCommand({ nodeId: heroId, materialDefinitionId: 'mat-mix' }),
    )

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ uGlow: 1 }, 1, linear)',
      'hero.tween({ uSteps: 4 }, 1, linear)',
    ])
    expect(result.diagnostics).toEqual([])
    apply(system, result)

    expect(system.engine.evaluateMaterialOverrides(heroId, 0.5).uGlow).toBeCloseTo(0.5)
    expect(system.engine.evaluateMaterialOverrides(heroId, 1.5).uSteps).toBe(1)
    expect(system.engine.evaluateMaterialOverrides(heroId, 2).uSteps).toBe(4)
    expect(system.engine.getMaterialKeyframes(heroId, 'uSteps').map((kf) => kf.time)).toEqual([
      0, 1, 2,
    ])
  })

  it('writes the built-in tint and opacityMultiplier tracks any node carries', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ tint: "#ff0000", opacityMultiplier: 0.25 })',
    ])
    expect(result.diagnostics).toEqual([])
    apply(system, result)

    expect(system.engine.evaluateMaterialOverrides(heroId, 0).tint).toBe('#ff0000')
    expect(system.engine.evaluateMaterialOverrides(heroId, 0).opacityMultiplier).toBe(0.25)
  })

  it('writes vector uniforms from list literals', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    system.engine.embedMaterial({
      id: 'mat-vec',
      name: 'Vec',
      description: '',
      tags: [],
      createdAt: '',
      updatedAt: '',
      parameters: [{ key: 'uOffset', kind: 'vec2', default: [0, 0] }],
      shaderId: null,
    })
    dispatchOk(
      system,
      new AssignMaterialCommand({ nodeId: heroId, materialDefinitionId: 'mat-vec' }),
    )

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ uOffset: [1, -2] })',
    ])
    expect(result.diagnostics).toEqual([])
    apply(system, result)

    expect(system.engine.evaluateMaterialOverrides(heroId, 0).uOffset).toEqual([1, -2])
  })

  it('places a boundary pin on a material track written later in the segment', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    system.engine.embedMaterial({
      id: 'mat-glow',
      name: 'Glow',
      description: '',
      tags: [],
      createdAt: '',
      updatedAt: '',
      parameters: [{ key: 'uGlow', kind: 'number', default: 0 }],
      shaderId: null,
    })
    dispatchOk(
      system,
      new AssignMaterialCommand({ nodeId: heroId, materialDefinitionId: 'mat-glow' }),
    )

    const result = check(system, slideId, [
      'script "Demo" from 0.5',
      'bind hero = node("Hero")',
      'wait(0.5)',
      'hero.tween({ uGlow: 2 }, 0.5, linear)',
    ])
    expect(result.diagnostics).toEqual([])
    apply(system, result)

    expect(system.engine.getMaterialKeyframes(heroId, 'uGlow').map((kf) => kf.time)).toEqual([
      0.5, 1, 1.5,
    ])
    expect(system.engine.getMaterialKeyframes(heroId, 'uGlow').map((kf) => kf.value)).toEqual([
      0, 0, 2,
    ])
  })

  it('rejects a parametric ease on a discrete material kind like the engine does', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    system.engine.embedMaterial({
      id: 'mat-steps',
      name: 'Steps',
      description: '',
      tags: [],
      createdAt: '',
      updatedAt: '',
      parameters: [{ key: 'uSteps', kind: 'int', default: 1 }],
      shaderId: null,
    })
    dispatchOk(
      system,
      new AssignMaterialCommand({ nodeId: heroId, materialDefinitionId: 'mat-steps' }),
    )

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ uSteps: 4 }, 1, bounce)',
    ])

    expect(result.runnable).toBe(false)
    expect(errorMessages(result)).toMatch(/discrete material kind "int"/)
  })
})

describe('Animation Script write surface — property key resolution', () => {
  it('names an unknown property key and suggests a near miss', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ opactiy: 1 }, 0.4)',
    ])

    expect(result.runnable).toBe(false)
    expect(errorMessages(result)).toMatch(/Unknown property "opactiy"/)
    expect(errorMessages(result)).toContain('"opacity"')
  })

  it('names an ambiguous key that could mean two targets', () => {
    const { system, slideId } = setup()
    const wedgeId = addNode(system, slideId, 'Wedge', {
      components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 90 } },
    })
    system.engine.embedMaterial({
      id: 'mat-radius',
      name: 'Radius Mat',
      description: '',
      tags: [],
      createdAt: '',
      updatedAt: '',
      parameters: [{ key: 'radius', kind: 'number', default: 1 }],
      shaderId: null,
    })
    dispatchOk(
      system,
      new AssignMaterialCommand({ nodeId: wedgeId, materialDefinitionId: 'mat-radius' }),
    )

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind wedge = node("Wedge")',
      'wedge.set({ radius: 5 })',
    ])

    expect(result.runnable).toBe(false)
    expect(errorMessages(result)).toMatch(/ambiguous/i)
    expect(errorMessages(result)).toContain('"radius"')
  })

  it('never writes the visible lane and rejects it by name', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')

    const visible = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.set({ visible: 1 })',
    ])
    expect(visible.runnable).toBe(false)
    expect(errorMessages(visible)).toMatch(/visible/)

    const clean = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ opacity: 0 }, 0.4)',
    ])
    expect(clean.runnable).toBe(true)
    expect(
      clean.commands.some(
        (command) =>
          (command.parameters.target as { kind?: string } | undefined)?.kind === 'visible',
      ),
    ).toBe(false)
    expect(system.engine.getVisibleKeyframes(heroId)).toHaveLength(0)
  })
})

describe('Animation Script write surface — circle, morph and symmetry', () => {
  it('tweens circle radius, startAngle and endAngle on the circle track kind', () => {
    const { system, slideId } = setup()
    const wedgeId = addNode(system, slideId, 'Wedge', {
      components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 90 } },
    })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind wedge = node("Wedge")',
      'wedge.tween({ radius: 20, startAngle: 45, endAngle: 180 }, 1, linear)',
    ])
    expect(result.diagnostics).toEqual([])
    apply(system, result)

    expect(system.engine.getCircleKeyframes(wedgeId, 'radius').map((kf) => kf.value)).toEqual([
      10, 20,
    ])
    const state = system.engine.evaluateCircle(wedgeId, 0.5)
    expect(state).toMatchObject({ radius: 15, startAngle: 22.5, endAngle: 135 })
  })

  it('rejects the excluded circle segments key', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Wedge', {
      components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 90 } },
    })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind wedge = node("Wedge")',
      'wedge.set({ segments: 32 })',
    ])

    expect(result.runnable).toBe(false)
    expect(errorMessages(result)).toMatch(/segments/)
  })

  it('tweens morphCoefficient against the node Morph Binding', () => {
    const { system, slideId } = setup()
    const faceId = addMesh(system, slideId, 'Face')
    const base = dispatchOk(system, new CreateShapeCommand({ nodeId: faceId, name: 'Base' }))
    const smile = dispatchOk(system, new CreateShapeCommand({ nodeId: faceId, name: 'Smile' }))
    dispatchOk(
      system,
      new SetMorphBindingCommand({
        nodeId: faceId,
        binding: { fromShapeId: base.shapeId, toShapeId: smile.shapeId },
      }),
    )

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind face = node("Face")',
      'face.morph(1, 1, linear)',
    ])
    expect(result.diagnostics).toEqual([])
    apply(system, result)

    const keyframes = system.engine.getMorphKeyframes(faceId)
    expect(keyframes.map((kf) => kf.time)).toEqual([0, 1])
    expect(keyframes[0].value).toMatchObject({
      fromShapeId: base.shapeId,
      toShapeId: smile.shapeId,
      coefficient: 0,
    })
    expect(system.engine.evaluateMorph(faceId, 0.5)).toBeCloseTo(0.5)
  })

  it('also writes morphCoefficient through the property map', () => {
    const { system, slideId } = setup()
    const faceId = addMesh(system, slideId, 'Face')
    const base = dispatchOk(system, new CreateShapeCommand({ nodeId: faceId, name: 'Base' }))
    const smile = dispatchOk(system, new CreateShapeCommand({ nodeId: faceId, name: 'Smile' }))
    dispatchOk(
      system,
      new SetMorphBindingCommand({
        nodeId: faceId,
        binding: { fromShapeId: base.shapeId, toShapeId: smile.shapeId },
      }),
    )

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind face = node("Face")',
      'face.set({ morphCoefficient: 0.25 })',
    ])
    expect(result.diagnostics).toEqual([])
    apply(system, result)

    expect(system.engine.evaluateMorph(faceId, 0)).toBeCloseTo(0.25)
  })

  it('requires a Morph Binding before morph writes', () => {
    const { system, slideId } = setup()
    const faceId = addMesh(system, slideId, 'Face')
    dispatchOk(system, new CreateShapeCommand({ nodeId: faceId, name: 'Base' }))

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind face = node("Face")',
      'face.morph(1, 1)',
    ])

    expect(result.runnable).toBe(false)
    expect(errorMessages(result)).toMatch(/Morph Binding/)
  })

  it('tweens symmetry axis and factor on the symmetry track kind', () => {
    const { system, slideId } = setup()
    const faceId = addMesh(system, slideId, 'Face')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind face = node("Face")',
      'face.symmetry({ axis: "x", factor: 1 }, 1, linear)',
    ])
    expect(result.diagnostics).toEqual([])
    apply(system, result)

    expect(system.engine.evaluateSymmetry(faceId, 0.5)).toEqual({ axis: 'x', factor: 0.5 })
  })
})

describe('Animation Script write surface — shadow and data labels', () => {
  it('tweens shadow parameters on a group carrying a Shadow Effect', () => {
    const { system, slideId } = setup()
    const { groupId } = addGroup(system, slideId, 'Backdrop')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind backdrop = node("Backdrop")',
      'backdrop.shadow({ opacity: 0.8, blur: 16, color: "#112233" }, 1, linear)',
    ])
    expect(result.diagnostics).toEqual([])
    apply(system, result)

    expect(system.engine.getShadowKeyframes(groupId, 'opacity').map((kf) => kf.value)).toEqual([
      0.35, 0.8,
    ])
    expect(system.engine.getShadowKeyframes(groupId, 'blur').map((kf) => kf.value)).toEqual([8, 16])
    expect(system.engine.getShadowKeyframes(groupId, 'color').map((kf) => kf.value)).toEqual([
      '#000000',
      '#112233',
    ])
    expect(system.engine.evaluateShadow(groupId, 0.5)?.opacity).toBeCloseTo(0.575)
  })

  it('rejects shadow writes without a Shadow Effect', () => {
    const { system, slideId } = setup()
    const plainId = addNode(system, slideId, 'Plain')
    addNode(system, slideId, 'Plain child', { parentId: plainId })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind plain = node("Plain")',
      'plain.shadow({ opacity: 0.5 }, 1)',
    ])

    expect(result.runnable).toBe(false)
    expect(errorMessages(result)).toMatch(/Shadow Effect/)
  })

  it('tweens a chart data label by name', () => {
    const { system, slideId } = setup()
    const chartId = addNode(system, slideId, 'Chart', {
      components: { chart: createChartComponent('bar', 'ds-1', undefined, ['value']) },
    })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind chart = node("Chart")',
      'chart.dataLabel("value", 42, 1, linear)',
    ])
    expect(result.diagnostics).toEqual([])
    apply(system, result)

    expect(system.engine.getDataLabelKeyframes(chartId, 'value').map((kf) => kf.value)).toEqual([
      0, 42,
    ])
    expect(system.engine.evaluateDataLabels(chartId, 0.5).get('value')).toBeCloseTo(21)
  })

  it('rejects duration suffixes on positional and record values', () => {
    const { system, slideId } = setup()
    const faceId = addMesh(system, slideId, 'Face')
    const base = dispatchOk(system, new CreateShapeCommand({ nodeId: faceId, name: 'Base' }))
    const smile = dispatchOk(system, new CreateShapeCommand({ nodeId: faceId, name: 'Smile' }))
    dispatchOk(
      system,
      new SetMorphBindingCommand({
        nodeId: faceId,
        binding: { fromShapeId: base.shapeId, toShapeId: smile.shapeId },
      }),
    )
    addNode(system, slideId, 'Chart', {
      components: { chart: createChartComponent('bar', 'ds-1', undefined, ['value']) },
    })

    const morph = check(system, slideId, [
      'script "Demo" from 0',
      'bind face = node("Face")',
      'face.morph(1s, 1)',
    ])
    const dataLabel = check(system, slideId, [
      'script "Demo" from 0',
      'bind chart = node("Chart")',
      'chart.dataLabel("value", 1s, 1)',
    ])
    const symmetry = check(system, slideId, [
      'script "Demo" from 0',
      'bind face = node("Face")',
      'face.symmetry({ axis: "x", factor: 1s }, 1)',
    ])

    expect(errorMessages(morph)).toMatch(/duration suffix/)
    expect(errorMessages(dataLabel)).toMatch(/duration suffix/)
    expect(errorMessages(symmetry)).toMatch(/duration suffix/)
  })

  it('names an unknown data label with near-miss candidates', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Chart', {
      components: { chart: createChartComponent('bar', 'ds-1', undefined, ['value']) },
    })

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind chart = node("Chart")',
      'chart.dataLabel("valu", 42, 1)',
    ])

    expect(result.runnable).toBe(false)
    expect(errorMessages(result)).toMatch(/No data label "valu"/)
    expect(errorMessages(result)).toContain('"value"')
  })
})

describe('Animation Script write surface — re-run on the new track kinds', () => {
  it('replaces its own output instead of duplicating it', () => {
    const { system, slideId } = setup()
    const wedgeId = addNode(system, slideId, 'Wedge', {
      components: { circle: { kind: 'circle', radius: 10, startAngle: 0, endAngle: 90 } },
    })
    const source = [
      'script "Demo" from 0.5',
      'bind wedge = node("Wedge")',
      'wedge.tween({ radius: 20, tint: "#ff0000" }, 0.5, linear)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    runOk(system, slideId, source)
    const radiusAfterFirst = system.engine
      .getCircleKeyframes(wedgeId, 'radius')
      .map((keyframe) => [keyframe.time, keyframe.value])
    const tintAfterFirst = system.engine
      .getMaterialKeyframes(wedgeId, 'tint')
      .map((keyframe) => [keyframe.time, keyframe.value])

    runOk(system, slideId, source)

    expect(
      system.engine
        .getCircleKeyframes(wedgeId, 'radius')
        .map((keyframe) => [keyframe.time, keyframe.value]),
    ).toEqual(radiusAfterFirst)
    expect(
      system.engine
        .getMaterialKeyframes(wedgeId, 'tint')
        .map((keyframe) => [keyframe.time, keyframe.value]),
    ).toEqual(tintAfterFirst)
    expect(system.engine.getCircleKeyframes(wedgeId, 'radius')).toHaveLength(2)
  })
})

describe('Animation Script write surface — static text', () => {
  it('changes text content in the run Transaction and undo reverts it with the run', () => {
    const { system, slideId } = setup()
    const captionId = addNode(system, slideId, 'Caption', {
      components: { text: { kind: 'text', content: 'Old', fontSize: 24, alignment: 'left' } },
    })
    const heroId = addNode(system, slideId, 'Hero')
    const source = [
      'script "Demo" from 0',
      'bind caption = node("Caption")',
      'bind hero = node("Hero")',
      'setText(caption, "New text")',
      'hero.tween({ x: 5 }, 0.4)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))

    runOk(system, slideId, source)

    expect(system.engine.getNode(captionId).components.text?.content).toBe('New text')
    expect(system.engine.getKeyframes(heroId, 'positionX')).toHaveLength(2)

    expect(system.dispatcher.undo()).toBe(true)
    expect(system.engine.getNode(captionId).components.text?.content).toBe('Old')
    expect(system.engine.getKeyframes(heroId, 'positionX')).toHaveLength(0)

    expect(system.dispatcher.redo()).toBe(true)
    expect(system.engine.getNode(captionId).components.text?.content).toBe('New text')
    expect(system.engine.getKeyframes(heroId, 'positionX')).toHaveLength(2)
  })

  it('rejects setText on a node without a text component', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'setText(hero, "Hi")',
    ])

    expect(result.runnable).toBe(false)
    expect(errorMessages(result)).toMatch(/text component/)
  })
})
