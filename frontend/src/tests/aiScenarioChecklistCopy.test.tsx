import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AiScenarioChecklist } from '../components/ai/AiScenarioChecklist'
import { EngineContext, type EngineContextValue } from '../app/engineContext'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { createEmptyScenarioSection } from '../engine/scenarioSection'
import { useAssetLibraryStore } from '../stores/assetLibraryStore'

const MD = [
  '## Step 1 — Test',
  '',
  '![Green tree](asset:green-tree)',
  '',
  '> Brief: A green tree.',
  '',
].join('\n')

function setupEngine(): EngineContextValue {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  engine.createSlide('Slide 1')
  engine.project!.setScenario(createEmptyScenarioSection(MD))
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  return {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: dispatcher.dispatch.bind(dispatcher) as unknown as EngineContextValue['dispatch'],
    persistence: { save: vi.fn(), onCommandSucceeded: () => undefined, dispose: () => undefined },
  }
}

function renderChecklist() {
  return render(
    <EngineContext.Provider value={setupEngine()}>
      <AiScenarioChecklist projectId="p-1" />
    </EngineContext.Provider>,
  )
}

beforeEach(() => {
  useAssetLibraryStore.setState({
    definitions: [],
    allDefinitions: [],
    loaded: true,
    unavailable: false,
  })
  vi.unstubAllGlobals()
})

describe('AiScenarioChecklist title and copy prompt', () => {
  it('shows the visual alt as row title and copies a self-contained prompt', async () => {
    // userEvent.setup() installs its own clipboard — stub after it.
    const user = userEvent.setup()
    const writeText = vi.fn(async (...args: unknown[]) => {
      void args
    })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    renderChecklist()
    expect(await screen.findByTestId('ai-scenario-checklist-row-green-tree')).toBeInTheDocument()
    expect(screen.getByTestId('ai-scenario-checklist-row-green-tree')).toHaveTextContent(
      'Green tree',
    )
    await user.click(screen.getByTestId('ai-scenario-checklist-copy-green-tree'))
    expect(writeText).toHaveBeenCalledTimes(1)
    const copied = String(writeText.mock.calls[0]![0])
    expect(copied).toContain('Green tree')
    expect(copied).toContain('A green tree.')
    expect(copied).toContain('sticker')
    expect(copied).toContain('dark background')
    expect(copied).not.toContain('asset:')
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('reports copy failure without throwing', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => {
      throw new Error('denied')
    })
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    renderChecklist()
    expect(await screen.findByTestId('ai-scenario-checklist-row-green-tree')).toBeInTheDocument()
    await user.click(screen.getByTestId('ai-scenario-checklist-copy-green-tree'))
    expect(await screen.findByText('Copy failed')).toBeInTheDocument()
  })
})
