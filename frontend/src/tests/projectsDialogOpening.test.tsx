import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectSummary } from '../api'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { ProjectsDialog } from '../components/projects/ProjectsDialog'
import { createEngine } from '../engine/internal'
import { serialize } from '../engine/lessonSerializer'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { useProjectBrowserStore } from '../stores/projectBrowserStore'
import { usePersistenceStore } from '../stores/persistenceStore'

const SUMMARY_1: ProjectSummary = {
  id: 'p-1',
  name: 'Spanish Lesson',
  lastModified: '2026-08-14T10:00:00',
}

function makeBlob(name: string): string {
  const engine = createEngine()
  engine.createProject({ name })
  engine.createSlide('Slide 1')
  if (!engine.project) {
    throw new Error('No project created')
  }
  return serialize(engine.project)
}

function renderDialog(): { engine: ReturnType<typeof createEngine> } {
  const engine = createEngine()
  engine.createProject({ name: 'Current' })
  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine,
    undoStack,
    dispatcher,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: {
      save: vi.fn(),
      onCommandSucceeded: () => undefined,
      dispose: () => undefined,
    },
  }
  render(
    <EngineContext.Provider value={value}>
      <ProjectsDialog />
    </EngineContext.Provider>,
  )
  return { engine }
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  useProjectBrowserStore.setState({
    visible: false,
    newProjectVisible: false,
    pendingOpen: null,
    pendingNew: false,
    pendingImport: null,
    projects: [],
    folders: [],
    selectedFolder: 'all',
    loading: false,
    error: null,
  })
  usePersistenceStore.setState({ dirty: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProjectsDialog opening loader', () => {
  it('shows a loader modal with progress while the project opens, then closes', async () => {
    let resolveBlob!: (blob: string) => void
    const blobReady = new Promise<string>((resolve) => {
      resolveBlob = resolve
    })
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/projects') {
        return Promise.resolve(new Response(JSON.stringify([SUMMARY_1]), { status: 200 }))
      }
      if (url === '/api/project-folders') {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      if (url === '/api/projects/p-1') {
        return blobReady.then((blob) => new Response(blob, { status: 200 }))
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })

    useProjectBrowserStore.getState().show()
    const { engine } = renderDialog()
    const user = userEvent.setup()

    const nameButton = await screen.findByRole('button', { name: 'Spanish Lesson' })
    await user.click(nameButton)

    // Loader modal replaces the list while the blob is in flight.
    const loader = await screen.findByRole('dialog', { name: 'Opening Spanish Lesson' })
    expect(within(loader).getByText('Downloading project data…')).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Projects list' })).toBeNull()

    resolveBlob(makeBlob('Spanish Lesson'))

    await waitFor(() => {
      expect(useProjectBrowserStore.getState().visible).toBe(false)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(engine.project?.name).toBe('Spanish Lesson')
  })

  it('returns to the list when opening fails', async () => {
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/projects') {
        return Promise.resolve(new Response(JSON.stringify([SUMMARY_1]), { status: 200 }))
      }
      if (url === '/api/project-folders') {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))
      }
      return Promise.resolve(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
    })

    useProjectBrowserStore.getState().show()
    renderDialog()
    const user = userEvent.setup()

    const nameButton = await screen.findByRole('button', { name: 'Spanish Lesson' })
    await user.click(nameButton)

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /Opening/ })).toBeNull()
    })
    // Browser stays open on failure so the user can retry.
    expect(useProjectBrowserStore.getState().visible).toBe(true)
    expect(await screen.findByRole('list', { name: 'Projects list' })).toBeTruthy()
  })
})
