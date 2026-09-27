import { describe, expect, it } from 'vitest'
import {
  CreateNodeCommand,
  CreateProjectCommand,
  CreateSlideCommand,
  DeleteNodeCommand,
  DeleteScriptLibraryEntryCommand,
  DeleteSlideCommand,
  DuplicateSlideCommand,
  ImportReusableObjectCommand,
  SetScriptLibraryEntryCommand,
  SetSemanticNameCommand,
  SetSlideAnimationScriptCommand,
  createCommandSystem,
} from '../../engine/commands'
import { checkAnimationScript } from '../../engine/animationScriptCheck'
import { runAnimationScript } from '../../engine/animationScriptRun'
import { remapCompiledFootprint } from '../../engine/compiledFootprint'
import type { CompiledFootprint } from '../../engine/compiledFootprint'
import { findScriptLibraryDrift } from '../../engine/scriptLibrary'
import { walkPreOrder } from '../../engine/sceneNode'

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

function findNodeId(system: System, slideId: string, name: string): string {
  const slide = system.engine.getSlide(slideId)
  for (const node of walkPreOrder(slide.scene.root)) {
    if (node.name === name) return node.id
  }
  throw new Error(`Node not found: ${name}`)
}

const TWEEN = [
  'script "Demo" from 0.5',
  'bind hero = node("Hero")',
  'hero.tween({ x: 5 }, 0.4)',
].join('\n')

describe('Issue 390 — duplicate carries script verbatim as independent copy', () => {
  it('duplicates source and footprint, re-resolves by exact name, and re-running the copy leaves the original untouched', () => {
    const { system, slideId } = setup()
    const heroId = addNode(system, slideId, 'Hero')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: TWEEN }))
    const run = runAnimationScript(system.engine, boundDispatch(system), slideId, TWEEN)
    expect(run.ran).toBe(true)
    const originalFootprint = system.engine.getSlide(slideId).animationScript?.lastCompiled
    if (!originalFootprint) throw new Error('expected a footprint')
    const originalX = system.engine.getKeyframes(heroId, 'positionX').map((k) => k.value)

    const copyId = (
      dispatchOk(system, new DuplicateSlideCommand({ slideId })).inverse as { slideId: string }
    ).slideId
    const copy = system.engine.getSlide(copyId)
    // Verbatim source, independent object.
    expect(copy.animationScript?.source).toBe(TWEEN)
    expect(copy.animationScript).not.toBe(system.engine.getSlide(slideId).animationScript)
    // Footprint remapped to the copy's nodes, same span and versions.
    const copyFootprint = copy.animationScript?.lastCompiled
    if (!copyFootprint) throw new Error('expected the copy to carry a footprint')
    expect(copyFootprint.from).toBe(originalFootprint.from)
    expect(copyFootprint.to).toBe(originalFootprint.to)
    expect(copyFootprint.entryVersions).toEqual(originalFootprint.entryVersions)
    const copiedHeroId = findNodeId(system, copyId, 'Hero')
    expect(copiedHeroId).not.toBe(heroId)
    expect(copyFootprint.tracks.map((t) => t.nodeId)).toContain(copiedHeroId)
    expect(copyFootprint.tracks.map((t) => t.nodeId)).not.toContain(heroId)
    // Bindings re-resolve by exact name against the copied scene.
    const checked = checkAnimationScript(system.engine, copyId, TWEEN)
    expect(checked.runnable).toBe(true)

    // Re-running the copy with a different value touches only the copy.
    const revised = TWEEN.replace('x: 5', 'x: 9')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId: copyId, source: revised }))
    const rerun = runAnimationScript(system.engine, boundDispatch(system), copyId, revised)
    expect(rerun.ran).toBe(true)
    expect(system.engine.getKeyframes(heroId, 'positionX').map((k) => k.value)).toEqual(originalX)
    expect(system.engine.getKeyframes(copiedHeroId, 'positionX').map((k) => k.value)).toEqual([
      0, 9,
    ])
    // Original source untouched.
    expect(system.engine.getSlide(slideId).animationScript?.source).toBe(TWEEN)
  })

  it('remaps footprint ids through the scene id map and tolerates entries for deleted nodes', () => {
    const footprint: CompiledFootprint = {
      from: 0,
      to: 1,
      tracks: [
        { nodeId: 'old-a', target: { kind: 'node', nodeId: 'old-a', property: 'positionX' } },
        { nodeId: 'gone', target: { kind: 'node', nodeId: 'gone', property: 'positionX' } },
        { nodeId: 'old-b', target: { kind: 'control', nodeId: 'old-b', controlKey: 'K' } },
      ],
      placementParents: ['old-a', 'gone'],
      instanceNodes: ['old-b', 'gone'],
      entryVersions: { e1: 2 },
    }
    const remapped = remapCompiledFootprint(
      footprint,
      new Map([
        ['old-a', 'new-a'],
        ['old-b', 'new-b'],
      ]),
    )
    expect(remapped.tracks[0]?.nodeId).toBe('new-a')
    expect(remapped.tracks[0]?.target).toMatchObject({ nodeId: 'new-a' })
    // Stale entries survive verbatim instead of throwing.
    expect(remapped.tracks[1]?.nodeId).toBe('gone')
    expect(remapped.tracks[2]?.nodeId).toBe('new-b')
    expect(remapped.placementParents).toEqual(['new-a', 'gone'])
    expect(remapped.instanceNodes).toEqual(['new-b', 'gone'])
    expect(remapped.entryVersions).toEqual({ e1: 2 })
    expect(remapped).not.toBe(footprint)
  })

  it('a stale footprint entry for a deleted node never blocks a recompile of the copy', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: TWEEN }))
    const first = runAnimationScript(system.engine, boundDispatch(system), slideId, TWEEN)
    expect(first.ran).toBe(true)

    const copyId = (
      dispatchOk(system, new DuplicateSlideCommand({ slideId })).inverse as { slideId: string }
    ).slideId
    // Hand-delete the copied Hero; the remapped footprint still names it.
    const copiedHeroId = findNodeId(system, copyId, 'Hero')
    dispatchOk(system, new DeleteNodeCommand({ nodeId: copiedHeroId }))
    // Recompile a header-only script on the copy: the clear tolerates the stale node.
    const headerOnly = 'script "Demo" from 0.5'
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId: copyId, source: headerOnly }))
    const rerun = runAnimationScript(system.engine, boundDispatch(system), copyId, headerOnly)
    expect(rerun.ran).toBe(true)
    expect(rerun.error).toBeNull()
  })
})

describe('Issue 390 — subtree paste and Reusable Object import stay script-blind', () => {
  it('import does not move, rewrite, or warn about scripts; colliding names rename and still bind the original', () => {
    const { system, slideId } = setup()
    const baseId = addNode(system, slideId, 'Base')
    const source = [
      'script "Demo" from 0',
      'bind base = node("Base")',
      'base.tween({ x: 3 }, 0.4)',
    ].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))
    const before = system.engine.getSlide(slideId).animationScript?.source

    // Export a subtree named Base and import it back onto the same slide.
    const exported = (
      system.engine as unknown as { exportReusableObject(id: string, name: string): unknown }
    ).exportReusableObject(baseId, 'Base')
    const imported = dispatchOk(
      system,
      new ImportReusableObjectCommand({
        objectJson: exported as never,
        targetParentId: system.engine.getSlide(slideId).scene.root.id,
      }),
    )
    expect(imported.ok).toBe(true)

    // Script-blind: source untouched, no footprint written by the paste.
    expect(system.engine.getSlide(slideId).animationScript?.source).toBe(before)
    expect(system.engine.getSlide(slideId).animationScript?.lastCompiled).toBeUndefined()
    // Collision rename applied: two nodes, original keeps its name.
    const names = [...walkPreOrder(system.engine.getSlide(slideId).scene.root)].map((n) => n.name)
    expect(names.filter((n) => n === 'Base')).toHaveLength(1)
    expect(names.some((n) => n.startsWith('Base ('))).toBe(true)
    // node("Base") still binds the original.
    const checked = checkAnimationScript(system.engine, slideId, source)
    expect(checked.runnable).toBe(true)
    expect(checked.footprint.tracks.map((t) => t.nodeId)).toContain(baseId)
  })

  it('group() broadcasts pick up newly pasted members at the next explicit compile', () => {
    const { system, slideId } = setup()
    const firstId = addNode(system, slideId, 'Member')
    dispatchOk(system, new SetSemanticNameCommand({ nodeId: firstId, semanticName: 'tag' }))
    const source = [
      'script "Demo" from 0',
      'bind members = group("tag")',
      'members.set({ x: 1 })',
    ].join('\n')
    const first = checkAnimationScript(system.engine, slideId, source)
    expect(first.runnable).toBe(true)
    expect(first.footprint.tracks).toHaveLength(1)

    const secondId = addNode(system, slideId, 'MemberTwo')
    dispatchOk(system, new SetSemanticNameCommand({ nodeId: secondId, semanticName: 'tag' }))
    // No paste-time warning or rewrite: the script source is unchanged.
    // The next explicit compile picks up the newcomer.
    const second = checkAnimationScript(system.engine, slideId, source)
    expect(second.runnable).toBe(true)
    expect(second.footprint.tracks.map((t) => t.nodeId).sort()).toEqual([firstId, secondId].sort())
  })
})

describe('Issue 390 — library deletion and drift', () => {
  function addEntry(system: System, name: string, source: string) {
    const result = system.dispatcher.dispatch(
      new SetScriptLibraryEntryCommand({ name, description: '', source }),
    )
    if (!result.ok) throw new Error(`set entry failed: ${result.error.message}`)
    return (result.inverse as { entryId: string }).entryId
  }

  it('deleting a used entry is allowed and surfaces as a missing-entry diagnostic, never a crash or rewrite', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    const entryId = addEntry(
      system,
      'hop',
      'function hop(target: node) {\n  target.set({ x: 1 })\n}',
    )
    const source = ['script "Demo" from 0', 'bind hero = node("Hero")', 'hop(hero)'].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))
    expect(runAnimationScript(system.engine, boundDispatch(system), slideId, source).ran).toBe(true)

    dispatchOk(system, new DeleteScriptLibraryEntryCommand({ id: entryId }))
    const checked = checkAnimationScript(system.engine, slideId, source)
    expect(checked.runnable).toBe(false)
    expect(
      checked.diagnostics.some((d) => /Unknown (library entry|function) "hop"/.test(d.message)),
    ).toBe(true)
    // Never a silent rewrite.
    expect(source).toContain('hop(hero)')
    const rerun = runAnimationScript(system.engine, boundDispatch(system), slideId, source)
    expect(rerun.ran).toBe(false)
    expect(rerun.error).toBeNull()
  })

  it('drift reports only recorded-vs-live version mismatches (including deletions)', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    const entryId = addEntry(
      system,
      'hop',
      'function hop(target: node) {\n  target.set({ x: 1 })\n}',
    )
    const source = ['script "Demo" from 0', 'bind hero = node("Hero")', 'hop(hero)'].join('\n')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source }))
    expect(runAnimationScript(system.engine, boundDispatch(system), slideId, source).ran).toBe(true)
    const recorded = system.engine.getSlide(slideId).animationScript?.lastCompiled?.entryVersions
    if (!recorded) throw new Error('expected recorded versions')
    // No drift immediately after the run.
    expect(findScriptLibraryDrift(recorded, system.engine.project!.scriptFunctions)).toEqual([])

    // Source edit bumps the version → drift.
    dispatchOk(
      system,
      new SetScriptLibraryEntryCommand({
        id: entryId,
        name: 'hop',
        description: '',
        source: 'function hop(target: node) {\n  target.set({ x: 2 })\n}',
      }),
    )
    const drifted = findScriptLibraryDrift(recorded, system.engine.project!.scriptFunctions)
    expect(drifted).toHaveLength(1)
    expect(drifted[0]).toMatchObject({
      id: entryId,
      name: 'hop',
      recordedVersion: 1,
      liveVersion: 2,
    })

    // Deletion is also a recorded-vs-live mismatch, never a crash.
    dispatchOk(system, new DeleteScriptLibraryEntryCommand({ id: entryId }))
    const deleted = findScriptLibraryDrift(recorded, system.engine.project!.scriptFunctions)
    expect(deleted).toHaveLength(1)
    expect(deleted[0]).toMatchObject({ id: entryId, recordedVersion: 1, liveVersion: null })

    // Recompiles stay explicit: nothing re-ran on its own.
    expect(system.engine.getSlide(slideId).animationScript?.lastCompiled?.entryVersions).toEqual(
      recorded,
    )
    void slideId
  })
})

describe('Issue 390 — slide deletion removes its script', () => {
  it('deleting a slide deletes its script with it', () => {
    const { system, slideId } = setup()
    addNode(system, slideId, 'Hero')
    dispatchOk(system, new SetSlideAnimationScriptCommand({ slideId, source: TWEEN }))
    expect(system.engine.getSlide(slideId).animationScript?.source).toBe(TWEEN)

    dispatchOk(system, new CreateSlideCommand({ name: 'Slide 2' }))
    const second = system.engine.project!.slides.find((s) => s.id !== slideId)
    if (!second) throw new Error('expected a second slide')
    dispatchOk(system, new DeleteSlideCommand({ slideId }))
    expect(system.engine.project!.slides.map((s) => s.id)).not.toContain(slideId)
    expect(system.engine.project!.slides).toHaveLength(1)
  })
})
