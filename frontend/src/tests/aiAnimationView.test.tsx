import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiAnimationView } from '../components/ai/AiAnimationView'
import { AiPanel } from '../components/ai/AiPanel'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useAiStore } from '../stores/aiStore'
import { useBackendStore } from '../stores/backendStore'
import type { ContextSnapshot } from '../ai/contextSnapshot'

function context(): ContextSnapshot {
  return {
    projectName: 'Unsaved Cat Edit',
    projectId: 'p-1',
    activeSlideName: 'Room',
    activeSlideDuration: 12,
    slides: [{ id: 's-1', name: 'Room', order: 0 }],
    sceneNodes: ['Cat [n-cat]'],
    selection: [],
    materials: [],
    shaders: [],
    clips: ['Walk'],
    assets: [],
    clipCollections: ['Walk Cycle'],
    audio: [],
    embeddedAudio: [],
    animatableParams: ['positionX'],
    scriptVerbs: ['reveal'],
    animation: {
      nodes: [
        {
          id: 'n-cat',
          name: 'Cat',
          parentId: 'root',
          depth: 1,
          semanticName: 'cat',
          components: ['mesh'],
          transform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
          worldTransform: { x: 10, y: 20, rotation: 0, scaleX: 1, scaleY: 1 },
          visible: true,
          childCount: 0,
        },
      ],
      rig: {
        boneCount: 0,
        bones: [],
        shapeInventory: [{ nodeId: 'n-cat', shapeCount: 1, shapeNames: ['Sit'] }],
        morphBindings: [],
        controls: [],
      },
      clips: [
        {
          id: 'clip-walk',
          name: 'Walk',
          duration: 2,
          category: 'locomotion',
          channelCount: 2,
          channels: ['positionX', 'positionY'],
        },
      ],
      collections: [
        {
          id: 'col-walk',
          name: 'Walk Cycle',
          category: 'locomotion',
          bindingCount: 1,
          bindings: { cat: 'clip-walk' },
          hasAlignmentOffsets: false,
        },
      ],
      timeline: {
        slideId: 's-1',
        duration: 12,
        animatedNodeCount: 1,
        totalKeyframes: 1,
        clipInstanceCount: 1,
        placementCount: 0,
        perNode: [{ nodeId: 'n-cat', keyframes: 1, clipInstances: 1, placements: 0 }],
        controlHosts: [],
        hasAnimationScript: false,
      },
      truncated: { nodes: false, clips: false, collections: false, timelineNodes: false },
    },
  }
}

describe('AiAnimationView', () => {
  it('opens against the live project with bounded summaries', () => {
    render(<AiAnimationView projectId="p-1" conversationId="c-1" context={context()} />)

    expect(screen.getByTestId('ai-animation-section')).toBeInTheDocument()
    // Live, unsaved project state is visible in the dedicated mode.
    expect(screen.getByTestId('ai-animation-project')).toHaveTextContent('Unsaved Cat Edit')
    expect(screen.getByTestId('ai-animation-slide')).toHaveTextContent('Room')
    expect(screen.getByTestId('ai-animation-nodes')).toHaveTextContent('Cat')
    expect(screen.getByTestId('ai-animation-clips')).toHaveTextContent('Walk')
    expect(screen.getByTestId('ai-animation-collections')).toHaveTextContent('Walk Cycle')
    expect(screen.getByTestId('ai-animation-timeline')).toHaveTextContent('12')
    expect(screen.getByTestId('ai-animation-readonly-note')).toBeInTheDocument()
  })

  it('shows a degraded note when the backend is unreachable', () => {
    render(<AiAnimationView projectId="p-1" conversationId="c-1" context={context()} disabled />)

    expect(screen.getByTestId('ai-animation-disabled')).toBeInTheDocument()
  })
})

describe('AiPanel animation mode', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    useAiStore.setState({
      conversations: [],
      messagesById: {},
      activeByProject: {},
      drafts: {},
      search: '',
      panelOpen: true,
      assistantMode: 'lesson',
      settingsOpen: false,
      status: 'idle',
      streamingConversationId: null,
      streamingContent: '',
      lastError: null,
    })
    useBackendStore.setState({ status: 'available' })
    vi.mocked(fetch).mockImplementation(
      async () => new Response(JSON.stringify([]), { status: 200 }),
    )
  })

  function renderPanel() {
    const engine = createEngineInternal()
    engine.createProject({ name: 'Live Unsaved Name' })
    engine.createSlide('Room')
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
    const value: EngineContextValue = {
      engine: toReadOnly(engine),
      undoStack,
      dispatch: (command) => dispatcher.dispatch(command),
      persistence: { save: vi.fn(), onCommandSucceeded: () => undefined, dispose: () => undefined },
    }
    render(
      <EngineContext.Provider value={value}>
        <AiPanel />
      </EngineContext.Provider>,
    )
  }

  it('switches to a dedicated animation mode without lesson stages', async () => {
    renderPanel()
    const user = userEvent.setup()

    await user.click(screen.getByTestId('ai-mode-animation'))

    // Dedicated mode surfaces the live (unsaved) project, not lesson stages.
    expect(screen.getByTestId('ai-animation-section')).toBeInTheDocument()
    expect(screen.getByTestId('ai-animation-project')).toHaveTextContent('Live Unsaved Name')
    expect(screen.queryByTestId('ai-plan-section')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-board-section')).not.toBeInTheDocument()
    // Shared proposal lifecycle stays available in both modes.
    expect(screen.getByTestId('ai-proposal-section')).toBeInTheDocument()
  })

  it('switches back to lesson mode', async () => {
    renderPanel()
    const user = userEvent.setup()

    await user.click(screen.getByTestId('ai-mode-animation'))
    await user.click(screen.getByTestId('ai-mode-lesson'))

    expect(screen.queryByTestId('ai-animation-section')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-plan-section')).toBeInTheDocument()
  })
})
