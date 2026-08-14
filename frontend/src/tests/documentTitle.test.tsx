import { render } from '@testing-library/react'
import { act } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { DocumentTitle } from '../components/editor/DocumentTitle'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import type { Engine } from '../engine/internal'
import { usePersistenceStore } from '../stores/persistenceStore'
import { noopPersistence } from './contextHarness'
import { makeProject } from './engine/helpers'

function renderTitle(engine: Engine): void {
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: noopPersistence,
  }
  render(
    <EngineContext.Provider value={value}>
      <DocumentTitle />
    </EngineContext.Provider>,
  )
}

function engineWithProject(name: string): Engine {
  const engine = createEngineInternal()
  engine.createProject({ name })
  engine.createSlide('Slide 1')
  return engine
}

describe('DocumentTitle', () => {
  beforeEach(() => {
    document.title = 'AI Slideshow Editor'
    usePersistenceStore.setState({ dirty: false })
  })

  it('keeps the default title while no project is open', () => {
    renderTitle(createEngineInternal())

    expect(document.title).toBe('AI Slideshow Editor')
  })

  it('shows the project name when clean', () => {
    renderTitle(engineWithProject('Spanish Lesson'))

    expect(document.title).toBe('Spanish Lesson')
  })

  it('shows the project name with an asterisk while dirty', () => {
    act(() => usePersistenceStore.getState().markDirty())
    renderTitle(engineWithProject('Spanish Lesson'))

    expect(document.title).toBe('Spanish Lesson*')
  })

  it('clears the asterisk when the project is saved', () => {
    act(() => usePersistenceStore.getState().markDirty())
    renderTitle(engineWithProject('Spanish Lesson'))
    expect(document.title).toBe('Spanish Lesson*')

    act(() => usePersistenceStore.getState().markSaved())

    expect(document.title).toBe('Spanish Lesson')
  })

  it('follows a newly opened project', () => {
    const engine = engineWithProject('Spanish Lesson')
    renderTitle(engine)
    expect(document.title).toBe('Spanish Lesson')

    act(() => engine.openProject(makeProject('French Lesson', ['N1'])))

    expect(document.title).toBe('French Lesson')
  })
})
