import { render, screen, waitFor } from '@testing-library/react'
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
  '| Spanish | English |',
  '| --- | --- |',
  '| Soy doctora | I am a doctor |',
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

function toBase64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes))
}

function setupEngineWithEmbedded() {
  const { engine, value } = setupEngine(MD, {
    'young-doctor-smiling': 'emb-doctor',
    'empty-classroom-chairs': 'emb-chairs',
  })
  engine.embedAsset({
    id: 'emb-doctor',
    name: 'doctor.png',
    data: toBase64([137, 80, 78, 71, 1, 2, 3]),
    mimeType: 'image/png',
  })
  engine.embedAsset({
    id: 'emb-chairs',
    name: 'chairs.png',
    data: toBase64([137, 80, 78, 71, 4, 5, 6]),
    mimeType: 'image/png',
  })
  return { engine, value }
}

function setupEngine(markdown: string, bindings: Record<string, string> = {}) {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  let section = createEmptyScenarioSection(markdown)
  if (markdown) {
    const v1 = createScenarioVersion(markdown, 'Initial', [1, 2])
    section = appendScenarioVersion(section, v1)
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
  return { engine, value }
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
    scenarioModalOpen: true,
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

describe('AiScenarioModal Generate lifecycle (issue #464)', () => {
  it('manual Generate renders deterministic chalk HTML and View embeds images', async () => {
    const { engine, value } = setupEngineWithEmbedded()
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const user = userEvent.setup()
    const generate = await screen.findByTestId('ai-scenario-generate')
    expect(generate).not.toBeDisabled()

    await user.click(generate)
    const stored = engine.project!.scenario!.lastHtml ?? ''
    expect(stored).toContain('<!DOCTYPE html>')
    // One section per Step in markdown order.
    expect(stored).toContain('data-step="1"')
    expect(stored).toContain('data-step="2"')
    // Stored HTML keeps portable assets/ paths (zip context) with alt preserved.
    expect(stored).toContain('src="assets/young-doctor-smiling.png"')
    expect(stored).toContain('alt="Young doctor smiling"')
    // Briefs and reuse names stay internal.
    expect(stored).not.toContain('Warm portrait')
    expect(stored).not.toContain('Classroom Chairs')
    // Mandatory theme tokens, no scripts or remote fetches.
    expect(stored).toContain('--board: #20302A')
    expect(stored).toContain('Crayon Libre')
    expect(stored).toContain('assets/board-tile.png')
    expect(stored.toLowerCase()).not.toContain('<script')
    expect(stored).not.toContain('https://')

    // View lifecycle: empty → ready. The preview embeds bound bytes as
    // data: URIs — relative assets/ paths 404 in a srcDoc iframe, so the
    // stored HTML alone would render every image broken.
    expect(await screen.findByTestId('ai-scenario-html-state')).toHaveTextContent('ready')
    await user.click(screen.getByTestId('ai-scenario-view'))
    const frame = await screen.findByTestId('ai-scenario-html-frame')
    await waitFor(() => {
      expect(frame.getAttribute('srcDoc')).toContain('data:image/png;base64,')
    })
    expect(frame.getAttribute('srcDoc')).not.toContain('src="assets/')
    expect(frame.getAttribute('srcDoc')).toContain('alt="Young doctor smiling"')
  })

  it('Generate asks the LLM for foreign words and highlights the returned list', async () => {
    const { engine, value } = setupEngineWithEmbedded()
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    let requestBody = ''
    vi.mocked(fetch).mockImplementation(async (url: unknown, init?: unknown) => {
      if (String(url).includes('/foreign-words')) {
        requestBody = String((init as { body?: unknown } | undefined)?.body ?? '')
        return new Response(JSON.stringify({ words: ['Ser', 'doctora'] }), { status: 200 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-scenario-generate'))
    // Narrator sentences are glued into one request text.
    expect(requestBody).toContain('Ser is for who you are.')
    // The stored HTML highlights the returned list…
    const stored = engine.project!.scenario!.lastHtml ?? ''
    expect(stored).toContain('<strong class="foreign">Ser</strong> is for who you are.')
    // …and the list is stored beside the HTML for View/Download reuse.
    expect(engine.project!.scenario!.foreignWords).toEqual(['Ser', 'doctora'])
    // View reuses the stored list without another LLM call.
    await user.click(screen.getByTestId('ai-scenario-view'))
    const frame = await screen.findByTestId('ai-scenario-html-frame')
    await waitFor(() => {
      expect(frame.getAttribute('srcDoc')).toContain(
        '<strong class="foreign">Ser</strong> is for who you are.',
      )
    })
  })

  it('Generate shows a loader until the LLM request resolves', async () => {
    const { engine, value } = setupEngineWithEmbedded()
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    let resolveForeign!: (response: Response) => void
    const gate = new Promise<Response>((resolve) => {
      resolveForeign = resolve
    })
    vi.mocked(fetch).mockImplementation(async (url: unknown) => {
      if (String(url).includes('/foreign-words')) return gate
      return new Response(JSON.stringify([]), { status: 200 })
    })
    const user = userEvent.setup()
    const pressed = user.click(await screen.findByTestId('ai-scenario-generate'))
    await waitFor(() => {
      expect(screen.getByTestId('ai-scenario-generate')).toHaveTextContent('Generating HTML…')
    })
    expect(screen.getByTestId('ai-scenario-generate')).toBeDisabled()
    resolveForeign(new Response(JSON.stringify({ words: [] }), { status: 200 }))
    await pressed
    expect(await screen.findByTestId('ai-scenario-html-state')).toHaveTextContent('ready')
    expect(engine.project!.scenario!.lastHtml ?? '').toContain('<!DOCTYPE html>')
  })

  it('Generate still renders HTML without highlights when the LLM call fails', async () => {
    const { engine, value } = setupEngineWithEmbedded()
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    vi.mocked(fetch).mockImplementation(async (url: unknown) => {
      if (String(url).includes('/foreign-words')) {
        return new Response('boom', { status: 500 })
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-scenario-generate'))
    expect(await screen.findByTestId('ai-scenario-html-state')).toHaveTextContent('ready')
    // The narrator renders plain: no LLM list, no highlights.
    const stored = engine.project!.scenario!.lastHtml ?? ''
    expect(stored).toContain('Ser is for who you are.')
    expect(stored).not.toContain('<strong class="foreign">Ser</strong>')
    expect(engine.project!.scenario!.foreignWords).toEqual([])
  })

  it('doc edits after generation mark stale while View still opens the old render', async () => {
    const { engine, value } = setupEngineWithEmbedded()
    const view = render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-scenario-generate'))
    const firstHtml = engine.project!.scenario!.lastHtml ?? ''
    expect(firstHtml).toContain('data-step="1"')

    // Edit rendered content (the narrator) via a direct doc mutation, then
    // re-render — the modal recomputes from the fresh markdown every render.
    const edited = MD.replace('Ser is for who you are.', 'Edited narrator line.')
    engine.project!.setScenario(withScenarioMarkdown(engine.project!.scenario!, edited))
    view.rerender(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )

    expect(await screen.findByTestId('ai-scenario-stale-hint')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-html-state')).toHaveTextContent('stale')
    // View stays enabled and still opens the old render.
    const viewButton = screen.getByTestId('ai-scenario-view')
    expect(viewButton).not.toBeDisabled()
    await user.click(viewButton)
    const frame = await screen.findByTestId('ai-scenario-html-frame')
    await waitFor(() => {
      // The old render opens unchanged (stubbed LLM returns no words).
      expect(frame.getAttribute('srcDoc')).toContain('Ser is for who you are.')
    })
    expect(frame.getAttribute('srcDoc')).not.toContain('Edited narrator line.')

    // Re-generation is allowed and the fresh render carries the edit.
    await user.click(screen.getByTestId('ai-scenario-generate'))
    expect(await screen.findByTestId('ai-scenario-html-state')).toHaveTextContent('ready')
    await user.click(screen.getByTestId('ai-scenario-view'))
    // The iframe remounts with fresh HTML: re-query on every poll.
    await waitFor(() => {
      const frames = screen.queryAllByTestId('ai-scenario-html-frame')
      expect(frames.length).toBeGreaterThan(0)
      expect(frames[frames.length - 1]!.getAttribute('srcDoc')).toContain('Edited narrator line.')
    })
  })

  it('View reports missing bytes instead of showing broken images', async () => {
    // Bound to library defs with no retrievable bytes: Generate still works
    // (binding gate only), but the preview refuses to render broken images.
    const { value } = setupEngine(MD, {
      'young-doctor-smiling': 'def-doctor',
      'empty-classroom-chairs': 'def-chairs',
    })
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-scenario-generate'))
    expect(await screen.findByTestId('ai-scenario-html-state')).toHaveTextContent('ready')
    await user.click(screen.getByTestId('ai-scenario-view'))
    expect(await screen.findByTestId('ai-scenario-html-preview')).toBeInTheDocument()
    expect(await screen.findByTestId('ai-scenario-html-preview-error')).toHaveTextContent(
      'missing image bytes',
    )
    expect(screen.queryByTestId('ai-scenario-html-frame')).not.toBeInTheDocument()
  })

  it('Generate stays hard-blocked while any row is unbound', async () => {
    const { value } = setupEngine(MD, {})
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const generate = await screen.findByTestId('ai-scenario-generate')
    expect(generate).toBeDisabled()
    expect(generate).toHaveTextContent('2 unbound')
  })
})
