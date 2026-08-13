import { act } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { FRAME_STEP_SECONDS, usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { DEFAULT_TIMELINE_HEIGHT } from '../stores/uiPrefs'
import { pixelsPerSecond, useTimelineViewStore } from '../stores/timelineViewStore'

function renderPanel(): {
  engine: Engine
  undoStack: UndoStack
  dispatcher: CommandDispatcher
  logger: ReturnType<typeof vi.fn>
} {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const logger = vi.fn()
  const dispatcher = new CommandDispatcher(engine, undoStack, logger)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
  }
  render(
    <EngineContext.Provider value={value}>
      <TimelinePanel height={200} />
    </EngineContext.Provider>,
  )
  return { engine, undoStack, dispatcher, logger }
}

function createSceneWithNode(engine: Engine) {
  engine.createProject({ name: 'Demo' })
  const slide = engine.createSlide('Slide 1')
  engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
  return slide
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  usePlaybackController.setState({
    currentTimes: {},
    status: 'stopped',
    playbackSpeed: 1,
    loopEnabled: false,
  })
  useTimelineViewStore.persist.clearStorage()
  useTimelineViewStore.setState({ zoomLevel: 1, scrollTime: 0, height: DEFAULT_TIMELINE_HEIGHT })
  localStorage.clear()
})

afterEach(() => {
  const state = usePlaybackController.getState()
  if (state.status === 'playing') {
    state.pause()
  }
})

async function renderTimeline(engine: Engine): Promise<{ slideId: string; duration: number }> {
  const slide = createSceneWithNode(engine)
  await screen.findByRole('track', { name: 'Root' })
  return { slideId: slide.id, duration: slide.duration }
}

function playButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Play (timeline)' })
}

function pauseButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Pause (timeline)' })
}

function stopButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Stop (timeline)' })
}

function loopButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Loop (timeline)' })
}

function speedSelect(): HTMLSelectElement {
  return screen.getByRole('combobox', { name: 'Speed (timeline)' })
}

describe('TimelineToolbar playback controls', () => {
  it('plays from the playhead, moving the playhead and time display', async () => {
    const { engine } = renderPanel()
    const { slideId, duration } = await renderTimeline(engine)
    vi.useFakeTimers()
    try {
      act(() => {
        usePlaybackController.getState().setCurrentTime(slideId, 2, duration)
      })

      fireEvent.click(playButton())

      expect(usePlaybackController.getState().status).toBe('playing')
      const display = screen.getByLabelText('Current time')
      expect(display).toHaveTextContent('00:02.000')

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(usePlaybackController.getState().getTime(slideId)).toBeCloseTo(4, 3)
      const playhead = screen.getByTestId('timeline-playhead')
      expect(parseFloat(playhead.style.left)).toBeCloseTo(400, 6)
      expect(screen.getByLabelText('Current time')).toHaveTextContent('00:04.000')
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts from 0 when the playhead sits at the end', async () => {
    const { engine } = renderPanel()
    const { slideId, duration } = await renderTimeline(engine)
    vi.useFakeTimers()
    try {
      act(() => {
        usePlaybackController.getState().setCurrentTime(slideId, duration, duration)
      })

      fireEvent.click(playButton())

      expect(usePlaybackController.getState().getTime(slideId)).toBe(0)
      expect(usePlaybackController.getState().status).toBe('playing')
    } finally {
      vi.useRealTimers()
    }
  })

  it('pauses at the position and resumes from it', async () => {
    const { engine } = renderPanel()
    const { slideId } = await renderTimeline(engine)
    vi.useFakeTimers()
    try {
      fireEvent.click(playButton())
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      const pausedAt = usePlaybackController.getState().getTime(slideId)

      fireEvent.click(pauseButton())
      expect(usePlaybackController.getState().status).toBe('paused')
      expect(usePlaybackController.getState().getTime(slideId)).toBe(pausedAt)

      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(usePlaybackController.getState().getTime(slideId)).toBe(pausedAt)

      fireEvent.click(playButton())
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      expect(usePlaybackController.getState().getTime(slideId)).toBeGreaterThan(pausedAt)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops playback and resets the current time to 0', async () => {
    const { engine } = renderPanel()
    const { slideId } = await renderTimeline(engine)
    vi.useFakeTimers()
    try {
      fireEvent.click(playButton())
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      fireEvent.click(stopButton())
      expect(usePlaybackController.getState().status).toBe('stopped')
      expect(usePlaybackController.getState().getTime(slideId)).toBe(0)
      expect(screen.getByLabelText('Current time')).toHaveTextContent('00:00.000')
    } finally {
      vi.useRealTimers()
    }
  })

  it('toggles looping', async () => {
    const { engine } = renderPanel()
    await renderTimeline(engine)

    const loop = loopButton()
    expect(loop).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(loop)
    expect(usePlaybackController.getState().loopEnabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Loop (timeline)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Loop (timeline)' }))
    expect(usePlaybackController.getState().loopEnabled).toBe(false)
  })

  it('offers all six speeds and applies the selected one', async () => {
    const { engine } = renderPanel()
    const { slideId } = await renderTimeline(engine)
    vi.useFakeTimers()
    try {
      const select = speedSelect()
      expect([...select.options].map((option) => option.textContent)).toEqual([
        '0.25×',
        '0.5×',
        '1×',
        '1.5×',
        '2×',
        '4×',
      ])

      fireEvent.change(select, { target: { value: '2' } })
      expect(usePlaybackController.getState().playbackSpeed).toBe(2)

      fireEvent.click(playButton())
      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(usePlaybackController.getState().getTime(slideId)).toBeCloseTo(4, 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('steps exactly 1/60 s with the frame buttons while paused', async () => {
    const { engine } = renderPanel()
    const { slideId, duration } = await renderTimeline(engine)
    vi.useFakeTimers()
    try {
      const next = screen.getByRole('button', { name: 'Next Frame (timeline)' })
      const previous = screen.getByRole('button', { name: 'Previous Frame (timeline)' })

      expect(next).toBeDisabled()
      expect(previous).toBeDisabled()

      fireEvent.click(playButton())
      act(() => {
        vi.advanceTimersByTime(500)
      })
      expect(next).toBeDisabled()
      expect(previous).toBeDisabled()

      fireEvent.click(pauseButton())
      const at = usePlaybackController.getState().getTime(slideId)

      expect(next).toBeEnabled()
      expect(previous).toBeEnabled()

      fireEvent.click(next)
      expect(usePlaybackController.getState().getTime(slideId)).toBeCloseTo(
        at + FRAME_STEP_SECONDS,
        9,
      )
      fireEvent.click(previous)
      expect(usePlaybackController.getState().getTime(slideId)).toBeCloseTo(at, 9)

      act(() => {
        usePlaybackController.getState().setCurrentTime(slideId, duration, duration)
      })
      fireEvent.click(next)
      expect(usePlaybackController.getState().getTime(slideId)).toBe(duration)
    } finally {
      vi.useRealTimers()
    }
  })

  it('writes nothing to the command execution log while playing', async () => {
    const { engine, logger } = renderPanel()
    await renderTimeline(engine)
    vi.useFakeTimers()
    try {
      fireEvent.click(playButton())
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      fireEvent.click(pauseButton())
      fireEvent.click(playButton())
      act(() => {
        vi.advanceTimersByTime(1000)
      })
      fireEvent.click(stopButton())
      fireEvent.click(loopButton())
      fireEvent.change(speedSelect(), { target: { value: '4' } })

      expect(logger).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('TimelineToolbar auto-scroll during playback', () => {
  it('keeps the playhead in view as playback moves past the visible range', async () => {
    const { engine } = renderPanel()
    const { slideId } = await renderTimeline(engine)
    vi.useFakeTimers()
    try {
      act(() => {
        useTimelineViewStore.setState({ zoomLevel: 2 })
      })

      fireEvent.click(playButton())
      act(() => {
        vi.advanceTimersByTime(5000)
      })

      const time = usePlaybackController.getState().getTime(slideId)
      const pps = pixelsPerSecond(useTimelineViewStore.getState().zoomLevel)
      const scrollTime = useTimelineViewStore.getState().scrollTime
      const viewport = 800
      expect(time).toBeCloseTo(5, 1)
      expect(scrollTime).toBeGreaterThan(0)
      const playheadPx = time * pps
      const leftPx = scrollTime * pps
      expect(playheadPx).toBeGreaterThan(leftPx)
      expect(playheadPx).toBeLessThan(leftPx + viewport)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not scroll while the playhead is still visible', async () => {
    const { engine } = renderPanel()
    await renderTimeline(engine)
    vi.useFakeTimers()
    try {
      fireEvent.click(playButton())
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      expect(useTimelineViewStore.getState().scrollTime).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('scrolls back so the reset playhead is visible after stop', async () => {
    const { engine } = renderPanel()
    await renderTimeline(engine)
    vi.useFakeTimers()
    try {
      act(() => {
        useTimelineViewStore.setState({ zoomLevel: 2 })
      })

      fireEvent.click(playButton())
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      fireEvent.click(pauseButton())
      const scrolled = useTimelineViewStore.getState().scrollTime
      expect(scrolled).toBeGreaterThan(0)

      fireEvent.click(stopButton())
      const slide = engine.project?.slides[0]
      if (!slide) {
        throw new Error('expected a slide')
      }
      expect(usePlaybackController.getState().getTime(slide.id)).toBe(0)
      expect(useTimelineViewStore.getState().scrollTime).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
