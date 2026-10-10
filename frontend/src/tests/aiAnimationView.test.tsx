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
          assetDefinitionId: null,
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

describe('AiAnimationView beat analysis (issue #440)', () => {
  function sofaContext(): ContextSnapshot {
    const base = context()
    return {
      ...base,
      animation: {
        ...base.animation,
        nodes: [
          ...base.animation.nodes,
          {
            id: 'n-sofa-frame',
            name: 'Sofa Frame',
            parentId: 'root',
            depth: 1,
            semanticName: null,
            components: ['mesh'],
            assetDefinitionId: 'asset-room',
            transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
            worldTransform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
            visible: true,
            childCount: 0,
          },
          {
            id: 'n-sofa-cushion',
            name: 'Sofa Cushion',
            parentId: 'root',
            depth: 1,
            semanticName: null,
            components: ['mesh'],
            assetDefinitionId: 'asset-room',
            transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
            worldTransform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
            visible: true,
            childCount: 0,
          },
        ],
      },
    }
  }

  it('shows an empty note when no actions were requested yet', () => {
    render(<AiAnimationView projectId="p-1" conversationId="c-1" context={context()} />)
    expect(screen.getByTestId('ai-animation-analysis-empty')).toBeInTheDocument()
  })

  it('reports reusable motion while a blocked beat keeps its precise question', () => {
    const before = JSON.stringify(sofaContext())
    render(
      <AiAnimationView
        projectId="p-1"
        conversationId="c-1"
        context={sofaContext()}
        beats={[
          { id: 'b-walk', label: 'Walk across the room', target: { name: 'Cat' }, motion: 'walk' },
          {
            id: 'b-sofa',
            label: 'Get down from the sofa',
            target: { name: 'sofa' },
            motion: 'get-down',
          },
        ]}
      />,
    )

    // Independent beats proceed: one ready, one asking — never one blocking the other.
    expect(screen.getByTestId('ai-analysis-summary')).toHaveTextContent(/1 ready/)
    expect(screen.getByTestId('ai-analysis-beat-b-walk')).toHaveTextContent(/ready/i)
    expect(screen.getByTestId('ai-analysis-beat-b-walk')).toHaveTextContent(/Walk Cycle/)
    const sofa = screen.getByTestId('ai-analysis-beat-b-sofa')
    expect(sofa).toHaveTextContent(/clarification|ambiguous/i)
    expect(screen.getByTestId('ai-analysis-question-b-sofa')).toHaveTextContent(/sofa/i)
    // Read-only analysis leaves the supplied context untouched.
    expect(JSON.stringify(sofaContext())).toBe(before)
  })

  it('surfaces missing camera prerequisites and missing motion explicitly', () => {
    render(
      <AiAnimationView
        projectId="p-1"
        conversationId="c-1"
        context={context()}
        beats={[
          {
            id: 'b-camera',
            label: 'Turn and move toward the camera',
            target: { name: 'Cat' },
            motion: 'turn',
            requiresCamera: true,
          },
          { id: 'b-sleep', label: 'Sleep on the sofa', target: { name: 'Cat' }, motion: 'sleep' },
        ]}
      />,
    )

    expect(screen.getByTestId('ai-analysis-beat-b-camera')).toHaveTextContent(/camera/i)
    expect(screen.getByTestId('ai-analysis-beat-b-sleep')).toHaveTextContent(
      /missing.*motion|no compatible/i,
    )
  })
})

describe('AiAnimationView rendered views (issue #441)', () => {
  it('shows an empty note when no views were requested yet', () => {
    render(<AiAnimationView projectId="p-1" conversationId="c-1" context={context()} />)
    expect(screen.getByTestId('ai-rendered-views-empty')).toBeInTheDocument()
  })

  it('labels current and focused views with Slide, time, and stable node ids', () => {
    const before = JSON.stringify(context())
    render(
      <AiAnimationView
        projectId="p-1"
        conversationId="c-1"
        context={context()}
        viewRequests={[
          { id: 'v-current', scope: 'current', time: 3.2 },
          { id: 'v-focused', scope: 'focused', time: 5, nodeIds: ['n-cat'] },
        ]}
      />,
    )

    const current = screen.getByTestId('ai-rendered-view-v-current')
    expect(screen.getByTestId('ai-rendered-view-label-v-current')).toHaveTextContent(/Room/)
    expect(current).toHaveTextContent(/s-1/)
    expect(current).toHaveTextContent(/3\.2/)
    expect(current).toHaveTextContent(/n-cat/)
    expect(screen.getByTestId('ai-rendered-view-label-v-focused')).toHaveTextContent(/n-cat/)
    // Visual evidence never replaces structured identity.
    expect(screen.getByTestId('ai-rendered-views')).toHaveTextContent(/never from pixels/i)
    // Read-only views leave the supplied context untouched.
    expect(JSON.stringify(context())).toBe(before)
  })

  it('reports invalid view requests with the precise fix', () => {
    render(
      <AiAnimationView
        projectId="p-1"
        conversationId="c-1"
        context={context()}
        viewRequests={[{ id: 'v-bad', scope: 'focused', time: 1, nodeIds: ['n-gone'] }]}
      />,
    )

    expect(screen.getByTestId('ai-rendered-view-v-bad')).toHaveTextContent(/invalid/i)
    expect(screen.getByTestId('ai-rendered-view-v-bad')).toHaveTextContent(/n-gone/i)
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
