import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { buildScriptFocus, formatScriptErrorPrompt, IMPROVE_SCRIPT_PROMPT } from '../ai/scriptFocus'
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
    expect(IMPROVE_SCRIPT_PROMPT).toContain('choice buttons')
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
})
