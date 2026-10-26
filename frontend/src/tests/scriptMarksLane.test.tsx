import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlaybackController } from '../stores/playbackStore'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { DEFAULT_TIMELINE_HEIGHT } from '../stores/uiPrefs'
import { createEngineInternal } from '../engine/internal'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { SetSlideAnimationScriptCommand } from '../engine/commands'
import { EngineContext } from '../app/engineContext'
import { toReadOnly } from '../engine/internal'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { runAnimationScriptAsync } from '../engine/animationScriptRun'
import { noopPersistence } from './contextHarness'

vi.mock('../engine/animationScriptRun', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/animationScriptRun')>()
  return {
    ...actual,
    runAnimationScriptAsync: vi.fn(async () => ({ ran: true, diagnostics: [], error: null })),
  }
})

const SCRIPT = [
  'script "Demo" from 0',
  'mark("part-0")',
  'at(3.04) mark("part-1")',
  'at(3.44) mark("part-2")',
  'let t = markTime("part-2") + 1',
].join('\n')

function renderAudioTimeline() {
  const engine = createEngineInternal()
  const undo = new UndoStack()
  const logger = vi.fn()
  const dispatcher = new CommandDispatcher(engine, undo, logger)
  const value = {
    engine: toReadOnly(engine),
    undoStack: undo,
    dispatch: (command: never) => dispatcher.dispatch(command),
    persistence: noopPersistence,
  } as unknown as import('../app/engineContext').EngineContextValue
  engine.createProject({ name: 'P' })
  const slide = engine.createSlide('S1')
  engine.createNode(slide.scene.id, slide.scene.root.id, 'N')
  const setScript = dispatcher.dispatch(
    new SetSlideAnimationScriptCommand({ slideId: slide.id, source: SCRIPT }) as never,
  )
  if (!setScript.ok) throw new Error(`script setup failed: ${setScript.error.message}`)
  render(
    <EngineContext.Provider value={value}>
      <TimelinePanel height={400} />
    </EngineContext.Provider>,
  )
  return { engine, undo, dispatcher }
}

describe('AudioTimelineBody — script marks lane', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.mocked(runAnimationScriptAsync).mockClear()
    usePlaybackController.setState({
      currentTimes: {},
      status: 'stopped',
      playbackSpeed: 1,
      loopEnabled: false,
    } as never)
    useTimelineViewStore.setState({
      zoomLevel: 1,
      scrollTime: 0,
      height: DEFAULT_TIMELINE_HEIGHT,
      gridSnapEnabled: false,
    })
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders point-in-time marks with hover names', async () => {
    renderAudioTimeline()
    fireEvent.click(await screen.findByTestId('timeline-tab-audio'))
    expect(await screen.findByTestId('audio-marks-strip')).toBeInTheDocument()
    const marks = await screen.findAllByTestId('script-mark')
    expect(marks).toHaveLength(3)
    expect(marks[1]).toHaveAttribute('title', 'part-1 @ 3.04s')
  })

  it('dragging a mark rewrites its at() time and re-runs the script', async () => {
    const { engine } = renderAudioTimeline()
    fireEvent.click(await screen.findByTestId('timeline-tab-audio'))
    const marks = await screen.findAllByTestId('script-mark')
    // part-1 at 3.04: drag +1s (pps 100, snap off)
    fireEvent.pointerDown(marks[1]!, { clientX: 100, button: 0 })
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200 }))
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 200 }))
    const slideId = engine.getActiveSlide()!.id
    await waitFor(() => {
      expect(engine.getSlide(slideId).animationScript?.source).toContain('at(4.04) mark("part-1")')
    })
    expect(vi.mocked(runAnimationScriptAsync)).toHaveBeenCalledTimes(1)
    const runSource = vi.mocked(runAnimationScriptAsync).mock.calls[0]![3] as string
    expect(runSource).toContain('at(4.04) mark("part-1")')
  })

  it('double-click renames the mark and its markTime reference', async () => {
    const { engine } = renderAudioTimeline()
    fireEvent.click(await screen.findByTestId('timeline-tab-audio'))
    const marks = await screen.findAllByTestId('script-mark')
    fireEvent.doubleClick(marks[2]!)
    const input = await screen.findByTestId('script-mark-rename-input')
    fireEvent.change(input, { target: { value: 'bridge' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    const slideId = engine.getActiveSlide()!.id
    await waitFor(() => {
      expect(engine.getSlide(slideId).animationScript?.source).toContain('mark("bridge")')
    })
    expect(engine.getSlide(slideId).animationScript?.source).toContain('markTime("bridge")')
    expect(vi.mocked(runAnimationScriptAsync)).toHaveBeenCalledTimes(1)
  })
})
