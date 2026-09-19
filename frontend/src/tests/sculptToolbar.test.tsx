import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { SculptToolbar } from '../components/editor/SculptToolbar'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { createDefaultRectangleMesh } from '../engine/mesh'
import { useEditingModeStore } from '../stores/editingModeStore'
import { useMeshEditStore } from '../stores/meshEditStore'
import { noopPersistence } from './contextHarness'

function setup(initialShapeName?: string) {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  const slide = engine.createSlide('Slide 1')
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Mesh', {
    components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(100, 100) } },
  })
  const initialShape = initialShapeName ? engine.createShape(node.id, initialShapeName) : null

  useEditingModeStore.setState({ mode: 'meshEdit' })
  useMeshEditStore.setState({
    meshEditNodeId: node.id,
    meshEditTool: 'sculpt',
    activeShapeId: initialShape?.id ?? null,
  })

  const undoStack = new UndoStack()
  const dispatcher = new CommandDispatcher(engine, undoStack, () => undefined)
  const value: EngineContextValue = {
    engine: toReadOnly(engine),
    undoStack,
    dispatch: (command) => dispatcher.dispatch(command),
    persistence: noopPersistence,
  }
  render(
    <EngineContext.Provider value={value}>
      <SculptToolbar />
    </EngineContext.Provider>,
  )
  return { engine, node, initialShape }
}

beforeEach(() => {
  useEditingModeStore.setState({ mode: 'default' })
  useMeshEditStore.setState({
    meshEditNodeId: null,
    meshEditTool: 'select',
    activeShapeId: null,
  })
})

describe('SculptToolbar Add Shape button', () => {
  it('renders an Add Shape button next to the disabled shape dropdown when empty', () => {
    setup()

    expect(screen.getByLabelText('Shape')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add Shape' })).toBeEnabled()
  })

  it('creates a standard Shape and selects it when no Shape is selected', async () => {
    const user = userEvent.setup()
    const { engine, node } = setup()

    await user.click(screen.getByRole('button', { name: 'Add Shape' }))

    const shapes = engine.getShapes(node.id)
    expect(shapes.map((s) => s.name)).toEqual(['Shape'])
    expect(useMeshEditStore.getState().activeShapeId).toBe(shapes[0]!.id)
    expect((screen.getByLabelText('Shape') as HTMLSelectElement).value).toBe(shapes[0]!.id)
  })

  it('duplicates the selected Shape under a unique name and switches to it', async () => {
    const user = userEvent.setup()
    const { engine, node } = setup('Smile')

    await user.click(screen.getByRole('button', { name: 'Add Shape' }))

    const shapes = engine.getShapes(node.id)
    expect(shapes.map((s) => s.name)).toEqual(['Smile', 'Smile 2'])
    expect(useMeshEditStore.getState().activeShapeId).toBe(shapes[1]!.id)
    expect((screen.getByLabelText('Shape') as HTMLSelectElement).value).toBe(shapes[1]!.id)
  })

  it('duplicates the newly created Shape on a second click', async () => {
    const user = userEvent.setup()
    const { engine, node } = setup()

    const button = screen.getByRole('button', { name: 'Add Shape' })
    await user.click(button)
    await user.click(button)

    const shapes = engine.getShapes(node.id)
    expect(shapes.map((s) => s.name)).toEqual(['Shape', 'Shape 2'])
    expect(useMeshEditStore.getState().activeShapeId).toBe(shapes[1]!.id)
  })
})
