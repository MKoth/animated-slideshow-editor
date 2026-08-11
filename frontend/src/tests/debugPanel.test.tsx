import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { EngineProvider } from '../app/EngineProvider'
import { DebugPanel } from '../components/debug/DebugPanel'

function renderPanel() {
  return render(
    <EngineProvider>
      <DebugPanel />
    </EngineProvider>,
  )
}

function tree() {
  return within(screen.getByLabelText('Project tree'))
}

function undoStack() {
  return within(screen.getByLabelText('Undo stack'))
}

describe('DebugPanel', () => {
  it('shows an empty project tree and empty undo stack initially', () => {
    renderPanel()

    expect(screen.getByText('No project. Create one to get started.')).toBeInTheDocument()
    expect(screen.getByText('No commands executed yet.')).toBeInTheDocument()
  })

  it('creates a project, slide, and node through the dev buttons', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.clear(screen.getByLabelText('Project name'))
    await user.type(screen.getByLabelText('Project name'), 'My Lesson')
    await user.click(screen.getByRole('button', { name: 'Create Project' }))

    expect(tree().getByText('My Lesson')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add Slide' }))
    await user.click(screen.getByRole('button', { name: 'Add Node' }))

    expect(tree().getByText('Slide 1')).toBeInTheDocument()
    expect(tree().getByText('Root')).toBeInTheDocument()
    expect(tree().getByText('Camera')).toBeInTheDocument()
    expect(tree().getByText('Node A')).toBeInTheDocument()
  })

  it('renders the camera inside the tree and never offers to delete root or camera', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Create Project' }))
    await user.click(screen.getByRole('button', { name: 'Add Slide' }))

    expect(tree().getByText('Camera')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete node Root' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete node Camera' })).not.toBeInTheDocument()
  })

  it('records the undo stack newest first as commands are dispatched', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Create Project' }))
    await user.click(screen.getByRole('button', { name: 'Add Slide' }))
    await user.click(screen.getByRole('button', { name: 'Add Node' }))

    const items = undoStack().getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveTextContent('CreateNode')
    expect(items[1]).toHaveTextContent('CreateSlide')
    expect(items[2]).toHaveTextContent('CreateProject')
  })

  it('deletes a slide and a node from the tree', async () => {
    const user = userEvent.setup()
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Create Project' }))
    await user.click(screen.getByRole('button', { name: 'Add Slide' }))
    await user.click(screen.getByRole('button', { name: 'Add Node' }))

    await user.click(screen.getByRole('button', { name: 'Delete node Node A' }))
    expect(tree().queryByText('Node A')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete slide Slide 1' }))
    expect(tree().queryByText('Slide 1')).not.toBeInTheDocument()
    expect(tree().getByText('Demo Project')).toBeInTheDocument()
    expect(screen.queryByText('No project. Create one to get started.')).not.toBeInTheDocument()
  })
})
