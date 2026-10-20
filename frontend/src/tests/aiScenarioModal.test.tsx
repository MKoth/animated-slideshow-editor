import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiScenarioModal } from '../components/ai/AiScenarioModal'
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
  '![Empty classroom chairs](asset:empty-classroom-chairs)',
  '',
  '<!-- reuse: Classroom Chairs -->',
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

function setupEngine(markdown: string, bindings: Record<string, string> = {}) {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  let section = createEmptyScenarioSection(markdown)
  if (markdown) {
    const v1 = createScenarioVersion(markdown, 'Initial', [1, 2])
    section = appendScenarioVersion(section, v1)
    // Keep the portable version id stable for html-state tests.
    section = { ...section, currentMarkdown: markdown }
  }
  section = withScenarioBindings(section, bindings)
  engine.project!.setScenario(section)
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: dispatcher.dispatch.bind(dispatcher) as unknown as EngineContextValue['dispatch'],
    persistence: { save: vi.fn(), onCommandSucceeded: () => undefined, dispose: () => undefined },
  }
  return { engine, value, undoStack }
}

function renderModal(
  value: EngineContextValue,
  opts: { projectId?: string; conversationId?: string | null } = {},
) {
  return render(
    <EngineContext.Provider value={value}>
      <AiScenarioModal
        projectId={opts.projectId ?? 'p-1'}
        conversationId={opts.conversationId ?? 'c-1'}
      />
    </EngineContext.Provider>,
  )
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
  )
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
    allDefinitions: [
      makeDefinition('def-doctor', 'Doctor'),
      makeDefinition('def-chairs', 'Classroom Chairs'),
    ],
    loaded: true,
    unavailable: false,
  })
})

describe('AiScenarioModal doc-first blocking checklist (issue #463)', () => {
  it('empty state opens the modal instead of hiding', async () => {
    const { value } = setupEngine('')
    renderModal(value)
    expect(await screen.findByTestId('ai-scenario-modal')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-modal-empty')).toBeInTheDocument()
  })

  it('modal shows doc center, right-rail checklist, top-bar actions, and Doc vs History tabs', async () => {
    const { value } = setupEngine(MD)
    useAiStore.setState({ scenarioModalOpen: true })
    renderModal(value)
    expect(await screen.findByTestId('ai-scenario-modal')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-modal-doc')).toHaveTextContent('Ser is for who')
    expect(screen.getByTestId('ai-scenario-checklist')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-generate')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-view')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-download')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-modal-tab-doc')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-modal-tab-history')).toBeInTheDocument()
    // Checklist rows keyed by normalized asset key from the live scan.
    expect(screen.getByTestId('ai-scenario-checklist-row-young-doctor-smiling')).toBeInTheDocument()
    expect(
      screen.getByTestId('ai-scenario-checklist-row-empty-classroom-chairs'),
    ).toBeInTheDocument()
  })

  it('Generate hard-blocked with unbound count; View disabled with no-HTML-yet explanation', async () => {
    const { value } = setupEngine(MD, {})
    useAiStore.setState({ scenarioModalOpen: true })
    renderModal(value)
    const generate = await screen.findByTestId('ai-scenario-generate')
    expect(generate).toBeDisabled()
    expect(generate).toHaveTextContent('2 unbound')
    expect(screen.getByTestId('ai-scenario-unbound-count')).toHaveTextContent('2 unbound')
    const view = screen.getByTestId('ai-scenario-view')
    expect(view).toBeDisabled()
    expect(screen.getByTestId('ai-scenario-view-empty-hint')).toHaveTextContent('No HTML yet')
    expect(screen.getByTestId('ai-scenario-html-state')).toHaveTextContent('empty')
    const download = screen.getByTestId('ai-scenario-download')
    expect(download).toBeDisabled()
  })

  it('View plus zip enable once HTML ready; re-generation allowed; stale hint after doc edits', async () => {
    const { engine, value } = setupEngine(MD, {
      'young-doctor-smiling': 'def-doctor',
      'empty-classroom-chairs': 'def-chairs',
    })
    const section = engine.project!.scenario!
    const versionId = section.versions[0]!.id
    engine.project!.setScenario({
      ...section,
      lastHtml: '<html>render</html>',
      generatedFromVersionId: versionId,
    })
    useAiStore.setState({ scenarioModalOpen: true })
    renderModal(value)
    const generate = await screen.findByTestId('ai-scenario-generate')
    expect(generate).not.toBeDisabled()
    expect(screen.getByTestId('ai-scenario-html-state')).toHaveTextContent('ready')
    const view = screen.getByTestId('ai-scenario-view')
    expect(view).not.toBeDisabled()
    const download = screen.getByTestId('ai-scenario-download')
    expect(download).not.toBeDisabled()

    // View opens the stored HTML preview.
    const user = userEvent.setup()
    await user.click(view)
    expect(await screen.findByTestId('ai-scenario-html-preview')).toBeInTheDocument()

    // Doc edit after generation marks stale but View still opens the old render.
    // Edit via the checklist brief input so the modal's live scan bumps and
    // the top-bar recomputes to stale (direct engine mutation emits no event).
    const briefInput = screen.getByTestId(
      'ai-scenario-checklist-brief-input-young-doctor-smiling',
    ) as HTMLInputElement
    await user.clear(briefInput)
    await user.type(briefInput, 'Edited after generation.')
    await user.click(screen.getByTestId('ai-scenario-checklist-save-brief-young-doctor-smiling'))
    expect(await screen.findByTestId('ai-scenario-stale-hint')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-html-state')).toHaveTextContent('stale')
    expect(screen.getByTestId('ai-scenario-view')).not.toBeDisabled()
    // Re-generation stays allowed while ready/stale as long as all rows bind.
    expect(screen.getByTestId('ai-scenario-generate')).not.toBeDisabled()
  })

  it('per-row Bind library asset resolves in one click', async () => {
    const { engine, value } = setupEngine(MD, {})
    useAiStore.setState({ scenarioModalOpen: true })
    renderModal(value)
    await screen.findByTestId('ai-scenario-checklist-row-young-doctor-smiling')
    const user = userEvent.setup()
    const select = screen.getByTestId(
      'ai-scenario-checklist-bind-young-doctor-smiling',
    ) as HTMLSelectElement
    await user.selectOptions(select, 'def-doctor')
    expect(engine.project!.scenario!.bindings['young-doctor-smiling']).toBe('def-doctor')
    expect(
      screen.getByTestId('ai-scenario-checklist-status-young-doctor-smiling'),
    ).toHaveTextContent('Bound')
  })

  it('per-row Edit brief resolves in one click', async () => {
    const { engine, value } = setupEngine(MD, {})
    useAiStore.setState({ scenarioModalOpen: true })
    renderModal(value)
    await screen.findByTestId('ai-scenario-checklist-row-young-doctor-smiling')
    const user = userEvent.setup()
    const input = screen.getByTestId(
      'ai-scenario-checklist-brief-input-young-doctor-smiling',
    ) as HTMLInputElement
    await user.clear(input)
    await user.type(input, 'Edited brief one-click.')
    await user.click(screen.getByTestId('ai-scenario-checklist-save-brief-young-doctor-smiling'))
    expect(engine.project!.scenario!.currentMarkdown).toContain('Edited brief one-click.')
  })

  it('per-row Upload resolves in one click', async () => {
    const { engine, value } = setupEngine(MD, {})
    useAiStore.setState({ scenarioModalOpen: true })
    const created = makeDefinition('def-uploaded', 'Uploaded')
    const importSpy = vi
      .spyOn(useAssetLibraryStore.getState(), 'importFiles')
      .mockResolvedValue({ created: [created], errors: [] })
    renderModal(value)
    await screen.findByTestId('ai-scenario-checklist-row-young-doctor-smiling')
    const input = screen.getByTestId('ai-scenario-checklist-upload-young-doctor-smiling')
    const file = new File(['bytes'], 'pic.png', { type: 'image/png' })
    await userEvent.upload(input, file)
    expect(importSpy).toHaveBeenCalled()
    expect(engine.project!.scenario!.bindings['young-doctor-smiling']).toBe('def-uploaded')
    importSpy.mockRestore()
  })

  it('missing-only filter narrows to unbound rows and checklist rescans live on doc edits', async () => {
    const { engine, value } = setupEngine(MD, {
      'young-doctor-smiling': 'def-doctor',
    })
    useAiStore.setState({ scenarioModalOpen: true })
    const view = renderModal(value)
    await screen.findByTestId('ai-scenario-checklist-row-young-doctor-smiling')
    const user = userEvent.setup()
    await user.click(screen.getByTestId('ai-scenario-checklist-filter'))
    // Bound row hides; unbound row stays.
    expect(
      screen.queryByTestId('ai-scenario-checklist-row-young-doctor-smiling'),
    ).not.toBeInTheDocument()
    expect(
      screen.getByTestId('ai-scenario-checklist-row-empty-classroom-chairs'),
    ).toBeInTheDocument()
    // Live scan: editing the doc to add a visual adds a row without reopening.
    // Direct engine mutation emits no event, so force a React re-render — the
    // modal recomputes rows from the fresh markdown on every render.
    const { withScenarioMarkdown } = await import('../engine/scenarioSection')
    const current = engine.project!.scenario!
    engine.project!.setScenario(
      withScenarioMarkdown(
        current,
        `${current.currentMarkdown}\n\n![New visual](asset:new-visual)\n\n> Brief: New.`,
      ),
    )
    view.rerender(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    expect(await screen.findByTestId('ai-scenario-checklist-row-new-visual')).toBeInTheDocument()
    // Back to all rows.
    await user.click(screen.getByTestId('ai-scenario-checklist-filter'))
    expect(screen.getByTestId('ai-scenario-checklist-row-young-doctor-smiling')).toBeInTheDocument()
  })

  it('History tab inside the modal lists versions with diff and restore affordance', async () => {
    const { value } = setupEngine(MD, {})
    vi.mocked(fetch).mockImplementation(async (url: unknown) => {
      const path = String(url)
      if (path.includes('/markdown/versions') && !path.includes('/restore')) {
        return new Response(
          JSON.stringify([
            {
              id: 'v-1',
              projectId: 'p-1',
              conversationId: 'c-1',
              messageId: 'm-1',
              summary: 'First',
              touchedSteps: [1],
              timestamp: '2026-01-01T00:00:00Z',
              content: MD,
              baseVersionId: null,
            },
          ]),
          { status: 200 },
        )
      }
      if (path.includes('/markdown/active')) {
        return new Response(
          JSON.stringify({ projectId: 'p-1', activeVersionId: 'v-1', version: null }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })
    useAiStore.setState({ scenarioModalOpen: true, scenarioTab: 'history' })
    renderModal(value)
    expect(await screen.findByTestId('ai-scenario-history')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-version-v-1')).toBeInTheDocument()
    // Doc tab switch stays inside the modal.
    const withinModal = within(screen.getByTestId('ai-scenario-modal'))
    await userEvent.click(withinModal.getByTestId('ai-scenario-modal-tab-doc'))
    expect(await screen.findByTestId('ai-scenario-modal-doc')).toBeInTheDocument()
  })
})
