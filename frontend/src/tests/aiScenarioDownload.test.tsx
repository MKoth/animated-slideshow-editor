import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
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

function toBase64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes))
}

function setupEngineWithEmbedded() {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  let section = createEmptyScenarioSection(MD)
  const v1 = createScenarioVersion(MD, 'Initial', [1, 2])
  section = appendScenarioVersion(section, v1)
  section = { ...section, currentMarkdown: MD }
  section = withScenarioBindings(section, {
    'young-doctor-smiling': 'emb-doctor',
    'empty-classroom-chairs': 'emb-chairs',
  })
  engine.project!.setScenario(section)
  // Embedded snapshots — the only byte source the zip shares with lesson download.
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
    definitions: [],
    allDefinitions: [],
    loaded: true,
    unavailable: false,
  })
})

describe('AiScenarioModal Download zip (issue #465)', () => {
  it('Download gated by the same bytes-required checklist as Generate', async () => {
    const raw = createEngineInternal()
    raw.createProject({ name: 'Demo' })
    raw.createSlide('Slide 1')
    let section = createEmptyScenarioSection(MD)
    const v1 = createScenarioVersion(MD, 'Initial', [1, 2])
    section = appendScenarioVersion(section, v1)
    section = { ...section, currentMarkdown: MD }
    section = withScenarioBindings(section, {})
    raw.project!.setScenario(section)
    const undoStack = new UndoStack()
    const dispatcher = new CommandDispatcher(raw, undoStack, () => undefined)
    const value: EngineContextValue = {
      engine: toReadOnly(raw),
      undoStack,
      dispatch: dispatcher.dispatch.bind(dispatcher) as unknown as EngineContextValue['dispatch'],
      persistence: { save: vi.fn(), onCommandSucceeded: () => undefined, dispose: () => undefined },
    }
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const download = await screen.findByTestId('ai-scenario-download')
    expect(download).toBeDisabled()
    expect(download).toHaveTextContent('Download .zip')
  })

  it('Download produces a self-contained zip with page, assets, fonts, and manifest', async () => {
    const { engine, value } = setupEngineWithEmbedded()
    // Mark HTML ready so the zip gate opens (same bytes-required gate as Generate).
    const section = engine.project!.scenario!
    const versionId = section.versions[0]!.id
    engine.project!.setScenario({
      ...section,
      lastHtml: '<html>render</html>',
      generatedFromVersionId: versionId,
    })

    const blobs: Blob[] = []
    const createdUrls: string[] = []
    const revokedUrls: string[] = []
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => {
        blobs.push(blob)
        const url = `blob:mock-${blobs.length}`
        createdUrls.push(url)
        return url
      }),
      revokeObjectURL: vi.fn((url: string) => {
        revokedUrls.push(url)
      }),
    })
    const clicks: string[] = []
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download)
    })

    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const user = userEvent.setup()
    const download = await screen.findByTestId('ai-scenario-download')
    expect(download).not.toBeDisabled()
    await user.click(download)

    await waitFor(() => expect(blobs.length).toBe(1))
    const buffer = await blobs[0]!.arrayBuffer()
    const out = unzipSync(new Uint8Array(buffer))
    const names = Object.keys(out)
    // Top-level page plus assets folder file per visual.
    expect(names).toContain('index.html')
    expect(names).toContain('assets/young-doctor-smiling.png')
    expect(names).toContain('assets/empty-classroom-chairs.png')
    // Embedded fonts plus license text.
    expect(names.some((n) => n === 'assets/fonts/OFL-LICENSE.txt')).toBe(true)
    expect(names.filter((n) => n.endsWith('.woff2')).length).toBeGreaterThanOrEqual(3)
    // Manifest port contract.
    expect(names).toContain('manifest.json')
    const manifest = JSON.parse(new TextDecoder().decode(out['manifest.json']!))
    expect(manifest.format).toBe('scenario-blackboard-pack/1')
    expect(typeof manifest.generator).toBe('string')
    expect(manifest.page).toBe('index.html')
    expect(manifest.visuals).toHaveLength(2)
    const byAsset = new Map(
      (manifest.visuals as Array<{ asset: string; file: string; mime: string }>).map((v) => [
        v.asset,
        v,
      ]),
    )
    expect(byAsset.get('young-doctor-smiling')!.file).toBe('assets/young-doctor-smiling.png')
    expect(byAsset.get('young-doctor-smiling')!.mime).toBe('image/png')
    // Page is the chalk render: sections in order, no remote URLs.
    const html = new TextDecoder().decode(out['index.html']!)
    expect(html).toContain('data-step="1"')
    expect(html).toContain('assets/young-doctor-smiling.png')
    expect(html).not.toContain('https://')
    expect(html.toLowerCase()).not.toContain('<script')
    // Separate builder from lesson download: zip filename, not .lesson.
    expect(clicks.length).toBe(1)
    expect(clicks[0]).toMatch(/-blackboard\.zip$/)
    expect(createdUrls.length).toBe(1)
    await waitFor(() => expect(revokedUrls).toEqual(createdUrls))
    // Image bytes round-trip from the embedded snapshots.
    expect([...out['assets/young-doctor-smiling.png']!]).toEqual([137, 80, 78, 71, 1, 2, 3])

    clickSpy.mockRestore()
    vi.unstubAllGlobals()
  })
})
