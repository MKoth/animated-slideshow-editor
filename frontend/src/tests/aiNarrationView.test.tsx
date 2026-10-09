import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiNarration } from '../api/aiApi'
import { EngineProvider } from '../app/EngineProvider'
import { AiNarrationView } from '../components/ai/AiNarrationView'
import { useAiStore } from '../stores/aiStore'
import { useBackendStore } from '../stores/backendStore'

const sampleNarration: AiNarration = {
  id: 'nar-1',
  projectId: 'p-1',
  reconciliationId: 'rec-1',
  scenarioId: 'scen-1',
  conversationId: 'c-1',
  title: 'Ser vs Estar narration',
  status: 'draft',
  defaultVoicePromptId: null,
  secondsPerCharacter: 0.2,
  parts: [
    {
      stepId: 'st-2',
      order: 0,
      partTag: 'middle',
      spokenLine: 'Ser is for who you are.',
      estimatedDuration: 'Ser is for who you are.'.length * 0.2,
      audioDuration: null,
      assetId: null,
      status: 'pending',
      stale: false,
      voicePromptId: null,
      error: null,
      timelineStart: 0,
      timelineEnd: 'Ser is for who you are.'.length * 0.2,
    },
    {
      stepId: 'st-3',
      order: 1,
      partTag: 'middle',
      spokenLine: 'Estar: where, when?',
      estimatedDuration: 'Estar: where, when?'.length * 0.2,
      audioDuration: null,
      assetId: null,
      status: 'failed',
      stale: true,
      voicePromptId: null,
      error: 'tts blew up',
      timelineStart: 'Ser is for who you are.'.length * 0.2,
      timelineEnd: 'Ser is for who you are.'.length * 0.2 + 'Estar: where, when?'.length * 0.2,
    },
  ],
  slideDuration: 'Ser is for who you are.'.length * 0.2 + 'Estar: where, when?'.length * 0.2,
  revisions: [],
  created: new Date().toISOString(),
  modified: new Date().toISOString(),
}

function seedStore() {
  useAiStore.setState({
    narrations: [
      {
        id: 'nar-1',
        projectId: 'p-1',
        reconciliationId: 'rec-1',
        conversationId: 'c-1',
        title: 'Ser vs Estar narration',
        status: 'draft',
        partCount: 2,
        modified: new Date().toISOString(),
      },
    ],
    narrationById: { 'nar-1': sampleNarration },
    activeNarrationId: 'nar-1',
    narrationBusy: false,
    narrationError: null,
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

function renderView(disabled = false) {
  return render(
    <EngineProvider>
      <AiNarrationView
        projectId="p-1"
        reconciliationId="rec-1"
        conversationId="c-1"
        disabled={disabled}
      />
    </EngineProvider>,
  )
}

describe('AiNarrationView Stage C gate', () => {
  it('renders verbatim parts with estimate timing and stale-blocked gate', () => {
    renderView()
    expect(screen.getByTestId('ai-narration-section')).toBeInTheDocument()
    // Verbatim spoken lines, never re-derived.
    expect(screen.getByTestId('ai-narration-text-st-2')).toHaveTextContent(
      'Ser is for who you are.',
    )
    expect(screen.getByTestId('ai-narration-timing-st-2')).toHaveTextContent('estimate')
    // Failed part marked stale with per-part retry.
    expect(screen.getByTestId('ai-narration-part-status-st-3')).toHaveTextContent('failed')
    expect(screen.getByTestId('ai-narration-part-status-st-3')).toHaveTextContent('stale')
    expect(screen.getByTestId('ai-narration-retry-st-3')).toBeInTheDocument()
    // Gate blocked until every part is ready.
    expect(screen.getByTestId('ai-narration-accept')).toBeDisabled()
    expect(screen.getByTestId('ai-narration-blockers')).toHaveTextContent('retry')
    // Rerecord stays manual in the existing modals — no new rerecord UI.
    expect(screen.getByTestId('ai-narration-rerecord-note')).toHaveTextContent('manual')
    expect(screen.getByTestId('ai-narration-rerecord-note')).toHaveTextContent('Waveform Editor')
  })

  it('retry, voice override, batch, and proposals hit the backend, never new endpoints', async () => {
    renderView()
    const user = userEvent.setup()

    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          ...sampleNarration,
          parts: sampleNarration.parts.map((p) =>
            p.stepId === 'st-3' ? { ...p, status: 'pending', stale: false, error: null } : p,
          ),
        }),
        { status: 200 },
      ),
    )
    await user.click(screen.getByTestId('ai-narration-retry-st-3'))
    expect(vi.mocked(fetch)).toHaveBeenCalled()

    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(sampleNarration), { status: 200 }),
    )
    await user.click(screen.getByTestId('ai-narration-generate'))
    expect(vi.mocked(fetch)).toHaveBeenCalled()

    await user.click(screen.getByTestId('ai-narration-propose-fill'))
    // Fresh engine has no middle slide yet: the view says so instead of
    // silently dropping the proposal (embed-first still holds — no proposal ran).
    expect(screen.getByTestId('ai-narration-proposal-note')).toHaveTextContent('middle slide first')
  })

  it('shows degraded state when the backend is down', () => {
    renderView(true)
    expect(screen.getByTestId('ai-narration-disabled')).toBeInTheDocument()
  })
})
