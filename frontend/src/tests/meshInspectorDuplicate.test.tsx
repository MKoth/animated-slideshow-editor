import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { EngineContext } from '../app/engineContext'
import type { EngineContextValue } from '../app/engineContext'
import { MeshInspectorSection } from '../components/panels/MeshInspectorSection'
import { CommandDispatcher, UndoStack } from '../engine/commands'
import { createEngineInternal, toReadOnly } from '../engine/internal'
import { createDefaultRectangleMesh } from '../engine/mesh'
import { noopPersistence } from './contextHarness'

function setup() {
  const engine = createEngineInternal()
  engine.createProject({ name: 'Demo' })
  const slide = engine.createSlide('Slide 1')
  const node = engine.createNode(slide.scene.id, slide.scene.root.id, 'Mesh', {
    components: { mesh: { kind: 'mesh', mesh: createDefaultRectangleMesh(100, 100) } },
  })
  const shape = engine.createShape(node.id, 'Smile')
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
      <MeshInspectorSection
        target={engine.getNode(node.id)}
        engine={toReadOnly(engine)}
        dispatch={(command) => dispatcher.dispatch(command)}
        notify={() => undefined}
        playing={false}
      />
    </EngineContext.Provider>,
  )
  return { engine, nodeId: node.id, shape }
}

describe('MeshInspectorSection Duplicate split button', () => {
  it('keeps the menu open when the caret is clicked and dispatches a mirrored duplicate', async () => {
    const user = userEvent.setup()
    const { engine, nodeId, shape } = setup()

    await user.click(screen.getByRole('button', { name: 'Duplicate shape Smile options' }))

    const mirroredX = await screen.findByRole('menuitem', {
      name: 'Duplicate shape Smile mirrored on X',
    })
    expect(
      screen.getByRole('menuitem', { name: 'Duplicate shape Smile mirrored on Y' }),
    ).toBeVisible()

    await user.click(mirroredX)

    const shapes = engine.getShapes(nodeId)
    expect(shapes).toHaveLength(2)
    expect(shapes[1]!.vertices).toEqual(shape.vertices.map((v) => ({ x: -v.x, y: v.y })))
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('plain Duplicate keeps copying vertices unchanged', async () => {
    const user = userEvent.setup()
    const { engine, nodeId, shape } = setup()

    await user.click(screen.getByRole('button', { name: 'Duplicate shape Smile' }))

    const shapes = engine.getShapes(nodeId)
    expect(shapes).toHaveLength(2)
    expect(shapes[1]!.vertices).toEqual(shape.vertices)
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('closes the menu on Escape without duplicating', async () => {
    const user = userEvent.setup()
    const { engine, nodeId } = setup()

    await user.click(screen.getByRole('button', { name: 'Duplicate shape Smile options' }))
    expect(await screen.findAllByRole('menuitem')).toHaveLength(2)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(engine.getShapes(nodeId)).toHaveLength(1)
  })
})
