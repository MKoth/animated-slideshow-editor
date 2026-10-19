import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiScenarioHistory } from '../components/ai/AiScenarioHistory'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { useAiStore } from '../stores/aiStore'
import type { ScenarioMarkdownVersion } from '../api/aiApi'

const v1: ScenarioMarkdownVersion = {
  id: 'v-1',
  projectId: 'p-1',
  conversationId: 'c-1',
  messageId: 'm-1',
  summary: 'First',
  touchedSteps: [1],
  timestamp: '2026-01-01T00:00:00Z',
  content: '## Step 1 -- One\n\nA.',
  baseVersionId: null,
}

const v2: ScenarioMarkdownVersion = {
  id: 'v-2',
  projectId: 'p-1',
  conversationId: 'c-1',
  messageId: 'm-2',
  summary: 'Second',
  touchedSteps: [1],
  timestamp: '2026-01-02T00:00:00Z',
  content: '## Step 1 -- One\n\nB.',
  baseVersionId: null,
}

function renderHistory() {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: dispatcher.dispatch.bind(dispatcher) as unknown as EngineContextValue['dispatch'],
    persistence: { save: vi.fn(), onCommandSucceeded: () => undefined, dispose: () => undefined },
  }
  render(
    <EngineContext.Provider value={value}>
      <AiScenarioHistory projectId="p-1" conversationId="c-1" />
    </EngineContext.Provider>,
  )
  return { engine, undoStack }
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string) => {
      if (
        typeof path === 'string' &&
        path.includes('/markdown/versions') &&
        !path.includes('/restore')
      ) {
        return new Response(JSON.stringify([v1, v2]), { status: 200 })
      }
      if (typeof path === 'string' && path.includes('/markdown/active')) {
        return new Response(
          JSON.stringify({ projectId: 'p-1', activeVersionId: 'v-2', version: v2 }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify([]), { status: 200 })
    }),
  )
  useAiStore.setState({
    markdownVersionsByProject: {},
    activeMarkdownVersionIdByProject: {},
    markdownBusy: false,
    markdownError: null,
  })
})

describe('AiScenarioHistory', () => {
  it('lists versions ordered with summaries, diff, and restore that never rewrites history', async () => {
    const { engine, undoStack } = renderHistory()
    expect(await screen.findByTestId('ai-scenario-version-v-1')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-version-summary-v-1')).toHaveTextContent('First')
    expect(screen.getByTestId('ai-scenario-history-count')).toHaveTextContent('2 version(s)')

    // Line-or-block diff: v2 changes B vs A.
    const diff = screen.getByTestId('ai-scenario-version-diff-v-2')
    expect(diff.textContent).toContain('B.')

    const beforeEntries = undoStack.entries.length
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...v1,
          id: 'v-3',
          summary: 'Restore v-1: First',
          timestamp: '2026-01-03T00:00:00Z',
        }),
        { status: 201 },
      ),
    )
    // Active refresh + message refresh after restore.
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))

    await userEvent.click(screen.getByTestId('ai-scenario-restore-v-1'))
    expect(await screen.findByTestId('ai-scenario-version-v-3')).toBeInTheDocument()
    // Restore copies forward: v-1 and v-2 still present, never rewritten.
    expect(screen.getByTestId('ai-scenario-version-v-1')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-version-v-2')).toBeInTheDocument()
    // No engine history entries from markdown restore; canvas undo untouched.
    expect(undoStack.entries.length).toBe(beforeEntries)
    expect(engine.project?.scenario?.currentMarkdown).toContain('A.')
  })

  it('survives chat trimming: versions load independently of messages', async () => {
    renderHistory()
    expect(await screen.findByTestId('ai-scenario-version-v-2')).toBeInTheDocument()
    // Messages endpoint returning empty (trimmed) does not clear versions.
    expect(screen.queryByTestId('ai-scenario-history-none')).not.toBeInTheDocument()
  })
})
