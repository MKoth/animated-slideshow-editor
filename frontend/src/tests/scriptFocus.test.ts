import { act } from 'react'
import { describe, expect, it } from 'vitest'
import {
  buildScriptFocus,
  formatScriptErrorPrompt,
  formatScriptRepairPrompt,
  IMPROVE_SCRIPT_PROMPT,
} from '../ai/scriptFocus'
import {
  CommandDispatcher,
  CreatePrompterPartCommand,
  SetSlideAnimationScriptCommand,
  UndoStack,
} from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'

function setupSlide() {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  act(() => {
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Intro')
  })
  const slide = engine.getActiveSlide()
  if (!slide) throw new Error('expected an active slide')
  return { engine, dispatcher, slideId: slide.id }
}

describe('buildScriptFocus', () => {
  it('carries the slide script source plus prompt block windows and text', () => {
    const { engine, dispatcher, slideId } = setupSlide()
    act(() => {
      dispatcher.dispatch(
        new SetSlideAnimationScriptCommand({ slideId, source: 'script "Intro" from 0' }),
      )
      dispatcher.dispatch(
        new CreatePrompterPartCommand({ slideId, text: 'Hello there', duration: 6 }),
      )
      dispatcher.dispatch(
        new CreatePrompterPartCommand({ slideId, text: 'Look at the table', duration: 6 }),
      )
    })

    const focus = buildScriptFocus(toReadOnly(engine), slideId, 'script "Intro" from 0', [])

    expect(focus?.slideId).toBe(slideId)
    expect(focus?.slideName).toBe('Intro')
    expect(focus?.duration).toBe(10)
    expect(focus?.source).toBe('script "Intro" from 0')
    expect(focus?.promptBlocks).toHaveLength(2)
    expect(focus?.promptBlocks[0]).toMatchObject({
      start: 0,
      end: 6,
      text: 'Hello there',
    })
    expect(focus?.promptBlocks[1]).toMatchObject({
      start: 6,
      end: 12,
      text: 'Look at the table',
    })
  })

  it('sends every prompt block so long narrations never read as ending early', () => {
    const { engine, dispatcher, slideId } = setupSlide()
    const count = 80
    const duration = 107
    act(() => {
      for (let index = 0; index < count; index += 1) {
        dispatcher.dispatch(
          new CreatePrompterPartCommand({
            slideId,
            text: `narration ${index}`,
            duration: duration / count,
          }),
        )
      }
    })

    const focus = buildScriptFocus(toReadOnly(engine), slideId, 'script "Intro" from 0', [])

    expect(focus?.promptBlocks).toHaveLength(count)
    expect(focus?.promptBlocks[count - 1]?.end).toBeCloseTo(duration, 6)
  })

  it('maps check diagnostics and returns null for unknown slides', () => {
    const { engine, slideId } = setupSlide()
    const focus = buildScriptFocus(toReadOnly(engine), slideId, 'script "Intro" from 0', [
      { severity: 'error', message: 'needs a duration', line: 2, column: 6 },
    ])
    expect(focus?.diagnostics).toEqual([
      { severity: 'error', line: 2, column: 6, message: 'needs a duration' },
    ])
    expect(buildScriptFocus(toReadOnly(engine), 'missing', 'script "X" from 0', [])).toBeNull()
  })
})

describe('script assistant prompts', () => {
  it('improve prompt asks for narration-fit timing and questions on ambiguity', () => {
    expect(IMPROVE_SCRIPT_PROMPT).toContain('narration')
    expect(IMPROVE_SCRIPT_PROMPT).toContain('mark()')
    expect(IMPROVE_SCRIPT_PROMPT).toContain('reveal(nodeOnly(table))')
    expect(IMPROVE_SCRIPT_PROMPT).toContain('do not add mask-setup wipes')
    expect(IMPROVE_SCRIPT_PROMPT).toContain('Prompter blocks can overlap')
    expect(IMPROVE_SCRIPT_PROMPT).toContain('farther-ending block then has priority')
    expect(IMPROVE_SCRIPT_PROMPT).toContain(
      'make tables as large as the current board layout safely allows',
    )
    expect(IMPROVE_SCRIPT_PROMPT).toContain('increase table font sizes too')
    expect(IMPROVE_SCRIPT_PROMPT).toContain('timing only')
    expect(IMPROVE_SCRIPT_PROMPT).toContain('setCamera')
    expect(IMPROVE_SCRIPT_PROMPT).toContain('background/board')
    expect(IMPROVE_SCRIPT_PROMPT).toContain('do not add, remove, or retune camera')
    expect(IMPROVE_SCRIPT_PROMPT).toContain('purposeful variety of distinct, coordinated colors')
    expect(IMPROVE_SCRIPT_PROMPT).toContain('never leave tables or text all in the same color')
    expect(IMPROVE_SCRIPT_PROMPT).toContain('choice buttons')
    // Accent-mark guidance: no wobble (compile error), visual optional, use often.
    expect(IMPROVE_SCRIPT_PROMPT).toContain('no wobble')
    expect(IMPROVE_SCRIPT_PROMPT).toContain('visual is optional')
    expect(IMPROVE_SCRIPT_PROMPT).toContain('use mark() often')
    // Camera is authoritative by default — no camera-geometry questions.
    expect(IMPROVE_SCRIPT_PROMPT).toContain('trust the active camera')
    expect(IMPROVE_SCRIPT_PROMPT).toContain('never emit camera-geometry questions')
  })

  it('error fix prompt lists each error with its position', () => {
    const prompt = formatScriptErrorPrompt([
      { message: 'needs a duration', line: 3, column: 6 },
      { message: 'unknown node', line: 4, column: 1 },
    ])
    expect(prompt).toContain('Fix these script errors')
    expect(prompt).toContain('Line 3, Col 6: needs a duration')
    expect(prompt).toContain('Line 4, Col 1: unknown node')
  })

  it('repair prompt includes the complete failed script and diagnostics', () => {
    const prompt = formatScriptRepairPrompt(
      'script "Intro" from 0\nreveal(ghost)',
      'unknown node ghost',
    )
    expect(prompt).toContain('unknown node ghost')
    expect(prompt).toContain(
      '<failed-script>\nscript "Intro" from 0\nreveal(ghost)\n</failed-script>',
    )
    expect(prompt).toContain('return the complete corrected script')
  })
})
