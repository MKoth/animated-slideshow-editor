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
  withScenarioAcceptedVersion,
  withScenarioHtml,
} from '../engine/scenarioSection'
import { useAiStore } from '../stores/aiStore'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'
import { useBackendStore } from '../stores/backendStore'
import { useScenarioScriptWorkflowStore } from '../stores/scenarioScriptWorkflowStore'

const TWO_STEP_DOC = [
  '# Ser and Estar',
  '',
  '## Step 1 — Who you are',
  '',
  '**Narrator:** Ser is for who you are.',
  '',
  '![Oak tree](asset:oak-tree)',
  '',
  '> Brief: A sturdy oak.',
  '',
  '[place: oak-tree]',
  '',
  '[reveal: text1]',
  '',
  'Ser is identity.',
  '',
  '## Step 2 — Where you are',
  '',
  '**Narrator:** Estar is for where you are.',
  '',
  '![Melting ice](asset:melting-ice)',
  '',
  '> Brief: Melting ice cube.',
  '',
  '[place: melting-ice]',
  '',
  '[reveal: text2]',
  '',
  'Estar is temporary.',
  '',
].join('\n')

const BLOCKED_DOC = [
  '# Lesson',
  '',
  '## Step 1 — One',
  '',
  '**Narrator:** Hi there.',
  '',
  '[place: ghost-tree]',
  '',
].join('\n')

function setupEngine(markdown: string, accepted: boolean) {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  let section = createEmptyScenarioSection(markdown)
  if (markdown) {
    const v1 = createScenarioVersion(markdown, 'Initial', [1, 2])
    section = appendScenarioVersion(section, v1)
    section = { ...section, currentMarkdown: markdown }
    if (accepted) section = withScenarioAcceptedVersion(section, v1.id)
  }
  section = withScenarioBindings(section, {})
  engine.project!.setScenario(section)
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatcher,
    dispatch: dispatcher.dispatch.bind(dispatcher) as unknown as EngineContextValue['dispatch'],
    persistence: { save: vi.fn(), onCommandSucceeded: () => undefined, dispose: () => undefined },
  }
  return { engine, value, undoStack, dispatcher }
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
    acceptedMarkdownVersionIdByProject: {},
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
  useScenarioScriptWorkflowStore.setState({ workflowsByProject: {} })
  useScenarioScriptWorkflowStore.persist.clearStorage()
})

describe('AiScenarioModal Generate Script (issue #471)', () => {
  it('defaults to the latest version when nothing is accepted yet', async () => {
    const { value } = setupEngine(TWO_STEP_DOC, false)
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const generate = await screen.findByTestId('ai-scenario-generate-script')
    expect(generate).not.toBeDisabled()
    expect(generate).toHaveAttribute('title', expect.stringContaining('latest version (default'))
    expect(await screen.findByTestId('ai-scenario-script-default-hint')).toHaveTextContent(
      /Using latest version.*as default/i,
    )
    // The hint offers a way to the History tab where a different version can be pinned.
    const user = userEvent.setup()
    await user.click(screen.getByTestId('ai-scenario-script-open-history'))
    expect(useAiStore.getState().scenarioTab).toBe('history')

    // Generate works off the implicit latest snapshot with no explicit accept.
    await user.click(generate)
    const preview = await screen.findByTestId('ai-scenario-script-preview')
    expect(preview).toHaveTextContent(/2 slide\(s\)/)
    expect(screen.getByTestId('ai-scenario-script-apply-prompter')).not.toBeDisabled()
  })

  it('opens the Script tab on Generate and highlights board source; closing returns to Doc', async () => {
    const { value } = setupEngine(TWO_STEP_DOC, true)
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const user = userEvent.setup()
    // Script tab idles disabled until a draft exists.
    expect(await screen.findByTestId('ai-scenario-modal-tab-script')).toBeDisabled()
    expect(screen.queryByTestId('ai-scenario-script-preview')).not.toBeInTheDocument()

    await user.click(await screen.findByTestId('ai-scenario-generate-script'))
    await screen.findByTestId('ai-scenario-script-preview')
    expect(useAiStore.getState().scenarioTab).toBe('script')
    expect(screen.getByTestId('ai-scenario-modal-tab-script')).toBeDisabled()
    expect(await screen.findByTestId('ai-scenario-modal-script-body')).toBeInTheDocument()

    // Board source renders highlighted tokens, not plain text.
    const source = screen.getByTestId('ai-scenario-script-slide-source-1')
    expect(source.innerHTML).toContain('anim-token')
    expect(source.innerHTML).toContain('anim-keyword')
    expect(source.innerHTML).toContain('anim-string')

    await user.click(screen.getByTestId('ai-scenario-script-preview-close'))
    await waitFor(() => {
      expect(screen.queryByTestId('ai-scenario-script-preview')).not.toBeInTheDocument()
    })
    expect(useAiStore.getState().scenarioTab).toBe('doc')
    // Closing keeps the persisted draft: the Script tab stays available and
    // reopening it shows the same preview without re-generating.
    expect(screen.getByTestId('ai-scenario-modal-tab-script')).not.toBeDisabled()
    await user.click(screen.getByTestId('ai-scenario-modal-tab-script'))
    await screen.findByTestId('ai-scenario-script-preview')
  })

  it('highlights keywords, strings, numbers, properties, and comments', async () => {
    const { highlightAnimationScript } = await import('../components/panels/AnimationScriptViewer')
    const html = highlightAnimationScript('// comment\nscript "Hi" from 0\nreveal(a, over: 2)')
    expect(html).toContain('anim-comment')
    expect(html).toContain('anim-keyword')
    expect(html).toContain('anim-string')
    expect(html).toContain('anim-number')
    expect(html).toContain('anim-function')
    expect(html).toContain('anim-property')
  })

  it('colors each prompt block distinctly across prompter, title, and fractions', async () => {
    const { promptBlockColor } = await import('../components/ai/AiScenarioScriptPanel')
    expect(promptBlockColor('prompt-1')).not.toBe(promptBlockColor('prompt-2'))
    expect(promptBlockColor('prompt-1-1')).not.toBe(promptBlockColor('prompt-1-2'))
    const { value } = setupEngine(TWO_STEP_DOC, true)
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-scenario-generate-script'))
    await screen.findByTestId('ai-scenario-script-preview')

    const chip1 = screen.getByTestId('ai-scenario-script-slide-block-1')
    const chip2 = screen.getByTestId('ai-scenario-script-slide-block-2')
    expect(chip1).toHaveAttribute('data-block', 'prompt-1')
    expect(chip2).toHaveAttribute('data-block', 'prompt-2')
    expect(chip1.style.background).not.toBe(chip2.style.background)

    // Split parts render as sub-blocks (`prompt-1-1`) with distinct colors.
    const part1 = screen.getByTestId('ai-scenario-script-slide-prompter-1-1')
    expect(part1).toHaveAttribute('data-block', 'prompt-1-1')
    expect(part1.style.borderLeft).toContain('solid')
    const fractions1 = screen.getByTestId('ai-scenario-script-slide-fractions-1')
    const row = fractions1.querySelector('[data-block="prompt-1-1"]')
    expect(row).not.toBeNull()
  })

  it('refuses without any versions and asks to iterate first', async () => {
    const { value } = setupEngine('', false)
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const generate = await screen.findByTestId('ai-scenario-generate-script')
    expect(generate).toBeDisabled()
    expect(generate).toHaveAttribute('title', expect.stringContaining('No versions yet'))
    expect(await screen.findByTestId('ai-scenario-script-accept-hint')).toHaveTextContent(
      /No versions yet/i,
    )
  })

  it('previews per-slide durations, sources, fractions, and diagnostics from the accepted snapshot', async () => {
    const { value } = setupEngine(TWO_STEP_DOC, true)
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const user = userEvent.setup()
    const generate = await screen.findByTestId('ai-scenario-generate-script')
    expect(generate).not.toBeDisabled()
    await user.click(generate)

    const preview = await screen.findByTestId('ai-scenario-script-preview')
    expect(preview).toHaveTextContent(/2 slide\(s\)/)
    // Per-slide durations.
    expect(screen.getByTestId('ai-scenario-script-slide-1')).toHaveTextContent(
      /Step 1 — Who you are/,
    )
    expect(screen.getByTestId('ai-scenario-script-slide-2')).toHaveTextContent(
      /Step 2 — Where you are/,
    )
    // Board sources before anything is written.
    expect(screen.getByTestId('ai-scenario-script-slide-source-1')).toHaveTextContent(
      /script "Step 1 — Who you are"/,
    )
    expect(screen.getByTestId('ai-scenario-script-slide-source-2')).toHaveTextContent(
      /script "Step 2 — Where you are"/,
    )
    // Block fractions on the owning prompt block.
    expect(screen.getByTestId('ai-scenario-script-slide-fractions-1')).toHaveTextContent(/prompt-1/)
    expect(screen.getByTestId('ai-scenario-script-slide-fractions-2')).toHaveTextContent(/prompt-2/)
    // Warnings-only draft (short voice, fixture-paced board pads the slide):
    // overflow-padded diagnostics show, but Apply stays enabled.
    expect(screen.getByTestId('ai-scenario-script-diagnostics')).toHaveTextContent(
      /overflow-padded/,
    )
    expect(screen.getByTestId('ai-scenario-script-apply-prompter')).not.toBeDisabled()
  })

  it('blocks apply on hard errors and keeps the preview reviewable', async () => {
    const { value } = setupEngine(BLOCKED_DOC, true)
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-scenario-generate-script'))
    await screen.findByTestId('ai-scenario-script-preview')
    expect(screen.getByTestId('ai-scenario-script-diagnostics')).toHaveTextContent(/ghost-tree/)
    expect(screen.getByTestId('ai-scenario-script-apply-prompter')).toBeDisabled()
    expect(await screen.findByTestId('ai-scenario-script-blocked-hint')).toBeInTheDocument()
  })

  it('applies prompter text (step 1) then per-step board scripts; re-runs converge', async () => {
    const { engine, value, undoStack } = setupEngine(TWO_STEP_DOC, true)
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-scenario-generate-script'))
    await screen.findByTestId('ai-scenario-script-preview')

    // No per-step buttons before Step 1.
    expect(screen.queryByTestId('ai-scenario-script-steps')).not.toBeInTheDocument()

    const before = undoStack.entries.length
    await user.click(screen.getByTestId('ai-scenario-script-apply-prompter'))

    // Step 1 keeps the preview open and unlocks per-step buttons.
    await screen.findByTestId('ai-scenario-script-prompter-done')
    expect(screen.getByTestId('ai-scenario-script-preview')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-script-step-1')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-script-generate-tts-1')).not.toBeDisabled()
    expect(screen.getByTestId('ai-scenario-script-apply-board-1')).not.toBeDisabled()
    expect(screen.getByTestId('ai-scenario-script-generate-tts-2')).not.toBeDisabled()
    expect(screen.getByTestId('ai-scenario-script-apply-board-2')).not.toBeDisabled()
    // One Transaction entry for Step 1.
    expect(undoStack.entries.length).toBe(before + 1)
    expect(undoStack.entries[0]!.type).toBe('Transaction')

    // Slides converged, prompter written, board untouched.
    const afterPrompter = engine.project!.slides
    expect(afterPrompter).toHaveLength(2)
    expect(afterPrompter[0]!.name).toBe('Step 1 — Who you are')
    expect(afterPrompter[1]!.name).toBe('Step 2 — Where you are')
    for (const slide of afterPrompter) {
      expect(slide.prompter?.parts.length).toBeGreaterThan(0)
      expect(slide.animationScript).toBeNull()
    }
    // Delimiters stripped like manual paste.
    expect(afterPrompter[0]!.prompter!.parts[0]!.text).toBe('Ser is for who you are')

    // Board step 1 only: step 1 done, step 2 untouched, preview stays open.
    await user.click(screen.getByTestId('ai-scenario-script-apply-board-1'))
    expect(await screen.findByTestId('ai-scenario-script-board-done-1')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-scenario-script-board-done-2')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-script-preview')).toBeInTheDocument()
    // Completed buttons flip to Re-apply/Regenerate labels.
    expect(screen.getByTestId('ai-scenario-script-apply-board-1')).toHaveTextContent(/Re-apply/)
    expect(screen.getByTestId('ai-scenario-script-generate-tts-1')).toHaveTextContent(
      /Generate TTS — Step 1/,
    )
    expect(undoStack.entries.length).toBe(before + 2)

    const slides = engine.project!.slides
    expect(slides[0]!.animationScript?.source).toContain(`script "${slides[0]!.name}"`)
    expect(slides[0]!.animationScript?.source).toMatch(/at: markTime\("part-\d+"\)/)
    expect(slides[1]!.animationScript).toBeNull()

    // Board step 2 completes the draft.
    await user.click(screen.getByTestId('ai-scenario-script-apply-board-2'))
    expect(await screen.findByTestId('ai-scenario-script-board-done-2')).toBeInTheDocument()
    expect(undoStack.entries.length).toBe(before + 3)
    for (const slide of engine.project!.slides) {
      for (const part of slide.prompter!.parts) {
        expect(part.audioClipId).toBeUndefined()
        expect(part.audioAssetId).toBeUndefined()
      }
      const partsSum = slide.prompter!.parts.reduce((sum, p) => sum + p.duration, 0)
      expect(slide.duration).toBeGreaterThanOrEqual(partsSum - 1e-9)
      expect(slide.animationScript?.source).toContain(`script "${slide.name}"`)
    }

    // Undo restores step by step: last board apply, then first, then Step 1.
    undoStack.undo(engine)
    expect(engine.project!.slides[1]!.animationScript).toBeNull()
    expect(engine.project!.slides[0]!.animationScript).not.toBeNull()
    undoStack.undo(engine)
    for (const slide of engine.project!.slides) {
      expect(slide.animationScript).toBeNull()
    }
    undoStack.undo(engine)
    expect(engine.project!.slides).toHaveLength(1)
    expect(engine.project!.slides[0]!.name).toBe('Slide 1')
    expect(undoStack.entries.length).toBe(before)

    // Re-run converges without duplicates.
    await user.click(await screen.findByTestId('ai-scenario-generate-script'))
    await screen.findByTestId('ai-scenario-script-preview')
    await user.click(screen.getByTestId('ai-scenario-script-apply-prompter'))
    await screen.findByTestId('ai-scenario-script-prompter-done')
    await user.click(screen.getByTestId('ai-scenario-script-apply-board-1'))
    await screen.findByTestId('ai-scenario-script-board-done-1')
    await user.click(screen.getByTestId('ai-scenario-script-apply-board-2'))
    await screen.findByTestId('ai-scenario-script-board-done-2')
    expect(engine.project!.slides).toHaveLength(2)
    // Applied on top of the restored single slide: one rename + one create.
    expect(engine.project!.slides.map((s) => s.name)).toEqual([
      'Step 1 — Who you are',
      'Step 2 — Where you are',
    ])
  })

  it('keeps the draft and per-step states across modal close and reopen', async () => {
    const { engine, value } = setupEngine(TWO_STEP_DOC, true)
    const view = render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-scenario-generate-script'))
    await screen.findByTestId('ai-scenario-script-preview')
    await user.click(screen.getByTestId('ai-scenario-script-apply-prompter'))
    await screen.findByTestId('ai-scenario-script-prompter-done')
    await user.click(screen.getByTestId('ai-scenario-script-apply-board-1'))
    await screen.findByTestId('ai-scenario-script-board-done-1')

    // Closing keeps the workflow: reopening offers Regenerate, not Generate.
    await user.click(screen.getByTestId('ai-scenario-script-preview-close'))
    await waitFor(() => {
      expect(screen.queryByTestId('ai-scenario-script-preview')).not.toBeInTheDocument()
    })
    expect(useScenarioScriptWorkflowStore.getState().workflowsByProject['p-1']).toBeDefined()

    view.unmount()
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    // No re-generate needed: the draft is still there with step states kept.
    expect(await screen.findByTestId('ai-scenario-generate-script')).toHaveTextContent(
      /Regenerate Script/,
    )
    await user.click(screen.getByTestId('ai-scenario-modal-tab-script'))
    await screen.findByTestId('ai-scenario-script-preview')
    expect(screen.getByTestId('ai-scenario-script-apply-prompter')).toHaveTextContent(
      /Re-apply prompter text/,
    )
    expect(await screen.findByTestId('ai-scenario-script-board-done-1')).toBeInTheDocument()
    expect(screen.queryByTestId('ai-scenario-script-board-done-2')).not.toBeInTheDocument()
    // Live slides still carry step-1 work from before the reopen.
    expect(engine.project!.slides).toHaveLength(2)
    expect(engine.project!.slides[0]!.animationScript).not.toBeNull()
    expect(engine.project!.slides[1]!.animationScript).toBeNull()
  })

  it('sends Spanish for carved-out foreign blocks, English for the rest (per-step TTS)', async () => {
    const doc = [
      '# Ser and Estar',
      '',
      '## Step 1 — Who you are',
      '',
      '**Narrator:** Ser is for who you are.',
      '',
      '![Oak tree](asset:oak-tree)',
      '',
      '> Brief: A sturdy oak.',
      '',
      '[place: oak-tree]',
      '',
      '[reveal: text1]',
      '',
      'Ser is identity.',
      '',
    ].join('\n')
    const { engine, value, undoStack } = setupEngine(doc, true)
    // Chalk HTML highlights the foreign word, so the planner carves `Ser`
    // out as its own prompt block.
    const section = engine.project!.scenario!
    engine.project!.setScenario(
      withScenarioHtml(
        section,
        '<section data-step="1"><p><strong class="foreign">Ser</strong> is for who you are.</p></section>',
        section.generatedFromVersionId ?? null,
        section.foreignWords,
      ),
    )
    const ttsBodies: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init?: { body?: unknown }) => {
        const path = String(url)
        if (path.includes('/api/tts/models')) {
          return new Response(
            JSON.stringify({
              models: ['m1'],
              providers: ['auto'],
              defaultModel: 'm1',
              defaultProvider: 'auto',
            }),
            { status: 200 },
          )
        }
        if (path.includes('/api/tts/generate')) {
          ttsBodies.push(String((init?.body as string) ?? ''))
          return new Response(new Uint8Array([82, 73, 70, 70]), { status: 200 })
        }
        return new Response(JSON.stringify([]), { status: 200 })
      }),
    )
    render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-scenario-generate-script'))
    await screen.findByTestId('ai-scenario-script-preview')
    await user.click(screen.getByTestId('ai-scenario-script-apply-prompter'))
    await screen.findByTestId('ai-scenario-script-prompter-done')

    const before = undoStack.entries.length
    await user.click(screen.getByTestId('ai-scenario-script-generate-tts-1'))
    expect(await screen.findByTestId('ai-scenario-script-tts-done-1')).toBeInTheDocument()
    expect(undoStack.entries.length).toBe(before + 1)

    // Two blocks, one request each: the carved-out `Ser` in Spanish,
    // the sentence in English — never auto-detect.
    expect(ttsBodies).toHaveLength(2)
    const languages = ttsBodies.map((body) => (JSON.parse(body) as { language?: string }).language)
    expect(languages).toEqual(['es', 'en'])
    const slide = engine.project!.slides[0]!
    expect(slide.prompter!.parts).toHaveLength(2)
    for (const part of slide.prompter!.parts) {
      expect(part.audioClipId).toBeDefined()
    }
  })

  it('blocks apply when the accepted snapshot changes after Generate', async () => {
    const { value } = setupEngine(TWO_STEP_DOC, true)
    const view = render(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    const user = userEvent.setup()
    await user.click(await screen.findByTestId('ai-scenario-generate-script'))
    await screen.findByTestId('ai-scenario-script-preview')
    expect(screen.getByTestId('ai-scenario-script-apply-prompter')).not.toBeDisabled()

    // Accepting a newer version supersedes the preview basis.
    useAiStore.setState((state) => ({
      acceptedMarkdownVersionIdByProject: {
        ...state.acceptedMarkdownVersionIdByProject,
        'p-1': 'v-other',
      },
    }))
    view.rerender(
      <EngineContext.Provider value={value}>
        <AiScenarioModal projectId="p-1" conversationId="c-1" />
      </EngineContext.Provider>,
    )
    expect(await screen.findByTestId('ai-scenario-script-preview-summary')).toHaveTextContent(
      /stale/,
    )
    expect(screen.getByTestId('ai-scenario-script-apply-prompter')).toBeDisabled()
  })
})
