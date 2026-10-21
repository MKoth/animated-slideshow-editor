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
  withScenarioMarkdown,
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

  it('modal shows doc center, right-rail checklist, top-bar actions, and Doc vs History vs Preview tabs', async () => {
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
    expect(screen.getByTestId('ai-scenario-modal-tab-preview')).toBeInTheDocument()
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

    // View opens the stored HTML preview in the Preview tab.
    const user = userEvent.setup()
    await user.click(view)
    expect(await screen.findByTestId('ai-scenario-html-preview')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-modal-tab-preview')).toBeDisabled()
    // Back to Doc to edit via the checklist.
    await user.click(screen.getByTestId('ai-scenario-modal-tab-doc'))

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

  it('binding signals persistence so reload keeps the selection', async () => {
    const { engine, value } = setupEngine(MD, {})
    useAiStore.setState({ scenarioModalOpen: true })
    const persisted = vi.fn()
    render(
      <EngineContext.Provider
        value={{ ...value, persistence: { ...value.persistence, onCommandSucceeded: persisted } }}
      >
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    await screen.findByTestId('ai-scenario-checklist-row-young-doctor-smiling')
    const user = userEvent.setup()
    const select = screen.getByTestId(
      'ai-scenario-checklist-bind-young-doctor-smiling',
    ) as HTMLSelectElement
    await user.selectOptions(select, 'def-doctor')
    expect(engine.project!.scenario!.bindings['young-doctor-smiling']).toBe('def-doctor')
    // Without this signal autosave skips the project and the binding is
    // lost on reload (scenario writes bypass the engine Undo Stack).
    expect(persisted).toHaveBeenCalled()
  })

  it('group-first filter narrows the bind list to one folder', async () => {
    const { value } = setupEngine(MD, {})
    const folders = [
      {
        id: 'f-animals',
        name: 'Animals',
        parent_id: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/assets/folders')) {
        return new Response(JSON.stringify(folders), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })
    useAssetLibraryStore.setState({
      definitions: [
        { ...makeDefinition('def-doctor', 'Doctor'), folder_id: 'f-animals' },
        { ...makeDefinition('def-chairs', 'Classroom Chairs'), folder_id: null },
      ],
      allDefinitions: [
        { ...makeDefinition('def-doctor', 'Doctor'), folder_id: 'f-animals' },
        { ...makeDefinition('def-chairs', 'Classroom Chairs'), folder_id: null },
      ],
      folders: [],
      loaded: true,
      unavailable: false,
    })
    renderModal(value)
    await screen.findByTestId('ai-scenario-checklist-row-young-doctor-smiling')
    const user = userEvent.setup()
    const group = screen.getByTestId(
      'ai-scenario-checklist-group-young-doctor-smiling',
    ) as HTMLSelectElement
    // Fresh folders load on mount: All, Uncategorized, then folder paths.
    await vi.waitFor(() => {
      expect([...group.options].map((o) => o.text)).toEqual(['All', 'Uncategorized', 'Animals'])
    })
    const bind = screen.getByTestId(
      'ai-scenario-checklist-bind-young-doctor-smiling',
    ) as HTMLSelectElement
    // Default All shows every asset.
    expect([...bind.options].map((o) => o.text)).toEqual(['Unbound', 'Classroom Chairs', 'Doctor'])
    // Pick the Animals group: only Doctor remains.
    await user.selectOptions(group, 'f-animals')
    expect([...bind.options].map((o) => o.text)).toEqual(['Unbound', 'Doctor'])
    // Uncategorized group: only the unfiled chair.
    await user.selectOptions(group, 'ungrouped')
    expect([...bind.options].map((o) => o.text)).toEqual(['Unbound', 'Classroom Chairs'])
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

  it('Delete HTML arms on first click and clears only the stored render', async () => {
    const { value, engine } = setupEngine(MD, {})
    const section = engine.project!.scenario!
    const versionId = section.versions[0]!.id
    engine.project!.setScenario({
      ...section,
      lastHtml: '<html>render</html>',
      generatedFromVersionId: versionId,
    })
    useAiStore.setState({ scenarioModalOpen: true })
    renderModal(value)
    expect(await screen.findByTestId('ai-scenario-modal-doc')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-html-state')).toHaveTextContent('ready')

    const deleteHtml = screen.getByTestId('ai-scenario-delete-html')
    expect(deleteHtml).not.toBeDisabled()
    await userEvent.click(deleteHtml)
    // Armed only — nothing deleted yet.
    expect(screen.getByTestId('ai-scenario-delete-html')).toHaveTextContent('Confirm')
    expect(engine.project?.scenario?.lastHtml).toBe('<html>render</html>')
    await userEvent.click(screen.getByTestId('ai-scenario-delete-html'))
    expect(engine.project?.scenario?.lastHtml).toBeUndefined()
    expect(engine.project?.scenario?.generatedFromVersionId).toBeNull()
    expect(await screen.findByTestId('ai-scenario-html-state')).toHaveTextContent('empty')
    // Doc survives the HTML delete.
    expect(engine.project?.scenario?.currentMarkdown).toContain('Step 1')
    expect(screen.getByTestId('ai-scenario-modal-doc')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-delete-html')).toBeDisabled()
  })

  it('Delete doc arms on first click and clears doc/history while keeping HTML', async () => {
    const { value, engine } = setupEngine(MD, {})
    const section = engine.project!.scenario!
    const versionId = section.versions[0]!.id
    engine.project!.setScenario({
      ...section,
      lastHtml: '<html>render</html>',
      generatedFromVersionId: versionId,
    })
    useAiStore.setState({
      scenarioModalOpen: true,
      markdownVersionsByProject: {
        'p-1': [
          {
            id: versionId,
            projectId: 'p-1',
            conversationId: 'c-1',
            messageId: 'm-1',
            summary: 'Initial',
            touchedSteps: [1, 2],
            timestamp: new Date().toISOString(),
            content: MD,
            baseVersionId: null,
          },
        ],
      },
    })
    renderModal(value)
    expect(await screen.findByTestId('ai-scenario-modal-doc')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByTestId('ai-scenario-delete-doc'))
    // Armed only — nothing deleted yet.
    expect(screen.getByTestId('ai-scenario-delete-doc')).toHaveTextContent('Confirm')
    expect(engine.project?.scenario?.currentMarkdown).toContain('Step 1')
    await user.click(screen.getByTestId('ai-scenario-delete-doc'))
    const cleared = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, init]) =>
          String(url).includes('/api/ai/scenarios/markdown/versions?projectId=') &&
          (init as { method?: string } | undefined)?.method === 'DELETE',
      )
    expect(cleared).toBeDefined()
    expect(engine.project?.scenario?.currentMarkdown).toBe('')
    expect(engine.project?.scenario?.bindings).toEqual({})
    expect(await screen.findByTestId('ai-scenario-modal-empty')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-checklist-empty')).toBeInTheDocument()
    // Stored HTML survives the doc delete (stale orphaned render).
    expect(engine.project?.scenario?.lastHtml).toBe('<html>render</html>')
    expect(screen.getByTestId('ai-scenario-html-state')).toHaveTextContent('stale')
    // Preview still opens the old render from the preserved source version.
    await user.click(screen.getByTestId('ai-scenario-view'))
    expect(await screen.findByTestId('ai-scenario-html-preview')).toBeInTheDocument()
  })

  it('Copy MD copies the current markdown to the clipboard', async () => {
    const { value } = setupEngine(MD, {})
    useAiStore.setState({ scenarioModalOpen: true })
    renderModal(value)
    expect(await screen.findByTestId('ai-scenario-modal-doc')).toBeInTheDocument()
    // userEvent.setup() installs its own clipboard — stub after it.
    const user = userEvent.setup()
    const writeText = vi.fn(async (...args: unknown[]) => {
      void args
    })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await user.click(screen.getByTestId('ai-scenario-copy-md'))
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(String(writeText.mock.calls[0]![0])).toContain('## Step 1 — Who you are')
    expect(await screen.findByText('Copied')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })

  it('shows a background-synced doc without refresh after the doc revision bump', async () => {
    const { value, engine } = setupEngine('', {})
    useAiStore.setState({ scenarioModalOpen: true })
    renderModal(value)
    expect(await screen.findByTestId('ai-scenario-modal-empty')).toBeInTheDocument()
    // Background server→portable sync mutates silently (no React signal)...
    engine.project!.setScenario(
      withScenarioMarkdown(engine.project!.scenario ?? createEmptyScenarioSection(''), MD),
    )
    expect(screen.queryByTestId('ai-scenario-modal-empty')).toBeInTheDocument()
    // ...until the revision bump notifies subscribers.
    useAiStore.getState().bumpScenarioDocRev('p-1')
    expect(await screen.findByTestId('ai-scenario-modal-doc')).toHaveTextContent('Who you are')
    expect(screen.queryByTestId('ai-scenario-modal-empty')).not.toBeInTheDocument()
  })

  it('shows doc warnings with a send-to-assistant fix request', async () => {
    const warnMd = [
      '# Lesson',
      '',
      '## Step 1 — One',
      '',
      '[remove: ghost-key]',
      '',
      '**Narrator:** Hi.',
      '',
    ].join('\n')
    const { value } = setupEngine(warnMd, {})
    useAiStore.setState({ scenarioModalOpen: true })
    renderModal(value)
    expect(await screen.findByTestId('ai-scenario-warnings')).toHaveTextContent('unknown-remove')
    await userEvent.click(screen.getByTestId('ai-scenario-warnings-send'))
    await vi.waitFor(() => {
      const chatCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([url, init]) =>
            String(url).endsWith('/api/ai/chat') &&
            (init as { method?: string } | undefined)?.method === 'POST',
        )
      expect(chatCall).toBeDefined()
      expect(String((chatCall![1] as { body?: unknown } | undefined)?.body)).toContain(
        'unknown-remove',
      )
    })
  })
})
