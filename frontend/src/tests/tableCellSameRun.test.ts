import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { walkPreOrder } from '../engine/sceneNode'
import { CommandDispatcher, SetSlideAnimationScriptCommand, UndoStack } from '../engine/commands'
import { AiRunAnimationScriptCommand } from '../engine/commands/aiRunAnimationScriptCommand'
import { runAnimationScript } from '../engine/animationScriptRun'
import type { Command } from '../engine/commands/command'

const OLD_SCRIPT = [
  'script "Old big table" from 0',
  'defaults { duration: 0.5s, ease: easeInOut }',
  'create group "Board" as board',
  'create table "big" as big at (290, 580) inside board { columns: [150, 150, 150, 150], rows: [["", "", "", ""], ["", "", "", ""], ["", "", "", ""], ["", "", "", ""], ["", "", "", ""]], padding: 6, borderWidth: 2, borderColor: "#FFFFFF", background: "transparent" }',
  'reveal(big, at: 1, over: 1.0)',
].join('\n')

const NEW_SCRIPT = [
  'script "New small" from 0',
  'defaults { duration: 0.5s, ease: easeInOut }',
  'create group "Board" as board',
  'create table "small" as small at (320, 580) inside board { columns: [150, 150, 150], rows: [["", "", ""], ["", "", ""], ["", "", ""]], padding: 6, borderWidth: 2, borderColor: "#FFFFFF", background: "transparent" }',
  'create text "c00" as c00 at (5, 5) inside small.cell(0, 0) { content: "Spanish", fontSize: 17 }',
  'create text "c01" as c01 at (5, 5) inside small.cell(0, 1) { content: "Meaning", fontSize: 17 }',
  'reveal(small, at: 1, over: 1.0)',
  'reveal(c00, at: 2, over: 0.5)',
  'reveal(c01, at: 3, over: 0.5)',
].join('\n')

function setupEngine() {
  const engine = createEngineInternal()
  act(() => {
    engine.createProject({ name: 'Demo' })
    engine.createSlide('S')
  })
  const slide = engine.getActiveSlide()
  if (!slide) throw new Error('expected an active slide')
  act(() => {
    engine.setSlideDuration(slide.id, 120)
  })
  return { engine, slideId: slide.id }
}

function dispatchRun(engine: ReturnType<typeof setupEngine>['engine']) {
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  return ((command: Command<unknown>) => dispatcher.dispatch(command)) as Parameters<
    typeof runAnimationScript
  >[1]
}

describe('table cell resolution across runs with recycled ids', () => {
  it('parents same-script cell content into the new table, not the previous run', () => {
    const { engine, slideId } = setupEngine()
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
    act(() => {
      dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId, source: OLD_SCRIPT }))
    })
    const applied = runAnimationScript(toReadOnly(engine), dispatchRun(engine), slideId, OLD_SCRIPT)
    expect(applied.ran).toBe(true)

    // Validating (and running) the new script over the old scene must not
    // throw "Node not found" / "Parent node not found" for recycled ids.
    expect(() =>
      new AiRunAnimationScriptCommand({ slideId, source: NEW_SCRIPT }).validate(engine),
    ).not.toThrow()

    const rerun = runAnimationScript(toReadOnly(engine), dispatchRun(engine), slideId, NEW_SCRIPT)
    expect(rerun.ran).toBe(true)

    // The new cell texts must live under the new table, not the old run's.
    const byName = new Map(
      [...walkPreOrder(engine.getActiveSlide()!.scene.root)].map(
        (node) => [node.name, node] as const,
      ),
    )
    const c00 = byName.get('c00')
    expect(c00).toBeDefined()
    let ancestor = c00!.parent
    const chain: string[] = []
    while (ancestor) {
      chain.push(ancestor.name)
      ancestor = ancestor.parent
    }
    expect(chain).toContain('small')
    expect(chain).not.toContain('big')
  })
})
