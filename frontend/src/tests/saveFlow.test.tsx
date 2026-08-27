import { useEffect } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SAVE_BACKEND_DOWN_MESSAGE } from '../app/persistence'
import { EngineProvider } from '../app/EngineProvider'
import { useEngine } from '../app/useEngine'
import { BackendStatus } from '../components/editor/BackendStatus'
import { DocumentTitle } from '../components/editor/DocumentTitle'
import { Toolbar } from '../components/editor/Toolbar'
import { Notifications } from '../components/notifications/Notifications'
import { CreateProjectCommand, CreateSlideCommand } from '../engine/commands'
import { registerSaveShortcut } from '../shortcuts/saveShortcuts'
import { useKeyboardShortcuts } from '../shortcuts/useKeyboardShortcuts'
import { useBackendStore } from '../stores/backendStore'
import { usePersistenceStore } from '../stores/persistenceStore'

function ShortcutHost() {
  const { dispatch, persistence } = useEngine()
  useKeyboardShortcuts()
  useEffect(() => {
    const disposeSave = registerSaveShortcut(() => ({ save: () => persistence.save() }))
    return disposeSave
  }, [persistence])
  return (
    <>
      <DocumentTitle />
      <BackendStatus />
      <Toolbar />
      <button onClick={() => dispatch(new CreateProjectCommand({ name: 'Demo' }))}>Create</button>
      <button onClick={() => dispatch(new CreateSlideCommand({ name: 'Slide 2' }))}>
        Add Slide
      </button>
      <Notifications />
    </>
  )
}

function renderEditor() {
  render(
    <EngineProvider>
      <ShortcutHost />
    </EngineProvider>,
  )
}

function stubBackend(): { posts: string[] } {
  const posts: string[] = []
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/health') {
      return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    }
    if (String(input) === '/api/projects') {
      posts.push(String(init?.body))
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'p-1', name: 'Demo' }), { status: 200 }),
      )
    }
    return Promise.reject(new Error(`unexpected fetch: ${String(input)}`))
  })
  return { posts }
}

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function awaitConnectedBackend(): Promise<void> {
  await screen.findByText('Backend connected')
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  document.title = 'AI Slideshow Editor'
  useBackendStore.setState({ status: 'checking' })
  usePersistenceStore.setState({ dirty: false })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('save flow', () => {
  it('saves with Ctrl+S, preventing the browser default, and clears the asterisk', async () => {
    const { posts } = stubBackend()
    renderEditor()
    await awaitConnectedBackend()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await flushAsync()
    expect(posts).toHaveLength(1)
    expect(document.title).toBe('Demo')

    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    const keydownResult = window.dispatchEvent(event)

    expect(keydownResult).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(posts).toHaveLength(2))
    for (const body of posts) {
      expect(JSON.parse(body)).toMatchObject({ version: 2, project: { name: 'Demo' } })
    }
  })

  it('saves from the toolbar Save button', async () => {
    const { posts } = stubBackend()
    renderEditor()
    await awaitConnectedBackend()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await flushAsync()
    expect(posts).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(posts).toHaveLength(2))
  })

  it('autosaves after a successful command, clearing the title asterisk', async () => {
    const { posts } = stubBackend()
    renderEditor()
    await awaitConnectedBackend()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(document.title).toBe('Demo*')
    await waitFor(() => expect(document.title).toBe('Demo'))
    expect(posts).toHaveLength(1)
  })

  it('marks the project dirty again for edits after a save', async () => {
    const { posts } = stubBackend()
    renderEditor()
    await awaitConnectedBackend()

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(document.title).toBe('Demo'))

    fireEvent.click(screen.getByRole('button', { name: 'Add Slide' }))
    expect(document.title).toBe('Demo*')
    await waitFor(() => expect(document.title).toBe('Demo'))
    expect(posts).toHaveLength(2)
  })

  it('does not autosave in degraded mode and surfaces the failure on manual save', async () => {
    const posts: string[] = []
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/projects') {
        posts.push(String(init?.body ?? ''))
      }
      return Promise.reject(new TypeError('connection refused'))
    })
    renderEditor()
    await screen.findByText('Backend unavailable')

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await flushAsync()

    expect(document.title).toBe('Demo*')
    expect(posts).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await flushAsync()

    expect(posts).toHaveLength(1)
    await waitFor(() => expect(screen.getByText(SAVE_BACKEND_DOWN_MESSAGE)).toBeInTheDocument())
    expect(document.title).toBe('Demo*')
  })
})

describe('backend status shared store', () => {
  it('marks the backend unavailable when the health check fails', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('connection refused'))
    act(() => useBackendStore.setState({ status: 'checking' }))
    renderEditor()

    await waitFor(() => expect(useBackendStore.getState().status).toBe('unavailable'))
    expect(await screen.findByText('Backend unavailable')).toBeInTheDocument()
  })
})
