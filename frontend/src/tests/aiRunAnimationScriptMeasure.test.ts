import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { CommandDispatcher, SetSlideAnimationScriptCommand, UndoStack } from '../engine/commands'
import { AiRunAnimationScriptCommand } from '../engine/commands/aiRunAnimationScriptCommand'
import { runAnimationScript } from '../engine/animationScriptRun'
import { setNodeSizeProvider } from '../pixi/renderer/nodeMeasurement'
import type { Command } from '../engine/commands/command'

const SCRIPT_A = [
  'script "A" from 0',
  'create group "B" as b',
  'create text "T" as t at (100, 100) inside b { content: "hello", fontSize: 26 }',
  'reveal(t, at: 1, over: 0.5)',
].join('\n')

// Marks a pre-existing node: the old run's text. Without renderer
// measurement its bounds are unknowable; with it, validation matches Check.
const SCRIPT_B = ['script "B" from 0', 'bind t = node("T")', 'mark(t, at: 5, over: 0.5)'].join('\n')

function setupProject() {
  const engine = createEngineInternal()
  act(() => {
    engine.createProject({ name: 'Demo' })
    engine.createSlide('S')
  })
  const slide = engine.getActiveSlide()
  if (!slide) throw new Error('expected an active slide')
  act(() => {
    engine.setSlideDuration(slide.id, 40)
  })
  return { engine, slideId: slide.id }
}

function applyScriptA() {
  const { engine, slideId } = setupProject()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const dispatchRun = ((command: Command<unknown>) => dispatcher.dispatch(command)) as Parameters<
    typeof runAnimationScript
  >[1]
  act(() => {
    dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId, source: SCRIPT_A }))
  })
  const applied = runAnimationScript(toReadOnly(engine), dispatchRun, slideId, SCRIPT_A)
  expect(applied.ran).toBe(true)
  return { engine, slideId }
}

describe('AiRunAnimationScriptCommand validation seams', () => {
  it('rejects a mark on an unmeasurable pre-existing node without renderer measurement', () => {
    const { engine, slideId } = applyScriptA()

    expect(() =>
      new AiRunAnimationScriptCommand({ slideId, source: SCRIPT_B }).validate(engine),
    ).toThrow(/no visible, measurable renderable content/)
  })

  it('validates the same mark once the renderer measurement seam is available', () => {
    const { engine, slideId } = applyScriptA()

    const unregister = setNodeSizeProvider(() => ({
      width: 100,
      height: 20,
      offsetX: 0,
      offsetY: 0,
    }))
    try {
      expect(() =>
        new AiRunAnimationScriptCommand({ slideId, source: SCRIPT_B }).validate(engine),
      ).not.toThrow()
    } finally {
      unregister()
    }
  })
})
