import { act } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { BottomPanel } from '../components/editor/BottomPanel'
import {
  CommandDispatcher,
  CreateNodeCommand,
  SetSlideAnimationScriptCommand,
  UndoStack,
} from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { serialize } from '../engine/lessonSerializer'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { DEFAULT_TIMELINE_HEIGHT } from '../stores/uiPrefs'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { noopPersistence } from './contextHarness'

function renderPanel() {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: noopPersistence,
  }
  render(
    <EngineContext.Provider value={value}>
      <BottomPanel height={400} />
    </EngineContext.Provider>,
  )
  return { engine, undoStack, dispatcher }
}

function setupProject(engine: Engine, slideNames: readonly string[] = ['Slide 1']) {
  act(() => {
    engine.createProject({ name: 'Demo' })
    for (const name of slideNames) {
      engine.createSlide(name)
    }
  })
}

function addHero(dispatcher: CommandDispatcher, engine: Engine): string {
  const slide = engine.getActiveSlide()
  if (!slide) throw new Error('expected an active slide')
  const result = dispatcher.dispatch(
    new CreateNodeCommand({
      sceneId: slide.scene.id,
      parentId: slide.scene.root.id,
      name: 'Hero',
    }),
  )
  if (!result.ok) throw new Error(result.error.message)
  return result.inverse.nodeId
}

function setScript(dispatcher: CommandDispatcher, engine: Engine, source: string): void {
  const slide = engine.getActiveSlide()
  if (!slide) throw new Error('expected an active slide')
  act(() => {
    dispatcher.dispatch(new SetSlideAnimationScriptCommand({ slideId: slide.id, source }))
  })
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  usePlaybackController.setState({ currentTimes: {} })
  useTimelineViewStore.persist.clearStorage()
  useTimelineViewStore.setState({ zoomLevel: 1, scrollTime: 0, height: DEFAULT_TIMELINE_HEIGHT })
  localStorage.clear()
})

describe('Script tab shell', () => {
  it('hides the Script tab behind a create affordance for a slide without a script', () => {
    const { engine } = renderPanel()
    setupProject(engine)

    expect(screen.getByTestId('bottom-tab-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('bottom-tab-history')).toBeInTheDocument()
    expect(screen.queryByTestId('bottom-tab-script')).not.toBeInTheDocument()
    expect(screen.getByTestId('bottom-tab-create-script')).toHaveTextContent('Create Script')
  })

  it('creates an empty script from the affordance and opens the editor for the active slide', async () => {
    const user = userEvent.setup()
    const { engine, undoStack } = renderPanel()
    setupProject(engine)

    await user.click(screen.getByTestId('bottom-tab-create-script'))

    expect(screen.getByTestId('bottom-tab-script')).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('bottom-tab-create-script')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Animation Script source')).toHaveValue('')
    expect(screen.getByTestId('script-panel')).toHaveTextContent('Slide 1')
    expect(engine.getActiveSlide()?.animationScript).toEqual({ source: '' })
    expect(undoStack.entries[0].type).toBe('SetSlideAnimationScript')
  })

  it('commits a source edit as one undoable History entry; undo and redo return the text', async () => {
    const user = userEvent.setup()
    const { engine, undoStack, dispatcher } = renderPanel()
    setupProject(engine)
    await user.click(screen.getByTestId('bottom-tab-create-script'))
    const entriesAfterCreate = undoStack.entries.length

    const editor = screen.getByLabelText('Animation Script source')
    await user.type(editor, 'script "Hi" from 0')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(undoStack.entries).toHaveLength(entriesAfterCreate + 1)
    expect(undoStack.entries[0].type).toBe('SetSlideAnimationScript')
    expect(engine.getActiveSlide()?.animationScript?.source).toBe('script "Hi" from 0')

    act(() => {
      dispatcher.undo()
    })
    expect(screen.getByLabelText('Animation Script source')).toHaveValue('')

    act(() => {
      dispatcher.redo()
    })
    expect(screen.getByLabelText('Animation Script source')).toHaveValue('script "Hi" from 0')
  })

  it('renders line numbers beside the plain-text source', async () => {
    const user = userEvent.setup()
    const { engine } = renderPanel()
    setupProject(engine)

    await user.click(screen.getByTestId('bottom-tab-create-script'))
    expect(screen.getByTestId('script-line-numbers').children).toHaveLength(1)

    const editor = screen.getByLabelText('Animation Script source')
    await user.type(editor, 'one{Enter}two')
    expect(screen.getByTestId('script-line-numbers').children).toHaveLength(2)
    expect(screen.getByTestId('script-line-numbers')).toHaveTextContent('12')

    editor.scrollTop = 40
    fireEvent.scroll(editor)
    expect(screen.getByTestId('script-line-numbers').scrollTop).toBe(40)
  })

  it('documents the read cautions beside the editor', async () => {
    const user = userEvent.setup()
    const { engine } = renderPanel()
    setupProject(engine)

    await user.click(screen.getByTestId('bottom-tab-create-script'))

    const caution = screen.getByTestId('script-reads-caution')
    expect(caution).toHaveTextContent(/renderer-measured/)
    expect(caution).toHaveTextContent(/ignore rotation/)
  })

  it('follows the active slide, hiding the tab again for slides without a script', async () => {
    const user = userEvent.setup()
    const { engine, dispatcher } = renderPanel()
    setupProject(engine, ['Slide 1', 'Slide 2'])
    const [slide1, slide2] = engine.project!.slides

    act(() => {
      engine.setActiveSlide(slide1.id)
    })
    expect(screen.queryByTestId('bottom-tab-script')).not.toBeInTheDocument()

    act(() => {
      dispatcher.dispatch(
        new SetSlideAnimationScriptCommand({
          slideId: slide1.id,
          source: 'script "One" from 0',
        }),
      )
    })
    await user.click(screen.getByTestId('bottom-tab-script'))
    expect(screen.getByLabelText('Animation Script source')).toHaveValue('script "One" from 0')

    act(() => {
      engine.setActiveSlide(slide2.id)
    })
    expect(screen.queryByTestId('bottom-tab-script')).not.toBeInTheDocument()
    expect(screen.getByTestId('bottom-tab-create-script')).toBeInTheDocument()
    expect(screen.getByTestId('bottom-tab-timeline')).toHaveAttribute('aria-selected', 'true')

    act(() => {
      engine.setActiveSlide(slide1.id)
    })
    await user.click(screen.getByTestId('bottom-tab-script'))
    expect(screen.getByTestId('script-panel')).toHaveTextContent('Slide 1')
    expect(screen.getByLabelText('Animation Script source')).toHaveValue('script "One" from 0')
  })

  it('commits with Ctrl/Cmd+Enter', async () => {
    const user = userEvent.setup()
    const { engine, undoStack } = renderPanel()
    setupProject(engine)
    await user.click(screen.getByTestId('bottom-tab-create-script'))

    await user.type(
      screen.getByLabelText('Animation Script source'),
      'script "Keys" from 0{Control>}{Enter}{/Control}',
    )

    expect(engine.getActiveSlide()?.animationScript?.source).toBe('script "Keys" from 0')
    expect(undoStack.entries[0].type).toBe('SetSlideAnimationScript')
  })
})

describe('Script tab Check', () => {
  it('checks the draft and renders the prospective segment summary without touching history', async () => {
    const user = userEvent.setup()
    const { engine, undoStack, dispatcher } = renderPanel()
    setupProject(engine)
    addHero(dispatcher, engine)
    await user.click(screen.getByTestId('bottom-tab-create-script'))

    const editor = screen.getByLabelText('Animation Script source')
    fireEvent.change(editor, {
      target: {
        value: [
          'script "Demo" from 0.5',
          'bind hero = node("Hero")',
          'hero.tween({ x: 5 }, 0.4)',
        ].join('\n'),
      },
    })
    const undoBefore = undoStack.entries.length
    const serializedBefore = serialize(engine.project!)

    await user.click(screen.getByTestId('script-check'))

    expect(screen.getByTestId('script-check-summary')).toHaveTextContent('Segment 0.5s → 0.9s')
    expect(screen.getByTestId('script-check-summary')).toHaveTextContent('tracks: Hero.x')
    expect(screen.getByTestId('script-check-summary')).toHaveTextContent('2 keyframes')
    expect(undoStack.entries).toHaveLength(undoBefore)
    expect(serialize(engine.project!)).toBe(serializedBefore)
  })

  it('lists diagnostics and clicking one places the editor cursor at its source position', async () => {
    const user = userEvent.setup()
    const { engine, dispatcher } = renderPanel()
    setupProject(engine)
    addHero(dispatcher, engine)
    await user.click(screen.getByTestId('bottom-tab-create-script'))

    const source = [
      'script "Demo" from 0',
      'bind hero = node("Hero")',
      'hero.tween({ x: 1 })',
    ].join('\n')
    const editor = screen.getByLabelText('Animation Script source') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: source } })

    await user.click(screen.getByTestId('script-check'))

    const diagnostics = screen.getAllByTestId('script-diagnostic')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toHaveAttribute('data-severity', 'error')
    expect(diagnostics[0]).toHaveTextContent(/needs a duration/i)
    expect(diagnostics[0]).toHaveTextContent('Line 3, Col 6')

    await user.click(diagnostics[0])

    const expected = source.indexOf('tween')
    expect(editor).toHaveFocus()
    expect(editor.selectionStart).toBe(expected)
    expect(editor.selectionEnd).toBe(expected)
  })

  it('clears a stale check when the source is edited and warns about unused bindings', async () => {
    const user = userEvent.setup()
    const { engine, dispatcher } = renderPanel()
    setupProject(engine)
    addHero(dispatcher, engine)
    await user.click(screen.getByTestId('bottom-tab-create-script'))

    const editor = screen.getByLabelText('Animation Script source')
    fireEvent.change(editor, {
      target: { value: ['script "Demo" from 0', 'bind hero = node("Hero")'].join('\n') },
    })
    await user.click(screen.getByTestId('script-check'))
    expect(screen.getByTestId('script-diagnostic')).toHaveAttribute('data-severity', 'warning')

    fireEvent.change(editor, { target: { value: 'script "Demo" from 0' } })
    expect(screen.queryByTestId('script-check-result')).not.toBeInTheDocument()
  })
})

describe('Script tab Run', () => {
  const source = [
    'script "Demo" from 0.5',
    'bind hero = node("Hero")',
    'hero.tween({ x: 5 }, 0.4)',
  ].join('\n')

  it('runs the saved source as one undoable History entry and renders the run summary', async () => {
    const user = userEvent.setup()
    const { engine, undoStack, dispatcher } = renderPanel()
    setupProject(engine)
    const heroId = addHero(dispatcher, engine)
    setScript(dispatcher, engine, source)
    await user.click(screen.getByTestId('bottom-tab-script'))
    const undoBefore = undoStack.entries.length

    await user.click(screen.getByTestId('script-run'))

    expect(screen.getByTestId('script-run-summary')).toHaveTextContent('Segment 0.5s → 0.9s')
    expect(screen.getByTestId('script-run-summary')).toHaveTextContent('tracks: Hero.x')
    expect(screen.getByTestId('script-run-summary')).toHaveTextContent('2 keyframes')
    expect(engine.getKeyframes(heroId, 'positionX').map((keyframe) => keyframe.value)).toEqual([
      0, 5,
    ])
    expect(engine.getActiveSlide()?.animationScript?.source).toBe(source)
    expect(engine.getActiveSlide()?.animationScript?.lastCompiled?.from).toBe(0.5)
    expect(undoStack.entries).toHaveLength(undoBefore + 1)
    expect(undoStack.entries[0].type).toBe('Transaction')

    act(() => {
      dispatcher.undo()
    })
    expect(engine.getKeyframes(heroId, 'positionX')).toHaveLength(0)
    expect(engine.getActiveSlide()?.animationScript?.lastCompiled).toBeUndefined()
  })

  it('disables Run until unsaved draft changes are saved', async () => {
    const user = userEvent.setup()
    const { engine, dispatcher } = renderPanel()
    setupProject(engine)
    addHero(dispatcher, engine)
    setScript(dispatcher, engine, source)
    await user.click(screen.getByTestId('bottom-tab-script'))

    expect(screen.getByTestId('script-run')).toBeEnabled()

    await user.type(screen.getByLabelText('Animation Script source'), ' ')
    expect(screen.getByTestId('script-run')).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByTestId('script-run')).toBeEnabled()
  })

  it('blocks a run with diagnostics and dispatches nothing', async () => {
    const user = userEvent.setup()
    const { engine, undoStack, dispatcher } = renderPanel()
    setupProject(engine)
    const heroId = addHero(dispatcher, engine)
    setScript(
      dispatcher,
      engine,
      ['script "Demo" from 0', 'bind hero = node("Hero")', 'hero.tween({ x: 1 })'].join('\n'),
    )
    await user.click(screen.getByTestId('bottom-tab-script'))
    const undoBefore = undoStack.entries.length

    await user.click(screen.getByTestId('script-run'))

    expect(screen.getByTestId('script-run-summary')).toHaveTextContent('Run blocked by 1 error')
    expect(screen.getAllByTestId('script-diagnostic')).toHaveLength(1)
    expect(screen.getByTestId('script-diagnostic')).toHaveTextContent(/needs a duration/i)
    expect(engine.getKeyframes(heroId, 'positionX')).toHaveLength(0)
    expect(engine.getActiveSlide()?.animationScript?.lastCompiled).toBeUndefined()
    expect(undoStack.entries).toHaveLength(undoBefore)
  })
})
