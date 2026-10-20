import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiScenarioModal } from '../components/ai/AiScenarioModal'
import { AiScenarioDocComments } from '../components/ai/AiScenarioDocComments'
import type { ScenarioDocComment } from '../engine/scenarioDocComments'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import {
  appendScenarioVersion,
  createEmptyScenarioSection,
  createScenarioVersion,
  withScenarioBindings,
} from '../engine/scenarioSection'
import { useAiStore } from '../stores/aiStore'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useBackendStore } from '../stores/backendStore'
import type { AssetDefinition } from '../api'

const MD = [
  '## Step 1 — Who you are',
  '',
  '**Narrator:** Ser is for who you are.',
  '',
  '![Young doctor smiling](asset:young-doctor-smiling)',
  '',
  '> Brief: Warm portrait.',
  '',
  'You say soy.',
  '',
  '## Step 2 — Where you are',
  '',
  '| a | b |',
  '|---|---|',
  '| silla | mesa |',
  '',
  'Estamos en clase.',
  '',
].join('\n')

function makeDefinition(id: string, name: string): AssetDefinition {
  return {
    id,
    name,
    description: '',
    category: 'Object',
    tags: [],
    ai_description: '',
    original_filename: `${name}.png`,
    import_date: '2026-01-01T00:00:00Z',
    width: 1,
    height: 1,
    file_size: 1,
    aspect_ratio: 1,
    default_scale: 1,
    default_rotation: 0,
    pivot: { x: 0.5, y: 0.5 },
    anchors: [],
    original_url: '',
    thumbnail_url: '',
  }
}

function setupEngine(markdown: string) {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  let section = createEmptyScenarioSection(markdown)
  if (markdown) {
    const v1 = createScenarioVersion(markdown, 'Initial', [1, 2])
    section = appendScenarioVersion(section, v1)
    section = { ...section, currentMarkdown: markdown }
  }
  section = withScenarioBindings(section, {})
  engine.project!.setScenario(section)
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: dispatcher.dispatch.bind(dispatcher) as unknown as EngineContextValue['dispatch'],
    persistence: { save: vi.fn(), onCommandSucceeded: () => undefined, dispose: () => undefined },
  }
  return value
}

function resetStores() {
  useAiStore.setState({
    conversations: [],
    messagesById: {},
    activeByProject: {},
    drafts: {},
    search: '',
    panelOpen: true,
    settingsOpen: false,
    status: 'idle',
    streamingConversationId: null,
    streamingContent: '',
    lastError: null,
    assistantMode: 'scenario',
    proposals: [],
    proposalById: {},
    activeProposalId: null,
    proposalBusy: false,
    proposalError: null,
    scenarios: [],
    scenarioById: {},
    activeScenarioId: null,
    scenarioGenerating: false,
    scenarioError: null,
    scenarioRequest: '',
    markdownVersionsByProject: {},
    activeMarkdownVersionIdByProject: {},
    markdownAuditsByProject: {},
    markdownBusy: false,
    markdownError: null,
    scenarioTab: 'doc',
    scenarioModalOpen: false,
    scenarioMissingOnly: false,
  })
  useBackendStore.setState({ status: 'available' })
  useAssetLibraryStore.setState({
    definitions: [makeDefinition('def-doctor', 'Doctor')],
    allDefinitions: [makeDefinition('def-doctor', 'Doctor')],
    loaded: true,
    unavailable: false,
  })
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
  )
  resetStores()
})

describe('AiScenarioDocComments in the scenario modal', () => {
  function renderModal() {
    const value = setupEngine(MD)
    return render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
  }

  it('clicking a block icon button adds a listed comment with a stable anchor', async () => {
    const user = userEvent.setup()
    const { container } = renderModal()
    const doc = await screen.findByTestId('ai-scenario-modal-doc')

    // Icon buttons live inside their block — no hover chasing needed.
    const narrator = within(doc).getByText(/Ser is for who you are/)
    const blockBtn = within(narrator).getByTestId('ai-scenario-comment-block-btn')
    expect(blockBtn).toHaveAttribute('aria-label', expect.stringContaining('Step 1'))

    await user.click(blockBtn)
    expect(await screen.findByTestId('ai-scenario-comment-composer')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-comment-quote')).toHaveTextContent(
      'Ser is for who you are',
    )

    await user.type(screen.getByTestId('ai-scenario-comment-input'), 'Make it warmer.')
    await user.click(screen.getByTestId('ai-scenario-comment-save'))

    expect(await screen.findByTestId('ai-scenario-comments-list')).toHaveTextContent(
      'Make it warmer.',
    )
    expect(screen.getByTestId('ai-scenario-comments-count')).toHaveTextContent('1 inline comment')
    // The anchor block stays outlined after commenting.
    expect(container.querySelector('.has-doc-comment')).not.toBeNull()
    expect(screen.getByTestId('ai-scenario-comments-send')).not.toBeDisabled()
  })

  it('table cells have their own icon button anchoring row and column', async () => {
    const user = userEvent.setup()
    renderModal()
    const doc = await screen.findByTestId('ai-scenario-modal-doc')

    const cell = within(doc).getByText('silla').closest('td')!
    await user.click(within(cell).getByTestId('ai-scenario-comment-cell-btn'))
    expect(await screen.findByTestId('ai-scenario-comment-quote')).toHaveTextContent('silla')
    await user.type(screen.getByTestId('ai-scenario-comment-input'), 'Check spelling.')
    await user.click(screen.getByTestId('ai-scenario-comment-save'))

    const list = await screen.findByTestId('ai-scenario-comments-list')
    expect(list).toHaveTextContent('Check spelling.')
    expect(list).toHaveTextContent('table cell (row 2, column 1)')
  })

  it('re-renders never remount the doc tree (selections survive)', async () => {
    const user = userEvent.setup()
    renderModal()
    const doc = await screen.findByTestId('ai-scenario-modal-doc')

    const narrator = within(doc).getByText(/Ser is for who you are/)
    const before = doc.querySelector('.scenario-narrator')
    // Typing in the composer re-renders the whole modal subtree...
    await user.click(within(narrator).getByTestId('ai-scenario-comment-block-btn'))
    await user.type(screen.getByTestId('ai-scenario-comment-input'), 'draft text')
    // ...but the rendered doc nodes are preserved, not remounted.
    expect(doc.querySelector('.scenario-narrator')).toBe(before)
  })

  it('selecting text surfaces the floating button and editing/deleting works', async () => {
    const user = userEvent.setup()
    renderModal()
    const doc = await screen.findByTestId('ai-scenario-modal-doc')

    const target = within(doc).getByText(/Estamos en clase/)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    const range = document.createRange()
    range.selectNodeContents(target)
    selection?.addRange(range)
    fireEvent.mouseUp(doc)
    expect(await screen.findByTestId('ai-scenario-comment-float-btn')).toBeInTheDocument()

    await user.click(screen.getByTestId('ai-scenario-comment-float-btn'))
    await user.type(screen.getByTestId('ai-scenario-comment-input'), 'Rephrase.')
    await user.click(screen.getByTestId('ai-scenario-comment-save'))
    const list = await screen.findByTestId('ai-scenario-comments-list')
    expect(list).toHaveTextContent('Estamos en clase')
    expect(list).toHaveTextContent('Rephrase.')

    // Inline edit of the saved comment.
    const item = list.querySelector('li')!
    const commentId = item.getAttribute('data-testid')!.replace('ai-scenario-comment-', '')
    const edit = screen.getByTestId(`ai-scenario-comment-edit-${commentId}`)
    await user.clear(edit)
    await user.type(edit, 'Rephrase kindly.')
    expect(list).toHaveTextContent('Rephrase kindly.')

    await user.click(screen.getByTestId(`ai-scenario-comment-delete-${commentId}`))
    expect(screen.queryByTestId('ai-scenario-comments-list')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-comments-send')).toBeDisabled()
  })

  it('resolve sends one edit: message with every comment', async () => {
    const user = userEvent.setup()
    renderModal()
    const doc = await screen.findByTestId('ai-scenario-modal-doc')

    const first = within(doc).getByText(/Ser is for who you are/)
    await user.click(within(first).getByTestId('ai-scenario-comment-block-btn'))
    await user.type(screen.getByTestId('ai-scenario-comment-input'), 'Warmer please.')
    await user.click(screen.getByTestId('ai-scenario-comment-save'))

    const second = within(doc).getByText(/Estamos en clase/)
    await user.click(within(second).getByTestId('ai-scenario-comment-block-btn'))
    await user.type(screen.getByTestId('ai-scenario-comment-input'), 'Shorter.')
    await user.click(screen.getByTestId('ai-scenario-comment-save'))
    expect(screen.getByTestId('ai-scenario-comments-count')).toHaveTextContent('2 inline comments')

    await user.click(screen.getByTestId('ai-scenario-comments-send'))
    await vi.waitFor(() => {
      const chatCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([url, init]) =>
            String(url).endsWith('/api/ai/chat') &&
            (init as { method?: string } | undefined)?.method === 'POST',
        )
      expect(chatCall).toBeDefined()
      const body = String((chatCall![1] as { body?: unknown } | undefined)?.body ?? '')
      expect(body).toContain('edit:')
      expect(body).toContain('Warmer please.')
      expect(body).toContain('Shorter.')
    })
  })

  it('comments clear once the doc changes to a new version', async () => {
    const seed: ScenarioDocComment[] = [
      {
        id: 'seed-1',
        step: 1,
        blockKind: 'narrator',
        quote: 'Ser is for who you are.',
        comment: 'Keep me until the doc changes.',
        blockIndex: 1,
      },
    ]
    function Harness({ markdown }: { markdown: string }) {
      const [comments, setComments] = useState(seed)
      return (
        <AiScenarioDocComments
          projectId="p-1"
          conversationId="c-1"
          markdown={markdown}
          comments={comments}
          onCommentsChange={setComments}
        />
      )
    }
    const view = render(<Harness markdown={MD} />)
    expect(await screen.findByTestId('ai-scenario-comments-list')).toBeInTheDocument()
    view.rerender(<Harness markdown={`${MD}\n\nExtra line in a new version.`} />)
    expect(screen.queryByTestId('ai-scenario-comments-list')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-comments-count')).toHaveTextContent('No inline comments')
  })
})
