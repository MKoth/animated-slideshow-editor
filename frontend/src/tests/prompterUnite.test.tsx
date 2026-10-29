import { act } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
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

function renderPanel(): {
  engine: Engine
  undoStack: UndoStack
  dispatcher: CommandDispatcher
} {
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
      <TimelinePanel height={400} />
    </EngineContext.Provider>,
  )
  return { engine, undoStack, dispatcher }
}

function setupThreeParts(engine: Engine) {
  engine.createProject({ name: 'Demo' })
  const slide = engine.createSlide('Slide 1')
  engine.createNode(slide.scene.id, slide.scene.root.id, 'Boy')
  engine.importPrompter(slide.id, 'First. Second. Third', { mode: 'replace' })
  return slide
}

async function openAudioTab() {
  fireEvent.click(await screen.findByTestId('timeline-tab-audio'))
  await screen.findByTestId('audio-prompter-strip')
}

beforeEach(() => {
  useSelectionStore.setState({ selectedIds: [] })
  usePlaybackController.setState({ currentTimes: {} })
  useTimelineViewStore.persist.clearStorage()
  useTimelineViewStore.setState({ zoomLevel: 1, scrollTime: 0, height: DEFAULT_TIMELINE_HEIGHT })
  localStorage.clear()
})

describe('Prompter per-gap unite buttons', () => {
  it('renders one unite button per internal gap', async () => {
    const { engine } = renderPanel()
    setupThreeParts(engine)
    await openAudioTab()
    // 3 parts => 2 internal gaps
    expect(await screen.findByTestId('prompter-unite-1')).toBeInTheDocument()
    expect(screen.getByTestId('prompter-unite-2')).toBeInTheDocument()
    expect(screen.queryByTestId('prompter-unite-0')).toBeNull()
    expect(screen.queryByTestId('prompter-unite-3')).toBeNull()
  })

  it('unites immediately when neither block has audio', async () => {
    const { engine } = renderPanel()
    const slide = setupThreeParts(engine)
    await openAudioTab()
    fireEvent.click(await screen.findByTestId('prompter-unite-1'))
    // No confirm modal for audio-free merge
    expect(screen.queryByTestId('prompter-unite-confirm')).toBeNull()
    const parts = engine.getSlide(slide.id).prompter!.parts
    expect(parts.length).toBe(2)
    expect(parts[0].text).toBe('First Second')
  })

  it('warns and deletes attached audio on confirm, undo restores everything', async () => {
    const { engine, undoStack } = renderPanel()
    const slide = setupThreeParts(engine)
    const parts = engine.getSlide(slide.id).prompter!.parts
    const leftClip = engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: parts[0].startTime,
      sourceStart: 0,
      sourceEnd: 1,
    })
    engine.setPrompterPartAudio(slide.id, parts[0].id, leftClip.id, 'a1')
    const rightClip = engine.createAudioClip(slide.id, {
      assetId: 'a2',
      trackId: 'voice',
      timelineStart: parts[1].startTime,
      sourceStart: 0,
      sourceEnd: 1,
    })
    engine.setPrompterPartAudio(slide.id, parts[1].id, rightClip.id, 'a2')

    await openAudioTab()
    fireEvent.click(await screen.findByTestId('prompter-unite-1'))

    // Confirm modal lists the doomed audio
    const dialog = await screen.findByTestId('prompter-unite-confirm')
    expect(dialog).toHaveTextContent('will be deleted')
    const confirmBtn = screen.getByTestId('prompter-unite-confirm-btn')
    expect(confirmBtn).toHaveTextContent('delete 2 clips')

    fireEvent.click(confirmBtn)

    const merged = engine.getSlide(slide.id).prompter!.parts
    expect(merged.length).toBe(2)
    expect(merged[0].text).toBe('First Second')
    expect(merged[0].audioClipId).toBeUndefined()
    expect(engine.getSlide(slide.id).audio.clips.length).toBe(0)

    // Single undo step restores both blocks + their clips/links
    act(() => undoStack.undo(engine))
    const restored = engine.getSlide(slide.id).prompter!.parts
    expect(restored.length).toBe(3)
    expect(restored[0].audioClipId).toBe(leftClip.id)
    expect(restored[1].audioClipId).toBe(rightClip.id)
    expect(engine.getSlide(slide.id).audio.clips.length).toBe(2)
  })

  it('cancel keeps blocks and audio untouched', async () => {
    const { engine } = renderPanel()
    const slide = setupThreeParts(engine)
    const parts = engine.getSlide(slide.id).prompter!.parts
    const clip = engine.createAudioClip(slide.id, {
      assetId: 'a1',
      trackId: 'voice',
      timelineStart: parts[0].startTime,
      sourceStart: 0,
      sourceEnd: 1,
    })
    engine.setPrompterPartAudio(slide.id, parts[0].id, clip.id, 'a1')

    await openAudioTab()
    fireEvent.click(await screen.findByTestId('prompter-unite-1'))
    await screen.findByTestId('prompter-unite-confirm')
    fireEvent.click(screen.getByTestId('prompter-unite-cancel-btn'))

    expect(screen.queryByTestId('prompter-unite-confirm')).toBeNull()
    expect(engine.getSlide(slide.id).prompter!.parts.length).toBe(3)
    expect(engine.getSlide(slide.id).audio.clips.length).toBe(1)
  })
})
