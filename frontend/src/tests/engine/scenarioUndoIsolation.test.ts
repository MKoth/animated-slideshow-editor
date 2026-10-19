import { describe, expect, it, vi } from 'vitest'
import { CommandDispatcher, UndoStack } from '../../engine/commands'
import { createEngineInternal } from '../../engine/internal'
import {
  appendScenarioVersion,
  createEmptyScenarioSection,
  createScenarioVersion,
} from '../../engine/scenarioSection'

describe('scenario undo isolation (issue #462)', () => {
  it('markdown appends never push engine history entries', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
    void dispatcher
    const before = undoStack.entries.length
    const section = createEmptyScenarioSection('## Step 1 -- One\n\nHi.\n')
    const v1 = createScenarioVersion(section.currentMarkdown, 'First', [1])
    const next = appendScenarioVersion(section, v1)
    engine.project!.setScenario(next)
    expect(undoStack.entries.length).toBe(before)
    expect(engine.project!.scenario?.versions).toHaveLength(1)
  })

  it('canvas undo never touches the doc and doc restore never touches canvas', () => {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Demo' })
    const undoStack = new UndoStack()
    const spy = vi.fn()
    const dispatcher = new CommandDispatcher(engine, undoStack, spy)
    // Doc write via plain setScenario (no dispatcher).
    const section = createEmptyScenarioSection('## Step 1 -- One\n\nA.\n')
    engine.project!.setScenario(
      appendScenarioVersion(section, createScenarioVersion(section.currentMarkdown, 'First', [1])),
    )
    const docBefore = engine.project!.scenario?.currentMarkdown
    // Canvas undo with empty stack is a no-op on the doc.
    dispatcher.undo()
    expect(engine.project!.scenario?.currentMarkdown).toBe(docBefore)
    // Restore-as-new-version copies forward without touching undo stack.
    const current = engine.project!.scenario!
    const restored = appendScenarioVersion(current, {
      id: 'v-restore',
      summary: 'Restore',
      touchedSteps: [1],
      timestamp: new Date().toISOString(),
      content: current.versions[0]!.content,
    })
    const entriesBefore = undoStack.entries.length
    engine.project!.setScenario(restored)
    expect(undoStack.entries.length).toBe(entriesBefore)
    expect(engine.project!.scenario?.versions).toHaveLength(2)
  })
})
