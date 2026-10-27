import { act } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { ScriptAiModal } from '../components/ai/ScriptAiModal'
import { useScriptAiStore } from '../stores/scriptAiStore'
import { useAiStore } from '../stores/aiStore'

vi.mock('../app/materialLibraries', () => ({
  ensureMaterialLibrariesLoaded: vi.fn(async () => undefined),
}))

const BROKEN_BLOCK = [
  '```engine-command',
  'script "Fix" from 0',
  'bind ghost = node("Nope")',
  'ghost.tween({ x: 1 }, 1)',
  '```',
].join('\n')

function renderModal(slideId: string) {
  const engine = createEngineInternal()
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, vi.fn())
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: { save: vi.fn(), onCommandSucceeded: () => undefined, dispose: () => undefined },
  }
  act(() => {
    engine.createProject({ name: 'Demo' })
    engine.createSlide('Slide 1')
  })
  const liveSlideId = engine.getActiveSlide()?.id ?? slideId
  render(
    <EngineContext.Provider value={value}>
      <ScriptAiModal
        projectId={engine.project?.id ?? 'p-1'}
        projectName="Demo"
        slideId={liveSlideId}
        slideName="Slide 1"
        draft={'script "Slide 1" from 0'}
        diagnostics={[]}
        onClose={() => undefined}
      />
    </EngineContext.Provider>,
  )
  return { projectId: engine.project?.id ?? 'p-1', slideId: liveSlideId }
}

beforeEach(() => {
  useScriptAiStore.setState({
    conversations: [],
    messagesById: {},
    activeIdBySlide: {},
    drafts: {},
    status: 'idle',
    streamingConversationId: null,
    streamingContent: '',
    lastError: null,
    aborter: null,
  })
  useAiStore.setState({ proposals: [], proposalBusy: false, proposalError: null })
  localStorage.clear()
})

describe('ScriptAiModal draft gate', () => {
  it('blocks a broken block with a one-click fix resubmit instead of drafting', async () => {
    const user = userEvent.setup()
    vi.stubGlobal('fetch', vi.fn())
    const convoId = 'convo-broken'
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const target = String(url)
      if (target.includes('/api/ai/chat')) return new Response(null, { status: 200 })
      if (target.includes('/messages')) {
        return new Response(
          JSON.stringify([
            {
              id: 'm-user',
              role: 'user',
              content: 'fix it',
              stopped: false,
              errorCode: null,
              created: new Date().toISOString(),
            },
            {
              id: 'm-assistant',
              role: 'assistant',
              content: `Here is the fix:\n\n${BROKEN_BLOCK}`,
              stopped: false,
              errorCode: null,
              created: new Date().toISOString(),
            },
          ]),
          { status: 200 },
        )
      }
      if (target.includes('/api/ai/conversations') && !(init as RequestInit)?.method) {
        // Behave like the backend list: echo a conversation for the requested slide.
        const params = new URL(target, 'http://localhost').searchParams
        return new Response(
          JSON.stringify([
            {
              id: convoId,
              projectId: params.get('projectId'),
              title: 'Script — Slide 1',
              mode: 'script',
              slideId: params.get('slideId'),
              modified: new Date().toISOString(),
            },
          ]),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify([]), { status: 200 })
    })

    renderModal('slide-1')

    await waitFor(() => {
      expect(screen.getByTestId(`script-ai-message-draft-script-m-assistant`)).toBeEnabled()
    })
    await user.click(screen.getByTestId('script-ai-message-draft-script-m-assistant'))

    await waitFor(() => {
      expect(screen.getByTestId('script-ai-message-fix-draft-m-assistant')).toBeInTheDocument()
    })
    // No proposal was created for the broken block (only the mount-time list load).
    expect(
      vi
        .mocked(fetch)
        .mock.calls.some(
          ([url, init]) =>
            String(url).includes('/api/ai/proposals') &&
            (init as RequestInit)?.method === 'POST',
        ),
    ).toBe(false)

    await user.click(screen.getByTestId('script-ai-message-fix-draft-m-assistant'))

    await waitFor(() => {
      const chatCall = vi
        .mocked(fetch)
        .mock.calls.find(([url]) => String(url).includes('/api/ai/chat'))
      expect(chatCall).toBeDefined()
    })
    const chatCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).includes('/api/ai/chat'))
    const chatBody = JSON.parse(String((chatCall?.[1] as RequestInit)?.body))
    expect(chatBody.message).toContain('failed validation')
  })
})
