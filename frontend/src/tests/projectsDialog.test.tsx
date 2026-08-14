import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EngineProvider } from '../app/EngineProvider'
import { DocumentTitle } from '../components/editor/DocumentTitle'
import { MenuBar } from '../components/editor/MenuBar'
import { Toolbar } from '../components/editor/Toolbar'
import { ProjectsDialog } from '../components/projects/ProjectsDialog'
import { createEngine } from '../engine/internal'
import { serialize } from '../engine/lessonSerializer'
import { useNotificationStore } from '../stores/notificationStore'
import { usePersistenceStore } from '../stores/persistenceStore'
import { useProjectBrowserStore } from '../stores/projectBrowserStore'

function makeBlob(name: string): string {
  const engine = createEngine()
  engine.createProject({ name })
  engine.createSlide('Slide 1')
  if (!engine.project) {
    throw new Error('No project created')
  }
  return serialize(engine.project)
}

function makeLessonFile(name: string): File {
  return new File([makeBlob(name)], `${name}.lesson`, { type: 'application/json' })
}

function stubObjectURL(): {
  createObjectURL: ReturnType<typeof vi.fn>
  revokeObjectURL: ReturnType<typeof vi.fn>
} {
  const createObjectURL = vi.fn(() => 'blob:mock-lesson')
  const revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectURL,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: revokeObjectURL,
  })
  return { createObjectURL, revokeObjectURL }
}

const LIBRARY = [
  { id: 'p-1', name: 'Spanish Lesson', lastModified: '2026-08-14T10:00:00' },
  { id: 'p-2', name: 'Maths Lesson', lastModified: '2026-08-14T11:30:00' },
]

function stubBackend() {
  const calls: string[] = []
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${String(input)}`)
    if (String(input) === '/api/projects' && init?.method === 'POST') {
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'p-new', name: 'Untitled lesson', version: 1 }), {
          status: 200,
        }),
      )
    }
    if (String(input) === '/api/projects') {
      return Promise.resolve(new Response(JSON.stringify(LIBRARY), { status: 200 }))
    }
    if (String(input) === '/api/projects/p-1' && init?.method !== 'DELETE') {
      return Promise.resolve(new Response(makeBlob('Spanish Lesson'), { status: 200 }))
    }
    if (String(input) === '/api/projects/p-2' && init?.method !== 'DELETE') {
      return Promise.resolve(new Response(makeBlob('Maths Lesson'), { status: 200 }))
    }
    if (init?.method === 'DELETE') {
      return Promise.resolve(new Response(null, { status: 204 }))
    }
    return Promise.reject(new Error(`unexpected fetch: ${String(input)}`))
  })
  return calls
}

function renderHost() {
  return render(
    <EngineProvider>
      <DocumentTitle />
      <Toolbar />
      <MenuBar />
      <ProjectsDialog />
    </EngineProvider>,
  )
}

function dialog(): HTMLElement {
  const element = screen.getByRole('dialog', { name: 'Projects' })
  return element
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  document.title = 'AI Slideshow Editor'
  usePersistenceStore.setState({ dirty: false })
  useProjectBrowserStore.setState({
    visible: false,
    newProjectVisible: false,
    pendingOpen: null,
    pendingNew: false,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProjectsDialog', () => {
  it('opens from the toolbar Open button and lists the library by name and last modified', async () => {
    stubBackend()
    const user = userEvent.setup()
    renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))

    const panel = await within(dialog()).findByText('Spanish Lesson')
    expect(panel).toBeInTheDocument()
    expect(within(dialog()).getByText('Maths Lesson')).toBeInTheDocument()
    expect(within(dialog()).getByText('2026-08-14 10:00')).toBeInTheDocument()
    expect(within(dialog()).getByText('2026-08-14 11:30')).toBeInTheDocument()
  })

  it('renders the projects in the backend order (most recently modified first)', async () => {
    stubBackend()
    const user = userEvent.setup()
    renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Spanish Lesson')

    const list = within(dialog()).getByRole('list')
    const rows = within(list)
      .getAllByRole('listitem')
      .map((row) => row.textContent)
    expect(rows[0]).toContain('Spanish Lesson')
    expect(rows[1]).toContain('Maths Lesson')
  })

  it('opens from the File menu Open item', async () => {
    stubBackend()
    const user = userEvent.setup()
    renderHost()

    await user.click(within(screen.getByRole('banner')).getByRole('button', { name: 'File' }))
    await user.click(screen.getByRole('menuitem', { name: 'Open' }))

    await within(dialog()).findByText('Spanish Lesson')
  })

  it('opens a project through the openProject flow and closes the overlay', async () => {
    stubBackend()
    const user = userEvent.setup()
    renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Spanish Lesson')
    await user.click(within(dialog()).getByRole('button', { name: 'Open Spanish Lesson' }))

    expect(document.title).toBe('Spanish Lesson')
    expect(screen.queryByRole('dialog', { name: 'Projects' })).not.toBeInTheDocument()
  })

  it('confirms before opening when the current project is dirty, and Cancel keeps it', async () => {
    stubBackend()
    usePersistenceStore.setState({ dirty: true })
    const user = userEvent.setup()
    renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Spanish Lesson')
    await user.click(within(dialog()).getByRole('button', { name: 'Open Spanish Lesson' }))

    expect(
      screen.getByText(/Discard unsaved changes to the current project and open "Spanish Lesson"/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(document.title).toBe('AI Slideshow Editor')
    expect(within(dialog()).getByText('Spanish Lesson')).toBeInTheDocument()
  })

  it('opens the project after confirming the dirty discard', async () => {
    stubBackend()
    usePersistenceStore.setState({ dirty: true })
    const user = userEvent.setup()
    renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Spanish Lesson')
    await user.click(within(dialog()).getByRole('button', { name: 'Open Spanish Lesson' }))
    await user.click(screen.getByRole('button', { name: 'Discard & Open' }))

    expect(document.title).toBe('Spanish Lesson')
    expect(screen.queryByRole('dialog', { name: 'Projects' })).not.toBeInTheDocument()
  })

  it('deletes a project row and its backend record', async () => {
    const calls = stubBackend()
    const user = userEvent.setup()
    renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Maths Lesson')
    await user.click(within(dialog()).getByRole('button', { name: 'Delete Maths Lesson' }))

    expect(calls).toContain('DELETE /api/projects/p-2')
    expect(within(dialog()).queryByText('Maths Lesson')).not.toBeInTheDocument()
    expect(within(dialog()).getByText('Spanish Lesson')).toBeInTheDocument()
  })

  it('creates a new project from the dialog with the default name and saves it to the library', async () => {
    const calls = stubBackend()
    const user = userEvent.setup()
    renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Spanish Lesson')
    await user.click(within(dialog()).getByRole('button', { name: 'New Project' }))

    const nameInput = within(dialog()).getByRole('textbox', { name: 'Project name' })
    expect(nameInput).toHaveValue('Untitled lesson')
    await user.clear(nameInput)
    await user.type(nameInput, 'My New Lesson')
    await user.click(within(dialog()).getByRole('button', { name: 'Create Project' }))

    expect(document.title).toBe('My New Lesson')
    expect(screen.queryByRole('dialog', { name: 'Projects' })).not.toBeInTheDocument()
    await waitFor(() => expect(calls).toContain('POST /api/projects'))
  })

  it('confirms before showing the name dialog when dirty', async () => {
    stubBackend()
    usePersistenceStore.setState({ dirty: true })
    const user = userEvent.setup()
    renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Spanish Lesson')
    await user.click(within(dialog()).getByRole('button', { name: 'New Project' }))

    expect(
      screen.getByText(/Discard unsaved changes to the current project and create a new/),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Discard & Create' }))

    expect(within(dialog()).getByRole('textbox', { name: 'Project name' })).toHaveValue(
      'Untitled lesson',
    )
  })

  it('opens the name dialog directly from the toolbar New Project button when clean', async () => {
    stubBackend()
    const user = userEvent.setup()
    renderHost()

    await user.click(screen.getByRole('button', { name: 'New Project' }))

    expect(within(dialog()).getByRole('textbox', { name: 'Project name' })).toHaveValue(
      'Untitled lesson',
    )
  })

  it('closes the overlay with the Close button', async () => {
    stubBackend()
    const user = userEvent.setup()
    renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Spanish Lesson')
    await user.click(within(dialog()).getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog', { name: 'Projects' })).not.toBeInTheDocument()
  })

  it('opens the .lesson file picker from the Import .lesson button', async () => {
    stubBackend()
    const user = userEvent.setup()
    const { container } = renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Spanish Lesson')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(input, 'click')

    await user.click(within(dialog()).getByRole('button', { name: 'Import .lesson' }))

    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(input.accept).toBe('.lesson')
  })

  it('imports a valid .lesson file through the open flow and closes the overlay', async () => {
    stubBackend()
    const user = userEvent.setup()
    const { container } = renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Spanish Lesson')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = makeLessonFile('Imported Lesson')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)

    await waitFor(() => expect(document.title).toBe('Imported Lesson'))
    expect(screen.queryByRole('dialog', { name: 'Projects' })).not.toBeInTheDocument()
  })

  it('reports import validation errors and keeps the overlay open', async () => {
    stubBackend()
    const user = userEvent.setup()
    const { container } = renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Spanish Lesson')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const broken = new File(['{not json'], 'broken.lesson', { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [broken], configurable: true })
    fireEvent.change(input)

    await waitFor(() => {
      const messages = useNotificationStore.getState().notifications.map((n) => n.message)
      expect(messages.some((message) => message.includes('Invalid lesson JSON'))).toBe(true)
    })
    expect(document.title).toBe('AI Slideshow Editor')
    expect(within(dialog()).getByText('Spanish Lesson')).toBeInTheDocument()
  })

  it('confirms before importing when the current project is dirty, and Cancel keeps it', async () => {
    stubBackend()
    usePersistenceStore.setState({ dirty: true })
    const user = userEvent.setup()
    const { container } = renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Spanish Lesson')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = makeLessonFile('Imported Lesson')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)

    expect(
      screen.getByText(
        /Discard unsaved changes to the current project and import "Imported Lesson.lesson"/,
      ),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(document.title).toBe('AI Slideshow Editor')
    expect(within(dialog()).getByText('Spanish Lesson')).toBeInTheDocument()
  })

  it('imports the lesson after confirming the dirty discard', async () => {
    stubBackend()
    usePersistenceStore.setState({ dirty: true })
    const user = userEvent.setup()
    const { container } = renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Spanish Lesson')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = makeLessonFile('Imported Lesson')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)
    await user.click(screen.getByRole('button', { name: 'Discard & Import' }))

    await waitFor(() => expect(document.title).toBe('Imported Lesson'))
    expect(screen.queryByRole('dialog', { name: 'Projects' })).not.toBeInTheDocument()
  })

  it('downloads a .lesson copy of the open project with the backend unreachable', async () => {
    stubBackend()
    const { createObjectURL, revokeObjectURL } = stubObjectURL()
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const appendSpy = vi.spyOn(document.body, 'appendChild')
    const user = userEvent.setup()
    renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Spanish Lesson')
    await user.click(within(dialog()).getByRole('button', { name: 'Open Spanish Lesson' }))
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Spanish Lesson')

    vi.mocked(fetch).mockRejectedValue(new TypeError('connection refused'))
    await user.click(within(dialog()).getByRole('button', { name: 'Download .lesson copy' }))

    const anchor = appendSpy.mock.calls
      .map((call) => call[0])
      .find((node) => (node as HTMLElement).tagName === 'A') as HTMLAnchorElement
    expect(anchor.download).toBe('Spanish Lesson.lesson')
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-lesson')
    clickSpy.mockRestore()
  })

  it('disables download when no project is open', async () => {
    stubBackend()
    const user = userEvent.setup()
    renderHost()

    await user.click(screen.getByRole('button', { name: 'Open' }))
    await within(dialog()).findByText('Spanish Lesson')

    expect(within(dialog()).getByRole('button', { name: 'Download .lesson copy' })).toBeDisabled()
  })
})
