import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { TimelinePanel } from '../components/panels/TimelinePanel'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import type { Engine } from '../engine/internal'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { noopPersistence } from './contextHarness'
import { usePlaybackController } from '../stores/playbackStore'
import { useSelectionStore } from '../stores/selectionStore'
import { DEFAULT_TIMELINE_HEIGHT } from '../stores/uiPrefs'
import { useTimelineViewStore } from '../stores/timelineViewStore'
import { apiClient } from '../api'
import { ApiError } from '../api/apiClient'

function renderPanel(): { engine: Engine; undoStack: UndoStack } {
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
      <TimelinePanel height={200} />
    </EngineContext.Provider>,
  )
  return { engine, undoStack }
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  usePlaybackController.setState({ currentTimes: {} })
  useTimelineViewStore.persist.clearStorage()
  useTimelineViewStore.setState({ zoomLevel: 1, scrollTime: 0, height: DEFAULT_TIMELINE_HEIGHT })
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('CombinedTtsModal request lifecycle', () => {
  it('keeps the modal open with a loader on generate and surfaces backend errors', async () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'Hello world.', duration: 1 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'How are you?', duration: 1 })

    fireEvent.click(await screen.findByTestId('timeline-tab-audio'))
    fireEvent.click(await screen.findByTestId('prompter-generate-combined-tts'))
    expect(await screen.findByTestId('combined-tts-modal')).toBeInTheDocument()
    // Spanish is preselected.
    expect(screen.getByTestId('combined-tts-language')).toHaveValue('es')

    vi.spyOn(apiClient, 'get').mockResolvedValue({
      defaultModel: 'sonic-3.6',
      defaultProvider: 'cartesia',
    } as never)
    let rejectPost!: (e: unknown) => void
    const pending = new Promise<never>((_, reject) => {
      rejectPost = reject
    })
    const postSpy = vi.spyOn(apiClient, 'post').mockReturnValue(pending)

    fireEvent.click(screen.getByTestId('combined-tts-generate'))

    // Loader in the button, modal stays open, cancel disabled.
    expect(await screen.findByText('Generating…')).toBeInTheDocument()
    expect(screen.getByTestId('combined-tts-modal')).toBeInTheDocument()
    expect(screen.getByTestId('combined-tts-cancel')).toBeDisabled()

    act(() => {
      rejectPost(new ApiError('Request failed', 500, '/api/tts/generate', 'boom'))
    })

    expect(await screen.findByTestId('combined-tts-error')).toHaveTextContent(/boom/)
    // Modal still open after failure; user can retry or close.
    expect(screen.getByTestId('combined-tts-modal')).toBeInTheDocument()
    expect(postSpy).toHaveBeenCalledOnce()
    const [, body] = postSpy.mock.calls[0]!
    const parsed = JSON.parse(body as string)
    expect(parsed.includeTimestamps).toBe(true)
    expect(parsed.language).toBe('es')
    expect(parsed.segments).toHaveLength(2)
    // Exact offsets: "Hello world." (0-12) + " " + "How are you?" (13-25)
    expect(parsed.text).toBe('Hello world. How are you?')
    expect(parsed.segments[0]).toMatchObject({ id: expect.any(String), start: 0, end: 12 })
    expect(parsed.segments[1]).toMatchObject({ start: 13, end: 25 })
  })

  it('sends the selected language when switched to English', async () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'Hello world.', duration: 1 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'How are you?', duration: 1 })

    fireEvent.click(await screen.findByTestId('timeline-tab-audio'))
    fireEvent.click(await screen.findByTestId('prompter-generate-combined-tts'))
    expect(await screen.findByTestId('combined-tts-modal')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('combined-tts-language'), { target: { value: 'en' } })
    expect(screen.getByTestId('combined-tts-language')).toHaveValue('en')

    vi.spyOn(apiClient, 'get').mockResolvedValue({
      defaultModel: 'sonic-3.6',
      defaultProvider: 'cartesia',
    } as never)
    const postSpy = vi
      .spyOn(apiClient, 'post')
      .mockRejectedValue(new ApiError('Request failed', 500, '/api/tts/generate', 'boom'))

    fireEvent.click(screen.getByTestId('combined-tts-generate'))
    expect(await screen.findByTestId('combined-tts-error')).toHaveTextContent(/boom/)
    const [, body] = postSpy.mock.calls[0]!
    expect(JSON.parse(body as string).language).toBe('en')
  })

  it('resizes prompter blocks to exactly match their audio clips', async () => {
    const { engine } = renderPanel()
    engine.createProject({ name: 'Demo' })
    const slide = engine.createSlide('Slide 1')
    engine.createPrompterPart(slide.id, { id: 'p1', text: 'Hello world.', duration: 1 })
    engine.createPrompterPart(slide.id, { id: 'p2', text: 'How are you?', duration: 1 })

    fireEvent.click(await screen.findByTestId('timeline-tab-audio'))
    fireEvent.click(await screen.findByTestId('prompter-generate-combined-tts'))
    expect(await screen.findByTestId('combined-tts-modal')).toBeInTheDocument()

    vi.spyOn(apiClient, 'get').mockResolvedValue({
      defaultModel: 'sonic-3.6',
      defaultProvider: 'cartesia',
    } as never)
    const toB64 = (s: string) => btoa(s)
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      sampleRate: 44100,
      channels: 1,
      duration: 5,
      fullAudio: toB64('full'),
      segments: [
        { id: 'p1', start: 0, end: 2, duration: 2, audio: toB64('aaa') },
        { id: 'p2', start: 2, end: 5, duration: 3, audio: toB64('bbb') },
      ],
    } as never)

    fireEvent.click(screen.getByTestId('combined-tts-generate'))
    expect(await screen.findByTestId('combined-tts-result')).toBeInTheDocument()

    const live = engine.project!.slides.find((s) => s.id === slide.id)!
    const parts = live.prompter!.parts
    expect(parts[0]!.duration).toBeCloseTo(2)
    expect(parts[1]!.duration).toBeCloseTo(3)
    // Gap-free downstream shift: p2 starts exactly where p1 ends.
    expect(parts[0]!.startTime).toBeCloseTo(0)
    expect(parts[1]!.startTime).toBeCloseTo(2)
    expect(parts[1]!.endTime).toBeCloseTo(5)
    // Each audio clip is glued to its block with identical bounds, rate 1.
    for (const part of parts) {
      const clip = live.audio.clips.find((c) => c.id === part.audioClipId)
      expect(clip).toBeDefined()
      expect(clip!.timelineStart).toBeCloseTo(part.startTime)
      expect(clip!.playbackRate).toBe(1)
      expect(clip!.sourceEnd - (clip!.sourceStart ?? 0)).toBeCloseTo(part.duration)
    }
  })
})
