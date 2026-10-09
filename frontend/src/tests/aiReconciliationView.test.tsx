import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiReconciliationView } from '../components/ai/AiReconciliationView'
import { useAiStore } from '../stores/aiStore'
import { useBackendStore } from '../stores/backendStore'
import type { AiReconciliation } from '../api/aiApi'

const sampleReconciliation: AiReconciliation = {
  id: 'rec-1',
  projectId: 'p-1',
  scenarioId: 'scen-1',
  conversationId: 'c-1',
  title: 'Ser vs Estar reconciliation',
  status: 'draft',
  verdicts: [
    {
      stepId: 'st-1',
      order: 0,
      partTag: 'intro',
      skipped: true,
      reason: 'pregenerated intro/outro reference — left alone',
      assetVerdicts: [],
      motion: null,
      soundVerdicts: [],
    },
    {
      stepId: 'st-2',
      order: 1,
      partTag: 'middle',
      skipped: false,
      assetVerdicts: [
        {
          hint: 'blackboard',
          verdict: 'matched',
          candidates: [
            {
              definitionId: 'def-board',
              name: 'blackboard',
              score: 1.0,
              explanation: "exact name match 'blackboard'",
            },
          ],
          alternatives: [],
        },
        {
          hint: 'chalk text',
          verdict: 'missing',
          candidates: [],
          alternatives: [
            {
              definitionId: 'def-cat',
              name: 'cat',
              score: 0.1,
              explanation: 'no signal matched',
            },
          ],
        },
      ],
      motion: {
        state: 'needs-new-asset',
        explanation: "missing asset 'chalk text' — create artwork before motion can be staged",
        evidence: { kind: 'missing-asset', missingHints: ['chalk text'] },
      },
      soundVerdicts: [
        {
          hint: 'chime sound',
          verdict: 'missing',
          candidates: [],
          alternatives: [],
        },
      ],
    },
  ],
  briefs: [
    {
      id: 'brief-1',
      stepId: 'st-2',
      hint: 'chalk text',
      name: 'chalk text',
      note: 'Spoken: "Ser is for who you are." / On-screen: Chalk text appears',
      styleProfile: {
        name: 'Educational Illustration',
        description: 'Clear flat educational art',
        promptSuffix: 'flat educational illustration',
      },
      productionConstraints: 'Production constraints: centered, single object, no text.',
      providerNote: 'Provider-agnostic: use any general image generation tool.',
      variants: {
        detailed: 'Create a single chalk text for a lesson',
        concise: 'chalk text, Educational Illustration style',
        stylized: 'chalk text in Educational Illustration',
      },
      prompt: 'Create a single chalk text for a lesson',
      editable: true,
      wizardEntry: {
        assetName: 'chalk text',
        note: 'Spoken: "Ser is for who you are."',
        styleProfile: {
          name: 'Educational Illustration',
          description: 'Clear flat educational art',
          promptSuffix: 'flat educational illustration',
        },
        productionConstraints: 'Production constraints: centered, single object, no text.',
        providerNote: 'Provider-agnostic: use any general image generation tool.',
      },
    },
  ],
  decisions: {},
  revisions: [
    { id: 'rev-1', sourceRequest: 'reconcile scenario scen-1', created: new Date().toISOString() },
  ],
  middleStepCount: 1,
  missingCount: 1,
  created: new Date().toISOString(),
  modified: new Date().toISOString(),
}

function seedStore() {
  useAiStore.setState({
    reconciliations: [
      {
        id: 'rec-1',
        projectId: 'p-1',
        scenarioId: 'scen-1',
        conversationId: 'c-1',
        title: 'Ser vs Estar reconciliation',
        status: 'draft',
        middleStepCount: 1,
        modified: new Date().toISOString(),
      },
    ],
    reconciliationById: { 'rec-1': sampleReconciliation },
    activeReconciliationId: 'rec-1',
    reconciliationBusy: false,
    reconciliationError: null,
  })
  useBackendStore.setState({ status: 'available' })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
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
  })
  seedStore()
})

describe('AiReconciliationView Stage B gate', () => {
  it('renders middle-only verdicts with motion evidence, sound, and briefs', () => {
    render(
      <AiReconciliationView
        projectId="p-1"
        scenarioId="scen-1"
        conversationId="c-1"
        context={{}}
      />,
    )
    expect(screen.getByTestId('ai-reconciliation-section')).toBeInTheDocument()
    // Pregenerated intro left alone.
    expect(screen.getByTestId('ai-reconciliation-skipped-st-1')).toHaveTextContent('left alone')
    // Middle step motion verdict cites the gap.
    expect(screen.getByTestId('ai-reconciliation-motion-st-2')).toHaveTextContent('needs-new-asset')
    expect(screen.getByTestId('ai-reconciliation-motion-st-2')).toHaveTextContent('chalk text')
    // Asset verdicts at the Discovery floor with accept/reject/replace.
    expect(screen.getByTestId('ai-reconciliation-verdict-st-2-0')).toHaveTextContent('matched')
    expect(screen.getByTestId('ai-reconciliation-top-st-2-0')).toHaveTextContent('1.00')
    expect(screen.getByTestId('ai-reconciliation-verdict-st-2-1')).toHaveTextContent('missing')
    // Sound covers sfx/music only.
    expect(screen.getByTestId('ai-reconciliation-sound-st-2-chime sound')).toHaveTextContent(
      'Sound: chime sound',
    )
    // Brief feeds the wizard entry plus a copyable prompt.
    expect(screen.getByTestId('ai-reconciliation-brief-brief-1')).toBeInTheDocument()
    expect(screen.getByTestId('ai-reconciliation-brief-input-brief-1')).toHaveValue(
      'Create a single chalk text for a lesson',
    )
    expect(screen.getByTestId('ai-reconciliation-brief-wizard-brief-1')).toHaveTextContent(
      'Wizard entry: chalk text',
    )
    expect(screen.getByTestId('ai-reconciliation-brief-wizard-brief-1')).toHaveTextContent(
      'Educational Illustration',
    )
    // Gate blocks Stage C until accepted.
    expect(screen.getByTestId('ai-reconciliation-gate')).toHaveTextContent(
      'Stage C waits on the accepted version.',
    )
  })

  it('accept/reject cycle and brief edits hit the backend, never the engine', async () => {
    render(
      <AiReconciliationView
        projectId="p-1"
        scenarioId="scen-1"
        conversationId="c-1"
        context={{}}
      />,
    )
    const user = userEvent.setup()

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ...sampleReconciliation, status: 'accepted' }), {
        status: 200,
      }),
    )
    await user.click(screen.getByTestId('ai-reconciliation-accept'))
    expect(vi.mocked(fetch)).toHaveBeenCalled()

    const updated = {
      ...sampleReconciliation,
      briefs: [{ ...sampleReconciliation.briefs[0], prompt: 'My edited copyable prompt' }],
    }
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(updated), { status: 200 }))
    await user.clear(screen.getByTestId('ai-reconciliation-brief-input-brief-1'))
    await user.type(
      screen.getByTestId('ai-reconciliation-brief-input-brief-1'),
      'My edited copyable prompt',
    )
    await user.click(screen.getByTestId('ai-reconciliation-brief-save-brief-1'))
    expect(vi.mocked(fetch)).toHaveBeenCalled()
  })

  it('shows degraded state when the backend is down', () => {
    render(
      <AiReconciliationView
        projectId="p-1"
        scenarioId="scen-1"
        conversationId="c-1"
        context={{}}
        disabled
      />,
    )
    expect(screen.getByTestId('ai-reconciliation-disabled')).toBeInTheDocument()
  })
})
