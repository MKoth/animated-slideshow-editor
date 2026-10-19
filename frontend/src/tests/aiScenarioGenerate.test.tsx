import { render, screen } from '@testing-library/react'
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
  it('manual Generate renders deterministic chalk HTML and View reports ready', async () => {
    const { engine, value } = setupEngine(MD, {
      'young-doctor-smiling': 'def-doctor',
      'empty-classroom-chairs': 'def-chairs',
    })
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
    // Images reference the assets folder with alt preserved.
    expect(stored).toContain('src="assets/young-doctor-smiling.png"')
    expect(stored).toContain('alt="Young doctor smiling"')
    // Briefs and reuse names stay internal.
    expect(stored).not.toContain('Warm portrait')
    expect(stored).not.toContain('Classroom Chairs')
    // Mandatory theme tokens, no scripts or remote fetches.
    expect(stored).toContain('--board: #20302A')
    expect(stored).toContain('Cabin Sketch')
    expect(stored.toLowerCase()).not.toContain('<script')
    expect(stored).not.toContain('https://')

    // View lifecycle: empty → ready, View opens the stored render.
    expect(await screen.findByTestId('ai-scenario-html-state')).toHaveTextContent('ready')
    await user.click(screen.getByTestId('ai-scenario-view'))
    expect(await screen.findByTestId('ai-scenario-html-preview')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-html-frame')).toHaveAttribute('srcDoc', stored)
  })

  it('doc edits after generation mark stale while View still opens the old render', async () => {
    const { engine, value } = setupEngine(MD, {
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
    const firstHtml = engine.project!.scenario!.lastHtml ?? ''
    expect(firstHtml).toContain('data-step="1"')

    // Edit via the checklist brief input (unversioned doc mutation).
    const briefInput = screen.getByTestId(
      'ai-scenario-checklist-brief-input-young-doctor-smiling',
    ) as HTMLInputElement
    await user.clear(briefInput)
    await user.type(briefInput, 'Edited after generation.')
    await user.click(screen.getByTestId('ai-scenario-checklist-save-brief-young-doctor-smiling'))

    expect(await screen.findByTestId('ai-scenario-stale-hint')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-html-state')).toHaveTextContent('stale')
    // View stays enabled and still opens the old render.
    const view = screen.getByTestId('ai-scenario-view')
    expect(view).not.toBeDisabled()
    await user.click(view)
    const frame = await screen.findByTestId('ai-scenario-html-frame')
    expect(frame).toHaveAttribute('srcDoc', firstHtml)

    // Re-generation is allowed and returns to ready.
    await user.click(screen.getByTestId('ai-scenario-generate'))
    expect(await screen.findByTestId('ai-scenario-html-state')).toHaveTextContent('ready')
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
