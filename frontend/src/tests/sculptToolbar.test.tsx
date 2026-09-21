import { render, screen, within } from '@testing-library/react'
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
import { useShapePreviewStore } from '../stores/shapePreviewStore'
import { noopPersistence } from './contextHarness'

function setup(
  initialShapeName?: string,
  prepare?: (engine: ReturnType<typeof createEngineInternal>, nodeId: string) => void,
) {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  const slide = engine.createSlide('Slide 1')
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Mesh', {
    components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(100, 100) } },
  })
  const initialShape = initialShapeName ? engine.createShape(node.id, initialShapeName) : null
  prepare?.(engine, node.id)

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
  useShapePreviewStore.setState({ previewNodeId: null, previewShapeId: null })
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

describe('SculptToolbar shape dropdown categories', () => {
  const setupSameNamedShapes = (
    engine: ReturnType<typeof createEngineInternal>,
    nodeId: string,
  ) => {
    const face = engine.createShapeCategory(nodeId, 'Face', null)
    const left = engine.createShapeCategory(nodeId, 'Left', face.id)
    const body = engine.createShapeCategory(nodeId, 'Body', null)
    engine.createShape(nodeId, 'base', body.id)
    engine.createShape(nodeId, 'left', left.id)
    engine.createShape(nodeId, 'left', body.id)
  }

  it('groups same-named shapes under full category paths', () => {
    const { engine, node } = setup(undefined, setupSameNamedShapes)

    const select = screen.getByLabelText('Shape') as HTMLSelectElement
    const groups = within(select).getAllByRole('group') as HTMLOptGroupElement[]
    expect(groups.map((g) => g.label)).toEqual(['Face / Left', 'Body'])

    const shapes = engine.getShapes(node.id)
    expect(shapes.map((s) => s.name)).toEqual(['base', 'left', 'left'])
    expect(
      (within(groups[0]!).getByRole('option', { name: 'left' }) as HTMLOptionElement).value,
    ).toBe(shapes[1]!.id)
    expect(
      (within(groups[1]!).getByRole('option', { name: 'base' }) as HTMLOptionElement).value,
    ).toBe(shapes[0]!.id)
    expect(
      (within(groups[1]!).getByRole('option', { name: 'left' }) as HTMLOptionElement).value,
    ).toBe(shapes[2]!.id)
  })

  it('selects the exact same-named shape by id', async () => {
    const user = userEvent.setup()
    const { engine, node } = setup(undefined, setupSameNamedShapes)

    const select = screen.getByLabelText('Shape') as HTMLSelectElement
    const shapes = engine.getShapes(node.id)
    await user.selectOptions(select, shapes[2]!.id)

    expect(useMeshEditStore.getState().activeShapeId).toBe(shapes[2]!.id)
    expect(select.value).toBe(shapes[2]!.id)
  })

  it('clears a stale preview of another same-named shape on selection', async () => {
    const user = userEvent.setup()
    const { engine, node } = setup(undefined, setupSameNamedShapes)

    const select = screen.getByLabelText('Shape') as HTMLSelectElement
    const shapes = engine.getShapes(node.id)
    expect(useMeshEditStore.getState().activeShapeId).toBe(shapes[0]!.id)

    // Inspector Preview pinned to the first "left" while the sculpt selection moves on
    useShapePreviewStore.getState().setPreview(node.id, shapes[1]!.id)
    await user.selectOptions(select, shapes[2]!.id)

    expect(useMeshEditStore.getState().activeShapeId).toBe(shapes[2]!.id)
    expect(useShapePreviewStore.getState().previewShapeId).toBeNull()
  })
})

describe('SculptToolbar shape preselection', () => {
  it('preselects the shape already previewed in the Inspector', () => {
    let previewedShapeId = ''
    const { engine, node } = setup(undefined, (engine, nodeId) => {
      engine.createShape(nodeId, 'first')
      previewedShapeId = engine.createShape(nodeId, 'second').id
      useShapePreviewStore.setState({ previewNodeId: nodeId, previewShapeId: previewedShapeId })
    })

    const shapes = engine.getShapes(node.id)
    expect(shapes[0]!.id).not.toBe(previewedShapeId)
    expect(useMeshEditStore.getState().activeShapeId).toBe(previewedShapeId)
    expect((screen.getByLabelText('Shape') as HTMLSelectElement).value).toBe(previewedShapeId)
  })

  it('falls back to the first shape when the previewed shape is stale', () => {
    const { engine, node } = setup(undefined, (engine, nodeId) => {
      engine.createShape(nodeId, 'first')
      useShapePreviewStore.setState({ previewNodeId: nodeId, previewShapeId: 'shape-missing' })
    })

    const shapes = engine.getShapes(node.id)
    expect(useMeshEditStore.getState().activeShapeId).toBe(shapes[0]!.id)
    expect(useShapePreviewStore.getState().previewShapeId).toBeNull()
  })
})
