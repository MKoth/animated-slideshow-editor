import { describe, expect, it } from 'vitest'
import {
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

type System = ReturnType<typeof createCommandSystem>

const CHALK_PARAMETERS = [
  { key: 'tint', kind: 'color', default: '#ffffff' },
  { key: 'opacityMultiplier', kind: 'number', default: 1 },
  { key: 'uGrain', kind: 'float', default: 0.65 },
] as const

function setup() {
  const system = createCommandSystem(() => {})
  dispatchOk(system, new CreateProjectCommand({ name: 'Lesson' }))
  dispatchOk(system, new CreateSlideCommand({ name: 'Slide 1' }))
  const slide = system.engine.getActiveSlide()
  if (!slide) throw new Error('expected an active slide')
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

function registerChalk(system: System): void {
  system.materialLibrarySync.apply([
    {
      id: 'mat-chalk',
      name: 'Chalk',
      parameters: CHALK_PARAMETERS,
      shader_id: 'shader-chalk',
    },
  ])
}

function nodeNamed(system: System, slideId: string, name: string): SceneNode {
  const slide = system.engine.getSlide(slideId)
  const matches = [...walkPreOrder(slide.scene.root)].filter((node) => node.name === name)
  if (matches.length !== 1) throw new Error(`expected one "${name}", found ${matches.length}`)
  return matches[0]
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

describe('Animation Script material bindings and assignment', () => {
  it('assigns a bound material to a created group', () => {
    const { system, slideId } = setup()
    registerChalk(system)
    const source = [
      'script "Board" from 0',
      'bind chalk = material("Chalk")',
      'create group "Board" as board',
      'board.material(chalk)',
    ].join('\n')

    runOk(system, slideId, source)

    expect(nodeNamed(system, slideId, 'Board').material.materialDefinitionId).toBe('mat-chalk')
  })

  it('lists the referenced material for run prep embedding', () => {
    const { system, slideId } = setup()
    registerChalk(system)
    const source = [
      'script "Board" from 0',
      'bind chalk = material("Chalk")',
      'create group "Board" as board',
      'board.material(chalk)',
    ].join('\n')

    const result = checkAnimationScript(system.engine, slideId, source)

    expect(result.runnable).toBe(true)
    expect(result.creations.materials).toEqual([{ id: 'mat-chalk', name: 'Chalk' }])
  })

  it('embeds a library material through the capture seam before dispatch', async () => {
    const { system, slideId } = setup()
    registerChalk(system)
    const source = [
      'script "Board" from 0',
      'bind chalk = material("Chalk")',
      'create group "Board" as board',
      'board.material(chalk)',
    ].join('\n')
    const result = await runAnimationScriptAsync(
      system.engine,
      boundDispatch(system),
      slideId,
      source,
      {
        captureMaterial: (definitionId) => {
          if (definitionId !== 'mat-chalk') return false
          system.engine.embedMaterial({
            id: 'mat-chalk',
            name: 'Chalk',
            description: '',
            tags: ['built-in'],
            createdAt: '2026-01-01T00:00:00',
            updatedAt: '2026-01-01T00:00:00',
            parameters: [...CHALK_PARAMETERS],
            shaderId: 'shader-chalk',
          })
          return true
        },
      },
    )

    expect(result.ran).toBe(true)
    expect(system.engine.getEmbeddedMaterial('mat-chalk')).toBeDefined()
    expect(nodeNamed(system, slideId, 'Board').material.materialDefinitionId).toBe('mat-chalk')
  })

  it('broadcasts the assignment across a semantic group binding', () => {
    const { system, slideId } = setup()
    registerChalk(system)
    dispatchOk(
      system,
      new SetSlideAnimationScriptCommand({
        slideId,
        source: [
          'script "Board" from 0',
          'create group "A" as a { semanticName: "board" }',
          'create group "B" as b { semanticName: "board" }',
          'bind boards = group("board")',
          'bind chalk = material("Chalk")',
          'boards.material(chalk)',
        ].join('\n'),
      }),
    )
    const source = system.engine.getSlide(slideId).animationScript!.source

    runOk(system, slideId, source)

    expect(nodeNamed(system, slideId, 'A').material.materialDefinitionId).toBe('mat-chalk')
    expect(nodeNamed(system, slideId, 'B').material.materialDefinitionId).toBe('mat-chalk')
  })

  it('reports an unknown material with a near-miss suggestion', () => {
    const { system, slideId } = setup()
    registerChalk(system)
    const checked = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Board" from 0', 'bind chalk = material("Chalkk")'].join('\n'),
    )

    expect(checked.runnable).toBe(false)
    expect(
      checked.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('No material named "Chalkk"'),
      ),
    ).toBe(true)
    expect(checked.diagnostics.some((diagnostic) => diagnostic.message.includes('Chalk'))).toBe(
      true,
    )
  })

  it('rejects a non-material argument and a non-node receiver', () => {
    const { system, slideId } = setup()
    registerChalk(system)
    const checked = checkAnimationScript(
      system.engine,
      slideId,
      [
        'script "Board" from 0',
        'bind chalk = material("Chalk")',
        'create group "Board" as board',
        'board.material("Chalk")',
        'chalk.material(chalk)',
      ].join('\n'),
    )

    expect(checked.runnable).toBe(false)
    expect(
      checked.diagnostics.some((diagnostic) =>
        diagnostic.message.includes('material needs a material binding'),
      ),
    ).toBe(true)
    expect(
      checked.diagnostics.some((diagnostic) => diagnostic.message.includes('needs a node binding')),
    ).toBe(true)
  })

  it('threads a material through a typed function parameter', () => {
    const { system, slideId } = setup()
    registerChalk(system)
    const source = [
      'script "Board" from 0',
      'bind chalk = material("Chalk")',
      'create group "Board" as board',
      'function paint(target: node, paint: material) { target.material(paint) }',
      'paint(board, chalk)',
    ].join('\n')

    runOk(system, slideId, source)

    expect(nodeNamed(system, slideId, 'Board').material.materialDefinitionId).toBe('mat-chalk')
  })

  it('warns when a material binding is never used', () => {
    const { system, slideId } = setup()
    registerChalk(system)
    const checked = checkAnimationScript(
      system.engine,
      slideId,
      ['script "Board" from 0', 'bind chalk = material("Chalk")'].join('\n'),
    )

    expect(checked.runnable).toBe(true)
    expect(
      checked.diagnostics.some(
        (diagnostic) =>
          diagnostic.severity === 'warning' &&
          diagnostic.message.includes('Binding "chalk" is never used'),
      ),
    ).toBe(true)
  })
})
