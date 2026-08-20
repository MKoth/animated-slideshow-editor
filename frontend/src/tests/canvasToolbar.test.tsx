import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, beforeEach } from 'vitest'
import { CanvasToolbar } from '../components/editor/CanvasToolbar'
import { useEditingModeStore } from '../stores/editingModeStore'
import { useMeshEditStore } from '../stores/meshEditStore'

describe('CanvasToolbar', () => {
  beforeEach(() => {
    useEditingModeStore.setState({ mode: 'default', selectedNodeId: null })
    useMeshEditStore.setState({
      meshEditNodeId: null,
      meshEditTool: 'select',
      selectMode: 'vertex',
      mirrorAxis: 'x',
      selectedVertexIndices: [],
      selectedEdgeIndices: [],
      selectedFaceIndices: [],
      weightPaintTool: 'paint',
      selectedBoneId: null,
      brushRadius: 0.5,
      brushStrength: 1.0,
      heatmapVisible: true,
    })
  })

  it('renders all rigging buttons', () => {
    render(<CanvasToolbar />)

    expect(screen.getByRole('button', { name: 'Create Bone' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create IK Target' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Pole Vector' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enter Mesh Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enter Weight Paint' })).toBeInTheDocument()
  })

  it('shows mode indicator', () => {
    render(<CanvasToolbar />)

    expect(screen.getByText('Mode:')).toBeInTheDocument()
    expect(screen.getByText('Default')).toBeInTheDocument()
  })

  it('enters bone creation mode when Create Bone is clicked', async () => {
    const user = userEvent.setup()
    render(<CanvasToolbar />)

    await user.click(screen.getByRole('button', { name: 'Create Bone' }))

    expect(useEditingModeStore.getState().mode).toBe('boneCreation')
    expect(screen.getByText('Bone Creation')).toBeInTheDocument()
  })

  it('exits bone creation mode when Create Bone is clicked again', async () => {
    const user = userEvent.setup()
    render(<CanvasToolbar />)

    await user.click(screen.getByRole('button', { name: 'Create Bone' }))
    expect(useEditingModeStore.getState().mode).toBe('boneCreation')

    await user.click(screen.getByRole('button', { name: 'Create Bone' }))
    expect(useEditingModeStore.getState().mode).toBe('default')
  })

  it('enters IK target mode when Create IK Target is clicked', async () => {
    const user = userEvent.setup()
    render(<CanvasToolbar />)

    await user.click(screen.getByRole('button', { name: 'Create IK Target' }))

    expect(useEditingModeStore.getState().mode).toBe('ikTarget')
    expect(screen.getByText('IK Target Placement')).toBeInTheDocument()
  })

  it('enters pole vector mode when Create Pole Vector is clicked', async () => {
    const user = userEvent.setup()
    render(<CanvasToolbar />)

    await user.click(screen.getByRole('button', { name: 'Create Pole Vector' }))

    expect(useEditingModeStore.getState().mode).toBe('poleVector')
    expect(screen.getByText('Pole Vector Placement')).toBeInTheDocument()
  })

  it('enters mesh edit mode when Enter Mesh Edit is clicked', async () => {
    const user = userEvent.setup()
    render(<CanvasToolbar />)

    await user.click(screen.getByRole('button', { name: 'Enter Mesh Edit' }))

    expect(useEditingModeStore.getState().mode).toBe('meshEdit')
    expect(screen.getByText('Mesh Edit')).toBeInTheDocument()
  })

  it('enters weight paint mode when Enter Weight Paint is clicked', async () => {
    const user = userEvent.setup()
    render(<CanvasToolbar />)

    await user.click(screen.getByRole('button', { name: 'Enter Weight Paint' }))

    expect(useEditingModeStore.getState().mode).toBe('weightPaint')
    expect(screen.getByText('Weight Paint')).toBeInTheDocument()
  })

  it('switches between modes', async () => {
    const user = userEvent.setup()
    render(<CanvasToolbar />)

    await user.click(screen.getByRole('button', { name: 'Create Bone' }))
    expect(useEditingModeStore.getState().mode).toBe('boneCreation')

    await user.click(screen.getByRole('button', { name: 'Create IK Target' }))
    expect(useEditingModeStore.getState().mode).toBe('ikTarget')

    await user.click(screen.getByRole('button', { name: 'Create Pole Vector' }))
    expect(useEditingModeStore.getState().mode).toBe('poleVector')
  })
})
