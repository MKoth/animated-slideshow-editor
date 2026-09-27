import { describe, expect, it } from 'vitest'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DeleteScriptLibraryEntryCommand,
  SetScriptLibraryEntryCommand,
  SetSlideAnimationScriptCommand,
  TransactionCommand,
  createCommandSystem,
} from '../../engine/commands'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { runAnimationScript } from '../../engine/animationScriptRun'
import { deserialize, serialize, validate } from '../../engine/lessonSerializer'
import type { LessonJSON } from '../../engine/json'
import { validateReusableObject } from '../../engine/reusableObject'
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

function dispatchOk(system: System, command: Parameters<System['dispatcher']['dispatch']>[0]) {
  const result = system.dispatcher.dispatch(command)
  if (!result.ok) throw new Error(`command failed: ${result.error.message}`)
  return result
}

function boundDispatch(system: System): import('../../engine/commands').DispatchCommand {
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

function setEntry(system: System, name: string, source: string, description = '', id?: string) {
  const result = system.dispatcher.dispatch(
    new SetScriptLibraryEntryCommand({
      ...(id !== undefined ? { id } : {}),
      name,
      description,
      source,
    }),
  )
  if (!result.ok) throw new Error(`set entry failed: ${result.error.message}`)
  return result
}

function check(system: System, slideId: string, lines: readonly string[]) {
  return checkAnimationScript(system.engine, slideId, lines.join('\n'))
}

function messages(result: AnimationScriptCompileResult): string[] {
  return result.diagnostics.map((d) => d.message)
}

describe('Animation Script library — persistence', () => {
  it('round-trips entries through save/load; a file without the field loads unchanged', () => {
    const { system } = setup()
    setEntry(
      system,
      'hop',
      'function hop(target: node) {\n  target.tween({ x: 1 }, 0.4)\n}',
      'Hop once',
    )
    const json = JSON.parse(serialize(system.engine.project!)) as LessonJSON
    expect(json.library?.scriptFunctions).toHaveLength(1)
    expect(json.library?.scriptFunctions?.[0]).toMatchObject({
      name: 'hop',
      description: 'Hop once',
      version: 1,
    })

    const restored = deserialize(JSON.stringify(json))
    expect(restored.scriptFunctions).toHaveLength(1)
    expect(restored.scriptFunctions[0]).toMatchObject({ name: 'hop', version: 1 })

    // A file without the field loads unchanged (tolerant-additive, no version bump).
    const bare = JSON.parse(JSON.stringify(json)) as Record<string, unknown>
    delete (bare.library as Record<string, unknown>).scriptFunctions
    expect(validate(bare)).toEqual([])
    const restoredBare = deserialize(JSON.stringify(bare))
    expect(restoredBare.scriptFunctions).toEqual([])
  })
})

describe('Animation Script library — names and versions', () => {
  it('blocks duplicate names case-insensitively with a clear error', () => {
    const { system } = setup()
    setEntry(system, 'FillTable', 'function FillTable(target: node) {\n  target.set({ x: 1 })\n}')
    const dup = system.dispatcher.dispatch(
      new SetScriptLibraryEntryCommand({
        name: 'filltable',
        source: 'function filltable(target: node) {\n  target.set({ x: 2 })\n}',
      }),
    )
    expect(dup.ok).toBe(false)
    if (dup.ok) throw new Error('expected duplicate to fail')
    expect(dup.error.message).toMatch(/already exists/i)
  })

  it('bumps version only when source changes', () => {
    const { system } = setup()
    const created = setEntry(
      system,
      'hop',
      'function hop(target: node) {\n  target.tween({ x: 1 }, 0.4)\n}',
      'first',
    )
    const entryId = (created.inverse as { entryId: string }).entryId
    expect(system.engine.getScriptFunction(entryId).version).toBe(1)

    // Description-only edit keeps version.
    dispatchOk(
      system,
      new SetScriptLibraryEntryCommand({
        id: entryId,
        name: 'hop',
        description: 'second',
        source: 'function hop(target: node) {\n  target.tween({ x: 1 }, 0.4)\n}',
      }),
    )
    expect(system.engine.getScriptFunction(entryId).version).toBe(1)
    expect(system.engine.getScriptFunction(entryId).description).toBe('second')

    // Source edit bumps.
    dispatchOk(
      system,
      new SetScriptLibraryEntryCommand({
        id: entryId,
        name: 'hop',
        description: 'second',
        source: 'function hop(target: node) {\n  target.tween({ x: 2 }, 0.4)\n}',
      }),
    )
    expect(system.engine.getScriptFunction(entryId).version).toBe(2)

    // Undo restores version 1.
    system.dispatcher.undo()
    expect(system.engine.getScriptFunction(entryId).version).toBe(1)
    system.dispatcher.redo()
    expect(system.engine.getScriptFunction(entryId).version).toBe(2)
  })

  it('rejects entry source whose function name does not match', () => {
    const { system } = setup()
    const result = system.dispatcher.dispatch(
      new SetScriptLibraryEntryCommand({
        name: 'hop',
        source: 'function skip(target: node) {\n  target.set({ x: 1 })\n}',
      }),
    )
    expect(result.ok).toBe(false)
  })
})

describe('Animation Script library — compile', () => {
  it('compiles a library call as a self-contained unit and records versions', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    setEntry(
      system,
      'hop',
      'function hop(target: node) {\n  target.tween({ x: 1 }, 0.4)\n  wait(0.2)\n}',
    )
    const entry = system.engine.project!.scriptFunctions[0]

    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hop(hero)',
    ])
    expect(messages(result)).toEqual([])
    expect(result.runnable).toBe(true)
    expect(result.summary.to).toBe(0.6)
    expect(result.footprint.entryVersions).toEqual({ [entry.id]: 1 })

    // Run records the same versions on the slide.
    dispatchOk(
      system,
      new SetSlideAnimationScriptCommand({
        slideId,
        source: 'script "Demo" from 0\nbind hero = node("Hero")\nhop(hero)',
      }),
    )
    const src = system.engine.getSlide(slideId).animationScript!.source
    const run = runAnimationScript(system.engine, boundDispatch(system), slideId, src)
    expect(run.ran).toBe(true)
    const footprint = system.engine.getSlide(slideId).animationScript?.lastCompiled
    expect(footprint?.entryVersions).toEqual({ [entry.id]: 1 })
    expect(system.engine.getKeyframes(heroId, 'positionX').length).toBeGreaterThan(0)
  })

  it('errors with near-miss candidates on missing/renamed entries and never rewrites source', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    setEntry(
      system,
      'fillConjugationTable',
      'function fillConjugationTable(target: node) {\n  target.set({ x: 1 })\n}',
    )
    const before = 'script "Demo" from 0\nbind hero = node("Hero")\nfillConjugationTabl(hero)'
    const result = checkAnimationScript(system.engine, slideId, before)
    expect(result.runnable).toBe(false)
    expect(messages(result).some((m) => /Unknown function "fillConjugationTabl"/.test(m))).toBe(
      true,
    )
    expect(messages(result).some((m) => /fillConjugationTable/.test(m))).toBe(true)
    // The source is unchanged.
    expect(before).toContain('fillConjugationTabl(hero)')
  })

  it('keeps library bodies closed: no caller bindings, no caller defaults', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    addNode(system, slideId, 'Other')
    setEntry(system, 'sneaky', 'function sneaky(target: node) {\n  other.tween({ x: 1 }, 0.4)\n}')
    const leaked = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'bind other = node("Other")',
      'sneaky(hero)',
    ])
    expect(leaked.runnable).toBe(false)
    expect(messages(leaked).some((m) => /Unknown binding "other"|cannot compile/.test(m))).toBe(
      true,
    )

    setEntry(system, 'bare', 'function bare(target: node) {\n  target.tween({ x: 1 })\n}')
    // Caller defaults never cross the call boundary.
    const noDefaults = check(system, slideId, [
      'script "Demo" from 0',
      'defaults { duration: 0.9 }',
      'bind hero = node("Hero")',
      'bare(hero)',
    ])
    expect(noDefaults.runnable).toBe(false)
    expect(messages(noDefaults).some((m) => /needs a duration/.test(m))).toBe(true)
  })

  it('rejects local collisions with library entries and recursion', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    setEntry(system, 'hop', 'function hop(target: node) {\n  target.set({ x: 1 })\n}')
    const collision = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'function hop(target: node) {',
      '  target.set({ x: 2 })',
      '}',
    ])
    expect(collision.runnable).toBe(false)
    expect(messages(collision).some((m) => /collides with a library entry/.test(m))).toBe(true)

    setEntry(system, 'loop', 'function loop(target: node) {\n  loop(target)\n}')
    const recursion = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'loop(hero)',
    ])
    expect(recursion.runnable).toBe(false)
    expect(messages(recursion).some((m) => /Recursion/.test(m))).toBe(true)
  })

  it('scopes markers per invocation', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    setEntry(
      system,
      'beat',
      'function beat(target: node) {\n  mark("inner")\n  target.tween({ x: 1 }, 0.4)\n  wait(0.2)\n  at("inner") target.set({ y: 1 })\n}',
    )
    const result = check(system, slideId, [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'beat(hero)',
      'beat(hero)',
    ])
    expect(messages(result)).toEqual([])
    expect(result.summary.to).toBe(1.2)
  })
})

describe('Animation Script library — commands', () => {
  it('CRUDs entries as ordinary undoable commands', () => {
    const { system } = setup()
    const created = setEntry(
      system,
      'hop',
      'function hop(target: node) {\n  target.set({ x: 1 })\n}',
    )
    const entryId = (created.inverse as { entryId: string }).entryId
    // Rename via set with same id.
    dispatchOk(
      system,
      new SetScriptLibraryEntryCommand({
        id: entryId,
        name: 'hopRenamed',
        description: '',
        source: 'function hopRenamed(target: node) {\n  target.set({ x: 1 })\n}',
      }),
    )
    expect(system.engine.getScriptFunction(entryId).name).toBe('hopRenamed')
    system.dispatcher.undo()
    expect(system.engine.getScriptFunction(entryId).name).toBe('hop')
    system.dispatcher.redo()
    expect(system.engine.getScriptFunction(entryId).name).toBe('hopRenamed')

    dispatchOk(system, new DeleteScriptLibraryEntryCommand({ id: entryId }))
    expect(() => system.engine.getScriptFunction(entryId)).toThrow()
    system.dispatcher.undo()
    expect(system.engine.getScriptFunction(entryId).name).toBe('hopRenamed')
  })

  it('composes entry commands into one Transaction and validates like authored source', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    const result = system.dispatcher.dispatch(
      new TransactionCommand([
        new SetScriptLibraryEntryCommand({
          name: 'hop',
          source: 'function hop(target: node) {\n  target.tween({ x: 1 }, 0.4)\n}',
        }),
        new SetSlideAnimationScriptCommand({
          slideId,
          source: 'script "Demo" from 0\nbind hero = node("Hero")\nhop(hero)',
        }),
      ]),
    )
    expect(result.ok).toBe(true)
    const compiled = checkAnimationScript(
      system.engine,
      slideId,
      system.engine.getSlide(slideId).animationScript!.source,
    )
    expect(compiled.runnable).toBe(true)
    // One undo reverts both the entry and the script source.
    system.dispatcher.undo()
    expect(system.engine.project!.scriptFunctions).toHaveLength(0)
  })

  it('exported lesson_object files carry no functions', () => {
    const errors = validateReusableObject({
      version: 1,
      name: 'Rig',
      rootId: 'n1',
      nodes: [
        {
          id: 'n1',
          name: 'Root',
          parentId: null,
          transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
          visible: true,
          components: {},
        },
      ],
      library: {
        scriptFunctions: [{ id: 's1', name: 'hop', description: '', source: '', version: 1 }],
      },
    })
    expect(errors.some((e) => /script function/i.test(e))).toBe(true)
  })

  it('export never writes script functions into lesson_object library', () => {
    const { system } = setup()
    const slide = system.engine.getActiveSlide()!
    const nodeId = addNode(system, slide.id, 'ExportMe')
    setEntry(system, 'hop', 'function hop(target: node) {\n  target.set({ x: 1 })\n}')
    // Access the internal engine for export (project has entries, export must not carry them).
    const internal = system.engine as unknown as {
      exportReusableObject(
        rootId: string,
        name: string,
      ): { library?: { scriptFunctions?: unknown } }
    }
    const exported = internal.exportReusableObject(nodeId, 'ExportMe')
    expect(exported.library?.scriptFunctions).toBeUndefined()
  })
})
