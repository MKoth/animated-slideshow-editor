import { describe, expect, it, beforeEach } from 'vitest'
import { createEngineInternal } from '../../engine/internal'
import { CommandDispatcher, UndoStack } from '../../engine/commands'
import { ImportPrompterCommand } from '../../engine/commands/importPrompterCommand'
import { SplitPrompterWordsCommand } from '../../engine/commands/splitPrompterWordsCommand'

function createEngine() {
  return createEngineInternal()
}

describe('SplitPrompterWords without TTS', () => {
  let engine: ReturnType<typeof createEngine>
  let dispatcher: CommandDispatcher
  let undoStack: UndoStack
  let slideId: string
  beforeEach(() => {
    engine = createEngine()
    undoStack = new UndoStack()
    dispatcher = new CommandDispatcher(engine, undoStack, () => {})
    engine.createProject({ name: 'P' })
    const slide = engine.createSlide('S1')
    slideId = slide.id
  })

  it('contiguous range yields single new block with proportional durations and gap-free', () => {
    dispatcher.dispatch(new ImportPrompterCommand({ slideId, rawText: 'A B C D' }))
    const part = engine.getSlide(slideId).prompter!.parts[0]
    const origDur = part.duration
    const res = dispatcher.dispatch(
      new SplitPrompterWordsCommand({
        slideId,
        partId: part.id,
        startWordIndex: 1,
        endWordIndex: 2,
      }),
    )
    expect(res.ok).toBe(true)
    const parts = engine.getSlide(slideId).prompter!.parts
    expect(parts.map((p) => p.text.trim())).toEqual(['A', 'B C', 'D'])
    const sum = parts.reduce((s, p) => s + p.duration, 0)
    expect(Math.abs(sum - origDur)).toBeLessThan(1e-6)
    let cursor = 0
    for (const p of parts) {
      expect(Math.abs(p.startTime - cursor)).toBeLessThan(1e-6)
      cursor = p.endTime
    }
  })

  it('single word at middle splits into three silent parts', () => {
    dispatcher.dispatch(new ImportPrompterCommand({ slideId, rawText: 'Hello beautiful world' }))
    const part = engine.getSlide(slideId).prompter!.parts[0]
    dispatcher.dispatch(
      new SplitPrompterWordsCommand({
        slideId,
        partId: part.id,
        startWordIndex: 1,
        endWordIndex: 1,
      }),
    )
    const parts = engine.getSlide(slideId).prompter!.parts
    expect(parts.length).toBe(3)
    expect(parts[1].text.trim()).toBe('beautiful')
    for (const p of parts) {
      expect(p.audioClipId).toBeUndefined()
      expect(p.segments).toBeUndefined()
    }
  })

  it('whole part selected is rejected', () => {
    dispatcher.dispatch(new ImportPrompterCommand({ slideId, rawText: 'Hello world' }))
    const part = engine.getSlide(slideId).prompter!.parts[0]
    const res = dispatcher.dispatch(
      new SplitPrompterWordsCommand({
        slideId,
        partId: part.id,
        startWordIndex: 0,
        endWordIndex: 1,
      }),
    )
    expect(res.ok).toBe(false)
  })
})
